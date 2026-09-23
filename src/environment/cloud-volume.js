/**
 * src/environment/cloud-volume.js — clouds with volume, at mesh cost, and the
 * shadows those clouds actually cast.
 *
 * The forest and mountain clouds are instanced icosphere puffs. Lit as solid
 * Lambert polyhedra they read as what the builder's own comment calls them —
 * "floating rocks" on the phone (opaque, alpha-eroded) and glass pebbles on
 * desktop (a flat 0.6-0.7 opacity with hard facets). A ray-marched volume is
 * the textbook fix and it does not fit here: takram's three-clouds measures
 * 36-53 fps on an iPhone 13 at its LOWEST preset, for the clouds alone.
 *
 * So each puff stays exactly the mesh it was — the same instanced icosphere,
 * the same one draw call — and the fragment shader integrates the cloud
 * ANALYTICALLY along the view ray instead of shading the hull:
 *
 *  - Density is a sphere with quadratic falloff, rho = 1 - r^2, inside a
 *    radius well under the hull's (the icosphere's inradius is 0.934, so
 *    every ray that meets the density also meets the hull and the hull's own
 *    facets carry no density at all — the silhouette is soft by
 *    construction, not by an alpha test). Its optical depth along a chord has
 *    a closed form (Inigo Quilez, "sphere density"; the same trick Epic used
 *    for Robo Recall's fog volumes and matejlou's 2025 "Analytic fog rendering
 *    with volumetric primitives"): measured from the chord's midpoint, the
 *    density along the ray is h^2 - u^2, so the integral from u1 to h is a
 *    cubic in two numbers and never loses precision to a distant camera.
 *  - A perfect sphere is a soap bubble, so each ray sees a sphere whose
 *    radius is picked by the direction of its closest approach through an
 *    |sin| lump field — round crowns, sharp creases, the outline of a cumulus
 *    turret — fixed to the puff in 3D, so it turns as the camera moves round.
 *  - Alpha is 1 - exp(-sigma * tau). Through the centre that is ~0.99; at the
 *    rim it falls smoothly to exactly zero.
 *  - Light is the same integral again, from the scattering point toward the
 *    SUN: Beer's law for self-shadowing, a powder term (Schneider 2015, Nubis)
 *    so the sun-facing skin is not the brightest thing when the sun is behind
 *    you, and a two-lobe Henyey-Greenstein phase whose forward lobe is the
 *    silver lining when you look toward the sun through a thin edge. A second,
 *    flatter, less-extinguished octave stands in for multiple scattering —
 *    without it every cloud rendered mid-grey. Sky light is the chord toward
 *    radial UP (tops bright, bases grey) and the ground bounce the chord
 *    toward radial DOWN — up is radial on this planet, never world +Y. Part
 *    of each depth is taken through the whole CLOUD (its cloud-level shadow
 *    sphere, below, handed to each puff as a per-instance attribute), so a
 *    cluster shades as one body; lit puff by puff, it read as a pile of
 *    bubbles, each with its own silver rim.
 *  - Irradiance comes from three's OWN light uniforms (the hemisphere light,
 *    the ambient, and every directional light aligned with the sun), so a
 *    cloud stays in the exposure of the world under it whatever the sun cycle
 *    or the lighting rig does, with no per-frame code.
 *
 * The camera can be INSIDE a puff (the chase camera trails the bird through
 * the outer third of a cloud that the collider does not cover). Rasterising
 * front faces then draws nothing, so the material is double-sided and the
 * shader keeps exactly ONE face per pixel. The chord is the same analytic
 * integral FROM THE CAMERA whichever face carries it — every ray that meets
 * the density crosses exactly one front face and exactly one back face of a
 * convex hull — so the choice of face never changes the veil over the sky.
 * All it decides is what an OPAQUE object inside the hull gets: a front face
 * is in front of it and veils it with the whole chord (right for a peak
 * wrapped in cloud seen from afar), a back face is behind it and leaves it
 * clear (right for the bird flying through, and the only face there is once
 * the camera is inside). So back faces take over within `nearMargin` world
 * units of the hull, for the camera OR the bird (`setCloudFocusObject`): in
 * that band the bird is still outside the hull, where both faces draw it
 * identically, so the hand-over cannot pop it — and a camera approaching a
 * puff sees it grow and envelop it, never fade out first. `forceSinglePass`
 * is load-bearing: three renders a transparent DoubleSide material in TWO
 * passes by default, which is a second draw call per puff mesh for a face
 * the shader throws away.
 *
 * Every puff of a cloud is one instance of ONE mesh, blended with no depth
 * write, and three sorts transparent OBJECTS, not instances — so the puffs
 * composite in whatever order they were built, and a puff at the back of a
 * cluster, drawn after the one in front of it, is painted OVER it. The
 * cloud mesh's own onBeforeRender re-sorts its instances back to front
 * (`createCloudSorter`: an insertion sort that is one comparison per puff
 * on any frame where nothing swapped, and a 1 KB-per-cloud-mesh re-upload
 * on the frames where something did).
 *
 * Real cloud shadows replace the crossed-sine field `addAtmosphere` darkens
 * the world with — a pattern with no relation to where any cloud is. The
 * cloud-level spheres (at most CLOUD_SHADOW.max) go to every lit world
 * material as one shared uniform array, and each fragment integrates the SAME
 * density along the ray toward the sun: a soft-edged shadow exactly under
 * (and, with a low sun, exactly downwind of) the cloud that casts it, moving
 * when the sun moves. It takes the SUN's light — the directional light
 * shining from the sun, scaled inside three's light loop, never the rim or
 * fill lights that come from elsewhere in the sky — and a share of the sky
 * light with it (CLOUD_SHADOW.sky — this world's sky light is strong enough
 * that a direct-only shadow measured 19% and nobody would see it), and
 * honours `visualUniforms.atmosphere` exactly as the sine field did. Worlds
 * without clouds (canyons, city) never receive the patch and keep the sine
 * field; `?cloudvol=0` restores both biomes exactly. Where the horizon
 * shadow (horizon-shadow.js) is on the same material, the cloud multiplies
 * into ITS sun visibility, so a fragment under a ridge and a cloud loses the
 * sun once, by the product of the two.
 *
 * Everything per frame is uniform reads the GPU does; the only CPU work is
 * `cloudImmersion` and the sort, O(puffs), zero allocation, in the cloud
 * mesh's own onBeforeRender.
 */
import { visualUniforms, ensureWorldVarying } from './visual-style.js';
import { mulberry32 } from './seeded-random.js';

/** `?cloudvol=0` restores the solid puffs and the sine-field shadows. */
export function cloudVolumeRequested(search) {
  return !/[?&]cloudvol=0(?:&|$)/.test(search || '');
}

/**
 * Puff shading. Tuned by capture (docs/perf/gates/G-REALISM-CLOUD-VOLUME.md),
 * live-adjustable through `cloudVolumeUniforms` without a recompile.
 */
