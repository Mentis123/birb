import Foundation

/// Painting on the **surface** rather than on the texture.
///
/// ## The bug this replaces
///
/// The first painter stamped a disc in UV space. The clay atlas packs six cube
/// faces into a 3×2 grid of tiles that touch, so a dab within one brush radius
/// of a tile edge wrote straight into the neighbouring tile — a different face,
/// at an unrelated place on the model. On the iPad that showed up as "painting
/// onto a side has it show up someplace else", and it is not tunable: any
/// disc in texture space has this property.
///
/// The seam helper made it worse. It re-stamped into a partner island at the
/// same UV offset, which is only right when both islands share an orientation;
/// in a cube atlas the neighbour is usually rotated a quarter or a half turn.
///
/// ## How this works
///
/// The brush is a **sphere in world space**. A texel is painted when the point
/// on the model it represents is inside that sphere. Bleed is then impossible by
/// construction — a texel in the next tile is only touched if the surface it
/// describes is genuinely under the brush — and seams need no special case at
/// all, in any orientation.
///
/// The work that makes it affordable is precomputed. Because this app's
/// topology and UVs are **immutable**, the set of texels each triangle covers
/// and the map from texel to barycentric coordinate never change: they are
/// template constants. `SurfaceMap` holds them as row runs plus a per-triangle
/// affine map, so painting a texel costs six multiply-adds to get its
/// barycentric weights, an interpolation to get its world position, and a
/// distance test. That is the design Blender uses for PBVH texture painting and
/// the reason it can paint at interactive rates.
public enum SurfacePaint {
    /// A brush measured in metres on the model, not in texels.
    public struct Brush: Sendable {
        /// World-space radius. The **same** number the sculpt brushes use, which
        /// the two tools did not previously share: paint was in UV units, so the
        /// size slider meant something different depending on the tool, and a
        /// fixed UV size covers different amounts of surface on different faces.
        public var radius: Double
        /// 0...1, multiplied by the falloff and by Pencil pressure.
        public var opacity: Double
        public var colour: (r: UInt8, g: UInt8, b: UInt8)
        /// Erasing paints the base colour back rather than making the texture
        /// transparent: the material is opaque, so a hole would export black.
        public var erasing: Bool
        /// How much of the radius paints at full opacity, 0...1, before the
        /// smooth falloff to the rim begins.
        ///
        /// 0 is the falloff across the whole radius, which is what every stroke
        /// used to get: only the exact centre line reached the chosen colour,
        /// so a blue stroke was a blue line with a wide wash either side — the
        /// "paint is soft" of the first screenshot. The editor paints at about
        /// half: a solid core with an edge that still has no ring.
        public var hardness: Double

        public init(radius: Double = 0.02, opacity: Double = 1.0,
                    colour: (r: UInt8, g: UInt8, b: UInt8) = (40, 40, 48),
                    erasing: Bool = false, hardness: Double = 0) {
            self.radius = radius
            self.opacity = opacity
            self.colour = colour
            self.erasing = erasing
            self.hardness = hardness
        }
    }

    // MARK: - The precomputed map

    /// Which texels each triangle owns, and how to read a texel's place on it.
    ///
    /// Built once per (template, texture size). Nothing in an edit invalidates
    /// it: brushes move positions, and this describes UVs and topology.
    public struct Map: Sendable {
        public let width: Int
        public let height: Int

        /// Texel (x, y) -> barycentric, as two affine functions. The third
        /// weight is `1 - v - w`, so it costs a subtract rather than a third
        /// row. Replaces a per-texel solve with two divides.
        struct Basis: Sendable {
            var vx, vy, vc: Double
            var wx, wy, wc: Double
        }

        /// A horizontal span of texels belonging to one triangle.
        struct Run: Sendable {
            var y: Int32
            var x0: Int32
            var count: Int32
        }

