import XCTest
@testable import HumanoidCore

final class SculptTests: XCTestCase {
    private var mesh: MeshData!
    private var tables: MeshTables!

    override func setUpWithError() throws {
        mesh = try TemplateFile.Bundled.clay.load().mesh
        tables = MeshTables(mesh)
    }

    private func nearest(to point: Vec3) -> Int {
        (0..<mesh.vertexCount).min { length(mesh.positions[$0] - point) < length(mesh.positions[$1] - point) }!
    }

    // MARK: - Tables

    func testWeldingFindsTheSeamDuplicates() {
        XCTAssertEqual(mesh.vertexCount, 3_750)
        XCTAssertEqual(tables.weldedCount, 3_458)
        // The extra vertices are the cube's twelve edges, stored more than once
        // because the faces meeting there have different UVs.
        let duplicated = tables.seamPositions.reduce(0) { $0 + tables.weldMembers[$1].count - 1 }
        XCTAssertEqual(duplicated, mesh.vertexCount - tables.weldedCount)
        for welded in 0..<tables.weldedCount {
            XCTAssertFalse(tables.weldMembers[welded].isEmpty)
            let positions = tables.weldMembers[welded].map { mesh.positions[$0] }
            for p in positions { XCTAssertEqual(length(p - positions[0]), 0, accuracy: 1e-9) }
        }
    }

    func testEveryWeldedPositionHasNeighboursAndAMirror() throws {
        for welded in 0..<tables.weldedCount {
            XCTAssertFalse(tables.neighbours[welded].isEmpty, "\(welded) is isolated")
            XCTAssertFalse(tables.neighbours[welded].contains(welded), "\(welded) neighbours itself")
            let partner = try XCTUnwrap(tables.mirror[welded], "\(welded) has no mirror partner")
            // Mirroring is an involution, and a point on the plane is its own.
            XCTAssertEqual(tables.mirror[partner], welded)
        }
    }

    func testNeighboursAreSortedSoSmoothIsDeterministic() {
        for ring in tables.neighbours {
            XCTAssertEqual(ring, ring.sorted(),
                           "float addition is not associative; an unordered ring makes Smooth vary run to run")
        }
    }

    // MARK: - Falloff

    func testFalloffIsSmoothAtBothEnds() {
        XCTAssertEqual(Sculpt.falloff(distance: 0, radius: 1), 1.0, accuracy: 1e-12)
        XCTAssertEqual(Sculpt.falloff(distance: 1, radius: 1), 0.0, accuracy: 1e-12)
        XCTAssertEqual(Sculpt.falloff(distance: 2, radius: 1), 0.0, accuracy: 1e-12)
        XCTAssertEqual(Sculpt.falloff(distance: 0.5, radius: 1), 0.5, accuracy: 1e-12)
        // Zero slope at the rim is the point: a linear falloff leaves a visible
        // ring after a few overlapping dabs.
        XCTAssertLessThan(Sculpt.falloff(distance: 0.99, radius: 1), 0.001)
    }

    // MARK: - Invariants shared by every brush

    private func assertTopologyUnchanged(_ edited: MeshData, _ original: MeshData) {
        XCTAssertEqual(edited.vertexCount, original.vertexCount)
        XCTAssertEqual(edited.indices, original.indices)
        XCTAssertEqual(edited.uvs.count, original.uvs.count)
        for (a, b) in zip(edited.uvs, original.uvs) {
            XCTAssertEqual(a.x, b.x)
            XCTAssertEqual(a.y, b.y)
        }
        for (a, b) in zip(edited.influences, original.influences) { XCTAssertEqual(a, b) }
    }

    func testEveryBrushLeavesTopologyAlone() {
        for brush in [Sculpt.Brush.grab(Vec3(0.01, 0, 0)), .inflate(0.01), .smooth] {
            var edited = mesh!
            Sculpt.apply(brush, to: &edited, tables: tables,
                         at: Vec3(0, 0, 0.12), settings: .init())
            assertTopologyUnchanged(edited, mesh)
        }
    }

