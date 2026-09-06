import Foundation
import HumanoidCore
import UfbxWriteC

/// Writes binary FBX 7.4 through `ufbx-write`.
///
/// This is the second output, and the only one that needs no extra Unity
/// package: the user drags the file in, sets Humanoid, and presses Apply. It
/// hedges the VRM route's single unverified link (whether the VRChat SDK accepts
/// a UniVRM-built avatar), and VRM hedges this one (whether Unity's importer is
/// happy with ufbx-write's semantics, which nobody has published a test of).
///
/// Decisions and why, each traceable to the research in
/// docs/humanoid-creator-validation/REPORT.md:
///
/// - **FBX 7400, not 7500.** Blender ships 7400 and Unity's Autodesk-based
///   importer has consumed it for a decade. 7500 differs only in node-header
///   width, but there is no reason to be the first to test it here.
/// - **Every bone is a LimbNode.** `UFBXW_BONE_ROOT` on a skinned bone makes
///   both Blender importers drop that bone silently; found by probe, and the
///   same shape as upstream issue #30. The armature is a plain node.
/// - **An explicit BindPose is always written.** Assimp omits it deliberately;
///   Blender always writes one, and Blender's output is what Unity is known to
///   accept.
/// - **Metres with UnitScaleFactor 100.** ufbx-write documents the factor as
///   "scale of a single unit in centimetres", so 100 means one unit is one
///   metre. This keeps the FBX numerically identical to the VRM instead of
///   introducing a x100 conversion that could disagree between the two files.
public enum FBXExporter {
    public enum Failure: Error, CustomStringConvertible {
        case preflightFailed(RigGate.Report)
        case saveFailed(String)

        public var description: String {
            switch self {
            case .preflightFailed(let r): return "FBX export refused; rig gate did not pass:\n\(r.summary)"
            case .saveFailed(let m): return "FBX export: ufbx-write failed — \(m)"
            }
        }
    }

    public struct Options: Sendable {
        public var version: UInt32 = 7400
        /// Pinned so the output is byte-identical run to run. ufbx-write derives
        /// the FileId and footer hash from the creation time, so leaving it at
        /// "now" would make every export differ.
        public var timestamp: (year: Int32, month: Int32, day: Int32,
                               hour: Int32, minute: Int32, second: Int32) = (2026, 1, 1, 0, 0, 0)
        public init() {}
    }

    public static func export(_ snapshot: ExportSnapshot, to url: URL,
                              options: Options = Options()) throws {
        let report = snapshot.validate()
        guard report.passes else { throw Failure.preflightFailed(report) }
        try write(snapshot, to: url, options: options)
    }

