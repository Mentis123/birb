import Testing
import BridgeSwift
@Test func ufbxLinksAndRejectsGarbage() {
  let r = ufbxRejectsGarbage()
  #expect(r.rejected); #expect(!r.message.isEmpty)
  print("ufbx", ufbxVersionString(), "->", r.message)
}
@Test func tinybvhPicksTriangle() {
  let h = pickUnitTriangle()
  #expect(h.hit); #expect(abs(h.t - 5) < 1e-4)
}
