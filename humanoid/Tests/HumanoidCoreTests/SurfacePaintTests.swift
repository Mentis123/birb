import XCTest
@testable import HumanoidCore

/// Painting on the surface: the fix for "painting onto a side has it show up
/// someplace else".
///
/// The clay atlas is a 3x2 grid of face tiles. `+Z` — the face a ray down the
/// axis hits — is column 1, row 1, so it occupies u in [1/3, 2/3] and v in
/// [1/2, 1]. Image rows run DOWN while v runs UP, so `y = (1 - v) * height`
/// puts that tile in the TOP half of the image, y in [0, height/2]. Several
/// tests below turn on that geometry, so it is worked out once here.
final class SurfacePaintTests: XCTestCase {
    private var mesh: MeshData!
    private var tables: MeshTables!
    private var map: SurfacePaint.Map!
    private var image: PNG.Image!

    /// The shipped document size, and not an arbitrary choice.
    ///
    /// `build_clay.py` insets each island by 0.004 of the texture, so the gutter
    /// between two tiles is `0.004 * size` texels wide. The map dilates each
    /// triangle's footprint by 2 texels to cover bilinear filtering, so the
    /// inset has to be the larger of the two or one island's gutter lands in its
    /// neighbour — which is the very bleed this file is about, arriving through
    /// the fix rather than through the bug. At 1024 the inset is 4.1 texels; at
    /// 192, which these tests used first, it is 0.77 and they failed.
    private static let size = 1024

    override func setUpWithError() throws {
        mesh = try TemplateFile.Bundled.clay.load().mesh
        tables = MeshTables(mesh)
        mesh.recomputeNormals(tables)
        map = SurfacePaint.Map(mesh, width: Self.size, height: Self.size)
        image = PNG.Image.solid(width: Self.size, height: Self.size, r: 200, g: 200, b: 200)
    }

    private func hit(x: Double, y: Double) throws -> Picking.Hit {
        try XCTUnwrap(Picking.raycast(mesh, origin: Vec3(x, y, 5), direction: Vec3(0, 0, -1)))
    }

    private func paint(_ points: [Picking.Hit], brush: SurfacePaint.Brush,
                       into target: inout PNG.Image) {
        var stroke = SurfacePaint.Stroke(map: map, brush: brush, origin: target)
        for point in points {
            stroke.extend(to: point.position, seed: point.triangle, mesh: mesh,
                          tables: tables, into: &target)
        }
    }

    private func changedTexels(_ before: PNG.Image, _ after: PNG.Image) -> [(x: Int, y: Int)] {
        var out = [(x: Int, y: Int)]()
        for y in 0..<before.height {
            for x in 0..<before.width {
                let i = (y * before.width + x) * 4
                if before.rgba[i] != after.rgba[i] || before.rgba[i + 1] != after.rgba[i + 1]
                    || before.rgba[i + 2] != after.rgba[i + 2] {
                    out.append((x, y))
                }
            }
        }
        return out
    }

    func testTheAtlasGutterIsWiderThanTheFootprintDilation() {
        // Pins the constraint the size above rests on, for the sizes the app
        // actually ships. A smaller texture silently reintroduces bleed.
        let atlasInset = 0.004
        for size in [1024, 2048] {
            XCTAssertGreaterThan(atlasInset * Double(size),
                                 Double(SurfacePaint.Map.dilation),
                                 "at \(size) the island gutter is narrower than the dilation")
        }
    }

    /// The +Z tile, in texel coordinates, grown by the dilation the map applies.
    private var frontFaceTile: (minX: Int, maxX: Int, minY: Int, maxY: Int) {
        let n = Double(Self.size)
        let slack = SurfacePaint.Map.dilation + 1
        return (minX: Int(n / 3) - slack, maxX: Int(2 * n / 3) + slack,
                minY: 0, maxY: Int(n / 2) + slack)
    }

    // MARK: - The bug

