import Foundation

/// The viewport camera, as state and arithmetic with no view attached.
///
/// This lives in the core rather than in the app because it is where the
/// viewport's bugs actually are. Orbiting, framing and — above all — turning a
/// touch into a world-space ray are pure functions of a few numbers, and every
/// one of them is wrong in a way that looks like "the brush paints in the wrong
/// place" rather than like a maths error. Testing them needs no device.
///
/// What the app layer adds is a `MTKView`, a gesture recogniser and a draw
/// call. Nothing there does arithmetic.
///
/// ## Pivot and offset, and why it is not one point
///
/// The camera orbits `pivot` and looks at `pivot` displaced by `offset` **in
/// its own view plane**. One point cannot do both jobs: a pan that moved the
/// orbit centre would swing the model out of frame on the next drag, and a
/// pivot that could not move at all leaves every orbit after a pan rotating
/// about somewhere off the model — which is exactly what "I want to look at it
/// from a slightly different angle" ran into on the device.
///
/// Splitting them makes three gestures independent:
///
/// - `orbit` changes the angles; the offset rides along, so the framing
///   rotates about the pivot rather than snapping back to it.
/// - `pan(pixels:)` changes the offset only.
/// - `setPivot(to:)` moves the orbit centre **without moving the eye at all**
///   (see its note), so re-pivoting under two fingers is invisible until the
///   next orbit.
public struct Camera: Sendable {
    /// What the camera orbits around. Not necessarily what is in the middle of
    /// the screen — see `lookAt`.
    public var pivot: Vec3
    /// Displacement of the view centre from the pivot, in metres, measured in
    /// the camera's own right/up plane. This is what panning moves.
    public var offset: Vec2
    /// Distance from the view centre, in metres.
    public var distance: Double
    /// Rotation about the world Y axis, radians. 0 looks along -Z at the pivot,
    /// which puts the viewer on the model's +Z side — the side it faces.
    public var azimuth: Double
    /// Rotation above the horizon, radians. Clamped short of the poles.
    public var elevation: Double
    /// Vertical field of view, radians.
    public var fieldOfView: Double
    public var near: Double
    public var far: Double
    /// How close and how far zoom may go, in metres. `frame` derives these from
    /// the model's own radius, so a bigger template cannot be zoomed through
    /// itself and a smaller one can still be inspected.
    public var minDistance: Double
    public var maxDistance: Double

    /// Just short of straight up or down. At exactly a pole the up vector and
    /// the view direction are parallel and the basis collapses, which shows as
    /// the model flipping over as you drag past vertical.
    public static let elevationLimit = Double.pi / 2 - 0.01

    public init(pivot: Vec3 = .zero, offset: Vec2 = .zero, distance: Double = 0.5,
                azimuth: Double = 0, elevation: Double = 0.2,
                fieldOfView: Double = 50 * .pi / 180,
                near: Double = 0.01, far: Double = 100,
                minDistance: Double = 0.05, maxDistance: Double = 5) {
        self.pivot = pivot
        self.offset = offset
        self.distance = distance
        self.azimuth = azimuth
        self.elevation = elevation
        self.fieldOfView = fieldOfView
        self.near = near
        self.far = far
        self.minDistance = minDistance
        self.maxDistance = maxDistance
    }

    // MARK: - Basis

    /// The unit vector the camera looks along. A function of the two angles
    /// alone, which is what keeps `eye` from depending on itself: the basis is
    /// needed to place the view centre, and the view centre would otherwise be
    /// needed to derive the basis.
    public var forward: Vec3 {
        let horizontal = cos(elevation)
        return Vec3(-sin(azimuth) * horizontal, -sin(elevation), -cos(azimuth) * horizontal)
    }
    public var right: Vec3 { normalize(cross(forward, Vec3(0, 1, 0))) }
    public var up: Vec3 { cross(right, forward) }

    /// What sits in the middle of the screen: the pivot, slid across the view
    /// plane by the pan offset.
    public var lookAt: Vec3 { pivot + right * offset.x + up * offset.y }

    public var eye: Vec3 { lookAt - forward * distance }

    // MARK: - Gestures

    /// One-finger drag. Radians per unit of normalised screen travel.
    public mutating func orbit(dx: Double, dy: Double, speed: Double = 3.0) {
        azimuth -= dx * speed
        elevation = min(Camera.elevationLimit, max(-Camera.elevationLimit, elevation + dy * speed))
    }

    /// Two-finger drag, in **pixels**.
    ///
    /// Pixels rather than a normalised fraction, and it matters. The previous
    /// version took dx normalised by the view's WIDTH and dy by its HEIGHT and
    /// scaled both by the vertical extent, so on a landscape iPad the model
    /// tracked the fingers vertically and lagged them horizontally by the aspect
    /// ratio. There is one correct conversion and `metresPerPixel` already was
    /// it; this is the same number Grab and the brush radius use.
    public mutating func pan(pixels delta: Vec2, viewportHeight: Double) {
        let perPixel = metresPerPixel(depth: distance, viewportHeight: viewportHeight)
        guard perPixel > 0 else { return }
        // Drag right and the model goes right, so the view centre goes left.
        // Screen y points down and world up is +up, hence the opposite sign.
        offset.x -= delta.x * perPixel
        offset.y += delta.y * perPixel
    }

