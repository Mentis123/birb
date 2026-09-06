import XCTest
@testable import HumanoidCore

/// The real Phase 1 acceptance test.
///
/// `tools/build_template.py` prints its own T-pose report, and that report is
/// tautological: it measures head-to-tail of the bones it has just aimed, so it
/// reads 0.00 degrees whatever the body did. What Unity's auto-mapper actually
/// measures is the direction from a bone's head to its CHILD's head, which is
/// the number `RigGate` checks — and the only way to know the A-pose to T-pose
/// conversion worked is to load the baked bytes back and run that gate on them.
final class TemplateFileTests: XCTestCase {
    private func template() throws -> TemplateFile.Loaded {
        try TemplateFile.Bundled.humanoid.load()
    }

    private func humanoidSkeleton() throws -> Skeleton {
        try XCTUnwrap(template().skeleton, "the humanoid template must carry a rig")
    }

    func testBundledTemplateClearsTheFullPreFlight() throws {
        let loaded = try template()
        let snapshot = ExportSnapshot(
            avatarName: "template",
            templateID: TemplateFile.bundledID,
            templateVersion: TemplateFile.bundledVersion,
            skeleton: loaded.skeleton,
            mesh: loaded.mesh,
            albedo: PNG.Image.solid(width: 4, height: 4, r: 214, g: 176, b: 150),
            albedoRelativePath: "albedo.png")
        let report = snapshot.validate()
        XCTAssertTrue(report.passes,
                      "the shipped body must clear the gate it will be judged by:\n\(report.summary)")
    }

    func testCarriesEveryBoneUnityAndVRChatRequire() throws {
        let skeleton = try humanoidSkeleton()
        for bone in HumanBone.required {
            XCTAssertNotNil(skeleton.index(of: bone), "missing \(bone.unityNodeName)")
        }
        XCTAssertEqual(skeleton.count, 51)
        XCTAssertNil(skeleton.bones[0].parent, "Hips must be the root")
        XCTAssertEqual(skeleton.bones[0].bone, .hips)
    }

    func testParentsPrecedeChildren() throws {
        let skeleton = try humanoidSkeleton()
        var placed = Set<HumanBone>()
        for spec in skeleton.bones {
            if let parent = spec.parent {
                XCTAssertTrue(placed.contains(parent),
                              "\(spec.bone.unityNodeName) precedes its parent \(parent.unityNodeName)")
            }
            placed.insert(spec.bone)
        }
    }

    func testStandsInTheCanonicalSpace() throws {
        let loaded = try template()
        let mesh = loaded.mesh
        let skeleton = try XCTUnwrap(loaded.skeleton)

        let lowest = mesh.positions.map(\.y).min()!
        let highest = mesh.positions.map(\.y).max()!
        XCTAssertEqual(lowest, 0, accuracy: 0.005, "feet stand on y = 0")
        XCTAssertEqual(highest, 1.665, accuracy: 0.05, "roughly human scale")

        // +X is the figure's own left, and it faces +Z. Getting either backwards
        // exports a mirrored avatar that nothing downstream flags.
        XCTAssertGreaterThan(skeleton.restPosition(of: .leftUpperArm)!.x, 0.1)
        XCTAssertLessThan(skeleton.restPosition(of: .rightUpperArm)!.x, -0.1)
        XCTAssertGreaterThan(skeleton.restPosition(of: .leftToes)!.z,
                             skeleton.restPosition(of: .leftFoot)!.z,
                             "toes lead the ankle, so the figure faces +Z")

        // VRChat errors below a 20 cm shoulder height.
        XCTAssertGreaterThan(skeleton.shoulderHeight, 0.2)
    }

    func testArmsReachTheTPoseWithinUnitysArmTolerance() throws {
        let skeleton = try humanoidSkeleton()
        // AvatarSetupTool.sBonePoses allows 5 degrees on the arm chain. Measured
        // head to child head, which is what the mapper scores.
        let chain: [(HumanBone, HumanBone, Double)] = [
            (.leftUpperArm, .leftLowerArm, 1), (.leftLowerArm, .leftHand, 1),
            (.leftHand, .leftMiddleProximal, 1),
            (.rightUpperArm, .rightLowerArm, -1), (.rightLowerArm, .rightHand, -1),
            (.rightHand, .rightMiddleProximal, -1),
        ]
        for (bone, child, sign) in chain {
            let head = skeleton.restPosition(of: bone)!
            let tip = skeleton.restPosition(of: child)!
            let direction = normalize(tip - head)
            let target = Vec3(sign, 0, 0)
            let degrees = acos(min(1, max(-1, dot(direction, target)))) * 180 / .pi
            XCTAssertLessThan(degrees, 5.0,
                              "\(bone.unityNodeName) sits \(degrees) degrees off the T-pose")
        }
    }

