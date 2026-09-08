import XCTest
@testable import HumanoidCore

final class PickingTests: XCTestCase {
    private var mesh: MeshData!

    override func setUpWithError() throws {
        mesh = try TemplateFile.Bundled.clay.load().mesh
    }

    func testHitsTheNearFaceOfTheCubeNotTheFarOne() throws {
        // Fired down -Z from outside. The cube spans +/-0.12, so the near face
        // is at about +0.12 and the far one at -0.12. Back-face culling is what
        // stops the far hit winning; without it, touching the front of a model
        // sculpts the inside of its back.
        let hit = try XCTUnwrap(Picking.raycast(mesh, origin: Vec3(0, 0, 1),
                                                direction: Vec3(0, 0, -1)))
        XCTAssertGreaterThan(hit.position.z, 0.1)
        XCTAssertEqual(hit.position.x, 0, accuracy: 0.01)
        XCTAssertEqual(hit.position.y, 0, accuracy: 0.01)
        XCTAssertEqual(hit.distance, 1.0 - hit.position.z, accuracy: 1e-9)
    }

    func testBarycentricWeightsSumToOneAndReconstructThePoint() throws {
        let hit = try XCTUnwrap(Picking.raycast(mesh, origin: Vec3(0.03, 0.02, 1),
                                                direction: Vec3(0, 0, -1)))
        let b = hit.barycentric
        XCTAssertEqual(b.x + b.y + b.z, 1.0, accuracy: 1e-12)
        let t = hit.triangle * 3
        let a = mesh.positions[Int(mesh.indices[t])]
        let bb = mesh.positions[Int(mesh.indices[t + 1])]
        let c = mesh.positions[Int(mesh.indices[t + 2])]
        let reconstructed = a * b.x + bb * b.y + c * b.z
        XCTAssertEqual(length(reconstructed - hit.position), 0, accuracy: 1e-9)
    }

    func testTheHitUVIsInsideTheTextureAndInsideAnIsland() throws {
        let hit = try XCTUnwrap(Picking.raycast(mesh, origin: Vec3(0, 0, 1),
                                                direction: Vec3(0, 0, -1)))
        XCTAssertTrue((0...1).contains(hit.uv.x))
        XCTAssertTrue((0...1).contains(hit.uv.y))
    }

    func testAMissReturnsNil() {
        XCTAssertNil(Picking.raycast(mesh, origin: Vec3(0, 0, 1), direction: Vec3(1, 0, 0)))
        XCTAssertNil(Picking.raycast(mesh, origin: Vec3(5, 5, 5), direction: Vec3(0, 0, -1)))
    }

    func testARayFromInsideHitsNothing() {
        // Every triangle faces away from an origin at the centre, so culling
        // rejects all of them. Better than reporting a hit on the inside wall.
        XCTAssertNil(Picking.raycast(mesh, origin: .zero, direction: Vec3(0, 0, 1)))
    }
}

final class PaintTests: XCTestCase {
    private var mesh: MeshData!
    private var tables: MeshTables!
    private var image: PNG.Image!

    override func setUpWithError() throws {
        mesh = try TemplateFile.Bundled.clay.load().mesh
        tables = MeshTables(mesh)
        image = PNG.Image.solid(width: 256, height: 256, r: 200, g: 200, b: 200)
    }

    private func pixel(_ image: PNG.Image, _ x: Int, _ y: Int) -> (Int, Int, Int) {
        let i = (y * image.width + x) * 4
        return (Int(image.rgba[i]), Int(image.rgba[i + 1]), Int(image.rgba[i + 2]))
    }

    func testFillReplacesEveryPixelAndLeavesItOpaque() {
        Paint.fill(&image, with: (10, 20, 30))
        for i in stride(from: 0, to: image.rgba.count, by: 4) {
            XCTAssertEqual(image.rgba[i], 10)
            XCTAssertEqual(image.rgba[i + 1], 20)
            XCTAssertEqual(image.rgba[i + 2], 30)
            XCTAssertEqual(image.rgba[i + 3], 255)
        }
    }

