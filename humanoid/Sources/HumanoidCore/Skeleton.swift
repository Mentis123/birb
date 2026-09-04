import Foundation

/// The canonical skeleton.
///
/// CANONICAL SPACE (matches glTF/VRM so the primary exporter needs no conversion):
///   right-handed, +Y up, metres, ground at y = 0, the figure faces **+Z**,
///   and **+X is the figure's own left**. VRM 1.0 specifies exactly this.
///
/// Every rule below is enforced by `RigGate` and comes from reading Unity's
/// open-source `AvatarAutoMapper`/`AvatarSetupTool` and VRChat's shipping SDK
/// 3.10.4 validator (`AnalyzeIK`), not from documentation — the public
/// rig-requirements page is stale on the UpperChest rule.
public enum HumanBone: String, CaseIterable, Sendable, Codable {
    case hips, spine, chest, neck, head
    case leftShoulder, leftUpperArm, leftLowerArm, leftHand
    case rightShoulder, rightUpperArm, rightLowerArm, rightHand
    case leftUpperLeg, leftLowerLeg, leftFoot, leftToes
    case rightUpperLeg, rightLowerLeg, rightFoot, rightToes
    case leftThumbProximal, leftThumbIntermediate, leftThumbDistal
    case leftIndexProximal, leftIndexIntermediate, leftIndexDistal
    case leftMiddleProximal, leftMiddleIntermediate, leftMiddleDistal
    case leftRingProximal, leftRingIntermediate, leftRingDistal
    case leftLittleProximal, leftLittleIntermediate, leftLittleDistal
    case rightThumbProximal, rightThumbIntermediate, rightThumbDistal
    case rightIndexProximal, rightIndexIntermediate, rightIndexDistal
    case rightMiddleProximal, rightMiddleIntermediate, rightMiddleDistal
    case rightRingProximal, rightRingIntermediate, rightRingDistal
    case rightLittleProximal, rightLittleIntermediate, rightLittleDistal

    /// Unity `HumanBodyBones` spelling. Used verbatim as the node name so the
    /// auto-mapper's keyword scoring resolves without manual Configure, and so
    /// the side regex (`left`/`right`) matches.
    public var unityNodeName: String {
        let s = rawValue
        return s.prefix(1).uppercased() + s.dropFirst()
    }

    /// VRM 1.0 `humanoid.humanBones` key — already lowerCamelCase.
    public var vrmKey: String { rawValue }

    /// Unity's 15 required bones. Missing any of these means no Avatar at all.
    public static let unityRequired: Set<HumanBone> = [
        .hips, .spine, .head,
        .leftUpperArm, .leftLowerArm, .leftHand,
        .rightUpperArm, .rightLowerArm, .rightHand,
        .leftUpperLeg, .leftLowerLeg, .leftFoot,
        .rightUpperLeg, .rightLowerLeg, .rightFoot,
    ]

    /// VRChat's SDK errors without these four on top of Unity's 15, taking the
    /// hard requirement to 19: `AnalyzeIK` returns false and blocks the build
    /// when neck, either clavicle, pelvis, torso or chest is unmapped.
    public static let vrchatAdditional: Set<HumanBone> = [
        .chest, .neck, .leftShoulder, .rightShoulder,
    ]

    public static var required: Set<HumanBone> { unityRequired.union(vrchatAdditional) }
}

public struct BoneSpec: Sendable {
    public let bone: HumanBone
    public let parent: HumanBone?
    /// World-space rest position in the canonical T-pose, metres.
    public let restPosition: Vec3

    public init(_ bone: HumanBone, parent: HumanBone?, at restPosition: Vec3) {
        self.bone = bone
        self.parent = parent
        self.restPosition = restPosition
    }
}

public struct Skeleton: Sendable {
    /// Parents always precede their children, which glTF node ordering and the
    /// global-transform sweep both rely on.
    public let bones: [BoneSpec]
    private let indexByBone: [HumanBone: Int]

    public init(bones: [BoneSpec]) {
        self.bones = bones
        var idx = [HumanBone: Int]()
        for (i, b) in bones.enumerated() { idx[b.bone] = i }
        self.indexByBone = idx
    }

    public var count: Int { bones.count }
    public func index(of bone: HumanBone) -> Int? { indexByBone[bone] }
    public func restPosition(of bone: HumanBone) -> Vec3? {
        indexByBone[bone].map { bones[$0].restPosition }
    }

    /// Children in declaration order. VRChat warns (and in-game IK silently
    /// misbehaves) unless LowerArm is the FIRST child of UpperArm and Foot the
    /// first child of LowerLeg, so order is part of the contract.
    public func children(of bone: HumanBone) -> [HumanBone] {
        bones.filter { $0.parent == bone }.map(\.bone)
    }