    func testPaintingTheFrontFaceTouchesNoOtherFace() throws {
        let before = image!
        paint([try hit(x: 0, y: 0)],
              brush: .init(radius: 0.04, opacity: 1, colour: (0, 0, 0)), into: &image)

        let changed = changedTexels(before, image)
        XCTAssertFalse(changed.isEmpty, "the brush has to paint something")
        let tile = frontFaceTile
        for texel in changed {
            XCTAssertTrue(texel.x >= tile.minX && texel.x <= tile.maxX
                          && texel.y >= tile.minY && texel.y <= tile.maxY,
                          "texel \(texel) is outside the +Z tile — the brush bled onto another face")
        }
    }

    func testAUVSpaceDiscOfTheSameSizeDoesBleed() throws {
        // The regression's witness. The shipped painter stamped a disc in
        // texture space; at the middle of a face that is already wide enough to
        // cross into the neighbouring tile, which is a different face of the
        // cube at an unrelated place on the model.
        let before = image!
        let centre = try hit(x: 0, y: 0)
        Paint.dab(into: &image, at: centre.uv,
                  brush: Paint.Brush(radius: 0.2, opacity: 1, colour: (0, 0, 0)))

        let tile = frontFaceTile
        let escaped = changedTexels(before, image).filter {
            $0.x < tile.minX || $0.x > tile.maxX || $0.y < tile.minY || $0.y > tile.maxY
        }
        XCTAssertFalse(escaped.isEmpty,
                       "expected the UV-space disc to escape its tile; \(escaped.count) texels did")
    }

    func testABrushOnACubeEdgePaintsBothFacesAndNothingElse() throws {
        // Straddling an edge must paint into exactly the two islands the edge
        // joins. This is the case the old seam helper mapped in the wrong
        // direction, because it assumed both islands shared an orientation.
        let before = image!
        let edge = try XCTUnwrap(Picking.raycast(mesh, origin: Vec3(0.5, 0, 0.5),
                                                 direction: normalize(Vec3(-1, 0, -1))))
        paint([edge], brush: .init(radius: 0.05, opacity: 1, colour: (0, 0, 0)), into: &image)

        let changed = changedTexels(before, image)
        XCTAssertFalse(changed.isEmpty)
        // Group by atlas tile: three columns, two rows.
        var tiles = Set<Int>()
        for texel in changed {
            let col = min(2, texel.x * 3 / Self.size)
            let row = min(1, texel.y * 2 / Self.size)
            tiles.insert(row * 3 + col)
        }
        XCTAssertEqual(tiles.count, 2,
                       "a brush on one edge should reach exactly two faces, reached \(tiles.count)")
    }

    func testPaintIsContinuousAcrossASeam() throws {
        // Sampled along a world-space path over an edge, the painted colour must
        // not step. A gap here is the hard line down the seam that no amount of
        // further painting covers.
        let edge = try XCTUnwrap(Picking.raycast(mesh, origin: Vec3(0.5, 0, 0.5),
                                                 direction: normalize(Vec3(-1, 0, -1))))
        paint([edge], brush: .init(radius: 0.06, opacity: 1, colour: (0, 0, 0)), into: &image)

        // Walk the surface across the edge and read the texture under each step.
        var samples = [Int]()
        for i in 0...20 {
            let t = -0.05 + 0.1 * Double(i) / 20
            // A ray aimed just short of, then just past, the +X/+Z edge.
            let origin = Vec3(0.5 + t, 0, 0.5 - t)
            guard let step = Picking.raycast(mesh, origin: origin,
                                             direction: normalize(Vec3(-1, 0, -1))) else { continue }
            samples.append(Int(Paint.sample(image, at: step.uv).r))
        }
        XCTAssertGreaterThan(samples.count, 10)
        // The profile is a brush falloff, so it necessarily runs from unpainted
        // to fully painted and back — the spread says nothing. What a seam
        // failure looks like is a HOLE: an unpainted sample sitting between two
        // painted ones, because one island received the brush and its partner
        // did not.
        let unpainted = 190
        guard let first = samples.firstIndex(where: { $0 < unpainted }),
              let last = samples.lastIndex(where: { $0 < unpainted }) else {
            return XCTFail("nothing was painted: \(samples)")
        }
        for i in first...last {
            XCTAssertLessThan(samples[i], unpainted,
                              "a hole at sample \(i) — the seam did not paint: \(samples)")
        }
        // And no cliff: a mapped-but-misplaced partner shows as a sudden step
        // rather than a hole.
        for (a, b) in zip(samples, samples.dropFirst()) {
            XCTAssertLessThan(abs(a - b), 70, "the paint jumps across the seam: \(samples)")
        }
    }

