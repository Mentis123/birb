import UfbxC
import Foundation

public struct FbxSummary: Equatable {
  public var meshCount: Int
  public var boneCount: Int
  public var skinDeformerCount: Int
  public var vertexCount: Int
  public var maxWeightsPerVertex: Int
}

public enum FbxProbe {
  /// Loads an FBX with ufbx and summarises what a Unity Humanoid import would need to see.
  public static func summarize(path: String) throws -> FbxSummary {
    var opts = ufbx_load_opts()
    var err = ufbx_error()
    guard let scene = ufbx_load_file(path, &opts, &err) else {
      let msg = withUnsafePointer(to: &err.description.data) { p in
        p.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
      }
      throw NSError(domain: "ufbx", code: Int(err.type.rawValue), userInfo: [NSLocalizedDescriptionKey: msg])
    }
    defer { ufbx_free_scene(scene) }
    let s = scene.pointee
    var verts = 0
    var maxW = 0
    for i in 0..<Int(s.meshes.count) {
      let mesh = s.meshes.data[i]!.pointee
      verts += Int(mesh.num_vertices)
      for d in 0..<Int(mesh.skin_deformers.count) {
        maxW = max(maxW, Int(mesh.skin_deformers.data[d]!.pointee.max_weights_per_vertex))
      }
    }
    return FbxSummary(meshCount: Int(s.meshes.count), boneCount: Int(s.bones.count),
                      skinDeformerCount: Int(s.skin_deformers.count), vertexCount: verts, maxWeightsPerVertex: maxW)
  }
}
