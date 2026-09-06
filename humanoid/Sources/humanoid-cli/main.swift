import Foundation
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
                 document.paint(.init(radius: 0.05, opacity: 0.85, colour: (40, 60, 120)),
                                along: [Vec2(0.20, 0.30), Vec2(0.45, 0.42),
                                        Vec2(0.70, 0.35), Vec2(0.85, 0.60)])
             }),
    ]
}

switch arguments.dropFirst().first {
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
