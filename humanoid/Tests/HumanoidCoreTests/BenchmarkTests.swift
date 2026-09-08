import XCTest
@testable import HumanoidCore

/// Wall-clock cost of the operations the editor runs per Pencil event or per
/// frame, measured on the build box.
///
/// Off unless `BABY_BLENDER_BENCH=1` is set, because timing assertions are
/// flaky on shared CI and these exist to *inform* the frame budget in
/// `docs/Performance_Research.md`, not to gate a merge. Run with:
///
///     BABY_BLENDER_BENCH=1 swift test --filter BenchmarkTests -c release
///
/// Debug builds are 10–40x slower for this kind of SIMD-heavy Swift and
/// tell you nothing about the device; always `-c release`.
///
/// Even in release these are not the last word: `@testable import` forces
/// -enable-testing on the library, which cost the hot paint loop several fold.
/// `humanoid-cli bench` imports normally and is the authority for anything
/// per-texel; what remains here is the sculpt path, where it does not signify.
///
/// The numbers are for a Linux x86 build box. An A-series/M-series core is in
/// the same ballpark for scalar Double work; treat them as order-of-magnitude
/// and confirm with the on-device HUD, not as a substitute for it.
final class BenchmarkTests: XCTestCase {
    private var enabled: Bool { ProcessInfo.processInfo.environment["BABY_BLENDER_BENCH"] == "1" }

    private func time(_ label: String, iterations: Int = 20, _ body: () -> Void) {
        body() // warm
        let start = DispatchTime.now().uptimeNanoseconds
        for _ in 0..<iterations { body() }
        let perCall = Double(DispatchTime.now().uptimeNanoseconds - start) / Double(iterations) / 1e6
        print("BENCH " + label.padding(toLength: 56, withPad: " ", startingAt: 0) + String(format: "%8.3f ms", perCall))
    }

    func testEditorLoopCosts() throws {
        try XCTSkipUnless(enabled, "set BABY_BLENDER_BENCH=1 to run")

        var document = try Document.clay()
        let template = document.template
        let tables = document.tables
        print("BENCH clay: \(template.vertexCount) verts, \(tables.weldedCount) welded, \(template.triangleCount) tris, albedo \(document.albedo.width)²")

        // --- What `Document.mesh` costs: this runs on EVERY access today.
        time("Document.mesh (rebuild + full normals)") { _ = document.mesh }

        var mesh = document.mesh
        time("MeshData.recomputeNormals (full)") { mesh.recomputeNormals() }

        // --- One dab, as the editor issues it: default radius, symmetric.
        let centre = mesh.positions[0]
        for radius in [0.03, 0.06, 0.12] {
            let settings = Sculpt.Settings(radius: radius, strength: 0.5, symmetric: true)
            var count = 0
            time("Sculpt.apply grab  r=\(radius) symmetric (incl. full normals)") {
                var working = mesh
                count = Sculpt.apply(.grab(Vec3(0.001, 0, 0)), to: &working, tables: tables,
                                     at: centre, settings: settings).count
            }
            print("BENCH   touched welded: \(count)")
        }

        // --- The full per-event chain on Grab today: Document.sculpt does
        // `var working = mesh` (rebuild) + apply + record; then the renderer
        // asks for `document.mesh` AGAIN to upload.
        time("Document.sculpt one grab dab (per-event path today)") {
            document.sculpt(.grab(Vec3(0.0001, 0, 0)), at: [centre],
                            settings: .init(radius: 0.03, strength: 0.5, symmetric: true))
        }

        // --- Renderer upload conversion: Double → Float interleaved.
        time("Vertex conversion 3x Double -> Float interleaved") {
            var out = [Float](repeating: 0, count: mesh.vertexCount * 8)
            for i in 0..<mesh.vertexCount {
                let p = mesh.positions[i], n = mesh.normals[i], uv = mesh.uvs[i]
                let o = i * 8
                out[o] = Float(p.x); out[o + 1] = Float(p.y); out[o + 2] = Float(p.z)
                out[o + 3] = Float(n.x); out[o + 4] = Float(n.y); out[o + 5] = Float(n.z)
                out[o + 6] = Float(uv.x); out[o + 7] = Float(uv.y)
            }
        }

        // --- Painting is NOT benched here. `@testable import` compiles the
        // library with -enable-testing, which suppresses optimisations the
        // texel loop depends on, so numbers taken through XCTest are not
        // release numbers. Use the CLI, which imports the library normally:
        //
        //     swift build -c release && ./.build/release/humanoid-cli bench
    }

}
