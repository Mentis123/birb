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
    /// The open sculpt group, kept as it grows rather than re-merged.
    ///
    /// Merging used to rebuild both dictionaries and re-sort every vertex the
    /// stroke had ever touched on every push, and a stroke pushes once a
    /// frame — so a long stroke paid for its whole length again each frame,
    /// and the cost of the next frame grew with the last. Now a push costs
    /// what it touched: a vertex's before-value is taken the first time it is
    /// seen, and the after-values are read once, when the group closes.
    private var openIndex: [Int: Int] = [:]
    private var openVertices: [Int] = []
    private var openBefore: [Vec3] = []

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
        // The brush reports exactly which welded positions it moved, so the
        // undo record is built from that rather than from a separate scan.
        //
        // The scan this replaces (`pendingVertices`) walked every welded
        // position once per dab centre and once more per mirror — 3,458 x 4 x 2
        // set insertions for an ordinary frame of a stroke, to compute a
        // deliberately generous superset of what `apply` was about to tell us
        // anyway. `sculptDelta` is untouched by `apply`, which is what makes
        // reading `before` AFTER the brush has run give the same answer as
        // reading it before.
        let touched = Sculpt.apply(brush, to: &current, tables: tables,
                                   at: points, settings: settings)
        guard !touched.isEmpty else { return 0 }
        let vertices = touched.flatMap { tables.weldMembers[$0] }.sorted()
        let before = vertices.map { sculptDelta[$0] }
        for v in vertices { sculptDelta[v] = current.positions[v] - template.positions[v] }

        push(.sculpt(vertices: vertices, before: before,
                     after: vertices.map { sculptDelta[$0] }))
        return touched.count
    }

    /// Applies dabs that each carry their own brush and settings, and records
    /// them. What the stroke engine hands over once per frame: pressure changes
    /// the radius and strength of every dab, so one settings value per call
    /// would stamp a whole frame with its last sample.
    ///
    /// `base` is the shape the stroke started from and how far the stroke may
    /// move each point of it; see `Sculpt.apply(_:to:tables:base:)`. Without
    /// one, each dab is measured against the live surface.
    @discardableResult
    public mutating func sculpt(_ dabs: [Sculpt.Dab], base: inout Sculpt.StrokeBase?) -> Int {
        guard !dabs.isEmpty else { return 0 }
        let touched: Set<Int>
        if base != nil {
            touched = Sculpt.apply(dabs, to: &current, tables: tables, base: &base!)
        } else {
            touched = Sculpt.apply(dabs, to: &current, tables: tables)
        }
        guard !touched.isEmpty else { return 0 }
        let vertices = touched.flatMap { tables.weldMembers[$0] }.sorted()
        let before = vertices.map { sculptDelta[$0] }
        for v in vertices { sculptDelta[v] = current.positions[v] - template.positions[v] }
        push(.sculpt(vertices: vertices, before: before,
                     after: vertices.map { sculptDelta[$0] }))
        return touched.count
    }

    /// The mirror image of a surface point and a triangle under it, for a
    /// symmetric paint stroke. See `SurfacePaint.mirror`.
    public func mirror(of point: Vec3, triangle: Int) -> (point: Vec3, seed: Int)? {
        SurfacePaint.mirror(of: point, triangle: triangle, mesh: current, tables: tables)
    }

    // MARK: - Grab

    private var grabSet: Sculpt.GrabSet?
    /// The distinct vertices the open Grab owns, sorted, and their deltas when
    /// it began. The undo record wants each vertex once; `GrabSet.vertices`
    /// lists a vertex twice when it falls in both mirror halves.
    private var grabRecordVertices: [Int] = []
    private var grabBefore: [Vec3] = []

    /// Whether a Grab gesture is open.
    public var isGrabbing: Bool { grabSet != nil }

    /// Opens a Grab: decides what it holds and remembers where that was.
    ///
    /// Returns false if the brush caught nothing, which the caller should treat
    /// as "this gesture is not a grab" rather than retrying per frame.
    @discardableResult
    public mutating func beginGrab(at centre: Vec3, settings: Sculpt.Settings) -> Bool {
        endGrab()
        let set = Sculpt.captureGrab(at: centre, mesh: current, tables: tables,
                                     settings: settings)
        guard !set.isEmpty else { return false }
        grabSet = set
        grabRecordVertices = Array(Set(set.vertices)).sorted()
        grabBefore = grabRecordVertices.map { sculptDelta[$0] }
        return true
    }

    /// Places the open Grab at a TOTAL displacement from where it began.
    ///
    /// Total, not incremental: the caller hands over the whole travel of the
    /// gesture so far, so a frame that drops samples or one that delivers six
    /// land in the same place. Re-pushing the record each frame is what the
    /// stroke merge is for — `before` keeps the value from the first push and
    /// `after` takes the newest, so undo returns to before the drag began.
    @discardableResult
    public mutating func grab(to displacement: Vec3) -> Int {
        guard let set = grabSet else { return 0 }
        Sculpt.apply(set, displacement: displacement, to: &current, tables: tables)
        for v in grabRecordVertices {
            sculptDelta[v] = current.positions[v] - template.positions[v]
        }
        push(.sculpt(vertices: grabRecordVertices, before: grabBefore,
                     after: grabRecordVertices.map { sculptDelta[$0] }))
        return set.weldedCount
    }

    public mutating func endGrab() {
        guard grabSet != nil else { return }
        grabSet = nil
        grabRecordVertices.removeAll(keepingCapacity: true)
        grabBefore.removeAll(keepingCapacity: true)
    }

    // MARK: - Painting

    /// Texel coverage per triangle, built once and reused for the life of the
    /// document. Topology and UVs never change, so nothing can invalidate it.
    private var surfaceMap: SurfacePaint.Map?
    private var paintStroke: SurfacePaint.Stroke?
    private var paintOrigin: PNG.Image?
    /// The last stroke, kept for its alpha buffer. A stroke needs one byte per
    /// texel — a megabyte at 1024², four at 2048² — and allocating and zeroing
    /// it at every touch-down put that cost in the first frame of every
    /// stroke. `reset` clears only the rectangle the last stroke dirtied.
    private var spareStroke: SurfacePaint.Stroke?

    /// Builds the paint map if it is not built yet.
    ///
    /// Worth calling off the critical path — at load, or while the user is still
    /// looking at the model — because the first paint stroke otherwise pays for
    /// it and starts with a hitch.
    public mutating func prepareForPainting() {
        guard surfaceMap == nil else { return }
        surfaceMap = SurfacePaint.Map(template, width: albedo.width, height: albedo.height)
    }

    /// Whether the paint map is built yet.
    public var isPreparedForPainting: Bool { surfaceMap != nil }

    /// The size the paint map has to be built at, for a caller building it
    /// somewhere other than here.
    public var paintMapSize: (width: Int, height: Int) { (albedo.width, albedo.height) }

    /// Installs a map built elsewhere — on a background thread, in practice.
    ///
    /// The map depends only on the template and the texture size, both of
    /// which are immutable, so it can be built from a copy of `template` off
    /// the main thread and handed back. That is how the app keeps the 763 ms
    /// debug-build cost of building it out of the way of the first frame.
    /// Ignored if a map is already present or the size does not match.
    public mutating func installPaintMap(_ map: SurfacePaint.Map) {
        guard surfaceMap == nil,
              map.width == albedo.width, map.height == albedo.height else { return }
        surfaceMap = map
    }

    /// Opens a paint stroke. Everything until `endPaintStroke` is one undo step
    /// and one idempotent pass over the texture.
    public mutating func beginPaintStroke(_ brush: SurfacePaint.Brush) {
        prepareForPainting()
        guard let surfaceMap else { return }
        endPaintStroke()
        paintOrigin = albedo
        if var reused = spareStroke, reused.map.width == surfaceMap.width,
           reused.map.height == surfaceMap.height {
            spareStroke = nil
            reused.reset(brush: brush, origin: albedo)
            reused.base = baseColour
            paintStroke = reused
        } else {
            paintStroke = SurfacePaint.Stroke(map: surfaceMap, brush: brush, origin: albedo,
                                              base: baseColour)
        }
    }

    /// Extends the open paint stroke to a point on the surface.
    @discardableResult
    public mutating func paint(to point: Vec3, seed: Int) -> Paint.Rect {
        guard paintStroke != nil else { return .empty }
        return paintStroke!.extend(to: point, seed: seed, mesh: current,
                                   tables: tables, into: &albedo)
    }

    /// Extends the open paint stroke with the brush as it is NOW — radius and
    /// opacity follow the Pencil's pressure sample by sample, and the segment
    /// tapers from the previous brush to this one — and, when `mirror` is
    /// given, paints its mirror image in the same pass.
    @discardableResult
    public mutating func paint(to point: Vec3, seed: Int, brush: SurfacePaint.Brush,
                               mirror: (point: Vec3, seed: Int)?) -> Paint.Rect {
        guard paintStroke != nil else { return .empty }
        paintStroke!.brush = brush
        return paintStroke!.extend(to: point, seed: seed, mirror: mirror, mesh: current,
                                   tables: tables, into: &albedo)
    }

    /// The pointer left the model: the next point starts a new segment rather
    /// than joining this one through the air.
    public mutating func liftPaint() {
        paintStroke?.lift()
    }

    /// Whether a paint stroke is open.
    public var isPainting: Bool { paintStroke != nil }

    /// Closes the stroke and records it as one undoable step.
    public mutating func endPaintStroke() {
        guard let stroke = paintStroke, let origin = paintOrigin else { return }
        paintStroke = nil
        paintOrigin = nil
        spareStroke = stroke
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
        // A captured Grab belongs to one gesture by construction; letting it
        // outlive the group would apply the next drag's displacement to the
        // previous drag's vertices.
        endGrab()
        flushStroke()
    }

    /// Closes the open stroke WITHOUT recording it, and puts back everything
    /// it changed: the shape, the texels and any captured Grab. The history
    /// and the redo branch are left exactly as they were before it began.
    ///
    /// For a gesture that turned out not to be a stroke; see
    /// `StrokeEngine.discard(_:)`. Closes the whole group however deeply it
    /// is nested. Returns whether the shape moved back, and the texels that
    /// did, for the caller's uploads.
    @discardableResult
    public mutating func discardStroke() -> (mesh: Bool, texture: Paint.Rect) {
        var texture = Paint.Rect.empty
        if let stroke = paintStroke, let origin = paintOrigin {
            paintStroke = nil
            paintOrigin = nil
            spareStroke = stroke
            texture = stroke.dirty
            paste(copy(origin, texture), into: texture)
        }
        endGrab()
        // The open group's before-values are each vertex's value the first
        // time the stroke touched it, which is exactly what undo would restore.
        var moved = Set<Int>()
        for (i, v) in openVertices.enumerated() {
            sculptDelta[v] = openBefore[i]
            current.positions[v] = template.positions[v] + openBefore[i]
            moved.insert(tables.weldOf[v])
        }
        if !moved.isEmpty { current.recomputeNormals(tables, touching: moved) }
        openIndex.removeAll(keepingCapacity: true)
        openVertices.removeAll(keepingCapacity: true)
        openBefore.removeAll(keepingCapacity: true)
        strokeDepth = 0
        return (!moved.isEmpty, texture)
    }

    private mutating func push(_ record: Record) {
        guard strokeDepth > 0 else { return commit(record) }
        guard case .sculpt(let vertices, let before, _) = record else {
            // Only sculpt merges. A paint record carries pixel payloads that do
            // not combine without stitching them, and paint is already one
            // record per gesture, so grouping it buys nothing. Flushing and
            // committing separately costs an extra undo step in a case that does
            // not arise, and never loses data — which the alternative did.
            flushStroke()
            return commit(record)
        }
        // `before` keeps the value from the FIRST time each vertex was touched
        // and `after` is read when the group closes, so undoing the group
        // returns to the state before the gesture began rather than to the
        // middle of it.
        for (i, v) in vertices.enumerated() where openIndex[v] == nil {
            openIndex[v] = openVertices.count
            openVertices.append(v)
            openBefore.append(before[i])
        }
    }

    private mutating func flushStroke() {
        guard !openVertices.isEmpty else { return }
        let order = openVertices.indices.sorted { openVertices[$0] < openVertices[$1] }
        let vertices = order.map { openVertices[$0] }
        let before = order.map { openBefore[$0] }
        openIndex.removeAll(keepingCapacity: true)
        openVertices.removeAll(keepingCapacity: true)
        openBefore.removeAll(keepingCapacity: true)
        commit(.sculpt(vertices: vertices, before: before,
                       after: vertices.map { sculptDelta[$0] }))
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

    /// A rectangle of pixels, a row at a time.
    ///
    /// It used to append four bytes per pixel through a slice, and the undo
    /// record of a big stroke is two of these at the moment the Pencil lifts —
    /// a whole frame, at 2048², spent on bookkeeping in the frame the stroke
    /// ends. Rows are contiguous; copying them as rows is a memcpy each.
    private func copy(_ image: PNG.Image, _ rect: Paint.Rect) -> [UInt8] {
        guard !rect.isEmpty else { return [] }
        let rowBytes = (rect.maxX - rect.minX + 1) * 4
        let rows = rect.maxY - rect.minY + 1
        return [UInt8](unsafeUninitializedCapacity: rowBytes * rows) { out, count in
            image.rgba.withUnsafeBufferPointer { source in
                for r in 0..<rows {
                    let from = ((rect.minY + r) * image.width + rect.minX) * 4
                    (out.baseAddress! + r * rowBytes)
                        .initialize(from: source.baseAddress! + from, count: rowBytes)
                }
            }
            count = rowBytes * rows
        }
    }

    private mutating func paste(_ pixels: [UInt8], into rect: Paint.Rect) {
        guard !rect.isEmpty else { return }
        let rowBytes = (rect.maxX - rect.minX + 1) * 4
        let rows = rect.maxY - rect.minY + 1
        let width = albedo.width
        pixels.withUnsafeBufferPointer { source in
            albedo.rgba.withUnsafeMutableBufferPointer { target in
                for r in 0..<rows {
                    let to = ((rect.minY + r) * width + rect.minX) * 4
                    (target.baseAddress! + to)
                        .update(from: source.baseAddress! + r * rowBytes, count: rowBytes)
                }
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
