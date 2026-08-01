/**
 * outline.js — inverted-hull ink outlines.
 *
 * The hull trick: draw a slightly inflated copy of the mesh with side:BackSide
 * in ink. The back faces survive only where they poke out past the front faces,
 * which is exactly the silhouette.
 *
 * Two details separate a good implementation from the usual one:
 *
 *   1. SMOOTHED NORMALS. Procedural geometry (boxes, cones, lathes) has split
 *      normals at hard edges. Pushing along those tears the hull open at every
 *      corner. `ensureSmoothNormals` welds vertices by position and averages
 *      their normals into a separate `aOutlineNormal` attribute — the shading
 *      normals stay untouched, so faceted forms still shade faceted.
 *
 *   2. CONSTANT SCREEN-SPACE WIDTH. A fixed world-space push gives fat lines up
 *      close and lines that vanish at distance. We push in VIEW space, scaled by
 *      view depth, which the perspective divide then cancels exactly — so a line
 *      asked for at 2.5px is 2.5px whether the bird is filling the screen or is
 *      a dot on the horizon.
 *
 * Outlines are for hero objects only (birds, gates, drones, course furniture).
 * Instanced terrain props deliberately go without: they would double the draw
 * count for lines that read as noise at prop scale, and the mobile budget is
 * better spent on density.
 */

/**
 * Shared across every outline material in the scene: view-space units per
 * screen pixel at unit depth. Updated once per resize / FOV change by
 * `updateOutlineProjection`, so per-frame cost is zero.
 */
export const outlineShared = {
    uUnitPerPixel: { value: 0.0025 },
};

const OUTLINE_VERT = /* glsl */`
attribute vec3 aOutlineNormal;
uniform float uPixels;
uniform float uUnitPerPixel;
uniform float uMaxPush;

void main() {
    vec4 mvPosition = vec4( position, 1.0 );
    vec3 objNormal = aOutlineNormal;

    #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
        objNormal = mat3( instanceMatrix ) * objNormal;
    #endif

    mvPosition = modelViewMatrix * mvPosition;

    vec3 viewNormal = normalize( normalMatrix * objNormal );

    // Depth in front of the camera. Clamped so geometry that crosses the near
    // plane cannot produce a negative (inverted) push.
    float depth = max( -mvPosition.z, 0.05 );

    // push = pixels * (view units per pixel at unit depth) * depth
    // The projection divide by depth then cancels it back to uPixels on screen.
    float push = min( uPixels * uUnitPerPixel * depth, uMaxPush );

    mvPosition.xyz += viewNormal * push;
    gl_Position = projectionMatrix * mvPosition;
}
`;

const OUTLINE_FRAG = /* glsl */`
uniform vec3 uInk;
uniform float uOpacity;
void main() {
    gl_FragColor = vec4( uInk, uOpacity );
    #include <colorspace_fragment>
}
`;

/**
 * Add an `aOutlineNormal` attribute holding area-weighted, position-welded
 * normals. Idempotent — safe to call on shared geometry from several meshes.
 *
 * @param {object} THREE
 * @param {THREE.BufferGeometry} geometry
 * @param {number} [weldEpsilon] positions closer than this collapse together
 */
export function ensureSmoothNormals(THREE, geometry, weldEpsilon = 1e-4) {
    if (geometry.getAttribute('aOutlineNormal')) return geometry;

    const pos = geometry.getAttribute('position');
    if (!pos) return geometry;
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const nrm = geometry.getAttribute('normal');

    const count = pos.count;
    const smooth = new Float32Array(count * 3);

    // Bucket vertices by quantised position. A Map of string keys is fine here:
    // this runs at build time only, never in the game loop.
    const inv = 1 / weldEpsilon;
    const buckets = new Map();
    for (let i = 0; i < count; i++) {
        const key =
            Math.round(pos.getX(i) * inv) + '|' +
            Math.round(pos.getY(i) * inv) + '|' +
            Math.round(pos.getZ(i) * inv);
        let list = buckets.get(key);
        if (!list) { list = []; buckets.set(key, list); }
        list.push(i);
    }

    buckets.forEach((list) => {
        let ax = 0, ay = 0, az = 0;
        for (let k = 0; k < list.length; k++) {
            const i = list[k];
            ax += nrm.getX(i);
            ay += nrm.getY(i);
            az += nrm.getZ(i);
        }
        const len = Math.hypot(ax, ay, az);
        if (len > 1e-8) { ax /= len; ay /= len; az /= len; }
        for (let k = 0; k < list.length; k++) {
            const o = list[k] * 3;
            smooth[o] = ax;
            smooth[o + 1] = ay;
            smooth[o + 2] = az;
        }
    });

    geometry.setAttribute('aOutlineNormal', new THREE.BufferAttribute(smooth, 3));
    return geometry;
}

