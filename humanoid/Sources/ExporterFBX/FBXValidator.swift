import Foundation
import HumanoidCore
import UfbxC

/// Reopens a written FBX with ufbx and compares it against the snapshot it came
/// from.
///
/// This is the PRD's "reopen with ufbx" gate, and it is the strongest automated
/// check available on Linux. It is necessary but not sufficient: ufbx is a
/// different implementation from Unity's Autodesk-based importer and is lenient
/// by default, so a file can round-trip here and still be rejected on the Mac.
/// It catches the failure class that matters most, though — transform-space
/// inconsistency between the four places bind data lives, which the research
/// identified as the commonest reason a self-written FBX imports and skins wrong.
public enum FBXValidator {
    public struct Result: Sendable {
        public var problems: [String] = []
        public var version: UInt32 = 0
        public var meshCount = 0
        public var boneCount = 0
        public var clusterCount = 0
        public var poseCount = 0
        public var vertexCount = 0
        public var maxWeightsPerVertex = 0
        public var materialCount = 0
        public var textureCount = 0
        public var passes: Bool { problems.isEmpty }

        public var summary: String {
            let head = "fbx reopen: version=\(version) meshes=\(meshCount) bones=\(boneCount) " +
                       "clusters=\(clusterCount) poses=\(poseCount) verts=\(vertexCount) " +
                       "maxWeights=\(maxWeightsPerVertex) materials=\(materialCount) textures=\(textureCount)"
            return problems.isEmpty ? head + "  OK"
                : ([head + "  FAILED"] + problems.map { "  - " + $0 }).joined(separator: "\n")
        }
    }

    public static func validate(_ url: URL, against snapshot: ExportSnapshot,
                                positionTolerance: Double = 1e-5) -> Result {
        var result = Result()

        var opts = ufbx_load_opts()
        var error = ufbx_error()
        guard let scenePointer = url.path.withCString({ ufbx_load_file($0, &opts, &error) }) else {
            result.problems.append("ufbx could not load the file back")
            return result
        }
        defer { ufbx_free_scene(scenePointer) }
        let scene = scenePointer.pointee

        result.version = scene.metadata.version
        result.meshCount = Int(scene.meshes.count)
        result.boneCount = Int(scene.bones.count)
        result.clusterCount = Int(scene.skin_clusters.count)
        result.poseCount = Int(scene.poses.count)
        result.materialCount = Int(scene.materials.count)
        result.textureCount = Int(scene.textures.count)

        let skeleton = snapshot.skeleton

        if result.meshCount != 1 {
            result.problems.append("expected exactly 1 mesh, found \(result.meshCount); VRChat's mobile Good tier allows one skinned mesh")
        }
        if result.boneCount != skeleton.count {
            result.problems.append("expected \(skeleton.count) bones, found \(result.boneCount)")
        }
        if result.clusterCount != skeleton.count {
            result.problems.append("expected one skin cluster per bone (\(skeleton.count)), found \(result.clusterCount)")
        }
        if result.poseCount < 1 {
            result.problems.append("no BindPose written; Unity warns about an incomplete bind pose and Assimp's omission of it is the known outlier")
        }
        if result.materialCount != 1 {
            result.problems.append("expected 1 material, found \(result.materialCount)")
        }

        if scene.meshes.count > 0, let mesh = scene.meshes.data[0] {
            result.vertexCount = Int(mesh.pointee.num_vertices)
            if result.vertexCount != snapshot.mesh.vertexCount {
                result.problems.append("vertex count changed through the writer: \(snapshot.mesh.vertexCount) in, \(result.vertexCount) back")
            }
            for d in 0..<Int(mesh.pointee.skin_deformers.count) {
                if let deformer = mesh.pointee.skin_deformers.data[d] {
                    result.maxWeightsPerVertex = max(result.maxWeightsPerVertex,
                                                     Int(deformer.pointee.max_weights_per_vertex))
                }
            }
            if result.maxWeightsPerVertex > 4 {
                result.problems.append("\(result.maxWeightsPerVertex) influences per vertex; Unity's BoneWeight holds four")
            }

            // Positions must survive unchanged. The mesh is authored in metres
            // and written in metres with UnitScaleFactor 100, so no scaling
            // should have happened anywhere in between.
            let vertices = mesh.pointee.vertices
            if Int(vertices.count) == snapshot.mesh.vertexCount {
                var worst = 0.0
                var worstIndex = -1
                for i in 0..<snapshot.mesh.vertexCount {
                    let v = vertices.data[i]
                    let expected = snapshot.mesh.positions[i]
                    let d = length(Vec3(v.x, v.y, v.z) - expected)
                    if d > worst { worst = d; worstIndex = i }
                }
                if worst > positionTolerance {
                    result.problems.append(String(format: "vertex %d moved %.6f m through the round trip (tolerance %.0e) — check units and axes",
                                                  worstIndex, worst, positionTolerance))
                }
            } else {
                result.problems.append("could not compare positions: ufbx returned \(vertices.count) control points")
            }
        }

        // The invariant that keeps skinning correct: each cluster's link
        // transform (the bone's world transform at bind time) must equal the
        // bone's rest transform in the node hierarchy. When these disagree the
        // file still imports, and the avatar is skinned wrong.
        var seen = Set<String>()
        for c in 0..<Int(scene.skin_clusters.count) {
            guard let cluster = scene.skin_clusters.data[c] else { continue }
            guard let boneNode = cluster.pointee.bone_node else {
                result.problems.append("skin cluster \(c) has no bone node")
                continue
            }
            let name = String(cString: boneNode.pointee.name.data)
            seen.insert(name)
            guard let bone = HumanBone.allCases.first(where: { $0.unityNodeName == name }),
                  let rest = skeleton.restGlobal(of: bone) else {
                result.problems.append("cluster bound to unknown bone '\(name)'")
                continue
            }
            let bind = cluster.pointee.bind_to_world
            let bindTranslation = Vec3(bind.cols.3.x, bind.cols.3.y, bind.cols.3.z)
            let drift = length(bindTranslation - rest.translation)
            if drift > positionTolerance {
                result.problems.append(String(format: "%@: cluster bind pose is %.6f m from the node rest pose; rest and bind must be identical",
                                              name, drift))
            }
        }
        for spec in skeleton.bones where !seen.contains(spec.bone.unityNodeName) {
            result.problems.append("\(spec.bone.unityNodeName) has no skin cluster")
        }

        return result
    }
}
