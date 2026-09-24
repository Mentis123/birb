import XCTest
@testable import HumanoidCore

/// Inflate and Deflate within one stroke: how far a point may move, and the
/// guarantee that the surface is never turned over.
///
/// Both come from the fifth device run's screenshot: a spike several radii
/// tall on the side of the clay, folded at its base, with holes where the
/// renderer culled the folded faces. Every dab of a stroke pushes along the
/// normals the stroke started with, and nothing bounded how many passes over
/// the same place could add up.
final class InflateLimitTests: XCTestCase {
    private var template: MeshData!
    private var tables: MeshTables!

    override func setUpWithError() throws {
        template = try TemplateFile.Bundled.clay.load().mesh
        tables = MeshTables(template)
        template.recomputeNormals(tables)
    }

    /// Dabs for `passes` passes back and forth between two aim points, found
    /// by casting rays at the stroke's STARTING surface and spaced by pointer
    /// travel — what the stroke engine does.
    private func scribble(on surface: MeshData, from a: Vec3, to b: Vec3, along direction: Vec3,
                          passes: Int, brush: Sculpt.Brush,
                          settings: Sculpt.Settings) -> [Sculpt.Dab] {
        var stroke = Sculpt.Stroke(settings: settings)
        var dabs: [Sculpt.Dab] = []
        let steps = 24
        let travel = length(b - a) / Double(steps)
        for pass in 0..<passes {
            for i in 0...steps {
                let t = Double(i) / Double(steps)
                let aim = pass % 2 == 0 ? a + (b - a) * t : b + (a - b) * t
                guard let hit = Picking.raycast(surface, origin: aim - direction * 5,
                                                direction: direction) else { continue }
                for centre in stroke.advance(to: hit.position, by: travel) {
                    dabs.append(Sculpt.Dab(brush, at: centre, settings: settings))
                }
            }
        }
        return dabs
    }

    /// Applies a stroke the way the engine does: one base for the whole
    /// stroke, `perFrame` dabs at a time (all of them at once by default).
    private func stroke(_ dabs: [Sculpt.Dab], on mesh: inout MeshData, from start: MeshData,
                        perFrame: Int = .max) {
        var base = Sculpt.StrokeBase(start, tables: tables)
        var frame: [Sculpt.Dab] = []
        for d in dabs {
            frame.append(d)
            if frame.count == perFrame {
                Sculpt.apply(frame, to: &mesh, tables: tables, base: &base)
                frame.removeAll()
            }
        }
        if !frame.isEmpty { Sculpt.apply(frame, to: &mesh, tables: tables, base: &base) }
    }

    private func inflate(_ settings: Sculpt.Settings) -> Sculpt.Brush {
        .inflate(Sculpt.inflatePerDabDriven * settings.radius)
    }

    private func deflate(_ settings: Sculpt.Settings) -> Sculpt.Brush {
        .inflate(-Sculpt.inflatePerDabDriven * settings.radius)
    }

    /// The largest distance any point moved from where the stroke began.
    private func peak(_ mesh: MeshData, from start: MeshData) -> Double {
        (0..<mesh.vertexCount).map { length(mesh.positions[$0] - start.positions[$0]) }.max() ?? 0
    }

    /// Triangles facing more than 90 degrees from how they faced at the start.
    private func turnedOver(_ mesh: MeshData, from start: MeshData) -> Int {
        (0..<(mesh.indices.count / 3)).filter {
            Sculpt.turnedOver($0, mesh: mesh, reference: start)
        }.count
    }

    private let front = (a: Vec3(-0.03, 0, 0), b: Vec3(0.03, 0, 0), direction: Vec3(0, 0, -1))

    // MARK: - The limit