export const CLOUD_VOLUME = Object.freeze({
  // Density radius as a fraction of the hull's circumradius. Times
  // (1 + lump) it MUST stay under the icosphere's inradius (0.934): above
  // it, rays graze density outside the hull and the polygon outline comes
  // back as a hard edge. 0.78 x 1.18 = 0.92.
  densityRadius: 0.78,
  // Silhouette lumps: +/- this fraction of the radius, at this frequency
  // around the puff (see birbCloudLump).
  lump: 0.18,
  lumpFreq: 3.2,
  // How much of the sun's and the sky's optical depth comes from the whole
  // CLOUD (the cloud-level spheres) rather than from this puff alone. At 0
  // every puff lights itself and a cloud reads as a pile of bubbles; at 0.8
  // the coarse cloud sphere shadows the sunlit face too and the cloud goes
  // grey. Chosen by capture across four views and two sun heights.
  sunCluster: 0.35,
  skyCluster: 0.5,
  // Optical depth through a puff's centre (sigma). Sets how firm the edge is:
  // alpha 0.9 -> 0.1 across the outer ~30% of the radius at 5.
  opacity: 5.0,
  // Self-shadow: the chord toward the sun, as a multiple of `opacity`.
  sunDepth: 0.9,
  // World units outside a puff's hull where BACK faces take over from front
  // faces, for the camera or the bird (see the module doc). Wider than half
  // the bird's span, so a wingtip cannot be inside the hull while the front
  // faces still veil everything behind them, and far wider than the camera's
  // 0.1 near plane, which would otherwise clip the front face it is at.
  nearMargin: 4,
  // Two-lobe Henyey-Greenstein: forward (silver lining), back, back weight.
  gForward: 0.6,
  gBack: -0.3,
  backWeight: 0.35,
  // Second octave standing in for multiple scattering (weight). A real cloud
  // is white because light scatters in it many times; single scattering
  // alone rendered every cloud mid-grey.
  multiScatter: 1.4,
  // Powder strength (0 = none): dark sun-facing skin when the sun is behind you.
  powder: 0.3,
  // Irradiance gains, in the same units three's Lambert uses.
  sunGain: 1.4,
  skyGain: 1.1,
  // How much sky light reaches the underside through the puff (0-1).
  skyFloor: 0.35,
});

/** Real cloud shadows on the world. */
export const CLOUD_SHADOW = Object.freeze({
  // Uniform-array size. The desktop forest builds exactly 20 clouds.
  max: 20,
  // Fraction of the DIRECT light an optically thick cloud removes.
  strength: 0.88,
  // Optical-depth scale of the shadow ray (the per-cloud sphere is looser
  // than its puffs, so it is a little thinner than a puff).
  opacity: 3.2,
  // Share of that occlusion the SKY light takes too. A cloud overhead hides
  // part of the sky dome as well as the sun, and this world's sky light is
  // strong: measured at a 69-degree sun on the forest floor, the direct term
  // alone was 23% of the light, so a direct-only shadow at 82% occlusion
  // darkened the ground by 19% — a real shadow nobody would see.
  sky: 0.35,
});

/** Shared, mutated in place — every puff material points at these objects. */
export const cloudVolumeUniforms = {
  // x densityRadius, y opacity, z sunDepth, w nearMargin
  shape: { value: new Float32Array(4) },
  // The bird's world position (setCloudFocusObject), or far away when
  // there is no bird: then the camera alone picks the face.
  focus: { value: new Float32Array([1e9, 1e9, 1e9]) },
  // x gForward, y gBack, z backWeight, w multiScatter
  phase: { value: new Float32Array(4) },
  // x powder, y sunGain, z skyGain, w skyFloor
  gain: { value: new Float32Array(4) },
  // x sunCluster, y skyCluster, z lump, w lumpFreq
  cluster: { value: new Float32Array(4) },
  // 1 paints every puff flat dim magenta at its true alpha, so a capture can
  // read coverage as 1 - G(shown) / G(hidden) whatever is behind the cloud.
  debug: { value: 0 },
};

/** Shared by every world material that receives real cloud shadows. */
export const cloudShadowUniforms = {
  // xyz centre, w radius, world space; `count` of them are live.
  spheres: { value: new Float32Array(CLOUD_SHADOW.max * 4) },
  count: { value: 0 },
  // x strength, y opacity, z sky share, w unused
  params: { value: new Float32Array([CLOUD_SHADOW.strength, CLOUD_SHADOW.opacity, CLOUD_SHADOW.sky, 0]) },
  // The in-cloud fog: x amount (the camera's immersion), y 1/length.
  fog: { value: new Float32Array([0, 1 / 9, 0, 0]) },
  // Linear colour of the in-cloud fog (the lit cloud seen from inside).
  fogColor: { value: new Float32Array([0.8, 0.84, 0.9]) },
};

const SHIPPED_TUNING = Object.freeze({
  ...CLOUD_VOLUME,
  shadowStrength: CLOUD_SHADOW.strength, shadowOpacity: CLOUD_SHADOW.opacity, shadowSky: CLOUD_SHADOW.sky,
});
let _tuning = { ...SHIPPED_TUNING };

/**
 * Write tuning into the shared uniforms: `null` resets to the shipped table,
 * an object changes only the keys it names. Returns the live values. Debug
 * and capture only (`__BIRB.clouds({...})`); nothing on the shipping path
 * calls it after module load.
 */
export function setCloudVolumeTuning(overrides = null) {
  const t = overrides === null ? { ...SHIPPED_TUNING } : { ..._tuning, ...overrides };
  _tuning = t;
  const s = cloudVolumeUniforms.shape.value;
  s[0] = t.densityRadius; s[1] = t.opacity; s[2] = t.sunDepth; s[3] = t.nearMargin;
  const p = cloudVolumeUniforms.phase.value;
  p[0] = t.gForward; p[1] = t.gBack; p[2] = t.backWeight; p[3] = t.multiScatter;
  const g = cloudVolumeUniforms.gain.value;
  g[0] = t.powder; g[1] = t.sunGain; g[2] = t.skyGain; g[3] = t.skyFloor;
  const c = cloudVolumeUniforms.cluster.value;
  c[0] = t.sunCluster; c[1] = t.skyCluster; c[2] = t.lump; c[3] = t.lumpFreq;
  const sp = cloudShadowUniforms.params.value;
  sp[0] = t.shadowStrength; sp[1] = t.shadowOpacity; sp[2] = t.shadowSky;
  return { ...t };
}
setCloudVolumeTuning(null);

/**
 * The world object's `clouds` record: the data the debug hooks read, plus
 * `report(tune)` and `insidePoint(rho, accept)` for `__BIRB.clouds()` and
 * `__BIRB.goToCloud(i, { inside })`. Build-time only; nothing per frame.
 */
