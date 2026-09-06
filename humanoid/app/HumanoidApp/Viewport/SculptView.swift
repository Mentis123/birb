import SwiftUI
import MetalKit
import UIKit
import HumanoidCore

/// The Metal viewport and its touch handling.
///
/// The rule this file follows: **fingers navigate, the Pencil edits.** One
/// finger orbits, two pan, pinch zooms, and the Pencil sculpts or paints. That
/// removes the mode switch that otherwise sits between you and every stroke,
/// and it is why a Pencil is worth requiring for the editing half.
///
/// A finger can still edit when `fingerEditing` is on, for anyone without one.
final class SculptMTKView: MTKView {
    var onPencil: ((_ phase: UIGestureRecognizer.State, _ location: CGPoint, _ force: CGFloat) -> Void)?
    /// Allows editing with a finger, for people who have no Pencil. Off by
    /// default: with it on, every orbit is also a stroke.
    var fingerEditing = false

    private func isEditingTouch(_ touch: UITouch) -> Bool {
        touch.type == .pencil || fingerEditing
    }

    private func report(_ touches: Set<UITouch>, _ state: UIGestureRecognizer.State) {
        guard let touch = touches.first(where: isEditingTouch) else { return }
        // `force` is 0 for a finger and for a Pencil held perpendicular, so it
        // is floored rather than used raw: a stroke that does nothing because
        // the pressure read zero is indistinguishable from a broken brush.
        let force = touch.type == .pencil && touch.maximumPossibleForce > 0
            ? max(0.15, touch.force / touch.maximumPossibleForce)
            : 1.0
        onPencil?(state, touch.location(in: self), force)
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        report(touches, .began)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        report(touches, .changed)
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        report(touches, .ended)
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        report(touches, .cancelled)
    }
}

struct SculptView: UIViewRepresentable {
    @ObservedObject var editor: EditorModel

    func makeCoordinator() -> Coordinator { Coordinator(editor: editor) }

    func makeUIView(context: Context) -> SculptMTKView {
        let view = SculptMTKView(frame: .zero, device: MTLCreateSystemDefaultDevice())
        view.isMultipleTouchEnabled = true
        view.preferredFramesPerSecond = 60
        // Redrawn on demand rather than continuously: a sculpting tool is static
        // most of the time, and a 60 Hz idle loop is the easiest battery win
        // available.
        view.enableSetNeedsDisplay = true
        view.isPaused = true

        guard let renderer = Renderer(view: view) else { return view }
        context.coordinator.renderer = renderer
        context.coordinator.view = view
        view.delegate = renderer

        editor.onChange = { [weak view] change in
            guard let renderer = context.coordinator.renderer else { return }
            if change.contains(.mesh) { renderer.upload(editor.document.mesh) }
            if change.contains(.texture) { renderer.upload(albedo: editor.document.albedo) }
            renderer.camera = editor.camera
            view?.setNeedsDisplay()
        }

        // Gestures for navigation; the Pencil path bypasses them entirely.
        let pan = UIPanGestureRecognizer(target: context.coordinator,
                                         action: #selector(Coordinator.handlePan(_:)))
        pan.maximumNumberOfTouches = 2
        pan.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        view.addGestureRecognizer(pan)

        let pinch = UIPinchGestureRecognizer(target: context.coordinator,
                                             action: #selector(Coordinator.handlePinch(_:)))
        pinch.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        view.addGestureRecognizer(pinch)
        pinch.require(toFail: pan)

        let doubleTap = UITapGestureRecognizer(target: context.coordinator,
                                               action: #selector(Coordinator.handleDoubleTap))
        doubleTap.numberOfTapsRequired = 2
        view.addGestureRecognizer(doubleTap)

        view.onPencil = { [weak view] state, location, force in
            guard let view else { return }
            let scale = view.contentScaleFactor
            let point = Vec2(Double(location.x * scale), Double(location.y * scale))
            let viewport = Vec2(Double(view.drawableSize.width), Double(view.drawableSize.height))
            editor.pencil(state: state, at: point, viewport: viewport, force: Double(force))
        }

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

    final class Coordinator {
        let editor: EditorModel
        var renderer: Renderer?
        weak var view: SculptMTKView?
        private var lastTranslation: CGPoint = .zero

        init(editor: EditorModel) { self.editor = editor }

        @objc func handlePan(_ gesture: UIPanGestureRecognizer) {
            guard let view else { return }
            let translation = gesture.translation(in: view)
            if gesture.state == .began { lastTranslation = .zero }
            // Per-frame delta, normalised by view size so the gesture feels the
            // same on every screen.
            let dx = Double(translation.x - lastTranslation.x) / Double(view.bounds.width)
            let dy = Double(translation.y - lastTranslation.y) / Double(view.bounds.height)
            lastTranslation = translation

            if gesture.numberOfTouches >= 2 {
                editor.camera.pan(dx: dx, dy: dy)
            } else {
                editor.camera.orbit(dx: dx, dy: dy)
            }
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
    }
}
