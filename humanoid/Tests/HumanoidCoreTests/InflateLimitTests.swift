import XCTest
@testable import HumanoidCore

/// Inflate and Deflate: which way a dab pushes, how far one stroke may push,
/// and the guarantee that a frame never makes the surface pass through
/// itself.
///
/// The fifth device run's screenshot was a scribbled spike several radii
/// tall, folded at its base: nothing bounded how far one stroke could push.
/// The sixth was a Deflate pit with the inside of the model showing through
/// it, dug by many strokes: every point was pushed along its own normal, and
/// on a rim, an edge or the bottom of a dent those normals converge.
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
                        perFrame: Int = .max, preventCrossing: Bool = true) {
        var base = Sculpt.StrokeBase(start, tables: tables)
        var frame: [Sculpt.Dab] = []
        for d in dabs {
            frame.append(d)
            if frame.count == perFrame {
                Sculpt.apply(frame, to: &mesh, tables: tables, base: &base,
                             preventCrossing: preventCrossing)
                frame.removeAll()
            }
        }
        if !frame.isEmpty {
            Sculpt.apply(frame, to: &mesh, tables: tables, base: &base,
                         preventCrossing: preventCrossing)
        }
    }

    /// `strokes` scribbles of `passes` passes over one place, each stroke
    /// starting from the surface the last one left, `perFrame` dabs a frame.
    private func strokes(_ count: Int, on mesh: inout MeshData, from a: Vec3, to b: Vec3,
                         along direction: Vec3, passes: Int, deflating: Bool,
                         settings: Sculpt.Settings, preventCrossing: Bool) {
        for _ in 0..<count {
            let reference = mesh
            let dabs = scribble(on: reference, from: a, to: b, along: direction, passes: passes,
                                brush: deflating ? deflate(settings) : inflate(settings),
                                settings: settings)
            stroke(dabs, on: &mesh, from: reference, perFrame: 3, preventCrossing: preventCrossing)
        }
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

    /// Where the surface passes through itself, by the independent oracle.
    private func crossings(_ mesh: MeshData) -> Int {
        CrossingOracle.pairs(in: mesh, tables: tables).count
    }

    private let front = (a: Vec3(-0.03, 0, 0), b: Vec3(0.03, 0, 0), direction: Vec3(0, 0, -1))

    // MARK: - The limit

    func testOnePassReachesTheLimit() {
        // One pass would lift the middle of its path 0.88 R; the limit is
        // what a single confident stroke does now.
        let settings = Sculpt.Settings(radius: 0.028, strength: 1, symmetric: false)
        var mesh = template!
        let dabs = scribble(on: template, from: front.a, to: front.b, along: front.direction,
                            passes: 1, brush: inflate(settings), settings: settings)
        stroke(dabs, on: &mesh, from: template)
        let rise = peak(mesh, from: template) / settings.radius
        XCTAssertGreaterThan(rise, 0.6, "one pass rose only \(rise) radii")
        XCTAssertLessThanOrEqual(rise, Sculpt.strokeHeightLimit + 1e-9)
    }

    func testTheLimitIsTheDepthASmoothstepCanPushWithoutFolding() {
        // Not a feel: the smoothstep's steepest slope is 1.5 per radius, and a
        // push whose flank changes faster than one unit per unit folds a wall
        // it runs along.
        XCTAssertLessThan(Sculpt.strokeHeightLimit * 1.5, 1)
        XCTAssertEqual(
            (0...1000).map { i -> Double in
                let d = Double(i) / 1000
                return abs(Sculpt.falloff(distance: d + 1e-6, radius: 1)
                           - Sculpt.falloff(distance: d, radius: 1)) / 1e-6
            }.max()!, 1.5, accuracy: 1e-3)
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
        XCTAssertGreaterThan(rise, 0.6, "the scribble should fill up to the limit")
        XCTAssertEqual(crossings(mesh), 0)
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
        XCTAssertGreaterThan(depth, 0.6)
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
        XCTAssertGreaterThan(rise, 1.5 * Sculpt.strokeHeightLimit,
                             "two strokes should build past one stroke's limit")
        XCTAssertLessThanOrEqual(rise, 2 * Sculpt.strokeHeightLimit + 1e-9)
    }

    // MARK: - One direction per dab

    /// The rounded vertical edge between the front and right faces, where the
    /// normals of the points a brush reaches differ by up to ninety degrees.
    private let edge = (a: Vec3(0.12, -0.04, 0.12), b: Vec3(0.12, 0.04, 0.12),
                        direction: normalize(Vec3(-1, 0, -1)))

    func testADabPushesEverythingItReachesOneWay() throws {
        // The property that makes convergence impossible: points pushed the
        // same way cannot meet. Pushed along their own normals, as they were,
        // the two faces of this edge were pushed at each other.
        let settings = Sculpt.Settings(radius: 0.06, strength: 1, symmetric: false)
        let hit = try XCTUnwrap(Picking.raycast(template, origin: Vec3(0.12, 0, 0.12) - edge.direction * 5,
                                                direction: edge.direction))
        var mesh = template!
        var base = Sculpt.StrokeBase(template, tables: tables)
        let moved = Sculpt.apply([Sculpt.Dab(deflate(settings), at: hit.position, settings: settings)],
                                 to: &mesh, tables: tables, base: &base)
        XCTAssertGreaterThan(moved.count, 20)
        let shifts = moved.map { mesh.positions[tables.weldMembers[$0][0]]
                                 - template.positions[tables.weldMembers[$0][0]] }
        let first = normalize(try XCTUnwrap(shifts.max { length($0) < length($1) }))
        for shift in shifts where length(shift) > 1e-9 {
            XCTAssertGreaterThan(dot(normalize(shift), first), 1 - 1e-9)
        }
        // And into the edge: the average facing of an edge is half way
        // between its two faces.
        XCTAssertGreaterThan(dot(first, normalize(Vec3(-1, 0, -1))), 0.95)
    }

    func testAFlatFaceIsPushedStraightIn() throws {
        let settings = Sculpt.Settings(radius: 0.02, strength: 1, symmetric: false)
        let direction = try XCTUnwrap(
            Sculpt.pushDirections(centre: Vec3(0, 0, 0.12), mirrorCentre: nil,
                                  radius: settings.radius, surface: template, tables: tables))
        XCTAssertEqual(direction.primary.z, 1, accuracy: 1e-9)
    }

    func testAPitIsPushedDownWhereverTheBrushLandsInIt() throws {
        // A pit seen at an angle is touched on its far wall. Pushed along
        // the far wall's own facing, a pit tunnels away from the viewer
        // stroke by stroke; measured with the facing taken over one radius,
        // it broke out through the back edge of the top face. Taken over
        // `pushNormalRadius`, the pit's surroundings count too.
        let settings = Sculpt.Settings(radius: 0.022, strength: 1, symmetric: false)
        var mesh = template!
        strokes(4, on: &mesh, from: Vec3(-0.01, 0.2, 0), to: Vec3(0.01, 0.2, 0),
                along: Vec3(0, -1, 0), passes: 6, deflating: true, settings: settings,
                preventCrossing: true)
        // The far wall: aim down the pit at an angle from the front.
        let view = normalize(Vec3(0, -0.55, -0.85))
        let hit = try XCTUnwrap(Picking.raycast(mesh, origin: Vec3(0, 0.12, 0) - view * 5, direction: view))
        let wall = normalize(hit.normal(in: mesh))
        let push = try XCTUnwrap(Sculpt.pushDirections(centre: hit.position, mirrorCentre: nil,
                                                       radius: settings.radius, surface: mesh,
                                                       tables: tables)).primary
        let up = Vec3(0, 1, 0)
        let wallTilt = acos(dot(wall, up)) * 180 / .pi
        let pushTilt = acos(dot(push, up)) * 180 / .pi
        // Measured: the wall faces 55.5 degrees off up, the push 4.5.
        XCTAssertGreaterThan(wallTilt, 35, "the aim found the floor, not the far wall")
        XCTAssertLessThan(pushTilt, 15, "the pit is pushed away from the viewer, not down")
    }

    // MARK: - Never through itself

    func testDeflatingAnEdgeNeverCrossesTheSurface() {
        let settings = Sculpt.Settings(radius: 0.06, strength: 1, symmetric: false)
        var mesh = template!
        let dabs = scribble(on: template, from: edge.a, to: edge.b, along: edge.direction,
                            passes: 6, brush: deflate(settings), settings: settings)
        XCTAssertGreaterThan(dabs.count, 10, "the aim missed the edge")
        stroke(dabs, on: &mesh, from: template)
        XCTAssertEqual(crossings(mesh), 0)
        XCTAssertGreaterThan(peak(mesh, from: template), settings.radius * 0.3,
                             "the guard must stop a crossing, not the whole stroke")
    }

    /// Scribbles the way the Pencil landed in the sixth device run: rays at
    /// the angle of the screenshot, three short back-and-forths about the
    /// middle of the top face each stroke, in a new direction every stroke.
    /// Seen at an angle, a pit is touched on its far wall — which is what
    /// makes a pushed-along-its-own-normal pit fold, and a straight-down
    /// scribble cannot show it.
    private func anglesStrokes(_ tools: [Bool], on mesh: inout MeshData,
                               settings: Sculpt.Settings, preventCrossing: Bool) {
        let view = normalize(Vec3(0.1, -0.55, -0.83))
        var generator = UInt64(7)
        func unit() -> Double {
            generator = generator &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            return Double(generator >> 11) / Double(1 << 53)
        }
        for deflating in tools {
            let reference = mesh
            var path = Sculpt.Stroke(settings: settings)
            var dabs: [Sculpt.Dab] = []
            let angle = unit() * .pi
            let along = Vec3(cos(angle), 0, sin(angle)) * 0.025
            let offset = Vec3(unit() - 0.5, 0, unit() - 0.5) * 0.02
            var last: Vec3?
            for i in 0..<90 {
                let aim = Vec3(0, 0.12, 0) + offset + along * sin(Double(i) / 89 * .pi * 6)
                guard let hit = Picking.raycast(reference, origin: aim - view * 5, direction: view)
                else { last = nil; continue }
                let travel = last.map { length(aim - $0) } ?? 0
                last = aim
                for centre in path.advance(to: hit.position, by: travel) {
                    dabs.append(Sculpt.Dab(deflating ? deflate(settings) : inflate(settings),
                                           at: centre, settings: settings))
                }
            }
            stroke(dabs, on: &mesh, from: reference, perFrame: 3, preventCrossing: preventCrossing)
        }
    }

    func testRepeatedDeflateStrokesStayCleanWithoutTheGuard() {
        // The sixth device run, headless: twenty strokes over one place on the
        // top face, a brush about two mesh spacings across. Measured WITHOUT
        // the crossing guard, because the direction alone has to keep this
        // clean or the guard would be carrying every stroke. Pushed along each
        // point's own normal, the same run crossed itself 6 times by the tenth
        // stroke and 21 by the twentieth.
        let settings = Sculpt.Settings(radius: 0.022, strength: 0.6, symmetric: true)
        var mesh = template!
        anglesStrokes(Array(repeating: true, count: 20), on: &mesh, settings: settings,
                      preventCrossing: false)
        XCTAssertGreaterThan(peak(mesh, from: template), 0.05, "the pit was never dug")
        XCTAssertEqual(crossings(mesh), 0)
    }

    func testInflatingInsideADentStaysCleanWithoutTheGuard() {
        // The other convergence: the floor of a dent is concave, so its own
        // normals point at each other, and Inflate pushed along them folded
        // the dent shut — hundreds of crossings in the headless runs.
        let settings = Sculpt.Settings(radius: 0.022, strength: 1, symmetric: true)
        var mesh = template!
        anglesStrokes(Array(repeating: true, count: 4) + Array(repeating: false, count: 12),
                      on: &mesh, settings: settings, preventCrossing: false)
        XCTAssertEqual(crossings(mesh), 0)
    }

    // MARK: - The rule on its own

    func testLimitedMove() {
        let up = Vec3(0, 0, 0.3)
        XCTAssertEqual(Sculpt.limitedMove(up, from: .zero, ceiling: 1), 1)
        XCTAssertEqual(Sculpt.limitedMove(up, from: Vec3(0, 0, 0.9), ceiling: 1), 1 / 3,
                       accuracy: 1e-12)
        XCTAssertEqual(Sculpt.limitedMove(up, from: Vec3(0, 0, 1.2), ceiling: 1), 0,
                       "a weaker dab never pulls back what a stronger one pushed")
        XCTAssertEqual(Sculpt.limitedMove(-up, from: Vec3(0, 0, 1.2), ceiling: 1), 1,
                       "a point past the ceiling may always move back inside")
        XCTAssertEqual(Sculpt.limitedMove(-up, from: Vec3(0, 0, 0.5), ceiling: 1), 1)
        // Sideways at the ceiling: any move lengthens the offset.
        XCTAssertEqual(Sculpt.limitedMove(Vec3(0.3, 0, 0), from: Vec3(0, 0, 1), ceiling: 1), 0)
        // A magnitude, not a height: diagonal moves are held to the same sphere.
        let t = Sculpt.limitedMove(Vec3(0.6, 0.8, 0), from: .zero, ceiling: 0.5)
        XCTAssertEqual(length(Vec3(0.6, 0.8, 0) * t), 0.5, accuracy: 1e-12)
        XCTAssertEqual(Sculpt.limitedMove(.zero, from: Vec3(0, 0, 2), ceiling: 1), 1)
    }
}
