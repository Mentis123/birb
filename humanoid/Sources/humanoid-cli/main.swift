import Foundation
import HumanoidCore
import ExporterVRM

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
    let skeleton: Skeleton
    let expectPass: Bool
    var albedo: (r: UInt8, g: UInt8, b: UInt8) = (214, 176, 150)
}

func scaled(_ s: Skeleton, by factor: Double) -> Skeleton {
    Skeleton(bones: s.bones.map { BoneSpec($0.bone, parent: $0.parent, at: $0.restPosition * factor) })
}

func moved(_ s: Skeleton, _ bone: HumanBone, by delta: Vec3) -> Skeleton {
    Skeleton(bones: s.bones.map {
        $0.bone == bone ? BoneSpec($0.bone, parent: $0.parent, at: $0.restPosition + delta) : $0
    })
}

func corpusCases() -> [Case] {
    let base = Skeleton.defaultHumanoid()
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

switch arguments.dropFirst().first {
case "gate":
    let report = RigGate.check(skeleton: .defaultHumanoid(),
                               mesh: Mannequin.build().rigGateBinding(boneCount: Skeleton.defaultHumanoid().count))
    print(report.summary)
    exit(report.passes ? 0 : 1)

case "corpus":
    guard let dir = arguments.dropFirst(2).first else { fail("usage: humanoid-cli corpus <dir>") }
    let root = URL(fileURLWithPath: dir)
    try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)

    var manifest = [[String: Any]]()
    var problems = [String]()

    for c in corpusCases() {
        var options = Mannequin.Options()
        options.textureSize = 512   // corpus files stay small; the app ships 1024/2048
        let mesh = Mannequin.build(skeleton: c.skeleton, options: options)
        let albedo = PNG.Image.solid(width: options.textureSize, height: options.textureSize,
                                     r: c.albedo.r, g: c.albedo.g, b: c.albedo.b)
        let snapshot = ExportSnapshot(
            avatarName: c.name, templateID: Mannequin.templateID,
            templateVersion: Mannequin.templateVersion, skeleton: c.skeleton,
            mesh: mesh, albedo: albedo, albedoRelativePath: "Textures/\(c.name)_Albedo.png")

        let report = snapshot.validate()
        var entry: [String: Any] = [
            "name": c.name,
            "detail": c.detail,
            "expectPass": c.expectPass,
            "gatePassed": report.passes,
            "bones": c.skeleton.count,
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
                let data = try VRMExporter.export(snapshot)
                let url = root.appendingPathComponent("\(c.name).vrm")
                try data.write(to: url)
                entry["file"] = url.lastPathComponent
                entry["bytes"] = data.count
                print(String(format: "  %-20s %6d tris  %7d bytes  %@", (c.name as NSString).utf8String!,
                             mesh.triangleCount, data.count, "written"))
            } catch {
                problems.append("\(c.name): export threw — \(error)")
            }
        } else {
            print("  \(c.name): refused by the gate as expected (\(report.errors.count) error(s))")
        }
        manifest.append(entry)
    }

    let manifestData = try JSONSerialization.data(
        withJSONObject: ["cases": manifest, "templateID": Mannequin.templateID,
                         "templateVersion": Mannequin.templateVersion],
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
