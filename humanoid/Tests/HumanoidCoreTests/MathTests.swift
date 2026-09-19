import XCTest
@testable import HumanoidCore

final class MathTests: XCTestCase {
    func testTranslationLivesAtColumnMajorIndices() {
        // If this ever moves, every bind matrix we export is wrong in a way that
        // imports cleanly and skins incorrectly.
        let t = Mat4.translation(Vec3(1, 2, 3))
        XCTAssertEqual(t.m[12], 1)
        XCTAssertEqual(t.m[13], 2)
        XCTAssertEqual(t.m[14], 3)
        XCTAssertEqual(t.transform(point: Vec3(0, 0, 0)), Vec3(1, 2, 3))
        XCTAssertEqual(t.transform(vector: Vec3(0, 0, 0)), Vec3(0, 0, 0), "w=0 ignores translation")
    }

    func testMultiplyAppliesRightmostFirst() {
        let a = Mat4.translation(Vec3(0, 1, 0))
        let b = Mat4.translation(Vec3(1, 0, 0))
        XCTAssertEqual((a * b).transform(point: .zero), Vec3(1, 1, 0))
    }

    func testAffineInverseRoundTripsARotationAndTranslation() {
        let x = normalize(Vec3(1, 1, 0))
        let z = Vec3(0, 0, 1)
        let y = cross(z, x)
        let m = Mat4.basis(x: x, y: y, z: z, origin: Vec3(3, -2, 5))
        let round = m * m.inverseAffine
        XCTAssertLessThan(round.maxDifference(from: .identity), 1e-12)

        let p = Vec3(0.3, 4, -1)
        let back = m.inverseAffine.transform(point: m.transform(point: p))
        XCTAssertLessThan(length(back - p), 1e-12)
    }

    func testAffineInverseStaysExactDownADeepChain() {
        // A 60-bone chain is deeper than the template's worst case; error here
        // would show up as drifting bind poses in Unity.
        var accumulated = Mat4.identity
        for i in 0..<60 {
            let a = Double(i) * 0.11
            let x = normalize(Vec3(cos(a), sin(a), 0.2))
            let zt = normalize(cross(x, Vec3(0, 0, 1)))
            let y = cross(zt, x)
            accumulated = accumulated * Mat4.basis(x: x, y: y, z: zt, origin: Vec3(0, 0.1, 0))
        }
        let round = accumulated * accumulated.inverseAffine
        XCTAssertLessThan(round.maxDifference(from: .identity), 1e-9)
    }

    func testAngleDegreesFlagsDegenerateInput() {
        XCTAssertEqual(angleDegrees(Vec3(1, 0, 0), Vec3(1, 0, 0)), 0, accuracy: 1e-9)
        XCTAssertEqual(angleDegrees(Vec3(1, 0, 0), Vec3(0, 1, 0)), 90, accuracy: 1e-9)
        XCTAssertEqual(angleDegrees(Vec3(1, 0, 0), Vec3(-1, 0, 0)), 180, accuracy: 1e-9)
        XCTAssertEqual(angleDegrees(Vec3(0, 0, 0), Vec3(1, 0, 0)), 180,
                       "a zero-length bone must fail an angle gate, not pass it")
    }
}

/// The 2D helpers.
///
/// Added because the editor needed them and they were not there: screen-space
/// work (a drag, the camera's leftover spin, the stabiliser's rope) is all
/// `Vec2`, and without these `length(aVec2)` picks the `Vec3` overload and
/// fails at the call site.
extension MathTests {
    func testVec2LengthAndDot() {
        XCTAssertEqual(length(Vec2(3, 4)), 5, accuracy: 1e-12)
        XCTAssertEqual(length(Vec2(0, 0)), 0, accuracy: 1e-12)
        XCTAssertEqual(dot(Vec2(2, 3), Vec2(4, 5)), 23, accuracy: 1e-12)
        // Perpendicular vectors have no projection onto each other.
        XCTAssertEqual(dot(Vec2(1, 0), Vec2(0, 1)), 0, accuracy: 1e-12)
    }

    func testVec2NormalizeIsUnitLength() {
        for v in [Vec2(3, 4), Vec2(-7, 0.25), Vec2(0, -2)] {
            XCTAssertEqual(length(normalize(v)), 1, accuracy: 1e-12)
        }
    }

    func testVec2NormalizeOfZeroIsZeroRatherThanNaN() {
        // Same contract as the Vec3 form. A camera whose spin has decayed to
        // nothing must not normalise into NaN and take the view with it.
        let n = normalize(Vec2(0, 0))
        XCTAssertEqual(n.x, 0)
        XCTAssertEqual(n.y, 0)
    }

    func testVec2AndVec3AgreeOnASharedPlane() {
        // The 2D form is not a separate implementation with its own rounding.
        for (x, y) in [(3.0, 4.0), (-1.5, 9.25), (0.001, -0.002)] {
            XCTAssertEqual(length(Vec2(x, y)), length(Vec3(x, y, 0)), accuracy: 1e-15)
        }
    }
}