    // MARK: - Event rate

    func testTwoSamplesAndFiftySamplesPaintTheSame() throws {
        // The same property the sculpt stroke has, and for the same reason.
        let brush = SurfacePaint.Brush(radius: 0.05, opacity: 0.5, colour: (0, 0, 0))
        let from = -0.06, to = 0.06

        func painted(samples: Int) throws -> PNG.Image {
            var target = image!
            var path = [Picking.Hit]()
            for i in 0...samples {
                path.append(try hit(x: from + (to - from) * Double(i) / Double(samples), y: 0))
            }
            paint(path, brush: brush, into: &target)
            return target
        }

        let coarse = try painted(samples: 2)
        let fine = try painted(samples: 50)
        var worst = 0
        for i in stride(from: 0, to: coarse.rgba.count, by: 4) {
            worst = max(worst, abs(Int(coarse.rgba[i]) - Int(fine.rgba[i])))
        }
        // Not bit-identical: the path is a polyline, so more samples follow the
        // curved surface slightly more closely. What must not happen is the
        // fifty-sample version coming out darker because it blended fifty times.
        XCTAssertLessThan(worst, 20, "event rate changed the paint by \(worst)")
    }

    func testAStationaryPencilDoesNotDarken() throws {
        let brush = SurfacePaint.Brush(radius: 0.05, opacity: 0.4, colour: (0, 0, 0))
        let centre = try hit(x: 0, y: 0)

        var once = image!
        paint([centre], brush: brush, into: &once)

        var held = image!
        paint(Array(repeating: centre, count: 200), brush: brush, into: &held)

        XCTAssertEqual(once.rgba, held.rgba,
                       "holding the Pencil still saturated the paint")
    }

    func testOverlappingPassesWithinOneStrokeDoNotDoubleBlend() throws {
        // A stroke that doubles back over itself. Within one stroke the alpha is
        // a maximum, not an accumulation, so the overlap is not darker.
        let brush = SurfacePaint.Brush(radius: 0.05, opacity: 0.5, colour: (0, 0, 0))
        var there = image!
        let path = try (0...10).map { try hit(x: -0.05 + 0.01 * Double($0), y: 0) }
        paint(path, brush: brush, into: &there)

        var andBack = image!
        paint(path + path.reversed(), brush: brush, into: &andBack)

        XCTAssertEqual(there.rgba, andBack.rgba,
                       "retracing the stroke darkened it")
    }

    func testASecondStrokeDoesBuildUp() throws {
        // The counterpart: idempotence is within a stroke, not across strokes.
        // Lifting the Pencil and going again has to keep adding paint.
        let brush = SurfacePaint.Brush(radius: 0.05, opacity: 0.4, colour: (0, 0, 0))
        let centre = try hit(x: 0, y: 0)
        var target = image!
        paint([centre], brush: brush, into: &target)
        let afterOne = Paint.sample(target, at: centre.uv).r
        paint([centre], brush: brush, into: &target)
        let afterTwo = Paint.sample(target, at: centre.uv).r
        XCTAssertLessThan(afterTwo, afterOne, "a second stroke added no paint")
    }

    // MARK: - Reach

