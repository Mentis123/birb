import Foundation

/// Pre-flight gate that reproduces, on the build box, the acceptance rules of
/// two systems we cannot run here: Unity's humanoid avatar setup and VRChat's
/// SDK avatar validator.
///
/// It exists because both fail *silently or cryptically*: Unity shows a red
/// cross next to Configure with no Avatar sub-asset, and VRChat prints a short
/// message from `AnalyzeIK`. Catching these on Linux is what keeps the owner's
/// Unity session to a single confirmation instead of a debugging loop.
///
/// This is a hand-transcription of behaviour read from Unity's open-source
/// `AvatarAutoMapper` / `AvatarSetupTool` / `AvatarMappingEditor` and VRChat's
/// shipping SDK 3.10.4 `VRCSdkControlPanelAvatarBuilder.AnalyzeIK`. It is
/// therefore a MODEL of those systems, not the systems themselves, and it is
/// calibrated against recorded real verdicts — see `tools/unity-verdicts.json`
/// and REPORT.md §5.4.
public enum RigGate {
    public enum Severity: String, Sendable, Codable { case error, warning }

    public struct Finding: Sendable, Codable, CustomStringConvertible {
        public let severity: Severity
        public let code: String
        public let message: String
        /// The system whose rule this reproduces, so a failure points at the
        /// right documentation when it needs re-checking.
        public let source: String

        public var description: String { "[\(severity.rawValue)] \(code): \(message) (\(source))" }
    }

    public struct Report: Sendable, Codable {
        public let findings: [Finding]
        public var errors: [Finding] { findings.filter { $0.severity == .error } }
        public var warnings: [Finding] { findings.filter { $0.severity == .warning } }
        public var passes: Bool { errors.isEmpty }

        public var summary: String {
            if findings.isEmpty { return "rig gate: pass (no findings)" }
            let head = passes ? "rig gate: pass with \(warnings.count) warning(s)"
                              : "rig gate: FAIL — \(errors.count) error(s), \(warnings.count) warning(s)"
            return ([head] + findings.map { "  " + $0.description }).joined(separator: "\n")
        }
    }

    /// Minimum separation between consecutive mapped bones. Unity flags
    /// "has bone length of zero" on an exact positional match; a 5 mm floor
    /// means no authored morph can ever reach that state.
    public static let minimumJointSeparation = 0.005

    /// Names that score -1000 in Unity's auto-mapper and can therefore never be
    /// mapped, however well positioned the joint is.
    static let forbiddenNameFragments = ["end", "top", "nub", "palm", "wrist",
                                         "teeth", "tongue", "brow", "lid", "pony", "braid"]

    public static func check(skeleton: Skeleton, mesh: MeshBinding? = nil) -> Report {
        var f = [Finding]()
        f += checkRequiredBones(skeleton)
        f += checkHierarchy(skeleton)
        f += checkTPose(skeleton)
        f += checkJointSeparation(skeleton)
        f += checkNames(skeleton)
        f += checkScaleAndCounts(skeleton)
        if let mesh { f += checkWeights(skeleton, mesh) }
        return Report(findings: f)
    }

    // MARK: - Bone presence

    private static func checkRequiredBones(_ s: Skeleton) -> [Finding] {
        var f = [Finding]()
        for bone in HumanBone.unityRequired.sorted(by: { $0.rawValue < $1.rawValue }) {
            if s.index(of: bone) == nil {
                f.append(Finding(severity: .error, code: "unity.missingRequiredBone",
                                 message: "\(bone.unityNodeName) is missing; Unity needs all 15 required bones or it builds no Avatar at all.",
                                 source: "Unity HumanTrait.RequiredBone"))
            }
        }
        for bone in HumanBone.vrchatAdditional.sorted(by: { $0.rawValue < $1.rawValue }) {
            if s.index(of: bone) == nil {
                f.append(Finding(severity: .error, code: "vrchat.missingSpineBone",
                                 message: "\(bone.unityNodeName) is missing; VRChat's AnalyzeIK blocks the upload without Chest, Neck and both Shoulders (19 bones total, not Unity's 15).",
                                 source: "VRChat SDK 3.10.4 AnalyzeIK"))
            }
        }
        return f
    }

    // MARK: - Hierarchy

