import SwiftUI
import MetalKit
import UIKit
import UIKit.UIGestureRecognizerSubclass
import QuartzCore
import HumanoidCore

/// The Metal viewport and its touch handling.
///
/// The rule this file follows is Nomad's, because it is the one that needs no
/// mode switch and no setting: **the Pencil edits, and a finger edits only when
/// it lands on the model and no Pencil has been seen.** A finger on the
/// background always moves the camera, two fingers always pan and pinch.
final class SculptMTKView: MTKView {
    var onSample: ((StrokeSample) -> Void)?
    /// Where UIKit predicts the stroke will be a frame from now. For the ring
    /// only; a predicted sample must never reach the document.
    var onPredicted: ((Vec2) -> Void)?
    /// A Pencil has just touched down. The navigation gesture uses it to let
    /// go of a palm that got there first.
    var onPencilDown: (() -> Void)?
    var onHover: ((Vec2, Double) -> Void)?
    var onHoverEnd: (() -> Void)?
    /// Asked when a finger lands: does the tool want it, or does the camera?
    var fingerSculpts: ((CGPoint) -> Bool)?

    /// The one touch the tool is following. A second finger cannot start a
    /// second stroke, and a touch the tool declined at touch-down is never
    /// reconsidered mid-gesture.
    private weak var editingTouch: UITouch?

    /// Whether the Pencil is on the glass right now. While it is, a finger that
    /// lands is the hand holding it, not a camera gesture.
    var pencilIsDown: Bool {
        guard let touch = editingTouch, touch.type == .pencil else { return false }
        return touch.phase != .ended && touch.phase != .cancelled
    }

    private func accepts(_ touch: UITouch) -> Bool {
        switch touch.type {
        case .pencil: return true
        case .direct: return fingerSculpts?(touch.location(in: self)) ?? false
        default: return false
        }
    }

    /// The Pencil's pressure, raw: `force / maximumPossibleForce`, 0...1.
    ///
    /// Raw on purpose. This used to floor it at 0.35 here, which flattened the
    /// bottom third of the range — a light touch and a medium one did the same
    /// thing. The curve, the floor and the ranges now live in
    /// `PressureResponse`, where they are tested and where the person can set
    /// them. A finger reports no pressure and is nil, which counts as a full
    /// press.
    private func force(_ touch: UITouch) -> Double? {
        guard touch.type == .pencil, touch.maximumPossibleForce > 0 else { return nil }
        return Double(touch.force / touch.maximumPossibleForce)
    }

    private func sample(_ touch: UITouch, phase: StrokeSample.Phase) -> StrokeSample {
        let scale = contentScaleFactor
        let point = touch.location(in: self)
        return StrokeSample(phase: phase,
                            location: Vec2(Double(point.x * scale), Double(point.y * scale)),
                            force: force(touch),
                            isPencil: touch.type == .pencil,
                            timestamp: touch.timestamp)
    }

    /// Replaces the black screen with the reason for it.
    func showFailure(_ message: String) {
        let label = UILabel()
        label.numberOfLines = 0
        label.textColor = .white
        label.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
        label.text = "Baby Blender could not start its viewport.\n\n\(message)"
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)
        NSLayoutConstraint.activate([
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 24),
            label.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -24),
        ])
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        // Let go of a touch we are no longer following: a stale weak reference
        // used to block every later stroke.
        if let current = editingTouch, current.phase == .ended || current.phase == .cancelled {
            editingTouch = nil
        }
        if touches.contains(where: { $0.type == .pencil }) { onPencilDown?() }
        guard editingTouch == nil else { return }
        guard let touch = touches.first(where: { accepts($0) }) else { return }
        editingTouch = touch
        onSample?(sample(touch, phase: .began))
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = editingTouch, touches.contains(touch) else { return }
        // Every sample the Pencil took, not just the one UIKit chose to deliver:
        // a Pencil samples up to 240 times a second against a 120 Hz screen,
        // and the coalesced array has to be read inside the event.
        if let coalesced = event?.coalescedTouches(for: touch), !coalesced.isEmpty {
            for each in coalesced { onSample?(sample(each, phase: .moved)) }
        } else {
            onSample?(sample(touch, phase: .moved))
        }
        // Where the tip will be a frame from now. The ring is drawn there, which
        // hides a frame of latency from the one thing that has to feel attached
        // to the tip; the stroke itself only ever uses real samples.
        if let ahead = event?.predictedTouches(for: touch)?.last {
            let scale = contentScaleFactor
            let point = ahead.location(in: self)
            onPredicted?(Vec2(Double(point.x * scale), Double(point.y * scale)))
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = editingTouch, touches.contains(touch) else { return }
        onSample?(sample(touch, phase: .ended))
        editingTouch = nil
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = editingTouch, touches.contains(touch) else { return }
        onSample?(sample(touch, phase: .cancelled))
        editingTouch = nil
    }
}

