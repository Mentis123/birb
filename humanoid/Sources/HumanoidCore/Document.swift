import Foundation

/// One open model: a template, the edits made to it, and enough history to undo.
///
/// The document owns no view and no file handle. It is the thing the editor
/// mutates and the thing the exporter reads, which is what lets the whole edit
/// loop be exercised without an iPad.
///
/// ## What is stored
///
/// Not the mesh. A document is its **template identity plus the deltas**, and
/// the mesh is reconstructed by applying those to the frozen template. That is
/// what makes topology immutable in practice rather than in principle: there is
/// nowhere to put a vertex that the template does not already have.
public struct Document {
    public let kind: TemplateFile.Kind
    public let templateID: String
    public let templateVersion: String

    /// The frozen template, never mutated.
    public let template: MeshData
    public let tables: MeshTables
    /// Present only for a humanoid document.
    public let skeleton: Skeleton?

    /// Per-vertex displacement from the template. Sparse in spirit, dense in
    /// storage: 4,000 vertices at 24 bytes is 96 KB, and a dictionary would cost
    /// more than that in overhead long before a model was half sculpted.
    public private(set) var sculptDelta: [Vec3]
    public private(set) var albedo: PNG.Image
    /// What Erase paints back. The material is opaque, so erasing to
    /// transparency would export as a black patch.
    public let baseColour: (r: UInt8, g: UInt8, b: UInt8)

    /// The current shape, kept up to date in place.
    ///
    /// Stored rather than rebuilt on read. It used to be a computed property
    /// that walked every vertex and recomputed every normal, and the editor
    /// touched it twice per Pencil event — once to sculpt, once for the renderer
    /// to upload — so a gesture paid for two full rebuilds at up to 240 Hz. The
    /// deltas are still the source of truth for undo; this is their running sum.
    private var current: MeshData

    private var history: [Record] = []
    private var redoStack: [Record] = []

    /// Depth of the open stroke group. While this is non-zero every edit merges
    /// into one record instead of pushing its own.
    private var strokeDepth = 0
    private var openStroke: Record?

    /// How many strokes can be undone. The PRD's targets are 30 sculpt and 20
    /// paint; one bound covers both because a record is one stroke either way.
    public var historyLimit: Int = 30

    /// A stroke, stored as what it changed rather than as what it did.
    ///
    /// Replaying operations backwards would need every brush to have an exact
    /// inverse, which Smooth does not, and would drift after a few dozen
    /// strokes. Storing the before-values is bigger and exactly right.
    private enum Record {
        case sculpt(vertices: [Int], before: [Vec3], after: [Vec3])
        case paint(rect: Paint.Rect, before: [UInt8], after: [UInt8])
    }

    public init(_ loaded: TemplateFile.Loaded, id: String, version: String,
                textureSize: Int = 1024,
                baseColour: (r: UInt8, g: UInt8, b: UInt8) = (214, 176, 150)) {
        self.kind = loaded.kind
        self.templateID = id
        self.templateVersion = version
        self.template = loaded.mesh
        self.tables = MeshTables(loaded.mesh)
        self.skeleton = loaded.skeleton
        self.sculptDelta = [Vec3](repeating: .zero, count: loaded.mesh.vertexCount)
        self.baseColour = baseColour
        self.albedo = PNG.Image.solid(width: textureSize, height: textureSize,
                                      r: baseColour.r, g: baseColour.g, b: baseColour.b)
        var start = loaded.mesh
        // Welded from the outset: the template is generated with per-vertex
        // normals, so its seam points disagree before a brush has touched them.
        start.recomputeNormals(self.tables)
        self.current = start
    }

    public static func clay(textureSize: Int = 1024) throws -> Document {
        let bundled = TemplateFile.Bundled.clay
        return Document(try bundled.load(), id: bundled.id, version: bundled.version,
                        textureSize: textureSize)
    }

    public static func humanoid(textureSize: Int = 1024) throws -> Document {
        let bundled = TemplateFile.Bundled.humanoid
        return Document(try bundled.load(), id: bundled.id, version: bundled.version,
                        textureSize: textureSize)
    }

    /// The current shape: template plus deltas, normals welded.
    public var mesh: MeshData { current }

    public var canUndo: Bool { !history.isEmpty }
    public var canRedo: Bool { !redoStack.isEmpty }
    public var undoDepth: Int { history.count }

    // MARK: - Editing