    func testOnePassIsNotLimited() {
        // The limit is for going over the same place again; one pass must
        // still do what the fourth device run tuned it to do.
        let settings = Sculpt.Settings(radius: 0.028, strength: 1, symmetric: false)
        var mesh = template!
        let dabs = scribble(on: template, from: front.a, to: front.b, along: front.direction,
                            passes: 1, brush: inflate(settings), settings: settings)
        stroke(dabs, on: &mesh, from: template)
        let rise = peak(mesh, from: template) / settings.radius
        XCTAssertGreaterThan(rise, 0.8, "one pass rose only \(rise) radii")
        XCTAssertLessThan(rise, 0.95, "one pass rose \(rise) radii — the arithmetic says 0.88")
    }

    func testAScribbleRisesToTheLimitAndStops() {
        let settings = Sculpt.Settings(radius: 0.028, strength: 1, symmetric: false)
        var mesh = template!
        let dabs = scribble(on: template, from: front.a, to: front.b, along: front.direction,
                            passes: 12, brush: inflate(settings), settings: settings)
        stroke(dabs, on: &mesh, from: template)
        let rise = peak(mesh, from: template) / settings.radius
        // Twelve passes used to be twelve times one pass: over ten radii.
        XCTAssertLessThanOrEqual(rise, Sculpt.strokeHeightLimit + 1e-9)
        XCTAssertGreaterThan(rise, 0.9, "the scribble should fill up to the limit")
        XCTAssertEqual(turnedOver(mesh, from: template), 0)
    }

    func testTheResultDoesNotDependOnHowTheFramesFell() {
        // The limit reads how far the stroke has already moved a point, so it
        // must give the same surface whether the dabs arrive in one frame or
        // a dab at a time — the property the stroke engine exists to keep.
        let settings = Sculpt.Settings(radius: 0.028, strength: 1, symmetric: false)
        let dabs = scribble(on: template, from: front.a, to: front.b, along: front.direction,
                            passes: 6, brush: inflate(settings), settings: settings)
        var together = template!
        stroke(dabs, on: &together, from: template)
        var apart = template!
        stroke(dabs, on: &apart, from: template, perFrame: 1)
        for v in 0..<together.vertexCount {
            XCTAssertEqual(length(together.positions[v] - apart.positions[v]), 0, accuracy: 1e-12)
        }
    }

    func testALightTouchStopsLower() {
        // Pressure scales the dab and its limit alike: a feather-light scribble
        // builds a low ridge, not the same ridge more slowly.
        let settings = Sculpt.Settings(radius: 0.028, strength: 0.35, symmetric: false)
        var mesh = template!
        let dabs = scribble(on: template, from: front.a, to: front.b, along: front.direction,
                            passes: 12, brush: inflate(settings), settings: settings)
        stroke(dabs, on: &mesh, from: template)
        XCTAssertLessThanOrEqual(peak(mesh, from: template),
                                 settings.radius * Sculpt.strokeHeightLimit * 0.35 + 1e-9)
    }

    func testDeflateIsLimitedTheSameWay() {
        let settings = Sculpt.Settings(radius: 0.028, strength: 1, symmetric: false)
        var mesh = template!
        let dabs = scribble(on: template, from: front.a, to: front.b, along: front.direction,
                            passes: 12, brush: deflate(settings), settings: settings)
        stroke(dabs, on: &mesh, from: template)
        let depth = peak(mesh, from: template) / settings.radius
        XCTAssertLessThanOrEqual(depth, Sculpt.strokeHeightLimit + 1e-9)
        XCTAssertGreaterThan(depth, 0.9)
    }

    func testTheNextStrokeStartsFromTheNewSurface() {
        // The limit is per stroke. A second stroke measures from the surface
        // the first one left, so building height is a matter of more strokes.
        let settings = Sculpt.Settings(radius: 0.028, strength: 1, symmetric: false)
        var mesh = template!
        for _ in 0..<2 {
            let reference = mesh
            let dabs = scribble(on: reference, from: front.a, to: front.b, along: front.direction,
                                passes: 12, brush: inflate(settings), settings: settings)
            stroke(dabs, on: &mesh, from: reference)
        }
        let rise = peak(mesh, from: template) / settings.radius
        XCTAssertGreaterThan(rise, 1.5, "two strokes should build past one stroke's limit")
        XCTAssertLessThanOrEqual(rise, 2 * Sculpt.strokeHeightLimit + 1e-9)
    }

