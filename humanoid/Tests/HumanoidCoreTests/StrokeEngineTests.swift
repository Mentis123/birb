import XCTest
@testable import HumanoidCore

/// The stroke logic the iPad runs, driven by synthetic Pencil samples.
///
/// Everything here used to live in `EditorModel`, where no test could reach
/// it, and each test below is a defect the device found there — or would have.
/// They drive `StrokeEngine` exactly the way the editor does: a frame's samples
/// at a time, against a real clay document, through a real camera, and read the
/// result back the way the GPU or the eye would.
final class StrokeEngineTests: XCTestCase {
    private var document: Document!
    private var camera: Camera!
    /// An 11-inch iPad's drawable, landscape.
    private let viewport = Vec2(2360, 1640)

    override func setUpWithError() throws {
        document = try Document.clay(textureSize: 512)
        document.prepareForPainting()
        camera = Camera()
        camera.frame(document.mesh)
        camera.azimuth = 0
        camera.elevation = 0
    }

    private func options(_ tool: EditTool, symmetric: Bool = false,
                         radiusPoints: Double = 80) -> BrushOptions {
        BrushOptions(tool: tool, radiusPoints: radiusPoints, pointScale: 1, strength: 1,
                     symmetric: symmetric, colour: (0, 0, 255), hardness: 0.5)
    }

    /// Where a world point on the model lands on the glass.
    private func pixel(_ world: Vec3) throws -> Vec2 {
        try XCTUnwrap(camera.project(world, viewport: viewport))
    }

    /// The front-face point at (x, y), found by a ray the way the editor finds it.
    private func front(_ x: Double, _ y: Double) throws -> Picking.Hit {
        try XCTUnwrap(Picking.raycast(document.mesh, origin: Vec3(x, y, 5),
                                      direction: Vec3(0, 0, -1)))
    }

    /// A whole stroke through `points`, one sample per frame, with an optional
    /// force per sample.
    @discardableResult
    private func stroke(_ engine: inout StrokeEngine, _ points: [Vec2], forces: [Double?]? = nil,
                        options: BrushOptions, end: Bool = true) -> StrokeEngine.Effect {
        var effect = StrokeEngine.Effect()
        for (i, point) in points.enumerated() {
            let force = forces.map { $0[min(i, $0.count - 1)] } ?? nil
            let phase: StrokeSample.Phase = i == 0 ? .began : .moved
            effect.formUnion(engine.apply([StrokeSample(phase: phase, location: point, force: force,
                                                        isPencil: force != nil)],
                                          to: &document, camera: camera, viewport: viewport,
                                          options: options))
        }
        if end, let lastPoint = points.last {
            effect.formUnion(engine.apply([StrokeSample(phase: .ended, location: lastPoint)],
                                          to: &document, camera: camera, viewport: viewport,
                                          options: options))
        }
        return effect
    }

    private func line(from a: Vec2, to b: Vec2, steps: Int) -> [Vec2] {
        (0...steps).map { a + (b - a) * (Double($0) / Double(steps)) }
    }

    /// The colour the GPU shows at a surface point.
    private func shown(at hit: Picking.Hit) -> (r: UInt8, g: UInt8, b: UInt8) {
        TextureSpace.sampleTopLeft(document.albedo, at: TextureSpace.metal(hit.uv))
    }

    private func isBlue(_ c: (r: UInt8, g: UInt8, b: UInt8), within tolerance: Int = 6) -> Bool {
        Int(c.r) <= tolerance && Int(c.g) <= tolerance && Int(c.b) >= 255 - tolerance
    }

    private func isBase(_ c: (r: UInt8, g: UInt8, b: UInt8)) -> Bool {
        c.r == document.baseColour.r && c.g == document.baseColour.g && c.b == document.baseColour.b
    }

    // MARK: - Grab

