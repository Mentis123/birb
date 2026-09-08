import Foundation

/// Fixed-topology mesh data. Array sizes and ordering are part of the template
/// contract: editing moves vertices, it never adds, removes or reorders them.
public struct MeshData: Sendable {
    public var positions: [Vec3]
    public var normals: [Vec3]
    public var uvs: [Vec2]
    /// Triangle list, three indices per face.
    public let indices: [UInt32]
    /// Up to four (bone, weight) pairs per vertex, normalised and sorted
    /// descending — the layout Unity's `BoneWeight` requires.
    public let influences: [[Influence]]

    public struct Influence: Sendable, Equatable {
        public let bone: Int
        public let weight: Double
        public init(bone: Int, weight: Double) {
            self.bone = bone
            self.weight = weight
        }
    }

    public var vertexCount: Int { positions.count }
    public var triangleCount: Int { indices.count / 3 }

    public init(positions: [Vec3], normals: [Vec3], uvs: [Vec2], indices: [UInt32], influences: [[Influence]]) {
        precondition(normals.count == positions.count, "one normal per vertex")
        precondition(uvs.count == positions.count, "one uv per vertex")
        precondition(influences.count == positions.count, "one influence set per vertex")
        precondition(indices.count % 3 == 0, "triangle list")
        self.positions = positions
        self.normals = normals
        self.uvs = uvs
        self.indices = indices
        self.influences = influences
    }

    /// The gate's view of the skin binding.
    public func rigGateBinding(boneCount: Int) -> RigGate.MeshBinding {
        RigGate.MeshBinding(
            influences: influences.map { $0.map { (bone: $0.bone, weight: $0.weight) } },
            boneCount: boneCount)
    }

    /// Recomputes area-weighted vertex normals in place. Called after any edit
    /// that moves vertices.
    ///
    /// Accumulating per *vertex* is wrong wherever the mesh has a UV seam: the
    /// two or three copies of a seam point each see only the triangles on their
    /// own island, so they end up with different normals for the same place on
    /// the surface and the shading creases along every seam. On the cube that
    /// is all twelve edges. Prefer `recomputeNormals(_:touching:)`, which welds;
    /// this form is kept for the generators, which build a mesh before any
    /// tables exist for it.
    public mutating func recomputeNormals() {
        var acc = [Vec3](repeating: .zero, count: positions.count)
        for t in stride(from: 0, to: indices.count, by: 3) {
            let a = Int(indices[t]), b = Int(indices[t + 1]), c = Int(indices[t + 2])
            // Un-normalised cross product is already area-weighted.
            let n = cross(positions[b] - positions[a], positions[c] - positions[a])
            acc[a] += n; acc[b] += n; acc[c] += n
        }
        normals = acc.map { normalize($0) }
    }

    /// Recomputes normals across welded positions, optionally only where the
    /// surface moved.
    ///
    /// **Welded**: every vertex sharing a position gets the same normal, summed
    /// over every triangle touching that position on any island. That is what
    /// makes a seam invisible.
    ///
    /// **Incremental**: pass the welded set a brush returned and only those
    /// points and their one-ring are redone — a vertex normal depends on the
    /// triangles it touches, so moving a point dirties exactly the corners of
    /// its incident faces. The full pass is 0.06 ms on today's Clay and would be
    /// four times that at 48 divisions; this keeps the cost proportional to the
    /// brush rather than to the model.
    public mutating func recomputeNormals(_ tables: MeshTables, touching moved: Set<Int>? = nil) {
        guard let moved else { return recomputeNormalsWelded(tables) }
        guard !moved.isEmpty else { return }

        // Faces whose shape changed, then every welded corner of those faces:
        // those are the only normals that can have moved.
        var dirtyFaces = Set<Int32>()
        for w in moved { dirtyFaces.formUnion(tables.trianglesOfWelded[w]) }
        var dirty = moved
        for face in dirtyFaces {
            let t = Int(face) * 3
            dirty.insert(tables.weldOf[Int(indices[t])])
            dirty.insert(tables.weldOf[Int(indices[t + 1])])
            dirty.insert(tables.weldOf[Int(indices[t + 2])])
        }
        for w in dirty { writeNormal(w, tables) }
    }

    private mutating func recomputeNormalsWelded(_ tables: MeshTables) {
        var acc = [Vec3](repeating: .zero, count: tables.weldedCount)
        for t in stride(from: 0, to: indices.count, by: 3) {
            let a = Int(indices[t]), b = Int(indices[t + 1]), c = Int(indices[t + 2])
            let n = cross(positions[b] - positions[a], positions[c] - positions[a])
            acc[tables.weldOf[a]] += n
            acc[tables.weldOf[b]] += n
            acc[tables.weldOf[c]] += n
        }
        for w in 0..<tables.weldedCount {
            let n = normalize(acc[w])
            for member in tables.weldMembers[w] { normals[member] = n }
        }
    }

    /// One welded position's normal, summed over every face touching it.
    private mutating func writeNormal(_ welded: Int, _ tables: MeshTables) {
        var acc = Vec3.zero
        for face in tables.trianglesOfWelded[welded] {
            let t = Int(face) * 3
            let a = Int(indices[t]), b = Int(indices[t + 1]), c = Int(indices[t + 2])
            acc += cross(positions[b] - positions[a], positions[c] - positions[a])
        }
        let n = normalize(acc)
        for member in tables.weldMembers[welded] { normals[member] = n }
    }
}

/// Everything an exporter needs, and nothing else. Both the VRM and FBX writers
/// consume exactly this, so the two files always describe the same avatar.
public struct ExportSnapshot: Sendable {
    public let avatarName: String
    public let templateID: String
    public let templateVersion: String
    /// Absent for an unrigged document. Optional rather than a zero-bone
    /// skeleton on purpose: an empty rig would put `if boneCount > 0` through
    /// the skinning, export and validation paths, and each of those is a place
    /// to be silently wrong. Absent makes the rig-shaped code unreachable.
    public let skeleton: Skeleton?
    public let mesh: MeshData
    public let albedo: PNG.Image
    /// Relative path the material points at inside the export package.
    public let albedoRelativePath: String

    public var isRigged: Bool { skeleton != nil }

    public init(avatarName: String, templateID: String, templateVersion: String,
                skeleton: Skeleton?, mesh: MeshData, albedo: PNG.Image,
                albedoRelativePath: String) {
        self.avatarName = avatarName
        self.templateID = templateID
        self.templateVersion = templateVersion
        self.skeleton = skeleton
        self.mesh = mesh
        self.albedo = albedo
        self.albedoRelativePath = albedoRelativePath
    }

    /// Runs the full pre-flight. Export refuses on any error.
    ///
    /// The mesh gate always runs. The rig gate runs only when there is a rig,
    /// so an unrigged document is never told it is missing bones.
    public func validate() -> Gate.Report {
        var reports = [MeshGate.check(mesh, requiresSkin: isRigged)]
        if let skeleton {
            reports.append(RigGate.check(skeleton: skeleton,
                                         mesh: mesh.rigGateBinding(boneCount: skeleton.count)))
        }
        return Gate.Report.merge(reports, label: isRigged ? "export pre-flight"
                                                          : "export pre-flight (unrigged)")
    }
}
