import XCTest
@testable import HumanoidCore

/// The sixth device run's hole, reproduced through the same stroke engine the
/// iPad runs: a Pencil scribbling Deflate over one place on the top of the
/// clay, stroke after stroke, seen at the angle of the screenshot, with the
/// device's brush — 35 points on a 2x panel, strength 0.6, pressure 0.85,
/// symmetry on, four samples a frame.
///
/// Before the fix, the same run crossed itself on its tenth stroke and had 445
/// crossing triangle pairs by its sixtieth; drawn, that was the model's
/// inside showing through the pit.
final class SculptCrossingTests: XCTestCase {
    private let viewport = Vec2(2732, 2048)   // the 12.9-inch iPad in the log

    private struct Run {
        var document: Document
        var template: MeshData
        var camera: Camera
    }

    private func start(azimuth: Double, elevation: Double) throws -> Run {
        let document = try Document.clay(textureSize: 64)
        var camera = Camera()
        camera.frame(document.mesh)
        camera.azimuth = azimuth
        camera.elevation = elevation
        return Run(document: document, template: document.mesh, camera: camera)
    }

    /// `strokes` scribbles over the screen point where `aim` first appeared,
    /// each about ninety samples of three short back-and-forths.
    private func scribble(_ run: inout Run, at aim: Vec3, strokes: Int, radiusPoints: Double,
                          strength: Double, tools: (Int) -> EditTool) throws {
        let centre = try XCTUnwrap(run.camera.project(aim, viewport: viewport))
        var engine = StrokeEngine()
        var generator = SplitMix64(seed: 42)
        for s in 0..<strokes {
            let options = BrushOptions(tool: tools(s), radiusPoints: radiusPoints, pointScale: 2,
                                       strength: strength, symmetric: true)
            let angle = generator.unit() * .pi
            let along = Vec2(cos(angle), sin(angle)), across = Vec2(-along.y, along.x)
            let offset = Vec2(generator.unit() - 0.5, generator.unit() - 0.5) * 60
            var frame: [StrokeSample] = []
            let samples = 88
            for i in 0..<samples {
                let t = Double(i) / Double(samples - 1)
                let point = centre + offset + along * (sin(t * .pi * 6) * 70) + across * ((t - 0.5) * 60)
                frame.append(StrokeSample(phase: i == 0 ? .began : .moved, location: point,
                                          force: 0.85, isPencil: true))
                if frame.count == 4 || i == samples - 1 {
                    if i == samples - 1 {
                        frame.append(StrokeSample(phase: .ended, location: point, force: 0.85,
                                                  isPencil: true))
                    }
                    engine.apply(frame, to: &run.document, camera: run.camera, viewport: viewport,
                                 options: options)
                    frame.removeAll()
                }
            }
        }
    }

    private func deepest(_ run: Run) -> Double {
        (0..<run.template.vertexCount).map {
            length(run.document.mesh.positions[$0] - run.template.positions[$0])
        }.max() ?? 0
    }

    private func crossings(_ run: Run) -> Int {
        CrossingOracle.pairs(in: run.document.mesh, tables: run.document.tables).count
    }

    func testTheSixthDeviceRunDoesNotMakeAHole() throws {
        var run = try start(azimuth: 0.2, elevation: 0.55)
        try scribble(&run, at: Vec3(0, 0.12, 0), strokes: 20, radiusPoints: 35, strength: 0.6) { _ in .deflate }
        XCTAssertGreaterThan(deepest(run), 0.025, "the pit was never dug")
        XCTAssertEqual(crossings(run), 0)
    }

    func testPressingIntoACornerDoesNotMakeAHole() throws {
        // The hardest case measured: a corner pressed in at full strength,
        // where the direction alone still crossed itself by the twentieth
        // stroke. This is the guard's to catch.
        var run = try start(azimuth: 0.785, elevation: 0.6)
        try scribble(&run, at: Vec3(0.12, 0.12, 0.12), strokes: 20, radiusPoints: 45,
                     strength: 1) { _ in .deflate }
        XCTAssertGreaterThan(deepest(run), 0.03, "the corner was never pressed in")
        XCTAssertEqual(crossings(run), 0)
    }

    func testRaisingAndPressingInTurnDoesNotMakeAHole() throws {
        var run = try start(azimuth: 0.2, elevation: 0.55)
        try scribble(&run, at: Vec3(0, 0.12, 0), strokes: 20, radiusPoints: 35,
                     strength: 1) { $0 % 2 == 0 ? .deflate : .inflate }
        XCTAssertEqual(crossings(run), 0)
    }
}

/// A tiny deterministic generator, so the scribbles are the same every run.
private struct SplitMix64 {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
    mutating func unit() -> Double { Double(next() >> 11) / Double(1 << 53) }
}
