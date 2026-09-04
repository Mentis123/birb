import Foundation

/// Procedural placeholder mannequin.
///
/// Phase 0 needs a skinned humanoid to push through the exporters and the Unity
/// gate; it does not need the finished artwork. Generating one in code means the
/// export gate is not blocked on the Phase 1 retopology of the MakeHuman CC0
/// body, and it gives deterministic vertex order, symmetry and UV layout for
/// free. The real template replaces this behind the same `MeshData` contract.
///
/// Construction is a set of swept tubes along bone chains, with parallel
/// transport between rings so the surface does not twist at joints, and weights
/// blended in a window around each joint whose width scales with the limb radius
/// (Pinocchio's rule: transition width should be proportional to the distance
/// from the joint to the surface).
public enum Mannequin {
    public static let templateID = "birb.humanoid.placeholder"
    public static let templateVersion = "0.1.0"

    public struct Options: Sendable {
        public var textureSize: Int = 1024
        /// Gutter in UV units so bilinear filtering and mips do not sample
        /// across island borders. 0.006 is ~6 px at 1024, ~12 px at 2048.
        public var uvPadding: Double = 0.006
        public init() {}
    }

    public static func build(skeleton: Skeleton = .defaultHumanoid(),
                             options: Options = Options()) -> MeshData {
        var builder = Builder(skeleton: skeleton, options: options)
        for (i, chain) in chains(for: skeleton).enumerated() {
            builder.sweep(chain, row: i, rowCount: chains(for: skeleton).count)
        }
        var mesh = builder.finish()
        mesh.recomputeNormals()
        return mesh
    }

    /// A complete snapshot ready for either exporter.
    public static func snapshot(avatarName: String = "PlaceholderAvatar",
                                skeleton: Skeleton = .defaultHumanoid(),
                                options: Options = Options()) -> ExportSnapshot {
        let mesh = build(skeleton: skeleton, options: options)
        let albedo = PNG.Image.solid(width: options.textureSize, height: options.textureSize,
                                     r: 214, g: 176, b: 150)
        return ExportSnapshot(avatarName: avatarName,
                              templateID: templateID, templateVersion: templateVersion,
                              skeleton: skeleton, mesh: mesh, albedo: albedo,
                              albedoRelativePath: "Textures/\(avatarName)_Albedo.png")
    }

    // MARK: - Chain description

    struct Chain {
        /// Bones that drive the segments; segment i runs from joint i to i+1 and
        /// is driven by `bones[i]`.
        let bones: [HumanBone]
        /// One more entry than `bones`: the polyline through the joints, ending
        /// at an explicit tip.
        let joints: [Vec3]
        /// Radius at each joint.
        let radii: [Double]
        let sides: Int
        let stepsPerSegment: Int
        let capStart: Bool
        let capEnd: Bool
    }

    static func chains(for s: Skeleton) -> [Chain] {
        func p(_ b: HumanBone) -> Vec3 { s.restPosition(of: b)! }
        var out: [Chain] = [
            Chain(bones: [.hips, .spine, .chest],
                  joints: [p(.hips), p(.spine), p(.chest), p(.neck)],
                  radii: [0.135, 0.125, 0.145, 0.075],
                  sides: 32, stepsPerSegment: 8, capStart: true, capEnd: false),
            Chain(bones: [.neck, .head],
                  joints: [p(.neck), p(.head), Vec3(0, 1.65, 0)],
                  radii: [0.062, 0.098, 0.070],
                  sides: 32, stepsPerSegment: 8, capStart: false, capEnd: true),
        ]
        for (side, names) in [(1.0, LimbNames.left), (-1.0, LimbNames.right)] {
            out.append(Chain(
                bones: [names.shoulder, names.upperArm, names.lowerArm, names.hand],
                joints: [p(names.shoulder), p(names.upperArm), p(names.lowerArm), p(names.hand),
                         p(names.hand) + Vec3(0.095 * side, 0, 0)],
                radii: [0.078, 0.055, 0.045, 0.040, 0.028],
                sides: 24, stepsPerSegment: 6, capStart: true, capEnd: true))
            out.append(Chain(
                bones: [names.upperLeg, names.lowerLeg, names.foot, names.toes],
                joints: [p(names.upperLeg), p(names.lowerLeg), p(names.foot), p(names.toes),
                         p(names.toes) + Vec3(0, -0.012, 0.055)],
                radii: [0.098, 0.062, 0.052, 0.042, 0.030],
                sides: 28, stepsPerSegment: 7, capStart: true, capEnd: true))
        }
        return out
    }

