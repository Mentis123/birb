import Foundation
import SwiftUI
import UIKit
import QuartzCore
import HumanoidCore

/// The editor's state: a document, a camera, a tool, and the stroke in progress.
///
/// This is the only place in the app that decides anything. Two rules run
/// through all of it.
///
/// **A stroke is one gesture.** Touch down to touch up is one undo step, because
/// that is what a person means by "the last thing I did".
///
/// **Input is paid for once a frame, not once an event.** A Pencil reports up to
/// 240 times a second and the display refreshes 120 times; the samples are
/// queued as they arrive and drained in `drainInput`, which the renderer calls
/// at the top of each frame. The first version applied the whole chain per
/// event — rebuilding the mesh, recomputing every normal, allocating a GPU
/// buffer and asking for a redraw — which is where the lag came from. None of
/// the arithmetic was slow; it simply ran four times more often than anything
/// could be seen.
@MainActor
final class EditorModel: ObservableObject {
    struct Change: OptionSet {
        let rawValue: Int
        static let mesh = Change(rawValue: 1 << 0)
        static let texture = Change(rawValue: 1 << 1)
        static let camera = Change(rawValue: 1 << 2)
        static let cursor = Change(rawValue: 1 << 3)
        static let all: Change = [.mesh, .texture, .camera, .cursor]
    }

    enum Tool: String, CaseIterable, Identifiable {
        case grab = "Grab"
        case inflate = "Inflate"
        case deflate = "Deflate"
        case smooth = "Smooth"
        case paint = "Paint"
        case erase = "Erase"

        var id: String { rawValue }
        var isPaint: Bool { self == .paint || self == .erase }

        var symbol: String {
            switch self {
            case .grab: return "hand.draw"
            case .inflate: return "arrow.up.left.and.arrow.down.right"
            case .deflate: return "arrow.down.right.and.arrow.up.left"
            case .smooth: return "drop"
            case .paint: return "paintbrush.pointed"
            case .erase: return "eraser"
            }
        }
    }

    /// One Pencil sample, as delivered. Queued rather than acted on.
    struct Sample {
        enum Phase { case began, moved, ended, cancelled }
        var phase: Phase
        /// In drawable pixels, top-left origin.
        var location: Vec2
        /// 0...1, floored so a Pencil held upright still marks.
        var force: Double
    }

    @Published private(set) var document: Document
    @Published var camera = Camera()
    @Published var tool: Tool = .grab
    /// Brush radius in **screen points**, converted to metres at the hit depth.
    ///
    /// ZBrush's Draw Size and Nomad's "Screen" mode both work this way and it is
    /// the better default: a brush fixed in world units is the right size at
    /// exactly one zoom, so zooming in to work on a detail makes the brush
    /// swallow it. Fixed on screen, zooming in buys finer detail for nothing.
    @Published var radiusPoints: Double = 46
    /// Pins the brush to its current world size instead, for anyone who wants
    /// the other behaviour.
    @Published var lockWorldSize = false
    @Published var strength: Double = 0.5
    @Published var symmetric = true
    @Published var fingerEditing = false
    /// The rope stabiliser, off by default. Nomad ships its Lazy Rope on and
    /// has a standing request to turn it off, which is the tell: it changes the
    /// feel of every stroke, so it should be asked for.
    @Published var stabilise = false
    @Published var colour = Color(red: 0.16, green: 0.35, blue: 0.63)
    @Published private(set) var canUndo = false
    @Published private(set) var canRedo = false
    @Published var showStats = false
    /// The debug readout, refreshed a few times a second while it is shown.
    @Published private(set) var hud = ""
    @Published var status: String?

    /// What the frame cost, for the readout. Rebuilding this string every frame
    /// would republish the whole view sixty to a hundred and twenty times a
    /// second to display a number nobody can read that fast.
    private var hudClock: CFTimeInterval = 0
    private var frameSamples: [Double] = []
    private var lastDabs = 0

