import Foundation

/// The six things a stroke can do.
public enum EditTool: String, CaseIterable, Sendable, Identifiable {
    case grab = "Grab"
    case inflate = "Inflate"
    case deflate = "Deflate"
    case smooth = "Smooth"
    case paint = "Paint"
    case erase = "Erase"

    public var id: String { rawValue }
    public var isPaint: Bool { self == .paint || self == .erase }
    /// Whether Pencil pressure changes what the tool does. Everything but
    /// Grab: a surface held by the Pencil moves with the Pencil, however hard
    /// it is pressed.
    public var followsPressure: Bool { self != .grab }
}

/// One pointer sample, as the touch layer delivered it.
public struct StrokeSample: Sendable, Equatable {
    public enum Phase: Sendable, Equatable { case began, moved, ended, cancelled }
    public var phase: Phase
    /// Drawable pixels, origin at the top left — what `Camera.ray` takes.
    public var location: Vec2
    /// `force / maximumPossibleForce`, or nil for input that reports none (a
    /// finger on an iPad). Raw: the curve lives in `PressureResponse`.
    public var force: Double?
    public var isPencil: Bool
    /// When the sample was taken, on the display's clock (`UITouch.timestamp`).
    public var timestamp: Double

    public init(phase: Phase, location: Vec2, force: Double? = nil, isPencil: Bool = false,
                timestamp: Double = 0) {
        self.phase = phase
        self.location = location
        self.force = force
        self.isPencil = isPencil
        self.timestamp = timestamp
    }
}

/// The brush the person has chosen, in the units they chose it in.
public struct BrushOptions: Sendable {
    public var tool: EditTool
    /// Brush radius in SCREEN POINTS at full pressure — ZBrush's Draw Size and
    /// Nomad's "Screen" mode — converted to metres at the depth it lands on.
    public var radiusPoints: Double
    /// Drawable pixels per point. Every location is in drawable pixels, and
    /// without this a "46 point" brush was 23 points on a 2x iPad.
    public var pointScale: Double
    /// When set, the brush is this many metres on the model instead of a fixed
    /// size on the screen.
    public var fixedWorldRadius: Double?
    /// 0...1: the most a brush does at full pressure. Opacity, for paint.
    public var strength: Double
    public var symmetric: Bool
    /// The rope stabiliser: the brush trails the tip on a rope of about half
    /// its own radius and moves only when the rope is taut.
    public var stabilise: Bool
    public var colour: (r: UInt8, g: UInt8, b: UInt8)
    /// Paint only: the solid fraction of the radius. See `SurfacePaint.Brush`.
    public var hardness: Double
    public var pressure: PressureResponse

    public init(tool: EditTool = .grab, radiusPoints: Double = 80, pointScale: Double = 1,
                fixedWorldRadius: Double? = nil, strength: Double = 1, symmetric: Bool = true,
                stabilise: Bool = false, colour: (r: UInt8, g: UInt8, b: UInt8) = (41, 89, 161),
                hardness: Double = 0.5, pressure: PressureResponse = PressureResponse()) {
        self.tool = tool
        self.radiusPoints = radiusPoints
        self.pointScale = pointScale
        self.fixedWorldRadius = fixedWorldRadius
        self.strength = strength
        self.symmetric = symmetric
        self.stabilise = stabilise
        self.colour = colour
        self.hardness = hardness
        self.pressure = pressure
    }

    /// The full-pressure radius in metres for a brush landing at `depth`, a
    /// VIEW depth (`Camera.viewDepth(of:)`), so the brush is the same size on
    /// the screen wherever it lands.
    public func fullRadius(atViewDepth depth: Double, camera: Camera, viewport: Vec2) -> Double {
        if let fixedWorldRadius { return max(0.0005, fixedWorldRadius) }
        let metres = radiusPoints * pointScale
            * camera.metresPerPixel(depth: depth, viewportHeight: viewport.y)
        return max(0.0005, metres)
    }
}