    // MARK: - Never turned over

    /// Deflate on the rounded vertical edge between the front and right faces:
    /// the normals there converge inwards, so points pushed along them cross.
    private let edge = (a: Vec3(0.12, -0.04, 0.12), b: Vec3(0.12, 0.04, 0.12),
                        direction: normalize(Vec3(-1, 0, -1)))

    func testDeflatingAnEdgeNeverTurnsTheSurfaceOver() {
        let settings = Sculpt.Settings(radius: 0.06, strength: 1, symmetric: false)
        var mesh = template!
        let dabs = scribble(on: template, from: edge.a, to: edge.b, along: edge.direction,
                            passes: 6, brush: deflate(settings), settings: settings)
        XCTAssertGreaterThan(dabs.count, 10, "the aim missed the edge")
        stroke(dabs, on: &mesh, from: template)
        XCTAssertEqual(turnedOver(mesh, from: template), 0)
        XCTAssertGreaterThan(peak(mesh, from: template), settings.radius * 0.3,
                             "the guard must stop a fold, not the whole stroke")
    }

    func testInflatingABumpAgainNeverTurnsTheSurfaceOver() {
        // The other way a fold starts: a stroke over the flank of a bump an
        // earlier stroke raised, where the bump's base is concave and its
        // normals converge. Several strokes, frame by frame, as on the iPad.
        //
        // Said plainly: with the height limit in, this does not fold even with
        // the guard switched off — it is a check on the two together, not
        // proof of the guard. The edge above and the two unit tests below are.
        let settings = Sculpt.Settings(radius: 0.02, strength: 1, symmetric: false)
        var mesh = template!
        for stroke in 0..<6 {
            let reference = mesh
            // Alternate a stroke along the middle with strokes along the two
            // flanks, a little either side of it.
            let offset = stroke % 3 == 0 ? 0.0 : (stroke % 3 == 1 ? 0.012 : -0.012)
            let dabs = scribble(on: reference, from: Vec3(-0.02, offset, 0), to: Vec3(0.02, offset, 0),
                                along: front.direction, passes: 8, brush: inflate(settings),
                                settings: settings)
            self.stroke(dabs, on: &mesh, from: reference, perFrame: 3)
            XCTAssertEqual(turnedOver(mesh, from: reference), 0, "stroke \(stroke)")
        }
    }

    func testTheGuardPutsBackOnlyWhatTurnedATriangleOver() throws {
        // One point on the front face pushed sideways past its neighbours —
        // which turns its triangles over — and another moved an ordinary
        // millimetre outwards, far away. Only the first is put back.
        var mesh = template!
        let start = mesh.positions
        func welded(nearest target: Vec3) -> Int {
            (0..<tables.weldedCount).min { a, b in
                length(start[tables.weldMembers[a][0]] - target)
                    < length(start[tables.weldMembers[b][0]] - target)
            }!
        }
        let crossed = welded(nearest: Vec3(0, 0, 0.12))
        let ordinary = welded(nearest: Vec3(-0.07, 0.05, 0.12))
        for m in tables.weldMembers[crossed] { mesh.positions[m] += Vec3(0.025, 0, 0) }
        for m in tables.weldMembers[ordinary] { mesh.positions[m] += Vec3(0, 0, 0.001) }
        XCTAssertGreaterThan(turnedOver(mesh, from: template), 0, "the setup did not fold anything")

        let restored = Sculpt.unfold(&mesh, moved: [crossed, ordinary], from: start,
                                     reference: template, tables: tables)
        XCTAssertEqual(restored, [crossed])
        XCTAssertEqual(turnedOver(mesh, from: template), 0)
        let o = tables.weldMembers[ordinary][0]
        XCTAssertEqual(mesh.positions[o].z - start[o].z, 0.001, accuracy: 1e-12,
                       "a move that folds nothing is kept")
    }

