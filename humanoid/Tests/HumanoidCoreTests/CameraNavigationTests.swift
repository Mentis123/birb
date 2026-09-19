import XCTest
@testable import HumanoidCore

/// The two-finger camera, stated as measurements rather than as claims about
/// the camera's internals.
///
/// Every rule here is phrased through `project`, which is the exact inverse of
/// the ray the brush is picked with. That matters: the complaint these fix was
/// "the controls don't quite work right when I use two fingers", and the only
/// way to make that a test is to say where a world point lands on the glass
/// before and after the gesture.
///
/// The viewport is deliberately LANDSCAPE in most of them. The bug they were
/// written against — pan normalising x by the width and y by the height while
/// scaling both by the vertical extent — is exactly zero on a square view.
final class CameraNavigationTests: XCTestCase {
    private let landscape = Vec2(1400, 900)

    private func framed() throws -> Camera {
        var camera = Camera()
        camera.frame(try TemplateFile.Bundled.clay.load().mesh)
        camera.azimuth = 0.6
        camera.elevation = 0.35
        return camera
    }

    // MARK: - The oracle itself

    func testProjectInvertsRay() throws {
        let camera = try framed()
        for point in [Vec2(700, 450), Vec2(120, 60), Vec2(1300, 880), Vec2(1000, 200)] {
            let r = camera.ray(through: point, viewport: landscape)
            let world = r.origin + r.direction * 0.7
            let back = try XCTUnwrap(camera.project(world, viewport: landscape))
            XCTAssertEqual(back.x, point.x, accuracy: 1e-6)
            XCTAssertEqual(back.y, point.y, accuracy: 1e-6)
        }
    }

    func testProjectRejectsAPointBehindTheCamera() throws {
        let camera = try framed()
        XCTAssertNil(camera.project(camera.eye - camera.forward * 0.5, viewport: landscape))
    }

    // MARK: - Pan

    func testPanMovesTheModelExactlyAsFarAsTheFingers() throws {
        // The one that fails on the aspect ratio. A drag of 120 px across and
        // 90 px down has to move a world point 120 px across and 90 px down, on
        // a view that is not square.
        var camera = try framed()
        let before = try XCTUnwrap(camera.project(camera.pivot, viewport: landscape))
        camera.pan(pixels: Vec2(120, 90), viewportHeight: landscape.y)
        let after = try XCTUnwrap(camera.project(camera.pivot, viewport: landscape))
        XCTAssertEqual(after.x - before.x, 120, accuracy: 1e-6)
        XCTAssertEqual(after.y - before.y, 90, accuracy: 1e-6)
    }

    func testPanDoesNotRotateOrZoom() throws {
        var camera = try framed()
        let forward = camera.forward, distance = camera.distance
        camera.pan(pixels: Vec2(-200, 40), viewportHeight: landscape.y)
        XCTAssertEqual(dot(camera.forward, forward), 1, accuracy: 1e-12)
        XCTAssertEqual(camera.distance, distance, accuracy: 1e-12)
    }

    func testPanIsReversible() throws {
        var camera = try framed()
        let eye = camera.eye
        camera.pan(pixels: Vec2(310, -150), viewportHeight: landscape.y)
        camera.pan(pixels: Vec2(-310, 150), viewportHeight: landscape.y)
        XCTAssertEqual(length(camera.eye - eye), 0, accuracy: 1e-12)
    }

    // MARK: - Zoom

    func testZoomKeepsThePointUnderTheFingersStill() throws {
        var camera = try framed()
        let fingers = Vec2(1040, 280)
        // The world point currently under the fingers, in the view plane.
        let anchor = camera.viewPlaneOffset(of: fingers, viewport: landscape)
        let world = camera.lookAt + camera.right * anchor.x + camera.up * anchor.y

        for factor in [1.8, 0.55, 1.05] {
            camera.zoom(by: factor, about: fingers, viewport: landscape)
            let where_ = try XCTUnwrap(camera.project(world, viewport: landscape))
            XCTAssertEqual(where_.x, fingers.x, accuracy: 1e-6,
                           "the model slid sideways under a pinch of \(factor)")
            XCTAssertEqual(where_.y, fingers.y, accuracy: 1e-6)
        }
    }

    func testZoomAboutTheCentreIsAPlainZoom() throws {
        var anchored = try framed()
        var plain = anchored
        anchored.zoom(by: 1.6, about: Vec2(700, 450), viewport: landscape)
        plain.zoom(by: 1.6)
        XCTAssertEqual(anchored.distance, plain.distance, accuracy: 1e-12)
        XCTAssertEqual(length(anchored.offset - plain.offset), 0, accuracy: 1e-12)
    }

    func testAZoomThatHitsTheLimitDoesNotSlideTheView() throws {
        var camera = try framed()
        for _ in 0..<40 { camera.zoom(by: 2, about: Vec2(1300, 120), viewport: landscape) }
        XCTAssertEqual(camera.distance, camera.minDistance, accuracy: 1e-12)
        let offset = camera.offset
        let eye = camera.eye
        camera.zoom(by: 2, about: Vec2(1300, 120), viewport: landscape)
        // Pinned at the limit, a further pinch must be a no-op, not a pan.
        XCTAssertEqual(length(camera.offset - offset), 0, accuracy: 1e-12)
        XCTAssertEqual(length(camera.eye - eye), 0, accuracy: 1e-12)
    }