export function createCloudsInfo(THREE, {
  volumetric = true, clouds = [], spheres = [], puffs, immersion = null, sorter = null, mesh = null,
}) {
  const count = puffs ? puffs.length / 4 : 0;
  // `flat`: every puff magenta — green exactly 0 in the cloud's own colour —
  // with fog OFF (fog would tint it back toward the fog's green by distance
  // and read as partial cover). On the solid puffs, colour and emissive go
  // magenta. Everything is restored exactly on the way back. Capture only.
  let flatSaved = null;
  const setFlat = (on) => {
    const m = mesh?.material;
    if (!m) return;
    if (on && !flatSaved) {
      flatSaved = { fog: m.fog };
      if (volumetric) cloudVolumeUniforms.debug.value = 1;
      else if (m.color && m.emissive) {
        // Black albedo, dim emissive: unlit, and under the tone mapper's
        // compression knee, which would otherwise desaturate a bright
        // magenta toward white — green that is not background.
        flatSaved.color = m.color.getHex(); flatSaved.emissive = m.emissive.getHex();
        m.color.setRGB(0, 0, 0); m.emissive.setRGB(0.5, 0, 0.5);
      }
      m.fog = false;
      m.needsUpdate = true;
    } else if (!on && flatSaved) {
      if (volumetric) cloudVolumeUniforms.debug.value = 0;
      else if (flatSaved.color !== undefined) { m.color.setHex(flatSaved.color); m.emissive.setHex(flatSaved.emissive); }
      m.fog = flatSaved.fog;
      m.needsUpdate = true;
      flatSaved = null;
    }
  };
  return {
    volumetric,
    puffs,
    count,
    // Collider centres: identical either side of `?cloudvol=0`, so the
    // capture hooks frame the same cloud in both boots.
    clouds: clouds.slice(),
    spheres: spheres.slice(),
    immersion,
    sorter,
    report(tune = null) {
      let live = { ..._tuning };
      let listed = false;
      if (tune) {
        const { visible, flat, sort, focus, reset, list, ...rest } = tune;
        if (list === true) listed = true;
        if (reset === true && volumetric) live = setCloudVolumeTuning(null);
        if (typeof focus === 'boolean') { _focusMuted = !focus; updateCloudFocus(); }
        if (mesh && typeof visible === 'boolean') {
          mesh.visible = visible;
          // A hidden mesh gets no onBeforeRender, so its fog would stick.
          if (!visible) immersion?.reset();
        }
        if (typeof flat === 'boolean') setFlat(flat);
        // `sort: false` puts the puffs back in build order and holds them
        // there: the before of the back-to-front A/B.
        if (sorter && typeof sort === 'boolean' && sort !== sorter.enabled) {
          sorter.enabled = sort;
          if (!sort && sorter.reset() && mesh) {
            // Both per-instance buffers moved back, not just the matrices.
            mesh.instanceMatrix.needsUpdate = true;
            const own = mesh.geometry?.getAttribute?.(CLOUD_OWN_ATTRIBUTE);
            if (own) own.needsUpdate = true;
          }
        }
        if (volumetric && Object.keys(rest).length) live = setCloudVolumeTuning(rest);
      }
      return {
        volumetric,
        clouds: clouds.length,
        puffs: count,
        triangles: mesh?.geometry?.index ? 0 : count * ((mesh?.geometry?.attributes?.position?.count ?? 0) / 3),
        visible: mesh ? mesh.visible : null,
        spheres: spheres.length,
        shadowSpheres: volumetric ? cloudShadowUniforms.count.value : 0,
        immersion: +(immersion ? immersion.immersion : 0).toFixed(3),
        fog: volumetric ? +cloudShadowUniforms.fog.value[0].toFixed(3) : 0,
        // Whether the bird counts as near a puff (see the module doc).
        focus: volumetric ? !!_focusObject && !_focusMuted : null,
        // Read back from the INSTANCE MATRICES, against the camera the sorter
        // last saw: how many neighbouring slots draw a nearer puff first.
        sort: sorter && mesh ? {
          enabled: sorter.enabled,
          writes: sorter.writes,
          inversions: countSlotInversions(mesh.instanceMatrix.array, count,
            sorter.camera[0], sorter.camera[1], sorter.camera[2]),
        } : null,
        material: mesh ? {
          transparent: mesh.material.transparent,
          depthWrite: mesh.material.depthWrite,
          side: mesh.material.side,
          forceSinglePass: mesh.material.forceSinglePass,
          alphaTest: mesh.material.alphaTest,
        } : null,
        tuning: volumetric ? live : null,
        // `list: true`: every puff as [x, y, z, hullRadius], build order.
        puffList: listed ? Array.from({ length: count }, (_, i) => Array.from(puffs.subarray(i * 4, i * 4 + 4))) : undefined,
      };
    },
    // The JS mirror of the shadow shader at a world point: the fraction of
    // the direct sun that reaches it now.
    shadowAt(x, y, z) {
      const sun = visualUniforms.sunDir.value;
      if (!sun || !volumetric) return 1;
      const p = cloudShadowUniforms.params.value;
      return cloudShadowVisibility(x, y, z, [sun.x, sun.y, sun.z], cloudShadowUniforms.spheres.value,
        cloudShadowUniforms.count.value, p[0], p[1], visualUniforms.atmosphere.value);
    },
    // A point at normalised density `rho` (negative: outside the density,
    // d = sqrt(1 - rho) density radii from the centre) on one of seven rays
    // from a puff's centre — first AWAY from its cloud's collider (the only
    // side a camera can be in a puff without the collider claiming it),
    // then four tangent, then radial up and down — that `accept` (a
    // collider test) allows. `only: { puff, dir }` pins the ray, so a
    // sequence of depths walks ONE line into ONE puff.
    insidePoint(rho, accept, only = null) {
      const d = Math.sqrt(Math.max(0, 1 - Math.min(1, rho)));
      for (let i = 0; i < count; i++) {
        if (only && only.puff !== i) continue;
        const cx = puffs[i * 4]; const cy = puffs[i * 4 + 1]; const cz = puffs[i * 4 + 2];
        const rd = puffs[i * 4 + 3] * _tuning.densityRadius;
        const ul = Math.hypot(cx, cy, cz) || 1;
        const ux = cx / ul; const uy = cy / ul; const uz = cz / ul;
        const rx = Math.abs(uy) > 0.9 ? 1 : 0; const ry = Math.abs(uy) > 0.9 ? 0 : 1;
        let ax = -uz * ry; let ay = uz * rx; let az = ux * ry - uy * rx;
        const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
        const bx = uy * az - uz * ay; const by = uz * ax - ux * az; const bz = ux * ay - uy * ax;
        let near = null; let nd = Infinity;
        for (const c of clouds) {
          const dd = (c.x - cx) ** 2 + (c.y - cy) ** 2 + (c.z - cz) ** 2;
          if (dd < nd) { nd = dd; near = c; }
        }
        let ox = 0; let oy = 0; let oz = 0;
        if (near && nd > 1e-6) {
          const l = Math.sqrt(nd); ox = (cx - near.x) / l; oy = (cy - near.y) / l; oz = (cz - near.z) / l;
        }
        const cand = [[ox, oy, oz], [ax, ay, az], [-ax, -ay, -az], [bx, by, bz], [-bx, -by, -bz], [ux, uy, uz], [-ux, -uy, -uz]];
        for (let k = 0; k < cand.length; k++) {
          if (only && only.dir !== k) continue;
          const [x, y, z] = cand[k];
          if (x === 0 && y === 0 && z === 0) continue;
          const p = new THREE.Vector3(cx + x * rd * d, cy + y * rd * d, cz + z * rd * d);
          if (!accept || accept(p)) {
            return { point: p, centre: new THREE.Vector3(cx, cy, cz), puff: i, dir: k, radius: puffs[i * 4 + 3] };
          }
        }
      }
      return null;
    },
  };
}

// ── The integral, in JS — the reference the GLSL below mirrors ────────────

