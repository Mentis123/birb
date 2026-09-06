import XCTest
@testable import HumanoidCore

/// The Clay template, and the boundary that keeps it from being a humanoid with
/// the bones deleted.
final class ClayTemplateTests: XCTestCase {
    private func clay() throws -> TemplateFile.Loaded { try TemplateFile.Bundled.clay.load() }

    private func snapshot(_ loaded: TemplateFile.Loaded) -> ExportSnapshot {
        ExportSnapshot(
            avatarName: "clay",
            templateID: TemplateFile.Bundled.clay.id,
            templateVersion: TemplateFile.Bundled.clay.version,
            skeleton: loaded.skeleton,
            mesh: loaded.mesh,
            albedo: PNG.Image.solid(width: 4, height: 4, r: 214, g: 176, b: 150),
            albedoRelativePath: "albedo.png")
    }

    func testHasNoRigAtAll() throws {
        let loaded = try clay()
        XCTAssertEqual(loaded.kind, .clay)
        XCTAssertNil(loaded.skeleton, "clay must have no skeleton, not an empty one")
        XCTAssertTrue(loaded.mesh.influences.allSatisfy(\.isEmpty),
                      "clay must carry no skin weights")
        XCTAssertFalse(snapshot(loaded).isRigged)
    }

    func testClearsThePreFlightWithoutEverBeingToldItLacksBones() throws {
        let report = snapshot(try clay()).validate()
        XCTAssertTrue(report.passes, report.summary)
        // The point of splitting the gates. A permanent error in a panel that is
        // supposed to mean something is how people learn to ignore the panel.
        XCTAssertFalse(report.summary.lowercased().contains("bone"),
                       "an unrigged document must never be told it is missing bones:\n\(report.summary)")
    }

    func testIsARoundedCubeOfTheRightDensity() throws {
        let mesh = try clay().mesh
        XCTAssertEqual(mesh.triangleCount, 6_912)
        XCTAssertGreaterThan(mesh.triangleCount, 5_000, "too coarse to sculpt")
        XCTAssertLessThan(mesh.triangleCount, 9_000, "denser than the brush budget")

        // Centred on the origin and cubic: every extent the same, and the shape
        // sits between a cube and a sphere rather than at either end.
        for axis in [\Vec3.x, \Vec3.y, \Vec3.z] {
            let lo = mesh.positions.map { $0[keyPath: axis] }.min()!
            let hi = mesh.positions.map { $0[keyPath: axis] }.max()!
            XCTAssertEqual(lo, -0.12, accuracy: 1e-6)
            XCTAssertEqual(hi, 0.12, accuracy: 1e-6)
        }
        let radii = mesh.positions.map { length($0) }
        XCTAssertGreaterThan(radii.max()! / radii.min()!, 1.05, "too spherical to read as a cube")
        XCTAssertLessThan(radii.max()! / radii.min()!, 1.6, "too cubic to sculpt comfortably")
    }

    func testEveryTriangleFacesOutward() throws {
        let mesh = try clay().mesh
        // The shape is convex and centred on the origin, so outward is a positive
        // dot with the face centre. Four of the six faces wound inward on the
        // first bake and rendered as a cube you can see the inside of.
        var inward = 0
        for t in stride(from: 0, to: mesh.indices.count, by: 3) {
            let a = mesh.positions[Int(mesh.indices[t])]
            let b = mesh.positions[Int(mesh.indices[t + 1])]
            let c = mesh.positions[Int(mesh.indices[t + 2])]
            let centre = (a + b + c) * (1.0 / 3.0)
            if dot(cross(b - a, c - a), centre) <= 0 { inward += 1 }
        }
        XCTAssertEqual(inward, 0)
        for (i, n) in mesh.normals.enumerated() {
            XCTAssertGreaterThan(dot(n, mesh.positions[i]), 0, "normal \(i) points inward")
        }
    }

    func testIsMirrorSymmetricExactly() throws {
        let mesh = try clay().mesh
        // Exact, not close. With an even division count the mirror plane lands on
        // a vertex line, so this is a property of the generator; a tolerance here
        // would hide a change to that.
        var present = Set<[Int64]>()
        let cell = 1e-6
        func key(_ p: Vec3) -> [Int64] {
            [Int64((p.x / cell).rounded()), Int64((p.y / cell).rounded()),
             Int64((p.z / cell).rounded())]
        }
        for p in mesh.positions { present.insert(key(p)) }
        let missing = mesh.positions.filter { !present.contains(key(Vec3(-$0.x, $0.y, $0.z))) }
        XCTAssertTrue(missing.isEmpty, "\(missing.count) vertices have no exact mirror partner")
    }

    func testUVsSitInSixIslandsInsideTheUnitSquare() throws {
        let mesh = try clay().mesh
        for (i, uv) in mesh.uvs.enumerated() {
            XCTAssertTrue((0...1).contains(uv.x) && (0...1).contains(uv.y),
                          "UV \(i) is outside the unit square")
        }
        // A 3x2 atlas: six islands, each inset so a brush at the edge of one
        // face cannot bleed into its neighbour in the texture.
        let columns = Set(mesh.uvs.map { Int($0.x * 3.0) < 3 ? Int($0.x * 3.0) : 2 })
        let rows = Set(mesh.uvs.map { Int($0.y * 2.0) < 2 ? Int($0.y * 2.0) : 1 })
        XCTAssertEqual(columns.count, 3)
        XCTAssertEqual(rows.count, 2)
    }

    func testRejectsATemplateWhoseKindAndRigDisagree() throws {
        // Flip the kind byte on the clay template: it now claims to be a humanoid
        // while carrying no bones. The reader must refuse rather than hand back a
        // humanoid with an absent rig for the rest of the app to trip over.
        var bytes = try Data(contentsOf: Bundle.module.url(forResource: "clay-v1",
                                                           withExtension: "bin")!)
        bytes[8] = 1
        XCTAssertThrowsError(try TemplateFile.load(bytes)) { error in
            guard case TemplateFile.LoadError.rigMismatch = error as! TemplateFile.LoadError else {
                return XCTFail("expected a rig-mismatch error, got \(error)")
            }
        }
    }
}
