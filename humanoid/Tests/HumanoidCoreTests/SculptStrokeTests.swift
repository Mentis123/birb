import XCTest
@testable import HumanoidCore

/// Stroke resampling: the fix for the spikes seen on the first device test.
///
/// The property under test is that a stroke is a function of the **path**, not
/// of how many events the runloop happened to deliver along it. Everything else
/// here follows from that.
final class SculptStrokeTests: XCTestCase {
    private var template: MeshData!
    private var tables: MeshTables!

    override func setUpWithError() throws {
        template = try TemplateFile.Bundled.clay.load().mesh
        tables = MeshTables(template)
        template.recomputeNormals(tables)
    }

    /// Samples a straight path in `count` equal steps and returns every dab.
    private func dabs(from start: Vec3, to end: Vec3, count: Int,
                      settings: Sculpt.Settings) -> [Vec3] {
        var stroke = Sculpt.Stroke(settings: settings)
        var out = [Vec3]()
        for i in 0...count {
            let t = Double(i) / Double(count)
            out.append(contentsOf: stroke.advance(to: start + (end - start) * t))
        }
        return out
    }

    private func sculpted(_ brush: Sculpt.Brush, path centres: [Vec3],
                          settings: Sculpt.Settings) -> MeshData {
        var mesh = template!
        Sculpt.apply(brush, to: &mesh, tables: tables, at: centres, settings: settings)
        return mesh
    }

    // MARK: - The invariant

    func testFiftyEventsAndTwoEventsGiveTheSameDabs() {
        let settings = Sculpt.Settings(radius: 0.03, strength: 0.5)
        let start = Vec3(-0.06, 0.02, 0.12), end = Vec3(0.06, 0.02, 0.12)
        let coarse = dabs(from: start, to: end, count: 2, settings: settings)
        let fine = dabs(from: start, to: end, count: 50, settings: settings)

        XCTAssertEqual(coarse.count, fine.count,
                       "the same path must resample to the same number of dabs")
        for (a, b) in zip(coarse, fine) {
            XCTAssertEqual(length(a - b), 0, accuracy: 1e-9)
        }
    }

    func testFiftyEventsAndTwoEventsGiveTheSameMesh() {
        // The whole point, stated on the mesh rather than on the dab list.
        let settings = Sculpt.Settings(radius: 0.05, strength: 0.6)
        let start = Vec3(-0.06, 0, 0.12), end = Vec3(0.06, 0, 0.12)
        let coarse = sculpted(.inflate(Sculpt.inflatePerDab * settings.radius),
                              path: dabs(from: start, to: end, count: 2, settings: settings),
                              settings: settings)
        let fine = sculpted(.inflate(Sculpt.inflatePerDab * settings.radius),
                            path: dabs(from: start, to: end, count: 50, settings: settings),
                            settings: settings)
        for i in 0..<coarse.vertexCount {
            XCTAssertEqual(length(coarse.positions[i] - fine.positions[i]), 0, accuracy: 1e-12,
                           "vertex \(i) differs by event count")
        }
    }

    func testAStationaryPencilEmitsNoFurtherDabs() {
        // This is the half of the fix that stops a held pen from extruding a
        // spike: with spacing-based dabs, no motion is no work.
        var stroke = Sculpt.Stroke(settings: .init(radius: 0.03))
        let point = Vec3(0, 0, 0.12)
        XCTAssertEqual(stroke.advance(to: point).count, 1, "touch-down places one dab")
        for _ in 0..<200 {
            XCTAssertTrue(stroke.advance(to: point).isEmpty)
        }
    }

    func testDabsAreEvenlySpacedAtTheConfiguredStep() {
        let settings = Sculpt.Settings(radius: 0.04)
        let centres = dabs(from: Vec3(-0.09, 0, 0.12), to: Vec3(0.09, 0, 0.12),
                           count: 37, settings: settings)
        let step = settings.radius * 0.25
        XCTAssertGreaterThan(centres.count, 10)
        for (a, b) in zip(centres, centres.dropFirst()) {
            XCTAssertEqual(length(b - a), step, accuracy: 1e-9)
        }
    }