        let basis: [Basis]
        let runs: [Run]
        /// Triangle -> its slice of `runs`. One longer than the triangle count.
        let runStart: [Int32]

        public var runCount: Int { runs.count }
        public var texelCount: Int { runs.reduce(0) { $0 + Int($1.count) } }

        /// How many texels one triangle owns. For diagnostics.
        public func texels(of triangle: Int) -> Int {
            (Int(runStart[triangle])..<Int(runStart[triangle + 1]))
                .reduce(0) { $0 + Int(runs[$1].count) }
        }

        /// How far an island-edge triangle's footprint is grown, in texels.
        ///
        /// Bilinear filtering samples half a texel outside the triangle it is
        /// shading, so a footprint clipped exactly to the triangle leaves an
        /// unpainted hairline along every island edge — the "gutter" seam that
        /// looks like a crack in the paint. Two texels covers the filter and a
        /// texel of slack.
        ///
        /// **Only triangles on an island edge are dilated.** An interior
        /// triangle's neighbours paint the texels just outside it anyway, so
        /// growing it buys nothing and costs a great deal: clay's triangles are
        /// about fourteen texels across at 1024, so two texels of margin on all
        /// sides is roughly triple the area. Dilating everything made the map
        /// own 195% of the texture and the largest brush cost 23 ms — slower
        /// than the naive painter this replaced. Restricted to island edges it
        /// is a few per cent.
        ///
        /// The test for an island edge is that a vertex is welded to a copy
        /// with a different UV, which is what a seam *is*.
        public static let dilation = 2

        public init(_ mesh: MeshData, width: Int, height: Int) {
            self.init(mesh, tables: MeshTables(mesh), width: width, height: height)
        }

        public init(_ mesh: MeshData, tables: MeshTables, width: Int, height: Int) {
            self.width = width
            self.height = height
            let triangles = mesh.triangleCount
            // Vertices that sit on a UV island edge, and so the triangles whose
            // footprints need a gutter.
            var onSeam = [Bool](repeating: false, count: mesh.vertexCount)
            for welded in 0..<tables.weldedCount where tables.weldMembers[welded].count > 1 {
                for member in tables.weldMembers[welded] { onSeam[member] = true }
            }
            var basis = [Basis](); basis.reserveCapacity(triangles)
            var runs = [Run]()
            var runStart = [Int32](); runStart.reserveCapacity(triangles + 1)

            let w = Double(width), h = Double(height)
            // Texel (x, y) centre in UV: u = (x + 0.5)/w, v = 1 - (y + 0.5)/h.
            let kx = 1 / w, ky = -1 / h
            let bx = 0.5 / w, by = 1 - 0.5 / h

            for t in 0..<triangles {
                runStart.append(Int32(runs.count))
                let ia = Int(mesh.indices[t * 3])
                let ib = Int(mesh.indices[t * 3 + 1])
                let ic = Int(mesh.indices[t * 3 + 2])
                let a = mesh.uvs[ia], b = mesh.uvs[ib], c = mesh.uvs[ic]
                let e1 = Vec2(b.x - a.x, b.y - a.y)
                let e2 = Vec2(c.x - a.x, c.y - a.y)
                let determinant = e1.x * e2.y - e1.y * e2.x
                guard abs(determinant) > 1e-18 else {
                    // A triangle with no area in UV space owns no texels. It
                    // still needs a basis entry so indices line up.
                    basis.append(Basis(vx: 0, vy: 0, vc: 0, wx: 0, wy: 0, wc: 0))
                    continue
                }
                let inverse = 1 / determinant
                let cx = bx - a.x, cy = by - a.y
                let slot = Basis(
                    vx: kx * e2.y * inverse,
                    vy: -ky * e2.x * inverse,
                    vc: (cx * e2.y - cy * e2.x) * inverse,
                    wx: -e1.y * kx * inverse,
                    wy: e1.x * ky * inverse,
                    wc: (e1.x * cy - e1.y * cx) * inverse)
                basis.append(slot)

                let edging = onSeam[ia] || onSeam[ib] || onSeam[ic]
                runs.append(contentsOf: Map.rasterise(slot, a: a, b: b, c: c,
                                                      width: width, height: height,
                                                      dilate: edging ? Map.dilation : 0))
            }
            runStart.append(Int32(runs.count))
            self.basis = basis
            self.runs = runs
            self.runStart = runStart
        }

