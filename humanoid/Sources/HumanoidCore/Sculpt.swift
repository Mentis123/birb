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
        /// Push the surface out along the brush's own facing — the average
        /// normal of the surface around it (`pushDirection`). Negative
        /// presses it in, which is Deflate.
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

    /// The most one Inflate or Deflate stroke can move a point, in brush radii
    /// — scaled, like the dab itself, by the falloff and strength (pressure
    /// included) of the dab that reaches it.
    ///
    /// **0.65, and the number is not a feel.** A dab pushes every point it
    /// reaches the same way (`pushDirection`) by an amount that falls off
    /// with the smoothstep, whose steepest slope is 1.5 per radius. Pushing a
    /// surface in one direction by an amount that changes faster than the
    /// surface does — more than one unit of push per unit along the push —
    /// carries the near part of a wall past the far part, and the wall folds.
    /// So the most a stroke may push is the depth whose steepest flank stays
    /// under that: 1 / 1.5 = 0.67 radii, and 0.65 leaves the margin. It was
    /// 1.0 until the sixth device run, over the smoothstep's 1.5: a limit
    /// that let a single stroke fold a wall it pushed along.
    ///
    /// A single pass reaches it (one pass lifts the middle of its path
    /// 0.88 R before the limit), so a confident stroke is 0.65 R, and a
    /// scribble over one place fills up to the same smooth ridge and stops.
    /// More is another stroke, which starts from the new surface.
    ///
    /// History: the fifth device run's screenshot was a scribbled spike
    /// several radii tall, when nothing limited a stroke at all; the sixth
    /// was a Deflate pit with the inside of the model showing through it,
    /// when each point was still pushed along its own normal.
    public static let strokeHeightLimit = 0.65

    /// How wide an area decides which way a dab pushes, in brush radii.
    ///
    /// Inflate and Deflate used to push every point along ITS OWN normal,
    /// which is what makes them converge: on a rounded edge, on the rim of a
    /// pit, in the bottom of a dent, neighbouring normals point at each
    /// other, points pushed along them cross, and the surface passes through
    /// itself. Measured headless on the sixth device run's settings (a 35 pt
    /// brush, strength 0.6, one place on the top face): the surface first
    /// crossed itself at the tenth stroke and had 445 crossing triangle
    /// pairs by the sixtieth; a pit dug into an edge or a corner crossed
    /// within five.
    ///
    /// Now a dab pushes everything it reaches ONE way: the surface's average
    /// facing over this many radii around it, on the shape the stroke
    /// started from — Blender's Draw brush with its area normal, and Nomad's
    /// Clay. Wider than the brush on purpose. Averaged over only the brush,
    /// a stroke on the far wall of a pit (which is where the Pencil lands on
    /// a pit seen at an angle) pushes that wall away from the viewer, and
    /// the pit tunnels backwards stroke by stroke until it breaks out
    /// through the back edge. Over 2.5 radii the pit's surroundings take
    /// part, and it goes down.
    ///
    /// The trade: this is "raise" and "press", not "inflate". A thin part —
    /// a limb pulled out with Grab — is pushed as a whole rather than
    /// fattened, because the average facing of a thin part is whichever side
    /// the brush is on. Clay has no thin parts until someone makes one; the
    /// Humanoid, whose arms are, is milestone M5 and will want a brush of its
    /// own for it.
    public static let pushNormalRadius = 2.5

    /// What one Inflate, Deflate or Smooth stroke is measured against: the
    /// surface as the stroke found it, and how far the stroke may move each
    /// point of it.
    public struct StrokeBase: Sendable {
        /// The surface when the stroke began. Dabs find their points on it and
        /// push along its normals; see `apply(_:to:tables:base:)`.
        public let surface: MeshData
        /// Per welded position, the furthest this stroke may take it from
        /// where the stroke found it: the largest ceiling any of its dabs has
        /// allowed there so far (`strokeHeightLimit` x radius x weight), zero
        /// until one reaches it.
        ///
        /// Kept for the whole stroke rather than taken from each dab alone,
        /// because a pass's dabs weaken as they move away from a point. Taken
        /// per dab, the trailing ones' lower ceilings refused them the rise a
        /// single pass is meant to give: measured, one pass rose 0.755 radii
        /// instead of 0.88, and that was the first version of this limit.
        var ceilings: [Double]

        public init(_ surface: MeshData, tables: MeshTables) {
            self.surface = surface
            ceilings = [Double](repeating: 0, count: tables.weldedCount)
        }
    }

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
        var noCeilings: [Double] = []
        for centre in centres {
            touched.formUnion(dab(brush, to: &mesh, tables: tables, at: centre, settings: settings,
                                  reference: nil, ceilings: &noCeilings))
        }
        mesh.recomputeNormals(tables, touching: touched)
        return touched
    }

    /// Applies dabs that each carry their own brush and settings, then rebuilds
    /// the normals once, measuring every dab against the live surface. Kept
    /// for single dabs and tests; a stroke uses `apply(_:to:tables:base:)`.
    @discardableResult
    public static func apply(_ dabs: [Dab], to mesh: inout MeshData, tables: MeshTables) -> Set<Int> {
        var touched = Set<Int>()
        var noCeilings: [Double] = []
        for d in dabs {
            touched.formUnion(dab(d.brush, to: &mesh, tables: tables, at: d.centre,
                                  settings: d.settings, reference: nil, ceilings: &noCeilings))
        }
        mesh.recomputeNormals(tables, touching: touched)
        return touched
    }

    /// Applies one frame of a stroke's dabs, each with its own brush and
    /// settings, then rebuilds the normals once. What a pressure-sensitive
    /// stroke hands over per frame.
    ///
    /// Every dab finds its points and takes its push direction from the
    /// surface the stroke STARTED on (`base.surface`), not the one it is busy
    /// moving — Blender's "accumulate off" and "original normal", and for the
    /// same reason: a stroke whose dabs chase the surface they raise depends
    /// on when the surface was sampled. Measured before this existed, the
    /// same Inflate path came out 5.4 mm different delivered one sample a
    /// frame than three a frame, and 8.3 mm different in one frame — the brush
    /// changed its mind with the frame rate. Measured against the start, a
    /// dab's effect is a function of the path and the starting shape alone.
    ///
    /// Inflate and Deflate are also held to `strokeHeightLimit`, and a frame
    /// of them never makes the surface pass through itself: if it would,
    /// the whole frame's move is scaled back — halved, and halved again,
    /// down to none — until it does not (`SelfIntersection`). Scaled as a
    /// whole rather than point by point, because the fold guard this
    /// replaces put back single points, and a surface with some points put
    /// back and their neighbours moved is a staircase of shards. Measured on
    /// the headless reproduction of the sixth device run, the push direction
    /// alone leaves one frame in a hundred for this to catch.
    ///
    /// `preventCrossing` exists so a test can see what the brush does
    /// without the guard; nothing else turns it off.
    @discardableResult
    public static func apply(_ dabs: [Dab], to mesh: inout MeshData, tables: MeshTables,
                             base: inout StrokeBase, preventCrossing: Bool = true) -> Set<Int> {
        // The frame's starting positions, for scaling back a move that makes
        // the surface cross itself. Copy-on-write: this costs one copy of the
        // positions per frame, at the first dab, and only for the brushes
        // that need it.
        let pushes = dabs.contains { if case .inflate = $0.brush { return true } else { return false } }
        let start: [Vec3]? = pushes && preventCrossing ? mesh.positions : nil
        var touched = Set<Int>()
        for d in dabs {
            touched.formUnion(dab(d.brush, to: &mesh, tables: tables, at: d.centre,
                                  settings: d.settings, reference: base.surface,
                                  ceilings: &base.ceilings))
        }
        if let start {
            untangle(&mesh, moved: touched, from: start, tables: tables)
        }
        mesh.recomputeNormals(tables, touching: touched)
        return touched
    }

    /// Scales back the move from `start` of the welded positions in `moved`
    /// until it makes no two triangles cross that did not cross at `start`.
    /// Returns the fraction of the move kept: 1 when nothing crossed, 0 when
    /// even an eighth of it would have.
    @discardableResult
    static func untangle(_ mesh: inout MeshData, moved: Set<Int>, from start: [Vec3],
                         tables: MeshTables) -> Double {
        guard SelfIntersection.created(in: mesh, moved: moved, from: start, tables: tables) else {
            return 1
        }
        let after = mesh.positions
        var kept = 0.5
        while true {
            for w in moved {
                for member in tables.weldMembers[w] {
                    mesh.positions[member] = start[member] + (after[member] - start[member]) * kept
                }
            }
            if kept == 0 { return 0 }
            if !SelfIntersection.created(in: mesh, moved: moved, from: start, tables: tables) {
                return kept
            }
            kept = kept > 0.125 ? kept * 0.5 : 0
        }
    }

    /// Applies one dab. Returns the welded positions it touched, which is what
    /// an incremental GPU buffer update and a bounded undo record both need.
    @discardableResult
    public static func apply(_ brush: Brush, to mesh: inout MeshData, tables: MeshTables,
                             at centre: Vec3, settings: Settings) -> Set<Int> {
        var noCeilings: [Double] = []
        let touched = dab(brush, to: &mesh, tables: tables, at: centre, settings: settings,
                          reference: nil, ceilings: &noCeilings)
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

    /// How much of `shift` a point already `offset` from where the stroke
    /// found it may take, as a fraction 0...1, without ending further from
    /// there than `ceiling` — or, when it is already past the ceiling, than
    /// it already is. So a weaker dab never pulls back what a stronger one
    /// pushed, and a move back towards the start is never refused.
    @inline(__always)
    static func limitedMove(_ shift: Vec3, from offset: Vec3, ceiling: Double) -> Double {
        let a = dot(shift, shift)
        guard a > 0 else { return 1 }
        let b = 2 * dot(offset, shift)
        let c = dot(offset, offset) - ceiling * ceiling
        if c >= 0 {
            // At or past the ceiling: only inwards, and no further than back
            // to the same distance on the other side.
            return b < 0 ? min(1, -b / a) : 0
        }
        // The larger root of |offset + t shift|^2 = ceiling^2; c < 0 makes it
        // real and positive.
        return min(1, (-b + (b * b - 4 * a * c).squareRoot()) / (2 * a))
    }

    /// Which way an Inflate dab pushes the points it reaches: the average
    /// facing of `surface` over `pushNormalRadius` brush radii around
    /// `centre`, and around its mirror image too when the brush is
    /// symmetric. Both halves come from one pass. Nil where the surface
    /// faces every way at once — a sheet seen from both sides — and there is
    /// no direction to push.
    static func pushDirections(centre: Vec3, mirrorCentre: Vec3?, radius: Double,
                               surface: MeshData,
                               tables: MeshTables) -> (primary: Vec3, mirror: Vec3)? {
        let reachRadius = radius * pushNormalRadius
        let reachSquared = reachRadius * reachRadius
        var primary = Vec3.zero, mirror = Vec3.zero
        for welded in 0..<tables.weldedCount {
            let representative = tables.weldMembers[welded][0]
            let p = surface.positions[representative]
            let a = reach(p, from: centre, radius: reachRadius, radiusSquared: reachSquared)
            if a > 0 { primary += surface.normals[representative] * a }
            if let mirrorCentre {
                let b = reach(p, from: mirrorCentre, radius: reachRadius, radiusSquared: reachSquared)
                if b > 0 { mirror += surface.normals[representative] * b }
            }
        }
        let tiny = 1e-12
        let hasPrimary = dot(primary, primary) > tiny, hasMirror = dot(mirror, mirror) > tiny
        switch (hasPrimary, hasMirror) {
        case (false, false): return nil
        case (true, false):
            let p = normalize(primary)
            return (p, Vec3(-p.x, p.y, p.z))
        case (false, true):
            let m = normalize(mirror)
            return (Vec3(-m.x, m.y, m.z), m)
        case (true, true):
            return (normalize(primary), normalize(mirror))
        }
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
                            reference: MeshData?, ceilings: inout [Double]) -> Set<Int> {
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

        // Inflate's one direction per half, from the same surface the dab
        // reaches its points on.
        var push = (primary: Vec3.zero, mirror: Vec3.zero)
        if case .inflate = brush {
            guard let found = pushDirections(centre: centre,
                                             mirrorCentre: settings.symmetric ? mirrorCentre : nil,
                                             radius: settings.radius,
                                             surface: reference ?? mesh, tables: tables)
            else { return [] }
            push = found
        }

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
                // Blended across the mirror plane the way Grab is, so the
                // two halves meet without a crease. Where one half owns the
                // point, or both halves agree, it is that direction exactly.
                let share = mirrorShare(primary: primary, mirror: mirror)
                let direction = share <= 0 || push.primary == push.mirror ? push.primary
                    : share >= 1 ? push.mirror
                    : normalize(push.primary * (1 - share) + push.mirror * share)
                let wanted = direction * (amount * weight)
                if let reference, !ceilings.isEmpty {
                    // The furthest this stroke may take the point — the
                    // largest any of its dabs has allowed — and as much of
                    // this dab as fits inside it.
                    let ceiling = max(ceilings[welded], strokeHeightLimit * settings.radius * weight)
                    ceilings[welded] = ceiling
                    let offset = mesh.positions[representative] - reference.positions[representative]
                    shift = wanted * limitedMove(wanted, from: offset, ceiling: ceiling)
                } else {
                    shift = wanted
                }
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
