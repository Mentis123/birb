import Foundation

/// Turning a touch into a place on the model.
///
/// Both tools need this and they need different parts of it. Sculpt wants the
/// world-space point to centre a brush on; paint wants the UV coordinate to
/// stamp into. Both come from the same ray-triangle hit, so they are one
/// operation rather than two.
public enum Picking {
    public struct Hit: Sendable, Equatable {
        /// Index of the triangle, not of a vertex: `mesh.indices[3 * triangle...]`.
        public let triangle: Int
        /// Distance along the ray, in ray-direction units.
        public let distance: Double
        /// Where on the surface, in world space.
        public let position: Vec3
        /// Where on the texture, interpolated across the triangle.
        public let uv: Vec2
        /// Barycentric weights of the three corners, in index order.
        public let barycentric: Vec3
    }

    /// Möller–Trumbore, back-face culled.
    ///
    /// Culling is deliberate: without it a touch on the front of the model also
    /// hits the inside of its back surface, and on a closed shape the far hit is
    /// sometimes nearer in the arithmetic than it looks. Sculpting the inside of
    /// the far wall by touching the near one is a bug users cannot diagnose.
    public static func intersect(ray origin: Vec3, direction: Vec3,
                                 a: Vec3, b: Vec3, c: Vec3) -> (distance: Double, u: Double, v: Double)? {
        let edge1 = b - a
        let edge2 = c - a
        let pvec = cross(direction, edge2)
        let determinant = dot(edge1, pvec)
        // Positive determinant only: a negative one means we are looking at the
        // back of the triangle. Near zero means the ray is parallel to it.
        guard determinant > 1e-12 else { return nil }

        let inverse = 1.0 / determinant
        let tvec = origin - a
        let u = dot(tvec, pvec) * inverse
        guard u >= 0, u <= 1 else { return nil }

        let qvec = cross(tvec, edge1)
        let v = dot(direction, qvec) * inverse
        guard v >= 0, u + v <= 1 else { return nil }

        let distance = dot(edge2, qvec) * inverse
        guard distance > 0 else { return nil }
        return (distance, u, v)
    }

    /// Nearest front-facing hit, or nil.
    ///
    /// Linear over the triangles. At 7,000 triangles that is a few tens of
    /// microseconds, which is nothing next to a touch event's 8 ms budget; a BVH
    /// is the optimisation to reach for if the model ever grows, not before.
    public static func raycast(_ mesh: MeshData, origin: Vec3, direction: Vec3) -> Hit? {
        let direction = normalize(direction)
        var best: Hit?
        for t in stride(from: 0, to: mesh.indices.count, by: 3) {
            let ia = Int(mesh.indices[t]), ib = Int(mesh.indices[t + 1]), ic = Int(mesh.indices[t + 2])
            guard let (distance, u, v) = intersect(ray: origin, direction: direction,
                                                   a: mesh.positions[ia],
                                                   b: mesh.positions[ib],
                                                   c: mesh.positions[ic]) else { continue }
            if let current = best, current.distance <= distance { continue }
            let w = 1.0 - u - v
            let uv = Vec2(mesh.uvs[ia].x * w + mesh.uvs[ib].x * u + mesh.uvs[ic].x * v,
                          mesh.uvs[ia].y * w + mesh.uvs[ib].y * u + mesh.uvs[ic].y * v)
            best = Hit(triangle: t / 3,
                       distance: distance,
                       position: origin + direction * distance,
                       uv: uv,
                       barycentric: Vec3(w, u, v))
        }
        return best
    }
}
