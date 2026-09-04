import XCTest
import Foundation
@testable import ExporterVRM
@testable import HumanoidCore

/// These lock down the file-format decisions that are expensive to discover
/// later: a wrong one produces a file that opens somewhere and is subtly wrong
/// in Unity, which costs a Mac session to find.
final class VRMExporterTests: XCTestCase {
    private var glb: Data!
    private var json: [String: Any]!
    private var binOffset: Int!

    override func setUpWithError() throws {
        glb = try VRMExporter.export(Mannequin.snapshot(avatarName: "TestAvatar"))
        let jsonLength = Int(readUInt32(glb, at: 12))
        json = try JSONSerialization.jsonObject(with: glb.subdata(in: 20..<(20 + jsonLength))) as? [String: Any]
        binOffset = 20 + jsonLength + 8
    }

    // MARK: - Container

    func testGLBHeaderIsWellFormed() {
        XCTAssertEqual(readUInt32(glb, at: 0), 0x46546C67, "magic 'glTF'")
        XCTAssertEqual(readUInt32(glb, at: 4), 2, "container version")
        XCTAssertEqual(Int(readUInt32(glb, at: 8)), glb.count, "declared length matches the file")
        XCTAssertEqual(readUInt32(glb, at: 16), 0x4E4F534A, "first chunk must be JSON")
        XCTAssertEqual(readUInt32(glb, at: binOffset - 4), 0x004E4942, "second chunk must be BIN")
        XCTAssertEqual(glb.count % 4, 0, "chunks are 4-byte aligned")
    }

    func testChunksUseTheirSpecifiedPadding() {
        let jsonLength = Int(readUInt32(glb, at: 12))
        XCTAssertEqual(jsonLength % 4, 0)
        // JSON pads with spaces, BIN with zeros.
        XCTAssertTrue(glb[20..<(20 + jsonLength)].reversed().prefix(while: { $0 == 0x20 }).count < 4)
    }

    // MARK: - Skin

    func testSkinJointsShareTheArmatureRoot() throws {
        let skin = try XCTUnwrap((json["skins"] as? [[String: Any]])?.first)
        let joints = try XCTUnwrap(skin["joints"] as? [Int])
        XCTAssertEqual(joints.count, Skeleton.defaultHumanoid().count)
        XCTAssertEqual(skin["skeleton"] as? Int, 0, "the armature node is the common root glTF requires")
        let nodes = try XCTUnwrap(json["nodes"] as? [[String: Any]])
        XCTAssertEqual(nodes[0]["name"] as? String, "Armature")
        XCTAssertFalse(joints.contains(0), "the root itself is not a joint")
    }

    func testInverseBindAccessorIsUnstridedFloatMat4() throws {
        let skin = try XCTUnwrap((json["skins"] as? [[String: Any]])?.first)
        let accessors = try XCTUnwrap(json["accessors"] as? [[String: Any]])
        let ibm = accessors[try XCTUnwrap(skin["inverseBindMatrices"] as? Int)]
        XCTAssertEqual(ibm["componentType"] as? Int, 5126, "FLOAT")
        XCTAssertEqual(ibm["type"] as? String, "MAT4")
        XCTAssertEqual(ibm["count"] as? Int, Skeleton.defaultHumanoid().count)

        let views = try XCTUnwrap(json["bufferViews"] as? [[String: Any]])
        let view = views[try XCTUnwrap(ibm["bufferView"] as? Int)]
        XCTAssertNil(view["byteStride"], "an IBM accessor with a byteStride is a validator error")
    }

    func testSkinnedMeshNodeCarriesNoTransform() throws {
        let nodes = try XCTUnwrap(json["nodes"] as? [[String: Any]])
        let meshNode = try XCTUnwrap(nodes.first { $0["mesh"] != nil })
        // The spec says a skinned mesh node's own transform must be ignored;
        // emitting one earns a validator warning and confuses importers.
        for key in ["translation", "rotation", "scale", "matrix"] {
            XCTAssertNil(meshNode[key], "skinned mesh node should not carry \(key)")
        }
        XCTAssertNotNil(meshNode["skin"])
    }

    func testPositionAccessorCarriesMinAndMax() throws {
        let meshes = try XCTUnwrap(json["meshes"] as? [[String: Any]])
        let primitive = try XCTUnwrap((meshes[0]["primitives"] as? [[String: Any]])?.first)
        let attributes = try XCTUnwrap(primitive["attributes"] as? [String: Int])
        let accessors = try XCTUnwrap(json["accessors"] as? [[String: Any]])
        let position = accessors[try XCTUnwrap(attributes["POSITION"])]
        // POSITION is the one accessor the spec requires bounds on.
        XCTAssertEqual((position["min"] as? [Double])?.count, 3)
        XCTAssertEqual((position["max"] as? [Double])?.count, 3)
    }