/// One recogniser for the whole camera: orbit, pan, pinch and re-pivot.
///
/// A `UIPanGestureRecognizer` capped at one touch does not fail when a second
/// finger lands — it keeps tracking the first — so three recognisers running at
/// once made a two-finger drag an orbit AND a pan AND a pinch. Counting touches
/// in one place also makes the 1 -> 2 -> 1 transitions cheap to get right.
///
/// **It stays out of the Pencil's way.** A hand drawing with a Pencil rests on
/// the glass, and the palm usually lands a moment before the tip. Without
/// this, that palm started an orbit and the model turned under the Pencil
/// mid-stroke — which reads as "grabbing doesn't work". Now a finger that
/// lands while the Pencil is down is ignored, a touch the size of a palm is
/// ignored once a Pencil has been seen, and a one-finger orbit that began
/// just before the Pencil landed is cancelled AND undone.
final class NavigationGesture: UIGestureRecognizer {
    enum Move {
        /// Normalised screen travel.
        case orbit(Vec2)
        /// Drawable pixels.
        case pan(Vec2)
        /// Drawable pixels for the anchor.
        case zoom(factor: Double, about: Vec2)
        /// Drawable pixels. Two fingers landing re-centre the orbit on what is
        /// under them.
        case pivot(Vec2)
    }

    var onMove: ((Move) -> Void)?
    var onFlick: ((Vec2) -> Void)?
    /// Asked once, when the first finger lands. True means the tool is taking
    /// this gesture and the camera must keep out of it.
    var shouldYieldToTool: ((CGPoint) -> Bool)?
    /// Whether a Pencil is on the glass right now.
    var pencilIsDown: (() -> Bool)?
    /// Whether a Pencil has ever been seen; only then is a large contact a palm.
    var pencilSeen: (() -> Bool)?
    /// The first finger of a gesture has landed: the camera as it is now is
    /// what a palm's orbit is undone back to.
    var onFirstTouch: (() -> Void)?
    /// A palm's orbit was cancelled; put the camera back.
    var onRevert: (() -> Void)?

    /// A fingertip reads 7-20 points; a resting palm 30-60. Generous, because
    /// a real two-finger pinch must never be mistaken for a hand.
    private static let palmRadius: CGFloat = 40
    /// How young a one-finger orbit can be and still be a palm that landed
    /// before its Pencil.
    private static let palmWindow: CFTimeInterval = 0.75

    private var tracked: [UITouch] = []
    private var ignored: [UITouch] = []
    private var lastCentroid: CGPoint = .zero
    private var lastSpread: CGFloat = 0
    private var lastTime: CFTimeInterval = 0
    private var firstTouchTime: CFTimeInterval = 0
    private var velocity: CGPoint = .zero
    private var moved = false
    private var yielded = false

    /// Points to drawable pixels. The camera's anchors are compared against the
    /// drawable's own centre, so everything handed over is in its units.
    private var scale: Double { Double(view?.contentScaleFactor ?? 1) }

