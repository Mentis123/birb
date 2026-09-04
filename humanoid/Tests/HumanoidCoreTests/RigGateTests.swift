import XCTest
@testable import HumanoidCore

final class SkeletonTests: XCTestCase {
    func testDefaultRigPassesTheGate() {
        let report = RigGate.check(skeleton: .defaultHumanoid())
        XCTAssertTrue(report.passes, "default rig must pass its own gate:\n\(report.summary)")
        XCTAssertTrue(report.warnings.isEmpty, "default rig should be warning-free:\n\(report.summary)")
    }

    func testRigHasAllNineteenRequiredBonesAndFitsTheBudget() {
        let s = Skeleton.defaultHumanoid()
        for bone in HumanBone.required {
            XCTAssertNotNil(s.index(of: bone), "\(bone.unityNodeName) missing")
        }
        XCTAssertEqual(HumanBone.required.count, 19, "15 Unity + 4 VRChat")
        XCTAssertEqual(s.count, 51)
        XCTAssertLessThanOrEqual(s.count, 75, "stay inside the Excellent bone bracket")
    }

    func testParentsPrecedeChildren() {
        let s = Skeleton.defaultHumanoid()
        var seen = Set<HumanBone>()
        for spec in s.bones {
            if let p = spec.parent {
                XCTAssertTrue(seen.contains(p), "\(spec.bone.unityNodeName) precedes its parent")
            }
            seen.insert(spec.bone)
        }
    }

    func testPlusXIsTheFiguresLeft() {
        // VRM 1.0 space: +Y up, facing +Z, so the figure's left hand is at +X.
        // Getting this backwards mirrors the avatar and swaps every L/R mapping.
        let s = Skeleton.defaultHumanoid()
        XCTAssertGreaterThan(s.restPosition(of: .leftHand)!.x, 0)
        XCTAssertLessThan(s.restPosition(of: .rightHand)!.x, 0)
        XCTAssertEqual(s.restPosition(of: .leftHand)!.x, -s.restPosition(of: .rightHand)!.x, accuracy: 1e-12)
    }

    func testRestPoseMakesEverySkinningMatrixIdentity() {
        // rest == bind is what lets the app edit in T-pose and export unchanged.
        let s = Skeleton.defaultHumanoid()
        for spec in s.bones {
            let m = s.restGlobal(of: spec.bone)! * s.inverseBind(of: spec.bone)!
            XCTAssertLessThan(m.maxDifference(from: .identity), 1e-12, "\(spec.bone.unityNodeName)")
        }
    }

    func testLocalTransformsComposeBackToGlobals() {
        let s = Skeleton.defaultHumanoid()
        var globals = [HumanBone: Mat4]()
        for spec in s.bones {
            let local = s.restLocal(of: spec.bone)!
            let global = spec.parent.map { globals[$0]! * local } ?? local
            globals[spec.bone] = global
            XCTAssertLessThan(global.maxDifference(from: s.restGlobal(of: spec.bone)!), 1e-12,
                              "\(spec.bone.unityNodeName) local chain diverges from its global")
        }
    }

    func testShouldersAndNeckHangOffChest() {
        let s = Skeleton.defaultHumanoid()
        for bone in [HumanBone.leftShoulder, .rightShoulder, .neck] {
            XCTAssertEqual(s.bones[s.index(of: bone)!].parent, .chest, "\(bone.unityNodeName)")
        }
    }

    func testLimbChainsPutTheNextBoneFirst() {
        let s = Skeleton.defaultHumanoid()
        XCTAssertEqual(s.children(of: .leftUpperArm).first, .leftLowerArm)
        XCTAssertEqual(s.children(of: .leftLowerArm).first, .leftHand)
        XCTAssertEqual(s.children(of: .leftLowerLeg).first, .leftFoot)
        XCTAssertEqual(s.children(of: .rightLowerLeg).first, .rightFoot)
    }

    func testEveryHandHasThreeBonesPerFinger() {
        // Unity discards a hand's whole finger mapping below three finger bones.
        let s = Skeleton.defaultHumanoid()
        let fingerBones = s.bones.filter { spec in
            FingerLayout.Kind.allCases.contains { spec.bone.rawValue.lowercased().contains($0.rawValue) }
        }
        XCTAssertEqual(fingerBones.count, 30, "5 fingers x 3 joints x 2 hands")
    }
}

final class RigGateTests: XCTestCase {
    /// Each negative case below is a real failure mode from the research, and
    /// each must be caught here rather than on the owner's Mac.

