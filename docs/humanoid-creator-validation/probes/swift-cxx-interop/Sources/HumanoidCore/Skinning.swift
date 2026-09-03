import Foundation
public struct Mat4: Sendable, Equatable {
  public var c: (SIMD4<Float>, SIMD4<Float>, SIMD4<Float>, SIMD4<Float>)
  public static let identity = Mat4(c: (.init(1,0,0,0), .init(0,1,0,0), .init(0,0,1,0), .init(0,0,0,1)))
  public static func translation(_ t: SIMD3<Float>) -> Mat4 { var m = identity; m.c.3 = .init(t.x, t.y, t.z, 1); return m }
  public static func * (a: Mat4, v: SIMD4<Float>) -> SIMD4<Float> { a.c.0*v.x + a.c.1*v.y + a.c.2*v.z + a.c.3*v.w }
  public static func == (a: Mat4, b: Mat4) -> Bool { a.c.0==b.c.0 && a.c.1==b.c.1 && a.c.2==b.c.2 && a.c.3==b.c.3 }
}
public struct SkinVertex: Codable, Sendable { public var pos: SIMD3<Float>; public var bones: [UInt16]; public var weights: [Float] }
public func skin(_ v: SkinVertex, palette: [Mat4]) -> SIMD3<Float> {
  var out = SIMD4<Float>(0,0,0,0)
  for i in 0..<4 { out += (palette[Int(v.bones[i])] * SIMD4<Float>(v.pos, 1)) * v.weights[i] }
  return SIMD3(out.x, out.y, out.z)
}
public func manifestJSON(vertexCount: Int) throws -> Data {
  let e = JSONEncoder(); e.outputFormatting = [.sortedKeys]
  return try e.encode(["vertexCount": vertexCount])
}