        /// Exact coverage, then a square dilation.
        ///
        /// The exact pass is a bounding-box scan rather than a scanline walk.
        /// It is the slower of the two and it runs once per template, where a
        /// subtle rasterisation bug would cost far more than the milliseconds
        /// it saves.
        private static func rasterise(_ slot: Basis, a: Vec2, b: Vec2, c: Vec2,
                                      width: Int, height: Int, dilate d: Int) -> [Run] {
            let w = Double(width), h = Double(height)
            let minU = min(a.x, b.x, c.x), maxU = max(a.x, b.x, c.x)
            let minV = min(a.y, b.y, c.y), maxV = max(a.y, b.y, c.y)
            let loX = max(0, Int((minU * w - 0.5).rounded(.down)))
            let hiX = min(width - 1, Int((maxU * w - 0.5).rounded(.up)))
            let loY = max(0, Int(((1 - maxV) * h - 0.5).rounded(.down)))
            let hiY = min(height - 1, Int(((1 - minV) * h - 0.5).rounded(.up)))
            guard loX <= hiX, loY <= hiY else { return [] }

            // Exact span per row: the intersection of a triangle with a
            // scanline is one interval, so first and last inside is enough.
            var spans = [Int: (Int, Int)]()
            for y in loY...hiY {
                let vRow = slot.vy * Double(y) + slot.vc
                let wRow = slot.wy * Double(y) + slot.wc
                var first = -1, last = -1
                for x in loX...hiX {
                    let v = slot.vx * Double(x) + vRow
                    let ww = slot.wx * Double(x) + wRow
                    guard v >= 0, ww >= 0, v + ww <= 1 else { continue }
                    if first < 0 { first = x }
                    last = x
                }
                if first >= 0 { spans[y] = (first, last) }
            }
            guard !spans.isEmpty else { return [] }

            let rows = spans.keys
            var out = [Run]()
            out.reserveCapacity(rows.count + 2 * d)
            for y in (rows.min()! - d)...(rows.max()! + d) {
                guard y >= 0, y < height else { continue }
                var lo = Int.max, hi = Int.min
                for source in (y - d)...(y + d) {
                    guard let span = spans[source] else { continue }
                    lo = min(lo, span.0 - d)
                    hi = max(hi, span.1 + d)
                }
                guard lo <= hi else { continue }
                lo = max(0, lo); hi = min(width - 1, hi)
                guard lo <= hi else { continue }
                out.append(Run(y: Int32(y), x0: Int32(lo), count: Int32(hi - lo + 1)))
            }
            return out
        }
    }

    // MARK: - Painting

    /// A paint stroke in progress.
    ///
    /// Holds two things that make a stroke behave the way a person expects.
    ///
    /// **The albedo as it was when the stroke began.** Every texel is written by
    /// interpolating from that, never from the pixel already there.
    ///
    /// **The greatest alpha applied to each texel so far.** A texel is only
    /// rewritten when the new alpha exceeds the old one. Together these make the
    /// stroke *idempotent*: passing over the same place twice in one stroke
    /// changes nothing the second time, a Pencil held still darkens nothing, and
    /// the overlap between two consecutive segments is not double-blended. It is
    /// what Procreate and Photoshop call a stroke with build-up off, and it is
    /// also what makes a per-frame painter safe — without it, a slow stroke at
    /// 120 Hz would saturate in a fraction of a second.
    public struct Stroke {
        public let map: Map
        public var brush: Brush
        public var base: (r: UInt8, g: UInt8, b: UInt8)

