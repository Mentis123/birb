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

/// The editor's state: a document, a camera, the brush the person chose, and
/// the queue between the Pencil and the frame.
///
/// **What a stroke DOES is not decided here any more.** It lives in
/// `HumanoidCore.StrokeEngine`, where the Linux suite drives it with synthetic
/// Pencil samples. Every stroke defect the device runs found was in the code
/// that used to sit in this file, where nothing could test it: paint read the
/// Pencil's pressure once, at touch-down, when it is lightest; Grab converted
/// the drag at the wrong depth and scaled it by that same touch-down pressure;
/// a stroke that left the model joined its ends through the air. This class
/// now queues samples, hands a frame's worth to the engine, and pushes what
/// changed to the renderer.
///
/// Three rules run through it.
///
/// **A stroke is one gesture.** Touch down to touch up is one undo step.
///
/// **Input is paid for once a frame, not once an event.** A Pencil reports up to
/// 240 times a second and the display refreshes 120 times; samples are queued
/// as they arrive and drained in `drainInput`, which the renderer calls at the
/// top of each frame.
///
/// **Queuing a sample must ask for a frame.** The queue is not the loop; it
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

    typealias Tool = EditTool

    /// Deliberately NOT `@Published`, either of them: they change every frame
    /// of every stroke and orbit, and publishing them rebuilt the whole SwiftUI
    /// toolbar at up to 120 Hz to display two booleans. The renderer is fed
    /// through `onChange` instead.
    ///
    /// Fully qualified: SwiftUI and UIKit each have a `Document` of their own.
    private(set) var document: HumanoidCore.Document
    var camera = Camera()

    @Published var tool: Tool = .grab {
        didSet { if oldValue != tool { previousTool = oldValue } }
    }
    /// The tool before this one, for the Pencil's "switch to previous" tap.
    private(set) var previousTool: Tool = .inflate
    /// Brush radius in **screen points** at full pressure, converted to metres
    /// at the depth the brush lands on. ZBrush's Draw Size and Nomad's
    /// "Screen" mode both work this way.
    @Published var radiusPoints: Double = 80 { didSet { save(radiusPoints, "radiusPoints") } }
    /// Drawable pixels per screen point, read from the view each frame.
    var pointScale: Double = 1
    /// Full by default: the slider exists to go GENTLER.
    @Published var strength: Double = 1.0 { didSet { save(strength, "strength") } }
    @Published var symmetric = true { didSet { save(symmetric, "symmetric") } }
    /// Forces finger sculpting on. Until a Pencil has been seen, a finger that
    /// lands ON the model sculpts and one that lands off it orbits — Nomad's
    /// rule — so this is only needed to sculpt with a finger once a Pencil is
    /// around.
    @Published var fingerEditing = false
    /// The rope stabiliser, off by default: it changes the feel of every
    /// stroke, so it should be asked for.
    @Published var stabilise = false { didSet { save(stabilise, "stabilise") } }
    @Published var colour = Color(red: 0.16, green: 0.35, blue: 0.63)
    /// Paint only: how much of the brush paints solid before the soft edge.
    @Published var hardness: Double = 0.5 { didSet { save(hardness, "hardness") } }

    // MARK: Pressure

    /// Pencil pressure changes the brush size, down to `minimumSize` of it.
    @Published var pressureSize = true { didSet { save(pressureSize, "pressureSize") } }
    @Published var minimumSize: Double = 0.2 { didSet { save(minimumSize, "minimumSize") } }
    /// Pencil pressure changes strength and opacity, down to `minimumStrength`.
    @Published var pressureStrength = true { didSet { save(pressureStrength, "pressureStrength") } }
    @Published var minimumStrength: Double = 0.2 { didSet { save(minimumStrength, "minimumStrength") } }
    @Published var pressureCurve: PressureResponse.Curve = .soft {
        didSet { save(pressureCurve.rawValue, "pressureCurve") }
    }
    /// Pins the brush to its current size ON THE MODEL instead of on the
    /// screen. Captured when it is switched on.
    @Published var lockWorldSize = false {
        didSet {
            fixedWorldRadius = lockWorldSize ? currentWorldRadius() : nil
        }
    }
    private var fixedWorldRadius: Double?

    // MARK: Latency

    /// Drive the viewport from a `UIUpdateLink` with low-latency Pencil
    /// dispatch and immediate presentation (iPadOS 18). The viewport reads
    /// this once when it is built and switches when it changes.
    @Published var lowLatency = true { didSet { save(lowLatency, "lowLatency") } }
    /// Which loop is actually drawing, for the readout: the low-latency one
    /// can fall back on its own if it ever stops producing frames.
    @Published var loopDescription = "MTKView display link"

    @Published private(set) var canUndo = false
    @Published private(set) var canRedo = false
    @Published var showStats = false
    /// The debug readout, refreshed a few times a second while it is shown.
    @Published private(set) var hud = ""
    @Published var status: String?
    /// One line under the tool rail saying who does what: "none of the pencil
    /// actions seems to work" and "I was using a finger, and fingers move the
    /// camera" look identical on the glass.
    @Published private(set) var inputHint = "Pencil sculpts · one finger on the model sculpts, off it orbits"

    /// True once any Pencil touch or hover has arrived. From then on fingers
    /// navigate only, because the alternative is that every orbit is also a
    /// stroke.
    private(set) var pencilSeen = false

    /// Set by the viewport so a change can be pushed straight to the renderer
    /// without SwiftUI diffing a mesh.
    var onChange: ((Change) -> Void)?
    /// Asks the viewport to run continuously — during a stroke, a hover and a
    /// coast — or to go back to drawing on demand.
    var onActivity: ((Bool) -> Void)?
    /// Asks the viewport for one frame. Cheap and coalesced.
    var requestDraw: (() -> Void)?

    // MARK: - The stroke

    private var engine = StrokeEngine()
    private(set) var cursor: Renderer.Cursor?

    // MARK: - Input queue

    private var pending: [StrokeSample] = []
    /// The other half of a double buffer. Draining swaps the two, so neither
    /// the drain nor the next frame's appends allocate.
    private var draining: [StrokeSample] = []
    private var hoverPending: (location: Vec2, height: Double)?
    private var hoverCleared = false
    /// Where UIKit predicts the Pencil will be a frame from now. Drawn as the
    /// ring during a stroke — never applied to the document, which is Apple's
    /// rule for predicted touches: they are for what the person sees.
    private var predicted: Vec2?
    /// The newest input the frame being drawn consumed, on the display's clock,
    /// for the touch-to-glass readout. Taken by the renderer.
    private(set) var inputTimestampThisFrame: CFTimeInterval = 0

    /// Queues a sample. Called from the touch handlers, possibly several times
    /// per frame; does no work beyond appending and asking for a frame.
    func enqueue(_ sample: StrokeSample) {
        if sample.isPencil { notePencil() }
        lastSampleTime = CACurrentMediaTime()
        pending.append(sample)
        if sample.phase == .began { onActivity?(true) }
        if sample.phase == .ended || sample.phase == .cancelled { predicted = nil }
        requestDraw?()
    }

    /// Where the Pencil is predicted to be next frame. The cursor only.
    func predict(_ location: Vec2) {
        predicted = location
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

    /// Whether a Pencil stroke or hover is in progress: what the low-latency
    /// loop waits for before it draws.
    var pencilActive: Bool { (engine.isOpen && pencilStroke) || hoverPending != nil }
    private var pencilStroke = false

    // MARK: - Frame bookkeeping

    private var hudClock: CFTimeInterval = 0
    private var frameSamples: [Double] = []
    private var latencies: [Double] = []
    private var lastDrainDepth = 0
    private var worstDrainDepth = 0
    private var framesThisStroke = 0
    private var framesLastStroke = 0
    /// Orbit velocity left over from a flick, in normalised screen units per
    /// second.
    private var spin: Vec2 = .zero
    private var lastFrame: CFTimeInterval = 0
    /// Whether the last frame had a stroke, a coast or a hover in progress, so
    /// the idle notification fires once at the edge rather than every frame.
    private var wasActive = false
    /// When the open stroke last heard from the pointer — the backstop for an
    /// end that never arrives. Five seconds: UIKit sends nothing for a Pencil
    /// that is not moving, so a short timeout would cut a stroke in half
    /// whenever somebody paused to think.
    private var lastSampleTime: CFTimeInterval = 0
    private static let strokeTimeout: CFTimeInterval = 5
    /// When the last hover event arrived. A hover whose end never comes would
    /// otherwise hold the viewport in continuous mode for the session.
    private var lastHoverTime: CFTimeInterval = 0
    /// How many hover events have ever arrived. Pencil hover needs an M2 or
    /// later iPad Pro or Air, or the A17 Pro mini, with a Pencil 2 or Pro; on
    /// anything else the recogniser never fires, which looks like a bug.
    private(set) var hoverEvents = 0
    private static let hoverTimeout: CFTimeInterval = 0.6
    private var statusUntil: CFTimeInterval = 0

    /// Puts a line on screen for a couple of seconds.
    func say(_ message: String) {
        status = message
        statusUntil = CACurrentMediaTime() + 2.5
    }

    init(document: HumanoidCore.Document) {
        self.document = document
        camera.frame(document.mesh)
        pending.reserveCapacity(64)
        draining.reserveCapacity(64)
        frameSamples.reserveCapacity(128)
        latencies.reserveCapacity(128)
        loadSettings()
        NSLog("[BabyBlender] document ready: %d vertices", document.mesh.vertexCount)
    }

    convenience init() {
        // A failure here means the app shipped without its template, which is a
        // build mistake, not a runtime condition to recover from.
        self.init(document: try! HumanoidCore.Document.clay())
    }

    /// Builds the paint map off the main thread and hands it back. It depends
    /// only on the template and the texture size, both immutable, so a copy of
    /// the template is enough.
    func prepareForPaintingSoon() {
        guard !paintingPrepared, !document.isPreparedForPainting else { return }
        paintingPrepared = true
        let template = document.template
        let size = document.paintMapSize
        Task.detached(priority: .userInitiated) {
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
    /// moving the eye.
    func setPivot(at point: Vec2, viewport: Vec2) {
        guard viewport.x > 0, viewport.y > 0 else { return }
        guard let hit = camera.pick(document.mesh, at: point, viewport: viewport) else { return }
        camera.setPivot(to: hit.position)
        cameraMoved()
    }

    /// Puts the camera back where a gesture found it. For a palm: it lands a
    /// moment before the Pencil, and the orbit it starts is undone when the
    /// Pencil arrives, so drawing with a hand on the glass does not spin the
    /// model out from under the tip.
    func restoreCamera(_ saved: Camera) {
        camera = saved
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
        requestDraw?()
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
        requestDraw?()
    }

    /// Whether a finger landing here should sculpt rather than move the camera.
    ///
    /// Nomad's rule: before a Pencil has been seen, a finger on the model works
    /// and a finger off it orbits. Once a Pencil has been seen the Pencil owns
    /// editing and fingers navigate.
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
        inputTimestampThisFrame = 0
        engine.resetFrameCounters()
        if engine.isOpen { framesThisStroke += 1 }

        var change = Change()
        if applyCoast(elapsed) { change.insert(.camera) }
        change.formUnion(applySamples(viewport: viewport))
        if hoverPending != nil, now - lastHoverTime > EditorModel.hoverTimeout {
            clearHover()
        }
        if let current = status, !current.isEmpty, now > statusUntil {
            status = nil
        }
        if engine.isOpen, lastSampleTime > 0, now - lastSampleTime > EditorModel.strokeTimeout {
            NSLog("[BabyBlender] stroke had no samples for %.1f s; closing it",
                  now - lastSampleTime)
            change.formUnion(translate(engine.close(&document)))
            strokeFinished()
        }
        change.formUnion(updateCursor(viewport: viewport))

        if !change.isEmpty { refresh(change) }
        // Reported only on the TRANSITION to idle: the viewport answers idle
        // with a final frame, so reporting it every idle frame made each frame
        // request the next.
        let idle = !engine.isOpen && HumanoidCore.length(spin) < 1e-4 && hoverPending == nil
        if idle && wasActive { onActivity?(false) }
        wasActive = !idle
    }

    /// Exponential decay, the same shape `UIScrollView` uses for a flick.
    private func applyCoast(_ elapsed: Double) -> Bool {
        guard HumanoidCore.length(spin) > 1e-4 else { return false }
        camera.orbit(dx: spin.x * elapsed, dy: spin.y * elapsed)
        spin *= pow(0.998, elapsed * 1000)
        if HumanoidCore.length(spin) < 1e-4 { spin = .zero }
        return true
    }

    private func applySamples(viewport: Vec2) -> Change {
        guard !pending.isEmpty else { return [] }
        birbSignpostBegin("samples")
        defer { birbSignpostEnd("samples") }

        swap(&pending, &draining)
        defer { draining.removeAll(keepingCapacity: true) }
        if let newest = draining.last { inputTimestampThisFrame = newest.timestamp }
        if let first = draining.first, first.phase == .began { pencilStroke = first.isPencil }

        let wasOpen = engine.isOpen
        let effect = engine.apply(draining, to: &document, camera: camera, viewport: viewport,
                                  options: brushOptions())
        if effect.contains(.paintNotReady) {
            prepareForPaintingSoon()
            say("Paint is still warming up")
        }
        if wasOpen || draining.contains(where: { $0.phase == .began }), !engine.isOpen {
            strokeFinished()
        }
        return translate(effect)
    }

    private func translate(_ effect: StrokeEngine.Effect) -> Change {
        var change = Change()
        if effect.contains(.mesh) { change.insert(.mesh) }
        if effect.contains(.texture) { change.insert(.texture) }
        if effect.contains(.contact) { change.insert(.cursor) }
        return change
    }

    private func strokeFinished() {
        framesLastStroke = framesThisStroke
        framesThisStroke = 0
        predicted = nil
        pencilStroke = false
    }

    /// What the brush is, right now, in the engine's terms.
    private func brushOptions() -> BrushOptions {
        BrushOptions(tool: tool, radiusPoints: radiusPoints, pointScale: pointScale,
                     fixedWorldRadius: fixedWorldRadius, strength: strength,
                     symmetric: symmetric, stabilise: stabilise, colour: colour.rgb8,
                     hardness: hardness, pressure: pressureResponse)
    }

    var pressureResponse: PressureResponse {
        PressureResponse(fullForce: 0.5, curve: pressureCurve,
                         sizeFollowsPressure: pressureSize, minimumSize: minimumSize,
                         strengthFollowsPressure: pressureStrength,
                         minimumStrength: minimumStrength)
    }

    /// The brush's size in metres where it would land at the middle of the
    /// screen, for "lock size on the model".
    private func currentWorldRadius() -> Double {
        let depth = camera.viewDepth(of: camera.lookAt)
        return max(0.0005, radiusPoints * pointScale
                   * camera.metresPerPixel(depth: depth, viewportHeight: max(1, viewportHeight)))
    }
    /// The drawable's height, remembered from the last frame.
    private var viewportHeight: Double = 1

    // MARK: - Readout

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
        let latency: String
        if latencies.isEmpty {
            latency = "touch→glass: draw with the Pencil to measure"
        } else {
            let sorted = latencies.sorted()
            let median = sorted[sorted.count / 2]
            let p90 = sorted[min(sorted.count - 1, sorted.count * 9 / 10)]
            latency = String(format: "touch→glass %.1f ms (p90 %.1f, n %d)", median, p90, sorted.count)
        }
        let last = engine.last
        hud = String(format: "%.1f fps  cpu+gpu %.2f ms (worst %.2f)", mean > 0 ? 1000 / mean : 0,
                     mean, worst)
            + String(format: "\ngpu %.2f ms  draws %d  tris %d",
                     stats.gpuMilliseconds, stats.drawCalls, stats.triangles)
            + "\n" + latency + "  · " + loopDescription
            + String(format: "\nbrush %.0f pt  pressure %.2f  steps/frame %d  picks %d",
                     radiusPoints, engine.pressure, engine.stepsThisFrame, engine.picksThisFrame)
            // The counter that proves the loop is alive: single digits during a
            // stroke. Hundreds means samples are queuing with nothing draining
            // them, which is what the second device run was.
            + String(format: "\nqueue %d (worst %d)  scale %.0fx  hover %@",
                     lastDrainDepth, worstDrainDepth, pointScale,
                     hoverEvents > 0 ? "\(hoverEvents)" : "never (iPad may not have it)")
            + "\nlast: \(last.tool.rawValue) \(framesLastStroke)f  samples \(last.samples)"
            + "  steps \(last.dabs)  texels \(last.texels)  skipped \(last.skipped)"
            + "  lifted \(last.lifted)  armed \(last.armed ? "yes" : "no")"
            + String(format: "  peak %.2f", last.peakPressure)
            + "\ntool \(tool.rawValue)\(tool == .erase ? " (paints base colour)" : "")"
    }

    /// One touch-to-glass measurement: from the newest sample a frame consumed
    /// to the moment that frame was on the display, both on the host clock.
    /// This is the number "the lowest latency from brush to what you see" is
    /// about, measured rather than argued.
    func noteLatency(_ seconds: Double) {
        guard seconds > 0, seconds < 0.5 else { return }
        latencies.append(seconds * 1000)
        if latencies.count > 120 { latencies.removeFirst() }
    }

    /// Whether the renderer should measure touch-to-glass this frame. Only while
    /// the readout is up: it costs a closure per frame.
    var measuresLatency: Bool { showStats }

    // MARK: - Cursor

    private func updateCursor(viewport: Vec2) -> Change {
        viewportHeight = viewport.y
        let options = brushOptions()
        // Kept visible DURING the stroke. Apple's hover guidance says to hide a
        // preview once the pen is down, which is right for a drawing app where
        // the mark is the feedback; on a sculpting tool the ring is the only
        // honest answer to "how big is my brush", and at the PREDICTED tip it
        // also hides a frame of latency.
        if engine.isOpen {
            var contact = engine.contact
            if let predicted, engine.isArmed, engine.tool != .grab,
               let ahead = engine.contact(at: predicted, document: document, camera: camera,
                                          viewport: viewport, options: options) {
                contact = ahead
            }
            guard let contact else { return setCursor(nil) }
            return setCursor(.init(centre: contact.position, normal: contact.normal,
                                   radius: contact.radius, innerRadius: nil,
                                   strength: 0.55, painting: engine.tool.isPaint))
        }
        if hoverCleared {
            hoverCleared = false
            hoverPending = nil
            return setCursor(nil)
        }
        // No hover and no stroke: no ring. Without this the last stroke's ring
        // stayed on the model after the Pencil lifted, on every iPad that has
        // no hover to replace it.
        guard let hover = hoverPending,
              let contact = engine.contact(at: hover.location, document: document, camera: camera,
                                           viewport: viewport, options: options)
        else { return setCursor(nil) }
        // Solid near the glass, fading out at the top of the Pencil's roughly
        // 12 mm hover range — Apple's own curve from the hover sample.
        let fade = 0.35
        let near = 1 - max(0, min(1, (hover.height - fade) / max(0.001, 1 - fade)))
        // The outer ring is the full-pressure size; the inner one, the size a
        // feather touch makes. Together they show the range the Pencil has.
        let range = contact.lightestRadius < contact.fullRadius * 0.98
        return setCursor(.init(centre: contact.position, normal: contact.normal,
                               radius: contact.fullRadius,
                               innerRadius: range ? contact.lightestRadius : nil,
                               strength: 0.25 + 0.75 * near, painting: tool.isPaint))
    }

    private func setCursor(_ next: Renderer.Cursor?) -> Change {
        if next == nil && cursor == nil { return [] }
        cursor = next
        return .cursor
    }

    /// What of the albedo the GPU needs again.
    enum TextureUpload { case nothing, region(Paint.Rect), whole }

    /// Taken by the viewport when a change says the texture moved.
    ///
    /// `.nothing` is a real answer, not an error. A paint step that touched no
    /// texels — a Pencil resting on a spot it has already painted, which is
    /// idempotent — still reports a texture change, and the old path read the
    /// empty rectangle as "upload everything": four megabytes, every frame,
    /// for as long as the tip rested.
    func takeTextureUpload() -> TextureUpload {
        let rect = engine.takePaintDirty()
        if pendingWholeTexture {
            pendingWholeTexture = false
            return .whole
        }
        return rect.isEmpty ? .nothing : .region(rect)
    }
    private var pendingWholeTexture = false

    // MARK: - Commands

    func undo() { document.undo(); pendingWholeTexture = true; refresh(.all); requestDraw?() }
    func redo() { document.redo(); pendingWholeTexture = true; refresh(.all); requestDraw?() }

    func fill() {
        document.fill(colour.rgb8)
        pendingWholeTexture = true
        refresh(.texture)
        requestDraw?()
    }

    func export(named name: String) -> Gate.Report {
        let report = document.validate()
        say(report.passes ? "Pre-flight passed" : "Pre-flight found problems")
        return report
    }

    /// The Pencil's double tap (or a Pencil Pro squeeze), honouring what the
    /// person set in Settings → Apple Pencil.
    ///
    /// It used to be Paint ↔ Erase unconditionally, and from any sculpting
    /// tool that landed on Erase — which paints the base colour back and is
    /// therefore completely invisible on a model nobody has painted yet. One
    /// stray double tap while picking the Pencil up produced "paint does
    /// nothing". Every branch now says where it went.
    func pencilTapped(preference: PencilTapPreference) {
        switch preference {
        case .ignore:
            return
        case .previousTool:
            let target = previousTool
            tool = target
            say(target.rawValue)
        case .eraser:
            togglePaintErase()
        }
    }

    enum PencilTapPreference { case ignore, previousTool, eraser }

    /// From a sculpting tool, Paint; from Paint, Erase; from Erase, Paint.
    func togglePaintErase() {
        switch tool {
        case .paint: tool = .erase
        default: tool = .paint
        }
        say(tool == .erase ? "Erase — paints the base colour back" : "Paint")
    }

    /// Pushes a change to the viewport, and republishes to SwiftUI only when
    /// something SwiftUI actually shows has changed.
    private func refresh(_ change: Change) {
        let undoable = document.canUndo, redoable = document.canRedo
        if undoable != canUndo { canUndo = undoable }
        if redoable != canRedo { canRedo = redoable }
        if !change.isEmpty { onChange?(change) }
    }

    // MARK: - Settings

    /// The brush and Pencil settings survive a relaunch; tuning pressure on
    /// the glass and losing it on the next launch is how nobody tunes it.
    private static let defaultsPrefix = "BabyBlender."
    private var loadingSettings = false

    private func save(_ value: Any, _ key: String) {
        guard !loadingSettings else { return }
        UserDefaults.standard.set(value, forKey: EditorModel.defaultsPrefix + key)
    }

    private func loadSettings() {
        loadingSettings = true
        defer { loadingSettings = false }
        let d = UserDefaults.standard
        func double(_ key: String) -> Double? { d.object(forKey: EditorModel.defaultsPrefix + key) as? Double }
        func bool(_ key: String) -> Bool? { d.object(forKey: EditorModel.defaultsPrefix + key) as? Bool }
        if let v = double("radiusPoints") { radiusPoints = min(140, max(8, v)) }
        if let v = double("strength") { strength = min(1, max(0.05, v)) }
        if let v = bool("symmetric") { symmetric = v }
        if let v = bool("stabilise") { stabilise = v }
        if let v = double("hardness") { hardness = min(0.9, max(0, v)) }
        if let v = bool("pressureSize") { pressureSize = v }
        if let v = double("minimumSize") { minimumSize = min(1, max(0.05, v)) }
        if let v = bool("pressureStrength") { pressureStrength = v }
        if let v = double("minimumStrength") { minimumStrength = min(1, max(0.05, v)) }
        if let raw = d.string(forKey: EditorModel.defaultsPrefix + "pressureCurve"),
           let curve = PressureResponse.Curve(rawValue: raw) { pressureCurve = curve }
        if let v = bool("lowLatency") { lowLatency = v }
    }
}

extension EditTool {
    /// SF Symbol for the tool rail.
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