    func testTheGrabbedPointStaysUnderThePencilAwayFromTheMiddleOfTheScreen() throws {
        camera.azimuth = 0.45
        camera.elevation = 0.3
        var engine = StrokeEngine()
        let start = try XCTUnwrap(camera.project(Vec3(0.07, 0.06, 0.1), viewport: viewport))
        XCTAssertNotNil(camera.pick(document.mesh, at: start, viewport: viewport))
        let points = line(from: start, to: start + Vec2(260, -170), steps: 12)
        stroke(&engine, points, forces: [0.3], options: options(.grab), end: false)

        let handle = try XCTUnwrap(engine.grabHandle)
        let landed = try pixel(handle)
        XCTAssertEqual(landed.x, points.last!.x, accuracy: 1e-6)
        XCTAssertEqual(landed.y, points.last!.y, accuracy: 1e-6)
        engine.apply([StrokeSample(phase: .ended, location: points.last!)], to: &document,
                     camera: camera, viewport: viewport, options: options(.grab))
        XCTAssertNil(engine.grabHandle)
    }

    func testAGrabAtTheFrontCentreMovesTheSurfaceWithThePencilOneToOne() throws {
        // Symmetry on, a light Pencil, the middle of the front face: the three
        // things that each cut or doubled the pull. The surface under the tip
        // has to move as far as the tip.
        var engine = StrokeEngine()
        let hit = try front(0, 0)
        let centre = (0..<document.mesh.vertexCount).min {
            length(document.mesh.positions[$0] - hit.position)
                < length(document.mesh.positions[$1] - hit.position)
        }!
        let before = document.mesh.positions[centre]
        let start = try pixel(hit.position)
        let points = line(from: start, to: start + Vec2(0, -120), steps: 10)
        stroke(&engine, points, forces: [0.04, 0.08, 0.1], options: options(.grab, symmetric: true))

        let moved = document.mesh.positions[centre] - before
        let expected = camera.worldDelta(screenDelta: Vec2(0, -120), viewport: viewport,
                                         depth: camera.viewDepth(of: hit.position))
        let ratio = length(moved) / length(expected)
        XCTAssertGreaterThan(ratio, 0.9, "the surface trailed the Pencil at \(ratio)x")
        XCTAssertLessThanOrEqual(ratio, 1.0 + 1e-9, "the surface outran the Pencil at \(ratio)x")
    }

    func testPressureDoesNotChangeAGrab() throws {
        let start = try pixel(try front(0.03, 0.02).position)
        let points = line(from: start, to: start + Vec2(90, 60), steps: 8)
        var light = try Document.clay(textureSize: 64)
        var firm = try Document.clay(textureSize: 64)
        var a = StrokeEngine(), b = StrokeEngine()
        swap(&document, &light)
        stroke(&a, points, forces: [0.02, 0.05, 0.08], options: options(.grab))
        swap(&document, &light)
        swap(&document, &firm)
        stroke(&b, points, forces: [1.0], options: options(.grab))
        swap(&document, &firm)
        XCTAssertEqual(light.mesh.positions, firm.mesh.positions)
        XCTAssertNotEqual(light.mesh.positions, document.mesh.positions, "the grab moved nothing")
    }

    // MARK: - Pressure

    func testPaintReachesFullOpacityAfterALightTouchDown() throws {
        // The shipped editor built the paint brush once, from the first sample
        // — the lightest of any Pencil stroke, because the tip is still
        // landing — so the whole stroke painted at about a third. Pressed
        // harder afterwards, it has to paint the colour.
        var engine = StrokeEngine()
        let a = try front(-0.07, 0), b = try front(0.07, 0)
        let points = line(from: try pixel(a.position), to: try pixel(b.position), steps: 30)
        let ramp: [Double?] = (0...30).map { i in min(0.9, 0.02 + Double(i) * 0.06) }
        stroke(&engine, points, forces: ramp, options: options(.paint))

        XCTAssertTrue(isBlue(shown(at: b)), "the firm end of the stroke shows \(shown(at: b))")
        let start = shown(at: a)
        XCTAssertFalse(isBlue(start), "the light start should be fainter than the firm end")
        XCTAssertFalse(isBase(start), "the light start should still paint")
    }

    func testALighterTouchPaintsASmallerMark() throws {
        func texels(force: Double) throws -> Int {
            var fresh = try Document.clay(textureSize: 512)
            fresh.prepareForPainting()
            swap(&document, &fresh)
            defer { swap(&document, &fresh) }
            var engine = StrokeEngine()
            let at = try pixel(try front(0, 0).position)
            stroke(&engine, [at, at + Vec2(1, 0), at], forces: [force], options: options(.paint))
            return engine.last.texels
        }
        let light = try texels(force: 0.05), firm = try texels(force: 0.8)
        XCTAssertGreaterThan(light, 0)
        XCTAssertLessThan(Double(light), Double(firm) * 0.4,
                          "a light touch painted \(light) texels against \(firm) for a firm one")
    }