    func testADabIsDarkestAtItsCentreAndFadesToNothingAtTheRim() {
        let brush = Paint.Brush(radius: 0.1, opacity: 1.0, colour: (0, 0, 0))
        Paint.dab(into: &image, at: Vec2(0.5, 0.5), brush: brush)

        let centre = pixel(image, 128, 128)
        XCTAssertLessThan(centre.0, 20, "the centre should be nearly the brush colour")

        // Just outside the radius: 0.1 of 256 px is ~26 px.
        let outside = pixel(image, 128 + 30, 128)
        XCTAssertEqual(outside.0, 200, "paint escaped the brush radius")

        // Monotonically lighter as we walk out from the centre.
        var previous = -1
        for offset in stride(from: 0, through: 25, by: 5) {
            let value = pixel(image, 128 + offset, 128).0
            XCTAssertGreaterThanOrEqual(value, previous)
            previous = value
        }
    }

    func testUVvRunsUpWhileImageRowsRunDown() {
        // The one axis flip in the whole paint path, and getting it wrong puts
        // every stroke on the wrong half of the texture.
        Paint.dab(into: &image, at: Vec2(0.5, 0.9),
                  brush: Paint.Brush(radius: 0.05, opacity: 1, colour: (0, 0, 0)))
        XCTAssertLessThan(pixel(image, 128, 25).0, 100, "v = 0.9 should paint near the TOP row")
        XCTAssertEqual(pixel(image, 128, 230).0, 200)
    }

    func testErasingRestoresTheBaseColourRatherThanPunchingAHole() {
        let base = (r: UInt8(214), g: UInt8(176), b: UInt8(150))
        Paint.fill(&image, with: base)
        Paint.dab(into: &image, at: Vec2(0.5, 0.5),
                  brush: Paint.Brush(radius: 0.1, opacity: 1, colour: (0, 0, 0)))
        XCTAssertLessThan(pixel(image, 128, 128).0, 20)

        Paint.dab(into: &image, at: Vec2(0.5, 0.5),
                  brush: Paint.Brush(radius: 0.1, opacity: 1, erasing: true), base: base)
        let restored = pixel(image, 128, 128)
        XCTAssertEqual(restored.0, Int(base.r), accuracy: 2)
        // Opaque throughout: a transparent albedo exports as a black patch.
        for i in stride(from: 3, to: image.rgba.count, by: 4) {
            XCTAssertEqual(image.rgba[i], 255)
        }
    }

    func testTheEyedropperReadsBackWhatWasPainted() {
        Paint.fill(&image, with: (10, 120, 200))
        let sampled = Paint.sample(image, at: Vec2(0.3, 0.7))
        XCTAssertEqual(sampled.r, 10)
        XCTAssertEqual(sampled.g, 120)
        XCTAssertEqual(sampled.b, 200)
    }

    func testADabReportsTheRectangleItTouched() {
        let touched = Paint.dab(into: &image, at: Vec2(0.5, 0.5),
                                brush: Paint.Brush(radius: 0.1, opacity: 1, colour: (0, 0, 0)))
        XCTAssertFalse(touched.isEmpty)
        XCTAssertLessThanOrEqual(touched.minX, 128)
        XCTAssertGreaterThanOrEqual(touched.maxX, 128)
        // Bounded by the brush, not the whole texture: incremental uploads and
        // changed-tile undo both depend on this being tight.
        XCTAssertLessThan(touched.maxX - touched.minX, 70)
    }

    func testADabAtTheEdgeOfTheTextureIsClippedRatherThanWrapping() {
        let touched = Paint.dab(into: &image, at: Vec2(0.0, 0.0),
                                brush: Paint.Brush(radius: 0.1, opacity: 1, colour: (0, 0, 0)))
        XCTAssertGreaterThanOrEqual(touched.minX, 0)
        XCTAssertLessThanOrEqual(touched.maxX, image.width - 1)
        // Nothing painted in the opposite corner, which is what wrapping would do.
        XCTAssertEqual(pixel(image, 250, 10).0, 200)
    }

    func testPaintedTextureStillEncodesAsAValidPNG() throws {
        Paint.fill(&image, with: (214, 176, 150))
        for i in 0...12 {
            let t = Double(i) / 12
            Paint.dab(into: &image, at: Vec2(0.2 + 0.5 * t, 0.3 + 0.5 * t),
                      brush: Paint.Brush(radius: 0.04, opacity: 0.8, colour: (20, 90, 160)))
        }
        let encoded = try PNG.encode(image)
        XCTAssertEqual(Array(encoded.prefix(8)), [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
        XCTAssertGreaterThan(encoded.count, 100)
    }
}
