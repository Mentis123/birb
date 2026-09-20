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
/// background always moves the camera, two fingers always pan and pinch. That
/// removes the mode switch that otherwise sits between you and every stroke.
final class SculptMTKView: MTKView {
    var onSample: ((EditorModel.Sample) -> Void)?
    var onHover: ((Vec2, Double) -> Void)?
    var onHoverEnd: (() -> Void)?
    /// Asked when a finger lands: does the tool want it, or does the camera?
    /// The navigation recogniser asks the same question of the same editor, so
    /// the two cannot disagree and neither depends on which is told first.
    var fingerSculpts: ((CGPoint) -> Bool)?

    /// The one touch the tool is following. A second finger cannot start a
    /// second stroke, and a touch the tool declined at touch-down is never
    /// reconsidered mid-gesture.
    private weak var editingTouch: UITouch?

    private func accepts(_ touch: UITouch) -> Bool {
        switch touch.type {
        case .pencil: return true
        case .direct: return fingerSculpts?(touch.location(in: self)) ?? false
        default: return false
        }
    }

    private func force(_ touch: UITouch) -> Double {
        // `force` is 0 for a finger and for a Pencil held perpendicular, so it
        // is floored rather than used raw: a stroke that does nothing because
        // the pressure read zero is indistinguishable from a broken brush.
        guard touch.type == .pencil, touch.maximumPossibleForce > 0 else { return 1 }
        return max(0.15, Double(touch.force / touch.maximumPossibleForce))
    }

    private func send(_ touch: UITouch, phase: EditorModel.Sample.Phase) {
        let scale = contentScaleFactor
        let point = touch.location(in: self)
        onSample?(.init(phase: phase,
                        location: Vec2(Double(point.x * scale), Double(point.y * scale)),
                        force: force(touch),
                        isPencil: touch.type == .pencil))
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
        // Let go of a touch we are no longer following.
        //
        // `editingTouch` is weak, and a `UITouch` whose sequence has finished
        // can be recycled or released; a touch cancelled while the main thread
        // was blocked may never deliver its end here at all. Either way the
        // stale value used to block every later stroke, because the guard
        // below would return and nothing would ever clear it. The editor
        // closes the stranded stroke when the next `.began` arrives.
        if let current = editingTouch, current.phase == .ended || current.phase == .cancelled {
            editingTouch = nil
        }
        guard editingTouch == nil else { return }
        guard let touch = touches.first(where: { accepts($0) }) else { return }
        editingTouch = touch
        send(touch, phase: .began)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = editingTouch, touches.contains(touch) else { return }
        // Every sample the Pencil took, not just the one UIKit chose to deliver.
        //
        // UIKit hands over one `touchesMoved` per display refresh and folds the
        // rest into the event; a Pencil samples up to 240 times a second against
        // a 120 Hz screen, so reading the delivered touch alone throws away half
        // to three quarters of the stroke and fast curves come out polygonal.
        // The coalesced array has to be read inside the event — it is not
        // promised to outlive it.
        if let coalesced = event?.coalescedTouches(for: touch), !coalesced.isEmpty {
            for sample in coalesced { send(sample, phase: .moved) }
        } else {
            send(touch, phase: .moved)
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = editingTouch, touches.contains(touch) else { return }
        send(touch, phase: .ended)
        editingTouch = nil
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = editingTouch, touches.contains(touch) else { return }
        send(touch, phase: .cancelled)
        editingTouch = nil
    }
}

/// One recogniser for the whole camera: orbit, pan, pinch and re-pivot.
///
/// It replaces three separate recognisers that all ran at once. A
/// `UIPanGestureRecognizer` capped at one touch does not fail when a second
/// finger lands — it keeps tracking the first — so with simultaneous
/// recognition turned on, a two-finger drag was an orbit AND a pan AND a pinch
/// in the same frame. That is what "the controls don't quite work right when I
/// use two fingers" was.
///
/// Counting touches in one place also makes the 1 -> 2 -> 1 transitions
/// cheap to get right: the reference centroid and spread are re-read whenever
/// the set changes, so adding or lifting a finger moves nothing.
final class NavigationGesture: UIGestureRecognizer {
    enum Move {
        /// Normalised screen travel.
        case orbit(Vec2)
        /// Drawable pixels.
        case pan(Vec2)
        /// Drawable pixels for the anchor.
        case zoom(factor: Double, about: Vec2)
        /// Drawable pixels. Two fingers landing re-centre the orbit on what is
        /// under them, which is Nomad's rule and the thing that stops every
        /// orbit after a pan swinging the model out of frame.
        case pivot(Vec2)
    }

    var onMove: ((Move) -> Void)?
    var onFlick: ((Vec2) -> Void)?
    /// Asked once, when the first finger lands. True means the tool is taking
    /// this gesture and the camera must keep out of it.
    var shouldYieldToTool: ((CGPoint) -> Bool)?

    private var tracked: [UITouch] = []
    private var lastCentroid: CGPoint = .zero
    private var lastSpread: CGFloat = 0
    private var lastTime: CFTimeInterval = 0
    private var velocity: CGPoint = .zero
    private var moved = false
    private var yielded = false