    /// Pinch, about the view centre. Multiplicative, because a fixed step is
    /// imperceptible when far away and slams into the near plane when close.
    public mutating func zoom(by factor: Double) {
        guard factor > 0, factor.isFinite else { return }
        distance = min(maxDistance, max(minDistance, distance / factor))
    }

    /// Pinch, about the point the fingers are on.
    ///
    /// The property this buys: the world point under `point` before the pinch
    /// is under `point` after it. Scaling `distance` alone instead — which is
    /// what the first version did — slides whatever you were pinching toward
    /// the middle of the screen, and reads as the model drifting away from your
    /// fingers.
    ///
    /// The shift is derived from the distance that was actually reached, not
    /// from the requested factor, so a pinch that runs into `minDistance` or
    /// `maxDistance` stops moving the view instead of sliding it sideways.
    public mutating func zoom(by factor: Double, about point: Vec2, viewport: Vec2) {
        guard factor > 0, factor.isFinite, viewport.y > 0 else { return }
        let before = distance
        let anchor = viewPlaneOffset(of: point, viewport: viewport)
        zoom(by: factor)
        guard before > 0 else { return }
        offset += anchor * (1 - distance / before)
    }

    /// Moves the orbit centre to a world point **without moving the eye**.
    ///
    /// That is the whole trick, and it is why a pivot change can happen the
    /// instant two fingers land rather than being a visible jump the user has
    /// to understand. The new distance is the point's depth along the view
    /// axis and the new offset is whatever puts the view centre back where it
    /// already was, so `eye` and `forward` come out bit-identical; only the
    /// centre of the NEXT orbit has changed.
    ///
    /// The one exception is a point outside the zoom range, where the clamp
    /// wins and the eye does move. Deliberate: the alternative is letting a
    /// double tap on a far corner escape the limits that stop you zooming
    /// through the model.
    @discardableResult
    public mutating func setPivot(to point: Vec3) -> Bool {
        let currentEye = eye
        let f = forward
        let depth = dot(point - currentEye, f)
        guard depth.isFinite, depth > 1e-6 else { return false }
        let clamped = min(maxDistance, max(minDistance, depth))
        let centre = currentEye + f * clamped
        let delta = centre - point
        pivot = point
        offset = Vec2(dot(delta, right), dot(delta, up))
        distance = clamped
        return true
    }

    /// Frames a bounding sphere, which is rotation-independent. Framing on an
    /// axis-aligned extent under-measures a cube seen corner-on and lets it
    /// overflow the view.
    public mutating func frame(centre: Vec3, radius: Double, margin: Double = 1.25) {
        pivot = centre
        offset = .zero
        // Solved from the model rather than fixed in metres: the same numbers
        // have to serve a 0.24 m clay cube and whatever a later template is.
        minDistance = max(0.02, radius * 0.4)
        maxDistance = max(minDistance * 4, radius * 30)
        distance = min(maxDistance,
                       max(minDistance, radius * margin / sin(fieldOfView / 2)))
    }