/**
 * Optical depth of the unit sphere with density 1 - r^2 along a chord, scaled
 * so the full chord through the centre is exactly 1.
 *
 * `h` is the chord's half-length (h^2 = 1 - p^2 for impact parameter p) and
 * `u1` where integration starts, measured from the chord's midpoint along the
 * ray (-h is the entry point; a camera inside the sphere starts later). The
 * density along the ray at u is h^2 - u^2, so the integral to the exit is
 *   (3/4) * [ h^2 (h - u1) - (h^3 - u1^3) / 3 ].
 */
export function chordDepth(h, u1) {
  if (!(h > 0)) return 0;
  const a = Math.max(-h, Math.min(h, u1));
  return 0.75 * (h * h * (h - a) - (h * h * h - a * a * a) / 3);
}

/**
 * Optical depth from point `o` (unit-sphere coordinates) along unit direction
 * `d`, forward only (t >= 0). The camera-inside case falls out of the clamp.
 */
export function sphereDepthFrom(ox, oy, oz, dx, dy, dz) {
  const b = ox * dx + oy * dy + oz * dz;
  const h2 = b * b - (ox * ox + oy * oy + oz * oz - 1);
  if (!(h2 > 0)) return 0;
  const h = Math.sqrt(h2);
  const u1 = Math.max(-h, b);
  if (u1 >= h) return 0;
  return chordDepth(h, u1);
}

/**
 * Fraction of the direct sun reaching world point p through the cloud-level
 * spheres. `spheres` is the flat [x,y,z,r,...] array the shader reads.
 */
export function cloudShadowVisibility(px, py, pz, sun, spheres, count,
  strength = CLOUD_SHADOW.strength, opacity = CLOUD_SHADOW.opacity, atmosphere = 1) {
  const len = Math.hypot(sun[0], sun[1], sun[2]) || 1;
  const lx = sun[0] / len; const ly = sun[1] / len; const lz = sun[2] / len;
  let tau = 0;
  for (let i = 0; i < count; i++) {
    const r = spheres[i * 4 + 3];
    if (!(r > 0)) continue;
    tau += sphereDepthFrom(
      (px - spheres[i * 4]) / r, (py - spheres[i * 4 + 1]) / r, (pz - spheres[i * 4 + 2]) / r,
      lx, ly, lz,
    );
  }
  return 1 - strength * atmosphere * (1 - Math.exp(-opacity * tau));
}

/**
 * How deep the camera is in cloud: the largest normalised density any puff
 * has at (x, y, z), 0 outside every density sphere and 1 at a centre. `puffs`
 * is a flat [x,y,z,hullRadius,...] array. Zero allocation — this runs every
 * frame from the cloud mesh's onBeforeRender.
 */
export function cloudImmersion(x, y, z, puffs, count, densityRadius = CLOUD_VOLUME.densityRadius) {
  let best = 0;
  for (let i = 0; i < count; i++) {
    const r = puffs[i * 4 + 3] * densityRadius;
    if (!(r > 0)) continue;
    const dx = x - puffs[i * 4]; const dy = y - puffs[i * 4 + 1]; const dz = z - puffs[i * 4 + 2];
    const rho = 1 - (dx * dx + dy * dy + dz * dz) / (r * r);
    if (rho > best) best = rho;
  }
  return best;
}

/**
 * One sphere standing in for a whole cloud's shadow: the volume-weighted
 * centroid of its puffs' density spheres, with a radius that reaches the
 * far side of the furthest one. `puffs` are {x,y,z,r} with r the HULL radius.
 */
export function cloudShadowSphere(puffs, densityRadius = CLOUD_VOLUME.densityRadius) {
  let wx = 0; let wy = 0; let wz = 0; let w = 0;
  for (const p of puffs) {
    const m = (p.r * densityRadius) ** 3;
    wx += p.x * m; wy += p.y * m; wz += p.z * m; w += m;
  }
  if (!(w > 0)) return null;
  const cx = wx / w; const cy = wy / w; const cz = wz / w;
  let reach = 0;
  for (const p of puffs) {
    const d = Math.hypot(p.x - cx, p.y - cy, p.z - cz) + p.r * densityRadius;
    if (d > reach) reach = d;
  }
  // A sphere through the outermost density overstates the soft edge of a
  // lumpy cluster; 0.85 of the reach matches the union's half-shadow radius
  // closely enough that a single puff (reach = its own radius) stays exact
  // when densities are summed across a cluster.
  const k = puffs.length > 1 ? 0.85 : 1;
  return { x: cx, y: cy, z: cz, r: reach * k };
}

/** Fill the shared shadow uniform from cloud-level spheres. Returns the count. */
export function setCloudShadowSpheres(spheres) {
  const out = cloudShadowUniforms.spheres.value;
  const n = Math.min(spheres ? spheres.length : 0, CLOUD_SHADOW.max);
  out.fill(0);
  for (let i = 0; i < n; i++) {
    const s = spheres[i];
    out[i * 4] = s.x; out[i * 4 + 1] = s.y; out[i * 4 + 2] = s.z; out[i * 4 + 3] = s.r;
  }
  cloudShadowUniforms.count.value = n;
  return n;
}

/**
 * Extra puffs for a cloud built with too few to read as a cloud (mobile builds
 * ONE per cloud: a soft sphere is a soft ball, not a cumulus). Drawn from a
 * PRIVATE generator seeded by the cloud's own centre, never from the world's
 * shared stream — one extra draw there would move every prop placed after the
 * clouds, and `?cloudvol=0` must rebuild the identical world.
 */
export function extraCloudPuffs({ center, up, cloudScale, count, spread = 4, rMin = 2.4, rMax = 4.6 }) {
  if (!(count > 0)) return [];
  const seed = ((Math.round(center.x * 97) * 73856093) ^ (Math.round(center.y * 89) * 19349663)
    ^ (Math.round(center.z * 83) * 83492791)) >>> 0;
  const rng = mulberry32(seed);
  // A tangent frame at the cloud (t, b perpendicular to the radial up): the
  // puffs spread sideways and a little up and down, like the ones the
  // builder already draws.
  const ul = Math.hypot(up.x, up.y, up.z) || 1;
  const ux = up.x / ul; const uy = up.y / ul; const uz = up.z / ul;
  // t = up x ref, with ref = world Y unless up is nearly parallel to it.
  const refX = Math.abs(uy) > 0.9 ? 1 : 0; const refY = Math.abs(uy) > 0.9 ? 0 : 1;
  let tx = uy * 0 - uz * refY; let ty = uz * refX - ux * 0; let tz = ux * refY - uy * refX;
  const tl = Math.hypot(tx, ty, tz) || 1;
  tx /= tl; ty /= tl; tz /= tl;
  const bx = uy * tz - uz * ty; const by = uz * tx - ux * tz; const bz = ux * ty - uy * tx;
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = (i + rng() * 0.8) / count * Math.PI * 2;
    const rad = spread * (0.45 + 0.55 * rng()) * cloudScale;
    const lift = (rng() * 2.4 - 0.6) * cloudScale;
    const s = rMin + (rMax - rMin) * rng();
    out.push({
      x: center.x + (tx * Math.cos(a) + bx * Math.sin(a)) * rad + ux * lift,
      y: center.y + (ty * Math.cos(a) + by * Math.sin(a)) * rad + uy * lift,
      z: center.z + (tz * Math.cos(a) + bz * Math.sin(a)) * rad + uz * lift,
      r: s * cloudScale,
    });
  }
  return out;
}