/// Everything that happens between a touch-down and a touch-up, as a pure
/// function of the samples, the camera and the document.
///
/// ## Why this is in the core
///
/// It used to be `EditorModel`, in the app, where nothing on Linux could reach
/// it — and every defect the device runs kept finding in the stroke logic was
/// there: paint built its brush once, from the lightest sample of the stroke; a
/// Grab measured depth along the ray and moved faster than the Pencil toward
/// the edges of the screen, and scaled its pull by the touch-down pressure; a
/// stroke that left the model joined its two ends through the air. Here each
/// of those is a test that drives the same code the iPad runs, with synthetic
/// Pencil samples, and fails on the old behaviour.
///
/// The editor keeps what is genuinely the app's: the queue, the clock, the
/// renderer and the UI. It hands a frame's samples to `apply` and pushes
/// whatever `Effect` comes back to the GPU.
public struct StrokeEngine {
    /// What a call changed, so the caller uploads only that.
    public struct Effect: OptionSet, Sendable {
        public let rawValue: Int
        public init(rawValue: Int) { self.rawValue = rawValue }
        public static let mesh = Effect(rawValue: 1 << 0)
        public static let texture = Effect(rawValue: 1 << 1)
        /// The brush's place on the surface moved.
        public static let contact = Effect(rawValue: 1 << 2)
        /// A paint stroke arrived before the paint map was built; it will arm
        /// on a later sample once the map lands. The editor says so.
        public static let paintNotReady = Effect(rawValue: 1 << 3)
    }

    /// Where the brush is on the surface: what the ring is drawn from.
    public struct Contact: Sendable, Equatable {
        public var position: Vec3
        public var normal: Vec3
        /// The radius the brush is actually using, pressure included.
        public var radius: Double
        /// The radius at full and at the lightest pressure. The ring shows the
        /// range the Pencil can reach, not just where it is now.
        public var fullRadius: Double
        public var lightestRadius: Double
    }

    /// The last stroke, for the readout: the three ways a stroke can look
    /// broken — it never found the model, it ran and moved nothing, or it
    /// painted nothing — are three different numbers here.
    public struct Summary: Sendable, Equatable {
        public var samples = 0
        public var dabs = 0
        public var texels = 0
        public var skipped = 0
        public var lifted = 0
        public var armed = false
        public var tool: EditTool = .grab
        public var peakPressure = 0.0
        /// Taken back rather than kept: a palm, or a two-finger tap's first
        /// finger. See `discard(_:)`.
        public var discarded = false
    }

    public private(set) var isOpen = false
    public private(set) var isArmed = false
    /// The tool of the open stroke, fixed at touch-down. A Pencil double tap
    /// mid-stroke changes the NEXT stroke; it does not turn a sculpt into a
    /// paint half way along.
    public private(set) var tool: EditTool = .grab
    public private(set) var contact: Contact?
    /// 0...1, the open stroke's pressure after the curve and the filter.
    public private(set) var pressure: Double = 1
    public private(set) var current = Summary()
    public private(set) var last = Summary()
    /// Raycasts made since `resetFrameCounters`.
    public private(set) var picksThisFrame = 0
    /// Dabs and paint steps applied by the last `apply`.
    public private(set) var stepsThisFrame = 0

    /// Below this much drawable-pixel travel a sample is folded into the next
    /// one instead of earning its own raycast. Two pixels is one point on a 2x
    /// panel: under the width of the line being drawn. The travel accumulates,
    /// so the path is unchanged; only the wasted raycasts go.
    public static let pickSlopPixels: Double = 2

    private var sculptStroke: Sculpt.Stroke?
    private var lastPointer: Vec2?
    private var ropeAnchor: Vec2?
    private var filter = PressureFilter()
    private var grabActive = false
    private var grabAnchor: Vec3 = .zero
    private var grabTotal: Vec3 = .zero
    private var grabDirty = false
    private var grabNormal: Vec3 = Vec3(0, 0, 1)
    private var grabRadius: Double = 0
    /// The shape the open sculpt stroke started from. Dabs are placed on it
    /// and measured against it, never against the surface they are raising;
    /// see `Sculpt.apply(_:to:tables:reference:)`. A copy of the struct, so
    /// it costs one copy-on-write of the positions when the first dab lands.
    private var reference: MeshData?
    private var pendingDabs: [Sculpt.Dab] = []
    private var pendingPaint: [(point: Vec3, seed: Int, brush: SurfacePaint.Brush,
                                mirror: (point: Vec3, seed: Int)?)] = []
    private var paintDirty = Paint.Rect.empty

    public init() {
        pendingDabs.reserveCapacity(64)
        pendingPaint.reserveCapacity(64)
    }

    public mutating func resetFrameCounters() { picksThisFrame = 0 }

    /// The rectangle of albedo painted since it was last taken, for a partial
    /// texture upload.
    public mutating func takePaintDirty() -> Paint.Rect {
        defer { paintDirty = .empty }
        return paintDirty
    }