    /// Set by the viewport so a change can be pushed straight to the renderer
    /// without SwiftUI diffing a mesh.
    var onChange: ((Change) -> Void)?
    /// Asks the viewport to keep drawing continuously — during a stroke and
    /// while the camera coasts. Idle, the view draws only when asked.
    var onActivity: ((Bool) -> Void)?

    // MARK: - Input queue

    private var pending: [Sample] = []
    private var hoverPending: (location: Vec2, height: Double)?
    private var hoverCleared = false

    /// Queues a sample. Called from the touch handlers, possibly several times
    /// per frame; does no work beyond appending.
    func enqueue(_ sample: Sample) {
        pending.append(sample)
        if sample.phase == .began { onActivity?(true) }
    }

    /// Queues a hover position. The cursor is a preview and never touches the
    /// document, so it is kept apart from the stroke queue entirely.
    func enqueueHover(at location: Vec2, height: Double) {
        hoverPending = (location, height)
        hoverCleared = false
    }

    func clearHover() {
        hoverPending = nil
        hoverCleared = true
    }

    // MARK: - Stroke state

    private var strokeOpen = false
    private var sculptStroke: Sculpt.Stroke?
    private var lastScreenPoint: Vec2?
    private var grabDepth: Double = 0
    private var strokeRadius: Double = 0.03
    private var strokeForce: Double = 1
    private var stabiliserAnchor: Vec2?
    private var paintDirty = Paint.Rect.empty
    private(set) var cursor: Renderer.Cursor?

    /// Orbit velocity left over from a flick, in normalised screen units per
    /// second.
    private var spin: Vec2 = .zero
    private var lastFrame: CFTimeInterval = 0

    init(document: Document) {
        self.document = document
        camera.frame(document.mesh)
        // Painting needs a texel map. Building it costs about 30 ms at 1024, so
        // it is paid here rather than inside the user's first paint stroke.
        self.document.prepareForPainting()
    }

    convenience init() {
        // A failure here means the app shipped without its template, which is a
        // build mistake, not a runtime condition to recover from.
        self.init(document: try! Document.clay())
    }

    // MARK: - Camera

    func cameraMoved() {
        spin = .zero
        onChange?(.camera)
    }

    func flick(velocity: Vec2) {
        spin = velocity
        onActivity?(true)
    }

    func frameModel() {
        camera.frame(document.mesh)
        spin = .zero
        onChange?(.camera)
    }

    // MARK: - The frame

    /// Drains a frame's worth of input, advances the camera's coast, and updates
    /// the cursor. Called by the renderer before it encodes anything.
    func drainInput(viewport: Vec2) {
        let now = CACurrentMediaTime()
        let elapsed = lastFrame > 0 ? min(0.1, now - lastFrame) : 1.0 / 120
        lastFrame = now

        var change = Change()
        if applyCoast(elapsed) { change.insert(.camera) }
        change.formUnion(applySamples(viewport: viewport))
        change.formUnion(updateCursor(viewport: viewport))

        if !change.isEmpty { refresh(change) }
        // Hovering counts as activity. Without it the view draws one frame per
        // hover event and pauses in between, so the cursor stutters across the
        // model instead of tracking it.
        if !strokeOpen && length(spin) < 1e-4 && hoverPending == nil { onActivity?(false) }
    }

    /// Exponential decay, the same shape `UIScrollView` uses for a flick. A
    /// turntable that stops dead the instant the finger lifts is the single
    /// clearest tell that a 3D viewport was not finished.
    private func applyCoast(_ elapsed: Double) -> Bool {
        guard length(spin) > 1e-4 else { return false }
        camera.orbit(dx: spin.x * elapsed, dy: spin.y * elapsed)
        spin *= pow(0.998, elapsed * 1000)
        if length(spin) < 1e-4 { spin = .zero }
        return true
    }