    func testUnusedInfluenceSlotsAreJointZeroWithWeightZero() throws {
        // A non-zero joint index paired with a zero weight is a validator error.
        let meshes = try XCTUnwrap(json["meshes"] as? [[String: Any]])
        let primitive = try XCTUnwrap((meshes[0]["primitives"] as? [[String: Any]])?.first)
        let attributes = try XCTUnwrap(primitive["attributes"] as? [String: Int])
        let accessors = try XCTUnwrap(json["accessors"] as? [[String: Any]])
        let views = try XCTUnwrap(json["bufferViews"] as? [[String: Any]])

        let jointAccessor = accessors[try XCTUnwrap(attributes["JOINTS_0"])]
        let weightAccessor = accessors[try XCTUnwrap(attributes["WEIGHTS_0"])]
        XCTAssertEqual(jointAccessor["componentType"] as? Int, 5121, "UNSIGNED_BYTE")
        let jointView = views[try XCTUnwrap(jointAccessor["bufferView"] as? Int)]
        let weightView = views[try XCTUnwrap(weightAccessor["bufferView"] as? Int)]
        let jointBase = binOffset + (jointView["byteOffset"] as! Int)
        let weightBase = binOffset + (weightView["byteOffset"] as! Int)

        let count = try XCTUnwrap(jointAccessor["count"] as? Int)
        for v in 0..<count {
            for slot in 0..<4 {
                let weight = Float(bitPattern: readUInt32(glb, at: weightBase + (v * 4 + slot) * 4))
                if weight == 0 {
                    XCTAssertEqual(glb[jointBase + v * 4 + slot], 0,
                                   "vertex \(v) slot \(slot): zero weight must pair with joint 0")
                }
            }
            let total = (0..<4).reduce(Float(0)) {
                $0 + Float(bitPattern: readUInt32(glb, at: weightBase + (v * 4 + $1) * 4))
            }
            XCTAssertEqual(total, 1.0, accuracy: 1e-5, "vertex \(v) weights must sum to 1")
        }
    }

    // MARK: - VRM extension

    func testVRMExtensionCarriesAnExplicitBoneMap() throws {
        let extensions = try XCTUnwrap(json["extensions"] as? [String: Any])
        let vrm = try XCTUnwrap(extensions["VRMC_vrm"] as? [String: Any])
        XCTAssertEqual(vrm["specVersion"] as? String, "1.0")
        XCTAssertEqual(json["extensionsUsed"] as? [String], ["VRMC_vrm"])

        let meta = try XCTUnwrap(vrm["meta"] as? [String: Any])
        XCTAssertEqual(meta["name"] as? String, "TestAvatar")
        XCTAssertFalse((meta["authors"] as? [String] ?? []).isEmpty, "authors is required and non-empty")
        XCTAssertEqual(meta["licenseUrl"] as? String, "https://vrm.dev/licenses/1.0/")

        let humanBones = try XCTUnwrap((vrm["humanoid"] as? [String: Any])?["humanBones"] as? [String: Any])
        let nodes = try XCTUnwrap(json["nodes"] as? [[String: Any]])
        // This explicit map is the whole reason VRM leads: UniVRM feeds it
        // straight to AvatarBuilder, so no name heuristics are involved.
        for bone in HumanBone.required {
            let entry = try XCTUnwrap(humanBones[bone.vrmKey] as? [String: Any],
                                      "\(bone.vrmKey) missing from humanBones")
            let node = try XCTUnwrap(entry["node"] as? Int)
            XCTAssertEqual(nodes[node]["name"] as? String, bone.unityNodeName)
        }
    }

    func testThumbsUseVRMOneNamesNotUnityNames() throws {
        // VRM 1.0 renamed the thumb chain. Emitting Unity's spelling gives a
        // file UniVRM maps wrongly, and nothing upstream complains.
        let extensions = try XCTUnwrap(json["extensions"] as? [String: Any])
        let vrm = try XCTUnwrap(extensions["VRMC_vrm"] as? [String: Any])
        let humanBones = try XCTUnwrap((vrm["humanoid"] as? [String: Any])?["humanBones"] as? [String: Any])
        for key in ["leftThumbMetacarpal", "leftThumbProximal", "leftThumbDistal",
                    "rightThumbMetacarpal", "rightThumbProximal", "rightThumbDistal"] {
            XCTAssertNotNil(humanBones[key], "missing \(key)")
        }
        XCTAssertNil(humanBones["leftThumbIntermediate"], "that is the Unity spelling, not VRM 1.0's")
    }

    // MARK: - Behaviour

    func testExportIsRefusedWhenTheGateFails() {
        let base = Skeleton.defaultHumanoid()
        let collapsed = Skeleton(bones: base.bones.map {
            $0.bone == .neck ? BoneSpec(.neck, parent: .chest, at: base.restPosition(of: .chest)!) : $0
        })
        let snapshot = ExportSnapshot(
            avatarName: "Broken", templateID: "t", templateVersion: "1",
            skeleton: collapsed, mesh: Mannequin.build(skeleton: collapsed),
            albedo: PNG.Image.solid(width: 8, height: 8, r: 1, g: 2, b: 3),
            albedoRelativePath: "a.png")
        XCTAssertThrowsError(try VRMExporter.export(snapshot)) { error in
            guard case VRMExporter.Failure.preflightFailed = error else {
                return XCTFail("expected a pre-flight refusal, got \(error)")
            }
        }
    }

    func testExportIsByteIdenticalAcrossRuns() throws {
        // The manifest's SHA-256 handshake proves the iPad ran the same code CI
        // tested; that only works if the writer is deterministic.
        let a = try VRMExporter.export(Mannequin.snapshot(avatarName: "Same"))
        let b = try VRMExporter.export(Mannequin.snapshot(avatarName: "Same"))
        XCTAssertEqual(a, b)
    }

    private func readUInt32(_ data: Data, at offset: Int) -> UInt32 {
        UInt32(data[offset]) | (UInt32(data[offset + 1]) << 8)
            | (UInt32(data[offset + 2]) << 16) | (UInt32(data[offset + 3]) << 24)
    }
}