// ── GLSL ───────────────────────────────────────────────────────────────────
//
// The world-position varying comes from visual-style.js's ensureWorldVarying
// — ONE definition, the same exact-string guards every other patch uses, so
// whichever patch runs first declares it and the rest see it and skip.
// (This file used to carry a copy with looser regex guards; two guards that
// can disagree about whether the varying exists are how a shader ends up
// declaring it twice, which does not compile, and three then draws nothing.)
//
// NaN discipline: every GLSL normalize, divide, sqrt and pow below is fed a
// value that is clamped or floored first. One NaN pixel in the scene target
// is a black block after the half-res bloom blur, and SwiftShader and a
// phone's GPU need not agree on which edge case produces one.

/**
 * Per-instance attribute on a cloud mesh: the sphere [x, y, z, r] that
 * stands for the puff's whole cloud (cloudShadowSphere), so the puff shades
 * as part of its cluster without looping over every cloud on the planet.
 */
export const CLOUD_OWN_ATTRIBUTE = 'cloudOwn';

/** The chord integral (see chordDepth). Shared by both patches, declared once. */
export const CLOUD_CHORD_GLSL = `
#ifndef BIRB_CLOUD_CHORD
#define BIRB_CLOUD_CHORD
float birbCloudChord( float h, float u1 ) {
  float a = clamp( u1, -h, h );
  return 0.75 * ( h * h * ( h - a ) - ( h * h * h - a * a * a ) / 3.0 );
}
// A zero vector has no direction, and the built-in unit-vector function
// returns NaN for one on every GPU; this returns the zero vector instead,
// which every caller below reads as "no light, no chord".
vec3 birbCloudUnit( vec3 v ) {
  return v * inversesqrt( max( dot( v, v ), 1e-12 ) );
}
#endif
`;

const VOLUME_PARS_GLSL = `
uniform vec3 uCloudSun;
uniform vec4 uCloudShape;
uniform vec4 uCloudPhase;
uniform vec4 uCloudGain;
uniform vec4 uCloudCluster;
uniform vec3 uCloudFocus;
uniform float uCloudDebug;
varying vec4 vCloudSphere;
varying vec4 vCloudOwn;
${CLOUD_CHORD_GLSL}
float birbCloudHG( float g, float mu ) {
  // Zero only at g = 1 looking into the sun (a live-tuning edge, not the
  // shipped lobes), and 0/0 there is a NaN: floored.
  float d = max( 1.0 + g * g - 2.0 * g * mu, 1e-4 );
  return ( 1.0 - g * g ) / ( d * sqrt( d ) );
}
// Optical depth from q (unit-sphere coordinates) along unit dir, forward
// only: the rest of the chord from inside, the whole chord if the sphere is
// ahead, nothing if it is behind or missed.
float birbCloudDepthFrom( vec3 q, vec3 dir ) {
  float b = dot( dir, q );
  float h = sqrt( max( b * b - dot( q, q ) + 1.0, 0.0 ) );
  return birbCloudChord( h, b );
}
// Cauliflower: |sin| has round crowns and sharp creases, which is the
// outline of a cumulus turret. Sampled on the direction of the ray's closest
// approach, so a lump is fixed to the puff in 3D and turns with it as the
// camera moves round. [-1, 1].
float birbCloudLump( vec3 p ) {
  float n = abs( sin( p.x + 1.7 * sin( p.y * 0.8 ) ) )
          + abs( sin( p.y + 1.7 * sin( p.z * 0.8 ) ) )
          + abs( sin( p.z + 1.7 * sin( p.x * 0.8 ) ) );
  return n * 0.6667 - 1.0;
}
`;

// First thing in main(): the view chord, and every early discard, before
// three spends anything on lighting a fragment that will not be drawn.
const VOLUME_EARLY_GLSL = `
  // Exactly one face per pixel. Back faces once the camera or the bird is
  // within uCloudShape.w world units of the hull (a camera inside sees no
  // front face at all; the bird inside must not be veiled by the density
  // BEHIND it), front faces otherwise. The chord below starts at the camera
  // either way, so the choice never changes the veil over the sky.
  float cvNear = min( length( cameraPosition - vCloudSphere.xyz ), length( uCloudFocus - vCloudSphere.xyz ) );
  if ( gl_FrontFacing == ( cvNear < vCloudSphere.w + uCloudShape.w ) ) discard;
  vec3 cvDir = birbCloudUnit( vBirbWorld - cameraPosition );
  float cvR = max( vCloudSphere.w * uCloudShape.x, 1e-4 );
  vec3 cvO = ( cameraPosition - vCloudSphere.xyz ) / cvR;
  float cvB = dot( cvDir, cvO );
  // The lumps: this ray sees a sphere of radius cvRe, chosen by the
  // direction of its closest approach. Faded out near the centre, where that
  // direction is undefined and only the silhouette needs the detail.
  vec3 cvM = cvO - cvB * cvDir;
  float cvP = length( cvM );
  // Past the biggest lump there is no density at all: out before the sines.
  if ( cvP >= 1.0 + uCloudCluster.z ) discard;
  vec3 cvSeed = fract( vCloudSphere.xyz * 0.1731 ) * 6.2832;
  float cvRe = 1.0 + uCloudCluster.z * birbCloudLump( cvM / max( cvP, 1e-4 ) * uCloudCluster.w + cvSeed )
    * smoothstep( 0.2, 0.7, cvP );
  // Positive for any lump under 1 (shipped 0.18); floored so a live-tuned
  // lump cannot divide by zero.
  cvRe = max( cvRe, 0.05 );
  cvO /= cvRe;
  cvB /= cvRe;
  float cvH2 = 1.0 - cvP * cvP / ( cvRe * cvRe );
  if ( cvH2 <= 0.0 ) discard;
  float cvH = sqrt( cvH2 );
  // Measured from the chord's midpoint: entry at -h, or the camera itself
  // when it is already in the density (t = 0 is u = b).
  float cvU1 = max( -cvH, cvB );
  if ( cvU1 >= cvH ) discard;
  float cvTau = birbCloudChord( cvH, cvU1 );
  float cvAlpha = 1.0 - exp( -uCloudShape.y * cvTau );
  if ( cvAlpha < 0.002 ) discard;
`;

