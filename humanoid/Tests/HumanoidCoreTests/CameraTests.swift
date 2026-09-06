import XCTest
@testable import HumanoidCore

/// The viewport's arithmetic, tested without a viewport.
///
/// Every failure here presents to a user as "the brush paints in the wrong
/// place" or "the model flips over", never as a maths error, so it is worth
/// pinning each property directly.
final class CameraTests: XCTestCase {
    private var mesh: MeshData!

    override func setUpWithError() throws {
        mesh = try TemplateFile.Bundled.clay.load().mesh
    }

    func testAtZeroAzimuthTheCameraSitsOnThePlusZSideLookingBack() {
        let camera = Camera(distance: 1, azimuth: 0, elevation: 0)
        XCTAssertEqual(camera.eye.z, 1, accuracy: 1e-12)
        XCTAssertEqual(camera.eye.x, 0, accuracy: 1e-12)
        XCTAssertEqual(camera.eye.y, 0, accuracy: 1e-12)
        // The model faces +Z, so this is the side that shows its front.
        XCTAssertEqual(camera.forward.z, -1, accuracy: 1e-12)
    }

    func testTheBasisIsOrthonormalAtEveryAngle() {
        for azimuth in stride(from: -3.0, through: 3.0, by: 0.5) {
            for elevation in stride(from: -1.5, through: 1.5, by: 0.3) {
                let camera = Camera(distance: 1, azimuth: azimuth, elevation: elevation)
                let r = camera.right, u = camera.up, f = camera.forward
                XCTAssertEqual(length(r), 1, accuracy: 1e-9)
                XCTAssertEqual(length(u), 1, accuracy: 1e-9)
                XCTAssertEqual(length(f), 1, accuracy: 1e-9)
                XCTAssertEqual(dot(r, u), 0, accuracy: 1e-9)
                XCTAssertEqual(dot(r, f), 0, accuracy: 1e-9)
                XCTAssertEqual(dot(u, f), 0, accuracy: 1e-9)
            }
        }
    }

    func testElevationCannotReachThePole() {
        var camera = Camera()
        for _ in 0..<100 { camera.orbit(dx: 0, dy: 1.0) }
        XCTAssertLessThanOrEqual(camera.elevation, Camera.elevationLimit)
        // At an exact pole the up vector and the view direction are parallel and
        // the basis collapses, which reads as the model flipping over.
        XCTAssertEqual(length(camera.up), 1, accuracy: 1e-9)
        for _ in 0..<200 { camera.orbit(dx: 0, dy: -1.0) }
        XCTAssertGreaterThanOrEqual(camera.elevation, -Camera.elevationLimit)
        XCTAssertEqual(length(camera.up), 1, accuracy: 1e-9)
    }

    func testOrbitingKeepsTheTargetAndDistanceFixed() {
        var camera = Camera(target: Vec3(0.1, 0.2, 0.3), distance: 0.7)
        camera.orbit(dx: 0.3, dy: -0.2)
        XCTAssertEqual(length(camera.eye - camera.target), 0.7, accuracy: 1e-9)
        XCTAssertEqual(length(camera.target - Vec3(0.1, 0.2, 0.3)), 0, accuracy: 1e-12)
    }

    func testZoomIsMultiplicativeAndClamped() {
        var camera = Camera(distance: 1)
        camera.zoom(by: 2)
        XCTAssertEqual(camera.distance, 0.5, accuracy: 1e-12)
        camera.zoom(by: 0.5)
        XCTAssertEqual(camera.distance, 1.0, accuracy: 1e-12)
        for _ in 0..<50 { camera.zoom(by: 2) }
        XCTAssertGreaterThanOrEqual(camera.distance, 0.05)
        for _ in 0..<100 { camera.zoom(by: 0.5) }
        XCTAssertLessThanOrEqual(camera.distance, 5)
    }

    func testFramingFitsTheWholeModelAtEveryAngle() {
        var camera = Camera()
        camera.frame(mesh)
        // The cube's corners are the test: framing on the axis-aligned extent
        // instead of the bounding radius lets a corner-on view overflow.
        let radius = mesh.positions.map { length($0 - camera.target) }.max()!
        for azimuth in stride(from: 0.0, through: 6.0, by: 0.4) {
            camera.azimuth = azimuth
            let halfAngle = camera.fieldOfView / 2
            let fits = asin(min(1, radius / camera.distance)) < halfAngle
            XCTAssertTrue(fits, "the model overflows the view at azimuth \(azimuth)")
        }
    }

    // MARK: - Projection

    func testProjectionMapsIntoMetalsZeroToOneClipRange() {
        let camera = Camera(distance: 1, near: 0.1, far: 10)
        let projection = camera.projectionMatrix(aspect: 1.5)

        // A point on the near plane lands at z/w = 0, one on the far plane at 1.
        // Using OpenGL's -1...1 form here clips the near half of everything away
        // and the scene renders hollow.
        for (depth, expected) in [(0.1, 0.0), (10.0, 1.0), (1.0, nil as Double?)] {
            let p = [0.0, 0.0, -depth, 1.0]
            var out = [Double](repeating: 0, count: 4)
            for row in 0..<4 {
                for col in 0..<4 { out[row] += projection.m[col * 4 + row] * p[col] }
            }
            XCTAssertEqual(out[3], depth, accuracy: 1e-9, "w should be the view-space depth")
            if let expected {
                XCTAssertEqual(out[2] / out[3], expected, accuracy: 1e-9)
            } else {
                let ndc = out[2] / out[3]
                XCTAssertGreaterThan(ndc, 0)
                XCTAssertLessThan(ndc, 1)
            }
        }
    }