    func testALighterTouchSculptsASmallerGentlerBump() throws {
        func displaced(force: Double?) throws -> (count: Int, deepest: Double) {
            var fresh = try Document.clay(textureSize: 64)
            swap(&document, &fresh)
            defer { swap(&document, &fresh) }
            var engine = StrokeEngine()
            let a = try pixel(try front(-0.05, 0).position), b = try pixel(try front(0.05, 0).position)
            stroke(&engine, line(from: a, to: b, steps: 40), forces: [force], options: options(.inflate))
            let template = document.template.positions
            let moves = zip(document.mesh.positions, template).map { length($0 - $1) }
            return (moves.filter { $0 > 1e-6 }.count, moves.max() ?? 0)
        }
        let light = try displaced(force: 0.05), firm = try displaced(force: 0.8)
        let finger = try displaced(force: nil)
        XCTAssertLessThan(light.count, firm.count)
        XCTAssertLessThan(light.deepest, firm.deepest * 0.5)
        XCTAssertEqual(finger.count, firm.count, "a finger reports no pressure and gets the full brush")
    }

    // MARK: - Paint

    func testSymmetricPaintAlsoPaintsTheMirrorImage() throws {
        let right = try front(0.06, 0.02), left = try front(-0.06, 0.02)
        var engine = StrokeEngine()
        let at = try pixel(right.position)
        stroke(&engine, [at, at + Vec2(1, 0)], options: options(.paint, symmetric: true))
        XCTAssertTrue(isBlue(shown(at: right)))
        XCTAssertTrue(isBlue(shown(at: left)), "the mirror shows \(shown(at: left))")

        var fresh = try Document.clay(textureSize: 512)
        fresh.prepareForPainting()
        swap(&document, &fresh)
        var once = StrokeEngine()
        stroke(&once, [at, at + Vec2(1, 0)], options: options(.paint, symmetric: false))
        XCTAssertTrue(isBase(shown(at: left)), "symmetry off still painted the mirror")
    }

    func testAStrokeThatLeavesTheModelDoesNotPaintAcrossTheGap() throws {
        // Off the top of the front face and back on again. Joined, the segment
        // runs straight from where it left to where it returned, and the
        // capsule around it paints a streak along the top of the face that the
        // Pencil never went near.
        let exit = try front(-0.08, 0.09), entry = try front(0.08, 0.09)
        let points = [try pixel(exit.position),
                      try pixel(Vec3(-0.08, 0.3, 0.12)),
                      try pixel(Vec3(0.08, 0.3, 0.12)),
                      try pixel(entry.position)]
        XCTAssertNil(camera.pick(document.mesh, at: points[1], viewport: viewport))
        var engine = StrokeEngine()
        stroke(&engine, points, options: options(.paint))
        XCTAssertTrue(isBlue(shown(at: exit)))
        XCTAssertTrue(isBlue(shown(at: entry)))
        let gap = try front(0, 0.09)
        XCTAssertTrue(isBase(shown(at: gap)), "the gap was painted: \(shown(at: gap))")
        XCTAssertGreaterThan(engine.last.lifted, 0)
    }

    func testASecondStrokeOverTheFirstBuildsUpAndUndoesSeparately() throws {
        // The document reuses one stroke's alpha buffer for the next, to keep a
        // megabyte of allocation out of every touch-down. The buffer has to
        // come back clean: a leftover alpha would stop the second stroke
        // painting anywhere the first one had.
        let at = try pixel(try front(0.02, 0.01).position)
        var brush = options(.paint)
        brush.strength = 0.5
        var engine = StrokeEngine()
        let spot = try front(0.02, 0.01)
        stroke(&engine, [at, at + Vec2(1, 0)], options: brush)
        let once = shown(at: spot)
        stroke(&engine, [at, at + Vec2(1, 0)], options: brush)
        let twice = shown(at: spot)
        XCTAssertLessThan(Int(twice.r), Int(once.r) - 20, "the second stroke did not build up")
        XCTAssertEqual(document.undoDepth, 2)
        document.undo()
        XCTAssertEqual(shown(at: spot).r, once.r)
        document.undo()
        XCTAssertTrue(isBase(shown(at: spot)))
    }

