import XCTest
@testable import HumanoidCore

final class PNGTests: XCTestCase {
    func testHeaderAndChunkStructure() throws {
        let img = PNG.Image.solid(width: 4, height: 3, r: 10, g: 20, b: 30)
        let data = try PNG.encode(img)

        XCTAssertEqual(Array(data.prefix(8)), [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
        let text = String(decoding: data, as: UTF8.self)
        XCTAssertTrue(text.contains("IHDR"))
        XCTAssertTrue(text.contains("IDAT"))
        XCTAssertTrue(text.contains("IEND"))

        // IHDR payload starts at byte 16: width, height, then depth/colour type.
        let w = data[16..<20].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        let h = data[20..<24].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
        XCTAssertEqual(w, 4)
        XCTAssertEqual(h, 3)
        XCTAssertEqual(data[24], 8, "bit depth")
        XCTAssertEqual(data[25], 6, "colour type 6 = RGBA")
    }

    /// The assertion the structural validators cannot make. A PNG built on
    /// Foundation's raw-deflate output passes a header check and fails here.
    func testPixelsSurviveARealInflate() throws {
        let width = 5, height = 4
        var rgba = [UInt8](repeating: 0, count: width * height * 4)
        for i in 0..<(width * height) {
            rgba[i * 4 + 0] = UInt8(i * 7 % 256)
            rgba[i * 4 + 1] = UInt8(i * 13 % 256)
            rgba[i * 4 + 2] = UInt8(i * 29 % 256)
            rgba[i * 4 + 3] = 255
        }
        let data = try PNG.encode(PNG.Image(width: width, height: height, rgba: rgba))

        let idat = try XCTUnwrap(extractChunk(named: "IDAT", from: data))
        XCTAssertEqual(idat.first, 0x78, "IDAT must be an RFC 1950 zlib stream, not raw deflate")

        let expected = height * (1 + width * 4)
        let raw = try XCTUnwrap(PNG.inflate(idat, expectedByteCount: expected),
                                "IDAT did not inflate — the stream is not a valid zlib container")

        for y in 0..<height {
            let rowStart = y * (1 + width * 4)
            XCTAssertEqual(raw[rowStart], 0, "filter byte for row \(y)")
            let decoded = Array(raw[(rowStart + 1)..<(rowStart + 1 + width * 4)])
            let original = Array(rgba[(y * width * 4)..<((y + 1) * width * 4)])
            XCTAssertEqual(decoded, original, "row \(y) pixels changed through the encoder")
        }
    }

    func testEncodingIsDeterministic() throws {
        // The export manifest's SHA-256 handshake (iPad output must byte-match CI
        // output for the same document) depends on this.
        let img = PNG.Image.solid(width: 16, height: 16, r: 200, g: 120, b: 90)
        XCTAssertEqual(try PNG.encode(img), try PNG.encode(img))
    }

    func testCompressionActuallyShrinksAFlatFill() throws {
        // A stored-block fallback would make a 2048² albedo ~16 MB.
        let img = PNG.Image.solid(width: 256, height: 256, r: 128, g: 64, b: 32)
        let data = try PNG.encode(img)
        XCTAssertLessThan(data.count, 256 * 256 * 4 / 20, "flat fill should compress hard")
    }

    private func extractChunk(named name: String, from data: Data) -> Data? {
        var i = 8
        let target = Array(name.utf8)
        while i + 8 <= data.count {
            let len = Int(data[i..<(i + 4)].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) })
            let type = Array(data[(i + 4)..<(i + 8)])
            if type == target { return data.subdata(in: (i + 8)..<(i + 8 + len)) }
            i += 12 + len
        }
        return nil
    }
}
