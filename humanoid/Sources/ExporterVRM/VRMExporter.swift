import Foundation
import HumanoidCore

/// Writes VRM 1.0, the project's primary export.
///
/// A .vrm is a glTF 2.0 binary (GLB) carrying a `VRMC_vrm` extension whose
/// `humanoid.humanBones` block is an EXPLICIT bone-name to node-index table.
/// That table is why this format leads: UniVRM's importer feeds it straight to
/// `AvatarBuilder.BuildHumanAvatar`, so the Unity Humanoid is produced
/// deterministically with no Configure step and none of the auto-mapper's name
/// and hierarchy heuristics in the way.
///
/// Everything here is verifiable on Linux: the Khronos glTF validator checks the
/// container and the skin, and the VRM JSON schema checks the extension. The one
/// thing no local oracle can settle is whether the VRChat SDK accepts the
/// resulting avatar, which is the M1 session's job.
public enum VRMExporter {
    public struct Metadata: Sendable {
        public var authors: [String]
        public var licenseUrl: String
        public init(authors: [String] = ["Birb Humanoid Creator"],
                    licenseUrl: String = "https://vrm.dev/licenses/1.0/") {
            self.authors = authors
            self.licenseUrl = licenseUrl
        }
    }

    public enum Failure: Error, CustomStringConvertible {
        case preflightFailed(RigGate.Report)
        case tooManyJoints(Int)

        public var description: String {
            switch self {
            case .preflightFailed(let r): return "VRM export refused; rig gate did not pass:\n\(r.summary)"
            case .tooManyJoints(let n): return "VRM export: \(n) joints exceeds the 255 addressable by an unsigned-byte JOINTS_0"
            }
        }
    }

    /// Encodes the snapshot as a GLB. Runs the rig gate first and refuses on any
    /// error: shipping a file the gate rejects would burn a Mac session.
    public static func export(_ snapshot: ExportSnapshot, metadata: Metadata = Metadata()) throws -> Data {
        let report = snapshot.validate()
        guard report.passes else { throw Failure.preflightFailed(report) }
        guard snapshot.skeleton.count <= 255 else { throw Failure.tooManyJoints(snapshot.skeleton.count) }
        return try encode(snapshot, metadata: metadata)
    }

    // MARK: - GLB assembly

