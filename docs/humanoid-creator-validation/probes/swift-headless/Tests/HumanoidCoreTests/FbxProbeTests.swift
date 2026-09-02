import XCTest
import HumanoidCore

final class FbxProbeTests: XCTestCase {
  func testUfbxParsesSkinnedBlenderExport() throws {
    let url = Bundle.module.url(forResource: "blender_293_half_skinned_7400_binary", withExtension: "fbx", subdirectory: "Fixtures")!
    let s = try FbxProbe.summarize(path: url.path)
    XCTAssertEqual(s.meshCount, 1)
    XCTAssertGreaterThan(s.boneCount, 0)
    XCTAssertEqual(s.skinDeformerCount, 1)
    XCTAssertGreaterThan(s.vertexCount, 0)
    XCTAssertLessThanOrEqual(s.maxWeightsPerVertex, 4)
    print("SUMMARY:", s)
  }
}

extension FbxProbeTests {
  func testBlenderHeadlessRiggedExportRoundTrips() throws {
    let url = Bundle.module.url(forResource: "blender_rigged_limb", withExtension: "fbx", subdirectory: "Fixtures")!
    let s = try FbxProbe.summarize(path: url.path)
    XCTAssertEqual(s.meshCount, 1)
    XCTAssertEqual(s.boneCount, 2)          // Hips, Spine
    XCTAssertEqual(s.skinDeformerCount, 1)
    XCTAssertEqual(s.vertexCount, 12)
    XCTAssertEqual(s.maxWeightsPerVertex, 2) // the middle ring is 50/50
    print("ROUNDTRIP:", s)
  }
}