    /// Applies one sculpt stroke and records it.
    ///
    /// A stroke is a whole gesture, not a dab: undo has to take back what the
    /// user thinks of as one action, and they think of a drag as one action.
    @discardableResult
    public mutating func sculpt(_ brush: Sculpt.Brush, at points: [Vec3],
                                settings: Sculpt.Settings) -> Int {
        guard !points.isEmpty else { return 0 }
        let vertices = pendingVertices(brush, at: points, settings: settings)
        let before = vertices.map { sculptDelta[$0] }
        let touched = Sculpt.apply(brush, to: &current, tables: tables,
                                   at: points, settings: settings)
        guard !touched.isEmpty else { return 0 }
        for v in vertices { sculptDelta[v] = current.positions[v] - template.positions[v] }
        let after = vertices.map { sculptDelta[$0] }

        push(.sculpt(vertices: vertices, before: before, after: after))
        return touched.count
    }

    /// Every vertex a run of dabs can reach, so the undo record can snapshot
    /// their prior deltas before the brush overwrites them.
    ///
    /// Deliberately generous — a sphere test per dab centre, plus its mirror —
    /// rather than exact. A vertex listed here but not actually moved records
    /// `before == after`, which undo handles as a no-op; a vertex moved but not
    /// listed would be unrecoverable.
    private func pendingVertices(_ brush: Sculpt.Brush, at points: [Vec3],
                                 settings: Sculpt.Settings) -> [Int] {
        let r2 = settings.radius * settings.radius
        var welded = Set<Int>()
        for w in 0..<tables.weldedCount {
            let p = current.positions[tables.weldMembers[w][0]]
            for centre in points {
                var d = p - centre
                if dot(d, d) <= r2 { welded.insert(w); break }
                if settings.symmetric {
                    d = p - Vec3(-centre.x, centre.y, centre.z)
                    if dot(d, d) <= r2 { welded.insert(w); break }
                }
            }
        }
        return welded.flatMap { tables.weldMembers[$0] }.sorted()
    }

    // MARK: - Painting

    /// Texel coverage per triangle, built once and reused for the life of the
    /// document. Topology and UVs never change, so nothing can invalidate it.
    private var surfaceMap: SurfacePaint.Map?
    private var paintStroke: SurfacePaint.Stroke?
    private var paintOrigin: PNG.Image?

    /// Builds the paint map if it is not built yet.
    ///
    /// Worth calling off the critical path — at load, or while the user is still
    /// looking at the model — because the first paint stroke otherwise pays for
    /// it and starts with a hitch.
    public mutating func prepareForPainting() {
        guard surfaceMap == nil else { return }
        surfaceMap = SurfacePaint.Map(template, width: albedo.width, height: albedo.height)
    }

    /// Opens a paint stroke. Everything until `endPaintStroke` is one undo step
    /// and one idempotent pass over the texture.
    public mutating func beginPaintStroke(_ brush: SurfacePaint.Brush) {
        prepareForPainting()
        guard let surfaceMap else { return }
        endPaintStroke()
        paintOrigin = albedo
        paintStroke = SurfacePaint.Stroke(map: surfaceMap, brush: brush, origin: albedo,
                                          base: baseColour)
    }

    /// Extends the open paint stroke to a point on the surface.
    @discardableResult
    public mutating func paint(to point: Vec3, seed: Int) -> Paint.Rect {
        guard paintStroke != nil else { return .empty }
        return paintStroke!.extend(to: point, seed: seed, mesh: current,
                                   tables: tables, into: &albedo)
    }

    /// Closes the stroke and records it as one undoable step.
    public mutating func endPaintStroke() {
        guard let stroke = paintStroke, let origin = paintOrigin else { return }
        paintStroke = nil
        paintOrigin = nil
        let rect = stroke.dirty
        guard !rect.isEmpty else { return }
        push(.paint(rect: rect, before: copy(origin, rect), after: copy(albedo, rect)))
    }

    /// A whole stroke in one call, for callers that already have the path —
    /// tests, and the frame-batched editor, which hands over a frame's samples
    /// together.
    @discardableResult
    public mutating func paint(_ brush: SurfacePaint.Brush,
                               along path: [(point: Vec3, seed: Int)]) -> Paint.Rect {
        guard !path.isEmpty else { return .empty }
        beginPaintStroke(brush)
        var touched = Paint.Rect.empty
        for step in path { touched = touched.union(paint(to: step.point, seed: step.seed)) }
        endPaintStroke()
        return touched
    }

    public mutating func fill(_ colour: (r: UInt8, g: UInt8, b: UInt8)) {
        let whole = Paint.Rect(minX: 0, minY: 0, maxX: albedo.width - 1, maxY: albedo.height - 1)
        let before = copy(albedo, whole)
        Paint.fill(&albedo, with: colour)
        push(.paint(rect: whole, before: before, after: copy(albedo, whole)))
    }

    // MARK: - History

    public mutating func undo() {
        guard let record = history.popLast() else { return }
        apply(record, forward: false)
        redoStack.append(record)
    }

    public mutating func redo() {
        guard let record = redoStack.popLast() else { return }
        apply(record, forward: true)
        history.append(record)
    }