    override func reset() {
        super.reset()
        tracked.removeAll(keepingCapacity: true)
        ignored.removeAll(keepingCapacity: true)
        velocity = .zero
        moved = false
        yielded = false
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let view else { return }
        let direct = touches.filter { $0.type == .direct }
        guard !direct.isEmpty, !yielded else { return }

        for touch in direct {
            let palm = (pencilSeen?() ?? false) && touch.majorRadius > NavigationGesture.palmRadius
            if pencilIsDown?() == true || palm { ignored.append(touch) }
        }
        let fingers = direct.filter { touch in !ignored.contains(where: { $0 === touch }) }
        guard !fingers.isEmpty else { return }

        if tracked.isEmpty, state == .possible,
           let first = fingers.min(by: { $0.timestamp < $1.timestamp }),
           shouldYieldToTool?(first.location(in: view)) == true {
            // Failing rather than ignoring: the view's own touch handlers keep
            // the whole gesture, and the tap recognisers are unaffected.
            yielded = true
            state = .failed
            return
        }

        if tracked.isEmpty {
            firstTouchTime = CACurrentMediaTime()
            onFirstTouch?()
        }
        let hadTwo = tracked.count >= 2
        for touch in fingers where !tracked.contains(where: { $0 === touch }) { tracked.append(touch) }
        rebase(announcePivot: !hadTwo && tracked.count >= 2)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard !yielded, let view, !tracked.isEmpty else { return }
        // A third finger is the debug gesture, not a camera move.
        guard tracked.count <= 2 else { rebase(announcePivot: false); return }

        let active = Array(tracked.prefix(2))
        let centre = centroid(of: active, in: view)
        let reach = spread(of: active, in: view)
        let now = CACurrentMediaTime()
        let dt = max(1.0 / 240, now - lastTime)
        let dx = centre.x - lastCentroid.x
        let dy = centre.y - lastCentroid.y

        // A slop of a point or so, so a tap is a tap.
        if !moved, abs(dx) + abs(dy) < 1, abs(reach - lastSpread) < 1 { return }
        if moved { state = .changed } else { moved = true; state = .began }

        if active.count == 1 {
            velocity = CGPoint(x: dx / CGFloat(dt), y: dy / CGFloat(dt))
            onMove?(.orbit(Vec2(Double(dx) / Double(max(1, view.bounds.width)),
                                Double(dy) / Double(max(1, view.bounds.height)))))
        } else {
            velocity = .zero
            if dx != 0 || dy != 0 {
                onMove?(.pan(Vec2(Double(dx) * scale, Double(dy) * scale)))
            }
            if lastSpread > 1, reach > 1 {
                let factor = Double(reach / lastSpread)
                if abs(factor - 1) > 1e-6 {
                    onMove?(.zoom(factor: factor,
                                  about: Vec2(Double(centre.x) * scale,
                                              Double(centre.y) * scale)))
                }
            }
        }

        lastCentroid = centre
        lastSpread = reach
        lastTime = now
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        finish(touches, cancelled: false)
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        finish(touches, cancelled: true)
    }

    /// The Pencil landed. Whatever the fingers were doing is over; a one-finger
    /// orbit that began just before was almost certainly the heel of the hand,
    /// so it is undone as well as stopped.
    func yieldToPencil() {
        guard !tracked.isEmpty else { return }
        let palm = tracked.count == 1 && CACurrentMediaTime() - firstTouchTime < NavigationGesture.palmWindow
        ignored.append(contentsOf: tracked)
        tracked.removeAll(keepingCapacity: true)
        velocity = .zero
        switch state {
        case .began, .changed:
            if palm { onRevert?() }
            state = .cancelled
        case .possible:
            state = .failed
        default:
            break
        }
    }

    private func finish(_ touches: Set<UITouch>, cancelled: Bool) {
        ignored.removeAll { touch in touches.contains(touch) }
        let wasSingle = tracked.count == 1
        let before = tracked.count
        tracked.removeAll { touches.contains($0) }
        guard tracked.isEmpty else {
            if tracked.count != before { rebase(announcePivot: false) }
            return
        }
        // Only ignored touches are left — a palm still resting — and there was
        // no gesture: nothing to finish until they lift too.
        if before == 0, !ignored.isEmpty { return }

        // A recogniser that has already failed, ended or been cancelled must
        // not be written again.
        guard state == .possible || state == .began || state == .changed else { return }

        if moved {
            // Hand the leftover velocity over, which the editor decays.
            if wasSingle, !cancelled, let view, abs(velocity.x) + abs(velocity.y) > 60 {
                onFlick?(Vec2(Double(velocity.x) / Double(max(1, view.bounds.width)),
                              Double(velocity.y) / Double(max(1, view.bounds.height))))
            }
            state = cancelled ? .cancelled : .ended
        } else {
            state = .failed
        }
    }

    /// Re-reads the reference centroid and spread, so a finger landing or
    /// lifting is not read as a huge drag.
    private func rebase(announcePivot: Bool) {
        guard let view else { return }
        let active = Array(tracked.prefix(2))
        lastCentroid = centroid(of: active, in: view)
        lastSpread = spread(of: active, in: view)
        lastTime = CACurrentMediaTime()
        velocity = .zero
        if announcePivot {
            onMove?(.pivot(Vec2(Double(lastCentroid.x) * scale,
                                Double(lastCentroid.y) * scale)))
        }
    }