    /// Points to drawable pixels. The camera's anchors are compared against the
    /// drawable's own centre, so everything handed over is in its units.
    private var scale: Double { Double(view?.contentScaleFactor ?? 1) }

    override func reset() {
        super.reset()
        tracked.removeAll(keepingCapacity: true)
        velocity = .zero
        moved = false
        yielded = false
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let view else { return }
        let direct = touches.filter { $0.type == .direct }
        guard !direct.isEmpty, !yielded else { return }

        if tracked.isEmpty, state == .possible,
           let first = direct.min(by: { $0.timestamp < $1.timestamp }),
           shouldYieldToTool?(first.location(in: view)) == true {
            // Failing rather than ignoring: the view's own touch handlers keep
            // the whole gesture, and the tap recognisers are unaffected.
            yielded = true
            state = .failed
            return
        }

        let hadTwo = tracked.count >= 2
        for touch in direct where !tracked.contains(touch) { tracked.append(touch) }
        rebase(announcePivot: !hadTwo && tracked.count >= 2)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard !yielded, let view, !tracked.isEmpty else { return }
        // A third finger is the debug gesture, not a camera move. Hold still
        // until it lifts rather than steering off two of the three.
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

    private func finish(_ touches: Set<UITouch>, cancelled: Bool) {
        let wasSingle = tracked.count == 1
        tracked.removeAll { touches.contains($0) }
        guard tracked.isEmpty else { return rebase(announcePivot: false) }

        // A recogniser that has already failed, ended or been cancelled must
        // not be written again — UIKit only allows a state change out of
        // `.possible`, `.began` or `.changed`, and the yielded case reaches
        // here already `.failed`.
        guard state == .possible || state == .began || state == .changed else { return }

        if moved {
            // Hand the leftover velocity over, which the editor decays. A
            // turntable that stops dead on lift is the clearest sign a viewport
            // is unfinished.
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

struct SculptView: UIViewRepresentable {
    @ObservedObject var editor: EditorModel

    func makeCoordinator() -> Coordinator { Coordinator(editor: editor) }

    func makeUIView(context: Context) -> SculptMTKView {
        let view = SculptMTKView(frame: .zero, device: MTLCreateSystemDefaultDevice())
        view.isMultipleTouchEnabled = true
        // Ask for the highest rate any iPad offers and let MetalKit round.
        //
        // It rounds to the nearest FACTOR of the panel's own
        // `maximumFramesPerSecond`, so 120 becomes 60 on a 60 Hz iPad by itself.
        // Reading the screen here would not work anyway: the view has no window
        // yet, and `UIScreen.main` is deprecated precisely because it is the
        // wrong screen on a device with more than one.
        view.preferredFramesPerSecond = 120
        // Starts on demand; `onActivity` switches it to continuous. See the
        // note there — the switch is BOTH properties, not one.
        view.enableSetNeedsDisplay = true
        view.isPaused = true

        let renderer: Renderer
        do {
            renderer = try Renderer(view: view)
        } catch {
            // Say so, on the screen and in the console.
            //
            // The previous version returned a view with no delegate here, which
            // renders as black forever and reads as a hang. A viewport that
            // cannot start is a bug worth naming, not worth hiding.
            NSLog("[BabyBlender] renderer setup failed: \(error.localizedDescription)")
            view.showFailure(error.localizedDescription)
            return view
        }
        context.coordinator.renderer = renderer
        context.coordinator.view = view
        view.delegate = renderer

        renderer.beforeDraw = { [weak view, weak renderer] in
            guard let view, let renderer else { return }
            let now = CACurrentMediaTime()
            let elapsed = context.coordinator.lastFrame > 0
                ? now - context.coordinator.lastFrame : 0
            context.coordinator.lastFrame = now
            // Last frame's cost, since this one has not happened yet.
            if elapsed > 0 { editor.report(frame: renderer.stats, elapsed: elapsed) }

            let viewport = Vec2(Double(view.drawableSize.width),
                                Double(view.drawableSize.height))
            guard viewport.x > 0, viewport.y > 0 else { return }
            // Points to drawable pixels, read here rather than at setup: the
            // view has no window when `makeUIView` runs, so its scale is 1 and
            // the brush would be half size until the first resize.
            editor.pointScale = Double(view.contentScaleFactor)
            editor.drainInput(viewport: viewport)
        }

        editor.onChange = { [weak view] change in
            guard let renderer = context.coordinator.renderer else { return }
            if change.contains(.mesh) { renderer.upload(editor.document.mesh) }
            if change.contains(.texture) {
                let rect = editor.takePaintDirtyRect()
                if rect.isEmpty {
                    renderer.upload(albedo: editor.document.albedo)
                } else {
                    renderer.update(albedo: editor.document.albedo, rect: rect)
                }
            }
            renderer.camera = editor.camera
            renderer.cursor = editor.cursor
            view?.setNeedsDisplay()
        }

        // The whole second device run, in one closure.
        //
        // `isPaused = false` on its own does NOTHING here. Apple's MetalKit
        // header is explicit: setting `enableSetNeedsDisplay` to true "will
        // also pause the MTKView's internal render loop and updates will
        // instead be event driven". So the previous version queued Pencil
        // samples, asked the view to run continuously, and the view kept
        // drawing only on demand — with nothing on the Pencil path demanding
        // anything. The stroke sat in the queue until an unrelated finger
        // moved the camera, and then arrived all at once. Same dead switch for
        // the hover ring and for the flick coast.
        editor.onActivity = { [weak view] busy in
            guard let view else { return }
            if busy {
                if view.enableSetNeedsDisplay { view.enableSetNeedsDisplay = false }
                if view.isPaused { view.isPaused = false }
            } else {
                view.isPaused = true
                view.enableSetNeedsDisplay = true
                // One last frame, so the end of a stroke is drawn.
                view.setNeedsDisplay()
            }
        }

        // Belt and braces, and cheap: anything that queues work asks for a
        // frame rather than reasoning about whether one is already coming.
        // `setNeedsDisplay` coalesces, and in continuous mode it is a no-op.
        editor.requestDraw = { [weak view] in view?.setNeedsDisplay() }

        context.coordinator.install(on: view)

        renderer.upload(editor.document.mesh)
        renderer.upload(albedo: editor.document.albedo)
        renderer.camera = editor.camera
        view.setNeedsDisplay()
        // The paint map is built after the first frame rather than before it.
        // In a debug build it costs seconds, and Xcode's Run button builds
        // debug.
        editor.prepareForPaintingSoon()
        NSLog("[BabyBlender] viewport ready")
        return view
    }

    func updateUIView(_ view: SculptMTKView, context: Context) {
        context.coordinator.renderer?.camera = editor.camera
        view.setNeedsDisplay()
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate, UIPencilInteractionDelegate {
        let editor: EditorModel
        var renderer: Renderer?
        weak var view: SculptMTKView?
        var lastFrame: CFTimeInterval = 0

        init(editor: EditorModel) { self.editor = editor }

        func install(on view: SculptMTKView) {
            self.view = view

            view.onSample = { [weak self] sample in self?.editor.enqueue(sample) }
            // `view` weakly: these closures are stored ON the view, so a strong
            // capture is a cycle that keeps the whole viewport alive.
            view.onHover = { [weak self] point, height in
                self?.editor.enqueueHover(at: point, height: height)
            }
            view.onHoverEnd = { [weak self] in self?.editor.clearHover() }
            view.fingerSculpts = { [weak self] point in
                self?.fingerSculpts(at: point) ?? false
            }

            let navigate = NavigationGesture(target: self,
                                             action: #selector(handleNavigate(_:)))
            navigate.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
            // The view's own touch handlers must keep their touches: a finger
            // that the tool took is still delivered there.
            navigate.cancelsTouchesInView = false
            navigate.delaysTouchesBegan = false
            // Default is true, which holds `touchesEnded` back by about 150 ms
            // while the recogniser is still undecided — long enough to be felt
            // at the end of every stroke.
            navigate.delaysTouchesEnded = false
            navigate.delegate = self
            navigate.onMove = { [weak self] move in self?.apply(move) }
            navigate.onFlick = { [weak self] velocity in self?.editor.flick(velocity: velocity) }
            navigate.shouldYieldToTool = { [weak self] point in
                self?.fingerSculpts(at: point) ?? false
            }
            view.addGestureRecognizer(navigate)

            let doubleTap = UITapGestureRecognizer(target: self,
                                                   action: #selector(handleDoubleTap(_:)))
            doubleTap.numberOfTapsRequired = 2
            // Restricted to fingers. Unrestricted, a Pencil double tap on the
            // model reframes the camera in the middle of drawing.
            doubleTap.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
            doubleTap.delegate = self
            view.addGestureRecognizer(doubleTap)

            let tripleTap = UITapGestureRecognizer(target: self, action: #selector(handleTripleTap))
            tripleTap.numberOfTouchesRequired = 3
            tripleTap.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
            tripleTap.delegate = self
            view.addGestureRecognizer(tripleTap)

            // Hover: where the brush will land, before it lands. Pencil only —
            // a trackpad pointer would otherwise drive it too. Only the newer
            // iPads report it at all (M2 and later, plus the A17 Pro mini), so
            // its absence is a device fact, not a bug.
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

        /// The taps run alongside navigation. Navigation itself no longer needs
        /// this — it is one recogniser now — but a triple tap has to be able to
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

        /// Three fingers shows the debug readout. Three is the first touch count
        /// the tool itself can never produce — one is a stroke or an orbit, two
        /// is pan and pinch — which is the same reasoning behind the Birb Labs
        /// three-finger QR.
        @objc func handleTripleTap() {
            editor.showStats.toggle()
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

        func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
            // The system-wide meaning of this gesture in a drawing app.
            editor.notePencil()
            editor.togglePaintErase()
        }
    }
}
