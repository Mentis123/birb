import XCTest
@testable import HumanoidCore
final class CoreXCTests: XCTestCase {
  func testSkinTranslates() {
    let v = SkinVertex(pos: .init(1,2,3), bones: [0,1,0,0], weights: [0.5,0.5,0,0])
    let out = skin(v, palette: [.identity, .translation(.init(2,0,0))])
    XCTAssertEqual(out, SIMD3<Float>(2,2,3))
  }
  func testManifestJSON() throws {
    XCTAssertEqual(String(decoding: try manifestJSON(vertexCount: 9000), as: UTF8.self), #"{"vertexCount":9000}"#)
  }
}
