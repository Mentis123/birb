import Foundation
import Metal
import MetalKit
import HumanoidCore

/// Draws one `MeshData` and one albedo texture.
///
/// Deliberately dull. Every decision that could be wrong in an interesting way —
/// where the camera is, what a touch hits, how far a drag moves a vertex — lives
/// in `Camera`, `Picking` and `Sculpt`, which are tested on Linux. What is left
/// here is buffer bookkeeping, and the way to keep it honest is to keep it
/// boring.
final class Renderer: NSObject, MTKViewDelegate {
    /// Must match `Uniforms` in Shaders.metal exactly, in order and in padding.
    /// Metal will not complain about a mismatch; it will just read the wrong
    /// bytes and draw something wrong.
    struct Uniforms {
        var modelViewProjection: simd_float4x4
        var model: simd_float4x4
        var cameraPosition: SIMD3<Float>
        var _pad0: Float = 0
        var lightDirection: SIMD3<Float>
        var _pad1: Float = 0
    }

    private struct Vertex {
        var position: SIMD3<Float>
        var normal: SIMD3<Float>
        var uv: SIMD2<Float>
    }

    private let device: MTLDevice
    private let queue: MTLCommandQueue
    private let pipeline: MTLRenderPipelineState
    private let depthState: MTLDepthStencilState
    private let sampler: MTLSamplerState

    private var vertexBuffer: MTLBuffer?
    private var indexBuffer: MTLBuffer?
    private var indexCount = 0
    private var texture: MTLTexture?

    /// Read every frame by the view; written by the editor when a gesture moves.
    var camera = Camera()
    var backgroundColour = MTLClearColor(red: 0.055, green: 0.063, blue: 0.086, alpha: 1)

    init?(view: MTKView) {
        guard let device = view.device ?? MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue(),
              let library = device.makeDefaultLibrary() else { return nil }
        self.device = device
        self.queue = queue

        view.device = device
        view.colorPixelFormat = .bgra8Unorm_srgb
        view.depthStencilPixelFormat = .depth32Float
        view.sampleCount = 1

        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = library.makeFunction(name: "model_vertex")
        descriptor.fragmentFunction = library.makeFunction(name: "model_fragment")
        descriptor.colorAttachments[0].pixelFormat = view.colorPixelFormat
        descriptor.depthAttachmentPixelFormat = view.depthStencilPixelFormat

        let layout = MTLVertexDescriptor()
        layout.attributes[0].format = .float3
        layout.attributes[0].offset = 0
        layout.attributes[0].bufferIndex = 0
        layout.attributes[1].format = .float3
        layout.attributes[1].offset = MemoryLayout<SIMD3<Float>>.stride
        layout.attributes[1].bufferIndex = 0
        layout.attributes[2].format = .float2
        layout.attributes[2].offset = MemoryLayout<SIMD3<Float>>.stride * 2
        layout.attributes[2].bufferIndex = 0
        layout.layouts[0].stride = MemoryLayout<Vertex>.stride
        descriptor.vertexDescriptor = layout

        guard let pipeline = try? device.makeRenderPipelineState(descriptor: descriptor)
        else { return nil }
        self.pipeline = pipeline

        let depth = MTLDepthStencilDescriptor()
        depth.depthCompareFunction = .less
        depth.isDepthWriteEnabled = true
        guard let depthState = device.makeDepthStencilState(descriptor: depth) else { return nil }
        self.depthState = depthState

        let samplerDescriptor = MTLSamplerDescriptor()
        samplerDescriptor.minFilter = .linear
        samplerDescriptor.magFilter = .linear
        samplerDescriptor.mipFilter = .notMipmapped
        samplerDescriptor.sAddressMode = .clampToEdge
        samplerDescriptor.tAddressMode = .clampToEdge
        guard let sampler = device.makeSamplerState(descriptor: samplerDescriptor) else { return nil }
        self.sampler = sampler

        super.init()
    }

    // MARK: - Uploading