    static func write(_ snapshot: ExportSnapshot, to url: URL, options: Options) throws {
        let skeleton = snapshot.skeleton
        let mesh = snapshot.mesh

        guard let scene = ufbxw_create_scene(nil) else {
            throw Failure.saveFailed("could not create a scene")
        }
        defer { ufbxw_free_scene(scene) }

        // Right-handed, Y up, +Z front: the same frame the mesh data is authored
        // in, so no conversion happens on the way out.
        var axes = ufbxw_coordinate_axes()
        axes.right = UFBXW_COORDINATE_AXIS_POSITIVE_X
        axes.up = UFBXW_COORDINATE_AXIS_POSITIVE_Y
        axes.front = UFBXW_COORDINATE_AXIS_POSITIVE_Z
        ufbxw_scene_set_coordinate_axes(scene, axes)
        ufbxw_scene_set_unit_scale_factor(scene, 100.0)

        // --- Skeleton ---------------------------------------------------------
        // Skipped entirely when the document has no rig. An unrigged export must
        // carry no armature node, no bones, no skin deformer and no bind pose:
        // an empty armature is not "harmless extra structure", it is a stray
        // root that Unity and Blender both surface in the hierarchy and that
        // some importers treat as a skinned mesh with zero influences.
        var nodeByBone = [HumanBone: ufbxw_node]()
        var armature: ufbxw_node?
        if let skeleton {
            let root = ufbxw_create_node(scene)
            ufbxw_set_name(scene, root.id, "Armature")
            armature = root
            for spec in skeleton.bones {
                let node = ufbxw_create_node(scene)
                ufbxw_set_name(scene, node.id, spec.bone.unityNodeName)
                let local = skeleton.restLocal(of: spec.bone)!.translation
                ufbxw_node_set_translation(scene, node, ufbxw_vec3(x: local.x, y: local.y, z: local.z))
                ufbxw_node_set_parent(scene, node, spec.parent.map { nodeByBone[$0]! } ?? root)
                // LIMB_NODE for every skinned bone. See the note above on BONE_ROOT.
                ufbxw_create_bone(scene, UFBXW_BONE_LIMB_NODE, node)
                nodeByBone[spec.bone] = node
            }
        }

        // --- Mesh -------------------------------------------------------------
        let meshNode = ufbxw_create_node(scene)
        ufbxw_set_name(scene, meshNode.id, "Body")
        let fbxMesh = ufbxw_create_mesh(scene)
        ufbxw_set_name(scene, fbxMesh.id, snapshot.avatarName)
        ufbxw_mesh_add_instance(scene, fbxMesh, meshNode)

        var positions = mesh.positions.map { ufbxw_vec3(x: $0.x, y: $0.y, z: $0.z) }
        var normals = mesh.normals.map { ufbxw_vec3(x: $0.x, y: $0.y, z: $0.z) }
        var uvs = mesh.uvs.map { ufbxw_vec2(x: $0.x, y: $0.y) }
        var indices = mesh.indices.map { Int32($0) }

        ufbxw_mesh_set_vertices(scene, fbxMesh, ufbxw_copy_vec3_array(scene, &positions, positions.count))
        ufbxw_mesh_set_triangles(scene, fbxMesh, ufbxw_copy_int_array(scene, &indices, indices.count))
        ufbxw_mesh_set_normals(scene, fbxMesh, ufbxw_copy_vec3_array(scene, &normals, normals.count),
                               UFBXW_ATTRIBUTE_MAPPING_VERTEX)
        ufbxw_mesh_set_uvs(scene, fbxMesh, 0, ufbxw_copy_vec2_array(scene, &uvs, uvs.count),
                           UFBXW_ATTRIBUTE_MAPPING_VERTEX)

        // --- Material and texture ---------------------------------------------
        let material = ufbxw_create_material(scene, UFBXW_MATERIAL_FBX_LAMBERT)
        ufbxw_set_name(scene, material.id, "Skin")
        ufbxw_set_vec3(scene, material.id, "DiffuseColor", ufbxw_vec3(x: 1, y: 1, z: 1))
        let texture = ufbxw_create_texture(scene, UFBXW_TEXTURE_FILE)
        ufbxw_set_name(scene, texture.id, "Albedo")
        snapshot.albedoRelativePath.withCString {
            ufbxw_texture_set_relative_filename(scene, texture, $0)
        }
        ufbxw_material_set_texture(scene, material, "DiffuseColor", texture)
        ufbxw_node_set_material(scene, meshNode, 0, material)
        ufbxw_mesh_set_single_material(scene, fbxMesh, 0)

        // --- Skin and bind pose -------------------------------------------------
        if let skeleton, let armature {
        let skin = ufbxw_create_skin_deformer(scene, fbxMesh)
        ufbxw_skin_deformer_set_skinning_type(scene, skin, UFBXW_SKINNING_TYPE_LINEAR)

        // Group each bone's weights into the flat index/weight arrays a cluster
        // wants. The mesh is in bind pose, so the cluster's own transform (the
        // mesh's world transform at bind time) is identity and its link
        // transform is the bone's world rest transform.
        var perBone = [Int: (indices: [Int32], weights: [Double])]()
        for (vertex, influences) in mesh.influences.enumerated() {
            for influence in influences where influence.weight > 0 {
                perBone[influence.bone, default: ([], [])].indices.append(Int32(vertex))
                perBone[influence.bone, default: ([], [])].weights.append(influence.weight)
            }
        }

        for (boneIndex, spec) in skeleton.bones.enumerated() {
            let node = nodeByBone[spec.bone]!
            let cluster = ufbxw_create_skin_cluster(scene, skin, node)
            ufbxw_set_name(scene, cluster.id, spec.bone.unityNodeName)

            if var entry = perBone[boneIndex], !entry.indices.isEmpty {
                ufbxw_skin_cluster_set_weights(
                    scene, cluster,
                    ufbxw_copy_int_array(scene, &entry.indices, entry.indices.count),
                    ufbxw_copy_real_array(scene, &entry.weights, entry.weights.count))
            }

            var restGlobal = skeleton.restGlobal(of: spec.bone)!.m
            ufbxw_skin_cluster_set_transform(scene, cluster, ufbxw_identity_matrix)
            ufbxw_skin_cluster_set_link_transform(scene, cluster,
                                                  hc_ufbxw_matrix(&restGlobal))
        }

        // --- Bind pose ---------------------------------------------------------
        // Written explicitly rather than left to prepare_scene: Unity's importer
        // warns about an incomplete bind pose when ancestors are missing, so the
        // mesh node and the armature go in alongside every bone.
        let pose = ufbxw_create_bind_pose(scene)
        ufbxw_bind_pose_add_node(scene, pose, meshNode, ufbxw_identity_matrix)
        ufbxw_bind_pose_add_node(scene, pose, armature, ufbxw_identity_matrix)
        for spec in skeleton.bones {
            var restGlobal = skeleton.restGlobal(of: spec.bone)!.m
            ufbxw_bind_pose_add_node(scene, pose, nodeByBone[spec.bone]!,
                                     hc_ufbxw_matrix(&restGlobal))
        }
        ufbxw_skin_deformer_set_bind_pose(scene, skin, pose)
        }

        // --- Save --------------------------------------------------------------
        var prepareOpts = ufbxw_default_prepare_opts
        ufbxw_prepare_scene(scene, &prepareOpts)

        var saveOpts = ufbxw_save_opts()
        saveOpts.format = UFBXW_SAVE_FORMAT_BINARY
        saveOpts.version = options.version
        saveOpts.no_default_timestamp = true
        saveOpts.local_timestamp = ufbxw_datetime(
            year: options.timestamp.year, month: options.timestamp.month,
            day: options.timestamp.day, hour: options.timestamp.hour,
            minute: options.timestamp.minute, second: options.timestamp.second,
            millisecond: 0)

        var error = ufbxw_error()
        let ok = url.path.withCString { ufbxw_save_file(scene, $0, &saveOpts, &error) }
        guard ok else { throw Failure.saveFailed(describe(error)) }
    }

    /// `ufbxw_error.description` is a fixed-size char array, which Swift imports
    /// as a large tuple rather than a pointer.
    static func describe(_ error: ufbxw_error) -> String {
        var copy = error
        return withUnsafeBytes(of: &copy.description) { raw in
            let bytes = raw.bindMemory(to: CChar.self)
            guard let base = bytes.baseAddress else { return "unknown error" }
            return String(cString: base)
        }
    }
}