    func testPuttingAPointBackCanTurnANeighbourOverAndThatIsPutBackToo() {
        // Two rows of four points facing +z, a triangle pair per cell. `a` is
        // pushed past its right-hand neighbour, which turns one triangle over.
        // `b` is pushed past where `a` WAS, which is harmless while `a` is
        // away — until the guard puts `a` back, and then `b`'s triangle is the
        // one turned over. Only a guard that looks again finishes the job.
        var positions: [Vec3] = []
        for y in 0..<2 { for x in 0..<4 { positions.append(Vec3(Double(x), Double(y), 0)) } }
        func point(_ x: Int, _ y: Int) -> UInt32 { UInt32(y * 4 + x) }
        var indices: [UInt32] = []
        for x in 0..<3 {
            indices += [point(x, 0), point(x + 1, 0), point(x + 1, 1)]
            indices += [point(x, 0), point(x + 1, 1), point(x, 1)]
        }
        let strip = MeshData(positions: positions,
                             normals: Array(repeating: Vec3(0, 0, 1), count: positions.count),
                             uvs: positions.map { Vec2($0.x / 3, $0.y) }, indices: indices,
                             influences: Array(repeating: [], count: positions.count))
        let stripTables = MeshTables(strip)
        let a = Int(point(2, 0)), b = Int(point(1, 0))
        var mesh = strip
        mesh.positions[a] = Vec3(3.5, 0, 0)
        mesh.positions[b] = Vec3(2.5, 0, 0)
        XCTAssertEqual(turnedOver(mesh, from: strip), 1, "only the triangle past a's neighbour")

        let restored = Sculpt.unfold(&mesh, moved: [stripTables.weldOf[a], stripTables.weldOf[b]],
                                     from: strip.positions, reference: strip, tables: stripTables)
        XCTAssertEqual(restored, [stripTables.weldOf[a], stripTables.weldOf[b]])
        XCTAssertEqual(turnedOver(mesh, from: strip), 0)
    }

    func testAnOrdinaryPassPutsNothingBack() {
        // Replays one ordinary pass frame by frame and asks the guard, after
        // each frame, whether it had anything to do.
        let settings = Sculpt.Settings(radius: 0.028, strength: 1, symmetric: false)
        let dabs = scribble(on: template, from: front.a, to: front.b, along: front.direction,
                            passes: 1, brush: inflate(settings), settings: settings)
        var mesh = template!
        var base = Sculpt.StrokeBase(template, tables: tables)
        for d in dabs {
            let before = mesh.positions
            let moved = Sculpt.apply([d], to: &mesh, tables: tables, base: &base)
            var probe = mesh
            XCTAssertTrue(Sculpt.unfold(&probe, moved: moved, from: before,
                                        reference: template, tables: tables).isEmpty)
        }
    }

    // MARK: - The rule on its own

    func testLimitedRise() {
        XCTAssertEqual(Sculpt.limitedRise(height: 0, by: 0.3, ceiling: 1), 0.3)
        XCTAssertEqual(Sculpt.limitedRise(height: 0.9, by: 0.3, ceiling: 1), 0.1, accuracy: 1e-15)
        XCTAssertEqual(Sculpt.limitedRise(height: 1.2, by: 0.3, ceiling: 1), 0,
                       "a weaker dab never pulls back what a stronger one raised")
        XCTAssertEqual(Sculpt.limitedRise(height: 0, by: -0.3, ceiling: 1), -0.3)
        XCTAssertEqual(Sculpt.limitedRise(height: -0.9, by: -0.3, ceiling: 1), -0.1, accuracy: 1e-15)
        XCTAssertEqual(Sculpt.limitedRise(height: -1.2, by: -0.3, ceiling: 1), 0)
        XCTAssertEqual(Sculpt.limitedRise(height: 0.5, by: -0.3, ceiling: 1), -0.3,
                       "deflating a raised point is not limited by the raise")
    }
}
