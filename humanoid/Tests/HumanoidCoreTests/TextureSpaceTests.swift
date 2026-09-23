import XCTest
@testable import HumanoidCore

/// Paint must come back out of the texture on the face it was painted on —
/// sampled the way the GPU samples it, not the way the painter writes it.
///
/// The painter's own tests could never catch the defect these pin: they read
/// the image back with the painter's convention, and the painter agrees with
/// itself. The renderer sampled with Metal's, which puts row 0 at `t = 0`, and
/// passed the document's v-up UVs straight through — so every stroke was
/// displayed from the other end of the image, on another face of the cube.
final class TextureSpaceTests: XCTestCase {
    private var document: Document!

    override func setUpWithError() throws {
        document = try Document.clay(textureSize: 512)
        document.prepareForPainting()
    }

    /// A ray from outside the model toward its centre, along one axis.
    private func hitFace(_ axis: Vec3) throws -> Picking.Hit {
        try XCTUnwrap(Picking.raycast(document.mesh, origin: axis * 5, direction: axis * -1),
                      "no hit along \(axis)")
    }

    private static let faces: [(name: String, axis: Vec3)] = [
        ("+X", Vec3(1, 0.13, 0.07)), ("-X", Vec3(-1, 0.11, -0.05)),
        ("+Y", Vec3(0.09, 1, 0.12)), ("-Y", Vec3(-0.08, -1, 0.1)),
        ("+Z", Vec3(0.1, 0.12, 1)), ("-Z", Vec3(-0.12, 0.08, -1)),
    ]

    private func paintDab(at hit: Picking.Hit, colour: (r: UInt8, g: UInt8, b: UInt8)) {
        document.paint(.init(radius: 0.02, opacity: 1, colour: colour),
                       along: [(point: hit.position, seed: hit.triangle)])
    }

    private func same(_ a: (r: UInt8, g: UInt8, b: UInt8),
                      _ b: (r: UInt8, g: UInt8, b: UInt8), within tolerance: Int = 0) -> Bool {
        abs(Int(a.r) - Int(b.r)) <= tolerance && abs(Int(a.g) - Int(b.g)) <= tolerance
            && abs(Int(a.b) - Int(b.b)) <= tolerance
    }

    // MARK: - The renderer's conversion

    func testPaintOnEveryFaceIsSampledBackWhereItWasPainted() throws {
        for (index, face) in Self.faces.enumerated() {
            let hit = try hitFace(normalize(face.axis))
            let colour = (r: UInt8(20 + index * 30), g: UInt8(200 - index * 20), b: UInt8(40))
            paintDab(at: hit, colour: colour)
            // What the fragment shader samples at the hit point: the UV
            // interpolated across the triangle, converted exactly the way the
            // renderer converts it before it reaches the vertex buffer.
            let sampled = TextureSpace.sampleTopLeft(document.albedo,
                                                     at: TextureSpace.metal(hit.uv))
            // Within a couple of levels: the hit is the brush centre, but the
            // nearest texel centre sits up to half a texel off it.
            XCTAssertTrue(same(sampled, colour, within: 3),
                          "\(face.name): painted \(colour), the GPU would show \(sampled)")
        }
    }

    func testTheUnconvertedUVShowedThePaintSomewhereElse() throws {
        // The shipped renderer, reproduced: the UV as the document stores it,
        // sampled with Metal's top-left origin. On the front face that reads
        // the untouched base colour, because the paint went to the other row
        // of atlas tiles — the -X face's tile, which is the model's left side.
        let hit = try hitFace(Vec3(0, 0, 1))
        paintDab(at: hit, colour: (0, 0, 255))
        let wrong = TextureSpace.sampleTopLeft(document.albedo, at: hit.uv)
        XCTAssertTrue(same(wrong, document.baseColour),
                      "sampling the raw UV found paint; the atlas is no longer mirrored across v")
    }

    func testTheConversionAgreesWithThePaintersTexelForEveryVertex() {
        // The painter's convention and the GPU's, compared directly for every
        // UV the template has, at the shipped texture size.
        let width = document.albedo.width, height = document.albedo.height
        for uv in document.mesh.uvs {
            let painter = TextureSpace.texel(of: uv, width: width, height: height)
            let t = TextureSpace.metal(uv)
            let gpuX = min(width - 1, Int((t.x * Double(width)).rounded(.down)))
            let gpuY = min(height - 1, Int((t.y * Double(height)).rounded(.down)))
            XCTAssertEqual(painter.x, gpuX)
            XCTAssertLessThanOrEqual(abs(painter.y - gpuY), 1,
                                     "uv \(uv): painter row \(painter.y), GPU row \(gpuY)")
        }
    }

    func testPaintOnOneFaceIsNotShownOnAnyOtherFace() throws {
        // Every vertex that belongs to another face of the cube must still show
        // the base colour after the front is painted, read the GPU's way.
        let hit = try hitFace(Vec3(0, 0, 1))
        paintDab(at: hit, colour: (0, 0, 255))
        let mesh = document.mesh
        var checked = 0
        for (i, p) in mesh.positions.enumerated() where p.z < 0.05 {
            let shown = TextureSpace.sampleTopLeft(document.albedo, at: TextureSpace.metal(mesh.uvs[i]))
            XCTAssertTrue(same(shown, document.baseColour),
                          "vertex \(i) at \(p) is on another face and shows paint")
            checked += 1
        }
        XCTAssertGreaterThan(checked, 1000)
    }
}
