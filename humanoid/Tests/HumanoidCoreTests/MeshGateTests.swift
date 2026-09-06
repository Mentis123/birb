import XCTest
@testable import HumanoidCore

/// The mesh gate has to fail on bad geometry, which means testing it with bad
/// geometry. A gate only ever seen passing is a gate nobody has checked.
final class MeshGateTests: XCTestCase {
    /// Two triangles forming a quad, wound consistently. Small enough to break
    /// deliberately one field at a time.
    private func quad() -> MeshData {
        MeshData(
            positions: [Vec3(0, 0, 0), Vec3(1, 0, 0), Vec3(1, 1, 0), Vec3(0, 1, 0)],
            normals: [Vec3(0, 0, 1), Vec3(0, 0, 1), Vec3(0, 0, 1), Vec3(0, 0, 1)],
            uvs: [Vec2(0, 0), Vec2(1, 0), Vec2(1, 1), Vec2(0, 1)],
            indices: [0, 1, 2, 0, 2, 3],
            influences: Array(repeating: [], count: 4))
    }

    private func codes(_ mesh: MeshData, requiresSkin: Bool = false) -> Set<String> {
        Set(MeshGate.check(mesh, requiresSkin: requiresSkin).errors.map(\.code))
    }

    func testAcceptsASoundUnriggedMesh() {
        XCTAssertTrue(MeshGate.check(quad(), requiresSkin: false).passes)
    }

    func testCatchesANonFinitePosition() {
        var mesh = quad()
        mesh.positions[2] = Vec3(.nan, 0, 0)
        // One NaN propagates through every bounding box and transform that
        // touches it, so the whole model disappears and no importer says why.
        XCTAssertTrue(codes(mesh).contains("POSITION_NOT_FINITE"))
    }

    func testCatchesAnOutOfRangeIndex() {
        let sound = quad()
        let mesh = MeshData(positions: sound.positions, normals: sound.normals,
                            uvs: sound.uvs, indices: [0, 1, 99, 0, 2, 3],
                            influences: sound.influences)
        XCTAssertTrue(codes(mesh).contains("INDEX_RANGE"))
    }

    func testCatchesADegenerateTriangle() {
        let sound = quad()
        // Three collinear points: real indices, no area.
        let mesh = MeshData(
            positions: [Vec3(0, 0, 0), Vec3(1, 0, 0), Vec3(2, 0, 0), Vec3(0, 1, 0)],
            normals: sound.normals, uvs: sound.uvs,
            indices: [0, 1, 2, 0, 2, 3], influences: sound.influences)
        XCTAssertTrue(codes(mesh).contains("DEGENERATE_TRIANGLES"))
    }

    func testCatchesDuplicatedTriangles() {
        let sound = quad()
        let mesh = MeshData(positions: sound.positions, normals: sound.normals,
                            uvs: sound.uvs, indices: [0, 1, 2, 2, 1, 0],
                            influences: sound.influences)
        // Back-to-back surfaces on the same vertices, which is what a mirror
        // does to a face lying in its own plane. They z-fight.
        XCTAssertTrue(codes(mesh).contains("DUPLICATE_TRIANGLES"))
    }

    func testOnlyDemandsSkinWhenTheDocumentIsRigged() {
        let mesh = quad()   // every influence set empty
        XCTAssertFalse(codes(mesh, requiresSkin: false).contains("UNWEIGHTED_VERTICES"))
        XCTAssertTrue(codes(mesh, requiresSkin: true).contains("UNWEIGHTED_VERTICES"))
    }

    func testBothShippedTemplatesPassTheirOwnGate() throws {
        for bundled in [TemplateFile.Bundled.clay, TemplateFile.Bundled.humanoid] {
            let loaded = try bundled.load()
            let report = MeshGate.check(loaded.mesh, requiresSkin: loaded.skeleton != nil)
            XCTAssertTrue(report.passes, "\(bundled.resource):\n\(report.summary)")
        }
    }
}