    /// Where the open Grab's handle is: the grabbed point, moved with the
    /// Pencil. It stays exactly under the tip, which is the property a test
    /// holds it to.
    public var grabHandle: Vec3? { grabActive ? grabAnchor + grabTotal : nil }

    // MARK: - Driving it

    /// Applies a frame's samples, in order, and commits what they did.
    @discardableResult
    public mutating func apply(_ samples: [StrokeSample], to document: inout Document,
                               camera: Camera, viewport: Vec2,
                               options: BrushOptions) -> Effect {
        var effect = Effect()
        stepsThisFrame = 0
        guard viewport.x > 0, viewport.y > 0 else { return effect }
        for sample in samples {
            switch sample.phase {
            case .began:
                effect.formUnion(begin(document: &document, options: options))
                feedPressure(sample, options: options)
                lastPointer = sample.location
                ropeAnchor = sample.location
                effect.formUnion(arm(at: sample.location, document: &document, camera: camera,
                                     viewport: viewport, options: options))

            case .moved:
                if !isOpen {
                    // A move with no touch-down: the began was lost. Treat the
                    // first move as the start rather than dropping the stroke.
                    effect.formUnion(begin(document: &document, options: options))
                    lastPointer = sample.location
                    ropeAnchor = sample.location
                }
                feedPressure(sample, options: options)
                current.samples += 1
                let point = stabilised(sample.location, options: options)
                guard isArmed else {
                    // Not on the model yet. Try again with this sample rather
                    // than writing the whole gesture off.
                    effect.formUnion(arm(at: point, document: &document, camera: camera,
                                         viewport: viewport, options: options))
                    lastPointer = point
                    continue
                }
                if tool == .grab {
                    effect.formUnion(dragGrab(to: point, camera: camera, viewport: viewport))
                    continue
                }
                if let last = lastPointer, length(point - last) < StrokeEngine.pickSlopPixels {
                    current.skipped += 1
                    continue
                }
                let previous = lastPointer ?? point
                lastPointer = point
                guard let hit = pick(point, on: reference ?? document.mesh, camera: camera,
                                     viewport: viewport) else {
                    effect.formUnion(lift(document: &document))
                    continue
                }
                let depth = camera.viewDepth(of: hit.position)
                let (radius, full, lightest) = radii(atViewDepth: depth, camera: camera,
                                                     viewport: viewport, options: options)
                contact = Contact(position: hit.position, normal: hit.normal(in: document.mesh),
                                  radius: radius, fullRadius: full, lightestRadius: lightest)
                effect.insert(.contact)

                if tool.isPaint {
                    queuePaint(hit, radius: radius, document: document, options: options)
                } else {
                    // Advanced by POINTER travel, not by how far the surface
                    // moved: Inflate pushes the surface out from under itself,
                    // and a stroke that measured that would partly be measuring
                    // its own output.
                    let travelled = length(point - previous)
                        * camera.metresPerPixel(depth: depth, viewportHeight: viewport.y)
                    let settings = sculptSettings(radius: radius, options: options)
                    if sculptStroke == nil {
                        // Back on the model after leaving it: a new segment,
                        // starting here, rather than dabs strung through the air
                        // between where it left and where it came back.
                        sculptStroke = Sculpt.Stroke(settings: settings)
                        queueDabs(sculptStroke!.advance(to: hit.position), settings: settings)
                    } else {
                        sculptStroke!.settings = settings
                        queueDabs(sculptStroke!.advance(to: hit.position, by: travelled),
                                  settings: settings)
                    }
                }

            case .ended, .cancelled:
                // Flush whatever this frame collected before closing, or the
                // last few millimetres of every stroke are dropped.
                effect.formUnion(commit(document: &document))
                end(document: &document)
                effect.insert(.contact)
            }
        }
        effect.formUnion(commit(document: &document))
        // A sculpt stroke places its dabs on the shape it started from, but
        // the ring belongs on the surface the person can SEE — on top of the
        // bump the stroke is raising, not buried under it. One raycast a
        // frame, after this frame's dabs have landed.
        if isOpen, isArmed, reference != nil, effect.contains(.mesh), let point = lastPointer,
           let hit = pick(point, on: document.mesh, camera: camera, viewport: viewport) {
            contact?.position = hit.position
            contact?.normal = hit.normal(in: document.mesh)
        }
        return effect
    }