    func testNothingOutsideTheRadiusMoves() {
        var edited = mesh!
        let centre = Vec3(0, 0, 0.12)
        let settings = Sculpt.Settings(radius: 0.03, strength: 1.0, symmetric: false)
        Sculpt.apply(.grab(Vec3(0, 0, 0.01)), to: &edited, tables: tables,
                     at: centre, settings: settings)
        for i in 0..<mesh.vertexCount where length(mesh.positions[i] - centre) > settings.radius {
            XCTAssertEqual(length(edited.positions[i] - mesh.positions[i]), 0, accuracy: 1e-15,
                           "vertex \(i) moved despite being outside the brush")
        }
    }

    func testSeamVerticesMoveTogetherSoTheSurfaceCannotTear() {
        var edited = mesh!
        // A corner of the cube, where three UV islands meet — the worst case.
        let corner = mesh.positions.max { length($0) < length($1) }!
        Sculpt.apply(.inflate(0.02), to: &edited, tables: tables, at: corner,
                     settings: .init(radius: 0.05, strength: 1.0, symmetric: false))
        for welded in tables.seamPositions {
            let moved = tables.weldMembers[welded].map { edited.positions[$0] }
            for p in moved {
                XCTAssertEqual(length(p - moved[0]), 0, accuracy: 1e-12,
                               "seam copies drifted apart — the surface has torn")
            }
        }
    }

    func testAZeroStrokeIsANoOp() {
        var edited = mesh!
        let touched = Sculpt.apply(.grab(.zero), to: &edited, tables: tables,
                                   at: Vec3(0, 0, 0.12), settings: .init())
        XCTAssertTrue(touched.isEmpty)
        for (a, b) in zip(edited.positions, mesh.positions) {
            XCTAssertEqual(length(a - b), 0, accuracy: 1e-15)
        }
    }

    // MARK: - Per-brush behaviour

    func testGrabMovesTheCentreByTheFullDelta() {
        var edited = mesh!
        let centre = Vec3(0, 0, 0.12)
        let delta = Vec3(0, 0, 0.01)
        Sculpt.apply(.grab(delta), to: &edited, tables: tables, at: centre,
                     settings: .init(radius: 0.04, strength: 1.0, symmetric: false))
        let index = nearest(to: centre)
        let shift = edited.positions[index] - mesh.positions[index]
        XCTAssertGreaterThan(dot(normalize(shift), normalize(delta)), 0.999)
        XCTAssertGreaterThan(length(shift) / length(delta), 0.9)
    }

    func testInflatePushesOutwardAndDeflatePullsIn() {
        let centre = Vec3(0, 0, 0.12)
        for (amount, expectGrowth) in [(0.01, true), (-0.01, false)] {
            var edited = mesh!
            Sculpt.apply(.inflate(amount), to: &edited, tables: tables, at: centre,
                         settings: .init(radius: 0.05, strength: 1.0, symmetric: false))
            let index = nearest(to: centre)
            let before = length(mesh.positions[index])
            let after = length(edited.positions[index])
            if expectGrowth {
                XCTAssertGreaterThan(after, before)
            } else {
                XCTAssertLessThan(after, before)
            }
        }
    }