    /// Opens a stroke group. Everything until `endStroke` becomes one undo step.
    ///
    /// Grab needs this. It has to apply live to track the Pencil, so a single
    /// drag calls `sculpt` dozens of times — and without grouping, undo would
    /// take back one frame of a gesture at a time. A person means the whole
    /// drag when they say "undo that".
    ///
    /// Nested calls are counted so a caller cannot half-close someone else's
    /// group.
    public mutating func beginStroke() { strokeDepth += 1 }

    public mutating func endStroke() {
        guard strokeDepth > 0 else { return }
        strokeDepth -= 1
        guard strokeDepth == 0 else { return }
        flushStroke()
    }

    private mutating func push(_ record: Record) {
        guard strokeDepth > 0 else { return commit(record) }
        guard case .sculpt = record else {
            // Only sculpt merges. A paint record carries pixel payloads that do
            // not combine without stitching them, and paint is already one
            // record per gesture, so grouping it buys nothing. Flushing and
            // committing separately costs an extra undo step in a case that does
            // not arise, and never loses data — which the alternative did.
            flushStroke()
            return commit(record)
        }
        guard let existing = openStroke else { return openStroke = record }
        guard case .sculpt = existing else {
            flushStroke()
            return openStroke = record
        }
        openStroke = merge(existing, record)
    }

    private mutating func flushStroke() {
        guard let stroke = openStroke else { return }
        openStroke = nil
        commit(stroke)
    }

    /// Merges a later sculpt into an open one.
    ///
    /// `before` keeps the value from the FIRST time each vertex was touched and
    /// `after` takes the most recent, so undoing the group returns to the state
    /// before the gesture began rather than to the middle of it.
    private func merge(_ existing: Record, _ next: Record) -> Record {
        guard case .sculpt(let vA, let bA, let aA) = existing,
              case .sculpt(let vB, let bB, let aB) = next else { return next }
        var before = [Int: Vec3](minimumCapacity: vA.count + vB.count)
        var after = [Int: Vec3](minimumCapacity: vA.count + vB.count)
        for (i, v) in vA.enumerated() { before[v] = bA[i]; after[v] = aA[i] }
        for (i, v) in vB.enumerated() {
            if before[v] == nil { before[v] = bB[i] }
            after[v] = aB[i]
        }
        let vertices = before.keys.sorted()
        return .sculpt(vertices: vertices,
                       before: vertices.map { before[$0]! },
                       after: vertices.map { after[$0]! })
    }

    private mutating func commit(_ record: Record) {
        history.append(record)
        // A new edit invalidates the redo branch. Keeping it would let undo,
        // edit, redo produce a state that was never reached by any sequence of
        // user actions.
        redoStack.removeAll(keepingCapacity: true)
        if history.count > historyLimit { history.removeFirst(history.count - historyLimit) }
    }

    private mutating func apply(_ record: Record, forward: Bool) {
        switch record {
        case .sculpt(let vertices, let before, let after):
            let values = forward ? after : before
            var moved = Set<Int>()
            for (i, v) in vertices.enumerated() {
                sculptDelta[v] = values[i]
                current.positions[v] = template.positions[v] + values[i]
                moved.insert(tables.weldOf[v])
            }
            current.recomputeNormals(tables, touching: moved)
        case .paint(let rect, let before, let after):
            paste(forward ? after : before, into: rect)
        }
    }

    private func copy(_ image: PNG.Image, _ rect: Paint.Rect) -> [UInt8] {
        guard !rect.isEmpty else { return [] }
        var out = [UInt8]()
        out.reserveCapacity((rect.maxX - rect.minX + 1) * (rect.maxY - rect.minY + 1) * 4)
        for y in rect.minY...rect.maxY {
            let row = y * image.width
            for x in rect.minX...rect.maxX {
                let i = (row + x) * 4
                out.append(contentsOf: image.rgba[i..<(i + 4)])
            }
        }
        return out
    }

    private mutating func paste(_ pixels: [UInt8], into rect: Paint.Rect) {
        guard !rect.isEmpty else { return }
        var read = 0
        for y in rect.minY...rect.maxY {
            let row = y * albedo.width
            for x in rect.minX...rect.maxX {
                let i = (row + x) * 4
                albedo.rgba[i] = pixels[read]
                albedo.rgba[i + 1] = pixels[read + 1]
                albedo.rgba[i + 2] = pixels[read + 2]
                albedo.rgba[i + 3] = pixels[read + 3]
                read += 4
            }
        }
    }

    // MARK: - Export

    public func exportSnapshot(named name: String) -> ExportSnapshot {
        ExportSnapshot(avatarName: name, templateID: templateID,
                       templateVersion: templateVersion, skeleton: skeleton,
                       mesh: mesh, albedo: albedo,
                       albedoRelativePath: "Textures/\(name)_Albedo.png")
    }

    public func validate() -> Gate.Report { exportSnapshot(named: "preflight").validate() }
}
