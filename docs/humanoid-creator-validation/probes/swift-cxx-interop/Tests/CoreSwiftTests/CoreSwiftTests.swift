import Testing
@testable import HumanoidCore
@Test("weights normalise", arguments: [[1.0 as Float,0,0,0],[0.25,0.25,0.25,0.25]])
func weightsSum(w: [Float]) { #expect(abs(w.reduce(0,+) - 1) < 1e-6) }
@Test func identitySkinIsNoOp() {
  let v = SkinVertex(pos: .init(0.3,-1,7), bones: [0,0,0,0], weights: [1,0,0,0])
  #expect(skin(v, palette: [.identity]) == v.pos)
}
