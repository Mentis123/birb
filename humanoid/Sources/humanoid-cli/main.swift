import Foundation
import Dispatch
import HumanoidCore
import ExporterVRM
import ExporterFBX

// Command line front end used by CI and by the Phase 0 export gate.
//
//   humanoid-cli gate            print the rig gate report for the frozen rig
//   humanoid-cli corpus <dir>    write the golden corpus and its manifest
//
// The corpus is what goes to the Mac for the M1 Unity session, and what the
// Khronos validator and the Blender importers chew on here first.

let arguments = CommandLine.arguments

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

/// A corpus entry. Positives must export; negatives must be refused by the gate,
/// and a negative that silently exports is itself a failure.
struct Case {
    let name: String
    let detail: String
    /// Absent for a Clay case: the whole point is exercising the unrigged path.
    let skeleton: Skeleton?
    let expectPass: Bool
    var albedo: (r: UInt8, g: UInt8, b: UInt8) = (214, 176, 150)
    /// Clay only. Runs real editing through `Document` so the corpus exercises
    /// the path a user takes, not just the template as authored.
    var edit: ((inout Document) -> Void)?
}

func scaled(_ s: Skeleton, by factor: Double) -> Skeleton {
    Skeleton(bones: s.bones.map { BoneSpec($0.bone, parent: $0.parent, at: $0.restPosition * factor) })
}

func moved(_ s: Skeleton, _ bone: HumanBone, by delta: Vec3) -> Skeleton {
    Skeleton(bones: s.bones.map {
        $0.bone == bone ? BoneSpec($0.bone, parent: $0.parent, at: $0.restPosition + delta) : $0
    })
}

func corpusCases(_ base: Skeleton) -> [Case] {
    return [
        Case(name: "neutral", detail: "frozen rig, unedited T-pose",
             skeleton: base, expectPass: true),
        Case(name: "tall", detail: "whole figure scaled to 1.15x — proportion extreme",
             skeleton: scaled(base, by: 1.15), expectPass: true),
        Case(name: "short", detail: "whole figure scaled to 0.80x — proportion extreme",
             skeleton: scaled(base, by: 0.80), expectPass: true),
        Case(name: "broad-shoulders", detail: "shoulders and arms pushed outward — joint relocation, inverse binds recomputed",
             skeleton: moved(moved(base, .leftShoulder, by: Vec3(0.05, 0, 0)),
                             .rightShoulder, by: Vec3(-0.05, 0, 0)),
             expectPass: true),
        Case(name: "long-neck", detail: "neck raised — joint relocation up the spine chain",
             skeleton: moved(base, .neck, by: Vec3(0, 0.06, 0)), expectPass: true),
        Case(name: "painted", detail: "neutral rig with a different albedo fill",
             skeleton: base, expectPass: true, albedo: (92, 140, 205)),

        // Negatives. Each is a documented real failure mode; the gate must stop
        // every one of them here rather than on the Mac.
        Case(name: "neg-a-pose", detail: "arms drooped past Unity's 5 degree limit",
             skeleton: moved(moved(base, .leftLowerArm, by: Vec3(0, -0.05, 0)),
                             .leftHand, by: Vec3(0, -0.12, 0)),
             expectPass: false),
        Case(name: "neg-collapsed-neck", detail: "neck coincident with chest — Unity 'bone length of zero'",
             skeleton: moved(base, .neck, by: base.restPosition(of: .chest)! - base.restPosition(of: .neck)!),
             expectPass: false),
        Case(name: "neg-doll-scale", detail: "figure below VRChat's 20 cm shoulder floor",
             skeleton: scaled(base, by: 0.12), expectPass: false),
    ]
}