    /// Closes the open stroke as if the Pencil had lifted. For a stroke whose
    /// end never arrived; see `EditorModel`'s watchdog.
    @discardableResult
    public mutating func close(_ document: inout Document) -> Effect {
        guard isOpen else { return [] }
        var effect = commit(document: &document)
        end(document: &document)
        effect.insert(.contact)
        return effect
    }

    /// Ends the open stroke and takes back everything it did, without making
    /// it an undo step: the gesture turned out not to be a stroke.
    ///
    /// Two gestures need this. The heel of a hand reaches the glass a moment
    /// before the Pencil tip, and until a Pencil has been seen a finger on the
    /// model sculpts, so the palm has already started a stroke when the
    /// Pencil lands. And the first finger of a two-finger tap lands a moment
    /// before the second: the tap means undo, not "inflate a bump here, then
    /// undo". Closing such a stroke and undoing it is wrong twice over. It
    /// would sit on the redo stack, and when it changed nothing at all,
    /// `undo()` would take back the stroke before it instead.
    @discardableResult
    public mutating func discard(_ document: inout Document) -> Effect {
        guard isOpen else { return [] }
        pendingDabs.removeAll(keepingCapacity: true)
        pendingPaint.removeAll(keepingCapacity: true)
        grabDirty = false
        let undone = document.discardStroke()
        current.discarded = true
        end(document: &document)
        var effect: Effect = .contact
        if undone.mesh { effect.insert(.mesh) }
        if !undone.texture.isEmpty {
            paintDirty = paintDirty.union(undone.texture)
            effect.insert(.texture)
        }
        return effect
    }

    /// Where the brush would land under a screen point, at the open stroke's
    /// pressure (full pressure when none is open). For the hover ring and for
    /// the ring drawn at a predicted touch; it never touches the document.
    public func contact(at point: Vec2, document: Document, camera: Camera, viewport: Vec2,
                        options: BrushOptions) -> Contact? {
        guard viewport.x > 0, viewport.y > 0,
              let hit = camera.pick(document.mesh, at: point, viewport: viewport) else { return nil }
        let depth = camera.viewDepth(of: hit.position)
        let full = options.fullRadius(atViewDepth: depth, camera: camera, viewport: viewport)
        let followsPressure = (isOpen ? tool : options.tool).followsPressure
        let lightest = followsPressure ? full * options.pressure.sizeScale(level: 0) : full
        let now = followsPressure && isOpen ? full * options.pressure.sizeScale(level: pressure) : full
        return Contact(position: hit.position, normal: hit.normal(in: document.mesh),
                       radius: now, fullRadius: full, lightestRadius: lightest)
    }

    // MARK: - Stroke lifetime

    private mutating func begin(document: inout Document, options: BrushOptions) -> Effect {
        // A new touch-down means the previous gesture is over, whatever became
        // of its end. The old `guard !strokeOpen else { return }` here is the
        // best explanation for "the pencil wasn't working, then did": one
        // stroke whose end never arrived blocked every stroke after it.
        var effect = Effect()
        if isOpen {
            effect.formUnion(commit(document: &document))
            end(document: &document)
        }
        isOpen = true
        isArmed = false
        tool = options.tool
        current = Summary()
        current.tool = tool
        filter.reset()
        pressure = 1
        grabActive = false
        grabDirty = false
        grabTotal = .zero
        sculptStroke = nil
        reference = nil
        contact = nil
        document.beginStroke()
        return effect
    }

    private mutating func end(document: inout Document) {
        guard isOpen else { return }
        isOpen = false
        current.armed = isArmed
        last = current
        isArmed = false
        grabActive = false
        grabDirty = false
        grabTotal = .zero
        sculptStroke = nil
        reference = nil
        lastPointer = nil
        ropeAnchor = nil
        contact = nil
        document.endPaintStroke()
        // Also closes any captured Grab: a gesture's vertex set must not
        // outlive the gesture.
        document.endStroke()
    }

