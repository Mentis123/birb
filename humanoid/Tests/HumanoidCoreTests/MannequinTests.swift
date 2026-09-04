import XCTest
@testable import HumanoidCore

final class MannequinTests: XCTestCase {
    func testSnapshotPassesTheFullPreFlight() {
        let snapshot = Mannequin.snapshot()
        let report = snapshot.validate()
        XCTAssertTrue(report.passes, "placeholder must clear the gate it will be judged by:\n\(report.summary)")
    }

    func testFitsInsideTheMobileGoodTriangleCeiling() {
        let mesh = Mannequin.build()
        XCTAssertLessThanOrEqual(mesh.triangleCount, 10_000,
                                 "mobile Good is 10k triangles; over it the avatar is hidden by default")
        XCTAssertGreaterThan(mesh.triangleCount, 4_000, "too coarse to exercise the exporters usefully")
    }

    func testEveryVertexHasNormalisedDescendingWeights() {
        let mesh = Mannequin.build()
        for (i, influences) in mesh.influences.enumerated() {
            XCTAssertFalse(influences.isEmpty, "vertex \(i) unweighted")
            XCTAssertLessThanOrEqual(influences.count, 4, "vertex \(i) over four influences")
            let total = influences.reduce(0.0) { $0 + $1.weight }
            XCTAssertEqual(total, 1.0, accuracy: 1e-9, "vertex \(i)")
            for (a, b) in zip(influences, influences.dropFirst()) {
                XCTAssertGreaterThanOrEqual(a.weight, b.weight, "vertex \(i) not descending")
            }
        }
    }

    func testNormalsPointAwayFromTheLimbAxis() {
        // A winding mistake makes the whole mannequin render inside-out, which
        // is invisible in a structural check and obvious in Unity.
        let skeleton = Skeleton.defaultHumanoid()
        let mesh = Mannequin.build(skeleton: skeleton)
        let spine = skeleton.restPosition(of: .spine)!
        var checked = 0
        for (i, p) in mesh.positions.enumerated() {
            // Torso vertices near the spine's height, away from the caps.
            guard abs(p.y - spine.y) < 0.03, abs(p.x) > 0.05 else { continue }
            let radial = normalize(Vec3(p.x, 0, p.z))
            XCTAssertGreaterThan(dot(mesh.normals[i], radial), 0.3,
                                 "vertex \(i) normal faces inward")
            checked += 1
        }
        XCTAssertGreaterThan(checked, 20, "expected a meaningful sample of torso vertices")
    }

    func testGenerationIsDeterministic() {
        let a = Mannequin.build(), b = Mannequin.build()
        XCTAssertEqual(a.positions, b.positions)
        XCTAssertEqual(a.indices, b.indices)
        XCTAssertEqual(a.influences.map { $0.map(\.bone) }, b.influences.map { $0.map(\.bone) })
    }

    func testMeshIsLeftRightSymmetric() {
        // Mirroring is what the sculpt tools' X-symmetry will rely on, and an
        // asymmetric rest pose would also skew Unity's avatar orientation.
        // Matching on rounded coordinates is fragile at cell boundaries, so this
        // does a real nearest-neighbour search with a tolerance.
        let mesh = Mannequin.build()
        let cell = 0.01
        var buckets = [Int64: [Int]]()
        func hash(_ p: Vec3) -> Int64 {
            let x = Int64((p.x / cell).rounded()), y = Int64((p.y / cell).rounded()), z = Int64((p.z / cell).rounded())
            return (x &* 73_856_093) ^ (y &* 19_349_663) ^ (z &* 83_492_791)
        }
        for (i, p) in mesh.positions.enumerated() { buckets[hash(p), default: []].append(i) }

        var worst = 0.0
        var unmatched = 0
        for p in mesh.positions where abs(p.x) > 0.02 {
            let target = Vec3(-p.x, p.y, p.z)
            var best = Double.infinity
            for dx in -1...1 {
                for dy in -1...1 {
                    for dz in -1...1 {
                        let probe = target + Vec3(Double(dx) * cell, Double(dy) * cell, Double(dz) * cell)
                        for j in buckets[hash(probe)] ?? [] {
                            best = min(best, length(mesh.positions[j] - target))
                        }
                    }
                }
            }
            if best > 1e-9 { unmatched += 1 }
            worst = max(worst, best)
        }
        XCTAssertEqual(unmatched, 0,
                       String(format: "%d vertices have no mirror partner; worst gap %.3e m", unmatched, worst))
    }

    func testUVsStayInsideTheUnitSquareWithPadding() {
        let mesh = Mannequin.build()
        for (i, uv) in mesh.uvs.enumerated() {
            XCTAssertGreaterThanOrEqual(uv.x, 0, "uv \(i)")
            XCTAssertLessThanOrEqual(uv.x, 1, "uv \(i)")
            XCTAssertGreaterThanOrEqual(uv.y, 0, "uv \(i)")
            XCTAssertLessThanOrEqual(uv.y, 1, "uv \(i)")
        }
    }

    func testIndicesAddressRealVertices() {
        let mesh = Mannequin.build()
        for idx in mesh.indices {
            XCTAssertLessThan(Int(idx), mesh.vertexCount)
        }
        XCTAssertEqual(mesh.indices.count % 3, 0)
    }

    func testEveryRequiredBoneCarriesWeight() {
        let skeleton = Skeleton.defaultHumanoid()
        let mesh = Mannequin.build(skeleton: skeleton)
        var weighted = Set<Int>()
        for influences in mesh.influences {
            for i in influences where i.weight > 0 { weighted.insert(i.bone) }
        }
        // Fingers deliberately carry no geometry in the placeholder; Unity maps
        // them anyway because both hand passes treat dummy bones as real.
        for bone in HumanBone.required {
            XCTAssertTrue(weighted.contains(skeleton.index(of: bone)!),
                          "\(bone.unityNodeName) has no weighted vertices")
        }
    }
}