/// Clay cases. `neg-clay-torn` proves the mesh gate is load-bearing on the
/// unrigged path too: without a rig gate to catch anything, a broken Clay mesh
/// would otherwise export happily.
func clayCases() -> [Case] {
    [
        Case(name: "clay-neutral", detail: "the shipped rounded cube, unedited",
             skeleton: nil, expectPass: true),
        Case(name: "clay-painted", detail: "the cube with a different albedo fill",
             skeleton: nil, expectPass: true, albedo: (92, 140, 205)),
        Case(name: "clay-sculpted",
             detail: "sculpted and painted through Document — the path a user takes",
             skeleton: nil, expectPass: true, edit: { document in
                 // A ring of mirrored inflates, a grab, and a smooth pass: one
                 // of each brush, so an export can only pass if all three
                 // preserve the invariants they claim to.
                 for i in 0..<6 {
                     let angle = Double(i) * 1.05
                     document.sculpt(.inflate(0.010),
                                     at: [Vec3(cos(angle) * 0.09, sin(angle) * 0.07, 0.10)],
                                     settings: .init(radius: 0.055, strength: 0.9, symmetric: true))
                 }
                 document.sculpt(.grab(Vec3(0, 0.02, 0.012)), at: [Vec3(0, 0.10, 0.06)],
                                 settings: .init(radius: 0.07, strength: 1.0, symmetric: true))
                 document.sculpt(.smooth, at: [Vec3(0, 0, 0.12)],
                                 settings: .init(radius: 0.06, strength: 0.6, symmetric: true))
                 document.fill((196, 176, 210))
                 // Painted through the surface, the way the editor does it: a
                 // ray per sample, then a world-space brush. Painting by UV
                 // would bleed across the atlas tiles onto other faces.
                 let mesh = document.mesh
                 let path = stride(from: -0.07, through: 0.07, by: 0.01).compactMap {
                     x -> (point: Vec3, seed: Int)? in
                     guard let hit = Picking.raycast(mesh, origin: Vec3(x, x * 0.4, 1),
                                                     direction: Vec3(0, 0, -1)) else { return nil }
                     return (hit.position, hit.triangle)
                 }
                 document.paint(.init(radius: 0.05, opacity: 0.85, colour: (40, 60, 120)),
                                along: path)
             }),
    ]
}