    func testSpacingCarriesAcrossSegmentsRatherThanRestartingAtEach() {
        // Without the carry, every delivered segment restarts the count and the
        // dabs bunch at the joins.
        var stroke = Sculpt.Stroke(settings: .init(radius: 0.04))
        _ = stroke.advance(to: Vec3(0, 0, 0.12))
        var centres = [Vec3]()
        for i in 1...20 {
            centres.append(contentsOf: stroke.advance(to: Vec3(Double(i) * 0.003, 0, 0.12)))
        }
        for (a, b) in zip(centres, centres.dropFirst()) {
            XCTAssertEqual(length(b - a), 0.01, accuracy: 1e-9)
        }
    }

    // MARK: - The amount

    func testATenCentimetreStrokeStaysWithinHalfARadius() {
        // The bound that stops the spikes. Clay is a 24 cm cube, so a 10 cm
        // stroke crosses most of a face — a long stroke by this model's scale.
        let settings = Sculpt.Settings(radius: 0.03, strength: 1.0, symmetric: false)
        let start = Vec3(-0.05, 0, 0.12), end = Vec3(0.05, 0, 0.12)
        let mesh = sculpted(.inflate(Sculpt.inflatePerDab * settings.radius),
                            path: dabs(from: start, to: end, count: 40, settings: settings),
                            settings: settings)
        let peak = (0..<mesh.vertexCount)
            .map { length(mesh.positions[$0] - template.positions[$0]) }.max() ?? 0
        XCTAssertGreaterThan(peak, 0, "the stroke has to do something")
        XCTAssertLessThan(peak, settings.radius * 0.5,
                          "a 10 cm stroke at full strength moved \(peak / settings.radius) radii")
    }

    func testTheShippedBehaviourExtrudedASpikeAndTurnedTheSurfaceInsideOut() {
        // The regression's own witness, reproducing what actually shipped: one
        // dab per delivered Pencil event, at a per-*gesture* amount of 0.35,
        // with the brush centre re-raycast each event the way the editor does.
        //
        // Re-raycasting is what makes it run away. Held at a fixed world point
        // the dab self-limits, because the surface inflates out of the brush;
        // following the surface means the falloff never decays.
        //
        // The end state is the interesting part. The run does not simply build a
        // tall bump — it stops being raycastable, because `Picking` is
        // back-face culled and the extruded ring has folded through itself, so
        // there is no front face left on the axis. That is precisely the
        // "sometimes it goes inside out" from the first device test, reproduced
        // headless.
        let settings = Sculpt.Settings(radius: 0.03, strength: 1.0, symmetric: false)
        var mesh = template!
        var survived = 0
        var peakBeforeFolding = 0.0
        for _ in 0..<120 {
            guard let hit = Picking.raycast(mesh, origin: Vec3(0, 0, 5),
                                            direction: Vec3(0, 0, -1)) else { break }
            survived += 1
            peakBeforeFolding = (0..<mesh.vertexCount)
                .map { length(mesh.positions[$0] - template.positions[$0]) }.max() ?? 0
            Sculpt.apply(.inflate(0.35 * settings.radius), to: &mesh, tables: tables,
                         at: hit.position, settings: settings)
        }
        XCTAssertLessThan(survived, 120,
                          "expected the surface to fold within a second of holding still")
        XCTAssertGreaterThan(peakBeforeFolding, settings.radius * 2,
                             "expected a spike; got \(peakBeforeFolding / settings.radius) radii")
    }

    func testAHeldPencilDoesNotCreepEvenAsTheSurfaceMovesUnderIt() {
        // The same 120 events through the resampler, with the pointer stationary
        // and the surface re-raycast each time. Because the stroke is advanced
        // by *input* travel, the surface moving out of the brush is not motion
        // and buys no dabs.
        let settings = Sculpt.Settings(radius: 0.03, strength: 1.0, symmetric: false)
        var mesh = template!
        var stroke = Sculpt.Stroke(settings: settings)
        for _ in 0..<120 {
            guard let hit = Picking.raycast(mesh, origin: Vec3(0, 0, 5),
                                            direction: Vec3(0, 0, -1)) else {
                return XCTFail("the ray stopped hitting the model")
            }
            let centres = stroke.advance(to: hit.position, by: 0)
            Sculpt.apply(.inflate(Sculpt.inflatePerDab * settings.radius), to: &mesh,
                         tables: tables, at: centres, settings: settings)
        }
        let peak = (0..<mesh.vertexCount)
            .map { length(mesh.positions[$0] - template.positions[$0]) }.max() ?? 0
        XCTAssertGreaterThan(peak, 0, "touch-down still places one dab")
        XCTAssertLessThan(peak, settings.radius * 0.1,
                          "a held Pencil crept \(peak / settings.radius) radii")
    }

