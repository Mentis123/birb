import XCTest
import Foundation
@testable import ExporterFBX
@testable import HumanoidCore

final class FBXExporterTests: XCTestCase {
    private var directory: URL!
    private var snapshot: ExportSnapshot!
    private var file: URL!

    override func setUpWithError() throws {
        directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("fbx-tests-\(ProcessInfo.processInfo.processIdentifier)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        snapshot = Mannequin.snapshot(avatarName: "FBXTest")
        file = directory.appendingPathComponent("FBXTest.fbx")
        try FBXExporter.export(snapshot, to: file)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    func testWritesBinaryFBX7400() throws {
        let data = try Data(contentsOf: file)
        XCTAssertEqual(Array(data.prefix(21)), Array("Kaydara FBX Binary  ".utf8) + [0x00],
                       "binary FBX magic")
        let version = UInt32(data[23]) | (UInt32(data[24]) << 8) | (UInt32(data[25]) << 16) | (UInt32(data[26]) << 24)
        // 7400 is what Blender ships and what Unity's importer has consumed for
        // a decade; 7500 only changes node-header width but is untested here.
        XCTAssertEqual(version, 7400)
    }

    func testReopensCleanlyAndMatchesTheSnapshot() {
        let result = FBXValidator.validate(file, against: snapshot)
        XCTAssertTrue(result.passes, result.summary)
        XCTAssertEqual(result.meshCount, 1)
        XCTAssertEqual(result.boneCount, snapshot.skeleton.count)
        XCTAssertEqual(result.clusterCount, snapshot.skeleton.count)
        XCTAssertEqual(result.vertexCount, snapshot.mesh.vertexCount)
        XCTAssertLessThanOrEqual(result.maxWeightsPerVertex, 4)
    }

    func testWritesAnExplicitBindPose() {
        // Assimp deliberately omits this; Blender always writes one, and
        // Blender's output is what Unity is known to accept.
        XCTAssertGreaterThanOrEqual(FBXValidator.validate(file, against: snapshot).poseCount, 1)
    }

    func testCarriesTheMaterialAndRelativeTexturePath() {
        let result = FBXValidator.validate(file, against: snapshot)
        XCTAssertEqual(result.materialCount, 1, "mobile Good allows exactly one material slot")
        XCTAssertGreaterThanOrEqual(result.textureCount, 1)
    }

    func testValidatorNoticesWhenBindAndRestDisagree() throws {
        // The failure the reopen gate exists to catch: a file that imports
        // cleanly everywhere and skins incorrectly. Validating the written file
        // against a DIFFERENT skeleton simulates rest and bind drifting apart.
        let shifted = Skeleton(bones: snapshot.skeleton.bones.map {
            $0.bone == .leftHand
                ? BoneSpec($0.bone, parent: $0.parent, at: $0.restPosition + Vec3(0.05, 0, 0))
                : $0
        })
        let mismatched = ExportSnapshot(
            avatarName: snapshot.avatarName, templateID: snapshot.templateID,
            templateVersion: snapshot.templateVersion, skeleton: shifted,
            mesh: snapshot.mesh, albedo: snapshot.albedo,
            albedoRelativePath: snapshot.albedoRelativePath)
        let result = FBXValidator.validate(file, against: mismatched)
        XCTAssertFalse(result.passes, "a drifting bind pose must not pass the reopen gate")
        XCTAssertTrue(result.problems.contains { $0.contains("LeftHand") }, result.summary)
    }

    func testExportIsRefusedWhenTheGateFails() {
        let base = Skeleton.defaultHumanoid()
        // Structurally complete but rewired so VRChat's spine rule fails —
        // a realistic authoring mistake rather than a malformed rig.
        let broken = Skeleton(bones: base.bones.map {
            $0.bone == .leftShoulder ? BoneSpec(.leftShoulder, parent: .spine, at: $0.restPosition) : $0
        })
        let bad = ExportSnapshot(
            avatarName: "Broken", templateID: "t", templateVersion: "1", skeleton: broken,
            mesh: Mannequin.build(skeleton: broken),
            albedo: PNG.Image.solid(width: 8, height: 8, r: 1, g: 2, b: 3),
            albedoRelativePath: "a.png")
        XCTAssertThrowsError(try FBXExporter.export(bad, to: directory.appendingPathComponent("bad.fbx")))
    }

    func testOutputIsByteIdenticalAcrossRuns() throws {
        // ufbx-write derives the FileId and footer hash from the creation time,
        // so the exporter pins a timestamp; without that every export differs.
        let second = directory.appendingPathComponent("again.fbx")
        try FBXExporter.export(snapshot, to: second)
        XCTAssertEqual(try Data(contentsOf: file), try Data(contentsOf: second))
    }
}