// At <opaque_fragment>: replace the hull's Lambert shading with the volume's.
const VOLUME_LIGHT_GLSL = `
  {
    vec3 cvL = birbCloudUnit( uCloudSun );
    vec3 cvUp = birbCloudUnit( vCloudSphere.xyz );
    // Where along the chord the light we see was scattered: the middle of a
    // thin chord, pulled toward the entry as the chord thickens.
    float cvW = 0.5 / ( 1.0 + 0.35 * uCloudShape.y * cvTau );
    float cvUs = mix( cvU1, cvH, cvW );
    vec3 cvQ = cvO + ( cvUs - cvB ) * cvDir;
    // The same point in world space, for the whole cloud's optical depth:
    // a puff on the far side of its cluster is in the cluster's shadow, and
    // one under the cluster sees less sky. Without this every puff lights
    // itself alone and the cloud reads as a pile of bubbles, each with its
    // own silver rim. Through the ONE sphere that stands for this puff's own
    // cloud (a per-instance attribute), not a loop over every cloud: the
    // clouds are scattered over a whole planet, so the rest contribute
    // nothing but cost, and on desktop that was 40 chords per fragment.
    vec3 cvQw = vCloudSphere.xyz + cvQ * ( cvR * cvRe );
    vec3 cvSo = ( cvQw - vCloudOwn.xyz ) / max( vCloudOwn.w, 1e-3 );
    float cvClSun = birbCloudDepthFrom( cvSo, cvL );
    float cvClUp = birbCloudDepthFrom( cvSo, cvUp );
    float cvSunTau = uCloudShape.y * ( uCloudShape.z * birbCloudDepthFrom( cvQ, cvL ) + uCloudCluster.x * cvClSun );
    float cvUpTau = uCloudShape.y * ( 0.5 * birbCloudDepthFrom( cvQ, cvUp ) + uCloudCluster.y * cvClUp );
    float cvDownTau = uCloudShape.y * birbCloudDepthFrom( cvQ, -cvUp );
    float cvMu = dot( cvDir, cvL );
    float cvPhase = mix( birbCloudHG( uCloudPhase.x, cvMu ), birbCloudHG( uCloudPhase.y, cvMu ), uCloudPhase.z );
    // Beer for the single-scattered sun, plus a flatter, less-extinguished
    // octave for everything that scattered more than once.
    float cvSun = cvPhase * exp( -cvSunTau )
      + uCloudPhase.w * birbCloudHG( uCloudPhase.x * 0.3, cvMu ) * exp( -0.25 * cvSunTau );
    // Powder: in-scattering needs cloud around the point, so the thin
    // sun-facing skin is darker — but not looking INTO the sun, where the
    // thin edge is the silver lining.
    float cvPowder = 1.0 - exp( -2.0 * uCloudShape.y * cvTau );
    cvSun *= mix( 1.0, cvPowder, uCloudGain.x * clamp( 0.5 - 0.5 * cvMu, 0.0, 1.0 ) );
    vec3 cvSunCol = vec3( 0.0 );
    vec3 cvSky = ambientLightColor;
    vec3 cvGround = ambientLightColor;
    #if NUM_DIR_LIGHTS > 0
      for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
        vec3 cvDirW = ( vec4( directionalLights[ i ].direction, 0.0 ) * viewMatrix ).xyz;
        cvSunCol += directionalLights[ i ].color * smoothstep( 0.995, 0.9995, dot( cvDirW, cvL ) );
      }
    #endif
    #if NUM_HEMI_LIGHTS > 0
      for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
        cvSky += hemisphereLights[ i ].skyColor;
        cvGround += hemisphereLights[ i ].groundColor;
      }
    #endif
    // Sky from above and bounce from below, each through the cloud between.
    float cvSkyVis = mix( uCloudGain.w, 1.0, exp( -0.5 * cvUpTau ) );
    vec3 cvIrr = cvSunCol * ( cvSun * uCloudGain.y )
      + ( cvSky * cvSkyVis + cvGround * exp( -0.5 * cvDownTau ) * 0.5 ) * uCloudGain.z;
    outgoingLight = diffuseColor.rgb * cvIrr * RECIPROCAL_PI;
    if ( uCloudDebug > 0.5 ) outgoingLight = vec3( 0.5, 0.0, 0.5 );
    diffuseColor.a = cvAlpha;
  }
`;

/**
 * Turn a cloud puff material (MeshLambertMaterial on an instanced icosphere)
 * into an analytic volume. Chains any existing onBeforeCompile and extends
 * the program cache key. Sets transparent / double-sided / no depth write.
 */
export function addCloudVolume(material, THREE) {
  if (!material || material.userData?.birbCloudVolume) return material;
  material.userData = material.userData || {};
  material.userData.birbCloudVolume = true;
  material.transparent = true;
  material.opacity = 1;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  // Three draws a transparent DoubleSide material in TWO passes (back, then
  // front) unless told not to — a second draw call per cloud mesh for faces
  // the shader discards anyway.
  material.forceSinglePass = true;
  if (!visualUniforms.sunDir.value && THREE.Vector3) visualUniforms.sunDir.value = new THREE.Vector3(0, 1, 0);

  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = function birbCloudVolumePatch(shader, renderer) {
    if (typeof previous === 'function') previous.call(this, shader, renderer);
    const frag = shader.fragmentShader;
    if (!frag.includes('#include <clipping_planes_fragment>') || !frag.includes('#include <opaque_fragment>')) return;
    ensureWorldVarying(shader);
    shader.uniforms.uCloudSun = visualUniforms.sunDir;
    shader.uniforms.uCloudShape = cloudVolumeUniforms.shape;
    shader.uniforms.uCloudPhase = cloudVolumeUniforms.phase;
    shader.uniforms.uCloudGain = cloudVolumeUniforms.gain;
    shader.uniforms.uCloudCluster = cloudVolumeUniforms.cluster;
    shader.uniforms.uCloudFocus = cloudVolumeUniforms.focus;
    shader.uniforms.uCloudDebug = cloudVolumeUniforms.debug;
    shader.vertexShader = `attribute vec4 ${CLOUD_OWN_ATTRIBUTE};\nvarying vec4 vCloudSphere;\nvarying vec4 vCloudOwn;\n`
      + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        #ifdef USE_INSTANCING
          mat4 cvModel = modelMatrix * instanceMatrix;
        #else
          mat4 cvModel = modelMatrix;
        #endif
        vCloudSphere = vec4( cvModel[ 3 ].xyz, length( cvModel[ 0 ].xyz ) );
        vCloudOwn = vec4( ( modelMatrix * vec4( ${CLOUD_OWN_ATTRIBUTE}.xyz, 1.0 ) ).xyz,
          ${CLOUD_OWN_ATTRIBUTE}.w * length( modelMatrix[ 0 ].xyz ) );
      }`);
    shader.fragmentShader = VOLUME_PARS_GLSL + shader.fragmentShader
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${VOLUME_EARLY_GLSL}`)
      .replace('#include <opaque_fragment>', `${VOLUME_LIGHT_GLSL}\n#include <opaque_fragment>`);
  };
  material.customProgramCacheKey = function birbCloudVolumeKey() {
    const base = typeof previousKey === 'function' ? previousKey.call(this) : 'birb';
    return `${base}-cloudvol-v1`;
  };
  material.needsUpdate = true;
  return material;
}

const SHADOW_PARS_GLSL = `
#define BIRB_CLOUD_SHADOW_MAX ${CLOUD_SHADOW.max}
uniform vec4 uCloudShadowSpheres[ BIRB_CLOUD_SHADOW_MAX ];
uniform int uCloudShadowCount;
uniform vec4 uCloudShadowParams;
uniform vec4 uCloudShadowFogParams;
uniform vec3 uCloudShadowFog;
uniform vec3 uCloudShadowSun;
uniform float uCloudShadowAtmos;
${CLOUD_CHORD_GLSL}
// The occlusion, 0 (clear) to strength (under a thick cloud), clamped to
// [0, 1]: the atmosphere uniform is a live lighting lever (applyLightingSettings takes
// any finite number), and past 1/strength an unclamped term would drive the
// sun NEGATIVE — which the sRGB output transform's pow() turns into NaN.
float birbCloudShadow( vec3 p ) {
  vec3 L = birbCloudUnit( uCloudShadowSun );
  float tau = 0.0;
  for ( int i = 0; i < BIRB_CLOUD_SHADOW_MAX; i ++ ) {
    if ( i >= uCloudShadowCount ) break;
    vec4 s = uCloudShadowSpheres[ i ];
    vec3 o = ( p - s.xyz ) / max( s.w, 1e-3 );
    float b = dot( o, L );
    float h2 = b * b - dot( o, o ) + 1.0;
    // Missed, or the sphere is behind the fragment as seen from the sun.
    if ( h2 <= 0.0 ) continue;
    float h = sqrt( h2 );
    if ( b >= h ) continue;
    tau += birbCloudChord( h, b );
  }
  return clamp( uCloudShadowParams.x * uCloudShadowAtmos * ( 1.0 - exp( -uCloudShadowParams.y * tau ) ), 0.0, 1.0 );
}
`;

