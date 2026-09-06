import XCTest
@testable import HumanoidCore

final class DocumentTests: XCTestCase {
    private func clay() throws -> Document { try Document.clay(textureSize: 128) }

    private func drag(_ document: inout Document, at centre: Vec3 = Vec3(0, 0, 0.12)) {
        document.sculpt(.grab(Vec3(0, 0, 0.01)), at: [centre],
                        settings: .init(radius: 0.04, strength: 1.0, symmetric: false))
    }

    // MARK: - Shape

    func testANewClayDocumentIsExactlyTheTemplate() throws {
        let document = try clay()
        XCTAssertEqual(document.kind, .clay)
        XCTAssertNil(document.skeleton)
        for (a, b) in zip(document.mesh.positions, document.template.positions) {
            XCTAssertEqual(length(a - b), 0, accuracy: 1e-15)
        }
        XCTAssertFalse(document.canUndo)
        XCTAssertFalse(document.canRedo)
    }

    func testTheTemplateIsNeverMutated() throws {
        var document = try clay()
        let pristine = document.template.positions
        drag(&document)
        for (a, b) in zip(document.template.positions, pristine) {
            XCTAssertEqual(length(a - b), 0, accuracy: 1e-15,
                           "the frozen template was written to")
        }
        // And the edit did land somewhere.
        XCTAssertTrue(document.sculptDelta.contains { length($0) > 0 })
    }

    func testEditingNeverChangesTopology() throws {
        var document = try clay()
        drag(&document)
        document.paint(.init(radius: 0.1, opacity: 1, colour: (0, 0, 0)),
                       along: [Vec2(0.2, 0.2), Vec2(0.6, 0.6)])
        let mesh = document.mesh
        XCTAssertEqual(mesh.vertexCount, document.template.vertexCount)
        XCTAssertEqual(mesh.indices, document.template.indices)
        XCTAssertEqual(mesh.uvs.count, document.template.uvs.count)
    }

    // MARK: - Undo

    func testUndoRestoresTheExactPreviousShape() throws {
        var document = try clay()
        let before = document.mesh.positions
        drag(&document)
        XCTAssertTrue(document.canUndo)
        XCTAssertNotEqual(document.mesh.positions.map(\.z), before.map(\.z))

        document.undo()
        for (a, b) in zip(document.mesh.positions, before) {
            XCTAssertEqual(length(a - b), 0, accuracy: 1e-15)
        }
        XCTAssertFalse(document.canUndo)
        XCTAssertTrue(document.canRedo)
    }

    func testRedoPutsItBack() throws {
        var document = try clay()
        drag(&document)
        let sculpted = document.mesh.positions
        document.undo()
        document.redo()
        for (a, b) in zip(document.mesh.positions, sculpted) {
            XCTAssertEqual(length(a - b), 0, accuracy: 1e-15)
        }
    }

    func testUndoRedoSurvivesManyRoundTrips() throws {
        var document = try clay()
        for i in 0..<5 {
            document.sculpt(.inflate(0.003), at: [Vec3(0.05 * Double(i), 0, 0.11)],
                            settings: .init(radius: 0.04, strength: 0.6, symmetric: false))
        }
        let final = document.mesh.positions
        for _ in 0..<5 { document.undo() }
        for (a, b) in zip(document.mesh.positions, document.template.positions) {
            XCTAssertEqual(length(a - b), 0, accuracy: 1e-12, "undoing everything did not return to the template")
        }
        for _ in 0..<5 { document.redo() }
        for (a, b) in zip(document.mesh.positions, final) {
            XCTAssertEqual(length(a - b), 0, accuracy: 1e-12)
        }
    }

    func testANewEditDiscardsTheRedoBranch() throws {
        var document = try clay()
        drag(&document)
        document.undo()
        XCTAssertTrue(document.canRedo)
        drag(&document, at: Vec3(0.08, 0, 0.08))
        // Keeping redo across a new edit would let undo-edit-redo reach a state
        // no sequence of user actions could produce.
        XCTAssertFalse(document.canRedo)
    }

