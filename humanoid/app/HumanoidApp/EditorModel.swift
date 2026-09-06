import Foundation
import SwiftUI
import UIKit
import HumanoidCore

/// The editor's state: a document, a camera, a tool, and the stroke in progress.
///
/// This is the only place in the app that decides anything. It owns the rule
/// that a stroke is one gesture — touch down to touch up is one undo step,
/// because that is what a person means by "the last thing I did".
@MainActor
final class EditorModel: ObservableObject {
    struct Change: OptionSet {
        let rawValue: Int
        static let mesh = Change(rawValue: 1 << 0)
        static let texture = Change(rawValue: 1 << 1)
        static let camera = Change(rawValue: 1 << 2)
        static let all: Change = [.mesh, .texture, .camera]
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

    @Published private(set) var document: Document
    @Published var camera = Camera()
    @Published var tool: Tool = .grab
    @Published var radius: Double = 0.03
    @Published var strength: Double = 0.5
    @Published var symmetric = true
    @Published var fingerEditing = false
    @Published var colour = Color(red: 0.16, green: 0.35, blue: 0.63)
    @Published private(set) var canUndo = false
    @Published private(set) var canRedo = false
    @Published var status: String?

    /// Set by the viewport so a change can be pushed straight to the renderer
    /// without SwiftUI diffing a mesh.
    var onChange: ((Change) -> Void)?

    // In-flight stroke. Accumulated rather than applied per event: one gesture
    // has to be one undo step.
    private var strokePoints: [Vec3] = []
    private var strokeUVs: [Vec2] = []
    private var lastScreenPoint: Vec2?
    private var grabDepth: Double = 0

    init(document: Document) {
        self.document = document
        camera.frame(document.mesh)
        radius = max(0.01, camera.distance * 0.08)
    }

    convenience init() {
        // A failure here means the app shipped without its template, which is a
        // build mistake, not a runtime condition to recover from.
        self.init(document: try! Document.clay())
    }

    // MARK: - Camera

    func cameraMoved() { onChange?(.camera) }

    func frameModel() {
        camera.frame(document.mesh)
        onChange?(.camera)
    }

    // MARK: - Strokes

    func pencil(state: UIGestureRecognizer.State, at point: Vec2, viewport: Vec2, force: Double) {
        switch state {
        case .began:
            strokePoints.removeAll(keepingCapacity: true)
            strokeUVs.removeAll(keepingCapacity: true)
            lastScreenPoint = point
            // Everything until touch-up is one undo step.
            document.beginStroke()
            strokeOpen = true
            guard let hit = camera.pick(document.mesh, at: point, viewport: viewport) else { return }
            grabDepth = hit.distance
            accumulate(hit: hit, point: point, viewport: viewport, force: force)

        case .changed:
            guard let hit = camera.pick(document.mesh, at: point, viewport: viewport) else {
                // Dragging off the model does not end the stroke: on a curved
                // surface the ray misses constantly at grazing angles, and
                // ending there would chop one gesture into a dozen undo steps.
                lastScreenPoint = point
                return
            }
            accumulate(hit: hit, point: point, viewport: viewport, force: force)

        case .ended, .cancelled, .failed:
            commit()

        default:
            break
        }
    }

    private func accumulate(hit: Picking.Hit, point: Vec2, viewport: Vec2, force: Double) {
        if tool.isPaint {
            strokeUVs.append(hit.uv)
        } else if tool == .grab {
            // Grab follows the finger across the screen, so the delta is a
            // screen-space displacement converted at the hit's depth. Using a
            // fixed world step instead makes the model slide out from under the
            // Pencil at any zoom but one.
            guard let last = lastScreenPoint else { return }
            let screenDelta = Vec2(point.x - last.x, point.y - last.y)
            let world = camera.worldDelta(screenDelta: screenDelta, viewport: viewport,
                                          depth: grabDepth)
            applyGrab(delta: world * force, at: hit.position)
        } else {
            strokePoints.append(hit.position)
        }
        lastScreenPoint = point
        strokeForce = force
    }

    private var strokeForce: Double = 1

    /// Grab is applied live rather than at the end, because it has to track the
    /// Pencil. It is still one undo step: `Document.beginStroke` was opened on
    /// touch-down and merges every increment into one record.
    private func applyGrab(delta: Vec3, at position: Vec3) {
        guard length(delta) > 0 else { return }
        document.sculpt(.grab(delta), at: [position],
                        settings: .init(radius: radius, strength: strength, symmetric: symmetric))
        refresh(.mesh)
    }

    private var strokeOpen = false

    private func commit() {
        defer {
            if strokeOpen {
                document.endStroke()
                strokeOpen = false
            }
            strokePoints.removeAll(keepingCapacity: true)
            strokeUVs.removeAll(keepingCapacity: true)
            lastScreenPoint = nil
        }

        if tool.isPaint, !strokeUVs.isEmpty {
            let rgb = colour.rgb8
            document.paint(.init(radius: radius * 0.6, opacity: 0.85 * strokeForce,
                                 colour: rgb, erasing: tool == .erase),
                           along: strokeUVs)
            refresh(.texture)
        } else if !strokePoints.isEmpty {
            let brush: Sculpt.Brush
            switch tool {
            case .inflate: brush = .inflate(radius * 0.35)
            case .deflate: brush = .inflate(-radius * 0.35)
            case .smooth: brush = .smooth
            default: return
            }
            document.sculpt(brush, at: strokePoints,
                            settings: .init(radius: radius,
                                            strength: strength * strokeForce,
                                            symmetric: symmetric))
            refresh(.mesh)
        } else {
            refresh([])
        }
    }

    // MARK: - Commands

    func undo() { document.undo(); refresh(.all) }
    func redo() { document.redo(); refresh(.all) }

    func fill() {
        document.fill(colour.rgb8)
        refresh(.texture)
    }

    func export(named name: String) -> Gate.Report {
        let report = document.validate()
        status = report.passes ? "Pre-flight passed" : "Pre-flight found problems"
        return report
    }

    private func refresh(_ change: Change) {
        canUndo = document.canUndo
        canRedo = document.canRedo
        if !change.isEmpty { onChange?(change) }
        objectWillChange.send()
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