        /// The albedo at stroke start. Copy-on-write, so this is free until the
        /// first texel is written.
        private var origin: PNG.Image
        private var alpha: [UInt8]
        private var previous: Vec3?
        /// The mirrored stroke's previous point, when symmetry is on. It shares
        /// `alpha` and `origin` with the primary track, and that is the point:
        /// where the two overlap — any stroke near the mirror plane — a texel
        /// takes the greater of the two alphas instead of being painted twice,
        /// or being painted once and then overwritten by the fainter one.
        private var previousMirror: Vec3?
        /// The brush as it was at the previous point. A segment tapers from
        /// this to the current brush, so a pressure change along a stroke is a
        /// smooth taper rather than a step at every sample.
        private var previousRadius: Double?
        private var previousOpacity: Double?
        private(set) public var dirty: Paint.Rect = .empty

        public init(map: Map, brush: Brush, origin: PNG.Image,
                    base: (r: UInt8, g: UInt8, b: UInt8) = (214, 176, 150)) {
            self.map = map
            self.brush = brush
            self.origin = origin
            self.base = base
            self.alpha = [UInt8](repeating: 0, count: origin.width * origin.height)
        }

        /// Reuses this stroke's buffers for a new one.
        ///
        /// Allocating and zeroing the alpha buffer per stroke is not free at the
        /// sizes involved: 4 MB at 2048², which measured as 7 ms of a paint
        /// stroke that touched twenty triangles — the allocation cost more than
        /// the painting by a factor of a hundred. Only the rectangle the last
        /// stroke actually dirtied needs clearing.
        public mutating func reset(brush: Brush, origin: PNG.Image) {
            if !dirty.isEmpty {
                alpha.withUnsafeMutableBufferPointer { buffer in
                    for y in dirty.minY...dirty.maxY {
                        let row = y * map.width
                        for x in dirty.minX...dirty.maxX { buffer[row + x] = 0 }
                    }
                }
            }
            self.brush = brush
            self.origin = origin
            self.dirty = .empty
            self.previous = nil
            self.previousMirror = nil
            self.previousRadius = nil
            self.previousOpacity = nil
        }

        /// Breaks the stroke: the next point starts a new segment instead of
        /// joining the last one.
        ///
        /// For a pointer that left the model and came back. Joined, the
        /// segment runs through space from where it left to where it
        /// returned, and the capsule around that line paints a streak across
        /// whatever surface it passes near — round the corner the Pencil went
        /// over, onto a face it never touched.
        public mutating func lift() {
            previous = nil
            previousMirror = nil
            previousRadius = nil
            previousOpacity = nil
        }

        /// Extends the stroke to a surface point and paints the swept capsule
        /// between it and the previous one.
        ///
        /// `seed` is a triangle known to be under the brush — the one the ray
        /// hit. The search for what else to paint walks outward from there
        /// across the surface, so the brush cannot reach through a fold onto
        /// geometry that merely happens to be nearby in space.
        @discardableResult
        public mutating func extend(to point: Vec3, seed: Int, mesh: MeshData,
                                    tables: MeshTables, into image: inout PNG.Image) -> Paint.Rect {
            extend(to: point, seed: seed, mirror: nil, mesh: mesh, tables: tables, into: &image)
        }

