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
}

/// Everything an exporter needs, and nothing else. Both the VRM and FBX writers
/// consume exactly this, so the two files always describe the same avatar.
public struct ExportSnapshot: Sendable {
    public let avatarName: String
    public let templateID: String
    public let templateVersion: String
    public let skeleton: Skeleton
    public let mesh: MeshData
    public let albedo: PNG.Image
    /// Relative path the material points at inside the export package.
    public let albedoRelativePath: String

    public init(avatarName: String, templateID: String, templateVersion: String,
                skeleton: Skeleton, mesh: MeshData, albedo: PNG.Image,
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
    public func validate() -> RigGate.Report {
        RigGate.check(skeleton: skeleton, mesh: mesh.rigGateBinding(boneCount: skeleton.count))
    }
}
