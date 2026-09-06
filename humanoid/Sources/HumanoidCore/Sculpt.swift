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

    /// Applies one dab. Returns the welded positions it touched, which is what
    /// an incremental GPU buffer update and a bounded undo record both need.
    @discardableResult
    public static func apply(_ brush: Brush, to mesh: inout MeshData, tables: MeshTables,
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
        if !touched.isEmpty { mesh.recomputeNormals() }
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
