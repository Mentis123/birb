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
public struct Camera: Sendable {
    /// What the camera looks at and rotates around.
    public var target: Vec3
    /// Distance from the target, in metres.
    public var distance: Double
    /// Rotation about the world Y axis, radians. 0 looks along -Z at the target,
    /// which puts the viewer on the model's +Z side — the side it faces.
    public var azimuth: Double
    /// Rotation above the horizon, radians. Clamped short of the poles.
    public var elevation: Double
    /// Vertical field of view, radians.
    public var fieldOfView: Double
    public var near: Double
    public var far: Double

    /// Just short of straight up or down. At exactly a pole the up vector and
    /// the view direction are parallel and the basis collapses, which shows as
    /// the model flipping over as you drag past vertical.
    public static let elevationLimit = Double.pi / 2 - 0.01

    public init(target: Vec3 = .zero, distance: Double = 0.5,
                azimuth: Double = 0, elevation: Double = 0.2,
                fieldOfView: Double = 50 * .pi / 180,
                near: Double = 0.01, far: Double = 100) {
        self.target = target
        self.distance = distance
        self.azimuth = azimuth
        self.elevation = elevation
        self.fieldOfView = fieldOfView
        self.near = near
        self.far = far
    }

    public var eye: Vec3 {
        let horizontal = cos(elevation) * distance
        return Vec3(target.x + sin(azimuth) * horizontal,
                    target.y + sin(elevation) * distance,
                    target.z + cos(azimuth) * horizontal)
    }

    public var forward: Vec3 { normalize(target - eye) }
    public var right: Vec3 { normalize(cross(forward, Vec3(0, 1, 0))) }
    public var up: Vec3 { cross(right, forward) }

    // MARK: - Gestures

    /// One-finger drag. Radians per unit of normalised screen travel.
    public mutating func orbit(dx: Double, dy: Double, speed: Double = 3.0) {
        azimuth -= dx * speed
        elevation = min(Camera.elevationLimit, max(-Camera.elevationLimit, elevation + dy * speed))
    }

    /// Two-finger drag. Panning is scaled by distance so the model appears to
    /// follow the finger at any zoom; a fixed rate feels glued when close and
    /// sluggish when far.
    public mutating func pan(dx: Double, dy: Double) {
        let scale = distance * 2 * tan(fieldOfView / 2)
        target -= right * (dx * scale)
        target -= up * (dy * scale)
    }

    /// Pinch. Multiplicative, because a fixed step is imperceptible when far
    /// away and slams into the near plane when close.
    public mutating func zoom(by factor: Double, minimum: Double = 0.05, maximum: Double = 5) {
        guard factor > 0 else { return }
        distance = min(maximum, max(minimum, distance / factor))
    }

    /// Frames a bounding sphere, which is rotation-independent. Framing on an
    /// axis-aligned extent under-measures a cube seen corner-on and lets it
    /// overflow the view.
    public mutating func frame(centre: Vec3, radius: Double, margin: Double = 1.25) {
        target = centre
        distance = max(0.05, radius * margin / sin(fieldOfView / 2))
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

    /// Convenience: the nearest front-facing hit under a screen point.
    public func pick(_ mesh: MeshData, at point: Vec2, viewport: Vec2) -> Picking.Hit? {
        let r = ray(through: point, viewport: viewport)
        return Picking.raycast(mesh, origin: r.origin, direction: r.direction)
    }

    /// How far a screen-space drag moves a point at a given depth.
    ///
    /// Grab needs this: the finger travels in pixels and the vertex has to
    /// travel in metres, or dragging feels wrong at every zoom but one.
    public func worldDelta(screenDelta: Vec2, viewport: Vec2, depth: Double) -> Vec3 {
        let visibleHeight = 2 * tan(fieldOfView / 2) * depth
        let perPixel = visibleHeight / viewport.y
        return right * (screenDelta.x * perPixel) - up * (screenDelta.y * perPixel)
    }
}
