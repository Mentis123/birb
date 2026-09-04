import Foundation

/// Reader for the `BIRBHUM1` body template.
///
/// The template is baked offline by `tools/build_template.py` (headless Blender,
/// from MakeHuman's CC0 base mesh) and shipped in the app bundle. Baking it is
/// not something the app can do: bone-heat weighting is a sparse Laplacian solve
/// over the whole mesh, and there is no reason to pay for it on an iPad once per
/// launch when the answer never changes.
///
/// The format is deliberately flat and little-endian so a load is a handful of
/// bounds-checked reads with no parsing, no compression and no allocation beyond
/// the arrays themselves.
///
///     magic     8 bytes  "BIRBHUM1"
///     header    3 x u32  boneCount, vertexCount, indexCount
///     bones     boneCount x { u16 nameLength, utf8 name,
///                             i32 parentIndex (-1 for the root),
///                             3 x f32 head position }
///     positions vertexCount x 3 x f32
///     normals   vertexCount x 3 x f32
///     uvs       vertexCount x 2 x f32
///     indices   indexCount x u32
///     skin      vertexCount x { u8 count, count x { u16 bone, f32 weight } }
///
/// Coordinates are already in the canonical space `Skeleton` documents: metres,
/// +Y up, ground at y = 0, figure facing +Z, +X the figure's own left. Nothing
/// here converts anything, and a template that disagrees is a bug in the baker.
///
/// Every failure is thrown rather than trapped. A truncated or renamed template
/// is a shipping mistake, and the app has to be able to say which one it was.
public enum TemplateFile {
    public struct Loaded: Sendable {
        public let skeleton: Skeleton
        public let mesh: MeshData
    }

    public enum LoadError: Error, CustomStringConvertible, Equatable {
        case badMagic(found: String)
        case truncated(needed: Int, available: Int)
        case unknownBone(String)
        case duplicateBone(String)
        case badParent(bone: String, parent: Int)
        case parentNotEarlier(bone: String, parent: Int, index: Int)
        case multipleRoots([String])
        case noRoot
        case badIndex(UInt32, vertexCount: Int)
        case indexCountNotTriangles(Int)
        case badInfluenceBone(UInt16, boneCount: Int)
        case trailingBytes(Int)

        public var description: String {
            switch self {
            case .badMagic(let found):
                return "not a BIRBHUM1 template (magic was \"\(found)\")"
            case .truncated(let needed, let available):
                return "template is truncated: needed \(needed) bytes, \(available) remain"
            case .unknownBone(let name):
                return "template names a bone the rig has no slot for: \"\(name)\""
            case .duplicateBone(let name):
                return "template declares \"\(name)\" twice"
            case .badParent(let bone, let parent):
                return "\"\(bone)\" has parent index \(parent), which is out of range"
            case .parentNotEarlier(let bone, let parent, let index):
                return "\"\(bone)\" is bone \(index) but its parent is \(parent); "
                    + "parents must precede their children"
            case .multipleRoots(let names):
                return "template has more than one root bone: \(names.joined(separator: ", "))"
            case .noRoot:
                return "template has no root bone"
            case .badIndex(let index, let vertexCount):
                return "triangle index \(index) is out of range for \(vertexCount) vertices"
            case .indexCountNotTriangles(let count):
                return "index count \(count) is not a whole number of triangles"
            case .badInfluenceBone(let bone, let boneCount):
                return "a vertex is weighted to bone \(bone), but the rig has \(boneCount)"
            case .trailingBytes(let count):
                return "\(count) bytes follow the end of the template; "
                    + "the writer and this reader disagree about the layout"
            }
        }
    }

    public static func load(contentsOf url: URL) throws -> Loaded {
        try load(Data(contentsOf: url))
    }