    func testPaintedStrokeIsOneUndoStep() throws {
        var engine = StrokeEngine()
        let before = document.albedo.rgba
        let a = try pixel(try front(-0.05, 0).position), b = try pixel(try front(0.05, 0).position)
        stroke(&engine, line(from: a, to: b, steps: 20), options: options(.paint))
        XCTAssertNotEqual(document.albedo.rgba, before)
        XCTAssertEqual(document.undoDepth, 1)
        document.undo()
        XCTAssertEqual(document.albedo.rgba, before)
    }

    // MARK: - Stroke lifetime

    func testAStrokeThatStartsOffTheModelArmsWhenItArrives() throws {
        var engine = StrokeEngine()
        let outside = Vec2(80, 80)
        XCTAssertNil(camera.pick(document.mesh, at: outside, viewport: viewport))
        let onto = try pixel(try front(0, 0).position)
        stroke(&engine, line(from: outside, to: onto, steps: 30), options: options(.inflate))
        XCTAssertTrue(engine.last.armed)
        XCTAssertGreaterThan(engine.last.dabs, 0)
    }

    func testANewTouchDownClosesAStrandedStroke() throws {
        var engine = StrokeEngine()
        let a = try pixel(try front(-0.04, 0).position), b = try pixel(try front(0.04, 0).position)
        stroke(&engine, line(from: a, to: b, steps: 10), options: options(.inflate), end: false)
        XCTAssertTrue(engine.isOpen)
        // No end ever arrived; the next stroke must still work, and the first
        // must still be its own undo step.
        stroke(&engine, line(from: b, to: a, steps: 10), options: options(.deflate))
        XCTAssertFalse(engine.isOpen)
        XCTAssertEqual(document.undoDepth, 2)
    }

    func testPaintJustBeforeTheStrokeRunsOffTheModelIsStillUploaded() throws {
        // The last sample on the model and the first one off it, in ONE frame.
        // The lift applies the paint queued before it, and the upload for that
        // paint used to be dropped with the lift's return value: the dab at the
        // model's edge stayed invisible until something else re-uploaded.
        var engine = StrokeEngine()
        let start = try front(-0.02, 0.09), last = try front(0.02, 0.09)
        let off = try pixel(Vec3(0.02, 0.3, 0.12))
        XCTAssertNil(camera.pick(document.mesh, at: off, viewport: viewport))
        let brush = options(.paint)
        engine.apply([StrokeSample(phase: .began, location: try pixel(start.position))],
                     to: &document, camera: camera, viewport: viewport, options: brush)
        _ = engine.takePaintDirty()
        let effect = engine.apply([StrokeSample(phase: .moved, location: try pixel(last.position)),
                                   StrokeSample(phase: .moved, location: off)],
                                  to: &document, camera: camera, viewport: viewport, options: brush)
        XCTAssertTrue(effect.contains(.texture), "this frame's paint never reached the GPU")
        let dirty = engine.takePaintDirty()
        let texel = TextureSpace.texel(of: last.uv, width: document.albedo.width,
                                       height: document.albedo.height)
        XCTAssertTrue(texel.x >= dirty.minX && texel.x <= dirty.maxX
                      && texel.y >= dirty.minY && texel.y <= dirty.maxY,
                      "the dab at the edge is outside the rectangle uploaded")
        XCTAssertTrue(isBlue(shown(at: last)))
    }

    // MARK: - Gestures that were not strokes