    private static func checkHierarchy(_ s: Skeleton) -> [Finding] {
        var f = [Finding]()

        // Shoulders and neck attach to the highest mapped chest bone. We never
        // map UpperChest, which keeps that parent unambiguously Chest.
        for bone in [HumanBone.leftShoulder, .rightShoulder, .neck] {
            guard let idx = s.index(of: bone) else { continue }
            if s.bones[idx].parent != .chest {
                f.append(Finding(severity: .error, code: "vrchat.spineHierarchy",
                                 message: "\(bone.unityNodeName) must be a direct child of Chest. VRChat: 'Spine hierarchy incorrect. Make sure that the parent of both Shoulders and the Neck is the Chest (or UpperChest if set).'",
                                 source: "VRChat SDK 3.10.4 AnalyzeIK"))
            }
        }

        // IK reads the first child, so a twist or prop bone inserted ahead of the
        // next limb bone breaks forearm and shin rotation without any error.
        let firstChildRules: [(HumanBone, HumanBone)] = [
            (.leftUpperArm, .leftLowerArm), (.rightUpperArm, .rightLowerArm),
            (.leftLowerArm, .leftHand), (.rightLowerArm, .rightHand),
            (.leftUpperLeg, .leftLowerLeg), (.rightUpperLeg, .rightLowerLeg),
            (.leftLowerLeg, .leftFoot), (.rightLowerLeg, .rightFoot),
        ]
        for (parent, expected) in firstChildRules {
            let kids = s.children(of: parent)
            if let first = kids.first, first != expected {
                f.append(Finding(severity: .warning, code: "vrchat.limbChildOrder",
                                 message: "\(expected.unityNodeName) should be the first child of \(parent.unityNodeName); found \(first.unityNodeName). VRChat's IK reads the first child and misbehaves silently otherwise.",
                                 source: "VRChat SDK 3.10.4 AnalyzeIK (warning)"))
            }
        }

        // Hips must be the ancestor of everything else.
        for spec in s.bones where spec.bone != .hips {
            if !s.isAncestor(.hips, of: spec.bone) {
                f.append(Finding(severity: .error, code: "unity.hipsNotAncestor",
                                 message: "\(spec.bone.unityNodeName) is not a descendant of Hips; Unity requires every mapped bone to sit under Hips.",
                                 source: "Unity AvatarMappingEditor 'is not a child of'"))
            }
        }
        return f
    }

    // MARK: - T-pose

    /// Direction each bone must point in the rest pose, with Unity's own
    /// tolerance in degrees, read from `AvatarSetupTool.sBonePoses`.
    struct PoseRule {
        let bone: HumanBone
        let towards: HumanBone
        let target: Vec3
        let toleranceDegrees: Double
        /// Foot is judged on the ground plane only.
        var projectToGround = false
    }

    static func poseRules() -> [PoseRule] {
        var rules: [PoseRule] = [
            PoseRule(bone: .spine, towards: .chest, target: Vec3(0, 1, 0), toleranceDegrees: 30),
            PoseRule(bone: .chest, towards: .neck, target: Vec3(0, 1, 0), toleranceDegrees: 30),
            PoseRule(bone: .neck, towards: .head, target: Vec3(0, 1, 0), toleranceDegrees: 30),
        ]
        for (side, names) in [(1.0, LimbNames.left), (-1.0, LimbNames.right)] {
            let outward = Vec3(side, 0, 0)
            rules += [
                PoseRule(bone: names.shoulder, towards: names.upperArm, target: outward, toleranceDegrees: 20),
                PoseRule(bone: names.upperArm, towards: names.lowerArm, target: outward, toleranceDegrees: 5),
                PoseRule(bone: names.lowerArm, towards: names.hand, target: outward, toleranceDegrees: 5),
                PoseRule(bone: names.hand, towards: names.finger(.middle, joint: 0), target: outward, toleranceDegrees: 10),
                PoseRule(bone: names.upperLeg, towards: names.lowerLeg, target: Vec3(0, -1, 0), toleranceDegrees: 15),
                PoseRule(bone: names.lowerLeg, towards: names.foot, target: Vec3(0, -1, 0), toleranceDegrees: 20),
                PoseRule(bone: names.foot, towards: names.toes, target: Vec3(0, 0, 1), toleranceDegrees: 20, projectToGround: true),
            ]
            // Fingers straight along the arm axis; thumbs 45 degrees forward.
            for kind in FingerLayout.Kind.allCases {
                let axis = kind == .thumb ? normalize(Vec3(side, 0, 1)) : outward
                let tolerances = kind == .thumb ? [10.0, 5.0, 5.0] : [10.0, 5.0, 5.0]
                for joint in 0..<2 {
                    rules.append(PoseRule(bone: names.finger(kind, joint: joint),
                                          towards: names.finger(kind, joint: joint + 1),
                                          target: axis, toleranceDegrees: tolerances[joint]))
                }
            }
        }
        return rules
    }

