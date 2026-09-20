import Foundation
import SwiftUI
import UIKit
import QuartzCore
import os.signpost
import HumanoidCore

/// Points-of-interest signposts, so Instruments can say where a frame went.
///
/// The Hang instrument is what reported "Hang detected: 4.46s" on the device
/// and it cannot say what the main thread was doing. These intervals land in
/// the same timeline beside it. Shared with the renderer.
let birbSignpostLog = OSLog(subsystem: "com.mentis.birb.BabyBlender",
                            category: .pointsOfInterest)

@inline(__always)
func birbSignpostBegin(_ name: StaticString) {
    guard birbSignpostLog.signpostsEnabled else { return }
    os_signpost(.begin, log: birbSignpostLog, name: name)
}

@inline(__always)
func birbSignpostEnd(_ name: StaticString) {
    guard birbSignpostLog.signpostsEnabled else { return }
    os_signpost(.end, log: birbSignpostLog, name: name)
}

/// The editor's state: a document, a camera, a tool, and the stroke in progress.
///
/// This is the only place in the app that decides anything. Three rules run
/// through all of it.
///
/// **A stroke is one gesture.** Touch down to touch up is one undo step, because
/// that is what a person means by "the last thing I did".
///
/// **Input is paid for once a frame, not once an event.** A Pencil reports up to
/// 240 times a second and the display refreshes 120 times; the samples are
/// queued as they arrive and drained in `drainInput`, which the renderer calls
/// at the top of each frame.
///
/// **Queuing a sample must ask for a frame.** Added after the second device
/// run, where it was the whole bug: the queue was filled and nothing ever
/// requested the draw that empties it, so a Pencil stroke sat in `pending`
/// until an unrelated finger moved the camera. The queue is not the loop; it
/// has to poke it.
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

    /// One Pencil or finger sample, as delivered. Queued rather than acted on.
    struct Sample {
        enum Phase { case began, moved, ended, cancelled }
        var phase: Phase
        /// In drawable pixels, top-left origin.
        var location: Vec2
        /// 0...1, floored so a Pencil held upright still marks.
        var force: Double
        /// True for a real Pencil. The editor uses it to stop offering finger
        /// sculpting once a Pencil has been seen.
        var isPencil: Bool
    }

    /// Deliberately NOT `@Published`, either of them.
    ///
    /// `@Published` republishes on every assignment whether or not anything
    /// reads the value, and a struct property republishes when it is mutated.
    /// `camera` is mutated on every frame of every orbit and `document` on
    /// every frame of every stroke, so between them they rebuilt the whole
    /// SwiftUI toolbar at up to 120 Hz to display two booleans. Neither is read
    /// by anything that needs to track them live: the mesh, the texture, the
    /// camera and the cursor go straight to the renderer through `onChange`,
    /// and the export sheet reads the document once when it opens.
    ///
    /// Fully qualified, and it has to be. A bare `Document` is ambiguous once
    /// SwiftUI and UIKit are both imported — the SDK has its own type of that
    /// name, and the compiler will not guess. It builds fine headless, where
    /// neither framework exists, which is exactly the class of error the Linux
    /// tests cannot reach.
    private(set) var document: HumanoidCore.Document
    var camera = Camera()

    @Published var tool: Tool = .grab
    /// Brush radius in **screen points**, converted to metres at the hit depth.
    ///
    /// ZBrush's Draw Size and Nomad's "Screen" mode both work this way and it is
    /// the better default: a brush fixed in world units is the right size at
    /// exactly one zoom, so zooming in to work on a detail makes the brush
    /// swallow it. Fixed on screen, zooming in buys finer detail for nothing.
    ///
    /// 80 rather than 46 after the third device run. At 46 on this iPad the
    /// brush is about 16 mm across a 240 mm model — 7% — and a brush you have
    /// to notice is a brush that reads as doing nothing. Inflate's push also
    /// scales with the radius, so the default size and the default strength
    /// were multiplying each other's weakness.
    @Published var radiusPoints: Double = 80
    /// Drawable pixels per screen point, read from the view each frame.
    ///
    /// Everything else in this file is in DRAWABLE PIXELS, because that is what
    /// a touch location and the picking viewport are in. `radiusPoints` is the
    /// one quantity in points, and without this conversion it was silently
    /// delivering a brush half the size the slider claimed on every 2x iPad —
    /// which is also half the Inflate displacement, since the amount scales
    /// with the radius.
    var pointScale: Double = 1
    /// Pins the brush to its current world size instead, for anyone who wants
    /// the other behaviour.
    @Published var lockWorldSize = false
    /// Full by default.
    ///
    /// At 0.5 a Grab moves the surface half as far as the finger, which is the
    /// one thing Grab must not do, and every other brush was halved on top of
    /// constants that were already too small. The slider is there to go
    /// GENTLER; there is no reason for the middle of it to be the default.
    @Published var strength: Double = 1.0
    @Published var symmetric = true
    /// Forces finger sculpting on. Off by default because it is usually not
    /// needed: until a Pencil has been seen, a finger that lands ON the model
    /// sculpts and one that lands on the background orbits, which is Nomad's
    /// rule and needs no setting at all.
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
    /// One line under the tool rail saying who does what. It answers the
    /// question the second device run raised — "none of the pencil actions
    /// seems to work" is indistinguishable from "I was using a finger, and
    /// fingers move the camera".
    @Published private(set) var inputHint = "Pencil sculpts · one finger on the model sculpts, off it orbits"

    /// True once any Pencil touch or hover has arrived. From then on fingers
    /// navigate only, because the alternative is that every orbit is also a
    /// stroke.
    private(set) var pencilSeen = false

    /// What the frame cost, for the readout.
    private var hudClock: CFTimeInterval = 0
    private var frameSamples: [Double] = []
    private var lastDabs = 0
    private var lastDrainDepth = 0
    private var worstDrainDepth = 0
    private var framesThisStroke = 0
    private var picksThisFrame = 0
    private var skippedPicks = 0
    private var dabsThisStroke = 0
    private var texelsThisStroke = 0
    /// Below this much drawable-pixel travel a sample is folded into the next
    /// one instead of earning its own raycast. Two pixels is one point on a 2x
    /// panel: under the width of the line being drawn.
    private static let pickSlopPixels: Double = 2
    private var strokeSummary = "no stroke yet"

    /// Set by the viewport so a change can be pushed straight to the renderer
    /// without SwiftUI diffing a mesh.
    var onChange: ((Change) -> Void)?
    /// Asks the viewport to run continuously — during a stroke, a hover and a
    /// coast — or to go back to drawing on demand.
    var onActivity: ((Bool) -> Void)?
    /// Asks the viewport for one frame. Cheap and coalesced, so anything that
    /// queues work calls it rather than reasoning about whether a frame is
    /// already coming.
    var requestDraw: (() -> Void)?

    // MARK: - Input queue

    private var pending: [Sample] = []
    private var hoverPending: (location: Vec2, height: Double)?
    private var hoverCleared = false

    /// Queues a sample. Called from the touch handlers, possibly several times
    /// per frame; does no work beyond appending and asking for a frame.
    func enqueue(_ sample: Sample) {
        if sample.isPencil { notePencil() }
        lastSampleTime = CACurrentMediaTime()
        pending.append(sample)
        if sample.phase == .began { onActivity?(true) }
        requestDraw?()
    }

    /// Queues a hover position. The cursor is a preview and never touches the
    /// document, so it is kept apart from the stroke queue entirely.
    func enqueueHover(at location: Vec2, height: Double) {
        notePencil()
        if hoverEvents == 0 {
            NSLog("[BabyBlender] Pencil hover works on this iPad (first event, height %.2f)",
                  height)
        }
        hoverEvents += 1
        lastHoverTime = CACurrentMediaTime()
        hoverPending = (location, height)
        hoverCleared = false
        onActivity?(true)
        requestDraw?()
    }

    func clearHover() {
        hoverPending = nil
        hoverCleared = true
        requestDraw?()
    }

    /// Records that a Pencil exists on this device, which changes what a finger
    /// means.
    func notePencil() {
        guard !pencilSeen else { return }
        pencilSeen = true
        inputHint = "Pencil sculpts · fingers move the camera"
    }

    // MARK: - Stroke state

    private var strokeOpen = false
    /// Whether the stroke has found the surface. A stroke that starts a
    /// millimetre off the model used to be dead for its whole length: the
    /// `.began` sample missed, nothing was set up, and every later sample fell
    /// through the same guard even once it crossed the model.
    private var strokeArmed = false
    private var sculptStroke: Sculpt.Stroke?
    private var lastScreenPoint: Vec2?
    private var grabDepth: Double = 0
    private var grabActive = false
    /// The TOTAL displacement of the open Grab, not a per-frame delta. The
    /// document holds the vertices it captured at the start and places them
    /// absolutely, so this can be re-sent any number of times.
    private var grabTotal: Vec3 = .zero
    private var grabDirty = false
    private var strokeRadius: Double = 0.03
    private var strokeForce: Double = 1
    private var stabiliserAnchor: Vec2?
    private var paintDirty = Paint.Rect.empty
    private var lastHit: (position: Vec3, normal: Vec3, distance: Double)?
    private(set) var cursor: Renderer.Cursor?

    /// Reused across frames. Allocating these per frame is the one thing the
    /// rest of this repo's house rules would not forgive.
    private var sculptCentres: [Vec3] = []
    private var paintSteps: [(point: Vec3, seed: Int)] = []

    /// Orbit velocity left over from a flick, in normalised screen units per
    /// second.
    private var spin: Vec2 = .zero
    private var lastFrame: CFTimeInterval = 0
    /// Whether the last frame had a stroke, a coast or a hover in progress, so
    /// the idle notification fires once at the edge rather than every frame.
    private var wasActive = false
    /// When the open stroke last heard from the pointer. The backstop for the
    /// same wedge `beginStroke` closes: if the end never arrives AND no new
    /// touch ever comes, nothing else would reopen the editor.
    private var lastSampleTime: CFTimeInterval = 0
    /// Deliberately long. UIKit sends no `touchesMoved` for a pointer that is
    /// not moving, so a short timeout would cut a stroke in half every time
    /// somebody paused to think. Five seconds is past any pause and well short
    /// of a session.
    private static let strokeTimeout: CFTimeInterval = 5
    /// When the last hover event arrived. A hover whose end never comes would
    /// otherwise hold the viewport in continuous mode for the session.
    private var lastHoverTime: CFTimeInterval = 0
    /// How many hover events have ever arrived.
    ///
    /// Pencil hover needs an M2-or-later iPad Pro or Air, or the A17 Pro mini,
    /// with a Pencil 2 or Pencil Pro. On anything else
    /// `UIHoverGestureRecognizer` simply never fires and the ring never
    /// appears — which is a device fact and looks exactly like a bug. The
    /// readout says which it is.
    private(set) var hoverEvents = 0
    private static let hoverTimeout: CFTimeInterval = 0.6
    private var statusUntil: CFTimeInterval = 0

    /// Puts a line on screen for a couple of seconds. The editor had a
    /// `status` property and nothing ever displayed it.
    func say(_ message: String) {
        status = message
        statusUntil = CACurrentMediaTime() + 2.5
    }

    init(document: HumanoidCore.Document) {
        self.document = document
        camera.frame(document.mesh)
        sculptCentres.reserveCapacity(64)
        paintSteps.reserveCapacity(64)
        pending.reserveCapacity(64)
        NSLog("[BabyBlender] document ready: %d vertices", document.mesh.vertexCount)
    }

    convenience init() {
        // A failure here means the app shipped without its template, which is a
        // build mistake, not a runtime condition to recover from.
        self.init(document: try! HumanoidCore.Document.clay())
    }

    /// Builds the paint map off the main thread and hands it back.
    ///
    /// Two versions of this were wrong before it. The first built the map in
    /// `init`, in front of the first frame. The second dispatched it to the
    /// MAIN queue "after the first frame" — which moved it later but not off
    /// the thread that draws: 27 ms in release, **763 ms in debug on the build
    /// box and 3,242 ms on the iPad**, and Xcode's Run button builds debug.
    ///
    /// The map depends only on the template and the texture size, both
    /// immutable, so it is built from a copy of the template on a background
    /// task and installed on the main actor when done. `beginPaintStroke`
    /// still builds it on demand if a stroke arrives first; the cost of that
    /// race is a hitch on one stroke, never a bug.
    func prepareForPaintingSoon() {
        guard !paintingPrepared, !document.isPreparedForPainting else { return }
        paintingPrepared = true
        let template = document.template
        let size = document.paintMapSize
        // `Task.detached` rather than a nested `DispatchQueue` pair: the inner
        // hop back used `[weak self]` while the outer closure had already
        // captured self strongly, which is what the compiler was warning about.
        // This shape has one capture, on the main actor, where it belongs.
        Task.detached(priority: .utility) {
            let started = CACurrentMediaTime()
            let map = SurfacePaint.Map(template, width: size.width, height: size.height)
            let ms = (CACurrentMediaTime() - started) * 1000
            await MainActor.run { [weak self] in
                self?.document.installPaintMap(map)
                NSLog("[BabyBlender] paint map ready (%.0f ms, off the main thread)", ms)
            }
        }
    }

    private var paintingPrepared = false

    // MARK: - Camera

    /// One-finger drag, in normalised screen travel.
    func orbit(by delta: Vec2) {
        camera.orbit(dx: delta.x, dy: delta.y)
        cameraMoved()
    }

    /// Two-finger drag, in drawable pixels.
    func pan(by delta: Vec2, viewport: Vec2) {
        camera.pan(pixels: delta, viewportHeight: viewport.y)
        cameraMoved()
    }

    /// Pinch, anchored at the point between the fingers.
    func zoom(by factor: Double, about point: Vec2, viewport: Vec2) {
        camera.zoom(by: factor, about: point, viewport: viewport)
        cameraMoved()
    }

    /// Moves the orbit centre to whatever is under a screen point, without
    /// moving the eye. Nothing happens on screen; the next orbit turns around
    /// the new place instead of around wherever the model used to be.
    func setPivot(at point: Vec2, viewport: Vec2) {
        guard viewport.x > 0, viewport.y > 0 else { return }
        guard let hit = camera.pick(document.mesh, at: point, viewport: viewport) else { return }
        camera.setPivot(to: hit.position)
        cameraMoved()
    }

    /// Double tap: on the model, re-pivot there; off it, frame the whole thing.
    func doubleTap(at point: Vec2, viewport: Vec2) {
        if viewport.x > 0, viewport.y > 0,
           let hit = camera.pick(document.mesh, at: point, viewport: viewport) {
            camera.setPivot(to: hit.position)
            cameraMoved()
        } else {
            frameModel()
        }
    }

    func cameraMoved() {
        spin = .zero
        onChange?(.camera)
    }

    func flick(velocity: Vec2) {
        spin = velocity
        onActivity?(true)
        requestDraw?()
    }

    func frameModel() {
        camera.frame(document.mesh)
        spin = .zero
        onChange?(.camera)
    }

    /// Whether a finger landing here should sculpt rather than move the camera.
    ///
    /// Nomad's rule, and it needs no mode switch: before a Pencil has been
    /// seen, a finger on the model works and a finger off it orbits. Once a
    /// Pencil has been seen the Pencil owns editing and fingers navigate, which
    /// is what stops every orbit also being a stroke.
    func fingerShouldSculpt(at point: Vec2, viewport: Vec2) -> Bool {
        if fingerEditing { return true }
        guard !pencilSeen, viewport.x > 0, viewport.y > 0 else { return false }
        return camera.pick(document.mesh, at: point, viewport: viewport) != nil
    }

    // MARK: - The frame

    /// Drains a frame's worth of input, advances the camera's coast, and updates
    /// the cursor. Called by the renderer before it encodes anything.
    func drainInput(viewport: Vec2) {
        birbSignpostBegin("drain")
        defer { birbSignpostEnd("drain") }

        let now = CACurrentMediaTime()
        let elapsed = lastFrame > 0 ? min(0.1, now - lastFrame) : 1.0 / 120
        lastFrame = now

        lastDrainDepth = pending.count
        worstDrainDepth = max(worstDrainDepth, lastDrainDepth)
        picksThisFrame = 0
        if strokeOpen { framesThisStroke += 1 }

        var change = Change()
        if applyCoast(elapsed) { change.insert(.camera) }
        change.formUnion(applySamples(viewport: viewport))
        if hoverPending != nil, now - lastHoverTime > EditorModel.hoverTimeout {
            clearHover()
        }
        if let current = status, !current.isEmpty, now > statusUntil {
            status = nil
        }
        if strokeOpen, lastSampleTime > 0, now - lastSampleTime > EditorModel.strokeTimeout {
            NSLog("[BabyBlender] stroke had no samples for %.1f s; closing it",
                  now - lastSampleTime)
            endStroke()
            change.insert(.cursor)
        }
        change.formUnion(updateCursor(viewport: viewport))

        if !change.isEmpty { refresh(change) }
        // Hovering counts as activity. Without it the view draws one frame per
        // hover event and pauses in between, so the cursor stutters across the
        // model instead of tracking it.
        //
        // Reported only on the TRANSITION to idle. An earlier version called
        // `onActivity(false)` on every idle frame, and the viewport answers it
        // with `setNeedsDisplay()` — so each frame requested the next and the
        // "paused" view redrew continuously at the panel's full rate.
        let idle = !strokeOpen && HumanoidCore.length(spin) < 1e-4 && hoverPending == nil
        if idle && wasActive { onActivity?(false) }
        wasActive = !idle
    }

    /// Exponential decay, the same shape `UIScrollView` uses for a flick. A
    /// turntable that stops dead the instant the finger lifts is the single
    /// clearest tell that a 3D viewport was not finished.
    private func applyCoast(_ elapsed: Double) -> Bool {
        guard HumanoidCore.length(spin) > 1e-4 else { return false }
        camera.orbit(dx: spin.x * elapsed, dy: spin.y * elapsed)
        spin *= pow(0.998, elapsed * 1000)
        if HumanoidCore.length(spin) < 1e-4 { spin = .zero }
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
            + String(format: "\nbrush %.0f pt = %.1f mm  dabs/frame %d  picks %d",
                     radiusPoints, strokeRadius * 1000, lastDabs, picksThisFrame)
            // The counter that proves the loop is alive. During a stroke this
            // reads single digits — a Pencil at 240 Hz against 120 frames a
            // second. Hundreds means samples are queuing with nothing draining
            // them, which is what the second device run was.
            + String(format: "\nqueue %d (worst %d)  scale %.0fx  hover %@",
                     lastDrainDepth, worstDrainDepth, pointScale,
                     hoverEvents > 0 ? "\(hoverEvents)" : "never (iPad may not have it)")
            + "\n" + strokeSummary
            + "\ntool \(tool.rawValue)\(tool == .erase ? " (paints base colour)" : "")"
    }

    private func applySamples(viewport: Vec2) -> Change {
        guard !pending.isEmpty else { return [] }
        birbSignpostBegin("samples")
        defer { birbSignpostEnd("samples") }

        let samples = pending
        pending.removeAll(keepingCapacity: true)
        var change = Change()

        for sample in samples {
            switch sample.phase {
            case .began:
                beginStroke()
                strokeForce = sample.force
                lastScreenPoint = sample.location
                stabiliserAnchor = sample.location
                arm(at: sample.location, viewport: viewport)

            case .moved:
                strokeForce = sample.force
                let point = stabilised(sample.location)
                guard strokeArmed else {
                    // Not on the model yet. Try again with this sample rather
                    // than writing the whole gesture off.
                    beginStroke()
                    arm(at: point, viewport: viewport)
                    lastScreenPoint = point
                    continue
                }
                // Grab is handled BEFORE the pick, and deliberately. Once the
                // set is captured the gesture owns it: the depth is fixed and
                // nothing is re-picked, so dragging the pointer off the
                // silhouette keeps pulling instead of stalling. Picking here
                // would make a grab that leaves the model stop dead.
                if tool == .grab {
                    // No pressure term: if the finger moved five millimetres
                    // the surface moves five millimetres. Pressure is already
                    // in the weights the capture took at the start.
                    defer { lastScreenPoint = point }
                    guard let last = lastScreenPoint else { continue }
                    let screenDelta = Vec2(point.x - last.x, point.y - last.y)
                    let world = camera.worldDelta(screenDelta: screenDelta,
                                                  viewport: viewport, depth: grabDepth)
                    guard HumanoidCore.length(world) > 0 else { continue }
                    grabTotal += world
                    grabDirty = true
                    // The ring rides with the surface it is dragging.
                    if let previousHit = lastHit {
                        lastHit = (previousHit.position + world, previousHit.normal,
                                   previousHit.distance)
                    }
                    continue
                }

                // A raycast the stroke cannot use is a raycast not worth
                // taking.
                //
                // A Pencil reports up to 240 times a second and dabs are
                // spaced a quarter of the brush radius apart, so at any
                // ordinary drawing speed most coalesced samples move a pixel
                // or two and emit nothing — while each one costs a linear
                // pass over every triangle. Skipping them WITHOUT advancing
                // `lastScreenPoint` keeps the travel: it accumulates to the
                // next sample that is far enough to matter, so the path is
                // unchanged and only the waste goes. At a normal 5 cm/s the
                // Pencil covers about four drawable pixels per sample, so
                // nothing is skipped while the hand is actually moving.
                if let last = lastScreenPoint,
                   HumanoidCore.length(Vec2(point.x - last.x, point.y - last.y))
                       < EditorModel.pickSlopPixels {
                    skippedPicks += 1
                    continue
                }

                defer { lastScreenPoint = point }
                guard let hit = pick(point, viewport: viewport) else { continue }
                strokeRadius = worldRadius(at: hit.distance, viewport: viewport)
                noteHit(hit)

                switch tool {
                case .paint, .erase:
                    paintSteps.append((hit.position, hit.triangle))

                default:
                    // Advanced by POINTER travel, not by how far the surface
                    // moved: Inflate pushes the surface out from under itself,
                    // and a stroke that measured that would partly be measuring
                    // its own output.
                    let previous = lastScreenPoint ?? point
                    let onScreen = Vec2(point.x - previous.x, point.y - previous.y)
                    let travelled = HumanoidCore.length(onScreen)
                        * camera.metresPerPixel(depth: hit.distance,
                                                viewportHeight: viewport.y)
                    sculptStroke?.settings = settings()
                    if let more = sculptStroke?.advance(to: hit.position, by: travelled) {
                        sculptCentres.append(contentsOf: more)
                    }
                }

            case .ended, .cancelled:
                // Flush whatever this frame collected before closing, or the
                // last few millimetres of every stroke are dropped.
                change.formUnion(commit())
                endStroke()
            }
        }

        change.formUnion(commit())
        return change
    }

    /// Finds the surface and sets the stroke up on it. Safe to call again on a
    /// later sample: a stroke that began off the model arms on the first sample
    /// that lands on it.
    private func arm(at point: Vec2, viewport: Vec2) {
        guard !strokeArmed, let hit = pick(point, viewport: viewport) else { return }
        grabDepth = hit.distance
        strokeRadius = worldRadius(at: hit.distance, viewport: viewport)
        noteHit(hit)

        switch tool {
        case .paint, .erase:
            // Never build the paint map from here.
            //
            // `beginPaintStroke` builds it on demand if it is missing, and on
            // the device that measured **2,919 ms** — on the main thread, in
            // the middle of a touch. The background build starts when the
            // viewport comes up, so the only way to reach this is to paint in
            // the first few seconds. Saying so and leaving the stroke unarmed
            // means it starts painting the moment the map lands, mid-gesture,
            // instead of freezing the app and losing the stroke.
            guard document.isPreparedForPainting else {
                prepareForPaintingSoon()
                say("Paint is still warming up")
                return
            }
            document.beginPaintStroke(paintBrush())
            paintSteps.append((hit.position, hit.triangle))
        case .grab:
            grabTotal = .zero
            grabDirty = false
            grabActive = document.beginGrab(at: hit.position, settings: settings())
            guard grabActive else { return }
        default:
            sculptStroke = Sculpt.Stroke(settings: settings())
            sculptCentres.append(contentsOf: sculptStroke!.advance(to: hit.position))
        }
        strokeArmed = true
    }

    private func commit() -> Change {
        var change = Change()
        lastDabs = sculptCentres.count + paintSteps.count + (grabDirty ? 1 : 0)
        dabsThisStroke += lastDabs

        if grabActive, grabDirty {
            birbSignpostBegin("grab")
            document.grab(to: grabTotal)
            birbSignpostEnd("grab")
            grabDirty = false
            change.insert(.mesh)
        }

        if !sculptCentres.isEmpty {
            // Only the three dab brushes ever queue centres. Grab has its own
            // captured path above and paint queues texels, so mapping them here
            // would be inventing behaviour rather than keeping a switch total.
            switch tool {
            case .inflate, .deflate, .smooth:
                // `inflatePerDabDriven`, not `inflatePerDab`: every stroke
                // here advances by POINTER travel, so the feedback loop the
                // smaller constant guards against does not exist on this path.
                let brush: Sculpt.Brush = tool == .smooth
                    ? .smooth
                    : .inflate(Sculpt.inflatePerDabDriven * strokeRadius
                               * (tool == .deflate ? -1 : 1))
                birbSignpostBegin("sculpt")
                document.sculpt(brush, at: sculptCentres, settings: settings())
                birbSignpostEnd("sculpt")
                change.insert(.mesh)
            case .grab, .paint, .erase:
                break
            }
            sculptCentres.removeAll(keepingCapacity: true)
        }

        if !paintSteps.isEmpty {
            birbSignpostBegin("paint")
            for step in paintSteps {
                let touched = document.paint(to: step.point, seed: step.seed)
                if !touched.isEmpty {
                    texelsThisStroke += (touched.maxX - touched.minX + 1)
                        * (touched.maxY - touched.minY + 1)
                }
                paintDirty = paintDirty.union(touched)
            }
            birbSignpostEnd("paint")
            change.insert(.texture)
            paintSteps.removeAll(keepingCapacity: true)
        }
        return change
    }

    private func noteHit(_ hit: Picking.Hit) {
        lastHit = (hit.position, normalAt(hit), hit.distance)
    }

    private func beginStroke() {
        // A new touch-down means the previous gesture is over, whatever became
        // of its end.
        //
        // This used to `guard !strokeOpen else { return }`, and that one line
        // is the best explanation for "the pencil wasn't working, then did".
        // A stroke whose `.ended` never arrived — a touch cancelled while the
        // main thread was blocked, a `UITouch` released out from under a weak
        // reference — left `strokeOpen` true forever, and every later
        // touch-down then returned here without arming, without opening an
        // undo group and without beginning a paint stroke. The Pencil went on
        // reporting and nothing happened, for the rest of the session.
        if strokeOpen { endStroke() }
        strokeOpen = true
        strokeArmed = false
        framesThisStroke = 0
        dabsThisStroke = 0
        texelsThisStroke = 0
        skippedPicks = 0
        paintDirty = .empty
        grabTotal = .zero
        grabDirty = false
        grabActive = false
        document.beginStroke()
    }

    private func endStroke() {
        guard strokeOpen else { return }
        // Read before it is cleared: whether the stroke ever found the model is
        // the single most useful thing the readout can say about it.
        let foundTheModel = strokeArmed
        strokeOpen = false
        strokeArmed = false
        grabActive = false
        grabDirty = false
        grabTotal = .zero
        document.endPaintStroke()
        // Also closes any captured Grab: a gesture's vertex set must not
        // outlive the gesture.
        document.endStroke()
        sculptStroke = nil
        lastScreenPoint = nil
        stabiliserAnchor = nil
        lastHit = nil
        // Everything the next device report needs about the stroke that just
        // finished, on the glass rather than inferred. "armed no" is the
        // stroke that never found the model; "dabs 0" is a brush that ran and
        // did nothing; "texels 0" is paint that did not land.
        strokeSummary = "last: \(framesThisStroke)f  dabs \(dabsThisStroke)"
            + "  texels \(texelsThisStroke)  skipped \(skippedPicks)"
            + "  armed \(foundTheModel ? "yes" : "no")"
        // Idle is decided at the end of `drainInput`, not here: this runs
        // mid-frame and the frame still has to be drawn.
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
        let rope = radiusPoints * pointScale * 0.6
        let delta = Vec2(point.x - anchor.x, point.y - anchor.y)
        let distance = HumanoidCore.length(delta)
        guard distance > rope else { return anchor }
        let moved = anchor + delta * ((distance - rope) / distance)
        stabiliserAnchor = moved
        return moved
    }

    // MARK: - Cursor

    private func updateCursor(viewport: Vec2) -> Change {
        // Kept visible DURING the stroke, faded.
        //
        // Apple's hover guidance says to hide a preview once the pen is down,
        // which is right for a drawing app where the mark is the feedback. On a
        // sculpting tool the ring is the only honest answer to "how big is my
        // brush", and ZBrush and Nomad both keep it up while you work.
        if strokeOpen {
            guard let hit = lastHit else {
                guard cursor != nil else { return [] }
                cursor = nil
                return .cursor
            }
            cursor = Renderer.Cursor(centre: hit.position, normal: hit.normal,
                                     radius: strokeRadius, strength: 0.4,
                                     painting: tool.isPaint)
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
        let blended = a * hit.barycentric.x + b * hit.barycentric.y + c * hit.barycentric.z
        return HumanoidCore.normalize(blended)
    }

    // MARK: - Brush

    private func pick(_ point: Vec2, viewport: Vec2) -> Picking.Hit? {
        guard viewport.x > 0, viewport.y > 0 else { return nil }
        picksThisFrame += 1
        return camera.pick(document.mesh, at: point, viewport: viewport)
    }

    private func worldRadius(at depth: Double, viewport: Vec2) -> Double {
        guard !lockWorldSize else { return strokeRadius }
        let metres = radiusPoints * pointScale
            * camera.metresPerPixel(depth: depth, viewportHeight: viewport.y)
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
        say(report.passes ? "Pre-flight passed" : "Pre-flight found problems")
        return report
    }

    /// What the Pencil's double tap (or a Pencil Pro squeeze) does.
    ///
    /// It used to be `tool = tool == .erase ? .paint : .erase`, which from ANY
    /// sculpting tool jumped straight to Erase — and Erase paints the base
    /// colour back, so on a model nobody has painted yet it is **completely
    /// invisible**. One stray double tap while picking the Pencil up therefore
    /// produced "paint with a colour does nothing" while Fill went on working,
    /// with nothing on screen to say the tool had changed.
    ///
    /// From a sculpting tool it now selects Paint, from Paint it selects
    /// Erase, and from Erase it goes back to Paint. Either way it says so.
    func togglePaintErase() {
        switch tool {
        case .paint: tool = .erase
        default: tool = .paint
        }
        say(tool == .erase
            ? "Erase — paints the base colour back"
            : "Paint")
    }

    /// Pushes a change to the viewport, and republishes to SwiftUI only when
    /// something SwiftUI actually shows has changed.
    ///
    /// This runs every frame of every stroke. `@Published` republishes on each
    /// assignment whether or not the value differs, so an unconditional write
    /// would rebuild the entire toolbar at up to 120 Hz to display two
    /// booleans that change twice per gesture.
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
