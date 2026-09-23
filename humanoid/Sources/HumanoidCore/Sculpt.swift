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

    public struct Settings: Sendable, Equatable {
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
    /// A stroke is resampled to a dab every quarter radius, so a point on the
    /// path receives roughly eight overlapping dabs. The first version shipped
    /// at 0.35 — a per-*gesture* amount — and then applied one dab per Pencil
    /// event at pen-up, so a slow one-second stroke stacked over a hundred of
    /// them in one place and extruded the surface through itself. The folded
    /// triangles are back-face culled, which is what "sometimes it goes inside
    /// out" was.
    ///
    /// Raised 0.04 -> 0.09 after the second device run: *"inflate at full
    /// strength almost didn't"*. At 0.04, one dab at full strength moved the
    /// surface 0.42 mm with a brush that was itself half the size the slider
    /// claimed, so a whole pass across the model barely creased it.
    ///
    /// **This is the value for a stroke that measures the SURFACE**, where the
    /// feedback gain `inflatePerDab / spacing` must stay under 1 or the stroke
    /// never converges. 0.09 / 0.25 is 0.36, with the margin the gain test
    /// keeps. A stroke advanced by POINTER travel has no such loop and wants
    /// `inflatePerDabDriven` instead.
    public static let inflatePerDab = 0.09

    /// How far one dab moves the surface when the stroke is advanced by
    /// **pointer** travel, as a fraction of the brush radius.
    ///
    /// Two and a half times `inflatePerDab`, and legitimately so: the ceiling
    /// on that constant is a feedback gain, and passing `by:` removes the
    /// feedback. What bounds this one instead is the shape of a single pass.
    /// Dabs land every 0.25 R, so a point on the path collects dabs at
    /// 0, ±0.25, ±0.5, ±0.75 R whose smoothstep weights sum to 4.0 — one pass
    /// therefore displaces the surface by `4 x value x R`, and 0.22 makes that
    /// just under one brush radius. That is what a confident single stroke of a
    /// sculpting brush should do, and at 0.09 it was a third of it.
    ///
    /// The editor always passes `by:`, so the editor always uses this. The two
    /// constants exist separately because the coupling is not obvious from
    /// either call site, and one number could not carry both meanings honestly.
    public static let inflatePerDabDriven = 0.22

    /// One dab, fully specified: where, how big, how strong, and what.
    ///
    /// A stroke carries Pencil pressure, and pressure changes the radius and
    /// strength of every dab it emits. Applying a frame's dabs with ONE
    /// settings value — the last sample's — stamped the start of every frame
    /// with the end of it: the taper a light touch-down should give a stroke
    /// came out as steps, one per frame.
    public struct Dab: Sendable, Equatable {
        public var brush: Brush
        public var centre: Vec3
        public var settings: Settings

        public init(_ brush: Brush, at centre: Vec3, settings: Settings) {
            self.brush = brush
            self.centre = centre
            self.settings = settings
        }
    }

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
            touched.formUnion(dab(brush, to: &mesh, tables: tables, at: centre, settings: settings))
        }
        mesh.recomputeNormals(tables, touching: touched)
        return touched
    }

    /// Applies dabs that each carry their own brush and settings, then rebuilds
    /// the normals once. What a pressure-sensitive stroke hands over per frame.
    ///
    /// `reference` is the surface as it was when the stroke began. When it is
    /// given, each dab finds its vertices and takes its push direction from
    /// THAT surface rather than from the one it is busy moving — Blender's
    /// "accumulate off" and "original normal", and for the same reason: a
    /// stroke whose dabs chase the surface they raise depends on when the
    /// surface was sampled. Measured before this existed, the same Inflate
    /// path came out 5.4 mm different delivered one sample a frame than three
    /// a frame, and 8.3 mm different in one frame — the brush changed its
    /// mind with the frame rate. With a reference, a dab's effect is a function
    /// of the path and the stroke's starting shape alone, so it does not.
    @discardableResult
    public static func apply(_ dabs: [Dab], to mesh: inout MeshData, tables: MeshTables,
                             reference: MeshData? = nil) -> Set<Int> {
        var touched = Set<Int>()
        for d in dabs {
            touched.formUnion(dab(d.brush, to: &mesh, tables: tables, at: d.centre,
                                  settings: d.settings, reference: reference))
        }
        mesh.recomputeNormals(tables, touching: touched)
        return touched
    }

    /// Applies one dab. Returns the welded positions it touched, which is what
    /// an incremental GPU buffer update and a bounded undo record both need.
    @discardableResult
    public static func apply(_ brush: Brush, to mesh: inout MeshData, tables: MeshTables,
                             at centre: Vec3, settings: Settings) -> Set<Int> {
        let touched = dab(brush, to: &mesh, tables: tables, at: centre, settings: settings)
        mesh.recomputeNormals(tables, touching: touched)
        return touched
    }

    // MARK: - Symmetry

    /// How the two halves of a symmetric brush combine where they overlap.
    ///
    /// ## The bug this replaces
    ///
    /// The mirrored half used to run as a second, independent dab, so every
    /// vertex inside BOTH footprints moved twice. The footprints overlap
    /// wherever the brush is near x = 0 — and the middle of the clay's front
    /// face is x = 0, the first place anyone grabs. A symmetric Grab there
    /// moved the surface twice as far as the Pencil (the sideways halves
    /// cancel, the vertical ones add), and Inflate raised a doubled ridge down
    /// the middle of any stroke that crossed it.
    ///
    /// ## The rule
    ///
    /// Each vertex takes the weighted mean of the two falloffs,
    /// `(w1² + w2²) / (w1 + w2)`:
    ///
    /// - where only one half reaches, it is that half's weight, unchanged;
    /// - it never exceeds the larger of the two, so no vertex moves further than
    ///   one brush would move it;
    /// - two coincident halves — a brush centred ON the plane — give exactly
    ///   the one-sided result, which is right: that stroke is its own mirror;
    /// - it is smooth across the plane, where a plain `max` would crease.
    ///
    /// The result stays exactly mirror-symmetric, because swapping the halves
    /// swaps `w1` and `w2` and the rule is symmetric in them.
    @inlinable
    public static func symmetricWeight(primary w1: Double, mirror w2: Double) -> Double {
        let sum = w1 + w2
        guard sum > 0 else { return 0 }
        guard w2 > 0 else { return w1 }
        guard w1 > 0 else { return w2 }
        return (w1 * w1 + w2 * w2) / sum
    }

    /// How much of a vertex's pull belongs to the mirrored half, 0...1. A
    /// Grab's direction is blended by it: on the plane the halves share
    /// equally, the sideways components cancel, and the surface follows the
    /// Pencil up and down exactly once.
    @inlinable
    public static func mirrorShare(primary w1: Double, mirror w2: Double) -> Double {
        guard w2 > 0 else { return 0 }
        guard w1 > 0 else { return 1 }
        return w2 / (w1 + w2)
    }

    /// A Grab displacement as seen by a vertex with the given mirror share.
    @inlinable
    public static func grabDirection(_ delta: Vec3, mirrorShare share: Double) -> Vec3 {
        guard share > 0 else { return delta }
        let mirrored = Vec3(-delta.x, delta.y, delta.z)
        guard share < 1 else { return mirrored }
        return delta * (1 - share) + mirrored * share
    }

    /// The falloff at a point, or 0 outside the brush.
    @inline(__always)
    private static func reach(_ p: Vec3, from centre: Vec3, radius: Double,
                              radiusSquared: Double) -> Double {
        let offset = p - centre
        let distanceSquared = dot(offset, offset)
        guard distanceSquared <= radiusSquared else { return 0 }
        return falloff(distance: distanceSquared.squareRoot(), radius: radius)
    }

    /// One dab, both halves of it in one pass when symmetry is on. No normal
    /// rebuild.
    private static func dab(_ brush: Brush, to mesh: inout MeshData, tables: MeshTables,
                            at centre: Vec3, settings: Settings,
                            reference: MeshData? = nil) -> Set<Int> {
        guard settings.radius > 0, settings.strength != 0 else { return [] }

        // Smooth reads the mesh as it was at the start of the dab, and must:
        // averaging against already-moved NEIGHBOURS makes the result depend on
        // vertex order, so the same stroke gives a different shape on a re-run.
        //
        // Grab and Inflate do not need the snapshot and do not take it. Weld
        // groups are disjoint and each is written exactly once per dab, so
        // neither brush can ever read a position its own dab has already
        // moved — the copy was 90 KB per dab (3,750 positions, through
        // copy-on-write) bought for nothing. Only Smooth crosses between
        // groups, and only Smooth pays.
        let snapshot: [Vec3]
        switch brush {
        case .smooth: snapshot = mesh.positions
        case .grab, .inflate: snapshot = []
        }
        let radiusSquared = settings.radius * settings.radius
        // The mirror of the whole operation, not just of its centre: a Grab
        // pulling +X on the left must pull -X on the right, or a symmetric
        // stroke shears the model instead of widening it. Inflate and Smooth
        // are direction-free.
        let mirrorCentre = Vec3(-centre.x, centre.y, centre.z)
        var touched = Set<Int>()

        for welded in 0..<tables.weldedCount {
            let representative = tables.weldMembers[welded][0]
            // Read through the optional rather than hoisting an array out of
            // it: a local copy of `mesh.positions` would make the write below
            // copy the whole array on every dab.
            let p = reference?.positions[representative] ?? mesh.positions[representative]
            let primary = reach(p, from: centre, radius: settings.radius,
                                radiusSquared: radiusSquared)
            let mirror = settings.symmetric
                ? reach(p, from: mirrorCentre, radius: settings.radius, radiusSquared: radiusSquared)
                : 0
            guard primary > 0 || mirror > 0 else { continue }
            let weight = symmetricWeight(primary: primary, mirror: mirror) * settings.strength
            guard weight != 0 else { continue }

            let shift: Vec3
            switch brush {
            case .grab(let delta):
                shift = grabDirection(delta, mirrorShare: mirrorShare(primary: primary, mirror: mirror))
                    * weight
            case .inflate(let amount):
                let normal = reference?.normals[representative] ?? mesh.normals[representative]
                shift = normal * (amount * weight)
            case .smooth:
                let ring = tables.neighbours[welded]
                guard !ring.isEmpty else { continue }
                var sum = Vec3.zero
                for n in ring { sum += snapshot[tables.weldMembers[n][0]] }
                let average = sum * (1.0 / Double(ring.count))
                shift = (average - snapshot[representative]) * weight
            }

            guard shift != .zero else { continue }
            for member in tables.weldMembers[welded] {
                mesh.positions[member] += shift
            }
            touched.insert(welded)
        }
        return touched
    }

    // MARK: - Grab, captured

    /// The vertices one Grab gesture owns, fixed at the moment it begins.
    ///
    /// Grab is the one brush that must not re-decide what it is holding. The
    /// per-dab form re-picks the surface under the tip every frame, so as the
    /// pulled surface moves — or as the tip runs off the bump it just made — a
    /// different set of vertices is grabbed part way through one drag, and the
    /// displacement accumulates from wherever they happened to be. Capturing
    /// the set and its positions once makes the whole gesture a function of the
    /// TOTAL displacement: idempotent, drift-free, and exactly the set undo
    /// needs to record.
    ///
    /// Each vertex appears ONCE, with the two halves of a symmetric grab
    /// already combined (`symmetricWeight`). It used to appear once per half
    /// with the halves summed, which is the double-strength grab at the mirror
    /// plane described there.
    public struct GrabSet: Sendable {
        /// Raw vertex indices — every weld member, so a seam moves as one point.
        public let vertices: [Int]
        /// Combined falloff x strength, per entry.
        public let weights: [Double]
        /// How much of each entry's pull is the mirrored half's, 0...1; its
        /// displacement is blended toward the x-negated one by this much.
        public let mirrorShares: [Double]
        /// Where each entry was when the gesture began.
        public let origins: [Vec3]
        /// Welded positions touched, for the incremental normal pass.
        public let welded: Set<Int>

        public var isEmpty: Bool { vertices.isEmpty }
        public var weldedCount: Int { welded.count }
        /// Whether the mirrored half holds any of each entry.
        public var mirrored: [Bool] { mirrorShares.map { $0 > 0 } }

        public init(vertices: [Int], weights: [Double], mirrorShares: [Double],
                    origins: [Vec3], welded: Set<Int>) {
            self.vertices = vertices
            self.weights = weights
            self.mirrorShares = mirrorShares
            self.origins = origins
            self.welded = welded
        }
    }

    /// Decides what a Grab gesture will hold, once, at the point it starts.
    public static func captureGrab(at centre: Vec3, mesh: MeshData, tables: MeshTables,
                                   settings: Settings) -> GrabSet {
        var vertices = [Int]()
        var weights = [Double]()
        var shares = [Double]()
        var origins = [Vec3]()
        var welded = Set<Int>()
        guard settings.radius > 0, settings.strength != 0 else {
            return GrabSet(vertices: vertices, weights: weights, mirrorShares: shares,
                           origins: origins, welded: welded)
        }

        let radiusSquared = settings.radius * settings.radius
        let mirrorCentre = Vec3(-centre.x, centre.y, centre.z)
        for w in 0..<tables.weldedCount {
            let p = mesh.positions[tables.weldMembers[w][0]]
            let primary = reach(p, from: centre, radius: settings.radius,
                                radiusSquared: radiusSquared)
            let mirror = settings.symmetric
                ? reach(p, from: mirrorCentre, radius: settings.radius, radiusSquared: radiusSquared)
                : 0
            guard primary > 0 || mirror > 0 else { continue }
            let weight = symmetricWeight(primary: primary, mirror: mirror) * settings.strength
            guard weight != 0 else { continue }
            let share = mirrorShare(primary: primary, mirror: mirror)
            welded.insert(w)
            for member in tables.weldMembers[w] {
                vertices.append(member)
                weights.append(weight)
                shares.append(share)
                origins.append(mesh.positions[member])
            }
        }
        return GrabSet(vertices: vertices, weights: weights, mirrorShares: shares,
                       origins: origins, welded: welded)
    }

    /// Places a captured Grab at a TOTAL displacement from where it began.
    ///
    /// Absolute rather than incremental, so calling it sixty times a frame apart
    /// with a growing displacement lands in exactly the same place as calling it
    /// once with the final one.
    public static func apply(_ set: GrabSet, displacement: Vec3,
                             to mesh: inout MeshData, tables: MeshTables) {
        guard !set.vertices.isEmpty else { return }
        for (i, v) in set.vertices.enumerated() {
            mesh.positions[v] = set.origins[i]
                + grabDirection(displacement, mirrorShare: set.mirrorShares[i]) * set.weights[i]
        }
        mesh.recomputeNormals(tables, touching: set.welded)
    }
}