    /// Folds the previous frame's cost into the readout. Called by the
    /// renderer, which is the only thing that knows what the GPU did.
    func report(frame stats: Renderer.FrameStats, elapsed: Double) {
        guard showStats else { return }
        frameSamples.append(elapsed * 1000)
        if frameSamples.count > 120 { frameSamples.removeFirst() }
        let now = CACurrentMediaTime()
        guard now - hudClock > 0.25 else { return }
        hudClock = now
        let mean = frameSamples.reduce(0, +) / Double(max(1, frameSamples.count))
        let worst = frameSamples.max() ?? 0
        hud = String(format: "%.1f fps  cpu+gpu %.2f ms (worst %.2f)", mean > 0 ? 1000 / mean : 0,
                     mean, worst)
            + String(format: "\ngpu %.2f ms  draws %d  tris %d",
                     stats.gpuMilliseconds, stats.drawCalls, stats.triangles)
            + String(format: "\nbrush %.0f pt = %.1f mm  dabs/frame %d",
                     radiusPoints, strokeRadius * 1000, lastDabs)
    }

    private func applySamples(viewport: Vec2) -> Change {
        guard !pending.isEmpty else { return [] }
        let samples = pending
        pending.removeAll(keepingCapacity: true)

        var change = Change()
        var sculptCentres = [Vec3]()
        var paintSteps = [(point: Vec3, seed: Int)]()

        for sample in samples {
            switch sample.phase {
            case .began:
                beginStroke()
                strokeForce = sample.force
                lastScreenPoint = sample.location
                stabiliserAnchor = sample.location
                guard let hit = pick(sample.location, viewport: viewport) else { continue }
                grabDepth = hit.distance
                strokeRadius = worldRadius(at: hit.distance, viewport: viewport)
                sculptStroke = Sculpt.Stroke(settings: settings())
                if tool.isPaint {
                    document.beginPaintStroke(paintBrush())
                    paintSteps.append((hit.position, hit.triangle))
                } else if tool != .grab {
                    sculptCentres.append(contentsOf: sculptStroke!.advance(to: hit.position))
                }

            case .moved:
                strokeForce = sample.force
                let point = stabilised(sample.location)
                defer { lastScreenPoint = point }
                guard let hit = pick(point, viewport: viewport) else { continue }
                strokeRadius = worldRadius(at: hit.distance, viewport: viewport)
                if tool == .grab {
                    // Grab tracks the Pencil, so its delta is screen travel
                    // converted at the depth the stroke started on. Converting
                    // at the current depth instead makes the model slide out
                    // from under the tip as the surface moves.
                    guard let last = lastScreenPoint else { continue }
                    let screenDelta = Vec2(point.x - last.x, point.y - last.y)
                    let world = camera.worldDelta(screenDelta: screenDelta,
                                                  viewport: viewport, depth: grabDepth)
                    if length(world) > 0 { sculptCentres.append(hit.position) }
                    grabDelta += world * sample.force
                } else if tool.isPaint {
                    paintSteps.append((hit.position, hit.triangle))
                } else {
                    // Advanced by POINTER travel, not by how far the surface
                    // moved: Inflate pushes the surface out from under itself,
                    // and a stroke that measured that would partly be measuring
                    // its own output.
                    let travelled = length(Vec2(point.x - (lastScreenPoint?.x ?? point.x),
                                                point.y - (lastScreenPoint?.y ?? point.y)))
                        * camera.metresPerPixel(depth: hit.distance, viewportHeight: viewport.y)
                    sculptStroke?.settings = settings()
                    sculptCentres.append(contentsOf:
                        sculptStroke?.advance(to: hit.position, by: travelled) ?? [])
                }

            case .ended, .cancelled:
                // Flush whatever this frame collected before closing, or the
                // last few millimetres of every stroke are dropped.
                change.formUnion(commit(sculpt: &sculptCentres, paint: &paintSteps))
                endStroke()
            }
        }

        change.formUnion(commit(sculpt: &sculptCentres, paint: &paintSteps))
        return change
    }