    func testABrushWiderThanTheModelPaintsEveryFace() throws {
        // The positive half of the reach story. Clay is 0.24 across, so a 0.3
        // brush really does cover the whole surface — every face is reachable by
        // walking, and all six should be painted.
        let before = image!
        paint([try hit(x: 0, y: 0)],
              brush: .init(radius: 0.30, opacity: 1, colour: (0, 0, 0)), into: &image)

        var tiles = Set<Int>()
        for texel in changedTexels(before, image) {
            tiles.insert(min(1, texel.y * 2 / Self.size) * 3 + min(2, texel.x * 3 / Self.size))
        }
        XCTAssertEqual(tiles.count, 6, "a brush wider than the model should reach all six faces")
    }

    func testTheBrushDoesNotJumpAGapInTheSurface() throws {
        // Why the search walks the surface instead of testing every triangle
        // against the sphere. A convex cube cannot show this — anything within
        // straight-line reach is also within walking reach — so the case is
        // built directly: two disconnected sheets a third of a brush radius
        // apart, mapped to different halves of the texture.
        //
        // A plain proximity test paints both. That is the bug where a brush on
        // the front of a thin form paints its back, or reaches across a fold.
        let gap = 0.02
        var positions = [Vec3](), uvs = [Vec2](), indices = [UInt32]()
        for (sheet, z) in [(0, 0.0), (1, -gap)] {
            let base = UInt32(sheet * 4)
            for (dx, dy) in [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
                positions.append(Vec3(dx * 0.1, dy * 0.1, z))
                // Sheet 0 occupies the left half of the texture, sheet 1 the right.
                uvs.append(Vec2(0.05 + Double(sheet) * 0.5 + (dx + 1) * 0.2,
                                0.1 + (dy + 1) * 0.4))
            }
            indices.append(contentsOf: [base, base + 1, base + 2, base, base + 2, base + 3])
        }
        let sheets = MeshData(positions: positions,
                              normals: [Vec3](repeating: Vec3(0, 0, 1), count: 8),
                              uvs: uvs, indices: indices,
                              influences: [[MeshData.Influence]](repeating: [], count: 8))
        let sheetTables = MeshTables(sheets)
        let sheetMap = SurfacePaint.Map(sheets, width: Self.size, height: Self.size)

        // A brush three times the gap, aimed at the near sheet.
        let front = try XCTUnwrap(Picking.raycast(sheets, origin: Vec3(0, 0, 1),
                                                  direction: Vec3(0, 0, -1)))
        XCTAssertEqual(front.position.z, 0, accuracy: 1e-9, "expected the near sheet")

        var target = PNG.Image.solid(width: Self.size, height: Self.size, r: 200, g: 200, b: 200)
        let before = target
        var stroke = SurfacePaint.Stroke(map: sheetMap,
                                         brush: .init(radius: gap * 3, opacity: 1,
                                                      colour: (0, 0, 0)),
                                         origin: target)
        stroke.extend(to: front.position, seed: front.triangle, mesh: sheets,
                      tables: sheetTables, into: &target)

        let changed = changedTexels(before, target)
        XCTAssertFalse(changed.isEmpty, "the near sheet should be painted")
        XCTAssertTrue(changed.allSatisfy { $0.x < Self.size / 2 },
                      "the brush jumped the gap onto the far sheet")
    }

    func testABrushSmallerThanOneTriangleStillPaints() throws {
        // The seed triangle is always included, so a brush that reaches no
        // vertex at all still leaves a mark rather than silently doing nothing.
        let before = image!
        paint([try hit(x: 0.002, y: 0.002)],
              brush: .init(radius: 0.0015, opacity: 1, colour: (0, 0, 0)), into: &image)
        XCTAssertFalse(changedTexels(before, image).isEmpty)
    }

    // MARK: - The map

    func testEveryTriangleOwnsSomeTexels() {
        for t in 0..<mesh.triangleCount {
            let count = Int(map.runStart[t + 1]) - Int(map.runStart[t])
            XCTAssertGreaterThan(count, 0, "triangle \(t) covers no texel rows")
        }
    }

