import Foundation

/// Texture-space primitives: a dab, a fill, a sample, and the dirty rectangle
/// they report.
///
/// **Brushes do not live here.** Painting a disc in UV space bleeds across the
/// atlas — see `SurfacePaint`, which replaced it, for why that is not fixable by
/// tuning. What remains is the low-level texture work that the surface painter
/// and the tests both need: `dab` is still the honest way to put a mark at a
/// known texture coordinate, and `fill`, `sample` and `Rect` are unchanged.
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