    private var grabDelta: Vec3 = .zero

    private func commit(sculpt centres: inout [Vec3],
                        paint steps: inout [(point: Vec3, seed: Int)]) -> Change {
        var change = Change()
        lastDabs = centres.count + steps.count
        if !centres.isEmpty {
            let brush: Sculpt.Brush
            switch tool {
            case .grab: brush = .grab(grabDelta)
            case .inflate: brush = .inflate(Sculpt.inflatePerDab * strokeRadius)
            case .deflate: brush = .inflate(-Sculpt.inflatePerDab * strokeRadius)
            case .smooth: brush = .smooth
            // Paint never queues sculpt centres; this keeps the switch total.
            case .paint, .erase: brush = .smooth
            }
            if tool == .grab {
                // Grab's whole frame is one displacement applied at the last
                // place the tip was, rather than one dab per sample: the deltas
                // sum to the same travel and the mesh is touched once.
                document.sculpt(brush, at: [centres[centres.count - 1]], settings: settings())
            } else {
                document.sculpt(brush, at: centres, settings: settings())
            }
            change.insert(.mesh)
            centres.removeAll(keepingCapacity: true)
            grabDelta = .zero
        }
        if !steps.isEmpty {
            for step in steps {
                paintDirty = paintDirty.union(document.paint(to: step.point, seed: step.seed))
            }
            change.insert(.texture)
            steps.removeAll(keepingCapacity: true)
        }
        return change
    }

    private func beginStroke() {
        guard !strokeOpen else { return }
        strokeOpen = true
        paintDirty = .empty
        grabDelta = .zero
        document.beginStroke()
    }

    private func endStroke() {
        guard strokeOpen else { return }
        strokeOpen = false
        document.endPaintStroke()
        document.endStroke()
        sculptStroke = nil
        lastScreenPoint = nil
        stabiliserAnchor = nil
        onActivity?(false)
    }

    /// The rope: the brush is dragged behind the tip and only moves when the
    /// rope pulls taut, so tremor inside the rope length is absorbed with no lag
    /// on deliberate motion. ZBrush calls it Lazy Mouse, Krita a stabiliser,
    /// Nomad a Lazy Rope.
    private func stabilised(_ point: Vec2) -> Vec2 {
        guard stabilise, let anchor = stabiliserAnchor else {
            stabiliserAnchor = point
            return point
        }
        let rope = radiusPoints * 0.6
        let delta = Vec2(point.x - anchor.x, point.y - anchor.y)
        let distance = length(delta)
        guard distance > rope else { return anchor }
        let moved = anchor + delta * ((distance - rope) / distance)
        stabiliserAnchor = moved
        return moved
    }

    // MARK: - Cursor

    private func updateCursor(viewport: Vec2) -> Change {
        // Apple's guidance, and it is right: no hover preview while a stroke is
        // running, or the cursor and the mark fight each other.
        if strokeOpen {
            guard cursor != nil else { return [] }
            cursor = nil
            return .cursor
        }
        if hoverCleared {
            hoverCleared = false
            hoverPending = nil
            guard cursor != nil else { return [] }
            cursor = nil
            return .cursor
        }
        guard let hover = hoverPending else { return [] }
        guard let hit = pick(hover.location, viewport: viewport) else {
            guard cursor != nil else { return [] }
            cursor = nil
            return .cursor
        }
        // Solid near the glass, fading out at the top of the Pencil's roughly
        // 12 mm hover range. `zOffset` arrives normalised, so this is Apple's
        // own curve from the hover sample.
        let fade = 0.35
        let strength = 1 - max(0, min(1, (hover.height - fade) / max(0.001, 1 - fade)))
        cursor = Renderer.Cursor(centre: hit.position,
                                 normal: normalAt(hit),
                                 radius: worldRadius(at: hit.distance, viewport: viewport),
                                 strength: 0.25 + 0.75 * strength,
                                 painting: tool.isPaint)
        return .cursor
    }