    func testZoomLimitsComeFromTheModelNotFromAConstant() throws {
        var camera = Camera()
        camera.frame(centre: .zero, radius: 2.0)
        XCTAssertGreaterThan(camera.maxDistance, 5, "a big model must still be viewable whole")
        camera.frame(centre: .zero, radius: 0.02)
        XCTAssertLessThan(camera.minDistance, 0.05, "a small model must still be approachable")
    }

    // MARK: - Pivot

    func testSettingThePivotDoesNotMoveTheEye() throws {
        var camera = try framed()
        camera.pan(pixels: Vec2(90, -40), viewportHeight: landscape.y)
        let eye = camera.eye, forward = camera.forward
        let target = camera.eye + camera.forward * (camera.distance * 0.8)
                   + camera.right * 0.03 - camera.up * 0.02

        XCTAssertTrue(camera.setPivot(to: target))
        XCTAssertEqual(length(camera.eye - eye), 0, accuracy: 1e-12,
                       "re-pivoting must be invisible until the next orbit")
        XCTAssertEqual(dot(camera.forward, forward), 1, accuracy: 1e-12)
        XCTAssertEqual(length(camera.pivot - target), 0, accuracy: 1e-12)
    }

    func testAfterRePivotingTheOrbitTurnsAroundTheNewPoint() throws {
        var camera = try framed()
        let target = camera.eye + camera.forward * (camera.distance * 0.75)
                   + camera.right * 0.04
        camera.setPivot(to: target)
        let radius = length(camera.eye - target)
        for _ in 0..<12 { camera.orbit(dx: 0.15, dy: 0.05) }
        XCTAssertEqual(length(camera.eye - target), radius, accuracy: 1e-9)
    }

    func testAPivotBehindTheCameraIsRefused() throws {
        var camera = try framed()
        let before = camera.pivot
        XCTAssertFalse(camera.setPivot(to: camera.eye - camera.forward))
        XCTAssertEqual(length(camera.pivot - before), 0, accuracy: 1e-12)
    }

    // MARK: - The gestures together

    func testOrbitKeepsThePanOffset() throws {
        // A pan then an orbit must rotate the framing you set up, not throw it
        // away. The offset is in the camera's own plane, so it rides along.
        var camera = try framed()
        camera.pan(pixels: Vec2(150, 0), viewportHeight: landscape.y)
        let offset = camera.offset
        camera.orbit(dx: 0.2, dy: -0.1)
        XCTAssertEqual(length(camera.offset - offset), 0, accuracy: 1e-12)
        XCTAssertEqual(length(camera.eye - camera.lookAt), camera.distance, accuracy: 1e-9)
    }

    func testFramingClearsAPan() throws {
        var camera = try framed()
        camera.pan(pixels: Vec2(400, 400), viewportHeight: landscape.y)
        camera.frame(try TemplateFile.Bundled.clay.load().mesh)
        XCTAssertEqual(length(camera.offset), 0, accuracy: 1e-12)
    }

    func testTheModelStaysReachableAfterAnyMixtureOfGestures() throws {
        // A fuzz over the three gestures: whatever the user does, the camera
        // stays finite, the basis stays orthonormal and the distance stays
        // inside its own limits. The first version could be driven to NaN by a
        // pinch of zero.
        var camera = try framed()
        var seed = UInt64(12345)
        func next() -> Double {
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return Double(seed >> 11) / Double(1 << 53)
        }
        for _ in 0..<600 {
            switch Int(next() * 3) {
            case 0: camera.orbit(dx: next() - 0.5, dy: next() - 0.5)
            case 1: camera.pan(pixels: Vec2((next() - 0.5) * 600, (next() - 0.5) * 600),
                               viewportHeight: landscape.y)
            default: camera.zoom(by: 0.3 + next() * 3,
                                 about: Vec2(next() * landscape.x, next() * landscape.y),
                                 viewport: landscape)
            }
            XCTAssertTrue(camera.eye.x.isFinite && camera.eye.y.isFinite && camera.eye.z.isFinite)
            XCTAssertEqual(length(camera.forward), 1, accuracy: 1e-9)
            XCTAssertEqual(dot(camera.right, camera.up), 0, accuracy: 1e-9)
            XCTAssertGreaterThanOrEqual(camera.distance, camera.minDistance - 1e-12)
            XCTAssertLessThanOrEqual(camera.distance, camera.maxDistance + 1e-12)
        }
    }

    func testAZeroPinchIsIgnoredRatherThanInfinite() throws {
        var camera = try framed()
        let distance = camera.distance
        camera.zoom(by: 0, about: Vec2(100, 100), viewport: landscape)
        camera.zoom(by: -1, about: Vec2(100, 100), viewport: landscape)
        camera.zoom(by: .nan, about: Vec2(100, 100), viewport: landscape)
        XCTAssertEqual(camera.distance, distance, accuracy: 1e-12)
    }
}