    func testMeshIsMirrorSymmetric() throws {
        let mesh = try template().mesh
        // Symmetry is not cosmetic here: the editor mirrors every sculpt stroke
        // across this plane, so an asymmetric base makes a symmetric edit look
        // asymmetric. Bisect-and-mirror establishes it and two later steps used
        // to destroy it — an arm aim that rolled the two sides differently, and
        // a bone-heat solve that returned unequal left/right weights.
        let cell = 1e-4
        var grid = [Int64: [Int]]()
        func key(_ p: Vec3) -> Int64 {
            let x = Int64((p.x / cell).rounded()), y = Int64((p.y / cell).rounded())
            let z = Int64((p.z / cell).rounded())
            return (x &* 73_856_093) ^ (y &* 19_349_663) ^ (z &* 83_492_791)
        }
        for (i, p) in mesh.positions.enumerated() { grid[key(p), default: []].append(i) }

        var worst = 0.0
        for p in mesh.positions {
            let target = Vec3(-p.x, p.y, p.z)
            var best = Double.infinity
            for dx in -1...1 {
                for dy in -1...1 {
                    for dz in -1...1 {
                        let probe = Vec3(target.x + Double(dx) * cell,
                                         target.y + Double(dy) * cell,
                                         target.z + Double(dz) * cell)
                        for j in grid[key(probe)] ?? [] {
                            best = min(best, length(mesh.positions[j] - target))
                        }
                    }
                }
            }
            worst = max(worst, best)
        }
        XCTAssertLessThan(worst, 1e-4, "mesh is not mirror-symmetric")
    }

    func testSkinIsExportReady() throws {
        let mesh = try template().mesh
        XCTAssertEqual(mesh.indices.count % 3, 0)
        for (i, influences) in mesh.influences.enumerated() {
            XCTAssertFalse(influences.isEmpty, "vertex \(i) is unweighted")
            XCTAssertLessThanOrEqual(influences.count, 4, "vertex \(i) has over four influences")
            XCTAssertEqual(influences.reduce(0.0) { $0 + $1.weight }, 1.0, accuracy: 1e-6,
                           "vertex \(i) weights do not sum to 1")
            for (a, b) in zip(influences, influences.dropFirst()) {
                XCTAssertGreaterThanOrEqual(a.weight, b.weight - 1e-9,
                                            "vertex \(i) influences are not sorted descending")
            }
        }
    }

    func testFitsTheMobileGoodTriangleCeiling() throws {
        let mesh = try template().mesh
        XCTAssertLessThanOrEqual(mesh.triangleCount, 10_000,
                                 "mobile Good is 10k triangles; over it the avatar is hidden by default")
        XCTAssertGreaterThan(mesh.triangleCount, 5_000, "too coarse to read as a body")
    }

    func testRejectsATruncatedTemplate() throws {
        let whole = try Data(contentsOf: Bundle.module.url(forResource: "body-v1",
                                                           withExtension: "bin")!)
        XCTAssertThrowsError(try TemplateFile.load(whole.prefix(whole.count / 2))) { error in
            guard case TemplateFile.LoadError.truncated = error as! TemplateFile.LoadError else {
                return XCTFail("expected a truncation error, got \(error)")
            }
        }
    }

    func testRejectsSomethingThatIsNotATemplate() {
        XCTAssertThrowsError(try TemplateFile.load(Data("not a template at all".utf8))) { error in
            guard case TemplateFile.LoadError.badMagic = error as! TemplateFile.LoadError else {
                return XCTFail("expected a magic error, got \(error)")
            }
        }
    }

    func testRejectsATemplateWithTrailingBytes() throws {
        let whole = try Data(contentsOf: Bundle.module.url(forResource: "body-v1",
                                                           withExtension: "bin")!)
        XCTAssertThrowsError(try TemplateFile.load(whole + Data([0]))) { error in
            guard case TemplateFile.LoadError.trailingBytes = error as! TemplateFile.LoadError else {
                return XCTFail("expected a trailing-bytes error, got \(error)")
            }
        }
    }
}
