import Foundation
@testable import HumanoidCore

/// Shared helper: a paint path built the way the editor builds one — by casting
/// a ray at the model and taking the hit.
///
/// Painting takes world points and the triangle the ray hit, not UV
/// coordinates, so every test that paints needs this. Writing it once keeps the
/// tests describing what they are testing.
enum SurfacePath {
    /// Casts straight down -Z from well outside the model.
    static func onFrontFace(of mesh: MeshData, x: Double, y: Double) -> (point: Vec3, seed: Int)? {
        guard let hit = Picking.raycast(mesh, origin: Vec3(x, y, 5),
                                        direction: Vec3(0, 0, -1)) else { return nil }
        return (hit.point, hit.triangle)
    }

    /// A straight sweep across the +Z face at a fixed height.
    static func acrossFrontFace(of mesh: MeshData, from x0: Double, to x1: Double,
                                y: Double = 0, samples: Int = 8) -> [(point: Vec3, seed: Int)] {
        (0...samples).compactMap { i in
            onFrontFace(of: mesh, x: x0 + (x1 - x0) * Double(i) / Double(samples), y: y)
        }
    }

    /// One dab at the centre of the +Z face.
    static func centreOfFrontFace(of mesh: MeshData) -> [(point: Vec3, seed: Int)] {
        [onFrontFace(of: mesh, x: 0, y: 0)].compactMap { $0 }
    }
}

private extension Picking.Hit {
    var point: Vec3 { position }
}
