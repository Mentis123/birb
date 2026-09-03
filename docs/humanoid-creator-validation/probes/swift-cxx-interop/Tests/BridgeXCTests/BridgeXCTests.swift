import XCTest
import BridgeSwift
final class BridgeXCTests: XCTestCase {
  func testUfbxLinksAndRejectsGarbage() {
    let r = ufbxRejectsGarbage()
    XCTAssertTrue(r.rejected); XCTAssertFalse(r.message.isEmpty)
    print("ufbx", ufbxVersionString(), "->", r.message)
  }
  func testTinybvhPicksTriangle() {
    let h = pickUnitTriangle()
    XCTAssertTrue(h.hit); XCTAssertEqual(h.t, 5, accuracy: 1e-4)
  }
}
