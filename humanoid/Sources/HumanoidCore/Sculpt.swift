import Foundation

/// The three brushes, as pure functions over a mesh.
///
/// No Metal, no Pencil, no view. A stroke is a sequence of `apply` calls with a
/// world-space centre, which is what the touch layer will produce once it
/// exists, and what the tests produce today. Keeping the engine free of the
/// input and rendering layers is what lets the feel be tuned and regression-
/// tested on a build box.
///
/// Every brush obeys the same two invariants, and both are asserted in tests
/// rather than assumed:
///
/// - **Topology never changes.** Counts, indices, UVs and skin weights come out
///   exactly as they went in. Only positions move, and afterwards the normals
///   that describe them.
/// - **Welded positions move together.** A UV seam stores one point as two or
///   three vertices; moving one and not the others opens a crack that is
///   invisible until the model turns. Brushes address welded positions and
///   write through to every member.
public enum Sculpt {
    public enum Brush: Sendable, Equatable {
        /// Drag the surface bodily. The delta is world-space.
        case grab(Vec3)
        /// Push along the surface normal. Negative deflates.
        case inflate(Double)
        /// Move each point toward the average of its neighbours.
        case smooth
    }

    public struct Settings: Sendable {
        /// World-space brush radius in metres.
        public var radius: Double
        /// 0...1. Scales the whole effect; Pencil pressure multiplies into this.
        public var strength: Double
        /// Mirror every stroke across x = 0.
        public var symmetric: Bool

        public init(radius: Double = 0.03, strength: Double = 0.5, symmetric: Bool = true) {
            self.radius = radius
            self.strength = strength
            self.symmetric = symmetric
        }
    }

    /// A sculpt stroke in progress, resampled to a fixed spacing.
    ///
    /// The same design as `Paint.Stroke` and for the same reason. A Pencil
    /// delivers samples at whatever rate the hardware and the runloop agree on —
    /// up to 240 Hz — so one dab per delivered sample makes the result depend on
    /// how busy the device was: a slow stroke stacks a hundred dabs in one spot
    /// and extrudes a spike, a fast one leaves a dotted line. Resampling by
    /// distance makes the dabs a function of the **path** and nothing else,
    /// which is the property that fifty events and two events over the same path
    /// must produce the same mesh.
    ///
    /// A consequence worth stating because it is a design choice, not a bug: a
    /// Pencil held still emits no dabs. That is what every sculpting tool does
    /// with spacing-based strokes, and it is the half of the fix that stops the
    /// surface running away under a stationary pen.
    ///
    /// The leftover distance carries across calls. Resampling each delivered
    /// segment on its own still stamps both of its endpoints, so a path chopped
    /// into fifty segments double-stamps forty-nine times.
    public struct Stroke: Sendable {
        public var settings: Settings
        /// Dab spacing as a fraction of the brush radius. A quarter is the usual
        /// choice: closer re-blends the same vertices for nothing, wider leaves
        /// visible scalloping along the stroke.
        public var spacing: Double

        private var previous: Vec3?
        /// Arc length walked since the stroke began, and how many dabs that has
        /// paid for. Dab *n* sits at arc length `n * step`.
        ///
        /// Kept as a running total rather than as a per-segment leftover on
        /// purpose. A leftover has to be carried forward and re-subtracted at
        /// every segment, so its rounding error compounds with the number of
        /// events — and then a path whose length happens to be a whole number of
        /// steps emits a different dab count depending on how it was chopped up,
        /// which is exactly the invariance this type exists to provide.
        private var travelled: Double = 0
        private var emitted: Int = 0

        public init(settings: Settings, spacing: Double = 0.25) {
            self.settings = settings
            self.spacing = spacing
        }

        private var step: Double { max(settings.radius * spacing, 1e-9) }

        /// Whether any sample has been taken yet.
        public var hasStarted: Bool { previous != nil }

        /// Extends the stroke to a new point and returns the dab centres that
        /// fall between the previous point and this one. The first call returns
        /// a single dab where the stroke starts.
        ///
        /// `input` is how far the **pointer** moved since the last sample, and
        /// defaults to how far the surface point moved. The editor passes it
        /// explicitly: the Pencil's screen travel converted to metres at the hit
        /// depth.
        ///
        /// The reason is a feedback loop rather than an observed runaway, and
        /// the distinction is worth keeping straight. Left to the default,
        /// Inflate partly measures its own output — the brush pushes the surface
        /// out, the next ray hits it further out, and the stroke counts that as
        /// travel. The loop gain is `inflatePerDab / spacing`, today 0.04 / 0.25
        /// = 0.16, so it converges: a held Pencil places one dab and then stalls
        /// (no dab, no motion, no travel), and a moving one over-dabs by about a
        /// fifth. At a gain of 1 it would not converge, and that gain is two
        /// tuning constants away.
        ///
        /// Progress is a property of the gesture. The surface is what the
        /// gesture acts on, not what measures it.
        public mutating func advance(to point: Vec3, by input: Double? = nil) -> [Vec3] {
            guard let start = previous else {
                previous = point
                travelled = 0
                emitted = 1
                return [point]
            }
            let delta = point - start
            let distance = input ?? length(delta)
            guard distance > 0 else {
                // The pointer did not move, so the stroke did not advance — but
                // the surface may have, and the next dab belongs at its new
                // position rather than at the stale one.
                previous = point
                return []
            }

            // Ties go to emitting. A dab landing exactly on the end of a segment
            // is decided by the last bit of a floating-point sum, so without a
            // tolerance the same path emits 16 dabs delivered as two events and
            // 17 delivered as fifty.
            let end = travelled + distance
            let tolerance = step * 1e-9
            var centres = [Vec3]()
            while Double(emitted) * step <= end + tolerance {
                // `along` is a fraction of the pointer's travel, applied to the
                // surface delta: the dab lands on the surface, spaced by input.
                let along = (Double(emitted) * step - travelled) / distance
                centres.append(start + delta * min(1, max(0, along)))
                emitted += 1
            }
            travelled = end
            previous = point
            return centres
        }
    }