    /// Rest transform of every bone in world space. Bones carry no rotation in
    /// the canonical rest pose and never any scale, so the rest frame is a pure
    /// translation; this keeps `restLocal` and the inverse bind matrices exact.
    public func restGlobal(of bone: HumanBone) -> Mat4? {
        restPosition(of: bone).map { Mat4.translation($0) }
    }

    /// Local transform relative to the parent.
    public func restLocal(of bone: HumanBone) -> Mat4? {
        guard let spec = indexByBone[bone].map({ bones[$0] }) else { return nil }
        guard let parent = spec.parent, let parentPos = restPosition(of: parent) else {
            return Mat4.translation(spec.restPosition)
        }
        return Mat4.translation(spec.restPosition - parentPos)
    }

    /// Inverse bind matrix: the inverse of the bone's global rest transform.
    /// With pose == rest every skinning matrix is identity, so the edited T-pose
    /// mesh renders unchanged — asserted in `SkinningTests`.
    public func inverseBind(of bone: HumanBone) -> Mat4? {
        restGlobal(of: bone)?.inverseAffine
    }

    public func isAncestor(_ ancestor: HumanBone, of descendant: HumanBone) -> Bool {
        var cursor: HumanBone? = indexByBone[descendant].flatMap { bones[$0].parent }
        while let c = cursor {
            if c == ancestor { return true }
            cursor = indexByBone[c].flatMap { bones[$0].parent }
        }
        return false
    }

    /// Crown-to-ground height. VRChat errors below a 20 cm shoulder height and
    /// expects roughly human scale; the export gate checks both.
    public var shoulderHeight: Double {
        max(restPosition(of: .leftShoulder)?.y ?? 0, restPosition(of: .rightShoulder)?.y ?? 0)
    }
}

extension Skeleton {
    /// The frozen v0.1 rig: 51 bones, no eye or jaw bones (they auto-map only
    /// when weighted, and the placeholder mannequin has no eye geometry — both
    /// are declared optional and deferred to the real template in Phase 1).
    ///
    /// UpperChest is deliberately NOT mapped. VRChat resolves the spine rule
    /// against the highest mapped chest bone, so mapping UpperChest would move
    /// the required parent of both shoulders and the neck; leaving it out keeps
    /// the simple, passing arrangement of everything parented to Chest.
    public static func defaultHumanoid() -> Skeleton {
        var specs: [BoneSpec] = [
            BoneSpec(.hips,  parent: nil,    at: Vec3(0, 0.92, 0)),
            BoneSpec(.spine, parent: .hips,  at: Vec3(0, 1.05, 0)),
            BoneSpec(.chest, parent: .spine, at: Vec3(0, 1.18, 0)),
            BoneSpec(.neck,  parent: .chest, at: Vec3(0, 1.40, 0)),
            BoneSpec(.head,  parent: .neck,  at: Vec3(0, 1.48, 0)),
        ]

        // side = +1 for the figure's left (+X), -1 for its right.
        for (side, names) in [(1.0, LimbNames.left), (-1.0, LimbNames.right)] {
            let s = side
            // Arm: shoulder and upper arm share the chest's shoulder line so the
            // arm runs dead-straight along ±X. Unity's T-pose gate allows only
            // 5 degrees of droop on UpperArm and LowerArm.
            specs.append(BoneSpec(names.shoulder, parent: .chest, at: Vec3(0.045 * s, 1.36, 0)))
            specs.append(BoneSpec(names.upperArm, parent: names.shoulder, at: Vec3(0.17 * s, 1.36, 0)))
            specs.append(BoneSpec(names.lowerArm, parent: names.upperArm, at: Vec3(0.44 * s, 1.36, 0)))
            specs.append(BoneSpec(names.hand, parent: names.lowerArm, at: Vec3(0.69 * s, 1.36, 0)))

            // Fingers. Three bones each: Unity discards a hand's entire finger
            // mapping when fewer than three finger bones resolve.
            for finger in FingerLayout.all {
                var parent = names.hand
                for (j, offset) in finger.jointOffsets.enumerated() {
                    let pos = Vec3(0.69 * s + offset.x * s, 1.36 + offset.y, offset.z)
                    let bone = names.finger(finger.kind, joint: j)
                    specs.append(BoneSpec(bone, parent: parent, at: pos))
                    parent = bone
                }
            }

            // Leg: straight down -Y, foot pointing +Z along the ground.
            specs.append(BoneSpec(names.upperLeg, parent: .hips, at: Vec3(0.09 * s, 0.90, 0)))
            specs.append(BoneSpec(names.lowerLeg, parent: names.upperLeg, at: Vec3(0.09 * s, 0.49, 0)))
            specs.append(BoneSpec(names.foot, parent: names.lowerLeg, at: Vec3(0.09 * s, 0.08, 0)))
            specs.append(BoneSpec(names.toes, parent: names.foot, at: Vec3(0.09 * s, 0.03, 0.12)))
        }

        return Skeleton(bones: specs.sortedParentsFirst())
    }
}