    // MARK: - Sweep

    struct Builder {
        let skeleton: Skeleton
        let options: Options
        var positions = [Vec3]()
        var uvs = [Vec2]()
        var indices = [UInt32]()
        var influences = [[MeshData.Influence]]()

        mutating func sweep(_ chain: Chain, row: Int, rowCount: Int) {
            let stations = Self.stations(of: chain)
            guard stations.count >= 2 else { return }

            // Parallel transport a reference vector so consecutive rings stay
            // aligned; a per-ring arbitrary perpendicular would twist the mesh.
            var reference = Self.anyPerpendicular(to: stations[1].position - stations[0].position)
            var ringStart = [Int]()

            let cellHeight = 1.0 / Double(rowCount)
            let vLow = Double(row) * cellHeight + options.uvPadding
            let vHigh = Double(row + 1) * cellHeight - options.uvPadding
            let uLow = options.uvPadding
            let uHigh = 1.0 - options.uvPadding

            for (i, station) in stations.enumerated() {
                let direction = Self.direction(at: i, in: stations)
                let u = normalize(reference - direction * dot(reference, direction))
                let v = cross(direction, u)
                reference = u

                ringStart.append(positions.count)
                let vCoord = vLow + (vHigh - vLow) * (Double(i) / Double(stations.count - 1))
                // sides + 1 vertices: the duplicate closes the UV seam.
                for k in 0...chain.sides {
                    let theta = 2 * Double.pi * Double(k) / Double(chain.sides)
                    let offset = (u * cos(theta) + v * sin(theta)) * station.radius
                    positions.append(station.position + offset)
                    uvs.append(Vec2(uLow + (uHigh - uLow) * Double(k) / Double(chain.sides), vCoord))
                    influences.append(station.influences)
                }
            }

            for i in 0..<(stations.count - 1) {
                let a = ringStart[i], b = ringStart[i + 1]
                for k in 0..<chain.sides {
                    let i0 = UInt32(a + k), i1 = UInt32(a + k + 1)
                    let j0 = UInt32(b + k), j1 = UInt32(b + k + 1)
                    // Wound so the face normal is +u (radially outward). The
                    // opposite order builds a mannequin that renders inside-out,
                    // which no structural check would notice.
                    indices.append(contentsOf: [i0, j1, j0])
                    indices.append(contentsOf: [i0, i1, j1])
                }
            }

            if chain.capStart { addCap(ringStart: ringStart.first!, station: stations.first!, chain: chain, facingForward: false, row: row, rowCount: rowCount) }
            if chain.capEnd { addCap(ringStart: ringStart.last!, station: stations.last!, chain: chain, facingForward: true, row: row, rowCount: rowCount) }
        }

        private mutating func addCap(ringStart: Int, station: Station, chain: Chain,
                                     facingForward: Bool, row: Int, rowCount: Int) {
            let centre = positions.count
            positions.append(station.position)
            // Cap centre sits at the middle of the island's U range; the ring it
            // fans to already carries the correct V.
            uvs.append(Vec2(0.5, uvs[ringStart].y))
            influences.append(station.influences)
            for k in 0..<chain.sides {
                let a = UInt32(ringStart + k), b = UInt32(ringStart + k + 1)
                if facingForward {
                    indices.append(contentsOf: [UInt32(centre), a, b])
                } else {
                    indices.append(contentsOf: [UInt32(centre), b, a])
                }
            }
        }