    private static func checkTPose(_ s: Skeleton) -> [Finding] {
        var f = [Finding]()
        for rule in poseRules() {
            guard let from = s.restPosition(of: rule.bone),
                  let to = s.restPosition(of: rule.towards) else { continue }
            var direction = to - from
            if rule.projectToGround { direction.y = 0 }
            let off = angleDegrees(direction, rule.target)
            if off > rule.toleranceDegrees {
                f.append(Finding(severity: .error, code: "unity.notInTPose",
                                 message: String(format: "%@ points %.1f° off its target axis (limit %.0f°). Unity reports this as 'Character not in T-Pose'.",
                                                 rule.bone.unityNodeName, off, rule.toleranceDegrees),
                                 source: "Unity AvatarSetupTool.sBonePoses"))
            }
        }

        // Hips centred on XZ and feet on the ground: the rest of the pose error
        // is computed relative to these.
        if let hips = s.restPosition(of: .hips) {
            if abs(hips.x) > 0.02 || abs(hips.z) > 0.02 {
                f.append(Finding(severity: .warning, code: "unity.hipsOffCentre",
                                 message: String(format: "Hips sits at x=%.3f z=%.3f; Unity computes avatar orientation assuming it is centred.", hips.x, hips.z),
                                 source: "Unity AvatarSetupTool.AvatarComputeOrientation"))
            }
        }
        for foot in [HumanBone.leftFoot, .rightFoot] {
            if let p = s.restPosition(of: foot), p.y > 0.25 || p.y < 0 {
                f.append(Finding(severity: .warning, code: "unity.footOffGround",
                                 message: String(format: "%@ sits at y=%.3f; feet are expected near the ground plane.", foot.unityNodeName, p.y),
                                 source: "Unity AvatarSetupTool"))
            }
        }
        return f
    }

    // MARK: - Joint separation

    private static func checkJointSeparation(_ s: Skeleton) -> [Finding] {
        var f = [Finding]()
        for spec in s.bones {
            guard let parent = spec.parent,
                  let parentPos = s.restPosition(of: parent) else { continue }
            let d = length(spec.restPosition - parentPos)
            if d < minimumJointSeparation {
                f.append(Finding(severity: .error, code: "unity.zeroBoneLength",
                                 message: String(format: "%@ is only %.2f mm from %@; Unity reports 'has bone length of zero' and refuses the mapping.",
                                                 spec.bone.unityNodeName, d * 1000, parent.unityNodeName),
                                 source: "Unity AvatarMappingEditor.GetBoneState"))
            }
        }
        return f
    }

    // MARK: - Names

    private static func checkNames(_ s: Skeleton) -> [Finding] {
        var f = [Finding]()
        var seen = Set<String>()
        for spec in s.bones {
            let name = spec.bone.unityNodeName
            if !seen.insert(name).inserted {
                f.append(Finding(severity: .error, code: "unity.duplicateName",
                                 message: "Duplicate node name '\(name)'. Unity: 'Transform name mapped to a human bone must be unique.'",
                                 source: "Unity AvatarBuilder"))
            }
            let lower = name.lowercased()
            for bad in forbiddenNameFragments where lower.contains(bad) {
                // 'wrist' and 'palm' only veto finger bones; the others veto anywhere.
                let fingerOnly = (bad == "wrist" || bad == "palm")
                let isFinger = FingerLayout.Kind.allCases.contains { lower.contains($0.rawValue) }
                if !fingerOnly || isFinger {
                    f.append(Finding(severity: .error, code: "unity.forbiddenNameToken",
                                     message: "'\(name)' contains '\(bad)', which scores -1000 in Unity's auto-mapper; the bone can never be mapped.",
                                     source: "Unity AvatarAutoMapper.BoneHasBadKeyword"))
                }
            }
            // A left/right token on a centre bone poisons the side match.
            let centre: Set<HumanBone> = [.hips, .spine, .chest, .neck, .head]
            if centre.contains(spec.bone), lower.contains("left") || lower.contains("right") {
                f.append(Finding(severity: .error, code: "unity.sideTokenOnCentreBone",
                                 message: "'\(name)' is a centre bone but carries a left/right token; Unity scores that -1000.",
                                 source: "Unity AvatarAutoMapper.GetBoneSideMatchPoints"))
            }
        }
        return f
    }

