import Foundation

/// Whether a move made the surface pass through itself.
///
/// The sixth device run's screenshot was a Deflate pit with the model's
/// inside showing through it. The clay is one closed surface, so from outside
/// only its front can ever be seen — unless it crosses itself, and then the
/// renderer draws the far side of the crossing, which reads as a hole. So the
/// guarantee Inflate and Deflate owe the person is not "no triangle turned
/// over" (what the fold guard it replaces checked, and a surface can cross
/// itself without that) but exactly this: **no two triangles that did not
/// cross before a frame cross after it.**
///
/// Triangles that share a corner are not compared. They meet at that corner
/// by construction, and a segment test would report the meeting as a
/// crossing on every frame.
public enum SelfIntersection {
    /// Whether moving the welded positions in `moved` from `start` to where
    /// they are in `mesh` made a triangle that touches one of them cross a
    /// triangle it shares no corner with, where the two did not cross at
    /// `start`. A crossing that was already there — from an older version of
    /// the app, or pulled in on purpose with Grab — does not count, so a brush
    /// is never stuck beside one it did not make.
    ///
    /// Only the moved region is examined: the triangles touching `moved`,
    /// against every triangle whose bounds overlap theirs. On the build box
    /// in release that is 0.10 ms for a frame of the device's 22 mm brush and
    /// 0.24 ms for a 56 mm one (`humanoid-cli bench`).
    public static func created(in mesh: MeshData, moved: Set<Int>, from startPositions: [Vec3],
                               tables: MeshTables) -> Bool {
        guard !moved.isEmpty else { return false }
        let triangleCount = mesh.triangleCount
        let positions = mesh.positions
        let indices = mesh.indices

        // The triangles the move could have taken anywhere.
        var isMoved = [Bool](repeating: false, count: triangleCount)
        var movedFaces: [Int] = []
        for w in moved {
            for face in tables.trianglesOfWelded[w] where !isMoved[Int(face)] {
                isMoved[Int(face)] = true
                movedFaces.append(Int(face))
            }
        }
        guard !movedFaces.isEmpty else { return false }

        // Their bounds, and the region they span now.
        var regionLow = Vec3(repeating: .infinity)
        var regionHigh = Vec3(repeating: -.infinity)
        for face in movedFaces {
            let (low, high) = bounds(face, positions, indices)
            regionLow = pointwiseMin(regionLow, low)
            regionHigh = pointwiseMax(regionHigh, high)
        }

        // Every triangle whose bounds overlap the region, and how wide the
        // widest of them is along x.
        var candidates: [Int] = []
        var lows: [Vec3] = []
        var highs: [Vec3] = []
        var slot = [Int](repeating: -1, count: triangleCount)
        var widest = 0.0
        positions.withUnsafeBufferPointer { p in
            indices.withUnsafeBufferPointer { index in
                for face in 0..<triangleCount {
                    let a = p[Int(index[face * 3])], b = p[Int(index[face * 3 + 1])]
                    let c = p[Int(index[face * 3 + 2])]
                    let low = pointwiseMin(a, pointwiseMin(b, c))
                    let high = pointwiseMax(a, pointwiseMax(b, c))
                    guard overlaps(low, high, regionLow, regionHigh) else { continue }
                    slot[face] = candidates.count
                    candidates.append(face)
                    lows.append(low)
                    highs.append(high)
                    widest = max(widest, high.x - low.x)
                }
            }
        }
        // Sorted by where each starts along x, so a moved triangle only
        // looks at the run of candidates that could reach it. A frame's
        // region holds a few hundred triangles; a grid over them cost more
        // to build than it saved.
        let order = (0..<candidates.count).sorted { lows[$0].x < lows[$1].x }
        var sortedLow = [Double](repeating: 0, count: order.count)
        for (k, i) in order.enumerated() { sortedLow[k] = lows[i].x }

        // Moved triangles against the candidates. A pair of moved triangles
        // is looked at from its lower-numbered side only.
        for face in movedFaces {
            let own = slot[face]
            guard own >= 0 else { continue }
            let low = lows[own], high = highs[own]
            let corners = weldedCorners(face, indices, tables)
            // Nothing starting further left than the widest candidate can
            // reach this far: the first of the run by binary search.
            var k = firstIndex(in: sortedLow, notBelow: low.x - widest)
            while k < order.count, sortedLow[k] <= high.x {
                let i = order[k]
                k += 1
                let other = candidates[i]
                if other == face || (isMoved[other] && other < face) { continue }
                guard overlaps(low, high, lows[i], highs[i]) else { continue }
                let theirs = weldedCorners(other, indices, tables)
                if shareCorner(corners, theirs) { continue }
                if cross(face, other, positions, indices),
                   !cross(face, other, startPositions, indices) {
                    return true
                }
            }
        }
        return false
    }