    private func normalAt(_ hit: Picking.Hit) -> Vec3 {
        let mesh = document.mesh
        let t = hit.triangle * 3
        let a = mesh.normals[Int(mesh.indices[t])]
        let b = mesh.normals[Int(mesh.indices[t + 1])]
        let c = mesh.normals[Int(mesh.indices[t + 2])]
        return normalize(a * hit.barycentric.x + b * hit.barycentric.y + c * hit.barycentric.z)
    }

    // MARK: - Brush

    private func pick(_ point: Vec2, viewport: Vec2) -> Picking.Hit? {
        camera.pick(document.mesh, at: point, viewport: viewport)
    }

    private func worldRadius(at depth: Double, viewport: Vec2) -> Double {
        guard !lockWorldSize else { return strokeRadius }
        let metres = radiusPoints * camera.metresPerPixel(depth: depth,
                                                          viewportHeight: viewport.y)
        return max(0.0005, metres)
    }

    private func settings() -> Sculpt.Settings {
        .init(radius: strokeRadius, strength: strength * strokeForce, symmetric: symmetric)
    }

    private func paintBrush() -> SurfacePaint.Brush {
        .init(radius: strokeRadius, opacity: min(1, 0.9 * strokeForce),
              colour: colour.rgb8, erasing: tool == .erase)
    }

    /// The rectangle of albedo a paint stroke has dirtied since the last upload.
    /// Taken by the viewport so only that region is re-sent to the GPU.
    func takePaintDirtyRect() -> Paint.Rect {
        let rect = paintDirty
        paintDirty = .empty
        return rect
    }

    // MARK: - Commands

    func undo() { document.undo(); refresh(.all) }
    func redo() { document.redo(); refresh(.all) }

    func fill() {
        document.fill(colour.rgb8)
        paintDirty = Paint.Rect(minX: 0, minY: 0,
                                maxX: document.albedo.width - 1,
                                maxY: document.albedo.height - 1)
        refresh(.texture)
    }

    func export(named name: String) -> Gate.Report {
        let report = document.validate()
        status = report.passes ? "Pre-flight passed" : "Pre-flight found problems"
        return report
    }

    /// Paint or Erase, whichever is not selected. What the Pencil's double tap
    /// does, matching what the same gesture does in every drawing app.
    func togglePaintErase() {
        tool = tool == .erase ? .paint : .erase
    }

    /// Pushes a change to the viewport, and republishes to SwiftUI only when
    /// something SwiftUI actually shows has changed.
    ///
    /// This runs every frame of every stroke. `@Published` republishes on each
    /// assignment whether or not the value differs, and an unconditional
    /// `objectWillChange` rebuilt the entire toolbar at up to 120 Hz to display
    /// two booleans that change twice per gesture. The mesh, the camera and the
    /// cursor never go through SwiftUI at all — they are handed straight to the
    /// renderer through `onChange`.
    private func refresh(_ change: Change) {
        let undoable = document.canUndo, redoable = document.canRedo
        if undoable != canUndo { canUndo = undoable }
        if redoable != canRedo { canRedo = redoable }
        if !change.isEmpty { onChange?(change) }
    }
}

extension Color {
    /// SwiftUI colours are float and possibly in a wide gamut; the texture is
    /// 8-bit sRGB. Clamping here rather than at the blend keeps the conversion
    /// in one place.
    var rgb8: (r: UInt8, g: UInt8, b: UInt8) {
        let components = UIColor(self).cgColor.components ?? [0, 0, 0, 1]
        func byte(_ index: Int) -> UInt8 {
            guard index < components.count else { return 0 }
            return UInt8(max(0, min(255, (components[index] * 255).rounded())))
        }
        return components.count >= 3 ? (byte(0), byte(1), byte(2))
                                     : (byte(0), byte(0), byte(0))
    }
}