    // MARK: - Scale and counts

    private static func checkScaleAndCounts(_ s: Skeleton) -> [Finding] {
        var f = [Finding]()

        if s.shoulderHeight < 0.20 {
            f.append(Finding(severity: .error, code: "vrchat.tooShort",
                             message: String(format: "Shoulder height is %.3f m; VRChat errors below 0.20 m ('This avatar is too short').", s.shoulderHeight),
                             source: "VRChat SDK 3.10.4 AnalyzeIK"))
        }
        if s.shoulderHeight > 5.0 {
            f.append(Finding(severity: .warning, code: "vrchat.veryTall",
                             message: String(format: "Shoulder height is %.2f m; VRChat warns above 5 m.", s.shoulderHeight),
                             source: "VRChat SDK 3.10.4 AnalyzeIK"))
        }
        if s.count > 90 {
            f.append(Finding(severity: .error, code: "vrchat.boneBudget",
                             message: "\(s.count) bones exceeds the mobile Good ceiling of 90 (over 150 is Very Poor and hidden by default).",
                             source: "VRChat performance ranks (mobile)"))
        } else if s.count > 75 {
            f.append(Finding(severity: .warning, code: "vrchat.boneBudget",
                             message: "\(s.count) bones is over the 75-bone Excellent bracket, still within Good (90).",
                             source: "VRChat performance ranks (mobile)"))
        }
        return f
    }

    // MARK: - Skin weights

    /// The subset of mesh data the gate needs. Kept separate from the full
    /// template so a caller can validate a rig before any geometry exists.
    public struct MeshBinding: Sendable {
        /// Per vertex, up to four (bone index, weight) pairs.
        public let influences: [[(bone: Int, weight: Double)]]
        public let boneCount: Int

        public init(influences: [[(bone: Int, weight: Double)]], boneCount: Int) {
            self.influences = influences
            self.boneCount = boneCount
        }
    }

    private static func checkWeights(_ s: Skeleton, _ mesh: MeshBinding) -> [Finding] {
        var f = [Finding]()
        var weightedBones = Set<Int>()
        var reportedNormalisation = 0
        var reportedOrdering = 0

        for (v, influences) in mesh.influences.enumerated() {
            if influences.count > 4 {
                f.append(Finding(severity: .error, code: "unity.tooManyInfluences",
                                 message: "Vertex \(v) has \(influences.count) influences; Unity's BoneWeight holds exactly four.",
                                 source: "Unity BoneWeight"))
            }
            let total = influences.reduce(0.0) { $0 + $1.weight }
            if abs(total - 1.0) > 1e-5, reportedNormalisation < 5 {
                reportedNormalisation += 1
                f.append(Finding(severity: .error, code: "unity.weightsNotNormalised",
                                 message: String(format: "Vertex %d weights sum to %.6f; Unity requires exactly 1.", v, total),
                                 source: "Unity BoneWeight"))
            }
            let descending = zip(influences, influences.dropFirst()).allSatisfy { $0.weight >= $1.weight }
            if !descending, reportedOrdering < 5 {
                reportedOrdering += 1
                f.append(Finding(severity: .error, code: "unity.weightsNotDescending",
                                 message: "Vertex \(v) influences are not in descending weight order, which Unity's BoneWeight requires.",
                                 source: "Unity BoneWeight"))
            }
            for i in influences where i.weight > 0 { weightedBones.insert(i.bone) }
        }

        // A bone with a single child qualifies as an "actual bone" for Unity's
        // auto-mapper only if it carries weight. Branching bones (Hips, Chest,
        // Hand, Head) qualify via their children and may be unweighted.
        for spec in s.bones {
            let isRequired = HumanBone.required.contains(spec.bone)
            let branching = s.children(of: spec.bone).count > 1
            guard isRequired, !branching, let idx = s.index(of: spec.bone) else { continue }
            if !weightedBones.contains(idx) {
                f.append(Finding(severity: .error, code: "unity.unweightedChainBone",
                                 message: "\(spec.bone.unityNodeName) is a single-child chain bone with no skin weight, so Unity's auto-mapper skips it and reports 'Required human bone not found' on a neighbour.",
                                 source: "Unity AvatarSetupTool.GetModelBones"))
            }
        }
        return f
    }
}
