import UFBX
import GeometryBridge
import HumanoidCore
public func ufbxVersionString() -> String {
  let v = ufbx_source_version; return "\(v / 1_000_000).\(v / 1000 % 1000).\(v % 1000)"
}
public func ufbxRejectsGarbage() -> (rejected: Bool, message: String) {
  var bytes: [UInt8] = Array("not an fbx file at all".utf8)
  var err = ufbx_error()
  let scene = bytes.withUnsafeMutableBytes { ufbx_load_memory($0.baseAddress, $0.count, nil, &err) }
  defer { if scene != nil { ufbx_free_scene(scene) } }
  let msg = withUnsafePointer(to: &err.description.data) { String(cString: UnsafeRawPointer($0).assumingMemoryBound(to: CChar.self)) }
  return (scene == nil, msg)
}
public func pickUnitTriangle() -> (hit: Bool, t: Float) {
  var p = BVHPicker()
  let tri: [Float] = [-1,-1,0,  1,-1,0,  0,1,0]
  tri.withUnsafeBufferPointer { p.build($0.baseAddress, 1) }
  let h = p.pick(0, 0, -5, 0, 0, 1)
  return (h.hit, h.t)
}