// MARK: - Layout tables

struct FingerLayout {
    enum Kind: String, CaseIterable { case thumb, index, middle, ring, little }
    let kind: Kind
    /// Offsets from the hand joint, in canonical space for the LEFT side; the X
    /// component is mirrored for the right.
    let jointOffsets: [Vec3]

    static let all: [FingerLayout] = [
        // Thumb runs 45 degrees forward, matching the (±1, 0, 1) direction Unity
        // scores thumbs against.
        FingerLayout(kind: .thumb, jointOffsets: [
            Vec3(0.022, -0.005, 0.022), Vec3(0.047, -0.005, 0.047), Vec3(0.066, -0.005, 0.066),
        ]),
        FingerLayout(kind: .index, jointOffsets: [
            Vec3(0.030, 0, 0.025), Vec3(0.065, 0, 0.025), Vec3(0.090, 0, 0.025),
        ]),
        FingerLayout(kind: .middle, jointOffsets: [
            Vec3(0.032, 0, 0.000), Vec3(0.070, 0, 0.000), Vec3(0.097, 0, 0.000),
        ]),
        FingerLayout(kind: .ring, jointOffsets: [
            Vec3(0.030, 0, -0.025), Vec3(0.065, 0, -0.025), Vec3(0.089, 0, -0.025),
        ]),
        FingerLayout(kind: .little, jointOffsets: [
            Vec3(0.026, 0, -0.048), Vec3(0.054, 0, -0.048), Vec3(0.073, 0, -0.048),
        ]),
    ]
}

struct LimbNames {
    let shoulder, upperArm, lowerArm, hand: HumanBone
    let upperLeg, lowerLeg, foot, toes: HumanBone
    private let fingerTable: [FingerLayout.Kind: [HumanBone]]

    func finger(_ kind: FingerLayout.Kind, joint: Int) -> HumanBone {
        fingerTable[kind]![joint]
    }

    static let left = LimbNames(
        shoulder: .leftShoulder, upperArm: .leftUpperArm, lowerArm: .leftLowerArm, hand: .leftHand,
        upperLeg: .leftUpperLeg, lowerLeg: .leftLowerLeg, foot: .leftFoot, toes: .leftToes,
        fingerTable: [
            .thumb: [.leftThumbProximal, .leftThumbIntermediate, .leftThumbDistal],
            .index: [.leftIndexProximal, .leftIndexIntermediate, .leftIndexDistal],
            .middle: [.leftMiddleProximal, .leftMiddleIntermediate, .leftMiddleDistal],
            .ring: [.leftRingProximal, .leftRingIntermediate, .leftRingDistal],
            .little: [.leftLittleProximal, .leftLittleIntermediate, .leftLittleDistal],
        ])

    static let right = LimbNames(
        shoulder: .rightShoulder, upperArm: .rightUpperArm, lowerArm: .rightLowerArm, hand: .rightHand,
        upperLeg: .rightUpperLeg, lowerLeg: .rightLowerLeg, foot: .rightFoot, toes: .rightToes,
        fingerTable: [
            .thumb: [.rightThumbProximal, .rightThumbIntermediate, .rightThumbDistal],
            .index: [.rightIndexProximal, .rightIndexIntermediate, .rightIndexDistal],
            .middle: [.rightMiddleProximal, .rightMiddleIntermediate, .rightMiddleDistal],
            .ring: [.rightRingProximal, .rightRingIntermediate, .rightRingDistal],
            .little: [.rightLittleProximal, .rightLittleIntermediate, .rightLittleDistal],
        ])
}

extension Array where Element == BoneSpec {
    /// Stable topological sort so parents always precede children.
    func sortedParentsFirst() -> [BoneSpec] {
        var remaining = self
        var placed = Set<HumanBone>()
        var out = [BoneSpec]()
        while !remaining.isEmpty {
            var progressed = false
            var next = [BoneSpec]()
            for spec in remaining {
                if spec.parent == nil || placed.contains(spec.parent!) {
                    out.append(spec)
                    placed.insert(spec.bone)
                    progressed = true
                } else {
                    next.append(spec)
                }
            }
            precondition(progressed, "cycle or missing parent in skeleton definition")
            remaining = next
        }
        return out
    }
}