    private func centroid(of touches: [UITouch], in view: UIView) -> CGPoint {
        guard !touches.isEmpty else { return .zero }
        var x: CGFloat = 0, y: CGFloat = 0
        for touch in touches {
            let p = touch.location(in: view)
            x += p.x
            y += p.y
        }
        let n = CGFloat(touches.count)
        return CGPoint(x: x / n, y: y / n)
    }

    private func spread(of touches: [UITouch], in view: UIView) -> CGFloat {
        guard touches.count == 2 else { return 0 }
        let a = touches[0].location(in: view)
        let b = touches[1].location(in: view)
        let dx = Double(a.x - b.x), dy = Double(a.y - b.y)
        return CGFloat((dx * dx + dy * dy).squareRoot())
    }
}

/// Who decides when the viewport draws.
///
/// **The display link** is MTKView's own timer: continuous while something is
/// happening, on demand otherwise. It draws at the top of a display frame, with
/// whatever Pencil samples UIKit had dispatched by then, and presents the frame
/// a refresh later.
///
/// **The low-latency loop** (iPadOS 18) is a `UIUpdateLink` that asks for
/// Apple's two drawing-app features together: Pencil events dispatched in the
/// MIDDLE of the UI update, as late as they can be — `wantsLowLatencyEventDispatch`
/// — and the frame presented immediately after the update's Core Animation
/// commit rather than on the next refresh — `wantsImmediatePresentation`.
/// Apple's documentation puts the second at one frame duration sooner. For a
/// frame to ride that commit, the Metal layer presents inside it
/// (`presentsWithTransaction`), which the renderer handles.
///
/// Neither has been measured on the iPad by this code's author, which is why
/// the readout measures touch-to-glass on the device, the switch is in the
/// brush settings, and the low-latency loop falls back to the display link by
/// itself if it ever stops producing frames.
@MainActor
final class FrameLoop {
    enum Mode { case displayLink, lowLatency }

    private(set) var mode: Mode = .displayLink
    private weak var view: SculptMTKView?
    /// Set when the low-latency loop fell back on its own. It stays down until
    /// the person switches the setting off and on again: retrying on every
    /// SwiftUI update would flap between the two loops.
    private var gaveUp = false
    private var busy = false
    private var needsFrame = true
    private var drewThisUpdate = false
    private var pendingSince: CFTimeInterval = 0
    private var lastFrameAt: CFTimeInterval = 0
    /// The `UIUpdateLink`, kept untyped so the property needs no availability.
    private var link: AnyObject?

    /// Whether a Pencil stroke or hover is live: only then is it worth waiting
    /// for the low-latency dispatch before drawing.
    var pencilActive: () -> Bool = { false }
    /// The loop changed, for the readout and a toast.
    var onModeChange: ((Mode, String?) -> Void)?

