import XCTest
@testable import HumanoidCore

/// "Grabbing just doesn't work well", taken apart into the three things that
/// were each wrong and measured one at a time.
///
/// 1. **The depth was the ray length.** A drag is converted to metres at the
///    grabbed point's depth, and the editor handed over `Hit.distance`, which
///    runs along the picking ray — longer than the view depth by 1/cos of the
///    angle off-axis. The surface outran the Pencil everywhere but the middle
///    of the screen.
/// 2. **The halves of a symmetric grab added.** The front face's centre is the
///    mirror plane, and there both halves held the same vertices, so the
///    surface moved TWICE as far as the Pencil.
/// 3. **Pressure scaled the pull** — covered by the stroke engine's tests,
///    because it was an editor decision rather than a brush one.
final class GrabTrackingTests: XCTestCase {
    private var mesh: MeshData!
    private var tables: MeshTables!
    private let landscape = Vec2(2360, 1640)

    override func setUpWithError() throws {
        mesh = try TemplateFile.Bundled.clay.load().mesh
        tables = MeshTables(mesh)
        mesh.recomputeNormals(tables)
    }

    private func camera() -> Camera {
        var camera = Camera()
        camera.frame(mesh)
        camera.azimuth = 0.35
        camera.elevation = 0.25
        return camera
    }

    // MARK: - 1. Depth

    func testADragAtTheViewDepthKeepsAnOffCentrePointUnderThePointer() throws {
        let camera = camera()
        // Near the corner of the screen, where the ray is furthest off-axis.
        for start in [Vec2(1900, 1300), Vec2(300, 200), Vec2(1180, 820)] {
            let r = camera.ray(through: start, viewport: landscape)
            let anchor = r.origin + r.direction * (camera.distance * 0.9)
            let drag = Vec2(-140, 95)
            let moved = anchor + camera.worldDelta(screenDelta: drag, viewport: landscape,
                                                   depth: camera.viewDepth(of: anchor))
            let landed = try XCTUnwrap(camera.project(moved, viewport: landscape))
            XCTAssertEqual(landed.x, start.x + drag.x, accuracy: 1e-6)
            XCTAssertEqual(landed.y, start.y + drag.y, accuracy: 1e-6)
        }
    }

    func testTheRayLengthOvershotTowardTheCorners() throws {
        // The shipped conversion, reproduced, so the size of the error is on
        // record: in the corner of a landscape iPad it outran the Pencil by
        // about a fifth.
        let camera = camera()
        let start = Vec2(2300, 1600)
        let r = camera.ray(through: start, viewport: landscape)
        let rayLength = camera.distance * 0.9
        let anchor = r.origin + r.direction * rayLength
        let drag = Vec2(200, 0)
        let moved = anchor + camera.worldDelta(screenDelta: drag, viewport: landscape,
                                               depth: rayLength)
        let landed = try XCTUnwrap(camera.project(moved, viewport: landscape))
        let overshoot = (landed.x - start.x) / drag.x
        XCTAssertGreaterThan(overshoot, 1.15, "the ray-length depth used to overshoot here")
    }

    // MARK: - 2. Symmetry on the plane

    private let onPlane = Vec3(0, 0.01, 0.12)

    private func nearest(to point: Vec3) -> Int {
        (0..<mesh.vertexCount).min {
            length(mesh.positions[$0] - point) < length(mesh.positions[$1] - point)
        }!
    }

    func testASymmetricGrabOnTheMirrorPlaneMovesTheSurfaceOnceNotTwice() {
        let pull = Vec3(0, 0.012, 0.004)
        let settings = Sculpt.Settings(radius: 0.04, strength: 1, symmetric: true)
        let centre = nearest(to: onPlane)
        let at = mesh.positions[centre]

        var perDab = mesh!
        Sculpt.apply(.grab(pull), to: &perDab, tables: tables, at: at, settings: settings)
        let moved = perDab.positions[centre] - mesh.positions[centre]
        XCTAssertEqual(moved.y, pull.y, accuracy: 1e-9, "the halves added: \(moved.y / pull.y)x")
        XCTAssertEqual(moved.z, pull.z, accuracy: 1e-9)

        var captured = mesh!
        let set = Sculpt.captureGrab(at: at, mesh: captured, tables: tables, settings: settings)
        Sculpt.apply(set, displacement: pull, to: &captured, tables: tables)
        let held = captured.positions[centre] - mesh.positions[centre]
        XCTAssertEqual(held.y, pull.y, accuracy: 1e-9, "the captured halves added: \(held.y / pull.y)x")
    }

