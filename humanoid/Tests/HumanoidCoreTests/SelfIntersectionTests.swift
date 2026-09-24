import XCTest
@testable import HumanoidCore

/// The detector the crossing guard stands on, held against hand-built cases
/// and against the independent oracle on the clay itself.
final class SelfIntersectionTests: XCTestCase {
    /// Two triangles that share nothing: one flat on z = 0, one standing
    /// upright above it, clear of it by `gap`.
    private func pair(gap: Double) -> (MeshData, MeshTables) {
        let positions = [
            Vec3(-1, -1, 0), Vec3(1, -1, 0), Vec3(0, 1, 0),
            Vec3(0, 0, gap), Vec3(0.2, 0, gap + 1), Vec3(-0.2, 0, gap + 1),
        ]
        let mesh = MeshData(positions: positions,
                            normals: Array(repeating: Vec3(0, 0, 1), count: 6),
                            uvs: Array(repeating: Vec2(0, 0), count: 6),
                            indices: [0, 1, 2, 3, 4, 5],
                            influences: Array(repeating: [], count: 6))
        return (mesh, MeshTables(mesh))
    }

    func testACrossingTheMoveMadeIsFound() {
        var (mesh, tables) = pair(gap: 0.1)
        let start = mesh.positions
        // Push the standing triangle's foot through the flat one.
        let foot = tables.weldOf[3]
        mesh.positions[3] = Vec3(0, 0, -0.1)
        XCTAssertTrue(SelfIntersection.created(in: mesh, moved: [foot], from: start, tables: tables))
    }

    func testAMoveThatStaysClearIsNot() {
        var (mesh, tables) = pair(gap: 0.1)
        let start = mesh.positions
        mesh.positions[3] = Vec3(0, 0, 0.05)
        XCTAssertFalse(SelfIntersection.created(in: mesh, moved: [tables.weldOf[3]], from: start,
                                                tables: tables))
    }

    func testACrossingThatWasAlreadyThereIsNotNew() {
        // A brush must never be stuck beside a crossing it did not make.
        var (mesh, tables) = pair(gap: -0.1)
        let start = mesh.positions
        mesh.positions[3] = Vec3(0, 0, -0.2)
        XCTAssertFalse(SelfIntersection.created(in: mesh, moved: [tables.weldOf[3]], from: start,
                                                tables: tables))
    }

    func testTrianglesThatShareACornerAreNotCompared() {
        // A fan of two triangles around one point, the second folded straight
        // through the first. They meet at the shared corner by construction,
        // and that meeting is not a crossing; the limitation this states is
        // that a fold between neighbours is not caught here either.
        let positions = [Vec3(0, 0, 0), Vec3(1, 0, 0), Vec3(0, 1, 0), Vec3(-1, 0.2, 0)]
        var mesh = MeshData(positions: positions,
                            normals: Array(repeating: Vec3(0, 0, 1), count: 4),
                            uvs: Array(repeating: Vec2(0, 0), count: 4),
                            indices: [0, 1, 2, 0, 2, 3],
                            influences: Array(repeating: [], count: 4))
        let tables = MeshTables(mesh)
        let start = mesh.positions
        mesh.positions[3] = Vec3(0.5, 0.3, 0)
        XCTAssertFalse(SelfIntersection.created(in: mesh, moved: [tables.weldOf[3]], from: start,
                                                tables: tables))
    }

    func testTheDetectorAgreesWithTheOracleOnTheClay() throws {
        // Random patches of the clay pushed random distances in random
        // directions — some far enough through the model to cross its other
        // side, most not — and the detector's answer against the oracle's.
        var template = try TemplateFile.Bundled.clay.load().mesh
        let tables = MeshTables(template)
        template.recomputeNormals(tables)
        var generator = SplitMix64(seed: 11)
        var crossingCases = 0
        for trial in 0..<24 {
            var mesh = template
            let centre = tables.weldMembers[Int(generator.next() % UInt64(tables.weldedCount))][0]
            let radius = 0.02 + generator.unit() * 0.05
            let push = normalize(Vec3(generator.unit() - 0.5, generator.unit() - 0.5,
                                      generator.unit() - 0.5)) * (generator.unit() * 0.3)
            var moved = Set<Int>()
            for w in 0..<tables.weldedCount {
                let p = template.positions[tables.weldMembers[w][0]]
                let weight = Sculpt.falloff(distance: length(p - template.positions[centre]),
                                            radius: radius)
                guard weight > 0 else { continue }
                moved.insert(w)
                for m in tables.weldMembers[w] { mesh.positions[m] += push * weight }
            }
            let oracle = !CrossingOracle.created(before: template, after: mesh, moved: moved,
                                                 tables: tables).isEmpty
            if oracle { crossingCases += 1 }
            XCTAssertEqual(SelfIntersection.created(in: mesh, moved: moved, from: template.positions,
                                                    tables: tables), oracle, "trial \(trial)")
        }
        XCTAssertGreaterThan(crossingCases, 3, "too few trials crossed to test anything")
        XCTAssertLessThan(crossingCases, 21, "too few trials stayed clear to test anything")
    }

    func testUntangleScalesTheWholeMoveBackAndNothingElse() throws {
        // A patch of the front face pushed straight through to the back one.
        var template = try TemplateFile.Bundled.clay.load().mesh
        let tables = MeshTables(template)
        template.recomputeNormals(tables)
        var mesh = template
        var moved = Set<Int>()
        for w in 0..<tables.weldedCount {
            let p = template.positions[tables.weldMembers[w][0]]
            let weight = Sculpt.falloff(distance: length(p - Vec3(0, 0, 0.12)), radius: 0.05)
            guard weight > 0 else { continue }
            moved.insert(w)
            for m in tables.weldMembers[w] { mesh.positions[m] += Vec3(0, 0, -0.3) * weight }
        }
        let after = mesh.positions
        XCTAssertFalse(CrossingOracle.created(before: template, after: mesh, moved: moved,
                                              tables: tables).isEmpty, "the setup crossed nothing")
        let kept = Sculpt.untangle(&mesh, moved: moved, from: template.positions, tables: tables)
        // Half the push stops 3 cm short of the back face: the most of the
        // move that is clean is exactly what is kept, not nothing.
        XCTAssertEqual(kept, 0.5)
        XCTAssertTrue(CrossingOracle.created(before: template, after: mesh, moved: moved,
                                             tables: tables).isEmpty)
        // Every moved point sits the same fraction of the way along its own
        // move: scaled as a whole, never point by point.
        for w in moved {
            for m in tables.weldMembers[w] {
                let expected = template.positions[m] + (after[m] - template.positions[m]) * kept
                XCTAssertEqual(length(mesh.positions[m] - expected), 0, accuracy: 1e-12)
            }
        }
    }
}

/// A tiny deterministic generator, so the property test is the same test
/// every run.
private struct SplitMix64 {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
    mutating func unit() -> Double { Double(next() >> 11) / Double(1 << 53) }
}
