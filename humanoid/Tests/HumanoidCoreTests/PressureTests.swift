import XCTest
@testable import HumanoidCore

/// The pressure curve and the filter, on their own.
final class PressureTests: XCTestCase {
    func testAFingerIsAFullPress() {
        let response = PressureResponse()
        XCTAssertEqual(response.level(forNormalisedForce: nil), 1)
        XCTAssertEqual(response.sizeScale(level: 1), 1)
        XCTAssertEqual(response.strengthScale(level: 1), 1)
    }

    func testTheCurveRunsFromNothingToAFullPressAndStaysThere() {
        for curve in PressureResponse.Curve.allCases {
            let response = PressureResponse(fullForce: 0.5, curve: curve)
            XCTAssertEqual(response.level(forNormalisedForce: 0), 0, accuracy: 1e-12)
            XCTAssertEqual(response.level(forNormalisedForce: 0.5), 1, accuracy: 1e-12)
            XCTAssertEqual(response.level(forNormalisedForce: 0.9), 1, accuracy: 1e-12,
                           "harder than a full press is still a full press")
            var previous = -1.0
            for i in 0...50 {
                let level = response.level(forNormalisedForce: Double(i) / 100)
                XCTAssertGreaterThanOrEqual(level, previous, "\(curve) is not monotonic")
                previous = level
            }
        }
    }

    func testSoftMakesALightTouchCountForMoreAndFirmForLess() {
        let force = 0.15
        let soft = PressureResponse(curve: .soft).level(forNormalisedForce: force)
        let linear = PressureResponse(curve: .linear).level(forNormalisedForce: force)
        let firm = PressureResponse(curve: .firm).level(forNormalisedForce: force)
        XCTAssertGreaterThan(soft, linear)
        XCTAssertGreaterThan(linear, firm)
    }

    func testAnOrdinaryStrokeReachesMostOfTheBrush() {
        // A Pencil drawn at an ordinary pressure reads about 0.3 of its
        // maximum. The shipped mapping used that raw, so an ordinary stroke got
        // a third of the brush; the default curve gives it most of it.
        let response = PressureResponse()
        let ordinary = response.level(forNormalisedForce: 0.3)
        XCTAssertGreaterThan(ordinary, 0.6)
        XCTAssertLessThan(ordinary, 0.95, "an ordinary press should leave headroom above it")
    }

    func testSizeAndStrengthRangesAreIndependentAndCanBeTurnedOff() {
        var response = PressureResponse(minimumSize: 0.25, minimumStrength: 0.5)
        XCTAssertEqual(response.sizeScale(level: 0), 0.25, accuracy: 1e-12)
        XCTAssertEqual(response.strengthScale(level: 0), 0.5, accuracy: 1e-12)
        XCTAssertEqual(response.sizeScale(level: 0.5), 0.625, accuracy: 1e-12)
        response.sizeFollowsPressure = false
        XCTAssertEqual(response.sizeScale(level: 0), 1)
        XCTAssertEqual(response.strengthScale(level: 0), 0.5, accuracy: 1e-12)
        response.strengthFollowsPressure = false
        XCTAssertEqual(response.strengthScale(level: 0), 1)
    }

    func testTheFilterStartsWhereTheStrokeStartsAndSettlesWithinAFewSamples() {
        var filter = PressureFilter()
        XCTAssertEqual(filter.feed(0.2), 0.2, "the first reading of a stroke is taken as it is")
        var value = 0.2
        for _ in 0..<8 { value = filter.feed(1.0) }
        // Eight samples is 33 ms at 240 Hz — four frames at 120.
        XCTAssertGreaterThan(value, 0.98)
        filter.reset()
        XCTAssertEqual(filter.feed(0.6), 0.6)
    }

    func testTheFilterTakesTheRippleOutOfANoisyReading() {
        var filter = PressureFilter()
        var outputs = [Double]()
        for i in 0..<60 { outputs.append(filter.feed(i % 2 == 0 ? 0.4 : 0.6)) }
        let settled = outputs.suffix(20)
        let ripple = (settled.max() ?? 0) - (settled.min() ?? 0)
        XCTAssertLessThan(ripple, 0.2 * 0.6, "a 0.2 alternating ripple came through at \(ripple)")
    }
}

/// The paint brush's shape: hardness, the taper between samples, and the
/// mirror track.
final class PaintBrushShapeTests: XCTestCase {
    private var mesh: MeshData!
    private var tables: MeshTables!
    private var map: SurfacePaint.Map!

    override func setUpWithError() throws {
        mesh = try TemplateFile.Bundled.clay.load().mesh
        tables = MeshTables(mesh)
        mesh.recomputeNormals(tables)
        map = SurfacePaint.Map(mesh, tables: tables, width: 512, height: 512)
    }