    func testADiscardedStrokeLeavesTheShapeAndTheHistoryAsTheyWere() throws {
        // A palm on the model before the Pencil landed: it has already run a
        // stroke by the time anything can tell it was a palm.
        var engine = StrokeEngine()
        let a = try pixel(try front(-0.04, 0).position), b = try pixel(try front(0.04, 0).position)
        stroke(&engine, line(from: a, to: b, steps: 10), options: options(.inflate))
        let sculpted = document.mesh.positions
        document.undo()
        let original = document.mesh.positions
        let originalNormals = document.mesh.normals
        XCTAssertTrue(document.canRedo)

        stroke(&engine, line(from: b, to: a, steps: 10), options: options(.inflate), end: false)
        XCTAssertNotEqual(document.mesh.positions, original, "the palm's stroke moved nothing")
        let effect = engine.discard(&document)
        XCTAssertTrue(effect.contains(.mesh))
        XCTAssertFalse(engine.isOpen)
        XCTAssertTrue(engine.last.discarded)
        XCTAssertEqual(document.mesh.positions, original)
        let worstNormal = zip(document.mesh.normals, originalNormals).map { length($0 - $1) }.max() ?? 0
        XCTAssertLessThan(worstNormal, 1e-9, "the normals still describe the palm's bump")
        XCTAssertEqual(document.undoDepth, 0)
        XCTAssertTrue(document.canRedo, "throwing a gesture away must not cost the redo branch")
        document.redo()
        let worst = zip(document.mesh.positions, sculpted).map { length($0 - $1) }.max() ?? 0
        XCTAssertLessThan(worst, 1e-12)
    }

    func testATwoFingerTapsFirstFingerIsTakenBackBeforeTheUndo() throws {
        // The first finger of the tap lands on the model and Inflate dabs a
        // bump at touch-down; the second finger makes it a tap, which means
        // undo. Closed and undone instead of discarded, the tap would take
        // back its own bump and leave the stroke it was aimed at.
        var engine = StrokeEngine()
        let original = document.mesh.positions
        let a = try pixel(try front(-0.04, 0).position), b = try pixel(try front(0.04, 0).position)
        stroke(&engine, line(from: a, to: b, steps: 10), options: options(.inflate))
        let tap = try pixel(try front(0.02, 0.05).position)
        let sculpted = document.mesh.positions
        engine.apply([StrokeSample(phase: .began, location: tap)], to: &document, camera: camera,
                     viewport: viewport, options: options(.inflate))
        XCTAssertNotEqual(document.mesh.positions, sculpted, "the tap's finger dabbed nothing")
        engine.discard(&document)
        document.undo()
        XCTAssertEqual(document.mesh.positions, original)
        XCTAssertFalse(document.canUndo)
    }

    func testADiscardedPaintStrokeLeavesNoPaintAndIsUploadedBack() throws {
        var engine = StrokeEngine()
        let before = document.albedo.rgba
        let a = try pixel(try front(-0.05, 0).position), b = try pixel(try front(0.05, 0).position)
        stroke(&engine, line(from: a, to: b, steps: 12), options: options(.paint, symmetric: true),
               end: false)
        XCTAssertNotEqual(document.albedo.rgba, before)
        _ = engine.takePaintDirty()
        let effect = engine.discard(&document)
        XCTAssertEqual(document.albedo.rgba, before)
        XCTAssertTrue(effect.contains(.texture))
        XCTAssertFalse(engine.takePaintDirty().isEmpty, "the GPU would go on showing the paint")
        XCTAssertEqual(document.undoDepth, 0)
        // The next stroke paints normally over the reused buffer.
        stroke(&engine, line(from: a, to: b, steps: 12), options: options(.paint))
        XCTAssertTrue(isBlue(shown(at: try front(0, 0))))
        XCTAssertEqual(document.undoDepth, 1)
    }

    func testADiscardedGrabPutsTheSurfaceBack() throws {
        var engine = StrokeEngine()
        let original = document.mesh.positions
        let start = try pixel(try front(0, 0).position)
        stroke(&engine, line(from: start, to: start + Vec2(0, -120), steps: 6),
               options: options(.grab, symmetric: true), end: false)
        XCTAssertNotEqual(document.mesh.positions, original)
        engine.discard(&document)
        XCTAssertEqual(document.mesh.positions, original)
        XCTAssertNil(engine.grabHandle)
        XCTAssertEqual(document.undoDepth, 0)
        stroke(&engine, line(from: start, to: start + Vec2(0, -60), steps: 3), options: options(.grab))
        XCTAssertEqual(document.undoDepth, 1, "the next Grab did not record")
    }