    /// Finds the surface and sets the stroke up on it. Safe to call again on a
    /// later sample: a stroke that began off the model arms on the first
    /// sample that lands on it.
    private mutating func arm(at point: Vec2, document: inout Document, camera: Camera,
                              viewport: Vec2, options: BrushOptions) -> Effect {
        guard !isArmed,
              let hit = pick(point, document: document, camera: camera, viewport: viewport)
        else { return [] }
        let depth = camera.viewDepth(of: hit.position)
        let (radius, full, lightest) = radii(atViewDepth: depth, camera: camera,
                                             viewport: viewport, options: options)
        let normal = hit.normal(in: document.mesh)

        switch tool {
        case .paint, .erase:
            // Never build the paint map from here: on the device that measured
            // 2,919 ms on the main thread, in the middle of a touch. The stroke
            // stays unarmed and arms on the first sample after the map lands.
            guard document.isPreparedForPainting else { return .paintNotReady }
            document.beginPaintStroke(paintBrush(radius: radius, options: options))
            queuePaint(hit, radius: radius, document: document, options: options)
        case .grab:
            // Full size and the strength slider, never the pressure: the first
            // sample of a Pencil stroke is its lightest, and weights captured
            // from it made the surface trail the Pencil at a third of its
            // speed for the whole drag.
            grabRadius = full
            grabAnchor = hit.position
            grabNormal = normal
            grabTotal = .zero
            grabDirty = false
            grabActive = document.beginGrab(
                at: hit.position,
                settings: .init(radius: full, strength: options.strength,
                                symmetric: options.symmetric))
            guard grabActive else { return [] }
            contact = Contact(position: hit.position, normal: normal, radius: full,
                              fullRadius: full, lightestRadius: full)
            isArmed = true
            return .contact
        case .inflate, .deflate, .smooth:
            reference = document.mesh
            let settings = sculptSettings(radius: radius, options: options)
            sculptStroke = Sculpt.Stroke(settings: settings)
            queueDabs(sculptStroke!.advance(to: hit.position), settings: settings)
        }
        contact = Contact(position: hit.position, normal: normal, radius: radius,
                          fullRadius: full, lightestRadius: lightest)
        isArmed = true
        return .contact
    }

    /// The pointer left the model. The next sample that finds it again starts
    /// a new segment instead of joining this one through the air.
    ///
    /// Returns what it painted, which has to reach the GPU like any other
    /// paint. It used to be thrown away, so whenever the last sample on the
    /// model and the first one off it fell into the same frame, the dab at
    /// the model's edge stayed invisible until something else uploaded the
    /// texture.
    private mutating func lift(document: inout Document) -> Effect {
        current.lifted += 1
        sculptStroke = nil
        // Paint queued earlier this frame is applied before the lift, or it
        // would be painted as part of the new segment.
        let effect = commitPaint(document: &document)
        document.liftPaint()
        return effect
    }

    // MARK: - Grab

    private mutating func dragGrab(to point: Vec2, camera: Camera, viewport: Vec2) -> Effect {
        guard grabActive, let last = lastPointer else {
            lastPointer = point
            return []
        }
        lastPointer = point
        let screenDelta = point - last
        guard screenDelta != .zero else { return [] }
        // At the VIEW depth of the handle, which is what makes it exact: the
        // plane at a fixed view depth maps onto the screen linearly, so the
        // handle lands precisely under the tip wherever on the screen it is.
        // The ray length the editor used to pass is longer by 1/cos of the
        // angle off-axis, and the surface outran the Pencil toward the edges.
        let handle = grabAnchor + grabTotal
        let world = camera.worldDelta(screenDelta: screenDelta, viewport: viewport,
                                      depth: camera.viewDepth(of: handle))
        guard length(world) > 0 else { return [] }
        grabTotal += world
        grabDirty = true
        // The ring rides with the surface it is dragging.
        contact = Contact(position: handle + world, normal: grabNormal, radius: grabRadius,
                          fullRadius: grabRadius, lightestRadius: grabRadius)
        return .contact
    }

    // MARK: - Brushes

    /// The pressure level every brush but Grab scales by: the person's curve,
    /// filtered because the raw reading ripples, started fresh at each
    /// touch-down. A finger reports none and counts as a full press.
    private mutating func feedPressure(_ sample: StrokeSample, options: BrushOptions) {
        pressure = filter.feed(options.pressure.level(forNormalisedForce: sample.force))
        current.peakPressure = max(current.peakPressure, pressure)
    }

    private func radii(atViewDepth depth: Double, camera: Camera, viewport: Vec2,
                       options: BrushOptions) -> (Double, Double, Double) {
        let full = options.fullRadius(atViewDepth: depth, camera: camera, viewport: viewport)
        guard tool.followsPressure else { return (full, full, full) }
        return (full * options.pressure.sizeScale(level: pressure), full,
                full * options.pressure.sizeScale(level: 0))
    }