        /// Extends the stroke, and its mirror image when `mirror` is given.
        ///
        /// `mirror` is the mirrored point and a triangle under it
        /// (`SurfacePaint.mirror(of:triangle:mesh:tables:)`). Both tracks
        /// paint into the same alpha buffer, so the stroke stays idempotent
        /// where they meet on the plane.
        @discardableResult
        public mutating func extend(to point: Vec3, seed: Int, mirror: (point: Vec3, seed: Int)?,
                                    mesh: MeshData, tables: MeshTables,
                                    into image: inout PNG.Image) -> Paint.Rect {
            let r1 = brush.radius, o1 = brush.opacity
            let r0 = previousRadius ?? r1, o0 = previousOpacity ?? o1
            defer {
                previous = point
                previousMirror = mirror?.point
                previousRadius = r1
                previousOpacity = o1
            }
            if let previous, previous == point, r0 == r1, o0 == o1, !dirty.isEmpty { return .empty }
            var touched = paint(segment: previous ?? point, to: point, seed: seed,
                                radii: (r0, r1), opacities: (o0, o1), mesh: mesh,
                                tables: tables, into: &image)
            if let mirror {
                touched = touched.union(paint(segment: previousMirror ?? mirror.point, to: mirror.point,
                                              seed: mirror.seed, radii: (r0, r1),
                                              opacities: (o0, o1), mesh: mesh, tables: tables,
                                              into: &image))
            }
            dirty = dirty.union(touched)
            return touched
        }

        private mutating func paint(segment from: Vec3, to: Vec3, seed: Int,
                                    radii: (Double, Double), opacities: (Double, Double),
                                    mesh: MeshData, tables: MeshTables,
                                    into image: inout PNG.Image) -> Paint.Rect {
            guard radii.0 > 0 || radii.1 > 0, opacities.0 > 0 || opacities.1 > 0 else { return .empty }
            let reachRadius = max(radii.0, radii.1)
            let triangles = SurfacePaint.reach(from: from, to: to, seed: seed,
                                               radius: reachRadius, mesh: mesh, tables: tables)
            guard !triangles.isEmpty else { return .empty }

            let colour = brush.erasing ? base : brush.colour
            let map = self.map
            let hardness = min(0.95, max(0, brush.hardness))
            var result = Paint.Rect.empty

            // The raster loop is lifted out into a free function taking raw
            // pointers. Written inline it needed four nested
            // `withUnsafeBufferPointer` closures, which the type checker gave up
            // on — and a body the compiler struggles to type is one it also
            // struggles to optimise.
            image.rgba.withUnsafeMutableBufferPointer { pixels in
                origin.rgba.withUnsafeBufferPointer { source in
                    alpha.withUnsafeMutableBufferPointer { alphas in
                        result = Stroke.rasterise(
                            triangles: triangles, map: map, mesh: mesh,
                            from: from, to: to, radii: radii, opacities: opacities,
                            hardness: hardness, colour: colour, width: image.width,
                            pixels: pixels.baseAddress!, source: source.baseAddress!,
                            alphas: alphas.baseAddress!)
                    }
                }
            }
            return result
        }

