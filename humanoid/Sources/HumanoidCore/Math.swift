import Foundation

// Deliberately not `simd`: that module ships only in Apple's SDKs, so anything
// importing it cannot be built or tested on the Linux box. These types use the
// Swift stdlib's SIMD3/SIMD4 (part of the language, available everywhere) plus a
// hand-rolled 4x4.
//
// Storage is COLUMN-MAJOR with translation at indices 12/13/14, which is what
// both glTF ("matrices are stored in column-major order") and ufbx-write's
// ufbxw_matrix expect. Getting this wrong is the single most common reason a
// self-written exporter produces a file that imports but is skinned wrong.

public typealias Vec3 = SIMD3<Double>
public typealias Vec2 = SIMD2<Double>

@inlinable public func dot(_ a: Vec3, _ b: Vec3) -> Double { a.x * b.x + a.y * b.y + a.z * b.z }
@inlinable public func cross(_ a: Vec3, _ b: Vec3) -> Vec3 {
    Vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
}
@inlinable public func length(_ a: Vec3) -> Double { dot(a, a).squareRoot() }
@inlinable public func normalize(_ a: Vec3) -> Vec3 {
    let l = length(a)
    return l > 1e-12 ? a / l : Vec3(0, 0, 0)
}
/// Angle between two vectors in degrees. Returns 180 for a zero-length input so
/// that degenerate bones fail an angle gate rather than silently passing it.
public func angleDegrees(_ a: Vec3, _ b: Vec3) -> Double {
    let la = length(a), lb = length(b)
    guard la > 1e-12, lb > 1e-12 else { return 180 }
    let c = max(-1.0, min(1.0, dot(a, b) / (la * lb)))
    return acos(c) * 180.0 / Double.pi
}

public struct Mat4: Equatable, Sendable {
    /// Column-major: element (row r, column c) is at m[c * 4 + r].
    public var m: [Double]

    public init(_ values: [Double]) {
        precondition(values.count == 16, "Mat4 needs 16 elements")
        self.m = values
    }

    public static let identity = Mat4([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ])

    @inlinable public subscript(row: Int, col: Int) -> Double {
        get { m[col * 4 + row] }
        set { m[col * 4 + row] = newValue }
    }

    public var translation: Vec3 {
        get { Vec3(m[12], m[13], m[14]) }
        set { m[12] = newValue.x; m[13] = newValue.y; m[14] = newValue.z }
    }

    public static func translation(_ t: Vec3) -> Mat4 {
        var r = Mat4.identity
        r.translation = t
        return r
    }

    /// Builds a rest frame from an orthonormal basis plus an origin.
    public static func basis(x: Vec3, y: Vec3, z: Vec3, origin: Vec3) -> Mat4 {
        Mat4([
            x.x, x.y, x.z, 0,
            y.x, y.y, y.z, 0,
            z.x, z.y, z.z, 0,
            origin.x, origin.y, origin.z, 1,
        ])
    }

    public static func * (a: Mat4, b: Mat4) -> Mat4 {
        var out = [Double](repeating: 0, count: 16)
        for c in 0..<4 {
            for r in 0..<4 {
                var s = 0.0
                for k in 0..<4 { s += a.m[k * 4 + r] * b.m[c * 4 + k] }
                out[c * 4 + r] = s
            }
        }
        return Mat4(out)
    }

    /// Transforms a position (w = 1).
    public func transform(point p: Vec3) -> Vec3 {
        Vec3(
            m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
            m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
            m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14]
        )
    }

    /// Transforms a direction (w = 0).
    public func transform(vector v: Vec3) -> Vec3 {
        Vec3(
            m[0] * v.x + m[4] * v.y + m[8] * v.z,
            m[1] * v.x + m[5] * v.y + m[9] * v.z,
            m[2] * v.x + m[6] * v.y + m[10] * v.z
        )
    }

    /// Inverse of a rigid/affine transform. Every matrix this project produces is
    /// a rotation plus a translation with unit scale (bone scale is forbidden by
    /// the template contract), so the cheap analytic inverse is exact and avoids
    /// the error a general 4x4 inversion accumulates down a deep bone chain.
    public var inverseAffine: Mat4 {
        // R^T
        var out = Mat4.identity
        for r in 0..<3 {
            for c in 0..<3 {
                out[r, c] = self[c, r]
            }
        }
        let t = translation
        let it = out.transform(vector: t)
        out.translation = Vec3(-it.x, -it.y, -it.z)
        return out
    }

    /// Largest absolute element-wise difference; used by tests and the
    /// rest == bind invariant check.
    public func maxDifference(from other: Mat4) -> Double {
        var worst = 0.0
        for i in 0..<16 { worst = max(worst, abs(m[i] - other.m[i])) }
        return worst
    }

    /// Row-major float array, the layout glTF `inverseBindMatrices` accessors and
    /// FBX cluster matrices both read back as column-major floats.
    public var floats: [Float] { m.map { Float($0) } }
}