/**
 * Build an ink material for the inverted hull.
 *
 * @param {object} THREE
 * @param {object} opts
 * @param {number} [opts.color]    ink colour (hex). Deep navy, not black.
 * @param {number} [opts.pixels]   target on-screen line width in CSS pixels
 * @param {number} [opts.opacity]
 * @param {number} [opts.maxPush]  world-space clamp, stops distant hulls ballooning
 */
export function createOutlineMaterial(THREE, opts = {}) {
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uInk: { value: new THREE.Color(opts.color ?? 0x0f1c33) },
            uOpacity: { value: opts.opacity ?? 1 },
            uPixels: { value: opts.pixels ?? 2.4 },
            uUnitPerPixel: outlineShared.uUnitPerPixel,
            uMaxPush: { value: opts.maxPush ?? 3.5 },
        },
        vertexShader: OUTLINE_VERT,
        fragmentShader: OUTLINE_FRAG,
        side: THREE.BackSide,
        transparent: (opts.opacity ?? 1) < 1,
        depthWrite: true,
        fog: false,
    });
    material.userData.isOutline = true;
    return material;
}

/**
 * Attach an outline hull to a mesh as a child, so it inherits every transform
 * and animation for free.
 *
 * @returns {THREE.Mesh|null} the hull mesh, or null if the target has no geometry
 */
export function attachOutline(THREE, mesh, opts = {}) {
    if (!mesh || !mesh.geometry) return null;
    ensureSmoothNormals(THREE, mesh.geometry);

    const hull = new THREE.Mesh(mesh.geometry, createOutlineMaterial(THREE, opts));
    hull.name = (mesh.name || 'mesh') + '__outline';
    hull.userData.isOutline = true;
    // Hulls must not be picked up by raycasts, bounds fitting or the depth
    // prepass — they are a rendering trick, not part of the scene's geometry.
    hull.raycast = () => {};
    hull.frustumCulled = mesh.frustumCulled;
    hull.renderOrder = (mesh.renderOrder || 0) - 1;
    mesh.add(hull);
    return hull;
}

/**
 * Walk a subtree and outline every visible mesh in it. Used for the birds and
 * the gates, which are built as small hierarchies.
 *
 * @param {(mesh: THREE.Mesh) => boolean} [filter] return false to skip a mesh
 */
export function attachOutlineTree(THREE, root, opts = {}, filter = null) {
    const hulls = [];
    const targets = [];
    root.traverse((child) => {
        if (!child.isMesh) return;
        if (child.userData.isOutline) return;
        if (child.userData.noOutline) return;
        if (child.material && child.material.transparent) return;
        if (filter && filter(child) === false) return;
        targets.push(child);
    });
    // Collect first, then attach — mutating the tree during traverse is asking
    // for the hulls to be traversed and outlined themselves.
    for (let i = 0; i < targets.length; i++) {
        const hull = attachOutline(THREE, targets[i], opts);
        if (hull) hulls.push(hull);
    }
    return hulls;
}

/**
 * Recompute the shared pixel->view-space scale. Call on init, on resize and
 * whenever the camera FOV changes (the speed FOV kick does this, which is also
 * why line width stays stable through a boost).
 *
 * @param {THREE.PerspectiveCamera} camera
 * @param {number} drawingBufferHeight  renderer drawing buffer height in px
 * @param {number} [pixelRatio]         renderer pixel ratio, so `pixels` stays
 *                                      in CSS pixels rather than device pixels
 */
export function updateOutlineProjection(camera, drawingBufferHeight, pixelRatio = 1) {
    if (!camera || !camera.isPerspectiveCamera || !drawingBufferHeight) return;
    const halfFov = (camera.fov * Math.PI) / 360;
    const devicePixels = drawingBufferHeight;
    outlineShared.uUnitPerPixel.value =
        (2 * Math.tan(halfFov) / devicePixels) * pixelRatio;
}

/** Toggle every outline hull under a root (used by the quality tiers). */
export function setOutlinesVisible(root, visible) {
    root.traverse((child) => {
        if (child.userData && child.userData.isOutline) child.visible = visible;
    });
}
