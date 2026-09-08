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

        // --- Paint as shipped: UV disc dab.
        var albedo = document.albedo
        time("Paint.dab UV disc r=0.018 on 1024²") {
            Paint.dab(into: &albedo, at: Vec2(0.5, 0.5), brush: .init(radius: 0.018))
        }

        // --- Projection paint prototype: flood triangles inside the brush
        // sphere, rasterise their UV footprint, test each texel in world space.
        // This is the algorithm the plan proposes; the cost is what matters.
        let hitTri = 0
        let a0 = Int(mesh.indices[hitTri * 3])
        let hit = mesh.positions[a0]
        for radius in [0.03, 0.06, 0.12] {
            var texels = 0, triangles = 0
            time("Projection paint prototype r=\(radius) on 1024²") {
                (triangles, texels) = projectionPaint(&albedo, mesh: mesh, tables: tables,
                                                      centre: hit, radius: radius)
            }
            print("BENCH   triangles \(triangles), texels tested \(texels)")
        }
    }

    /// Minimal projection painter: triangle flood by vertex proximity, then a
    /// bounding-box texel walk with a barycentric inside test. Not optimised
    /// (Blender precomputes pixel runs and an affine pixel→position map per
    /// triangle); this is the naive upper bound on cost.
    private func projectionPaint(_ image: inout PNG.Image, mesh: MeshData, tables: MeshTables,
                                 centre: Vec3, radius: Double) -> (Int, Int) {
        let r2 = radius * radius
        let w = Double(image.width), h = Double(image.height)
        var inside = [Bool](repeating: false, count: mesh.vertexCount)
        for i in 0..<mesh.vertexCount {
            let d = mesh.positions[i] - centre
            inside[i] = dot(d, d) <= r2
        }
        var triangles = 0, texels = 0
        for t in stride(from: 0, to: mesh.indices.count, by: 3) {
            let ia = Int(mesh.indices[t]), ib = Int(mesh.indices[t + 1]), ic = Int(mesh.indices[t + 2])
            guard inside[ia] || inside[ib] || inside[ic] else { continue }
            triangles += 1
            let ua = mesh.uvs[ia], ub = mesh.uvs[ib], uc = mesh.uvs[ic]
            let pa = mesh.positions[ia], pb = mesh.positions[ib], pc = mesh.positions[ic]
            let minX = max(0, Int((min(ua.x, ub.x, uc.x) * w).rounded(.down)) - 1)
            let maxX = min(image.width - 1, Int((max(ua.x, ub.x, uc.x) * w).rounded(.up)) + 1)
            let minY = max(0, Int(((1 - max(ua.y, ub.y, uc.y)) * h).rounded(.down)) - 1)
            let maxY = min(image.height - 1, Int(((1 - min(ua.y, ub.y, uc.y)) * h).rounded(.up)) + 1)
            let d00 = (ub.x - ua.x) * (ub.x - ua.x) + (ub.y - ua.y) * (ub.y - ua.y)
            let d01 = (ub.x - ua.x) * (uc.x - ua.x) + (ub.y - ua.y) * (uc.y - ua.y)
            let d11 = (uc.x - ua.x) * (uc.x - ua.x) + (uc.y - ua.y) * (uc.y - ua.y)
            let denom = d00 * d11 - d01 * d01
            guard abs(denom) > 1e-18 else { continue }
            for y in minY...maxY {
                let v = 1 - (Double(y) + 0.5) / h
                for x in minX...maxX {
                    texels += 1
                    let u = (Double(x) + 0.5) / w
                    let d20 = (u - ua.x) * (ub.x - ua.x) + (v - ua.y) * (ub.y - ua.y)
                    let d21 = (u - ua.x) * (uc.x - ua.x) + (v - ua.y) * (uc.y - ua.y)
                    let bv = (d11 * d20 - d01 * d21) / denom
                    let bw = (d00 * d21 - d01 * d20) / denom
                    let bu = 1 - bv - bw
                    // One-texel dilation: accept slightly outside so filtering
                    // never samples an unpainted gutter.
                    guard bu >= -0.02, bv >= -0.02, bw >= -0.02 else { continue }
                    let p = pa * bu + pb * bv + pc * bw
                    let d = p - centre
                    let dist2 = dot(d, d)
                    guard dist2 <= r2 else { continue }
                    let alpha = Sculpt.falloff(distance: dist2.squareRoot(), radius: radius)
                    let i = (y * image.width + x) * 4
                    image.rgba[i] = UInt8(Double(image.rgba[i]) * (1 - alpha) + 40 * alpha)
                    image.rgba[i + 1] = UInt8(Double(image.rgba[i + 1]) * (1 - alpha) + 40 * alpha)
                    image.rgba[i + 2] = UInt8(Double(image.rgba[i + 2]) * (1 - alpha) + 48 * alpha)
                }
            }
        }
        return (triangles, texels)
    }
}
