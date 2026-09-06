import Foundation

/// Painting the albedo texture.
///
/// Two things here are not obvious and both are load-bearing.
///
/// **Strokes are resampled by distance, not by event.** A Pencil delivers events
/// at whatever rate the hardware and the runloop agree on, so stamping one dab
/// per event makes a slow stroke dark and a fast one dotted — the same gesture
/// produces different paint depending on how busy the device was. Resampling to
/// a fixed spacing makes the result a function of the path alone.
///
/// **A dab near a UV seam has to be stamped into every island that shares the
/// point.** The cube's twelve edges are the seams here, and a brush crossing one
/// paints into a texture region whose neighbouring pixels belong somewhere else
/// entirely. Without seam stamping every stroke over an edge leaves a hard line
/// that no amount of further painting can cover.
public enum Paint {
    public struct Brush: Sendable {
        /// Radius in UV units. 0.02 is about 40 px on a 2048 texture.
        public var radius: Double
        /// 0...1, multiplied by falloff and by Pencil pressure.
        public var opacity: Double
        public var colour: (r: UInt8, g: UInt8, b: UInt8)
        /// Erasing paints the template's base colour back rather than making the
        /// texture transparent: the material is opaque and a hole in the albedo
        /// would export as a black patch.
        public var erasing: Bool

        public init(radius: Double = 0.02, opacity: Double = 1.0,
                    colour: (r: UInt8, g: UInt8, b: UInt8) = (40, 40, 48),
                    erasing: Bool = false) {
            self.radius = radius
            self.opacity = opacity
            self.colour = colour
            self.erasing = erasing
        }
    }

    /// One dab, centred on a UV coordinate.
    ///
    /// Returns the pixel rectangle it touched, which is what a changed-tile undo
    /// record and an incremental texture upload both want.
    @discardableResult
    public static func dab(into image: inout PNG.Image, at uv: Vec2, brush: Brush,
                           base: (r: UInt8, g: UInt8, b: UInt8) = (214, 176, 150)) -> Rect {
        let colour = brush.erasing ? base : brush.colour
        let radiusX = brush.radius * Double(image.width)
        let radiusY = brush.radius * Double(image.height)
        let centreX = uv.x * Double(image.width)
        // UV v runs up, image rows run down.
        let centreY = (1.0 - uv.y) * Double(image.height)

        let minX = max(0, Int((centreX - radiusX).rounded(.down)))
        let maxX = min(image.width - 1, Int((centreX + radiusX).rounded(.up)))
        let minY = max(0, Int((centreY - radiusY).rounded(.down)))
        let maxY = min(image.height - 1, Int((centreY + radiusY).rounded(.up)))
        guard minX <= maxX, minY <= maxY else { return .empty }

        for y in minY...maxY {
            for x in minX...maxX {
                let dx = (Double(x) + 0.5 - centreX) / radiusX
                let dy = (Double(y) + 0.5 - centreY) / radiusY
                let distance = (dx * dx + dy * dy).squareRoot()
                guard distance <= 1 else { continue }
                // Same smoothstep as the sculpt brushes, so a hard-edged dab
                // never appears in either tool.
                let t = 1.0 - distance
                let alpha = t * t * (3.0 - 2.0 * t) * brush.opacity
                guard alpha > 0 else { continue }
                blend(&image, x: x, y: y, colour: colour, alpha: alpha)
            }
        }
        return Rect(minX: minX, minY: minY, maxX: maxX, maxY: maxY)
    }

    /// A stroke in progress.
    ///
    /// Stateful because it has to be. Resampling each delivered segment on its
    /// own still leaves the result dependent on how the events were chopped up:
    /// every segment stamps both of its endpoints, so a path delivered as fifty
    /// short segments double-stamps forty-nine times and comes out markedly
    /// darker than the same path delivered as two. Measured on a 256 px texture
    /// at opacity 0.4, that was pixel value 3 against 29 — the difference
    /// between saturated and obviously not.
    ///
    /// Carrying the leftover distance across segments makes the dab positions a
    /// function of the path alone, which is the property the whole exercise is
    /// for.
    public struct Stroke {
        public var brush: Brush
        /// Dab spacing as a fraction of the brush radius. A quarter is the usual
        /// choice: closer wastes time re-blending the same pixels, wider leaves
        /// visible scalloping.
        public var spacing: Double
        public var base: (r: UInt8, g: UInt8, b: UInt8)

        private var previous: Vec2?
        private var carry: Double = 0

        public init(brush: Brush, spacing: Double = 0.25,
                    base: (r: UInt8, g: UInt8, b: UInt8) = (214, 176, 150)) {
            self.brush = brush
            self.spacing = spacing
            self.base = base
        }

        private var step: Double { max(brush.radius * spacing, 1e-6) }

        /// Extends the stroke to a new point, stamping whatever dabs fall in
        /// between. The first call stamps a single dab where the stroke starts.
        @discardableResult
        public mutating func extend(to point: Vec2, into image: inout PNG.Image) -> Rect {
            guard let start = previous else {
                previous = point
                carry = 0
                return Paint.dab(into: &image, at: point, brush: brush, base: base)
            }

            let dx = point.x - start.x, dy = point.y - start.y
            let distance = (dx * dx + dy * dy).squareRoot()
            guard distance > 0 else { return .empty }

            var touched = Rect.empty
            var travelled = step - carry
            while travelled <= distance {
                let t = travelled / distance
                let at = Vec2(start.x + dx * t, start.y + dy * t)
                touched = touched.union(Paint.dab(into: &image, at: at, brush: brush, base: base))
                travelled += step
            }
            carry = distance - (travelled - step)
            previous = point
            return touched
        }
    }