    func testSmoothFlattensARoughenedPatchRatherThanDraggingIt() {
        // Roughen a patch, then smooth it. The spread about the surface must
        // fall and the patch's centre of mass must stay put: a "smooth" that
        // shrinks the model is the classic mistake.
        var rough = mesh!
        let centre = Vec3(0, 0, 0.12)
        for (i, p) in mesh.positions.enumerated() where length(p - centre) < 0.05 {
            rough.positions[i] = p + normalize(p) * (Double(i % 7) - 3.0) * 0.0008
        }
        rough.recomputeNormals()

        let patch = (0..<mesh.vertexCount).filter { length(mesh.positions[$0] - centre) < 0.03 }
        func roughness(_ m: MeshData) -> Double {
            let radii = patch.map { length(m.positions[$0]) }
            let mean = radii.reduce(0, +) / Double(radii.count)
            return radii.map { ($0 - mean) * ($0 - mean) }.reduce(0, +) / Double(radii.count)
        }
        func centroid(_ m: MeshData) -> Vec3 {
            patch.reduce(Vec3.zero) { $0 + m.positions[$1] } * (1.0 / Double(patch.count))
        }

        var smoothed = rough
        for _ in 0..<6 {
            Sculpt.apply(.smooth, to: &smoothed, tables: tables, at: centre,
                         settings: .init(radius: 0.05, strength: 0.8, symmetric: false))
        }
        XCTAssertLessThan(roughness(smoothed), roughness(rough) * 0.5, "smooth did not flatten")
        XCTAssertLessThan(length(centroid(smoothed) - centroid(rough)), 0.002,
                          "smooth dragged the patch instead of flattening it")
    }

    func testSmoothIsDeterministic() {
        var a = mesh!
        var b = mesh!
        let settings = Sculpt.Settings(radius: 0.05, strength: 0.7, symmetric: false)
        Sculpt.apply(.smooth, to: &a, tables: tables, at: Vec3(0, 0, 0.12), settings: settings)
        Sculpt.apply(.smooth, to: &b, tables: tables, at: Vec3(0, 0, 0.12), settings: settings)
        for (pa, pb) in zip(a.positions, b.positions) {
            XCTAssertEqual(pa.x, pb.x)
            XCTAssertEqual(pa.y, pb.y)
            XCTAssertEqual(pa.z, pb.z)
        }
    }

    // MARK: - Symmetry

    func testASymmetricStrokeKeepsTheMeshMirrorSymmetric() {
        var edited = mesh!
        // Off-centre and with a sideways component, which is the case that
        // shears the model if the mirrored Grab is not itself mirrored.
        Sculpt.apply(.grab(Vec3(0.008, 0.004, 0)), to: &edited, tables: tables,
                     at: Vec3(0.06, 0.03, 0.10),
                     settings: .init(radius: 0.05, strength: 1.0, symmetric: true))

        for welded in 0..<tables.weldedCount {
            guard let partner = tables.mirror[welded] else { continue }
            let p = edited.positions[tables.weldMembers[welded][0]]
            let q = edited.positions[tables.weldMembers[partner][0]]
            XCTAssertEqual(length(Vec3(-p.x, p.y, p.z) - q), 0, accuracy: 1e-9,
                           "a symmetric stroke broke mirror symmetry at \(welded)")
        }
    }

    func testAnAsymmetricStrokeBreaksSymmetryAsItShould() {
        var edited = mesh!
        Sculpt.apply(.grab(Vec3(0.01, 0, 0)), to: &edited, tables: tables,
                     at: Vec3(0.06, 0.03, 0.10),
                     settings: .init(radius: 0.05, strength: 1.0, symmetric: false))
        let broken = (0..<tables.weldedCount).contains { welded in
            guard let partner = tables.mirror[welded] else { return false }
            let p = edited.positions[tables.weldMembers[welded][0]]
            let q = edited.positions[tables.weldMembers[partner][0]]
            return length(Vec3(-p.x, p.y, p.z) - q) > 1e-6
        }
        XCTAssertTrue(broken, "symmetric:false still produced a symmetric result — the flag does nothing")
    }

    func testASculptedMeshStillClearsTheMeshGate() {
        var edited = mesh!
        for step in 0..<8 {
            let angle = Double(step) * 0.6
            Sculpt.apply(.inflate(0.004), to: &edited, tables: tables,
                         at: Vec3(cos(angle) * 0.10, sin(angle) * 0.06, 0.10),
                         settings: .init(radius: 0.05, strength: 0.8, symmetric: true))
        }
        let report = MeshGate.check(edited, requiresSkin: false)
        XCTAssertTrue(report.passes, report.summary)
    }
}