    static func encode(_ snapshot: ExportSnapshot, metadata: Metadata) throws -> Data {
        let skeleton = snapshot.skeleton
        let mesh = snapshot.mesh

        var bin = Data()
        var bufferViews = [[String: Any]]()
        var accessors = [[String: Any]]()

        /// Appends bytes as their own bufferView, 4-byte aligned. One view per
        /// accessor keeps `byteStride` out of the file entirely, which also
        /// sidesteps the validator's SKIN_IBM_ACCESSOR_WITH_BYTESTRIDE rule.
        func addBufferView(_ bytes: Data, target: Int? = nil) -> Int {
            while bin.count % 4 != 0 { bin.append(0) }
            var view: [String: Any] = ["buffer": 0, "byteOffset": bin.count, "byteLength": bytes.count]
            if let target { view["target"] = target }
            bin.append(bytes)
            bufferViews.append(view)
            return bufferViews.count - 1
        }

        func addAccessor(view: Int, componentType: Int, count: Int, type: String,
                         min: [Double]? = nil, max: [Double]? = nil) -> Int {
            var a: [String: Any] = ["bufferView": view, "componentType": componentType,
                                    "count": count, "type": type]
            if let min { a["min"] = min }
            if let max { a["max"] = max }
            accessors.append(a)
            return accessors.count - 1
        }

        // --- Vertex attributes -------------------------------------------------
        let arrayBuffer = 34962, elementBuffer = 34963
        let float = 5126, unsignedByte = 5121, unsignedInt = 5125

        var positionBytes = Data()
        var lo = Vec3(.infinity, .infinity, .infinity)
        var hi = Vec3(-.infinity, -.infinity, -.infinity)
        for p in mesh.positions {
            positionBytes.appendLittleEndian(Float(p.x))
            positionBytes.appendLittleEndian(Float(p.y))
            positionBytes.appendLittleEndian(Float(p.z))
            lo = Vec3(Swift.min(lo.x, p.x), Swift.min(lo.y, p.y), Swift.min(lo.z, p.z))
            hi = Vec3(Swift.max(hi.x, p.x), Swift.max(hi.y, p.y), Swift.max(hi.z, p.z))
        }
        // POSITION is the one accessor the spec REQUIRES min/max on.
        let positionAccessor = addAccessor(
            view: addBufferView(positionBytes, target: arrayBuffer),
            componentType: float, count: mesh.vertexCount, type: "VEC3",
            min: [Double(Float(lo.x)), Double(Float(lo.y)), Double(Float(lo.z))],
            max: [Double(Float(hi.x)), Double(Float(hi.y)), Double(Float(hi.z))])

        var normalBytes = Data()
        for n in mesh.normals {
            normalBytes.appendLittleEndian(Float(n.x))
            normalBytes.appendLittleEndian(Float(n.y))
            normalBytes.appendLittleEndian(Float(n.z))
        }
        let normalAccessor = addAccessor(view: addBufferView(normalBytes, target: arrayBuffer),
                                         componentType: float, count: mesh.vertexCount, type: "VEC3")

        var uvBytes = Data()
        for uv in mesh.uvs {
            uvBytes.appendLittleEndian(Float(uv.x))
            uvBytes.appendLittleEndian(Float(uv.y))
        }
        let uvAccessor = addAccessor(view: addBufferView(uvBytes, target: arrayBuffer),
                                     componentType: float, count: mesh.vertexCount, type: "VEC2")

        var jointBytes = Data()
        var weightBytes = Data()
        for influences in mesh.influences {
            for slot in 0..<4 {
                // Unused slots must be joint 0 with weight 0; a non-zero joint
                // index paired with a zero weight trips the validator.
                let inf = slot < influences.count ? influences[slot] : nil
                jointBytes.append(UInt8(inf?.bone ?? 0))
            }
            for slot in 0..<4 {
                let inf = slot < influences.count ? influences[slot] : nil
                weightBytes.appendLittleEndian(Float(inf?.weight ?? 0))
            }
        }
        let jointAccessor = addAccessor(view: addBufferView(jointBytes, target: arrayBuffer),
                                        componentType: unsignedByte, count: mesh.vertexCount, type: "VEC4")
        let weightAccessor = addAccessor(view: addBufferView(weightBytes, target: arrayBuffer),
                                         componentType: float, count: mesh.vertexCount, type: "VEC4")

        var indexBytes = Data()
        for i in mesh.indices { indexBytes.appendLittleEndian(i) }
        let indexAccessor = addAccessor(view: addBufferView(indexBytes, target: elementBuffer),
                                        componentType: unsignedInt, count: mesh.indices.count, type: "SCALAR")

        // --- Nodes -------------------------------------------------------------
        // Node 0 is the armature root. Every joint hangs beneath it, giving the
        // skin the common root glTF requires, and it keeps Hips from being the
        // scene root (which Unity rejects outright).
        var nodes: [[String: Any]] = [["name": "Armature"]]
        var nodeIndexByBone = [HumanBone: Int]()
        for spec in skeleton.bones {
            let local = skeleton.restLocal(of: spec.bone)!.translation
            nodes.append([
                "name": spec.bone.unityNodeName,
                "translation": [Double(Float(local.x)), Double(Float(local.y)), Double(Float(local.z))],
            ])
            nodeIndexByBone[spec.bone] = nodes.count - 1
        }
        for spec in skeleton.bones {
            let parentIndex = spec.parent.flatMap { nodeIndexByBone[$0] } ?? 0
            var parent = nodes[parentIndex]
            var children = parent["children"] as? [Int] ?? []
            children.append(nodeIndexByBone[spec.bone]!)
            parent["children"] = children
            nodes[parentIndex] = parent
        }

        var inverseBindBytes = Data()
        for spec in skeleton.bones {
            for value in skeleton.inverseBind(of: spec.bone)!.floats {
                inverseBindBytes.appendLittleEndian(value)
            }
        }
        let inverseBindAccessor = addAccessor(view: addBufferView(inverseBindBytes),
                                              componentType: float, count: skeleton.count, type: "MAT4")

        // The skinned mesh node carries no transform: the spec says a skinned
        // mesh node's own transform must be ignored, and the validator warns
        // when one is present.
        let meshNodeIndex = nodes.count
        nodes.append(["name": "Body", "mesh": 0, "skin": 0])

        // --- Texture and material ---------------------------------------------
        let imageBytes = try PNG.encode(snapshot.albedo)
        let imageView = addBufferView(imageBytes)

        // --- JSON --------------------------------------------------------------
        var humanBones = [String: Any]()
        for spec in skeleton.bones {
            humanBones[spec.bone.vrmKey] = ["node": nodeIndexByBone[spec.bone]!]
        }

        let gltf: [String: Any] = [
            "asset": ["version": "2.0", "generator": "Birb Humanoid Creator \(snapshot.templateVersion)"],
            "extensionsUsed": ["VRMC_vrm"],
            "scene": 0,
            "scenes": [["nodes": [0, meshNodeIndex]]],
            "nodes": nodes,
            "meshes": [[
                "name": snapshot.avatarName,
                "primitives": [[
                    "attributes": [
                        "POSITION": positionAccessor,
                        "NORMAL": normalAccessor,
                        "TEXCOORD_0": uvAccessor,
                        "JOINTS_0": jointAccessor,
                        "WEIGHTS_0": weightAccessor,
                    ],
                    "indices": indexAccessor,
                    "material": 0,
                    "mode": 4,
                ]],
            ]],
            "skins": [[
                "inverseBindMatrices": inverseBindAccessor,
                "skeleton": 0,
                "joints": skeleton.bones.map { nodeIndexByBone[$0.bone]! },
            ]],
            "materials": [[
                "name": "Skin",
                "doubleSided": false,
                "pbrMetallicRoughness": [
                    "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
                    "baseColorTexture": ["index": 0, "texCoord": 0],
                    "metallicFactor": 0.0,
                    "roughnessFactor": 0.9,
                ],
            ]],
            "textures": [["sampler": 0, "source": 0]],
            "images": [["name": "albedo", "bufferView": imageView, "mimeType": "image/png"]],
            "samplers": [["magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497]],
            "accessors": accessors,
            "bufferViews": bufferViews,
            "buffers": [["byteLength": bin.count]],
            "extensions": [
                "VRMC_vrm": [
                    "specVersion": "1.0",
                    "meta": [
                        "name": snapshot.avatarName,
                        "authors": metadata.authors,
                        "licenseUrl": metadata.licenseUrl,
                    ],
                    "humanoid": ["humanBones": humanBones],
                ],
            ],
        ]

        // Sorted keys make the output byte-identical run to run, which the
        // export manifest's SHA-256 handshake depends on.
        let json = try JSONSerialization.data(withJSONObject: gltf,
                                              options: [.sortedKeys, .withoutEscapingSlashes])
        return assembleGLB(json: json, bin: bin)
    }

    static func assembleGLB(json: Data, bin: Data) -> Data {
        var jsonChunk = json
        while jsonChunk.count % 4 != 0 { jsonChunk.append(0x20) }  // JSON pads with spaces
        var binChunk = bin
        while binChunk.count % 4 != 0 { binChunk.append(0x00) }    // BIN pads with zeros

        var out = Data()
        out.appendLittleEndian(UInt32(0x46546C67))                 // "glTF"
        out.appendLittleEndian(UInt32(2))
        out.appendLittleEndian(UInt32(12 + 8 + jsonChunk.count + 8 + binChunk.count))
        out.appendLittleEndian(UInt32(jsonChunk.count))
        out.appendLittleEndian(UInt32(0x4E4F534A))                 // "JSON"
        out.append(jsonChunk)
        out.appendLittleEndian(UInt32(binChunk.count))
        out.appendLittleEndian(UInt32(0x004E4942))                 // "BIN\0"
        out.append(binChunk)
        return out
    }
}