// The sun's visibility, applied to the SUN ALONE. A cloud between a fragment
// and the sun does not take the rim or fill light (they come from elsewhere
// in the sky), so it cannot be a multiply on reflectedLight.directDiffuse —
// which is every directional, point and spot light summed. Instead the sun's
// own IncidentLight colour is scaled inside three's light loop, before the
// shadow-map factor, by wrapping getDirectionalLightInfo for the length of
// <lights_fragment_begin>; the light matched is every directional light
// shining FROM the sun's direction (the key, or at Ultra the shadow light
// that stands in for it — three sorts shadow casters first, so the index
// moves and the direction does not).
//
// The contract is src/environment/horizon-shadow.js's, by name: globals
// birbSunVis / birbSkyVis / birbSunView, the sun's light scaled by
// birbSunVis, the indirect light by birbSkyVis ahead of <aomap_fragment>.
// When the horizon patch is already on the material (chained BEFORE this
// one), the cloud only MULTIPLIES its visibility into those globals — one
// wrapper, one sky multiply, so a fragment under a ridge AND a cloud loses
// the sun's Lambert term once, by the product of the two visibilities.
// Without it, this patch brings the same machinery itself.
const SHADOW_GLOBALS_GLSL = `
float birbSunVis = 1.0;
float birbSkyVis = 1.0;
vec3 birbSunView = vec3( 0.0, 0.0, 1.0 );
`;

// After <lights_pars_begin>, where DirectionalLight and IncidentLight exist.
const SHADOW_LIGHT_WRAPPER_GLSL = `
#if NUM_DIR_LIGHTS > 0
void birbCloudDirInfo( const in DirectionalLight dl, out IncidentLight light ) {
  getDirectionalLightInfo( dl, light );
  // Within ~0.8 degrees of the sun (float32 round trips put the key and the
  // shadow light at 1 - 1e-7 of each other).
  if ( dot( light.direction, birbSunView ) > 0.9999 ) light.color *= birbSunVis;
}
#endif
`;

/**
 * Real cloud shadows on a lit world material: the SUN's light is scaled by
 * its visibility through the cloud-level spheres (see the note above for how
 * and why only the sun), and a share of the sky light with it, ahead of
 * <aomap_fragment> where three applies its own ambient occlusion. While the
 * camera is inside a cloud the surface also fogs toward the cloud's colour,
 * because geometry INSIDE a puff sits in front of the puff's back faces and
 * the volume alone cannot veil it. Chains and extends the cache key.
 *
 * Order: chain this AFTER addHorizonShadow (so it can find and join that
 * patch's globals) and BEFORE addAtmosphere (so the atmosphere's sun rim
 * sees the shadowed `birbSunVis`, exactly as it does for the horizon).
 */
export function addCloudShadow(material, THREE) {
  if (!material || material.userData?.birbCloudShadow) return material;
  const lit = material.isMeshLambertMaterial || material.isMeshPhongMaterial
    || material.isMeshStandardMaterial || material.isMeshToonMaterial;
  if (!lit || material.isShaderMaterial) return material;
  material.userData = material.userData || {};
  material.userData.birbCloudShadow = true;
  if (!visualUniforms.sunDir.value && THREE?.Vector3) visualUniforms.sunDir.value = new THREE.Vector3(0, 1, 0);

  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = function birbCloudShadowPatch(shader, renderer) {
    if (typeof previous === 'function') previous.call(this, shader, renderer);
    const frag = shader.fragmentShader;
    // Anchors this patch needs; a material without them is left alone rather
    // than half-patched (three draws nothing for a shader that fails).
    if (!frag.includes('#include <lights_pars_begin>') || !frag.includes('#include <lights_fragment_begin>')
      || !frag.includes('#include <aomap_fragment>') || !frag.includes('#include <fog_fragment>')) return;
    ensureWorldVarying(shader);
    shader.uniforms.uCloudShadowSpheres = cloudShadowUniforms.spheres;
    shader.uniforms.uCloudShadowCount = cloudShadowUniforms.count;
    shader.uniforms.uCloudShadowParams = cloudShadowUniforms.params;
    shader.uniforms.uCloudShadowFogParams = cloudShadowUniforms.fog;
    shader.uniforms.uCloudShadowFog = cloudShadowUniforms.fogColor;
    shader.uniforms.uCloudShadowSun = visualUniforms.sunDir;
    shader.uniforms.uCloudShadowAtmos = visualUniforms.atmosphere;
    // The horizon patch's globals, if it ran first: join them.
    const joined = shader.fragmentShader.includes('float birbSunVis');
    const occlusion = `{
        // The sun goes behind the cloud; a share of the sky goes with it.
        float csOcc = birbCloudShadow( vBirbWorld );
        birbSunVis *= 1.0 - csOcc;
        birbSkyVis *= 1.0 - csOcc * uCloudShadowParams.z;${joined ? '' : `
        birbSunView = birbCloudUnit( ( viewMatrix * vec4( uCloudShadowSun, 0.0 ) ).xyz );`}
      }`;
    let f = SHADOW_PARS_GLSL + (joined ? '' : SHADOW_GLOBALS_GLSL) + shader.fragmentShader;
    if (joined) {
      // After the horizon's own evaluation (it sets birbSunVis; this scales
      // it), inside the span its getDirectionalLightInfo macro covers.
      f = f.replace('#include <lights_fragment_begin>', `${occlusion}
#include <lights_fragment_begin>`);
    } else {
      f = f
        .replace('#include <lights_pars_begin>', `#include <lights_pars_begin>\n${SHADOW_LIGHT_WRAPPER_GLSL}`)
        .replace('#include <lights_fragment_begin>', `${occlusion}
#if NUM_DIR_LIGHTS > 0
#define getDirectionalLightInfo( dl, l ) birbCloudDirInfo( dl, l )
#endif
#include <lights_fragment_begin>
#if NUM_DIR_LIGHTS > 0
#undef getDirectionalLightInfo
#endif`)
        .replace('#include <aomap_fragment>', `reflectedLight.indirectDiffuse *= birbSkyVis;
#include <aomap_fragment>`);
    }
    shader.fragmentShader = f.replace('#include <fog_fragment>', `#include <fog_fragment>
      if ( uCloudShadowFogParams.x > 0.0 ) {
        float csFog = clamp( uCloudShadowFogParams.x
          * ( 1.0 - exp( -length( vBirbWorld - cameraPosition ) * uCloudShadowFogParams.y ) ), 0.0, 1.0 );
        // gl_FragColor is already in the OUTPUT colour space here (sRGB on
        // screen, linear into the bloom target), exactly as three's own fog
        // colour is; the uniform is linear, and floored so the transform's
        // pow() can never see a negative.
        gl_FragColor.rgb = mix( gl_FragColor.rgb,
          linearToOutputTexel( vec4( max( uCloudShadowFog, vec3( 0.0 ) ), 1.0 ) ).rgb, csFog );
      }`);
  };
  material.customProgramCacheKey = function birbCloudShadowKey() {
    const base = typeof previousKey === 'function' ? previousKey.call(this) : 'birb';
    return `${base}-cloudshadow-v2`;
  };
  material.needsUpdate = true;
  return material;
}

