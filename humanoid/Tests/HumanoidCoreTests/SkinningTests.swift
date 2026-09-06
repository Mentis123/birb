import XCTest
@testable import HumanoidCore

final class SkinningTests: XCTestCase {
    private func template() throws -> TemplateFile.Loaded { try TemplateFile.Bundled.humanoid.load() }

    /// The humanoid template's rig. Skinning is only defined where there is one.
    private func rig(_ loaded: TemplateFile.Loaded) throws -> Skeleton {
        try XCTUnwrap(loaded.skeleton, "the humanoid template must carry a rig")
    }

    private func moved(_ s: Skeleton, _ bone: HumanBone, by delta: Vec3) -> Skeleton {
        Skeleton(bones: s.bones.map {
            $0.bone == bone ? BoneSpec($0.bone, parent: $0.parent, at: $0.restPosition + delta) : $0
        })
    }

    func testDeformingToTheSameSkeletonChangesNothing() throws {
        let loaded = try template()
        let same = Skinning.deform(loaded.mesh, from: try rig(loaded), to: try rig(loaded))
        for (a, b) in zip(same.positions, loaded.mesh.positions) {
            XCTAssertEqual(length(a - b), 0, accuracy: 1e-12)
        }
    }

    func testMovingAJointMovesTheSkinAroundItAndLeavesTheRestAlone() throws {
        let loaded = try template()
        let lift = Vec3(0, 0.06, 0)
        let posed = moved(try rig(loaded), .head, by: lift)
        let deformed = Skinning.deform(loaded.mesh, from: try rig(loaded), to: posed)

        let headIndex = try rig(loaded).index(of: .head)!
        var movedAnything = false
        for vertex in 0..<loaded.mesh.vertexCount {
            let weight = loaded.mesh.influences[vertex]
                .first { $0.bone == headIndex }?.weight ?? 0
            let shift = deformed.positions[vertex] - loaded.mesh.positions[vertex]
            // Each vertex moves by exactly its own weight on the moved joint, so
            // a vertex the head does not drive must not move at all. A rig whose
            // weights leak would move the feet when the head is raised.
            XCTAssertEqual(length(shift - lift * weight), 0, accuracy: 1e-12,
                           "vertex \(vertex) did not move by its head weight")
            if weight > 0.5 { movedAnything = true }
        }
        XCTAssertTrue(movedAnything, "no vertex is bound to the head — the rig is not skinned")
    }

    func testAProportionEditStillClearsTheGate() throws {
        let loaded = try template()
        // The edit the corpus calls broad-shoulders, which is the shape of every
        // proportion change the editor makes.
        let posed = moved(moved(try rig(loaded), .leftShoulder, by: Vec3(0.05, 0, 0)),
                          .rightShoulder, by: Vec3(-0.05, 0, 0))
        let deformed = Skinning.deform(loaded.mesh, from: try rig(loaded), to: posed)
        let report = RigGate.check(skeleton: posed,
                                   mesh: deformed.rigGateBinding(boneCount: posed.count))
        XCTAssertTrue(report.passes, report.summary)
    }

    func testDeformationPreservesTopologyAndSkin() throws {
        let loaded = try template()
        let posed = moved(try rig(loaded), .neck, by: Vec3(0, 0.06, 0))
        let deformed = Skinning.deform(loaded.mesh, from: try rig(loaded), to: posed)
        // Editing must never renumber anything: an export made after an edit has
        // to line up with the template's UV layout and index buffer.
        XCTAssertEqual(deformed.vertexCount, loaded.mesh.vertexCount)
        XCTAssertEqual(deformed.indices, loaded.mesh.indices)
        XCTAssertEqual(deformed.uvs.count, loaded.mesh.uvs.count)
        for (a, b) in zip(deformed.influences, loaded.mesh.influences) {
            XCTAssertEqual(a, b)
        }
    }

    func testNormalsAreRecomputedAndStayUnit() throws {
        let loaded = try template()
        let posed = moved(try rig(loaded), .chest, by: Vec3(0, 0.04, 0.02))
        let deformed = Skinning.deform(loaded.mesh, from: try rig(loaded), to: posed)
        for (i, n) in deformed.normals.enumerated() {
            XCTAssertEqual(length(n), 1.0, accuracy: 1e-9, "normal \(i) is not unit length")
        }
    }
}
