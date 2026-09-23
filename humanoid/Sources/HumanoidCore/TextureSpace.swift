import Foundation

/// Where a UV coordinate lands in the albedo, for every consumer that reads it.
///
/// ## The bug this exists to stop
///
/// The document's UVs follow Blender and FBX: **v runs UP**, and the image's
/// first row is the TOP of the picture, so `v = 1` is row 0. The painter has
/// always written texels that way (`Paint.dab`, `SurfacePaint.Map`), and the
/// FBX exporter hands the UVs over untouched, which is right for FBX.
///
/// Metal and glTF both put the texture's origin at the **top left**: a sample
/// at `t = 0` reads row 0. The renderer passed the UVs through as they were, so
/// every painted texel was sampled from the other end of the image — on the
/// clay atlas, the other ROW of tiles, which is a different face of the cube.
/// Paint the front and it appeared on the left side; paint the top and it
/// appeared on the back. That is "painting doesn't even go on the right sides",
/// and it had been true since the first painter shipped: the UV-space bleed
/// that was blamed for the first report was real, but it was never the whole of
/// it. The VRM/GLB exporter did the same thing to every exported texture.
///
/// Nothing on Linux could see it, because the painter and its tests agree with
/// each other perfectly; the disagreement was between the painter and the GPU.
/// So the conversion lives HERE, in one function per consumer, and the tests
/// sample the painted image back through exactly the function the renderer and
/// the exporter call.
public enum TextureSpace {
    /// The row a UV lands on in the document's albedo, and the column.
    ///
    /// The painter's convention, stated once: `x = u * width`,
    /// `y = (1 - v) * height`, clamped to the image.
    public static func texel(of uv: Vec2, width: Int, height: Int) -> (x: Int, y: Int) {
        let x = Int((uv.x * Double(width)).rounded(.down))
        let y = Int(((1 - uv.y) * Double(height)).rounded(.down))
        return (min(width - 1, max(0, x)), min(height - 1, max(0, y)))
    }

    /// The texture coordinate Metal must be given for a document UV.
    ///
    /// Metal's texture space has its origin at the top left and `replace(region:)`
    /// uploads the image's first row at `t = 0`, so `t` is `1 - v`. The renderer
    /// writes THIS into its vertex buffer; passing `uv` straight through is the
    /// bug described above.
    @inlinable
    public static func metal(_ uv: Vec2) -> Vec2 { Vec2(uv.x, 1 - uv.y) }

    /// The texture coordinate a glTF (VRM, GLB) file must carry for a document
    /// UV. glTF's origin is the top left too — the specification says so in
    /// as many words — and its importers (Blender, UniVRM) flip it back to
    /// their own convention on the way in, which is why writing the document's
    /// UVs raw put every exported texture upside down on the model.
    @inlinable
    public static func gltf(_ uv: Vec2) -> Vec2 { Vec2(uv.x, 1 - uv.y) }

    /// Reads a texture the way a top-left-origin sampler does, nearest texel.
    /// The oracle the tests hold the renderer's and the exporter's conversion
    /// against; not used on any hot path.
    public static func sampleTopLeft(_ image: PNG.Image, at coordinate: Vec2)
        -> (r: UInt8, g: UInt8, b: UInt8) {
        let x = min(image.width - 1, max(0, Int((coordinate.x * Double(image.width)).rounded(.down))))
        let y = min(image.height - 1, max(0, Int((coordinate.y * Double(image.height)).rounded(.down))))
        let i = (y * image.width + x) * 4
        return (image.rgba[i], image.rgba[i + 1], image.rgba[i + 2])
    }
}