        /// One pass over every texel the brush covers.
        ///
        /// Everything here is hoisted and in Float. A texel costs two affine
        /// evaluations for its barycentric weights, two multiply-adds for its
        /// world position, a distance test, and — only if it beats the alpha
        /// already there — an integer blend. Double precision is invisible at
        /// this scale (a barycentric good to 1e-5 places a point on a 24 cm
        /// model to within microns) and costs twice the SIMD width.
        private static func rasterise(triangles: [Int], map: Map, mesh: MeshData,
                                      from: Vec3, to: Vec3, radii: (Double, Double),
                                      opacities: (Double, Double), hardness: Double,
                                      colour: (r: UInt8, g: UInt8, b: UInt8),
                                      width: Int,
                                      pixels: UnsafeMutablePointer<UInt8>,
                                      source: UnsafePointer<UInt8>,
                                      alphas: UnsafeMutablePointer<UInt8>) -> Paint.Rect {
            let axis = to - from
            let axisLengthSquared = dot(axis, axis)
            let sweeping = axisLengthSquared > 0
            // Scalar Float, not SIMD3<Float>. `SIMD3.sum()` does not lower to a
            // horizontal add here, and a three-wide vector wastes a lane anyway;
            // written out, the dot products are three multiplies the compiler
            // schedules itself.
            let originX = Float(from.x), originY = Float(from.y), originZ = Float(from.z)
            let axisX = Float(axis.x), axisY = Float(axis.y), axisZ = Float(axis.z)
            let inverseAxis = sweeping ? Float(1 / axisLengthSquared) : 0
            // A segment tapers from the brush at its start to the brush at its
            // end — pressure changes along a stroke — so radius and opacity are
            // evaluated at each texel's place along the axis. The constant case
            // keeps its precomputed reciprocal: it is most frames of most
            // strokes, and the divide per painted texel is what it saves.
            let startRadius = Float(radii.0), radiusChange = Float(radii.1 - radii.0)
            let startOpacity = Float(opacities.0), opacityChange = Float(opacities.1 - opacities.0)
            let tapering = radiusChange != 0
            let largest = max(radii.0, radii.1)
            let largestSquared = Float(largest * largest)
            let constantInverse = Float(1 / max(1e-12, radii.1))
            // Past `hardness` of the radius the smoothstep runs from full to
            // nothing; inside it, the brush is solid.
            let edge = Float(1 / max(0.05, 1 - hardness))
            let red = UInt32(colour.r), green = UInt32(colour.g), blue = UInt32(colour.b)
            var minX = Int.max, minY = Int.max, maxX = Int.min, maxY = Int.min

            mesh.positions.withUnsafeBufferPointer { positions in
            mesh.indices.withUnsafeBufferPointer { indices in
            map.runs.withUnsafeBufferPointer { runs in
            map.runStart.withUnsafeBufferPointer { runStart in
            map.basis.withUnsafeBufferPointer { basis in
            for t in triangles {
                let slot = basis[t]
                let pa = positions[Int(indices[t * 3])]
                let pb = positions[Int(indices[t * 3 + 1])]
                let pc = positions[Int(indices[t * 3 + 2])]
                // Corner plus two edges, so a texel's position is two
                // multiply-adds rather than three weighted points.
                let ax = Float(pa.x), ay = Float(pa.y), az = Float(pa.z)
                let e1x = Float(pb.x - pa.x), e1y = Float(pb.y - pa.y), e1z = Float(pb.z - pa.z)
                let e2x = Float(pc.x - pa.x), e2y = Float(pc.y - pa.y), e2z = Float(pc.z - pa.z)
                let vx = Float(slot.vx), vy = Float(slot.vy), vc = Float(slot.vc)
                let wx = Float(slot.wx), wy = Float(slot.wy), wc = Float(slot.wc)

                for r in Int(runStart[t])..<Int(runStart[t + 1]) {
                    let run = runs[r]
                    let y = Int(run.y)
                    let vRow = vy * Float(y) + vc
                    let wRow = wy * Float(y) + wc
                    let rowBase = y * width
                    var touchedRow = false

                    // Strength reduction along the row: the barycentric weights
                    // are affine in x, so stepping them costs an add each and
                    // saves two Int-to-Float conversions and two multiplies per
                    // texel.
                    let first = Int(run.x0)
                    var v = vx * Float(first) + vRow
                    var w = wx * Float(first) + wRow
                    for x in first..<(first + Int(run.count)) {
                        defer { v += vx; w += wx }
                        // The texel's place on the model, from the CURRENT
                        // positions: the brush follows the surface as it is
                        // sculpted, not as the template shipped it.
                        var dx = ax + e1x * v + e2x * w - originX
                        var dy = ay + e1y * v + e2y * w - originY
                        var dz = az + e1z * v + e2z * w - originZ
                        var along: Float = 1
                        if sweeping {
                            along = (dx * axisX + dy * axisY + dz * axisZ) * inverseAxis
                            along = along < 0 ? 0 : (along > 1 ? 1 : along)
                            dx -= axisX * along; dy -= axisY * along; dz -= axisZ * along
                        }
                        let distanceSquared = dx * dx + dy * dy + dz * dz
                        if distanceSquared > largestSquared { continue }
                        let radius = startRadius + radiusChange * along
                        if tapering, distanceSquared > radius * radius { continue }
                        let inverseRadius = tapering ? 1 / radius : constantInverse

                        // Solid inside the hardness, then smoothstep to the rim:
                        // the brush edge must have no ring.
                        var unit = (1 - distanceSquared.squareRoot() * inverseRadius) * edge
                        unit = unit > 1 ? 1 : (unit < 0 ? 0 : unit)
                        let opacity = startOpacity + opacityChange * along
                        let strength = unit * unit * (3 - 2 * unit) * opacity
                        // Integer from here down. `Float.rounded()` and the
                        // trapping `UInt8(Float)` conversion do not inline, and
                        // there were four per texel.
                        let scaled = Int(strength * 255 + 0.5)
                        let level = UInt8(scaled < 0 ? 0 : (scaled > 255 ? 255 : scaled))
                        let index = rowBase + x
                        if level <= alphas[index] { continue }
                        alphas[index] = level

                        // Divide-free blend. Three `Int` divisions by 255 per
                        // texel were twelve times the cost of all the geometry
                        // above them: signed 64-bit division does not become a
                        // multiply-and-shift. `(t + (t >> 8)) >> 8` is the exact
                        // rounded t/255 for the range these products occupy.
                        let a = UInt32(level), inverse = 255 - UInt32(level)
                        let i = index * 4
                        let tr = UInt32(source[i]) * inverse + red * a + 128
                        let tg = UInt32(source[i + 1]) * inverse + green * a + 128
                        let tb = UInt32(source[i + 2]) * inverse + blue * a + 128
                        pixels[i] = UInt8(truncatingIfNeeded: (tr &+ (tr >> 8)) >> 8)
                        pixels[i + 1] = UInt8(truncatingIfNeeded: (tg &+ (tg >> 8)) >> 8)
                        pixels[i + 2] = UInt8(truncatingIfNeeded: (tb &+ (tb >> 8)) >> 8)
                        pixels[i + 3] = 255

                        if x < minX { minX = x }
                        if x > maxX { maxX = x }
                        touchedRow = true
                    }
                    if touchedRow {
                        if y < minY { minY = y }
                        if y > maxY { maxY = y }
                    }
                }
            }
            }}}}}
            guard minX <= maxX else { return .empty }
            return Paint.Rect(minX: minX, minY: minY, maxX: maxX, maxY: maxY)
        }
    }

