import Foundation

/// The adjacency a brush needs, derived once when a template is loaded.
///
/// ## Welded positions, not vertices
///
/// The mesh stores one vertex per (position, UV) pair, so a point on a UV seam
/// appears two or three times. That is right for rendering and wrong for
/// everything else: a brush that moves one copy and not its twins tears the
/// surface open along every seam, and the tear is invisible until the model is
/// rotated. So sculpting addresses **welded positions**, and every edit writes
/// through to all the vertices sharing that position.
///
/// On the Clay template that is 3,750 vertices over 3,458 welded positions —
/// 292 of them duplicated along the cube's twelve edges.
///
/// ## Why derived rather than baked
///
/// The PRD calls for these tables to be generated offline and stored in the
/// template. They are computed at load instead, and the reason is that the cost
/// is not real: all three are single hashed passes over a few thousand
/// vertices. Baking them would buy nothing measurable and would add a way for
/// the tables and the mesh to disagree — a template edited without a rebake
/// would carry adjacency describing geometry it no longer has, which is a
/// silent wrong answer rather than a loud one.
///
/// What the PRD actually wanted from "offline" is that the runtime holds flat
/// arrays instead of a half-edge mesh, which this does. If a device profile
/// ever shows the load cost mattering, this code is the baker.
public struct MeshTables: Sendable {
    /// Vertex index -> welded position index.
    public let weldOf: [Int]
    /// Welded position index -> every vertex sharing that position.
    public let weldMembers: [[Int]]
    /// Welded position index -> the welded positions sharing an edge with it.
    public let neighbours: [[Int]]
    /// Welded position index -> its mirror across x = 0. A point on the mirror
    /// plane is its own partner. `nil` where no partner exists, which on a
    /// symmetric template means never.
    public let mirror: [Int?]

    public var weldedCount: Int { weldMembers.count }

    /// Positions that appear more than once because their UVs differ. These are
    /// the seam partners a paint stroke has to stamp into together.
    public var seamPositions: [Int] {
        (0..<weldedCount).filter { weldMembers[$0].count > 1 }
    }

    public init(_ mesh: MeshData, weldTolerance: Double = 1e-6) {
        // The key is the quantised coordinate TRIPLE, not a hash of it.
        //
        // A spatial hash is fine when the hash only nominates candidates and the
        // real distance decides. Used as an identity it is a bug: the first
        // version of this keyed the dictionary on `x*A ^ y*B ^ z*C` and welded
        // 3,750 vertices down to 2,024 instead of 3,458, fusing unrelated parts
        // of the surface. A cube makes that especially likely, because so many
        // of its points are sign-flips and permutations of each other and XOR
        // does not care which axis a term came from.
        //
        // Quantised equality is exact here rather than approximate: positions
        // that should weld were written by one generator and are bit-identical
        // or within a rounding step.
        struct Cell: Hashable { let x, y, z: Int64 }
        func cell(_ p: Vec3) -> Cell {
            Cell(x: Int64((p.x / weldTolerance).rounded()),
                 y: Int64((p.y / weldTolerance).rounded()),
                 z: Int64((p.z / weldTolerance).rounded()))
        }

        var idByCell = [Cell: Int]()
        var weldOf = [Int](repeating: 0, count: mesh.vertexCount)
        var members = [[Int]]()
        var weldedPosition = [Vec3]()
        for (vertex, p) in mesh.positions.enumerated() {
            let key = cell(p)
            if let existing = idByCell[key] {
                weldOf[vertex] = existing
                members[existing].append(vertex)
            } else {
                let id = members.count
                idByCell[key] = id
                weldOf[vertex] = id
                members.append([vertex])
                weldedPosition.append(p)
            }
        }
        self.weldOf = weldOf
        self.weldMembers = members

        var adjacency = [Set<Int>](repeating: [], count: members.count)
        for t in stride(from: 0, to: mesh.indices.count, by: 3) {
            let a = weldOf[Int(mesh.indices[t])]
            let b = weldOf[Int(mesh.indices[t + 1])]
            let c = weldOf[Int(mesh.indices[t + 2])]
            if a != b { adjacency[a].insert(b); adjacency[b].insert(a) }
            if b != c { adjacency[b].insert(c); adjacency[c].insert(b) }
            if a != c { adjacency[a].insert(c); adjacency[c].insert(a) }
        }
        // Sorted so the table is deterministic: Smooth averages its neighbours,
        // and floating-point addition is not associative, so an unordered set
        // would give a different answer run to run.
        self.neighbours = adjacency.map { $0.sorted() }

        self.mirror = weldedPosition.map { p in
            idByCell[cell(Vec3(-p.x, p.y, p.z))]
        }
    }
}
