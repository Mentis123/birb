import Foundation

/// Moves the template mesh when the rig's joints move.
///
/// This is the editor's whole model of "change the body": the mesh topology is
/// fixed, and every proportion edit is a joint relocation that the skin follows.
/// Nothing here adds, removes or reorders a vertex, so an export made after any
/// number of edits still matches the template's index buffer and UV layout.
public enum Skinning {
    /// Linear blend skinning from one rest skeleton to another.
    ///
    /// The general form is `sum(w_i * M_new_i * inverse(M_rest_i) * p)`. Both
    /// rest frames here are pure translations — `Skeleton` guarantees bones
    /// carry no rotation and no scale in the canonical rest pose — so each
    /// bone's matrix product collapses to a translation by how far that joint
    /// moved, and the whole sum reduces to a weighted displacement.
    ///
    /// That is not a shortcut taken for speed: writing it as a 4x4 product would
    /// compute the same numbers with more rounding. If bones ever gain a rest
    /// rotation, this reduction stops being valid and the general form has to
    /// come back — which is why the precondition below is not decorative.
    public static func deform(_ mesh: MeshData, from rest: Skeleton, to posed: Skeleton) -> MeshData {
        precondition(rest.count == posed.count,
                     "skinning between skeletons of different sizes is not defined")

        var delta = [Vec3](repeating: .zero, count: rest.count)
        for (index, spec) in rest.bones.enumerated() {
            guard let moved = posed.restPosition(of: spec.bone) else {
                preconditionFailure("posed skeleton is missing \(spec.bone.unityNodeName)")
            }
            delta[index] = moved - spec.restPosition
        }

        var result = mesh
        for vertex in 0..<mesh.vertexCount {
            var shift = Vec3.zero
            for influence in mesh.influences[vertex] {
                shift += delta[influence.bone] * influence.weight
            }
            result.positions[vertex] = mesh.positions[vertex] + shift
        }
        result.recomputeNormals()
        return result
    }
}