        func finish() -> MeshData {
            MeshData(positions: positions,
                     normals: [Vec3](repeating: Vec3(0, 1, 0), count: positions.count),
                     uvs: uvs, indices: indices, influences: influences)
        }

        struct Station {
            let position: Vec3
            let radius: Double
            let influences: [MeshData.Influence]
        }

        /// Samples the chain, assigning each station its blended bone weights.
        static func stations(of chain: Chain) -> [Station] {
            var out = [Station]()
            let segmentCount = chain.bones.count
            for seg in 0..<segmentCount {
                let a = chain.joints[seg], b = chain.joints[seg + 1]
                let ra = chain.radii[seg], rb = chain.radii[seg + 1]
                let segLength = length(b - a)
                let last = seg == segmentCount - 1
                let steps = last ? chain.stepsPerSegment : chain.stepsPerSegment - 1
                for step in 0...steps {
                    let t = Double(step) / Double(chain.stepsPerSegment)
                    let radius = ra + (rb - ra) * t
                    out.append(Station(position: a + (b - a) * t,
                                       radius: radius,
                                       influences: blend(chain: chain, segment: seg, t: t,
                                                         segmentLength: segLength, radius: radius)))
                }
            }
            return out
        }

        /// Weights for a point at parameter `t` along `segment`.
        ///
        /// The segment belongs to the bone that drives it. Inside a window
        /// around each joint the weight crosses over to the neighbouring bone,
        /// reaching an even split exactly at the joint. The window scales with
        /// the local radius, which is what keeps an elbow from creasing.
        static func blend(chain: Chain, segment: Int, t: Double,
                          segmentLength: Double, radius: Double) -> [MeshData.Influence] {
            let window = max(1e-6, min(1.2 * radius, segmentLength))
            var weights = [HumanBone: Double]()
            weights[chain.bones[segment], default: 0] += 1.0

            let toEnd = (1 - t) * segmentLength
            if segment + 1 < chain.bones.count, toEnd < window {
                let s = 0.5 * (1 - toEnd / window)
                weights[chain.bones[segment], default: 0] -= s
                weights[chain.bones[segment + 1], default: 0] += s
            }
            let toStart = t * segmentLength
            if segment > 0, toStart < window {
                let s = 0.5 * (1 - toStart / window)
                weights[chain.bones[segment], default: 0] -= s
                weights[chain.bones[segment - 1], default: 0] += s
            }
            return normalise(weights)
        }

        static func normalise(_ weights: [HumanBone: Double]) -> [MeshData.Influence] {
            let skeleton = Skeleton.defaultHumanoid()
            var pairs = weights.compactMap { bone, w -> (Int, Double)? in
                guard w > 1e-6, let idx = skeleton.index(of: bone) else { return nil }
                return (idx, w)
            }
            // Descending weight, then bone index, so the result is deterministic
            // even when two influences tie.
            pairs.sort { $0.1 == $1.1 ? $0.0 < $1.0 : $0.1 > $1.1 }
            if pairs.count > 4 { pairs = Array(pairs.prefix(4)) }
            let total = pairs.reduce(0.0) { $0 + $1.1 }
            return pairs.map { MeshData.Influence(bone: $0.0, weight: $0.1 / total) }
        }

        static func direction(at i: Int, in stations: [Station]) -> Vec3 {
            if i == 0 { return normalize(stations[1].position - stations[0].position) }
            if i == stations.count - 1 { return normalize(stations[i].position - stations[i - 1].position) }
            // Average the incoming and outgoing directions so the ring bisects
            // the corner at a joint rather than shearing through it.
            let incoming = normalize(stations[i].position - stations[i - 1].position)
            let outgoing = normalize(stations[i + 1].position - stations[i].position)
            let sum = incoming + outgoing
            return length(sum) > 1e-9 ? normalize(sum) : incoming
        }

        static func anyPerpendicular(to d: Vec3) -> Vec3 {
            let axis = abs(dot(normalize(d), Vec3(0, 0, 1))) < 0.9 ? Vec3(0, 0, 1) : Vec3(1, 0, 0)
            return normalize(cross(normalize(d), axis))
        }
    }
}
