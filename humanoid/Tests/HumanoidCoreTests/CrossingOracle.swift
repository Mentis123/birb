@testable import HumanoidCore

/// An independent count of where a surface passes through itself, for the
/// tests to hold `SelfIntersection` and the brushes against.
///
/// Independent on purpose. The production detector finds a crossing with a
/// segment-versus-triangle ray test over a grid of the moved region; this
/// walks every triangle through its own grid and decides a crossing from
/// signed distances to planes and a point-in-triangle test. A defect that
/// made the production code blind to some crossing would have to be made
/// twice, differently, to pass these tests.
enum CrossingOracle {
    /// Pairs of triangles that cross and share no welded corner.
    static func pairs(in mesh: MeshData, tables: MeshTables) -> Set<Pair> {
        let count = mesh.triangleCount
        var lows = [Vec3](), highs = [Vec3]()
        lows.reserveCapacity(count)
        highs.reserveCapacity(count)
        for f in 0..<count {
            let (a, b, c) = corners(f, mesh)
            lows.append(Vec3(min(a.x, b.x, c.x), min(a.y, b.y, c.y), min(a.z, b.z, c.z)))
            highs.append(Vec3(max(a.x, b.x, c.x), max(a.y, b.y, c.y), max(a.z, b.z, c.z)))
        }
        let cell = 0.02
        var grid: [Int: [Int]] = [:]
        func key(_ x: Int, _ y: Int, _ z: Int) -> Int { ((x + 1024) * 2048 + (y + 1024)) * 2048 + (z + 1024) }
        func range(_ low: Double, _ high: Double) -> ClosedRange<Int> {
            let a = Int((low / cell).rounded(.down)), b = Int((high / cell).rounded(.down))
            return max(-1000, a)...min(1000, max(a, b))
        }
        for f in 0..<count {
            for x in range(lows[f].x, highs[f].x) {
                for y in range(lows[f].y, highs[f].y) {
                    for z in range(lows[f].z, highs[f].z) { grid[key(x, y, z), default: []].append(f) }
                }
            }
        }
        var found = Set<Pair>()
        var tested = Set<Pair>()
        for (_, bucket) in grid where bucket.count > 1 {
            for i in 0..<bucket.count {
                for j in (i + 1)..<bucket.count {
                    let pair = Pair(bucket[i], bucket[j])
                    guard !tested.contains(pair) else { continue }
                    tested.insert(pair)
                    let f = pair.first, g = pair.second
                    guard lows[f].x <= highs[g].x, lows[g].x <= highs[f].x,
                          lows[f].y <= highs[g].y, lows[g].y <= highs[f].y,
                          lows[f].z <= highs[g].z, lows[g].z <= highs[f].z else { continue }
                    guard Set(welded(f, mesh, tables)).isDisjoint(with: welded(g, mesh, tables)) else { continue }
                    if trianglesCross(corners(f, mesh), corners(g, mesh)) { found.insert(pair) }
                }
            }
        }
        return found
    }

    /// Crossings in `after` that were not in `before`, touching any triangle
    /// with a corner in `moved`.
    static func created(before: MeshData, after: MeshData, moved: Set<Int>,
                        tables: MeshTables) -> Set<Pair> {
        var faces = Set<Int>()
        for w in moved { for f in tables.trianglesOfWelded[w] { faces.insert(Int(f)) } }
        return pairs(in: after, tables: tables)
            .subtracting(pairs(in: before, tables: tables))
            .filter { faces.contains($0.first) || faces.contains($0.second) }
    }

    struct Pair: Hashable {
        let first: Int, second: Int
        init(_ a: Int, _ b: Int) { first = min(a, b); second = max(a, b) }
    }

    private static func corners(_ f: Int, _ m: MeshData) -> (Vec3, Vec3, Vec3) {
        (m.positions[Int(m.indices[f * 3])], m.positions[Int(m.indices[f * 3 + 1])],
         m.positions[Int(m.indices[f * 3 + 2])])
    }

    private static func welded(_ f: Int, _ m: MeshData, _ tables: MeshTables) -> [Int] {
        (0..<3).map { tables.weldOf[Int(m.indices[f * 3 + $0])] }
    }

    /// An edge of either triangle passes through the other: it has endpoints
    /// strictly on both sides of the other's plane, and the point where it
    /// meets that plane is inside the other triangle.
    private static func trianglesCross(_ a: (Vec3, Vec3, Vec3), _ b: (Vec3, Vec3, Vec3)) -> Bool {
        edgesPierce(a, b) || edgesPierce(b, a)
    }

    private static func edgesPierce(_ edges: (Vec3, Vec3, Vec3), _ t: (Vec3, Vec3, Vec3)) -> Bool {
        let normal = cross(t.1 - t.0, t.2 - t.0)
        guard dot(normal, normal) > 1e-30 else { return false }
        for (p, q) in [(edges.0, edges.1), (edges.1, edges.2), (edges.2, edges.0)] {
            let dp = dot(p - t.0, normal), dq = dot(q - t.0, normal)
            guard (dp < 0 && dq > 0) || (dp > 0 && dq < 0) else { continue }
            let hit = p + (q - p) * (dp / (dp - dq))
            // Inside when the hit is on the inner side of all three edges.
            let s0 = dot(cross(t.1 - t.0, hit - t.0), normal)
            let s1 = dot(cross(t.2 - t.1, hit - t.1), normal)
            let s2 = dot(cross(t.0 - t.2, hit - t.2), normal)
            if s0 >= 0 && s1 >= 0 && s2 >= 0 { return true }
        }
        return false
    }
}
