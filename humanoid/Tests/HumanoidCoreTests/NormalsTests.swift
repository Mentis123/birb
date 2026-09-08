import XCTest
@testable import HumanoidCore

/// Vertex normals across UV seams, and the incremental pass.
///
/// Both failures here look like a rendering bug rather than a maths one: a
/// crease down every cube edge, or a patch of surface lit as though it had not
/// moved. Neither is visible in a unit test that only checks positions, which is
/// why these exist.
final class NormalsTests: XCTestCase {
    private var mesh: MeshData!
    private var tables: MeshTables!

    override func setUpWithError() throws {
        mesh = try TemplateFile.Bundled.clay.load().mesh
        tables = MeshTables(mesh)
    }

    func testTheTemplateHasSeamsWorthWelding() {
        // If this ever reports zero the rest of the file is vacuous.
        XCTAssertGreaterThan(tables.seamPositions.count, 100,
                             "the clay atlas should split hundreds of points across islands")
    }

    func testWeldedNormalsAgreeAcrossEverySeam() {
        var welded = mesh!
        welded.recomputeNormals(tables)
        for position in tables.seamPositions {
            let members = tables.weldMembers[position]
            let first = welded.normals[members[0]]
            for member in members.dropFirst() {
                XCTAssertEqual(length(welded.normals[member] - first), 0, accuracy: 1e-12,
                               "seam copies of one point must share a normal")
            }
        }
    }

    func testPerVertexNormalsDoNotAgreeAcrossSeams() {
        // The reason the welded form is needed: the plain pass gives the two
        // copies of a cube-edge point the normals of their own faces, which is
        // a visible crease along all twelve edges.
        var plain = mesh!
        plain.recomputeNormals()
        let disagreements = tables.seamPositions.filter { position in
            let members = tables.weldMembers[position]
            return members.dropFirst().contains {
                length(plain.normals[$0] - plain.normals[members[0]]) > 1e-9
            }
        }
        XCTAssertGreaterThan(disagreements.count, 100)
    }

    func testIncrementalMatchesAFullRecompute() throws {
        var reference = mesh!
        reference.recomputeNormals(tables)

        var incremental = reference
        var full = reference

        // Move a patch, then update one mesh incrementally and the other wholly.
        let centre = reference.positions[0]
        let touched = Sculpt.apply(.inflate(0.01), to: &incremental, tables: tables,
                                   at: centre, settings: .init(radius: 0.05, strength: 1))
        XCTAssertFalse(touched.isEmpty)
        for i in 0..<full.positions.count { full.positions[i] = incremental.positions[i] }
        full.recomputeNormals(tables)

        for i in 0..<full.vertexCount {
            XCTAssertEqual(length(incremental.normals[i] - full.normals[i]), 0, accuracy: 1e-12,
                           "vertex \(i) disagrees; the dirty set is missing a face")
        }
    }

    func testIncrementalUpdatesTheOneRingNotJustTheMovedPoints() {
        // A vertex just outside the brush still has its normal changed, because
        // a triangle it belongs to has a corner that moved. Missing this leaves
        // a visible ring of stale shading around every stroke.
        var before = mesh!
        before.recomputeNormals(tables)
        var after = before

        let centre = before.positions[0]
        let moved = Sculpt.apply(.inflate(0.02), to: &after, tables: tables,
                                 at: centre, settings: .init(radius: 0.04, strength: 1,
                                                             symmetric: false))
        let movedVertices = Set(moved.flatMap { tables.weldMembers[$0] })
        let changedNormals = (0..<after.vertexCount).filter {
            length(after.normals[$0] - before.normals[$0]) > 1e-9
        }
        XCTAssertTrue(changedNormals.contains { !movedVertices.contains($0) },
                      "at least one unmoved neighbour must have been re-normalled")
    }

    func testDocumentKeepsItsCachedMeshInStepWithTheDeltas() throws {
        var document = try Document.clay()
        let centre = document.mesh.positions[0]
        document.sculpt(.inflate(0.01), at: [centre],
                        settings: .init(radius: 0.05, strength: 1))

        for i in 0..<document.mesh.vertexCount {
            let expected = document.template.positions[i] + document.sculptDelta[i]
            XCTAssertEqual(length(document.mesh.positions[i] - expected), 0, accuracy: 1e-12)
        }
    }

    func testUndoRestoresTheCachedMeshAndItsNormals() throws {
        var document = try Document.clay()
        let start = document.mesh
        let centre = start.positions[0]
        document.sculpt(.inflate(0.01), at: [centre],
                        settings: .init(radius: 0.05, strength: 1))
        XCTAssertNotEqual(document.mesh.positions[0], start.positions[0])

        document.undo()
        for i in 0..<start.vertexCount {
            XCTAssertEqual(length(document.mesh.positions[i] - start.positions[i]), 0,
                           accuracy: 1e-12, "position \(i) not restored")
            XCTAssertEqual(length(document.mesh.normals[i] - start.normals[i]), 0,
                           accuracy: 1e-12, "normal \(i) not restored")
        }
    }
}
