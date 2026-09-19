import XCTest
@testable import HumanoidCore

/// Grab, captured once at the start of the gesture.
///
/// The defect these were written against: the per-dab form re-picks the surface
/// under the tip every frame, so a drag that pulls the surface out from under
/// itself ends up holding a different set of vertices than it started with, and
/// the displacement accumulates from wherever they had got to. On the device
/// that reads as the grab "slipping" — and as an undo that does not quite put
/// things back.
final class SculptGrabTests: XCTestCase {
    private var mesh: MeshData!
    private var tables: MeshTables!
    private var centre: Vec3!

    override func setUpWithError() throws {
        mesh = try TemplateFile.Bundled.clay.load().mesh
        mesh.recomputeNormals(MeshTables(mesh))
        tables = MeshTables(mesh)
        // Well off the mirror plane, so the two halves are distinct sets.
        centre = try XCTUnwrap(mesh.positions.first { $0.x > 0.08 && $0.z > 0.08 })
    }

    private func settings(symmetric: Bool = true) -> Sculpt.Settings {
        .init(radius: 0.05, strength: 0.8, symmetric: symmetric)
    }

    // MARK: - Agreement with the brush it replaces

    func testACapturedGrabMatchesTheSingleDabForm() {
        let displacement = Vec3(0.01, 0.02, -0.005)
        var perDab = mesh!
        Sculpt.apply(.grab(displacement), to: &perDab, tables: tables,
                     at: [centre], settings: settings())

        var captured = mesh!
        let set = Sculpt.captureGrab(at: centre, mesh: captured, tables: tables,
                                     settings: settings())
        Sculpt.apply(set, displacement: displacement, to: &captured, tables: tables)

        XCTAssertFalse(set.isEmpty)
        for i in 0..<mesh.vertexCount {
            XCTAssertEqual(length(captured.positions[i] - perDab.positions[i]), 0,
                           accuracy: 1e-12, "vertex \(i) disagrees")
        }
    }

    // MARK: - The properties the capture buys

    func testApplyingTheSameDisplacementTwiceChangesNothing() {
        var working = mesh!
        let set = Sculpt.captureGrab(at: centre, mesh: working, tables: tables,
                                     settings: settings())
        Sculpt.apply(set, displacement: Vec3(0.02, 0, 0), to: &working, tables: tables)
        let once = working.positions
        Sculpt.apply(set, displacement: Vec3(0.02, 0, 0), to: &working, tables: tables)
        for i in 0..<once.count {
            XCTAssertEqual(length(working.positions[i] - once[i]), 0, accuracy: 1e-15)
        }
    }

    func testSixtyFramesOfDragLandWhereOneCallWould() {
        // The property that makes a dropped or doubled frame harmless. The
        // incremental form could not have this: each step would re-measure a
        // surface its own previous step had moved.
        let total = Vec3(0.03, -0.01, 0.02)
        var stepped = mesh!
        let a = Sculpt.captureGrab(at: centre, mesh: stepped, tables: tables,
                                   settings: settings())
        for frame in 1...60 {
            Sculpt.apply(a, displacement: total * (Double(frame) / 60), to: &stepped,
                         tables: tables)
        }

        var single = mesh!
        let b = Sculpt.captureGrab(at: centre, mesh: single, tables: tables,
                                   settings: settings())
        Sculpt.apply(b, displacement: total, to: &single, tables: tables)

        for i in 0..<mesh.vertexCount {
            XCTAssertEqual(length(stepped.positions[i] - single.positions[i]), 0,
                           accuracy: 1e-12)
        }
    }

    func testAGrabReturnedToZeroRestoresTheSurfaceExactly() {
        var working = mesh!
        let set = Sculpt.captureGrab(at: centre, mesh: working, tables: tables,
                                     settings: settings())
        Sculpt.apply(set, displacement: Vec3(0.04, 0.04, 0), to: &working, tables: tables)
        Sculpt.apply(set, displacement: .zero, to: &working, tables: tables)
        for i in 0..<mesh.vertexCount {
            XCTAssertEqual(length(working.positions[i] - mesh.positions[i]), 0,
                           accuracy: 1e-15, "vertex \(i) did not come home")
        }
    }

    // MARK: - The invariants every brush keeps