    func testHistoryIsBounded() throws {
        var document = try clay()
        document.historyLimit = 4
        for i in 0..<10 {
            document.sculpt(.inflate(0.001), at: [Vec3(0, 0.01 * Double(i), 0.11)],
                            settings: .init(radius: 0.03, strength: 0.5, symmetric: false))
        }
        XCTAssertEqual(document.undoDepth, 4)
        // Undoing past the bound stops rather than corrupting.
        for _ in 0..<10 { document.undo() }
        XCTAssertFalse(document.canUndo)
        XCTAssertTrue(document.validate().passes)
    }

    func testUndoingAPaintStrokeRestoresThePixels() throws {
        var document = try clay()
        let before = document.albedo.rgba
        document.paint(.init(radius: 0.15, opacity: 1.0, colour: (0, 0, 0)),
                       along: [Vec2(0.5, 0.5)])
        XCTAssertNotEqual(document.albedo.rgba, before)
        document.undo()
        XCTAssertEqual(document.albedo.rgba, before)
    }

    func testUndoInterleavesSculptAndPaintInTheRightOrder() throws {
        var document = try clay()
        let cleanPixels = document.albedo.rgba
        drag(&document)
        let sculptedPositions = document.mesh.positions
        document.paint(.init(radius: 0.15, opacity: 1, colour: (0, 0, 0)), along: [Vec2(0.5, 0.5)])

        // Undo the paint: pixels revert, shape stays.
        document.undo()
        XCTAssertEqual(document.albedo.rgba, cleanPixels)
        for (a, b) in zip(document.mesh.positions, sculptedPositions) {
            XCTAssertEqual(length(a - b), 0, accuracy: 1e-15)
        }
        // Undo the sculpt: shape reverts too.
        document.undo()
        for (a, b) in zip(document.mesh.positions, document.template.positions) {
            XCTAssertEqual(length(a - b), 0, accuracy: 1e-15)
        }
    }

    func testFillIsUndoable() throws {
        var document = try clay()
        let before = document.albedo.rgba
        document.fill((10, 20, 30))
        XCTAssertEqual(document.albedo.rgba[0], 10)
        document.undo()
        XCTAssertEqual(document.albedo.rgba, before)
    }

    func testAnEmptyStrokeRecordsNothing() throws {
        var document = try clay()
        // Nowhere near the model.
        document.sculpt(.grab(Vec3(0, 0, 0.01)), at: [Vec3(5, 5, 5)], settings: .init())
        XCTAssertFalse(document.canUndo, "a stroke that touched nothing was recorded")
    }

    // MARK: - Export

    func testASculptedClayDocumentStillExports() throws {
        var document = try clay()
        for i in 0..<4 {
            document.sculpt(.inflate(0.004), at: [Vec3(0.06 * Double(i - 2), 0.03, 0.10)],
                            settings: .init(radius: 0.05, strength: 0.7, symmetric: true))
        }
        document.paint(.init(radius: 0.08, opacity: 0.9, colour: (30, 90, 160)),
                       along: [Vec2(0.2, 0.3), Vec2(0.5, 0.6), Vec2(0.8, 0.4)])

        let report = document.validate()
        XCTAssertTrue(report.passes, report.summary)

        let snapshot = document.exportSnapshot(named: "Lump")
        XCTAssertFalse(snapshot.isRigged)
        XCTAssertEqual(snapshot.mesh.vertexCount, document.template.vertexCount)
        XCTAssertEqual(snapshot.albedoRelativePath, "Textures/Lump_Albedo.png")
        // The bytes-out assertion lives in ExporterVRMTests, which is the target
        // that can see the writers.
    }

    func testAHumanoidDocumentKeepsItsRig() throws {
        let document = try Document.humanoid(textureSize: 64)
        XCTAssertEqual(document.kind, .humanoid)
        XCTAssertEqual(document.skeleton?.count, 51)
        XCTAssertTrue(document.exportSnapshot(named: "Body").isRigged)
        XCTAssertTrue(document.validate().passes)
    }
}