    public static func load(_ data: Data) throws -> Loaded {
        var cursor = Cursor(data)

        let magic = try cursor.bytes(8)
        guard magic.elementsEqual("BIRBHUM1".utf8) else {
            throw LoadError.badMagic(found: String(decoding: magic, as: UTF8.self))
        }

        let boneCount = Int(try cursor.u32())
        let vertexCount = Int(try cursor.u32())
        let indexCount = Int(try cursor.u32())
        guard indexCount % 3 == 0 else { throw LoadError.indexCountNotTriangles(indexCount) }

        // Bone names are the Unity spelling, which is also what the exporters
        // write as node names, so the mapping back is exact rather than fuzzy.
        var byNodeName = [String: HumanBone]()
        for bone in HumanBone.allCases { byNodeName[bone.unityNodeName] = bone }

        var names = [String]()
        var seen = Set<String>()
        var parents = [Int]()
        var heads = [Vec3]()
        names.reserveCapacity(boneCount)
        for index in 0..<boneCount {
            let nameLength = Int(try cursor.u16())
            let name = String(decoding: try cursor.bytes(nameLength), as: UTF8.self)
            let parent = Int(try cursor.i32())
            let head = Vec3(Double(try cursor.f32()),
                            Double(try cursor.f32()),
                            Double(try cursor.f32()))
            guard byNodeName[name] != nil else { throw LoadError.unknownBone(name) }
            guard seen.insert(name).inserted else { throw LoadError.duplicateBone(name) }
            if parent >= 0 {
                guard parent < boneCount else { throw LoadError.badParent(bone: name, parent: parent) }
                guard parent < index else {
                    throw LoadError.parentNotEarlier(bone: name, parent: parent, index: index)
                }
            }
            names.append(name)
            parents.append(parent)
            heads.append(head)
        }

        let roots = zip(names, parents).filter { $0.1 < 0 }.map(\.0)
        guard !roots.isEmpty else { throw LoadError.noRoot }
        guard roots.count == 1 else { throw LoadError.multipleRoots(roots) }

        let specs = (0..<boneCount).map { index in
            BoneSpec(byNodeName[names[index]]!,
                     parent: parents[index] < 0 ? nil : byNodeName[names[parents[index]]]!,
                     at: heads[index])
        }
        let skeleton = Skeleton(bones: specs)

        var positions = [Vec3](); positions.reserveCapacity(vertexCount)
        for _ in 0..<vertexCount {
            positions.append(Vec3(Double(try cursor.f32()),
                                  Double(try cursor.f32()),
                                  Double(try cursor.f32())))
        }
        var normals = [Vec3](); normals.reserveCapacity(vertexCount)
        for _ in 0..<vertexCount {
            normals.append(Vec3(Double(try cursor.f32()),
                                Double(try cursor.f32()),
                                Double(try cursor.f32())))
        }
        var uvs = [Vec2](); uvs.reserveCapacity(vertexCount)
        for _ in 0..<vertexCount {
            uvs.append(Vec2(Double(try cursor.f32()), Double(try cursor.f32())))
        }
        var indices = [UInt32](); indices.reserveCapacity(indexCount)
        for _ in 0..<indexCount {
            let index = try cursor.u32()
            guard index < UInt32(vertexCount) else {
                throw LoadError.badIndex(index, vertexCount: vertexCount)
            }
            indices.append(index)
        }

        var influences = [[MeshData.Influence]](); influences.reserveCapacity(vertexCount)
        for _ in 0..<vertexCount {
            let count = Int(try cursor.u8())
            var entry = [MeshData.Influence]()
            entry.reserveCapacity(count)
            for _ in 0..<count {
                let bone = try cursor.u16()
                let weight = Double(try cursor.f32())
                guard Int(bone) < boneCount else {
                    throw LoadError.badInfluenceBone(bone, boneCount: boneCount)
                }
                entry.append(MeshData.Influence(bone: Int(bone), weight: weight))
            }
            influences.append(entry)
        }

        guard cursor.isAtEnd else { throw LoadError.trailingBytes(cursor.remaining) }

        let mesh = MeshData(positions: positions, normals: normals, uvs: uvs,
                            indices: indices, influences: influences)
        return Loaded(skeleton: skeleton, mesh: mesh)
    }

    /// Bounds-checked forward reader. Every read either advances or throws, so a
    /// truncated file cannot be read past its end and cannot trap.
    private struct Cursor {
        private let data: Data
        private var offset: Int

        init(_ data: Data) {
            self.data = data
            self.offset = data.startIndex
        }

        var remaining: Int { data.endIndex - offset }
        var isAtEnd: Bool { remaining == 0 }

        mutating func bytes(_ count: Int) throws -> Data {
            guard remaining >= count else {
                throw LoadError.truncated(needed: count, available: remaining)
            }
            defer { offset += count }
            return data[offset..<(offset + count)]
        }

        mutating func u8() throws -> UInt8 { try bytes(1).first! }

        mutating func u16() throws -> UInt16 {
            var value: UInt16 = 0
            for (shift, byte) in try bytes(2).enumerated() {
                value |= UInt16(byte) << (8 * UInt16(shift))
            }
            return value
        }

        mutating func u32() throws -> UInt32 {
            var value: UInt32 = 0
            for (shift, byte) in try bytes(4).enumerated() {
                value |= UInt32(byte) << (8 * UInt32(shift))
            }
            return value
        }

        mutating func i32() throws -> Int32 { Int32(bitPattern: try u32()) }

        /// The bit pattern is reassembled by hand rather than reinterpreted from
        /// the slice: `Data` gives no alignment guarantee, and loading a Float32
        /// from an unaligned address is undefined.
        mutating func f32() throws -> Float { Float(bitPattern: try u32()) }
    }
}

extension TemplateFile {
    /// Identifier and version recorded in every export, so a file can be traced
    /// back to the exact template it came from.
    public static let bundledID = "makehuman-hm08-reduced"
    public static let bundledVersion = "1"

    /// The template shipped inside the package.
    ///
    /// Derived from MakeHuman's `base.obj` (hm08 base mesh), which is CC0. See
    /// `Sources/HumanoidCore/Resources/NOTICE.md`.
    public static func bundled() throws -> Loaded {
        guard let url = Bundle.module.url(forResource: "body-v1", withExtension: "bin") else {
            throw LoadError.badMagic(found: "<body-v1.bin missing from the bundle>")
        }
        return try load(contentsOf: url)
    }
}