    /// The mirror image of a point on the surface, across x = 0, and a triangle
    /// under it — where a symmetric paint stroke puts its second track.
    ///
    /// Not simply "the mirrored triangle". The clay's POSITIONS are exactly
    /// symmetric but its triangulation is not: every quad is split along the
    /// same diagonal, so the mirror image of a triangle is usually not a
    /// triangle of the mesh at all. The search is therefore by position, among
    /// the faces around the mirrors of the hit triangle's corners — which
    /// between them always cover the mirrored point on a symmetric shape — and
    /// the answer is the nearest point ON the surface. That also keeps
    /// symmetric painting sensible on a model sculpted without symmetry: the
    /// mirror track follows the surface rather than painting air.
    public static func mirror(of point: Vec3, triangle: Int, mesh: MeshData,
                              tables: MeshTables) -> (point: Vec3, seed: Int)? {
        guard triangle >= 0, triangle * 3 + 2 < mesh.indices.count else { return nil }
        let target = Vec3(-point.x, point.y, point.z)
        var candidates = [Int]()
        for corner in 0..<3 {
            let welded = tables.weldOf[Int(mesh.indices[triangle * 3 + corner])]
            guard let partner = tables.mirror[welded] else { continue }
            for face in tables.trianglesOfWelded[partner] where !candidates.contains(Int(face)) {
                candidates.append(Int(face))
            }
        }
        var best: (distance: Double, point: Vec3, face: Int)?
        for face in candidates {
            let a = mesh.positions[Int(mesh.indices[face * 3])]
            let b = mesh.positions[Int(mesh.indices[face * 3 + 1])]
            let c = mesh.positions[Int(mesh.indices[face * 3 + 2])]
            let q = closestPoint(on: (a, b, c), to: target)
            let offset = q - target
            let distance = dot(offset, offset)
            if best == nil || distance < best!.distance { best = (distance, q, face) }
        }
        guard let best else { return nil }
        return (best.point, best.face)
    }