    /// Rebuilds the vertex buffer. Called after every stroke.
    ///
    /// The whole buffer, not just the changed vertices: at 4,000 vertices that
    /// is 128 KB, which is nothing, and a partial update would have to track
    /// dirty ranges in two places and stay in step with them. Revisit only if a
    /// device profile says to.
    func upload(_ mesh: MeshData) {
        var vertices = [Vertex]()
        vertices.reserveCapacity(mesh.vertexCount)
        for i in 0..<mesh.vertexCount {
            let p = mesh.positions[i], n = mesh.normals[i], uv = mesh.uvs[i]
            vertices.append(Vertex(
                position: SIMD3(Float(p.x), Float(p.y), Float(p.z)),
                normal: SIMD3(Float(n.x), Float(n.y), Float(n.z)),
                uv: SIMD2(Float(uv.x), Float(uv.y))))
        }
        vertexBuffer = device.makeBuffer(bytes: vertices,
                                         length: MemoryLayout<Vertex>.stride * vertices.count,
                                         options: .storageModeShared)

        if indexCount != mesh.indices.count {
            // Indices only change when the template does, which is never during
            // an edit — topology is immutable. Rebuilding them per stroke would
            // be pure waste.
            let indices = mesh.indices.map { UInt32($0) }
            indexBuffer = device.makeBuffer(bytes: indices,
                                            length: MemoryLayout<UInt32>.stride * indices.count,
                                            options: .storageModeShared)
            indexCount = indices.count
        }
    }

    func upload(albedo: PNG.Image) {
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .rgba8Unorm_srgb, width: albedo.width, height: albedo.height,
            mipmapped: false)
        descriptor.usage = .shaderRead
        guard let texture = device.makeTexture(descriptor: descriptor) else { return }
        albedo.rgba.withUnsafeBytes { bytes in
            texture.replace(region: MTLRegionMake2D(0, 0, albedo.width, albedo.height),
                            mipmapLevel: 0,
                            withBytes: bytes.baseAddress!,
                            bytesPerRow: albedo.width * 4)
        }
        self.texture = texture
    }

    // MARK: - Drawing

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        guard let descriptor = view.currentRenderPassDescriptor,
              let drawable = view.currentDrawable,
              let vertexBuffer, let indexBuffer, indexCount > 0,
              let buffer = queue.makeCommandBuffer() else { return }

        descriptor.colorAttachments[0].clearColor = backgroundColour
        descriptor.colorAttachments[0].loadAction = .clear
        descriptor.depthAttachment.clearDepth = 1.0

        guard let encoder = buffer.makeRenderCommandEncoder(descriptor: descriptor) else { return }
        encoder.setRenderPipelineState(pipeline)
        encoder.setDepthStencilState(depthState)
        encoder.setCullMode(.back)
        encoder.setFrontFacingWinding(.counterClockwise)

        let size = view.drawableSize
        let aspect = size.height > 0 ? Double(size.width / size.height) : 1
        let projection = camera.projectionMatrix(aspect: aspect)
        let viewMatrix = camera.viewMatrix
        let model = Mat4.identity

        var uniforms = Uniforms(
            modelViewProjection: float4x4(projection * viewMatrix * model),
            model: float4x4(model),
            cameraPosition: SIMD3(Float(camera.eye.x), Float(camera.eye.y), Float(camera.eye.z)),
            // Over the viewer's shoulder and a little to the side, so the light
            // moves with the camera and the surface you are looking at is always
            // the lit one.
            lightDirection: {
                let d = normalize(camera.forward - camera.up * 0.55 - camera.right * 0.35)
                return SIMD3(Float(d.x), Float(d.y), Float(d.z))
            }())

        encoder.setVertexBuffer(vertexBuffer, offset: 0, index: 0)
        encoder.setVertexBytes(&uniforms, length: MemoryLayout<Uniforms>.stride, index: 1)
        encoder.setFragmentBytes(&uniforms, length: MemoryLayout<Uniforms>.stride, index: 1)
        encoder.setFragmentTexture(texture, index: 0)
        encoder.setFragmentSamplerState(sampler, index: 0)
        encoder.drawIndexedPrimitives(type: .triangle, indexCount: indexCount,
                                      indexType: .uint32, indexBuffer: indexBuffer,
                                      indexBufferOffset: 0)
        encoder.endEncoding()
        buffer.present(drawable)
        buffer.commit()
    }
}

private extension Mat4 {
    static var identity: Mat4 {
        Mat4([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    }
}

/// `Mat4` is column-major, and so is `simd_float4x4`, so the columns map across
/// in order with no transpose. Adding one "to be safe" is the standard way to
/// end up with a scene that is mirrored or inside out.
private func float4x4(_ m: Mat4) -> simd_float4x4 {
    let f = m.floats
    return simd_float4x4(SIMD4(f[0], f[1], f[2], f[3]),
                         SIMD4(f[4], f[5], f[6], f[7]),
                         SIMD4(f[8], f[9], f[10], f[11]),
                         SIMD4(f[12], f[13], f[14], f[15]))
}