switch arguments.dropFirst().first {
case "bench":
    // Timed OUTSIDE the test bundle on purpose. `@testable import` compiles the
    // library with -enable-testing, which suppresses optimisations the hot paint
    // loop depends on; numbers taken through XCTest are not release numbers.
    func time(_ label: String, iterations: Int = 20, _ body: () -> Void) {
        body()
        let start = DispatchTime.now().uptimeNanoseconds
        for _ in 0..<iterations { body() }
        let per = Double(DispatchTime.now().uptimeNanoseconds - start) / Double(iterations) / 1e6
        print("BENCH " + label.padding(toLength: 52, withPad: " ", startingAt: 0)
              + String(format: "%9.3f ms", per))
    }

    // Calibration. Before calling the painter slow, know what this machine does
    // with the same shape of work: a flat loop of comparable float arithmetic
    // over a million iterations. Without this, "36 ns per texel" is a number
    // with nothing to compare it to.
    var sink: Float = 0
    let controlCount = 1_000_000
    time("control: 1M iterations of texel-shaped float work", iterations: 10) {
        var accumulator: Float = 0
        for i in 0..<controlCount {
            let v = Float(i) * 1e-6, w = Float(i) * 2e-6
            let dx = 0.1 + 0.2 * v + 0.3 * w, dy = 0.4 + 0.5 * v, dz = 0.6 + 0.7 * w
            let d2 = dx * dx + dy * dy + dz * dz
            if d2 > 1 { continue }
            let unit = 1 - d2.squareRoot() * 2
            accumulator += unit * unit * (3 - 2 * unit)
        }
        sink = accumulator
    }
    print("BENCH   (control sink \(sink))")

    let template = try TemplateFile.Bundled.clay.load()
    var benchMesh = template.mesh
    let benchTables = MeshTables(benchMesh)
    benchMesh.recomputeNormals(benchTables)
    print("BENCH clay \(benchMesh.vertexCount) verts / \(benchMesh.triangleCount) tris")

    // Picking is linear over triangles and runs once per queued sample plus
    // once per hover event, so it sets the ceiling on how dense Clay can get.
    time("Picking.raycast over \(benchMesh.triangleCount) triangles", iterations: 200) {
        _ = Picking.raycast(benchMesh, origin: Vec3(0.01, 0.02, 5), direction: Vec3(0, 0, -1))
    }

    for size in [1024, 2048] {
        var canvas = PNG.Image.solid(width: size, height: size, r: 200, g: 200, b: 200)
        var map: SurfacePaint.Map!
        time("Map build \(size)²", iterations: 3) {
            map = SurfacePaint.Map(benchMesh, tables: benchTables, width: size, height: size)
        }
        print("BENCH   runs \(map.runCount), texels \(map.texelCount) "
              + "(\(map.texelCount * 100 / (size * size))% of texture)")

        guard let centre = Picking.raycast(benchMesh, origin: Vec3(0, 0, 5),
                                           direction: Vec3(0, 0, -1)) else { break }
        // The albedo snapshot a stroke takes for undo. Copy-on-write means it
        // is charged to the first texel written, so it lands inside the first
        // dab of every stroke and nowhere else. Measured separately because it
        // is a per-STROKE cost and everything else here is per-frame.
        var copySink: UInt8 = 0
        time("  albedo copy-on-write \(size)²") {
            var copy = canvas
            copy.rgba[0] = copy.rgba[0] &+ 1
            copySink = copy.rgba[0]
        }
        _ = copySink

        var stroke = SurfacePaint.Stroke(map: map, brush: .init(), origin: canvas)
        time("  stroke reset only \(size)²") {
            stroke.reset(brush: .init(radius: 0.04, opacity: 1, colour: (0, 0, 0)),
                         origin: canvas)
        }
        for radius in [0.01, 0.04, 0.06, 0.12] {
            var faceCount = 0, texelCount = 0
            time("  reach only r=\(radius) on \(size)²") {
                let f = SurfacePaint.reach(from: centre.position, to: centre.position,
                                           seed: centre.triangle, radius: radius,
                                           mesh: benchMesh, tables: benchTables)
                faceCount = f.count
                texelCount = f.reduce(0) { $0 + map.texels(of: $1) }
            }
            print("BENCH     \(faceCount) triangles own \(texelCount) texels")
            let brush = SurfacePaint.Brush(radius: radius, opacity: 1, colour: (0, 0, 0))
            var touched = 0
            time("  dab r=\(radius) on \(size)²") {
                stroke.reset(brush: brush, origin: canvas)
                let rect = stroke.extend(to: centre.position, seed: centre.triangle,
                                         mesh: benchMesh, tables: benchTables, into: &canvas)
                touched = rect.isEmpty ? 0 : (rect.maxX - rect.minX + 1) * (rect.maxY - rect.minY + 1)
            }
            print("BENCH     dirty rect \(touched) texels")
        }
    }

case "gate":
    // Both shipped templates, because "the gate passes" has to mean the gate
    // that each document kind actually runs.
    var allPassed = true
    for bundled in [TemplateFile.Bundled.clay, TemplateFile.Bundled.humanoid] {
        let template = try bundled.load()
        let snapshot = ExportSnapshot(
            avatarName: bundled.resource, templateID: bundled.id,
            templateVersion: bundled.version, skeleton: template.skeleton,
            mesh: template.mesh,
            albedo: PNG.Image.solid(width: 4, height: 4, r: 214, g: 176, b: 150),
            albedoRelativePath: "albedo.png")
        let report = snapshot.validate()
        print("\(bundled.resource) [\(template.kind)] — \(report.summary)")
        allPassed = allPassed && report.passes
    }
    exit(allPassed ? 0 : 1)

case "corpus":
    guard let dir = arguments.dropFirst(2).first else { fail("usage: humanoid-cli corpus <dir>") }
    let root = URL(fileURLWithPath: dir)
    try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)

    var manifest = [[String: Any]]()
    var problems = [String]()

    // Every case is the ONE shipped body with its joints moved, which is exactly
    // what the editor does. Generating each case from a fresh procedural mesh
    // would test a mesh no user will ever export.
    let humanoid = try TemplateFile.Bundled.humanoid.load()
    let clay = try TemplateFile.Bundled.clay.load()
    let textureSize = 512   // corpus files stay small; the app ships 1024/2048

    for c in corpusCases(humanoid.skeleton!) + clayCases() {
        // Rigged cases are the one body with its joints moved, which is what the
        // editor does. Clay has no joints to move, so it exports as authored.
        let mesh: MeshData
        var painted: PNG.Image?
        if let skeleton = c.skeleton {
            mesh = Skinning.deform(humanoid.mesh, from: humanoid.skeleton!, to: skeleton)
        } else if let edit = c.edit {
            var document = Document(clay, id: TemplateFile.Bundled.clay.id,
                                    version: TemplateFile.Bundled.clay.version,
                                    textureSize: textureSize)
            edit(&document)
            mesh = document.mesh
            painted = document.albedo
        } else {
            mesh = clay.mesh
        }
        let albedo = painted ?? PNG.Image.solid(width: textureSize, height: textureSize,
                                                r: c.albedo.r, g: c.albedo.g, b: c.albedo.b)
        let bundled = c.skeleton == nil ? TemplateFile.Bundled.clay : TemplateFile.Bundled.humanoid
        let snapshot = ExportSnapshot(
            avatarName: c.name, templateID: bundled.id,
            templateVersion: bundled.version, skeleton: c.skeleton,
            mesh: mesh, albedo: albedo, albedoRelativePath: "Textures/\(c.name)_Albedo.png")

        let report = snapshot.validate()
        var entry: [String: Any] = [
            "name": c.name,
            "detail": c.detail,
            "expectPass": c.expectPass,
            "gatePassed": report.passes,
            "kind": c.skeleton == nil ? "clay" : "humanoid",
            "bones": c.skeleton?.count ?? 0,
            "triangles": mesh.triangleCount,
            "vertices": mesh.vertexCount,
            "findings": report.findings.map { $0.description },
        ]

        if report.passes != c.expectPass {
            problems.append(c.expectPass
                ? "\(c.name): expected to pass the gate but failed:\n\(report.summary)"
                : "\(c.name): expected the gate to REJECT this, but it passed")
        }

        if report.passes {
            do {
                // A Clay file is a plain glTF binary, so it is named .glb. A
                // .vrm that carries no humanoid would be a lie to every tool
                // that opens it by extension.
                let vrmData = try VRMExporter.export(snapshot)
                let glbExtension = snapshot.isRigged ? "vrm" : "glb"
                let vrmURL = root.appendingPathComponent("\(c.name).\(glbExtension)")
                try vrmData.write(to: vrmURL)
                entry["vrm"] = vrmURL.lastPathComponent
                entry["vrmBytes"] = vrmData.count

                let fbxURL = root.appendingPathComponent("\(c.name).fbx")
                try FBXExporter.export(snapshot, to: fbxURL)
                let fbxBytes = (try? Data(contentsOf: fbxURL).count) ?? 0
                entry["fbx"] = fbxURL.lastPathComponent
                entry["fbxBytes"] = fbxBytes

                print(String(format: "  %-20@  %5d tris   vrm %7d B   fbx %7d B",
                             c.name as NSString, mesh.triangleCount, vrmData.count, fbxBytes))
            } catch {
                problems.append("\(c.name): export threw — \(error)")
            }
        } else {
            print("  \(c.name): refused by the gate as expected (\(report.errors.count) error(s))")
        }
        manifest.append(entry)
    }

    let manifestData = try JSONSerialization.data(
        withJSONObject: ["cases": manifest,
                         "templates": [
                            ["kind": "clay", "id": TemplateFile.Bundled.clay.id,
                             "version": TemplateFile.Bundled.clay.version],
                            ["kind": "humanoid", "id": TemplateFile.Bundled.humanoid.id,
                             "version": TemplateFile.Bundled.humanoid.version],
                         ]],
        options: [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes])
    try manifestData.write(to: root.appendingPathComponent("corpus.json"))

    if problems.isEmpty {
        print("corpus ok -> \(root.path)")
    } else {
        fail("corpus problems:\n" + problems.joined(separator: "\n"))
    }

default:
    fail("usage: humanoid-cli <gate|corpus> [args]")
}