    /// The point of a triangle nearest `p` (Ericson, *Real-Time Collision
    /// Detection* §5.1.5): the Voronoi region of each vertex and edge in turn,
    /// then the face.
    static func closestPoint(on triangle: (Vec3, Vec3, Vec3), to p: Vec3) -> Vec3 {
        let (a, b, c) = triangle
        let ab = b - a, ac = c - a, ap = p - a
        let d1 = dot(ab, ap), d2 = dot(ac, ap)
        if d1 <= 0 && d2 <= 0 { return a }
        let bp = p - b
        let d3 = dot(ab, bp), d4 = dot(ac, bp)
        if d3 >= 0 && d4 <= d3 { return b }
        let vc = d1 * d4 - d3 * d2
        if vc <= 0 && d1 >= 0 && d3 <= 0 { return a + ab * (d1 / (d1 - d3)) }
        let cp = p - c
        let d5 = dot(ab, cp), d6 = dot(ac, cp)
        if d6 >= 0 && d5 <= d6 { return c }
        let vb = d5 * d2 - d1 * d6
        if vb <= 0 && d2 >= 0 && d6 <= 0 { return a + ac * (d2 / (d2 - d6)) }
        let va = d3 * d6 - d5 * d4
        if va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0 {
            return b + (c - b) * ((d4 - d3) / ((d4 - d3) + (d5 - d6)))
        }
        let denominator = 1 / (va + vb + vc)
        return a + ab * (vb * denominator) + ac * (vc * denominator)
    }

    /// Triangles the brush can reach, by walking the surface outward from the
    /// triangle the ray hit.
    ///
    /// Connectivity rather than proximity is deliberate. A sphere test over
    /// every triangle would also catch the far wall of a fold, or the other side
    /// of a thin form, and paint the back of the model from the front. Walking
    /// the surface paints what the brush is actually on.
    ///
    /// The seed triangle is always included, so a brush smaller than one
    /// triangle still paints.
    public static func reach(from: Vec3, to: Vec3, seed: Int, radius: Double,
                      mesh: MeshData, tables: MeshTables) -> [Int] {
        let radiusSquared = radius * radius
        let axis = to - from
        let axisLengthSquared = dot(axis, axis)

        func withinBrush(_ p: Vec3) -> Bool {
            let offset = p - from
            guard axisLengthSquared > 0 else { return dot(offset, offset) <= radiusSquared }
            let along = min(1, max(0, dot(offset, axis) / axisLengthSquared))
            let d = offset - axis * along
            return dot(d, d) <= radiusSquared
        }

        var visited = Set<Int>()
        var frontier = [Int]()
        for corner in 0..<3 {
            let welded = tables.weldOf[Int(mesh.indices[seed * 3 + corner])]
            if visited.insert(welded).inserted { frontier.append(welded) }
        }

        var faces = Set<Int>([seed])
        while let welded = frontier.popLast() {
            let p = mesh.positions[tables.weldMembers[welded][0]]
            guard withinBrush(p) else { continue }
            for face in tables.trianglesOfWelded[welded] { faces.insert(Int(face)) }
            for next in tables.neighbours[welded] where visited.insert(next).inserted {
                frontier.append(next)
            }
        }
        return faces.sorted()
    }
}