    public mutating func frame(_ mesh: MeshData, margin: Double = 1.25) {
        guard !mesh.positions.isEmpty else { return }
        var lo = mesh.positions[0], hi = mesh.positions[0]
        for p in mesh.positions {
            lo = Vec3(min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z))
            hi = Vec3(max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z))
        }
        let centre = (lo + hi) * 0.5
        let radius = mesh.positions.map { length($0 - centre) }.max() ?? 0
        frame(centre: centre, radius: radius, margin: margin)
    }

    // MARK: - Matrices

    public var viewMatrix: Mat4 {
        // Rows are the basis vectors, so this is the inverse of the camera's
        // world transform — which is what a view matrix is.
        let f = forward, r = right, u = up, e = eye
        return Mat4([
            r.x, u.x, -f.x, 0,
            r.y, u.y, -f.y, 0,
            r.z, u.z, -f.z, 0,
            -dot(r, e), -dot(u, e), dot(f, e), 1,
        ])
    }

    /// Right-handed, mapping z into 0...1 — Metal's clip range, not OpenGL's
    /// -1...1. Using the OpenGL form here is the classic first Metal bug: the
    /// near half of everything is clipped away and the scene looks hollow.
    public func projectionMatrix(aspect: Double) -> Mat4 {
        let scaleY = 1 / tan(fieldOfView / 2)
        let scaleX = scaleY / aspect
        let zRange = far - near
        return Mat4([
            scaleX, 0, 0, 0,
            0, scaleY, 0, 0,
            0, 0, -far / zRange, -1,
            0, 0, -(far * near) / zRange, 0,
        ])
    }

    // MARK: - Picking

    /// A world-space ray through a point on the screen.
    ///
    /// `point` is in pixels with the origin at the TOP LEFT, which is what UIKit
    /// hands over. Getting that flip wrong mirrors every brush stroke vertically
    /// and is invisible until someone paints near the top of the model.
    public func ray(through point: Vec2, viewport: Vec2) -> (origin: Vec3, direction: Vec3) {
        // Normalised device coordinates: -1...1 with +y up.
        let ndcX = 2 * (point.x / viewport.x) - 1
        let ndcY = 1 - 2 * (point.y / viewport.y)

        let halfHeight = tan(fieldOfView / 2)
        let halfWidth = halfHeight * (viewport.x / viewport.y)

        let direction = normalize(forward
                                  + right * (ndcX * halfWidth)
                                  + up * (ndcY * halfHeight))
        return (eye, direction)
    }

    /// Where a world point lands on the screen, in the same pixel coordinates
    /// `ray` takes. Nil behind the camera.
    ///
    /// The exact inverse of `ray`, and it exists so the camera's own rules can
    /// be stated as measurements rather than as assertions about its internals:
    /// "zooming about a point leaves that point where it was" is a sentence
    /// about this function.
    public func project(_ world: Vec3, viewport: Vec2) -> Vec2? {
        guard viewport.x > 0, viewport.y > 0 else { return nil }
        let toPoint = world - eye
        let depth = dot(toPoint, forward)
        guard depth > 1e-9 else { return nil }
        let halfHeight = tan(fieldOfView / 2)
        let halfWidth = halfHeight * (viewport.x / viewport.y)
        let ndcX = (dot(toPoint, right) / depth) / halfWidth
        let ndcY = (dot(toPoint, up) / depth) / halfHeight
        return Vec2((ndcX + 1) * 0.5 * viewport.x, (1 - ndcY) * 0.5 * viewport.y)
    }

    /// Where a screen point sits in the view plane through the view centre, in
    /// metres, relative to that centre. The quantity a zoom anchor is expressed
    /// in.
    public func viewPlaneOffset(of point: Vec2, viewport: Vec2) -> Vec2 {
        let perPixel = metresPerPixel(depth: distance, viewportHeight: viewport.y)
        return Vec2((point.x - viewport.x * 0.5) * perPixel,
                    -(point.y - viewport.y * 0.5) * perPixel)
    }

    /// Convenience: the nearest front-facing hit under a screen point.
    public func pick(_ mesh: MeshData, at point: Vec2, viewport: Vec2) -> Picking.Hit? {
        let r = ray(through: point, viewport: viewport)
        return Picking.raycast(mesh, origin: r.origin, direction: r.direction)
    }

    /// How far in front of the eye a world point sits, measured along the VIEW
    /// AXIS. This is the depth `metresPerPixel` and `worldDelta` mean.
    ///
    /// It is not the distance along a picking ray, and the difference was a
    /// bug. `Picking.Hit.distance` runs along the ray, which is longer than the
    /// view depth by 1/cos of the angle off-axis — 17% at the side of an iPad
    /// in landscape, 24% in its corners — and the editor passed it straight in
    /// as the depth. So a Grab moved the surface faster than the Pencil
    /// everywhere but the middle of the screen, and a brush sized in points
    /// grew toward the edges.
    public func viewDepth(of point: Vec3) -> Double { dot(point - eye, forward) }

    /// How far a screen-space drag moves a point at a given depth.
    ///
    /// Grab needs this: the finger travels in pixels and the vertex has to
    /// travel in metres, or dragging feels wrong at every zoom but one.
    ///
    /// `depth` is a VIEW depth (`viewDepth(of:)`). With it, the result is
    /// exact rather than approximate: a pinhole camera maps the plane at a
    /// fixed view depth onto the screen linearly, so a point moved by this
    /// delta projects exactly where the pointer went, anywhere on the screen.
    public func worldDelta(screenDelta: Vec2, viewport: Vec2, depth: Double) -> Vec3 {
        let perPixel = metresPerPixel(depth: depth, viewportHeight: viewport.y)
        return right * (screenDelta.x * perPixel) - up * (screenDelta.y * perPixel)
    }

    /// How many metres one screen pixel covers at a given depth.
    ///
    /// This is what makes a brush size in **screen pixels** possible, which is
    /// what ZBrush and Nomad both default to and what the app now does. A brush
    /// fixed in world metres is the wrong size at every zoom but one: zoom in to
    /// work on a detail and the brush swallows it. Fixed on screen, zooming in
    /// buys finer detail for free, and the hover ring stays the size the finger
    /// expects.
    ///
    /// Depth is the VIEW depth of the surface being worked (`viewDepth(of:)`),
    /// so a brush stays the same size on screen wherever it lands on the model.
    public func metresPerPixel(depth: Double, viewportHeight: Double) -> Double {
        guard viewportHeight > 0 else { return 0 }
        return 2 * tan(fieldOfView / 2) * depth / viewportHeight
    }
}
