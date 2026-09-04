import Foundation
import CZlibShim

/// Minimal PNG writer for the exported albedo.
///
/// Why this exists rather than `UIImage.pngData()`: that is UIKit, so it cannot
/// run in CI on Linux, and the export path must produce byte-identical output on
/// the iPad and on the build box (the SHA-256 handshake in the export manifest
/// depends on it).
///
/// Why it uses zlib rather than Foundation: PNG's IDAT payload is an RFC 1950
/// zlib stream (0x78 header, Adler-32 trailer). Foundation's `.zlib` compression
/// algorithm emits RFC 1951 *raw* deflate with neither. A PNG built that way
/// still passes the Khronos glTF validator, because that validator only reads the
/// image header and never inflates the data, but no real decoder can open it.
/// That trap was found by adversarially re-checking the first GLB spike.
public enum PNG {
    public struct Image: Sendable {
        public let width: Int
        public let height: Int
        /// Row-major RGBA8, `width * height * 4` bytes.
        public let rgba: [UInt8]

        public init(width: Int, height: Int, rgba: [UInt8]) {
            precondition(width > 0 && height > 0, "PNG needs a non-empty image")
            precondition(rgba.count == width * height * 4, "rgba must be width*height*4")
            self.width = width
            self.height = height
            self.rgba = rgba
        }

        /// Flat colour fill, the app's "base fill" starting state.
        public static func solid(width: Int, height: Int, r: UInt8, g: UInt8, b: UInt8, a: UInt8 = 255) -> Image {
            var px = [UInt8](repeating: 0, count: width * height * 4)
            for i in stride(from: 0, to: px.count, by: 4) {
                px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a
            }
            return Image(width: width, height: height, rgba: px)
        }
    }

    public enum Failure: Error, CustomStringConvertible {
        case compressionFailed
        public var description: String { "PNG: zlib compression failed" }
    }

    /// Encodes 8-bit RGBA (PNG colour type 6) with filter type 0 on every row.
    /// Deterministic: the same pixels always produce the same bytes.
    public static func encode(_ image: Image, compressionLevel: Int32 = 6) throws -> Data {
        // Raw scanlines, each prefixed with its filter byte.
        var raw = [UInt8]()
        raw.reserveCapacity(image.height * (1 + image.width * 4))
        for y in 0..<image.height {
            raw.append(0) // filter: None
            let start = y * image.width * 4
            raw.append(contentsOf: image.rgba[start..<(start + image.width * 4)])
        }

        var compressed = [UInt8](repeating: 0, count: hc_deflate_bound(raw.count))
        let written = raw.withUnsafeBufferPointer { src in
            compressed.withUnsafeMutableBufferPointer { dst in
                hc_zlib_compress(src.baseAddress!, src.count, dst.baseAddress!, dst.count, compressionLevel)
            }
        }
        guard written > 0 else { throw Failure.compressionFailed }
        compressed.removeLast(compressed.count - written)

        var out = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

        var ihdr = Data()
        ihdr.appendBigEndian(UInt32(image.width))
        ihdr.appendBigEndian(UInt32(image.height))
        ihdr.append(contentsOf: [8, 6, 0, 0, 0]) // depth 8, RGBA, deflate, adaptive filter, no interlace
        out.append(chunk(type: "IHDR", payload: ihdr))
        out.append(chunk(type: "IDAT", payload: Data(compressed)))
        out.append(chunk(type: "IEND", payload: Data()))
        return out
    }

    /// Inflates an IDAT payload. Tests use it to prove the stream really decodes;
    /// a structural check alone would not.
    public static func inflate(_ data: Data, expectedByteCount: Int) -> [UInt8]? {
        var out = [UInt8](repeating: 0, count: expectedByteCount)
        let n = data.withUnsafeBytes { src -> Int in
            guard let base = src.bindMemory(to: UInt8.self).baseAddress else { return 0 }
            return out.withUnsafeMutableBufferPointer { dst in
                hc_zlib_decompress(base, src.count, dst.baseAddress!, dst.count)
            }
        }
        guard n == expectedByteCount else { return nil }
        return out
    }

    private static func chunk(type: String, payload: Data) -> Data {
        var out = Data()
        out.appendBigEndian(UInt32(payload.count))
        let typeBytes = Data(type.utf8)
        out.append(typeBytes)
        out.append(payload)
        var crc: UInt32 = 0
        var body = typeBytes
        body.append(payload)
        body.withUnsafeBytes { buf in
            if let base = buf.bindMemory(to: UInt8.self).baseAddress {
                crc = hc_crc32(0, base, buf.count)
            }
        }
        out.appendBigEndian(crc)
        return out
    }
}

/// Byte-order helpers shared by the PNG writer and the GLB writer. Both formats
/// are explicit about endianness (PNG big, glTF little) and getting one wrong
/// produces a file that fails far away from the mistake.
extension Data {
    public mutating func appendBigEndian(_ value: UInt32) {
        append(contentsOf: [
            UInt8((value >> 24) & 0xFF), UInt8((value >> 16) & 0xFF),
            UInt8((value >> 8) & 0xFF), UInt8(value & 0xFF),
        ])
    }
    public mutating func appendLittleEndian(_ value: UInt32) {
        append(contentsOf: [
            UInt8(value & 0xFF), UInt8((value >> 8) & 0xFF),
            UInt8((value >> 16) & 0xFF), UInt8((value >> 24) & 0xFF),
        ])
    }
    public mutating func appendLittleEndian(_ value: Float) {
        appendLittleEndian(value.bitPattern)
    }
    public mutating func appendLittleEndian(_ value: UInt16) {
        append(contentsOf: [UInt8(value & 0xFF), UInt8((value >> 8) & 0xFF)])
    }
}