    /// The first position in ascending `values` holding `bound` or more.
    private static func firstIndex(in values: [Double], notBelow bound: Double) -> Int {
        var low = 0, high = values.count
        while low < high {
            let middle = (low + high) / 2
            if values[middle] < bound { low = middle + 1 } else { high = middle }
        }
        return low
    }

    // MARK: - Geometry

    @inline(__always)
    static func corners(_ face: Int, _ positions: [Vec3], _ indices: [UInt32]) -> (Vec3, Vec3, Vec3) {
        (positions[Int(indices[face * 3])], positions[Int(indices[face * 3 + 1])],
         positions[Int(indices[face * 3 + 2])])
    }

    @inline(__always)
    private static func bounds(_ face: Int, _ positions: [Vec3],
                               _ indices: [UInt32]) -> (Vec3, Vec3) {
        let (a, b, c) = corners(face, positions, indices)
        return (pointwiseMin(a, pointwiseMin(b, c)), pointwiseMax(a, pointwiseMax(b, c)))
    }

    @inline(__always)
    private static func overlaps(_ lowA: Vec3, _ highA: Vec3, _ lowB: Vec3, _ highB: Vec3) -> Bool {
        lowA.x <= highB.x && highA.x >= lowB.x && lowA.y <= highB.y && highA.y >= lowB.y
            && lowA.z <= highB.z && highA.z >= lowB.z
    }

    @inline(__always)
    private static func weldedCorners(_ face: Int, _ indices: [UInt32],
                                      _ tables: MeshTables) -> (Int, Int, Int) {
        (tables.weldOf[Int(indices[face * 3])], tables.weldOf[Int(indices[face * 3 + 1])],
         tables.weldOf[Int(indices[face * 3 + 2])])
    }

    @inline(__always)
    private static func shareCorner(_ a: (Int, Int, Int), _ b: (Int, Int, Int)) -> Bool {
        a.0 == b.0 || a.0 == b.1 || a.0 == b.2 || a.1 == b.0 || a.1 == b.1 || a.1 == b.2
            || a.2 == b.0 || a.2 == b.1 || a.2 == b.2
    }

    /// Whether two triangles cross: an edge of either passes through the
    /// other. Coplanar overlaps are not reported; on a sculpted surface they
    /// need two faces to land in exactly one plane.
    static func cross(_ f: Int, _ g: Int, _ positions: [Vec3], _ indices: [UInt32]) -> Bool {
        let a = corners(f, positions, indices)
        let b = corners(g, positions, indices)
        return edgeCrosses(a.0, a.1, b) || edgeCrosses(a.1, a.2, b) || edgeCrosses(a.2, a.0, b)
            || edgeCrosses(b.0, b.1, a) || edgeCrosses(b.1, b.2, a) || edgeCrosses(b.2, b.0, a)
    }

    /// Möller–Trumbore, for a segment rather than a ray, and two-sided.
    @inline(__always)
    private static func edgeCrosses(_ p: Vec3, _ q: Vec3, _ t: (Vec3, Vec3, Vec3)) -> Bool {
        let direction = q - p
        let e1 = t.1 - t.0, e2 = t.2 - t.0
        let h = HumanoidCore.cross(direction, e2)
        let determinant = dot(e1, h)
        guard abs(determinant) > 1e-20 else { return false }
        let inverse = 1 / determinant
        let s = p - t.0
        let u = dot(s, h) * inverse
        guard u >= 0, u <= 1 else { return false }
        let qv = HumanoidCore.cross(s, e1)
        let v = dot(direction, qv) * inverse
        guard v >= 0, u + v <= 1 else { return false }
        let along = dot(e2, qv) * inverse
        return along >= 0 && along <= 1
    }
}