    init(view: SculptMTKView) {
        self.view = view
        useDisplayLink()
        // Coming back from the background, or from Control Center, is not a
        // loop that stopped drawing: forget whatever was pending while the app
        // could not draw, or the watchdog reads the gap as a failure.
        activeObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.pendingSince = 0
                self?.lastFrameAt = CACurrentMediaTime()
                self?.request()
            }
        }
    }

    private var activeObserver: NSObjectProtocol?

    /// Whether a missing frame can mean anything: the view is on screen and
    /// the app is in front. Anything else is a pause, not a failure.
    private var canJudge: Bool {
        view?.window != nil && UIApplication.shared.applicationState == .active
    }

    var description: String {
        switch mode {
        case .displayLink: return "display link"
        case .lowLatency: return "low-latency (UIUpdateLink)"
        }
    }

    // MARK: Requests

    /// Something wants the next frame drawn.
    func request() {
        let now = CACurrentMediaTime()
        if !needsFrame { pendingSince = now }
        needsFrame = true
        switch mode {
        case .displayLink:
            // Coalesced, and a no-op in continuous mode.
            view?.setNeedsDisplay()
        case .lowLatency:
            if #available(iOS 18.0, *), let link = link as? UIUpdateLink {
                link.requiresContinuousUpdates = true
            }
            // The watchdog. A loop that is asked for frames and stops drawing
            // them looks exactly like a frozen app, so it gives way to the
            // display link rather than leaving anybody to find a switch.
            if !canJudge {
                pendingSince = now
            } else if pendingSince > 0, now - pendingSince > 0.5, now - lastFrameAt > 0.5 {
                fallBack(because: "no frame for \(Int((now - lastFrameAt) * 1000)) ms")
            }
        }
    }

    /// A stroke, hover or coast started or stopped.
    func setBusy(_ busy: Bool) {
        self.busy = busy
        switch mode {
        case .displayLink:
            guard let view else { return }
            if busy {
                // BOTH properties, in this order: with `enableSetNeedsDisplay`
                // true, MetalKit pauses its own loop whatever `isPaused` says.
                if view.enableSetNeedsDisplay { view.enableSetNeedsDisplay = false }
                if view.isPaused { view.isPaused = false }
            } else {
                view.isPaused = true
                view.enableSetNeedsDisplay = true
                // One last frame, so the end of a stroke is drawn.
                view.setNeedsDisplay()
            }
        case .lowLatency:
            request()
        }
    }

    /// The renderer drew a frame.
    func noteFrameDrawn() {
        lastFrameAt = CACurrentMediaTime()
        needsFrame = false
        pendingSince = 0
    }

    // MARK: Modes

    func setLowLatency(_ wanted: Bool) {
        if !wanted { gaveUp = false }
        if wanted, mode == .displayLink, !gaveUp {
            if #available(iOS 18.0, *) { useLowLatency() }
        } else if !wanted, mode == .lowLatency {
            useDisplayLink()
            onModeChange?(.displayLink, nil)
        }
    }

    private func useDisplayLink() {
        if #available(iOS 18.0, *), let link = link as? UIUpdateLink {
            link.isEnabled = false
        }
        link = nil
        mode = .displayLink
        guard let view else { return }
        (view.layer as? CAMetalLayer)?.presentsWithTransaction = false
        view.isPaused = !busy
        view.enableSetNeedsDisplay = !busy
        view.setNeedsDisplay()
    }

    @available(iOS 18.0, *)
    private func useLowLatency() {
        guard let view else { return }
        // Explicit drawing: MetalKit draws only when `draw()` is called, which
        // the update link's actions do.
        view.isPaused = true
        view.enableSetNeedsDisplay = false
        (view.layer as? CAMetalLayer)?.presentsWithTransaction = true

        let link = UIUpdateLink(view: view)
        link.wantsLowLatencyEventDispatch = true
        link.wantsImmediatePresentation = true
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 80, maximum: 120, preferred: 120)
        link.addAction(to: .beforeEventDispatch) { [weak self] _, _ in
            self?.drewThisUpdate = false
        }
        // After the ordinary events: draw now, unless a Pencil is live and its
        // samples are about to arrive in the low-latency dispatch — then wait
        // for them, which is the entire point of asking for it.
        link.addAction(to: .afterEventDispatch) { [weak self] _, info in
            guard let self else { return }
            if self.pencilActive(), info.isLowLatencyEventDispatchConfirmed { return }
            self.drawIfNeeded()
        }
        link.addAction(to: .afterLowLatencyEventDispatch) { [weak self] _, _ in
            self?.drawIfNeeded()
        }
        link.requiresContinuousUpdates = true
        link.isEnabled = true
        self.link = link
        mode = .lowLatency
        needsFrame = true
        pendingSince = CACurrentMediaTime()
        onModeChange?(.lowLatency, nil)

        // If the link never draws at all — an OS that ignores it — give way
        // rather than waiting to be asked. Judged only once the view is on
        // screen: a cold launch can take longer than this to put it there.
        checkFirstFrame(since: pendingSince, attempts: 0, seenOnScreen: false)
    }

    /// Falls back only after a full interval ON SCREEN with no frame: the first
    /// check that finds the view in a window just starts the clock.
    private func checkFirstFrame(since started: CFTimeInterval, attempts: Int, seenOnScreen: Bool) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self, self.mode == .lowLatency, self.lastFrameAt < started,
                  attempts < 20 else { return }
            guard self.canJudge, seenOnScreen else {
                self.checkFirstFrame(since: started, attempts: attempts + 1,
                                     seenOnScreen: self.canJudge)
                return
            }
            self.fallBack(because: "the update link drew nothing once it was on screen")
        }
    }

    @available(iOS 18.0, *)
    private func drawIfNeeded() {
        guard !drewThisUpdate, needsFrame || busy, let view else { return }
        drewThisUpdate = true
        view.draw()
        // Nothing is animating and the frame just drawn asked for no other:
        // stop asking the system for updates until something requests one.
        // `needsFrame` is re-read AFTER the draw on purpose — the drain inside
        // it can end a stroke and ask for one last frame, and switching the
        // updates off under that request would leave it undrawn.
        if !busy, !needsFrame, let link = link as? UIUpdateLink {
            link.requiresContinuousUpdates = false
        }
    }

    private func fallBack(because reason: String) {
        guard mode == .lowLatency else { return }
        NSLog("[BabyBlender] low-latency loop fell back to the display link: %@", reason)
        gaveUp = true
        useDisplayLink()
        onModeChange?(.displayLink, reason)
    }
}

