import SwiftUI
import MetalKit
import UIKit
import QuartzCore
import HumanoidCore

/// The Metal viewport and its touch handling.
///
/// The rule this file follows: **fingers navigate, the Pencil edits.** One
/// finger orbits, two pan and pinch together, and the Pencil sculpts or paints.
/// That removes the mode switch that otherwise sits between you and every
/// stroke, and it is why a Pencil is worth requiring for the editing half.
///
/// A finger can still edit when `fingerEditing` is on, for anyone without one.
final class SculptMTKView: MTKView {
    var onSample: ((EditorModel.Sample) -> Void)?
    var onHover: ((Vec2, Double) -> Void)?
    var onHoverEnd: (() -> Void)?
    /// Allows editing with a finger, for people who have no Pencil. Off by
    /// default: with it on, every orbit is also a stroke.
    var fingerEditing = false

    private func isEditingTouch(_ touch: UITouch) -> Bool {
        touch.type == .pencil || fingerEditing
    }

    private func force(_ touch: UITouch) -> Double {
        // `force` is 0 for a finger and for a Pencil held perpendicular, so it
        // is floored rather than used raw: a stroke that does nothing because
        // the pressure read zero is indistinguishable from a broken brush.
        guard touch.type == .pencil, touch.maximumPossibleForce > 0 else { return 1 }
        return max(0.15, Double(touch.force / touch.maximumPossibleForce))
    }

    private func report(_ touches: Set<UITouch>, _ event: UIEvent?,
                        _ phase: EditorModel.Sample.Phase) {
        guard let touch = touches.first(where: isEditingTouch) else { return }
        let scale = contentScaleFactor

        func send(_ sample: UITouch, phase: EditorModel.Sample.Phase) {
            let point = sample.location(in: self)
            onSample?(.init(phase: phase,
                            location: Vec2(Double(point.x * scale), Double(point.y * scale)),
                            force: force(sample)))
        }

        // Every sample the Pencil took, not just the one UIKit chose to deliver.
        //
        // UIKit hands over one `touchesMoved` per display refresh and folds the
        // rest into the event; a Pencil samples up to 240 times a second against
        // a 120 Hz screen, so reading `touches.first` alone throws away half to
        // three quarters of the stroke and fast curves come out polygonal. The
        // coalesced array has to be read inside the event — it is not promised
        // to outlive it.
        if phase == .moved, let coalesced = event?.coalescedTouches(for: touch), !coalesced.isEmpty {
            for sample in coalesced { send(sample, phase: .moved) }
        } else {
            send(touch, phase: phase)
        }
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        report(touches, event, .began)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        report(touches, event, .moved)
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        report(touches, event, .ended)
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        report(touches, event, .cancelled)
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
        // Idle, the view draws only when something changes — a sculpting tool is
        // static most of the time and a permanent 120 Hz loop is the easiest
        // battery win there is. During a stroke or a coast it runs continuously,
        // which is what `onActivity` switches.
        view.enableSetNeedsDisplay = true
        view.isPaused = true

        guard let renderer = Renderer(view: view) else { return view }
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

        editor.onActivity = { [weak view] busy in
            guard let view else { return }
            view.isPaused = !busy
            if !busy { view.setNeedsDisplay() }
        }

        context.coordinator.install(on: view)

        renderer.upload(editor.document.mesh)
        renderer.upload(albedo: editor.document.albedo)
        renderer.camera = editor.camera
        view.setNeedsDisplay()
        return view
    }