    func testSymmetryPullsTheMirrorTheOtherWayInX() {
        var working = mesh!
        let set = Sculpt.captureGrab(at: centre, mesh: working, tables: tables,
                                     settings: settings())
        Sculpt.apply(set, displacement: Vec3(0.02, 0.01, 0), to: &working, tables: tables)

        // The vertex nearest the mirrored centre must move the opposite way in
        // x and the same way in y, or a symmetric grab shears the model.
        let mirroredCentre = Vec3(-centre.x, centre.y, centre.z)
        let near = (0..<mesh.vertexCount).min {
            length(mesh.positions[$0] - mirroredCentre) < length(mesh.positions[$1] - mirroredCentre)
        }!
        let moved = working.positions[near] - mesh.positions[near]
        XCTAssertLessThan(moved.x, -1e-6)
        XCTAssertGreaterThan(moved.y, 1e-6)
    }

    func testWeldedMembersStayTogether() {
        var working = mesh!
        let set = Sculpt.captureGrab(at: centre, mesh: working, tables: tables,
                                     settings: settings())
        Sculpt.apply(set, displacement: Vec3(0.03, 0, 0), to: &working, tables: tables)
        for members in tables.weldMembers where members.count > 1 {
            let first = working.positions[members[0]]
            for m in members.dropFirst() {
                XCTAssertEqual(length(working.positions[m] - first), 0, accuracy: 1e-15,
                               "a seam opened: welded members drifted apart")
            }
        }
    }

    func testTopologyIsUntouched() {
        var working = mesh!
        let set = Sculpt.captureGrab(at: centre, mesh: working, tables: tables,
                                     settings: settings())
        Sculpt.apply(set, displacement: Vec3(0.02, 0.02, 0.02), to: &working, tables: tables)
        XCTAssertEqual(working.vertexCount, mesh.vertexCount)
        XCTAssertEqual(working.indices, mesh.indices)
        XCTAssertEqual(working.uvs, mesh.uvs)
    }

    func testAsymmetricCaptureTouchesOnlyOneSide() {
        let set = Sculpt.captureGrab(at: centre, mesh: mesh, tables: tables,
                                     settings: settings(symmetric: false))
        XCTAssertFalse(set.mirrored.contains(true))
        let symmetric = Sculpt.captureGrab(at: centre, mesh: mesh, tables: tables,
                                           settings: settings())
        XCTAssertTrue(symmetric.mirrored.contains(true))
        XCTAssertGreaterThan(symmetric.weldedCount, set.weldedCount)
    }

    func testAGrabThatCatchesNothingIsEmpty() {
        let set = Sculpt.captureGrab(at: Vec3(9, 9, 9), mesh: mesh, tables: tables,
                                     settings: settings())
        XCTAssertTrue(set.isEmpty)
        var working = mesh!
        Sculpt.apply(set, displacement: Vec3(1, 1, 1), to: &working, tables: tables)
        XCTAssertEqual(working.positions, mesh.positions)
    }

    // MARK: - Through the document

    func testOneDragIsOneUndoStepAndItRestoresExactly() throws {
        var document = try Document.clay()
        let start = document.mesh.positions
        let hit = try XCTUnwrap(Picking.raycast(document.mesh, origin: Vec3(0.05, 0.02, 5),
                                                direction: Vec3(0, 0, -1)))

        document.beginStroke()
        XCTAssertTrue(document.beginGrab(at: hit.position, settings: settings()))
        for frame in 1...20 {
            document.grab(to: Vec3(0.02, 0.01, 0) * (Double(frame) / 20))
        }
        document.endStroke()

        XCTAssertEqual(document.undoDepth, 1, "a drag is one action, so it is one undo step")
        let farthest = (0..<start.count)
            .map { length(document.mesh.positions[$0] - start[$0]) }.max() ?? 0
        XCTAssertGreaterThan(farthest, 1e-3, "the drag did not move the surface")

        document.undo()
        for i in 0..<start.count {
            XCTAssertEqual(length(document.mesh.positions[i] - start[i]), 0, accuracy: 1e-15,
                           "undo left vertex \(i) behind")
        }
        document.redo()
        XCTAssertNotEqual(document.mesh.positions, start)
    }

    func testTheGrabDoesNotOutliveItsStroke() throws {
        var document = try Document.clay()
        let hit = try XCTUnwrap(Picking.raycast(document.mesh, origin: Vec3(0.05, 0.02, 5),
                                                direction: Vec3(0, 0, -1)))
        document.beginStroke()
        document.beginGrab(at: hit.position, settings: settings())
        XCTAssertTrue(document.isGrabbing)
        document.endStroke()
        XCTAssertFalse(document.isGrabbing)
        // A stray call after the gesture must do nothing rather than drag the
        // previous gesture's vertices by the new one's displacement.
        let before = document.mesh.positions
        XCTAssertEqual(document.grab(to: Vec3(1, 0, 0)), 0)
        XCTAssertEqual(document.mesh.positions, before)
    }
}