    func testTheViewMatrixPutsTheTargetOnTheNegativeZAxis() {
        let camera = Camera(target: Vec3(0.1, 0, 0), distance: 0.8, azimuth: 0.7, elevation: 0.3)
        let inView = camera.viewMatrix.transform(point: camera.target)
        XCTAssertEqual(inView.x, 0, accuracy: 1e-9)
        XCTAssertEqual(inView.y, 0, accuracy: 1e-9)
        XCTAssertEqual(inView.z, -0.8, accuracy: 1e-9)
    }

    // MARK: - Picking

    func testARayThroughTheScreenCentreHitsTheModelCentre() throws {
        var camera = Camera()
        camera.frame(mesh)
        let viewport = Vec2(1000, 800)
        let hit = try XCTUnwrap(camera.pick(mesh, at: Vec2(500, 400), viewport: viewport))
        // Straight at the target, so the hit is on the line from eye to target.
        let toHit = normalize(hit.position - camera.eye)
        XCTAssertGreaterThan(dot(toHit, camera.forward), 0.9999)
    }

    func testScreenYIsFlippedRelativeToWorldUp() throws {
        // UIKit's origin is top left. Getting this wrong mirrors every stroke
        // vertically, and nobody notices until they paint near the top.
        var camera = Camera(azimuth: 0, elevation: 0)
        camera.frame(mesh)
        let viewport = Vec2(1000, 1000)
        let high = try XCTUnwrap(camera.pick(mesh, at: Vec2(500, 300), viewport: viewport))
        let low = try XCTUnwrap(camera.pick(mesh, at: Vec2(500, 700), viewport: viewport))
        XCTAssertGreaterThan(high.position.y, low.position.y,
                             "a touch nearer the top of the screen must hit higher on the model")
    }

    func testScreenXIsNotFlipped() throws {
        var camera = Camera(azimuth: 0, elevation: 0)
        camera.frame(mesh)
        let viewport = Vec2(1000, 1000)
        let left = try XCTUnwrap(camera.pick(mesh, at: Vec2(300, 500), viewport: viewport))
        let right = try XCTUnwrap(camera.pick(mesh, at: Vec2(700, 500), viewport: viewport))
        // Right-handed, Y up, looking along -Z: `right` is +X, so world +X is on
        // the RIGHT of the screen. (Unity is left-handed and lands the other way
        // round; that convention does not apply on this side of the exporter.)
        XCTAssertLessThan(left.position.x, right.position.x)
    }

    func testATouchOffTheModelPicksNothing() {
        var camera = Camera()
        camera.frame(mesh)
        XCTAssertNil(camera.pick(mesh, at: Vec2(5, 5), viewport: Vec2(1000, 1000)))
    }

    func testPickingIsStableAsTheCameraOrbits() throws {
        // Whatever angle you look from, the centre of the screen hits the model
        // and the hit is in front of the camera.
        var camera = Camera()
        camera.frame(mesh)
        for azimuth in stride(from: 0.0, through: 6.0, by: 0.5) {
            for elevation in [-1.0, 0.0, 1.0] {
                camera.azimuth = azimuth
                camera.elevation = elevation
                let hit = try XCTUnwrap(camera.pick(mesh, at: Vec2(400, 400),
                                                    viewport: Vec2(800, 800)),
                                        "missed at azimuth \(azimuth) elevation \(elevation)")
                XCTAssertGreaterThan(hit.distance, 0)
                XCTAssertGreaterThan(dot(hit.position - camera.eye, camera.forward), 0)
            }
        }
    }

    func testAWorldDeltaMatchesWhatTheFingerCovers() {
        let camera = Camera(distance: 1, azimuth: 0, elevation: 0)
        let viewport = Vec2(1000, 1000)
        // Dragging the full height of the screen at the target's depth must move
        // a point by the full visible height there.
        let delta = camera.worldDelta(screenDelta: Vec2(0, -1000), viewport: viewport, depth: 1)
        XCTAssertEqual(length(delta), 2 * tan(camera.fieldOfView / 2), accuracy: 1e-9)
        // Dragging up the screen moves the point up in the world.
        XCTAssertGreaterThan(dot(normalize(delta), camera.up), 0.9999)
    }

    func testDragDistanceScalesWithZoom() {
        let near = Camera(distance: 0.2)
        let far = Camera(distance: 2.0)
        let viewport = Vec2(1000, 1000)
        let a = length(near.worldDelta(screenDelta: Vec2(100, 0), viewport: viewport,
                                       depth: near.distance))
        let b = length(far.worldDelta(screenDelta: Vec2(100, 0), viewport: viewport,
                                      depth: far.distance))
        XCTAssertEqual(b / a, 10, accuracy: 0.01,
                       "the same finger travel must cover ten times the distance when ten times as far away")
    }

    func testPanningTracksTheFinger() {
        var camera = Camera(distance: 1, azimuth: 0, elevation: 0)
        let before = camera.target
        camera.pan(dx: 0.1, dy: 0)
        // Dragging right moves the target left, so the model appears to follow.
        XCTAssertLessThan(dot(camera.target - before, camera.right), 0)
    }
}