struct SculptView: UIViewRepresentable {
    @ObservedObject var editor: EditorModel

    func makeCoordinator() -> Coordinator { Coordinator(editor: editor) }

    func makeUIView(context: Context) -> SculptMTKView {
        let view = SculptMTKView(frame: .zero, device: MTLCreateSystemDefaultDevice())
        view.isMultipleTouchEnabled = true
        // Ask for the highest rate any iPad offers and let MetalKit round to a
        // factor of the panel's own maximum.
        view.preferredFramesPerSecond = 120
        view.enableSetNeedsDisplay = true
        view.isPaused = true

        let renderer: Renderer
        do {
            renderer = try Renderer(view: view)
        } catch {
            // A viewport that cannot start is a bug worth naming, not hiding.
            NSLog("[BabyBlender] renderer setup failed: \(error.localizedDescription)")
            view.showFailure(error.localizedDescription)
            return view
        }
        let coordinator = context.coordinator
        coordinator.renderer = renderer
        coordinator.view = view
        view.delegate = renderer

        let loop = FrameLoop(view: view)
        coordinator.loop = loop
        loop.pencilActive = { [weak editor] in editor?.pencilActive ?? false }
        loop.onModeChange = { [weak editor, weak loop] mode, reason in
            guard let editor, let loop else { return }
            editor.loopDescription = loop.description
            if let reason {
                editor.say("Low-latency drawing is unavailable here; using the standard loop")
                NSLog("[BabyBlender] %@", reason)
            } else if mode == .lowLatency {
                NSLog("[BabyBlender] drawing through the low-latency UIUpdateLink")
            }
        }

        renderer.beforeDraw = { [weak view, weak renderer, weak loop, weak coordinator] in
            guard let view, let renderer, let coordinator else { return }
            loop?.noteFrameDrawn()
            let now = CACurrentMediaTime()
            let elapsed = coordinator.lastFrame > 0 ? now - coordinator.lastFrame : 0
            coordinator.lastFrame = now
            // Last frame's cost, since this one has not happened yet.
            if elapsed > 0 { editor.report(frame: renderer.stats, elapsed: elapsed) }

            let viewport = Vec2(Double(view.drawableSize.width), Double(view.drawableSize.height))
            guard viewport.x > 0, viewport.y > 0 else { return }
            // Points to drawable pixels, read here rather than at setup: the
            // view has no window when `makeUIView` runs.
            editor.pointScale = Double(view.contentScaleFactor)
            editor.drainInput(viewport: viewport)
            renderer.inputTimestamp = editor.measuresLatency ? editor.inputTimestampThisFrame : 0
        }
        renderer.requestFrame = { [weak loop] in loop?.request() }
        renderer.onPresented = { [weak editor] input, shown in
            // The presented handler runs on a Metal thread.
            Task { @MainActor in editor?.noteLatency(shown - input) }
        }

        editor.onChange = { [weak coordinator] change in
            guard let coordinator, let renderer = coordinator.renderer else { return }
            if change.contains(.mesh) { renderer.upload(editor.document.mesh) }
            if change.contains(.texture) {
                switch editor.takeTextureUpload() {
                case .nothing: break
                case .whole: renderer.upload(albedo: editor.document.albedo)
                case .region(let rect): renderer.update(albedo: editor.document.albedo, rect: rect)
                }
            }
            renderer.camera = editor.camera
            renderer.cursor = editor.cursor
            coordinator.loop?.request()
        }
        editor.onActivity = { [weak loop] busy in loop?.setBusy(busy) }
        editor.requestDraw = { [weak loop] in loop?.request() }

        coordinator.install(on: view)

        renderer.upload(editor.document.mesh)
        renderer.upload(albedo: editor.document.albedo)
        renderer.camera = editor.camera
        loop.setLowLatency(editor.lowLatency)
        editor.loopDescription = loop.description
        loop.request()
        // The paint map is built after the first frame rather than before it.
        editor.prepareForPaintingSoon()
        NSLog("[BabyBlender] viewport ready")
        return view
    }