    func updateUIView(_ view: SculptMTKView, context: Context) {
        view.fingerEditing = editor.fingerEditing
        context.coordinator.renderer?.camera = editor.camera
        view.setNeedsDisplay()
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate, UIPencilInteractionDelegate {
        let editor: EditorModel
        var renderer: Renderer?
        weak var view: SculptMTKView?
        private var lastOrbit: CGPoint = .zero
        private var lastPan: CGPoint = .zero
        var lastFrame: CFTimeInterval = 0

        init(editor: EditorModel) { self.editor = editor }

        func install(on view: SculptMTKView) {
            self.view = view

            view.onSample = { [weak self] sample in self?.editor.enqueue(sample) }
            // `view` weakly: these closures are stored ON the view, so a strong
            // capture is a cycle that keeps the whole viewport alive.
            view.onHover = { [weak self, weak view] point, height in
                self?.editor.enqueueHover(at: point, height: height)
                view?.isPaused = false
            }
            view.onHoverEnd = { [weak self] in self?.editor.clearHover() }

            // Orbit and pan are SEPARATE recognisers, not one that counts
            // fingers. Sharing one makes the view jump the instant a second
            // finger lands, because the same gesture changes meaning mid-drag.
            let orbit = UIPanGestureRecognizer(target: self, action: #selector(handleOrbit(_:)))
            orbit.minimumNumberOfTouches = 1
            orbit.maximumNumberOfTouches = 1
            orbit.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
            view.addGestureRecognizer(orbit)

            let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
            pan.minimumNumberOfTouches = 2
            pan.maximumNumberOfTouches = 2
            pan.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
            pan.delegate = self
            view.addGestureRecognizer(pan)

            let pinch = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
            pinch.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
            pinch.delegate = self
            view.addGestureRecognizer(pinch)

            let doubleTap = UITapGestureRecognizer(target: self, action: #selector(handleDoubleTap))
            doubleTap.numberOfTapsRequired = 2
            // Restricted to fingers. Unrestricted, a Pencil double tap on the
            // model reframes the camera in the middle of drawing.
            doubleTap.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
            view.addGestureRecognizer(doubleTap)

            let tripleTap = UITapGestureRecognizer(target: self, action: #selector(handleTripleTap))
            tripleTap.numberOfTouchesRequired = 3
            tripleTap.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
            view.addGestureRecognizer(tripleTap)

            // Hover: where the brush will land, before it lands. Pencil only —
            // a trackpad pointer would otherwise drive it too.
            let hover = UIHoverGestureRecognizer(target: self, action: #selector(handleHover(_:)))
            hover.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.pencil.rawValue)]
            view.addGestureRecognizer(hover)

            let pencil = UIPencilInteraction()
            pencil.delegate = self
            view.addInteraction(pencil)
        }

        // MARK: - Simultaneity

        /// Two-finger pan, pinch and the rest run together.
        ///
        /// By default recognisers block each other, which is why the first
        /// version could not zoom while panning — a limit no 3D application has.
        func gestureRecognizer(_ gesture: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            true
        }

        // MARK: - Camera

        @objc func handleOrbit(_ gesture: UIPanGestureRecognizer) {
            guard let view else { return }
            let translation = gesture.translation(in: view)
            if gesture.state == .began { lastOrbit = .zero }
            let dx = Double(translation.x - lastOrbit.x) / Double(view.bounds.width)
            let dy = Double(translation.y - lastOrbit.y) / Double(view.bounds.height)
            lastOrbit = translation

            if gesture.state == .ended || gesture.state == .cancelled {
                // Hand the leftover velocity to the model, which decays it. A
                // turntable that stops dead on lift is the clearest sign a
                // viewport is unfinished.
                let velocity = gesture.velocity(in: view)
                editor.flick(velocity: Vec2(Double(velocity.x) / Double(view.bounds.width),
                                            Double(velocity.y) / Double(view.bounds.height)))
                return
            }
            editor.camera.orbit(dx: dx, dy: dy)
            editor.cameraMoved()
        }

        @objc func handlePan(_ gesture: UIPanGestureRecognizer) {
            guard let view else { return }
            let translation = gesture.translation(in: view)
            if gesture.state == .began { lastPan = .zero }
            let dx = Double(translation.x - lastPan.x) / Double(view.bounds.width)
            let dy = Double(translation.y - lastPan.y) / Double(view.bounds.height)
            lastPan = translation
            editor.camera.pan(dx: dx, dy: dy)
            editor.cameraMoved()
        }

        @objc func handlePinch(_ gesture: UIPinchGestureRecognizer) {
            editor.camera.zoom(by: Double(gesture.scale))
            gesture.scale = 1
            editor.cameraMoved()
        }

        @objc func handleDoubleTap() {
            editor.frameModel()
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
                view.onHover?(Vec2(Double(point.x * scale), Double(point.y * scale)),
                              Double(gesture.zOffset))
            default:
                view.onHoverEnd?()
                view.setNeedsDisplay()
            }
        }

        func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
            // The system-wide meaning of this gesture in a drawing app.
            editor.togglePaintErase()
        }
    }
}