/**
 * Per-frame camera immersion -> the in-cloud fog on world materials. Wired as
 * the cloud mesh's onBeforeRender so it needs nothing from the game loop:
 * three calls it with the camera about to draw this mesh, and the world
 * drawn next frame reads the result (one frame of latency on a fade that
 * takes several). `puffs` is the flat [x,y,z,hullRadius,...] array.
 */
export function createCloudImmersion(puffs, count, {
  fogAmount = 0.85, fogLength = 9, densityRadius = CLOUD_VOLUME.densityRadius,
  fogTint = [0.86, 0.88, 0.92], tintMix = 0.6,
} = {}) {
  const state = { immersion: 0, puffs, count };
  const params = cloudShadowUniforms.fog.value;
  const fog = cloudShadowUniforms.fogColor.value;
  state.update = function update(x, y, z) {
    const rho = cloudImmersion(x, y, z, puffs, count, densityRadius);
    // Smooth in from the density edge: nothing until the camera is a little
    // way in, full by a third of the way to the centre.
    const t = Math.min(1, Math.max(0, rho / 0.35));
    state.immersion = t * t * (3 - 2 * t);
    params[0] = state.immersion * fogAmount;
    params[1] = 1 / fogLength;
    // The inside of a cloud is the sky's own air, lit white: the valley
    // mist's colour (already the sky's mid tone) pulled toward a pale grey.
    const mist = visualUniforms.mistColor.value;
    if (mist) {
      fog[0] = mist.r + (fogTint[0] - mist.r) * tintMix;
      fog[1] = mist.g + (fogTint[1] - mist.g) * tintMix;
      fog[2] = mist.b + (fogTint[2] - mist.b) * tintMix;
    }
    return state.immersion;
  };
  state.reset = function reset() { state.immersion = 0; params[0] = 0; };
  return state;
}

// Write puff `i` of the flat [x,y,z,hullRadius,...] array into instance slot
// `k` of a column-major mat4 array: exactly the matrix the builders compose
// (position, uniform scale, no rotation), so a re-sorted slot is bit-for-bit
// the one the builder would have written there.
function writePuffMatrix(m, k, puffs, i) {
  const o = k * 16; const s = puffs[i * 4 + 3];
  m[o] = s; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0;
  m[o + 4] = 0; m[o + 5] = s; m[o + 6] = 0; m[o + 7] = 0;
  m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = s; m[o + 11] = 0;
  m[o + 12] = puffs[i * 4]; m[o + 13] = puffs[i * 4 + 1]; m[o + 14] = puffs[i * 4 + 2]; m[o + 15] = 1;
}

/**
 * Neighbouring instance slots, in draw order, where the NEARER puff comes
 * first — each one is a pair blended the wrong way round. 0 is back to
 * front. Reads the matrices themselves, not the sorter's own bookkeeping.
 */
export function countSlotInversions(matrices, count, x, y, z) {
  let inversions = 0;
  let prev = Infinity;
  for (let k = 0; k < count; k++) {
    const o = k * 16;
    const dx = matrices[o + 12] - x; const dy = matrices[o + 13] - y; const dz = matrices[o + 14] - z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > prev) inversions += 1;
    prev = d;
  }
  return inversions;
}

/**
 * Back-to-front order for one instanced cloud mesh's puffs (see the module
 * doc for why: one mesh, no depth write, three sorts objects not instances).
 * `update(x, y, z)` takes the camera, re-sorts, and rewrites `matrices` (the
 * mesh's instanceMatrix.array) only when the order changed, returning true so
 * the caller can flag the upload. Insertion sort: puffs barely move against
 * each other from one frame to the next, so it is one comparison per puff on
 * almost every frame. Zero allocation — it runs from onBeforeRender.
 */
export function createCloudSorter(puffs, count, matrices, { perPuff = null, perPuffOut = null } = {}) {
  const order = new Uint16Array(count);   // slot -> puff index
  const keys = new Float32Array(count);   // puff index -> squared distance
  const camera = new Float32Array(3);
  for (let i = 0; i < count; i++) order[i] = i;
  const state = { order, camera, enabled: true, writes: 0 };
  // Any other per-instance vec4 (the puff's cloud sphere) moves with it.
  const writeSlot = (k, i) => {
    writePuffMatrix(matrices, k, puffs, i);
    if (perPuff && perPuffOut) {
      perPuffOut[k * 4] = perPuff[i * 4]; perPuffOut[k * 4 + 1] = perPuff[i * 4 + 1];
      perPuffOut[k * 4 + 2] = perPuff[i * 4 + 2]; perPuffOut[k * 4 + 3] = perPuff[i * 4 + 3];
    }
  };
  state.update = function update(x, y, z) {
    camera[0] = x; camera[1] = y; camera[2] = z;
    if (!state.enabled) return false;
    for (let i = 0; i < count; i++) {
      const dx = puffs[i * 4] - x; const dy = puffs[i * 4 + 1] - y; const dz = puffs[i * 4 + 2] - z;
      keys[i] = dx * dx + dy * dy + dz * dz;
    }
    let moved = false;
    for (let k = 1; k < count; k++) {
      const p = order[k];
      const d = keys[p];
      let j = k - 1;
      // Farthest first: shift every nearer puff one slot later.
      while (j >= 0 && keys[order[j]] < d) { order[j + 1] = order[j]; j -= 1; }
      if (j !== k - 1) { order[j + 1] = p; moved = true; }
    }
    if (!moved) return false;
    for (let k = 0; k < count; k++) writeSlot(k, order[k]);
    state.writes += 1;
    return true;
  };
  // Build order again (the `?sort` A/B). True if anything was rewritten.
  state.reset = function reset() {
    let moved = false;
    for (let k = 0; k < count; k++) {
      if (order[k] !== k) moved = true;
      order[k] = k;
      writeSlot(k, k);
    }
    return moved;
  };
  return state;
}

// The bird, for the face choice (see the module doc). One object for every
// cloud mesh in every biome; read from each mesh's onBeforeRender, when
// three has already updated its world matrix for this frame.
let _focusObject = null;
// Capture only (`__BIRB.clouds({ focus: false })`): the camera alone picks
// the face, which is what the bird check needs as its before.
let _focusMuted = false;

/** The object whose position counts as "near a puff" alongside the camera. */
export function setCloudFocusObject(object) {
  _focusObject = object && object.matrixWorld ? object : null;
}

/** Copy the focus object's world position into the shared uniform. */
export function updateCloudFocus() {
  const f = cloudVolumeUniforms.focus.value;
  if (_focusObject && !_focusMuted) {
    const e = _focusObject.matrixWorld.elements;
    f[0] = e[12]; f[1] = e[13]; f[2] = e[14];
  } else {
    f[0] = 1e9; f[1] = 1e9; f[2] = 1e9;
  }
}
