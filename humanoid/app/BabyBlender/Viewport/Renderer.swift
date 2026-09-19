import Foundation
import Metal
import MetalKit
import HumanoidCore

/// Draws one `MeshData`, one albedo texture, and the brush cursor.
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

    /// Must match `CursorUniforms` in Shaders.metal.
    struct CursorUniforms {
        var modelViewProjection: simd_float4x4
        var colour: SIMD4<Float>
    }

    private struct Vertex {
        var position: SIMD3<Float>
        var normal: SIMD3<Float>
        var uv: SIMD2<Float>
    }

    /// Where the brush will land, drawn as a ring lying on the surface.
    struct Cursor {
        var centre: Vec3
        var normal: Vec3
        /// World-space radius — the brush's real size, so the ring answers
        /// "how big is my brush" honestly at every zoom.
        var radius: Double
        /// 0...1. Faint when the Pencil is far from the glass, solid as it
        /// approaches, which is the whole point of hover.
        var strength: Double
        var painting: Bool
    }

    /// What the last frame actually cost. Read by the debug HUD.
    struct FrameStats {
        var drawCalls = 0
        var triangles = 0
        /// Milliseconds the GPU spent, from the command buffer's own clock.
        var gpuMilliseconds: Double = 0
    }

    private let device: MTLDevice
    private let queue: MTLCommandQueue
    private let pipeline: MTLRenderPipelineState
    private let cursorPipeline: MTLRenderPipelineState
    private let depthState: MTLDepthStencilState
    private let cursorDepthState: MTLDepthStencilState
    private let sampler: MTLSamplerState

    /// Three vertex buffers in rotation, with a semaphore.
    ///
    /// One buffer written by the CPU while the GPU may still be reading the
    /// previous frame from it is a torn mesh. Three is Apple's recommended depth
    /// and it is what lets the CPU build frame n+1 while the GPU draws frame n.
    /// The old code sidestepped the race by allocating a fresh buffer per upload
    /// — correct, but an allocation on the render path after every stroke.
    private static let bufferCount = 3
    private var vertexBuffers: [MTLBuffer] = []
    private var vertexSlot = 0
    private let inFlight = DispatchSemaphore(value: bufferCount)
    private var scratch: [Vertex] = []
    private var vertexCount = 0

    /// Kept only so the next frame can read its GPU timestamps.
    private var lastCommitted: MTLCommandBuffer?
    private var indexBuffer: MTLBuffer?
    private var indexCount = 0
    private var texture: MTLTexture?
    private var cursorBuffer: MTLBuffer?
    private static let cursorSegments = 72

    /// Read every frame by the view; written by the editor when a gesture moves.
    var camera = Camera()
    var cursor: Cursor?
    var backgroundColour = MTLClearColor(red: 0.055, green: 0.063, blue: 0.086, alpha: 1)
    private(set) var stats = FrameStats()
    /// Called at the top of every frame, before anything is encoded. The editor
    /// drains a frame's worth of Pencil samples here, so input is paid for once
    /// per frame instead of once per event.
    var beforeDraw: (() -> Void)?

    /// 4x multisampling. Apple GPUs resolve multisample colour in tile memory,
    /// so the cost is close to nothing and it removes the shimmer from every
    /// sculpted edge — which on a modelling tool is most of the silhouette.
    static let sampleCount = 4

    init?(view: MTKView) {
        guard let device = view.device ?? MTLCreateSystemDefaultDevice(),
              let queue = device.makeCommandQueue(),
              let library = device.makeDefaultLibrary() else { return nil }
        self.device = device
        self.queue = queue

        view.device = device
        view.colorPixelFormat = .bgra8Unorm_srgb
        view.depthStencilPixelFormat = .depth32Float
        view.sampleCount = Renderer.sampleCount

        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = library.makeFunction(name: "model_vertex")
        descriptor.fragmentFunction = library.makeFunction(name: "model_fragment")
        descriptor.colorAttachments[0].pixelFormat = view.colorPixelFormat
        descriptor.depthAttachmentPixelFormat = view.depthStencilPixelFormat
        descriptor.rasterSampleCount = Renderer.sampleCount

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

        // The cursor ring: a line strip of bare positions, blended over the
        // model. Its own pipeline because it shares no vertex layout with the
        // mesh and wants no lighting.
        let cursorDescriptor = MTLRenderPipelineDescriptor()
        cursorDescriptor.vertexFunction = library.makeFunction(name: "cursor_vertex")
        cursorDescriptor.fragmentFunction = library.makeFunction(name: "cursor_fragment")
        cursorDescriptor.colorAttachments[0].pixelFormat = view.colorPixelFormat
        cursorDescriptor.colorAttachments[0].isBlendingEnabled = true
        cursorDescriptor.colorAttachments[0].rgbBlendOperation = .add
        cursorDescriptor.colorAttachments[0].alphaBlendOperation = .add
        cursorDescriptor.colorAttachments[0].sourceRGBBlendFactor = .sourceAlpha
        cursorDescriptor.colorAttachments[0].sourceAlphaBlendFactor = .sourceAlpha
        cursorDescriptor.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
        cursorDescriptor.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
        cursorDescriptor.depthAttachmentPixelFormat = view.depthStencilPixelFormat
        cursorDescriptor.rasterSampleCount = Renderer.sampleCount

        let cursorLayout = MTLVertexDescriptor()
        cursorLayout.attributes[0].format = .float3
        cursorLayout.attributes[0].offset = 0
        cursorLayout.attributes[0].bufferIndex = 0
        cursorLayout.layouts[0].stride = MemoryLayout<SIMD3<Float>>.stride
        cursorDescriptor.vertexDescriptor = cursorLayout

        guard let cursorPipeline = try? device.makeRenderPipelineState(descriptor: cursorDescriptor)
        else { return nil }
        self.cursorPipeline = cursorPipeline

        let depth = MTLDepthStencilDescriptor()
        depth.depthCompareFunction = .less
        depth.isDepthWriteEnabled = true
        guard let depthState = device.makeDepthStencilState(descriptor: depth) else { return nil }
        self.depthState = depthState

        // The ring is lifted off the surface by the geometry rather than by a
        // depth bias, but it must not write depth or it shadows itself at the
        // crossings of the line strip.
        let cursorDepth = MTLDepthStencilDescriptor()
        cursorDepth.depthCompareFunction = .lessEqual
        cursorDepth.isDepthWriteEnabled = false
        guard let cursorDepthState = device.makeDepthStencilState(descriptor: cursorDepth)
        else { return nil }
        self.cursorDepthState = cursorDepthState

        let samplerDescriptor = MTLSamplerDescriptor()
        samplerDescriptor.minFilter = .linear
        samplerDescriptor.magFilter = .linear
        samplerDescriptor.mipFilter = .notMipmapped
        samplerDescriptor.sAddressMode = .clampToEdge
        samplerDescriptor.tAddressMode = .clampToEdge
        guard let sampler = device.makeSamplerState(descriptor: samplerDescriptor) else { return nil }
        self.sampler = sampler

        cursorBuffer = device.makeBuffer(
            length: MemoryLayout<SIMD3<Float>>.stride * (Renderer.cursorSegments + 1),
            options: .storageModeShared)

        super.init()
    }

    // MARK: - Uploading

    /// Rebuilds the vertex buffer.
    ///
    /// The whole buffer, not the changed vertices. That is a measured choice
    /// rather than laziness: converting all 3,750 vertices to Float costs
    /// 0.026 ms, while a partial update would have to track which normals the
    /// one-ring dirtied in two places and keep them in step — a stale-normal bug
    /// waiting to happen, in exchange for a fortieth of a frame. What mattered
    /// was not allocating a buffer to do it in.
    func upload(_ mesh: MeshData) {
        if scratch.count != mesh.vertexCount {
            scratch = [Vertex](repeating: Vertex(position: .zero, normal: .zero, uv: .zero),
                               count: mesh.vertexCount)
            vertexBuffers.removeAll(keepingCapacity: true)
            let length = MemoryLayout<Vertex>.stride * max(1, mesh.vertexCount)
            for _ in 0..<Renderer.bufferCount {
                guard let buffer = device.makeBuffer(length: length, options: .storageModeShared)
                else { return }
                vertexBuffers.append(buffer)
            }
        }
        for i in 0..<mesh.vertexCount {
            let p = mesh.positions[i], n = mesh.normals[i], uv = mesh.uvs[i]
            scratch[i] = Vertex(
                position: SIMD3(Float(p.x), Float(p.y), Float(p.z)),
                normal: SIMD3(Float(n.x), Float(n.y), Float(n.z)),
                uv: SIMD2(Float(uv.x), Float(uv.y)))
        }
        vertexCount = mesh.vertexCount

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
        if texture?.width != albedo.width || texture?.height != albedo.height {
            let descriptor = MTLTextureDescriptor.texture2DDescriptor(
                pixelFormat: .rgba8Unorm_srgb, width: albedo.width, height: albedo.height,
                mipmapped: false)
            descriptor.usage = .shaderRead
            texture = device.makeTexture(descriptor: descriptor)
        }
        guard let texture else { return }
        albedo.rgba.withUnsafeBytes { bytes in
            texture.replace(region: MTLRegionMake2D(0, 0, albedo.width, albedo.height),
                            mipmapLevel: 0,
                            withBytes: bytes.baseAddress!,
                            bytesPerRow: albedo.width * 4)
        }
    }

    /// Uploads only the rectangle a paint stroke touched.
    ///
    /// Unlike the vertex buffer this is worth doing: the albedo is 4 MB at 1024
    /// and 16 MB at 2048, and a brush stroke usually dirties a few thousand
    /// texels of it. Re-sending the whole thing every frame of a stroke is the
    /// one upload big enough to matter.
    func update(albedo: PNG.Image, rect: Paint.Rect) {
        guard let texture, !rect.isEmpty else { return }
        let width = rect.maxX - rect.minX + 1
        let height = rect.maxY - rect.minY + 1
        guard width > 0, height > 0,
              rect.minX >= 0, rect.minY >= 0,
              rect.maxX < albedo.width, rect.maxY < albedo.height else { return }

        var rows = [UInt8](repeating: 0, count: width * height * 4)
        rows.withUnsafeMutableBufferPointer { destination in
            albedo.rgba.withUnsafeBufferPointer { source in
                for y in 0..<height {
                    let from = ((rect.minY + y) * albedo.width + rect.minX) * 4
                    let to = y * width * 4
                    destination.baseAddress!.advanced(by: to)
                        .update(from: source.baseAddress!.advanced(by: from), count: width * 4)
                }
            }
        }
        rows.withUnsafeBytes { bytes in
            texture.replace(region: MTLRegionMake2D(rect.minX, rect.minY, width, height),
                            mipmapLevel: 0,
                            withBytes: bytes.baseAddress!,
                            bytesPerRow: width * 4)
        }
    }

    // MARK: - Drawing

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    func draw(in view: MTKView) {
        // Last frame's GPU time, now that it has certainly finished.
        if let previous = lastCommitted, previous.status == .completed {
            stats.gpuMilliseconds = (previous.gpuEndTime - previous.gpuStartTime) * 1000
            lastCommitted = nil
        }
        beforeDraw?()

        guard let descriptor = view.currentRenderPassDescriptor,
              let drawable = view.currentDrawable,
              let indexBuffer, indexCount > 0, !vertexBuffers.isEmpty,
              let buffer = queue.makeCommandBuffer() else { return }

        // Wait for a vertex buffer the GPU has finished with, then fill it.
        inFlight.wait()
        vertexSlot = (vertexSlot + 1) % Renderer.bufferCount
        let vertexBuffer = vertexBuffers[vertexSlot]
        scratch.withUnsafeBytes { bytes in
            vertexBuffer.contents().copyMemory(from: bytes.baseAddress!,
                                               byteCount: MemoryLayout<Vertex>.stride * vertexCount)
        }
        // Only the semaphore is touched from the completion handler, and only
        // the semaphore is captured. Writing `stats` from there would be a
        // cross-thread write to a field the main thread reads every frame — a
        // data race for the sake of a debug readout. The GPU clock is read
        // instead on the next frame, from the buffer itself, on the main thread.
        buffer.addCompletedHandler { [inFlight] _ in inFlight.signal() }

        descriptor.colorAttachments[0].clearColor = backgroundColour
        descriptor.colorAttachments[0].loadAction = .clear
        descriptor.depthAttachment.clearDepth = 1.0

        guard let encoder = buffer.makeRenderCommandEncoder(descriptor: descriptor) else {
            // The semaphore has been taken and no completion handler will run.
            inFlight.signal()
            return
        }
        encoder.setRenderPipelineState(pipeline)
        encoder.setDepthStencilState(depthState)
        encoder.setCullMode(.back)
        encoder.setFrontFacingWinding(.counterClockwise)

        let size = view.drawableSize
        let aspect = size.height > 0 ? Double(size.width / size.height) : 1
        let projection = camera.projectionMatrix(aspect: aspect)
        let viewProjection = projection * camera.viewMatrix
        let model = Mat4.identity

        var uniforms = Uniforms(
            modelViewProjection: float4x4(viewProjection * model),
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
        var drawCalls = 1

        if let cursor, cursor.strength > 0.01, let cursorBuffer,
           writeCursorRing(cursor, into: cursorBuffer) {
            encoder.setRenderPipelineState(cursorPipeline)
            encoder.setDepthStencilState(cursorDepthState)
            encoder.setCullMode(.none)
            let tint: SIMD4<Float> = cursor.painting
                ? SIMD4(0.98, 0.86, 0.32, Float(cursor.strength))
                : SIMD4(0.30, 0.94, 1.0, Float(cursor.strength))
            var cursorUniforms = CursorUniforms(modelViewProjection: float4x4(viewProjection),
                                                colour: tint)
            encoder.setVertexBuffer(cursorBuffer, offset: 0, index: 0)
            encoder.setVertexBytes(&cursorUniforms,
                                   length: MemoryLayout<CursorUniforms>.stride, index: 1)
            encoder.setFragmentBytes(&cursorUniforms,
                                     length: MemoryLayout<CursorUniforms>.stride, index: 1)
            encoder.drawPrimitives(type: .lineStrip, vertexStart: 0,
                                   vertexCount: Renderer.cursorSegments + 1)
            drawCalls += 1
        }

        encoder.endEncoding()
        buffer.present(drawable)
        buffer.commit()
        lastCommitted = buffer

        stats.drawCalls = drawCalls
        stats.triangles = indexCount / 3
    }

    /// Builds the ring in world space, lying on the tangent plane at the hit.
    ///
    /// Drawn in the plane of the surface rather than as a screen-space circle,
    /// because it has a second job besides marking the spot: it is the only
    /// honest answer to "how big is my brush", and a flat disc on the model
    /// shows foreshortening on a slope where a screen circle would lie.
    private func writeCursorRing(_ cursor: Cursor, into buffer: MTLBuffer) -> Bool {
        let normal = normalize(cursor.normal)
        guard normal.x.isFinite, cursor.radius > 0 else { return false }
        // Any vector not parallel to the normal will do for the first tangent.
        let seed = abs(normal.y) < 0.9 ? Vec3(0, 1, 0) : Vec3(1, 0, 0)
        let tangent = normalize(cross(seed, normal))
        let bitangent = cross(normal, tangent)
        // Lifted a fraction of the radius off the surface so the ring is not
        // z-fighting with the triangles it sits on.
        let centre = cursor.centre + normal * (cursor.radius * 0.03)

        let points = buffer.contents().bindMemory(to: SIMD3<Float>.self,
                                                  capacity: Renderer.cursorSegments + 1)
        for i in 0...Renderer.cursorSegments {
            let angle = Double(i) / Double(Renderer.cursorSegments) * 2 * .pi
            let p = centre + (tangent * cos(angle) + bitangent * sin(angle)) * cursor.radius
            points[i] = SIMD3(Float(p.x), Float(p.y), Float(p.z))
        }
        return true
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