    func testCatchesAMissingVRChatSpineBone() {
        let full = Skeleton.defaultHumanoid()
        let trimmed = Skeleton(bones: full.bones.filter { $0.bone != .neck && $0.parent != .neck }
            + full.bones.filter { $0.parent == .neck }.map { BoneSpec($0.bone, parent: .chest, at: $0.restPosition) })
        let report = RigGate.check(skeleton: trimmed)
        XCTAssertFalse(report.passes)
        XCTAssertTrue(report.errors.contains { $0.code == "vrchat.missingSpineBone" }, report.summary)
    }

    func testCatchesShouldersParentedAwayFromChest() {
        let full = Skeleton.defaultHumanoid()
        let rewired = Skeleton(bones: full.bones.map {
            $0.bone == .leftShoulder ? BoneSpec(.leftShoulder, parent: .spine, at: $0.restPosition) : $0
        })
        let report = RigGate.check(skeleton: rewired)
        XCTAssertTrue(report.errors.contains { $0.code == "vrchat.spineHierarchy" }, report.summary)
    }

    func testCatchesAnArmDroopedBeyondFiveDegrees() {
        // A-pose instead of T-pose: the classic 'Character not in T-Pose'.
        let full = Skeleton.defaultHumanoid()
        let drooped = Skeleton(bones: full.bones.map { spec in
            guard spec.bone == .leftLowerArm || spec.bone == .leftHand else { return spec }
            let p = spec.restPosition
            let drop = spec.bone == .leftHand ? 0.09 : 0.04
            return BoneSpec(spec.bone, parent: spec.parent, at: Vec3(p.x, p.y - drop, p.z))
        })
        let report = RigGate.check(skeleton: drooped)
        XCTAssertTrue(report.errors.contains { $0.code == "unity.notInTPose" }, report.summary)
    }

    func testAcceptsATinyDroopInsideTolerance() {
        let full = Skeleton.defaultHumanoid()
        let nudged = Skeleton(bones: full.bones.map { spec in
            guard spec.bone == .leftHand else { return spec }
            // ~0.9 degrees over a 0.25 m forearm: well inside the 5 degree limit.
            return BoneSpec(spec.bone, parent: spec.parent, at: spec.restPosition - Vec3(0, 0.004, 0))
        })
        XCTAssertTrue(RigGate.check(skeleton: nudged).passes)
    }

    func testCatchesCoincidentJoints() {
        let full = Skeleton.defaultHumanoid()
        let collapsed = Skeleton(bones: full.bones.map {
            $0.bone == .neck ? BoneSpec(.neck, parent: .chest, at: full.restPosition(of: .chest)!) : $0
        })
        let report = RigGate.check(skeleton: collapsed)
        XCTAssertTrue(report.errors.contains { $0.code == "unity.zeroBoneLength" }, report.summary)
    }

    func testCatchesAnAvatarScaledBelowVRChatsFloor() {
        let full = Skeleton.defaultHumanoid()
        let tiny = Skeleton(bones: full.bones.map {
            BoneSpec($0.bone, parent: $0.parent, at: $0.restPosition * 0.1)
        })
        let report = RigGate.check(skeleton: tiny)
        XCTAssertTrue(report.errors.contains { $0.code == "vrchat.tooShort" }, report.summary)
    }

    func testCatchesUnnormalisedAndMisorderedWeights() {
        let s = Skeleton.defaultHumanoid()
        let bad = RigGate.MeshBinding(
            influences: [[(bone: 0, weight: 0.5), (bone: 1, weight: 0.2)],
                         [(bone: 0, weight: 0.3), (bone: 1, weight: 0.7)]],
            boneCount: s.count)
        let report = RigGate.check(skeleton: s, mesh: bad)
        XCTAssertTrue(report.errors.contains { $0.code == "unity.weightsNotNormalised" }, report.summary)
        XCTAssertTrue(report.errors.contains { $0.code == "unity.weightsNotDescending" }, report.summary)
    }

    func testCatchesAnUnweightedChainBone() {
        // Spine has one child, so Unity only treats it as a real bone if it
        // carries weight. Hips and Chest branch and are exempt.
        let s = Skeleton.defaultHumanoid()
        let onlyHips = RigGate.MeshBinding(
            influences: [[(bone: s.index(of: .hips)!, weight: 1.0)]], boneCount: s.count)
        let report = RigGate.check(skeleton: s, mesh: onlyHips)
        let unweighted = report.errors.filter { $0.code == "unity.unweightedChainBone" }
        XCTAssertTrue(unweighted.contains { $0.message.contains("Spine") }, report.summary)
        XCTAssertFalse(unweighted.contains { $0.message.contains("Chest") },
                       "Chest branches to neck and both shoulders, so it is exempt")
    }
}