    func testMeasuringProgressOnTheSurfaceOverDabsAMovingStroke() {
        // Why the editor passes `by:` rather than taking the default. Reading
        // the surface means Inflate partly measures its own output, so the same
        // pointer path buys more dabs than it paid for.
        let settings = Sculpt.Settings(radius: 0.03, strength: 1.0, symmetric: false)
        let pointerStep = 0.0008

        func dabCount(useInputTravel: Bool) -> Int {
            var mesh = template!
            var stroke = Sculpt.Stroke(settings: settings)
            var total = 0
            for i in 0..<120 {
                let x = -0.048 + Double(i) * pointerStep
                guard let hit = Picking.raycast(mesh, origin: Vec3(x, 0, 5),
                                                direction: Vec3(0, 0, -1)) else { continue }
                let centres = useInputTravel
                    ? stroke.advance(to: hit.position, by: i == 0 ? 0 : pointerStep)
                    : stroke.advance(to: hit.position)
                total += centres.count
                Sculpt.apply(.inflate(Sculpt.inflatePerDab * settings.radius), to: &mesh,
                             tables: tables, at: centres, settings: settings)
            }
            return total
        }

        let honest = dabCount(useInputTravel: true)
        let selfMeasured = dabCount(useInputTravel: false)
        XCTAssertGreaterThan(honest, 5, "the run has to produce dabs to compare")
        XCTAssertGreaterThan(selfMeasured, honest,
                             "the surface metric should over-dab; got \(selfMeasured) vs \(honest)")
    }

    func testTheInflateFeedbackGainIsBelowOne() {
        // The stability condition behind the paragraph on `advance(to:by:)`.
        // A dab must move the surface by less than the spacing that earns the
        // next dab, or a stroke that measures the surface never converges. Two
        // tuning constants sit either side of this and neither is obviously
        // coupled to the other, so it is pinned here.
        let spacing = 0.25
        XCTAssertLessThan(Sculpt.inflatePerDab / spacing, 0.5,
                          "inflate per dab is closing on the dab spacing")
    }

    // MARK: - Batched application

    func testBatchedApplyMatchesDabbingOneAtATime() {
        let settings = Sculpt.Settings(radius: 0.04, strength: 0.5)
        let centres = dabs(from: Vec3(-0.05, 0, 0.12), to: Vec3(0.05, 0, 0.12),
                           count: 12, settings: settings)
        let batched = sculpted(.smooth, path: centres, settings: settings)

        var oneByOne = template!
        for centre in centres {
            Sculpt.apply(.smooth, to: &oneByOne, tables: tables, at: centre, settings: settings)
        }
        for i in 0..<batched.vertexCount {
            XCTAssertEqual(length(batched.positions[i] - oneByOne.positions[i]), 0,
                           accuracy: 1e-12, "vertex \(i)")
        }
    }

    func testTopologyAndUVsSurviveAStroke() {
        let settings = Sculpt.Settings(radius: 0.05, strength: 1)
        let centres = dabs(from: Vec3(-0.06, 0, 0.12), to: Vec3(0.06, 0.06, 0.12),
                           count: 30, settings: settings)
        let mesh = sculpted(.inflate(Sculpt.inflatePerDab * settings.radius),
                            path: centres, settings: settings)
        XCTAssertEqual(mesh.vertexCount, template.vertexCount)
        XCTAssertEqual(mesh.indices, template.indices)
        for i in 0..<mesh.vertexCount {
            XCTAssertEqual(mesh.uvs[i], template.uvs[i])
        }
    }

    func testSeamPointsStayWeldedThroughAStroke() {
        // A stroke over a cube edge must not open it.
        let settings = Sculpt.Settings(radius: 0.06, strength: 1)
        let centres = dabs(from: Vec3(0.02, 0.02, 0.12), to: Vec3(0.12, 0.02, 0.02),
                           count: 25, settings: settings)
        let mesh = sculpted(.inflate(Sculpt.inflatePerDab * settings.radius),
                            path: centres, settings: settings)
        for position in tables.seamPositions {
            let members = tables.weldMembers[position]
            let first = mesh.positions[members[0]]
            for member in members.dropFirst() {
                XCTAssertEqual(length(mesh.positions[member] - first), 0, accuracy: 1e-12,
                               "the seam at welded \(position) tore open")
            }
        }
    }
}