    private func sculptSettings(radius: Double, options: BrushOptions) -> Sculpt.Settings {
        .init(radius: radius,
              strength: options.strength * options.pressure.strengthScale(level: pressure),
              symmetric: options.symmetric)
    }

    private func paintBrush(radius: Double, options: BrushOptions) -> SurfacePaint.Brush {
        .init(radius: radius,
              opacity: min(1, options.strength * options.pressure.strengthScale(level: pressure)),
              colour: options.colour, erasing: tool == .erase, hardness: options.hardness)
    }

    private mutating func queueDabs(_ centres: [Vec3], settings: Sculpt.Settings) {
        guard !centres.isEmpty else { return }
        let brush: Sculpt.Brush
        switch tool {
        case .inflate: brush = .inflate(Sculpt.inflatePerDabDriven * settings.radius)
        case .deflate: brush = .inflate(-Sculpt.inflatePerDabDriven * settings.radius)
        case .smooth: brush = .smooth
        case .grab, .paint, .erase: return
        }
        for centre in centres { pendingDabs.append(Sculpt.Dab(brush, at: centre, settings: settings)) }
    }

    private mutating func queuePaint(_ hit: Picking.Hit, radius: Double, document: Document,
                                     options: BrushOptions) {
        let mirror = options.symmetric ? document.mirror(of: hit.position, triangle: hit.triangle) : nil
        pendingPaint.append((hit.position, hit.triangle, paintBrush(radius: radius, options: options),
                             mirror))
    }

    // MARK: - Committing

    private mutating func commit(document: inout Document) -> Effect {
        var effect = Effect()
        if grabActive, grabDirty {
            document.grab(to: grabTotal)
            grabDirty = false
            stepsThisFrame += 1
            effect.insert(.mesh)
        }
        if !pendingDabs.isEmpty {
            document.sculpt(pendingDabs, reference: reference)
            current.dabs += pendingDabs.count
            stepsThisFrame += pendingDabs.count
            pendingDabs.removeAll(keepingCapacity: true)
            effect.insert(.mesh)
        }
        effect.formUnion(commitPaint(document: &document))
        return effect
    }

    private mutating func commitPaint(document: inout Document) -> Effect {
        guard !pendingPaint.isEmpty else { return [] }
        for step in pendingPaint {
            let touched = document.paint(to: step.point, seed: step.seed, brush: step.brush,
                                         mirror: step.mirror)
            if !touched.isEmpty {
                current.texels += (touched.maxX - touched.minX + 1) * (touched.maxY - touched.minY + 1)
            }
            paintDirty = paintDirty.union(touched)
        }
        current.dabs += pendingPaint.count
        stepsThisFrame += pendingPaint.count
        pendingPaint.removeAll(keepingCapacity: true)
        return .texture
    }

    // MARK: - Input shaping

    private mutating func pick(_ point: Vec2, document: Document, camera: Camera,
                               viewport: Vec2) -> Picking.Hit? {
        pick(point, on: document.mesh, camera: camera, viewport: viewport)
    }

    private mutating func pick(_ point: Vec2, on mesh: MeshData, camera: Camera,
                               viewport: Vec2) -> Picking.Hit? {
        picksThisFrame += 1
        return camera.pick(mesh, at: point, viewport: viewport)
    }

    /// The rope: the brush is dragged behind the tip and only moves when the
    /// rope pulls taut, so tremor inside the rope length is absorbed with no lag
    /// on deliberate motion. ZBrush calls it Lazy Mouse, Nomad a Lazy Rope.
    private mutating func stabilised(_ point: Vec2, options: BrushOptions) -> Vec2 {
        guard options.stabilise, let anchor = ropeAnchor else {
            ropeAnchor = point
            return point
        }
        let rope = options.radiusPoints * options.pointScale * 0.6
        let delta = point - anchor
        let distance = length(delta)
        guard distance > rope else { return anchor }
        let moved = anchor + delta * ((distance - rope) / distance)
        ropeAnchor = moved
        return moved
    }
}

extension Picking.Hit {
    /// The surface normal at the hit, interpolated from the vertex normals.
    public func normal(in mesh: MeshData) -> Vec3 {
        let t = triangle * 3
        let a = mesh.normals[Int(mesh.indices[t])]
        let b = mesh.normals[Int(mesh.indices[t + 1])]
        let c = mesh.normals[Int(mesh.indices[t + 2])]
        return normalize(a * barycentric.x + b * barycentric.y + c * barycentric.z)
    }
}