    /// A whole stroke between two points, for callers that have the path already.
    @discardableResult
    public static func stroke(into image: inout PNG.Image, from start: Vec2, to end: Vec2,
                              brush: Brush, spacing: Double = 0.25,
                              base: (r: UInt8, g: UInt8, b: UInt8) = (214, 176, 150)) -> Rect {
        var stroke = Stroke(brush: brush, spacing: spacing, base: base)
        var touched = stroke.extend(to: start, into: &image)
        touched = touched.union(stroke.extend(to: end, into: &image))
        return touched
    }

    /// Every UV a world-space point occupies.
    ///
    /// A point on a seam belongs to two or three islands. Painting only the one
    /// the ray happened to hit leaves the others untouched, which shows up as a
    /// hard line down the seam the moment the model is turned.
    public static func seamUVs(of welded: Int, mesh: MeshData, tables: MeshTables) -> [Vec2] {
        tables.weldMembers[welded].map { mesh.uvs[$0] }
    }

    /// Stamps a dab into every island a hit point belongs to.
    @discardableResult
    public static func dabAcrossSeams(into image: inout PNG.Image, at hit: Picking.Hit,
                                      mesh: MeshData, tables: MeshTables, brush: Brush,
                                      base: (r: UInt8, g: UInt8, b: UInt8) = (214, 176, 150)) -> Rect {
        var touched = dab(into: &image, at: hit.uv, brush: brush, base: base)

        // The corners of the hit triangle are the only places a seam can be
        // reached from inside it, and only those within a brush radius matter.
        let t = hit.triangle * 3
        for corner in 0..<3 {
            let vertex = Int(mesh.indices[t + corner])
            let welded = tables.weldOf[vertex]
            guard tables.weldMembers[welded].count > 1 else { continue }
            let cornerUV = mesh.uvs[vertex]
            let du = cornerUV.x - hit.uv.x, dv = cornerUV.y - hit.uv.y
            guard (du * du + dv * dv).squareRoot() <= brush.radius else { continue }

            for partnerUV in seamUVs(of: welded, mesh: mesh, tables: tables) {
                guard partnerUV != cornerUV else { continue }
                // Offset the stamp by the same amount the hit sat from the
                // corner, so the dab lands in the matching place in the
                // neighbouring island rather than on the corner itself.
                let mapped = Vec2(partnerUV.x - du, partnerUV.y - dv)
                touched = touched.union(dab(into: &image, at: mapped, brush: brush, base: base))
            }
        }
        return touched
    }

    /// Fills the whole texture. The first thing most people do.
    public static func fill(_ image: inout PNG.Image, with colour: (r: UInt8, g: UInt8, b: UInt8)) {
        for i in stride(from: 0, to: image.rgba.count, by: 4) {
            image.rgba[i] = colour.r
            image.rgba[i + 1] = colour.g
            image.rgba[i + 2] = colour.b
            image.rgba[i + 3] = 255
        }
    }

    /// Reads the colour under a hit, for the eyedropper.
    public static func sample(_ image: PNG.Image, at uv: Vec2) -> (r: UInt8, g: UInt8, b: UInt8) {
        let x = min(image.width - 1, max(0, Int(uv.x * Double(image.width))))
        let y = min(image.height - 1, max(0, Int((1.0 - uv.y) * Double(image.height))))
        let i = (y * image.width + x) * 4
        return (image.rgba[i], image.rgba[i + 1], image.rgba[i + 2])
    }

    private static func blend(_ image: inout PNG.Image, x: Int, y: Int,
                              colour: (r: UInt8, g: UInt8, b: UInt8), alpha: Double) {
        let i = (y * image.width + x) * 4
        let a = min(1.0, max(0.0, alpha))
        func mix(_ dst: UInt8, _ src: UInt8) -> UInt8 {
            UInt8(((1 - a) * Double(dst) + a * Double(src)).rounded())
        }
        image.rgba[i] = mix(image.rgba[i], colour.r)
        image.rgba[i + 1] = mix(image.rgba[i + 1], colour.g)
        image.rgba[i + 2] = mix(image.rgba[i + 2], colour.b)
        image.rgba[i + 3] = 255
    }

    /// The pixel rectangle an operation touched. Half-open would be tidier, but
    /// inclusive matches how the loops above are written and keeps `empty`
    /// unambiguous.
    public struct Rect: Sendable, Equatable {
        public var minX, minY, maxX, maxY: Int
        public static let empty = Rect(minX: 0, minY: 0, maxX: -1, maxY: -1)
        public var isEmpty: Bool { maxX < minX || maxY < minY }

        public init(minX: Int, minY: Int, maxX: Int, maxY: Int) {
            self.minX = minX; self.minY = minY; self.maxX = maxX; self.maxY = maxY
        }

        public func union(_ other: Rect) -> Rect {
            if isEmpty { return other }
            if other.isEmpty { return self }
            return Rect(minX: Swift.min(minX, other.minX), minY: Swift.min(minY, other.minY),
                        maxX: Swift.max(maxX, other.maxX), maxY: Swift.max(maxY, other.maxY))
        }
    }
}