    private func hit(_ x: Double, _ y: Double) throws -> Picking.Hit {
        try XCTUnwrap(Picking.raycast(mesh, origin: Vec3(x, y, 5), direction: Vec3(0, 0, -1)))
    }

    private func paint(_ hits: [Picking.Hit], brushes: [SurfacePaint.Brush],
                       symmetric: Bool = false) -> PNG.Image {
        var image = PNG.Image.solid(width: 512, height: 512, r: 200, g: 200, b: 200)
        var stroke = SurfacePaint.Stroke(map: map, brush: brushes[0], origin: image)
        for (i, h) in hits.enumerated() {
            stroke.brush = brushes[min(i, brushes.count - 1)]
            let mirror = symmetric
                ? SurfacePaint.mirror(of: h.position, triangle: h.triangle, mesh: mesh, tables: tables)
                : nil
            stroke.extend(to: h.position, seed: h.triangle, mirror: mirror, mesh: mesh,
                          tables: tables, into: &image)
        }
        return image
    }

    private func value(_ image: PNG.Image, at h: Picking.Hit) -> Int {
        let t = TextureSpace.texel(of: h.uv, width: image.width, height: image.height)
        return Int(image.rgba[(t.y * image.width + t.x) * 4])
    }

    func testHardnessPaintsASolidCore() throws {
        // Half way out, a soft brush is at half opacity and a half-hard one is
        // still solid.
        let centre = try hit(0, 0), halfway = try hit(0.01, 0)
        let soft = paint([centre], brushes: [.init(radius: 0.02, opacity: 1, colour: (0, 0, 0))])
        let hard = paint([centre], brushes: [.init(radius: 0.02, opacity: 1, colour: (0, 0, 0),
                                                   hardness: 0.55)])
        XCTAssertGreaterThan(value(soft, at: halfway), 60)
        XCTAssertLessThan(value(hard, at: halfway), 5)
        // And the rim is still clean: nothing at the radius.
        let rim = try hit(0.0205, 0)
        XCTAssertEqual(value(hard, at: rim), 200)
    }

    func testASegmentTapersFromOneBrushToTheNext() throws {
        // A stroke that gets harder as it goes: the texels along it must darken
        // smoothly, not jump at the sample.
        let a = try hit(-0.04, 0), b = try hit(0.04, 0)
        let light = SurfacePaint.Brush(radius: 0.015, opacity: 0.2, colour: (0, 0, 0))
        let firm = SurfacePaint.Brush(radius: 0.015, opacity: 1, colour: (0, 0, 0))
        let image = paint([a, b], brushes: [light, firm])
        var previous = 255
        for i in 0...8 {
            let h = try hit(-0.04 + 0.01 * Double(i), 0)
            let v = value(image, at: h)
            XCTAssertLessThanOrEqual(v, previous + 1, "the stroke lightened at \(i)")
            previous = v
        }
        XCTAssertGreaterThan(value(image, at: a), 140, "the light end painted too hard")
        XCTAssertLessThan(value(image, at: b), 10, "the firm end did not reach full opacity")
    }

    func testTheMirrorOfAPointIsItsReflectionOnTheSurface() throws {
        for (x, y) in [(0.05, 0.02), (0.09, -0.07), (0.001, 0.03), (0.095, 0.085)] {
            let h = try hit(x, y)
            let mirror = try XCTUnwrap(SurfacePaint.mirror(of: h.position, triangle: h.triangle,
                                                           mesh: mesh, tables: tables))
            let expected = Vec3(-h.position.x, h.position.y, h.position.z)
            // Not exact: the clay's triangulation is not mirror-symmetric, so
            // the reflected point sits a hair off the mesh and is projected
            // back onto it.
            XCTAssertLessThan(length(mirror.point - expected), 5e-4, "at (\(x), \(y))")
        }
    }

    func testAStrokeOnTheMirrorPlaneIsTheSameWithSymmetryOnOrOff() throws {
        // On the plane the mirror track paints over the primary one. They share
        // one alpha buffer, so that is idempotent: symmetry must add nothing.
        let hits = try (0...6).map { try hit(0, -0.06 + 0.02 * Double($0)) }
        let brush = SurfacePaint.Brush(radius: 0.02, opacity: 0.7, colour: (0, 0, 0), hardness: 0.5)
        let on = paint(hits, brushes: [brush], symmetric: true)
        let off = paint(hits, brushes: [brush], symmetric: false)
        var worst = 0
        for i in stride(from: 0, to: on.rgba.count, by: 4) {
            worst = max(worst, abs(Int(on.rgba[i]) - Int(off.rgba[i])))
        }
        XCTAssertLessThanOrEqual(worst, 2, "symmetry changed a stroke on the plane by \(worst) levels")
    }
}