    func testOnThePlaneTheSidewaysHalvesCancelSoTheMiddleStaysOnIt() {
        // A symmetric model cannot move its centre line sideways; that is what
        // symmetric means. The up-down part is kept whole.
        let settings = Sculpt.Settings(radius: 0.04, strength: 1, symmetric: true)
        let centre = nearest(to: onPlane)
        var working = mesh!
        Sculpt.apply(.grab(Vec3(0.01, 0.01, 0)), to: &working, tables: tables,
                     at: mesh.positions[centre], settings: settings)
        let moved = working.positions[centre] - mesh.positions[centre]
        XCTAssertEqual(moved.x, 0, accuracy: 1e-12)
        XCTAssertEqual(moved.y, 0.01, accuracy: 1e-9)
    }

    func testNoVertexEverMovesFurtherThanThePointerNearThePlane() {
        // Off the plane by less than a radius, the halves overlap. Summed, the
        // overlap moved up to twice as far as the pull; blended, never further.
        let pull = Vec3(0.003, 0.01, 0.002)
        for offset in [0.0, 0.004, 0.01, 0.02, 0.035] {
            let settings = Sculpt.Settings(radius: 0.04, strength: 1, symmetric: true)
            var working = mesh!
            Sculpt.apply(.grab(pull), to: &working, tables: tables,
                         at: Vec3(offset, 0.01, 0.12), settings: settings)
            let furthest = zip(working.positions, mesh.positions).map { length($0 - $1) }.max() ?? 0
            XCTAssertLessThanOrEqual(furthest, length(pull) + 1e-12,
                                     "offset \(offset): a vertex moved \(furthest / length(pull))x the pull")
        }
    }

    func testASymmetricInflateOnThePlaneIsExactlyTheOneSidedOne() {
        // A brush centred on the plane is its own mirror, so symmetry must add
        // nothing to it. The shipped form ran it twice.
        let at = mesh.positions[nearest(to: onPlane)]
        var symmetric = mesh!
        var oneSided = mesh!
        Sculpt.apply(.inflate(0.006), to: &symmetric, tables: tables, at: at,
                     settings: .init(radius: 0.04, strength: 1, symmetric: true))
        Sculpt.apply(.inflate(0.006), to: &oneSided, tables: tables, at: at,
                     settings: .init(radius: 0.04, strength: 1, symmetric: false))
        for i in 0..<mesh.vertexCount {
            XCTAssertEqual(length(symmetric.positions[i] - oneSided.positions[i]), 0, accuracy: 1e-12,
                           "vertex \(i) differs: symmetry doubled the inflate")
        }
    }

    func testTheBlendIsSymmetricAndReducesToEachHalfAlone() {
        XCTAssertEqual(Sculpt.symmetricWeight(primary: 0.7, mirror: 0), 0.7)
        XCTAssertEqual(Sculpt.symmetricWeight(primary: 0, mirror: 0.4), 0.4)
        XCTAssertEqual(Sculpt.symmetricWeight(primary: 0.6, mirror: 0.6), 0.6, accuracy: 1e-15)
        XCTAssertEqual(Sculpt.symmetricWeight(primary: 0.3, mirror: 0.8),
                       Sculpt.symmetricWeight(primary: 0.8, mirror: 0.3))
        for (a, b) in [(0.9, 0.2), (0.5, 0.49), (1.0, 1.0), (0.01, 0.99)] {
            XCTAssertLessThanOrEqual(Sculpt.symmetricWeight(primary: a, mirror: b), max(a, b) + 1e-15)
        }
        XCTAssertEqual(Sculpt.mirrorShare(primary: 0.5, mirror: 0.5), 0.5)
        XCTAssertEqual(Sculpt.mirrorShare(primary: 0.5, mirror: 0), 0)
        XCTAssertEqual(Sculpt.mirrorShare(primary: 0, mirror: 0.5), 1)
    }
}