    /// Smoothstep, so the brush edge has no visible ring.
    ///
    /// A linear falloff leaves a first-derivative discontinuity at the rim that
    /// reads as a hard circle after two or three overlapping dabs — the classic
    /// "I can see where I clicked" artefact. Smoothstep is zero-slope at both
    /// ends and costs one extra multiply.
    @inlinable
    public static func falloff(distance: Double, radius: Double) -> Double {
        guard radius > 0 else { return 0 }
        let t = 1.0 - min(1.0, distance / radius)
        return t * t * (3.0 - 2.0 * t)
    }

    /// How far one dab of Inflate moves the surface, as a fraction of the brush
    /// radius, before falloff and strength.
    ///
    /// This is small because a stroke is now resampled to a dab every quarter
    /// radius, so a point on the path receives roughly eight overlapping dabs.
    /// The first version of this shipped at 0.35 — a per-*gesture* amount — and
    /// then applied one dab per Pencil event at pen-up, so a slow one-second
    /// stroke stacked over a hundred of them in one place and extruded the
    /// surface through itself. The folded triangles are back-face culled, which
    /// is what "sometimes it goes inside out" was.
    public static let inflatePerDab = 0.04

    /// Applies a whole run of dabs and rebuilds the normals once.
    ///
    /// Preferred over the single-dab form for a stroke: the normal pass is
    /// incremental but not free, and a frame's worth of resampled dabs should
    /// pay for it once rather than per dab. Inflate therefore pushes along the
    /// normals as they were at the start of the batch, which is steadier than
    /// re-deriving them mid-stroke, not a compromise.
    @discardableResult
    public static func apply(_ brush: Brush, to mesh: inout MeshData, tables: MeshTables,
                             at centres: [Vec3], settings: Settings) -> Set<Int> {
        var touched = Set<Int>()
        for centre in centres {
            touched.formUnion(dabPair(brush, to: &mesh, tables: tables,
                                      at: centre, settings: settings))
        }
        mesh.recomputeNormals(tables, touching: touched)
        return touched
    }

    /// Applies one dab. Returns the welded positions it touched, which is what
    /// an incremental GPU buffer update and a bounded undo record both need.
    @discardableResult
    public static func apply(_ brush: Brush, to mesh: inout MeshData, tables: MeshTables,
                             at centre: Vec3, settings: Settings) -> Set<Int> {
        let touched = dabPair(brush, to: &mesh, tables: tables, at: centre, settings: settings)
        mesh.recomputeNormals(tables, touching: touched)
        return touched
    }

    /// One dab and, if symmetry is on, its mirror. No normal rebuild.
    private static func dabPair(_ brush: Brush, to mesh: inout MeshData, tables: MeshTables,
                                at centre: Vec3, settings: Settings) -> Set<Int> {
        var touched = dab(brush, to: &mesh, tables: tables, at: centre, settings: settings)
        if settings.symmetric {
            // The mirrored dab is the mirror of the whole operation, not just of
            // its centre: a Grab pulling +X on the left must pull -X on the
            // right, or a symmetric stroke shears the model instead of widening
            // it. Inflate and Smooth are direction-free and mirror as they are.
            let mirroredBrush: Brush
            switch brush {
            case .grab(let d): mirroredBrush = .grab(Vec3(-d.x, d.y, d.z))
            case .inflate, .smooth: mirroredBrush = brush
            }
            touched.formUnion(dab(mirroredBrush, to: &mesh, tables: tables,
                                  at: Vec3(-centre.x, centre.y, centre.z),
                                  settings: settings))
        }
        return touched
    }

    private static func dab(_ brush: Brush, to mesh: inout MeshData, tables: MeshTables,
                            at centre: Vec3, settings: Settings) -> Set<Int> {
        guard settings.radius > 0, settings.strength != 0 else { return [] }

        // Every brush reads the mesh as it was at the start of the dab. Smooth
        // in particular must not see its own output: averaging against
        // already-moved neighbours makes the result depend on vertex order, so
        // the same stroke gives a different shape on a re-run.
        let before = mesh.positions
        let radiusSquared = settings.radius * settings.radius
        var touched = Set<Int>()

        for welded in 0..<tables.weldedCount {
            let representative = tables.weldMembers[welded][0]
            let p = before[representative]
            let offset = p - centre
            let distanceSquared = dot(offset, offset)
            guard distanceSquared <= radiusSquared else { continue }

            let weight = falloff(distance: distanceSquared.squareRoot(),
                                 radius: settings.radius) * settings.strength
            guard weight > 0 else { continue }

            let shift: Vec3
            switch brush {
            case .grab(let delta):
                shift = delta * weight
            case .inflate(let amount):
                shift = mesh.normals[representative] * (amount * weight)
            case .smooth:
                let ring = tables.neighbours[welded]
                guard !ring.isEmpty else { continue }
                var sum = Vec3.zero
                for n in ring { sum += before[tables.weldMembers[n][0]] }
                let average = sum * (1.0 / Double(ring.count))
                shift = (average - p) * weight
            }

            guard shift != .zero else { continue }
            for member in tables.weldMembers[welded] {
                mesh.positions[member] = before[member] + shift
            }
            touched.insert(welded)
        }
        return touched
    }
}
