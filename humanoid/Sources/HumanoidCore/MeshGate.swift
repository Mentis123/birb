import Foundation

/// Pre-flight checks on the geometry itself, run on every document.
///
/// Where `RigGate` reproduces the acceptance rules of Unity and VRChat, this
/// checks the things that make a mesh a mesh at all. It exists as its own gate
/// because a Clay document has geometry and no skeleton, and because these are
/// the failures that produce a file which opens without complaint and renders
/// as nothing — a NaN in one position collapses a whole draw, and no importer
/// will say so.
///
/// It deliberately mirrors `tools/check_template.py`, which does the same job in
/// Python against the baked bytes. Two implementations that share no code is the
/// point: the Python one catches a bad bake, this one catches a bad edit.
public enum MeshGate {
    /// Below this, a triangle contributes no visible area and is almost always
    /// a sliver left by a modelling operation rather than something authored.
    public static let minimumTriangleArea = 1e-12

    public static func check(_ mesh: MeshData, requiresSkin: Bool) -> Gate.Report {
        var f = [Gate.Finding]()
        f += checkArrays(mesh)
        f += checkValues(mesh)
        f += checkTriangles(mesh)
        if requiresSkin { f += checkSkinPresence(mesh) }
        return Gate.Report(label: "mesh gate", findings: f)
    }

    private static func error(_ code: String, _ message: String) -> Gate.Finding {
        Gate.Finding(severity: .error, code: code, message: message, source: "mesh invariants")
    }

    private static func warning(_ code: String, _ message: String) -> Gate.Finding {
        Gate.Finding(severity: .warning, code: code, message: message, source: "mesh invariants")
    }

    private static func checkArrays(_ mesh: MeshData) -> [Gate.Finding] {
        var f = [Gate.Finding]()
        if mesh.positions.isEmpty { f.append(error("EMPTY_MESH", "the mesh has no vertices")) }
        if mesh.normals.count != mesh.positions.count {
            f.append(error("NORMAL_COUNT",
                           "\(mesh.normals.count) normals for \(mesh.positions.count) vertices"))
        }
        if mesh.uvs.count != mesh.positions.count {
            f.append(error("UV_COUNT", "\(mesh.uvs.count) UVs for \(mesh.positions.count) vertices"))
        }
        if mesh.influences.count != mesh.positions.count {
            f.append(error("INFLUENCE_COUNT",
                           "\(mesh.influences.count) influence sets for \(mesh.positions.count) vertices"))
        }
        if mesh.indices.count % 3 != 0 {
            f.append(error("INDEX_COUNT",
                           "\(mesh.indices.count) indices is not a whole number of triangles"))
        }
        if mesh.indices.isEmpty { f.append(error("NO_TRIANGLES", "the mesh has no triangles")) }
        return f
    }

    private static func checkValues(_ mesh: MeshData) -> [Gate.Finding] {
        var f = [Gate.Finding]()
        // A single non-finite position propagates through the bounding box and
        // every transform that touches it, so one bad vertex hides the whole
        // model. Worth naming the first offender rather than just counting.
        if let i = mesh.positions.firstIndex(where: { !$0.x.isFinite || !$0.y.isFinite || !$0.z.isFinite }) {
            f.append(error("POSITION_NOT_FINITE", "vertex \(i) has a non-finite position"))
        }
        if let i = mesh.normals.firstIndex(where: { !$0.x.isFinite || !$0.y.isFinite || !$0.z.isFinite }) {
            f.append(error("NORMAL_NOT_FINITE", "vertex \(i) has a non-finite normal"))
        }
        if let i = mesh.uvs.firstIndex(where: { !$0.x.isFinite || !$0.y.isFinite }) {
            f.append(error("UV_NOT_FINITE", "vertex \(i) has a non-finite UV"))
        }
        let unnormalised = mesh.normals.filter { abs(length($0) - 1.0) > 1e-3 }.count
        if unnormalised > 0 {
            f.append(warning("NORMAL_LENGTH", "\(unnormalised) normals are not unit length"))
        }
        let count = UInt32(mesh.positions.count)
        if let bad = mesh.indices.first(where: { $0 >= count }) {
            f.append(error("INDEX_RANGE",
                           "triangle index \(bad) is out of range for \(count) vertices"))
        }
        return f
    }

    private static func checkTriangles(_ mesh: MeshData) -> [Gate.Finding] {
        guard mesh.indices.count % 3 == 0 else { return [] }
        let count = UInt32(mesh.positions.count)
        guard mesh.indices.allSatisfy({ $0 < count }) else { return [] }

        var degenerate = 0
        var seen = Set<[UInt32]>()
        var duplicate = 0
        for t in stride(from: 0, to: mesh.indices.count, by: 3) {
            let a = mesh.indices[t], b = mesh.indices[t + 1], c = mesh.indices[t + 2]
            if a == b || b == c || a == c {
                degenerate += 1
                continue
            }
            let pa = mesh.positions[Int(a)], pb = mesh.positions[Int(b)], pc = mesh.positions[Int(c)]
            if length(cross(pb - pa, pc - pa)) * 0.5 < minimumTriangleArea { degenerate += 1 }
            let key = [a, b, c].sorted()
            if !seen.insert(key).inserted { duplicate += 1 }
        }
        var f = [Gate.Finding]()
        if degenerate > 0 {
            f.append(error("DEGENERATE_TRIANGLES", "\(degenerate) triangles have no area"))
        }
        if duplicate > 0 {
            // Two triangles on the same vertices are back-to-back surfaces that
            // z-fight. It is what a mirror does to a face lying in its plane.
            f.append(error("DUPLICATE_TRIANGLES",
                           "\(duplicate) triangles are duplicated on the same vertices"))
        }
        return f
    }

    private static func checkSkinPresence(_ mesh: MeshData) -> [Gate.Finding] {
        // Only meaningful for a rigged document. An unrigged one is *expected*
        // to have empty influence sets, and the rig gate never sees it.
        var f = [Gate.Finding]()
        let unweighted = mesh.influences.filter(\.isEmpty).count
        if unweighted > 0 {
            f.append(error("UNWEIGHTED_VERTICES",
                           "\(unweighted) vertices carry no skin weight"))
        }
        return f
    }
}