    func testTheAffineMapAgreesWithASolvedBarycentric() {
        // The precomputed map replaces a per-texel solve. If it disagrees, every
        // texel is sampled from the wrong place on the model and paint lands
        // subtly askew — which is much harder to see than a crash.
        for t in stride(from: 0, to: mesh.triangleCount, by: 137) {
            let ia = Int(mesh.indices[t * 3]), ib = Int(mesh.indices[t * 3 + 1])
            let ic = Int(mesh.indices[t * 3 + 2])
            let a = mesh.uvs[ia], b = mesh.uvs[ib], c = mesh.uvs[ic]
            let slot = map.basis[t]

            for r in Int(map.runStart[t])..<Int(map.runStart[t + 1]) {
                let run = map.runs[r]
                let x = Int(run.x0) + Int(run.count) / 2, y = Int(run.y)
                let v = slot.vx * Double(x) + slot.vy * Double(y) + slot.vc
                let w = slot.wx * Double(x) + slot.wy * Double(y) + slot.wc

                // Reconstruct the UV from the weights and compare with the
                // texel's own centre.
                let u = 1 - v - w
                let recovered = Vec2(a.x * u + b.x * v + c.x * w,
                                     a.y * u + b.y * v + c.y * w)
                let expected = Vec2((Double(x) + 0.5) / Double(Self.size),
                                    1 - (Double(y) + 0.5) / Double(Self.size))
                XCTAssertEqual(recovered.x, expected.x, accuracy: 1e-9)
                XCTAssertEqual(recovered.y, expected.y, accuracy: 1e-9)
            }
        }
    }

    func testTheMapIsIndependentOfSculpting() throws {
        // Topology and UVs are immutable, so the map is a template constant.
        // If this ever fails, the map has to be rebuilt per stroke and the whole
        // performance argument for it collapses.
        var sculpted = mesh!
        Sculpt.apply(.inflate(0.02), to: &sculpted, tables: tables,
                     at: Vec3(0, 0, 0.12), settings: .init(radius: 0.06, strength: 1))
        let after = SurfacePaint.Map(sculpted, width: Self.size, height: Self.size)
        XCTAssertEqual(after.runCount, map.runCount)
        XCTAssertEqual(after.texelCount, map.texelCount)
    }

    // MARK: - Undo

    func testAProjectedStrokeIsOneUndoStep() throws {
        var document = try Document.clay(textureSize: 128)
        let pristine = document.albedo.rgba
        let path = SurfacePath.acrossFrontFace(of: document.mesh, from: -0.05, to: 0.05)
        XCTAssertFalse(path.isEmpty)

        document.paint(.init(radius: 0.05, opacity: 1, colour: (0, 0, 0)), along: path)
        XCTAssertNotEqual(document.albedo.rgba, pristine)
        XCTAssertTrue(document.canUndo)

        document.undo()
        XCTAssertEqual(document.albedo.rgba, pristine, "one stroke was not one undo step")
    }

    func testErasingRestoresTheDocumentsBaseColour() throws {
        var document = try Document.clay(textureSize: 128)
        let path = SurfacePath.centreOfFrontFace(of: document.mesh)
        document.paint(.init(radius: 0.06, opacity: 1, colour: (0, 0, 0)), along: path)
        let painted = Paint.sample(document.albedo, at: Vec2(0.5, 0.75))

        document.paint(.init(radius: 0.06, opacity: 1, erasing: true), along: path)
        let erased = Paint.sample(document.albedo, at: Vec2(0.5, 0.75))
        XCTAssertLessThan(Int(painted.r), Int(erased.r), "erase did not lighten the paint")
        for i in stride(from: 3, to: document.albedo.rgba.count, by: 4) {
            XCTAssertEqual(document.albedo.rgba[i], 255, "erase punched a transparent hole")
        }
    }
}