    func testTheToolIsFixedAtTouchDown() throws {
        var engine = StrokeEngine()
        let a = try pixel(try front(-0.04, 0).position), b = try pixel(try front(0.04, 0).position)
        let points = line(from: a, to: b, steps: 10)
        engine.apply([StrokeSample(phase: .began, location: points[0])], to: &document,
                     camera: camera, viewport: viewport, options: options(.inflate))
        // A double tap switched the tool mid-stroke.
        let switched = options(.paint)
        for p in points.dropFirst() {
            engine.apply([StrokeSample(phase: .moved, location: p)], to: &document,
                         camera: camera, viewport: viewport, options: switched)
        }
        engine.apply([StrokeSample(phase: .ended, location: points.last!)], to: &document,
                     camera: camera, viewport: viewport, options: switched)
        XCTAssertEqual(engine.last.tool, .inflate)
        XCTAssertEqual(engine.last.texels, 0)
        XCTAssertNotEqual(document.mesh.positions, document.template.positions)
    }

    func testTheBrushIsTheSizeOnScreenItClaimsEvenInTheCorner() throws {
        camera.azimuth = 0.5
        camera.elevation = 0.35
        let engine = StrokeEngine()
        let corner = try XCTUnwrap(camera.project(Vec3(0.1, 0.1, 0.1), viewport: viewport))
        let brush = options(.inflate, radiusPoints: 60)
        let contact = try XCTUnwrap(engine.contact(at: corner, document: document, camera: camera,
                                                   viewport: viewport, options: brush))
        let centre = try pixel(contact.position)
        let rim = try pixel(contact.position + camera.right * contact.fullRadius)
        XCTAssertEqual(length(rim - centre), 60, accuracy: 1e-6)
    }

    func testTheHoverRingShowsThePressureRangeExceptForGrab() throws {
        let engine = StrokeEngine()
        let at = try pixel(try front(0, 0).position)
        var brush = options(.paint)
        let paint = try XCTUnwrap(engine.contact(at: at, document: document, camera: camera,
                                                 viewport: viewport, options: brush))
        XCTAssertEqual(paint.lightestRadius, paint.fullRadius * brush.pressure.minimumSize,
                       accuracy: 1e-12)
        brush.pressure.sizeFollowsPressure = false
        let fixed = try XCTUnwrap(engine.contact(at: at, document: document, camera: camera,
                                                 viewport: viewport, options: brush))
        XCTAssertEqual(fixed.lightestRadius, fixed.fullRadius)
        let grab = try XCTUnwrap(engine.contact(at: at, document: document, camera: camera,
                                                viewport: viewport, options: options(.grab)))
        XCTAssertEqual(grab.lightestRadius, grab.fullRadius, "Grab ignores pressure, ring included")
    }

    func testHowTheSamplesAreBatchedIntoFramesDoesNotChangeTheShape() throws {
        // A 240 Hz Pencil against a 120 Hz display delivers two or three
        // samples a frame; a hitch delivers dozens. The same path has to make
        // the same shape either way — to within what the surface itself moved
        // under the later samples, which is the one thing batching can change.
        let a = try pixel(try front(-0.06, 0.01).position), b = try pixel(try front(0.06, 0.01).position)
        let points = line(from: a, to: b, steps: 48)
        var shapes: [[Vec3]] = []
        for perFrame in [1, 3, 49] {
            var doc = try Document.clay(textureSize: 64)
            swap(&document, &doc)
            var engine = StrokeEngine()
            var samples = [StrokeSample(phase: .began, location: points[0])]
            samples += points.dropFirst().map { StrokeSample(phase: .moved, location: $0) }
            samples.append(StrokeSample(phase: .ended, location: points.last!))
            var i = 0
            while i < samples.count {
                let frame = Array(samples[i..<min(samples.count, i + perFrame)])
                engine.apply(frame, to: &document, camera: camera, viewport: viewport,
                             options: options(.inflate))
                i += perFrame
            }
            shapes.append(document.mesh.positions)
            swap(&document, &doc)
        }
        for other in shapes.dropFirst() {
            let worst = zip(shapes[0], other).map { length($0 - $1) }.max() ?? 0
            XCTAssertLessThan(worst, 1e-9, "batching changed the shape by \(worst * 1000) mm")
        }
    }
}