    func updateUIView(_ view: SculptMTKView, context: Context) {
        context.coordinator.renderer?.camera = editor.camera
        if let loop = context.coordinator.loop {
            loop.setLowLatency(editor.lowLatency)
            loop.request()
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate, UIPencilInteractionDelegate {
        let editor: EditorModel
        var renderer: Renderer?
        var loop: FrameLoop?
        weak var view: SculptMTKView?
        var lastFrame: CFTimeInterval = 0
        private var navigation: NavigationGesture?
        /// The camera when the current finger gesture began: what a palm's
        /// orbit is undone back to.
        private var cameraAtFirstTouch: Camera?
        private var lastPencilTap: CFTimeInterval = 0

        init(editor: EditorModel) { self.editor = editor }

        func install(on view: SculptMTKView) {
            self.view = view

            view.onSample = { [weak self] sample in self?.editor.enqueue(sample) }
            view.onPredicted = { [weak self] point in self?.editor.predict(point) }
            // `view` weakly: these closures are stored ON the view, so a strong
            // capture is a cycle that keeps the whole viewport alive.
            view.onHover = { [weak self] point, height in
                self?.editor.enqueueHover(at: point, height: height)
            }
            view.onHoverEnd = { [weak self] in self?.editor.clearHover() }
            view.fingerSculpts = { [weak self] point in
                self?.fingerSculpts(at: point) ?? false
            }
            view.onPencilDown = { [weak self] in
                self?.editor.notePencil()
                self?.navigation?.yieldToPencil()
            }

            let navigate = NavigationGesture(target: self,
                                             action: #selector(handleNavigate(_:)))
            navigate.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
            // The view's own touch handlers must keep their touches: a finger
            // that the tool took is still delivered there.
            navigate.cancelsTouchesInView = false
            navigate.delaysTouchesBegan = false
            // Default is true, which holds `touchesEnded` back by about 150 ms
            // while the recogniser is still undecided.
            navigate.delaysTouchesEnded = false
            navigate.delegate = self
            navigate.onMove = { [weak self] move in self?.apply(move) }
            navigate.onFlick = { [weak self] velocity in self?.editor.flick(velocity: velocity) }
            navigate.shouldYieldToTool = { [weak self] point in
                self?.fingerSculpts(at: point) ?? false
            }
            navigate.pencilIsDown = { [weak view] in view?.pencilIsDown ?? false }
            navigate.pencilSeen = { [weak self] in self?.editor.pencilSeen ?? false }
            navigate.onFirstTouch = { [weak self] in
                guard let self else { return }
                self.cameraAtFirstTouch = self.editor.camera
            }
            navigate.onRevert = { [weak self] in
                guard let self, let saved = self.cameraAtFirstTouch else { return }
                self.editor.restoreCamera(saved)
            }
            view.addGestureRecognizer(navigate)
            navigation = navigate

            let doubleTap = UITapGestureRecognizer(target: self,
                                                   action: #selector(handleDoubleTap(_:)))
            doubleTap.numberOfTapsRequired = 2
            // Restricted to fingers. Unrestricted, a Pencil double tap on the
            // model reframes the camera in the middle of drawing.
            doubleTap.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
            doubleTap.delegate = self
            view.addGestureRecognizer(doubleTap)

            // Two fingers tapped together is undo in every iPad drawing and
            // sculpting app — Procreate, Nomad, Freeform — so a hand that
            // already knows it should not have to find a button mid-stroke.
            let twoFingerTap = UITapGestureRecognizer(target: self,
                                                      action: #selector(handleTwoFingerTap))
            twoFingerTap.numberOfTouchesRequired = 2
            twoFingerTap.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
            twoFingerTap.delegate = self
            view.addGestureRecognizer(twoFingerTap)

            let tripleTap = UITapGestureRecognizer(target: self, action: #selector(handleTripleTap))
            tripleTap.numberOfTouchesRequired = 3
            tripleTap.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
            tripleTap.delegate = self
            view.addGestureRecognizer(tripleTap)

            // Hover: where the brush will land, before it lands. Pencil only.
            // Only the newer iPads report it at all (M2 and later, plus the A17
            // Pro mini), so its absence is a device fact, not a bug.
            let hover = UIHoverGestureRecognizer(target: self, action: #selector(handleHover(_:)))
            hover.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.pencil.rawValue)]
            view.addGestureRecognizer(hover)

            let pencil = UIPencilInteraction()
            pencil.delegate = self
            view.addInteraction(pencil)
        }

        // MARK: - Helpers

        private func viewport(of view: MTKView) -> Vec2 {
            Vec2(Double(view.drawableSize.width), Double(view.drawableSize.height))
        }

        private func fingerSculpts(at point: CGPoint) -> Bool {
            guard let view else { return false }
            let scale = Double(view.contentScaleFactor)
            return editor.fingerShouldSculpt(
                at: Vec2(Double(point.x) * scale, Double(point.y) * scale),
                viewport: viewport(of: view))
        }

        private func apply(_ move: NavigationGesture.Move) {
            guard let view else { return }
            let size = viewport(of: view)
            guard size.x > 0, size.y > 0 else { return }
            switch move {
            case .orbit(let delta):
                editor.orbit(by: delta)
            case .pan(let delta):
                editor.pan(by: delta, viewport: size)
            case .zoom(let factor, let about):
                editor.zoom(by: factor, about: about, viewport: size)
            case .pivot(let point):
                editor.setPivot(at: point, viewport: size)
            }
        }

        // MARK: - Simultaneity

        /// The taps run alongside navigation: a triple tap has to be able to
        /// happen while fingers are on the glass.
        func gestureRecognizer(_ gesture: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            true
        }

        // MARK: - Camera

        /// The recogniser drives the camera through `onMove`; this exists
        /// because a `UIGestureRecognizer` wants a target and an action.
        @objc func handleNavigate(_ gesture: UIGestureRecognizer) {}

        /// Nomad's rule: on the model, re-pivot there; off it, frame the whole
        /// thing.
        @objc func handleDoubleTap(_ gesture: UITapGestureRecognizer) {
            guard let view else { return }
            let point = gesture.location(in: view)
            let scale = Double(view.contentScaleFactor)
            editor.doubleTap(at: Vec2(Double(point.x) * scale, Double(point.y) * scale),
                             viewport: viewport(of: view))
        }

        @objc func handleTwoFingerTap() {
            // Not while the Pencil is drawing: the hand holding it can land two
            // fingers without meaning anything by it.
            guard view?.pencilIsDown != true else { return }
            guard editor.canUndo else { return }
            editor.undo()
            editor.say("Undo")
        }

        /// Three fingers shows the debug readout. Three is the first touch count
        /// the tool itself can never produce.
        @objc func handleTripleTap() {
            editor.showStats.toggle()
            loop?.request()
        }

        // MARK: - Pencil

        @objc func handleHover(_ gesture: UIHoverGestureRecognizer) {
            guard let view else { return }
            switch gesture.state {
            case .began, .changed:
                let point = gesture.location(in: view)
                let scale = view.contentScaleFactor
                editor.enqueueHover(at: Vec2(Double(point.x * scale), Double(point.y * scale)),
                                    height: Double(gesture.zOffset))
            default:
                editor.clearHover()
            }
        }

        /// iPadOS 17.4 and earlier.
        func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
            pencilTapped(UIPencilInteraction.preferredTapAction)
        }

        /// iPadOS 17.5 and later, where the older callback is no longer sent.
        @available(iOS 17.5, *)
        func pencilInteraction(_ interaction: UIPencilInteraction,
                               didReceiveTap tap: UIPencilInteraction.Tap) {
            pencilTapped(UIPencilInteraction.preferredTapAction)
        }

        /// A Pencil Pro squeeze, honouring its own setting.
        @available(iOS 17.5, *)
        func pencilInteraction(_ interaction: UIPencilInteraction,
                               didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
            guard squeeze.phase == .ended else { return }
            pencilTapped(UIPencilInteraction.preferredSqueezeAction)
        }

        /// What the person set in Settings → Apple Pencil, not what this app
        /// assumes. "Ignore" is honoured: a double tap nobody asked for changed
        /// the tool silently, which is how the fourth device run's "paint does
        /// nothing" happened.
        private func pencilTapped(_ action: UIPencilPreferredAction) {
            let now = CACurrentMediaTime()
            guard now - lastPencilTap > 0.05 else { return }
            lastPencilTap = now
            editor.notePencil()
            switch action {
            case .ignore:
                editor.pencilTapped(preference: .ignore)
            case .switchPrevious:
                editor.pencilTapped(preference: .previousTool)
            default:
                editor.pencilTapped(preference: .eraser)
            }
        }
    }
}
