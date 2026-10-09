/**
 * src/flight/species/species-bird.js — Corvus (crow) and Tock (clockwork owl)
 * as a ROOT-GAME bird: the same rig every other bird in index.html is driven
 * through.
 *
 * PORTED from Birb Gauntlet's gauntlet/src/bird/realistic/realistic-bird.js
 * (the adapter that turns the pure crow/owl MeshData into three objects). The
 * builders, the materials and the shader are Gauntlet's, copied into this
 * folder; Gauntlet is airtight both ways, so nothing here imports from it.
 * What changed is the FRAME and the DRIVER:
 *
 * THE FRAME. Gauntlet birds face -Z with the span on X; the root bird faces +X
 * with the span on Z (BIRD_PLAN.md, bird-contract.js). Rotating Gauntlet's
 * frame by -90 degrees about Y maps -Z onto +X and +X onto +Z exactly, so
 * every mesh keeps its Gauntlet-local geometry — which the vertex shader's
 * deformers (the wrist on position.x, the tail on position.z) depend on — and
 * sits under a node that carries that rotation. The RIG nodes the pose code
 * looks up by name are built in the ROOT frame:
 *
 *   leftWing   at the bird's RIGHT shoulder (+Z): the root rig's naming, which
 *              is not anatomical (CLAUDE.md, "the bank dip lowers the inside
 *              wing"). scale.z = +1. Its mesh is Gauntlet's RIGHT wing.
 *   rightWing  at the bird's LEFT shoulder (-Z), scale.z = -1 — the rig's
 *              mirror. The SAME right-wing geometry under the mirror is
 *              exactly Gauntlet's mirrorX'd left wing (R(-90) then S(z=-1)
 *              equals R(-90) after mirrorX), so no second wing is built.
 *   hand       a node at each wrist that owns no geometry: the rig rotates it
 *              (handX drops it, handY sweeps it forward, scale.x spreads it)
 *              and the shader reads it back through uniform GETTERS — the
 *              Gauntlet wrist joint (uCurl/uSweep) driven by the root rig. The
 *              wing tip anchor (tipFeather) is a child of the hand, so the
 *              ribbon trail follows the bending wrist.
 *   tail       a node at the tail root; its rotation.y (yaw), rotation.z
 *              (pitch, the aero rig) and scale.z (fan) feed the tail deformer.
 *   leftFoot / rightFoot  real legs. Gauntlet bakes the crow's and owl's legs
 *              into the body, tucked, because its birds never land; here each
 *              leg is its own mesh, modelled STANDING, so the rig's tuck
 *              (rotation.z, userData.tuck), landing gear and walk all work.
 *
 * Draw calls (one per mesh): crow body, head, tail, two wings, two legs = 7
 * (6 on low, tail merged); owl body (+tail, gears, key), head, two wings, two
 * legs = 6. Inside BIRD_BUDGET's 8.
 *
 * THE LIGHT. High and mid get the ROOT game's bird-only sky (plumage.js
 * createBirdEnvironment, bound by index.html on the materials listed in
 * `envMaterials`), turned to the radial up every frame by the same call that
 * turns the Pionus's. The injected shader already routes the hemisphere into
 * the IBL slot exactly as installPlumageLighting does (uPlumHemi = 1,
 * uPlumEnvDiffuse = 0), so the sky is counted once. Low is Phong, no probe.
 *
 * Zero per-frame allocation: `update()` only writes numbers into existing
 * uniforms, Eulers and closure scalars. The uniform getters read node fields.
 */

import { buildCrow } from './crow.js';
import { buildOwl } from './owl.js';
import { acquireFeatherTextures, releaseFeatherTextures } from './feather-textures.js';
import { createRealMaterial, lookUniforms } from './materials.js';
import { PALETTE, makeRng } from './species-palette.js';
import { pionusStroke, AERO_POSE_DEFAULTS } from '../aero-pose.js';

export const SPECIES_IDS = Object.freeze(['crow', 'owl']);
export const SPECIES_TIERS = Object.freeze(['high', 'mid', 'low']);

const TAU = Math.PI * 2;

/**
 * Per-species form in the root frame. `scale` makes the chase-camera read
 * comparable to the Pionus (whose model spans ~3.5 units under the same
 * 0.52 anchor scale); `legLen` is the standing tarsus (Gauntlet units) and
 * `tuck` the leg's flight angle about the hip (rotation.z; -pi/2 lays it
 * straight aft along the belly). `base` is the wing's rest Euler for the
 * leftWing group (the right takes (-x, -y, +z), the rig's mirror rule).
 */
export const SPECIES_FORM = Object.freeze({
  crow: Object.freeze({
    scale: 1.32,
    legLen: 0.20,
    hip: Object.freeze([0.050, -0.118, 0.14]),
    tuck: -1.66,
    base: Object.freeze([-0.16, -0.14, 0.04]),
    curlGain: 1 / 0.75,
  }),
  owl: Object.freeze({
    scale: 1.5,
    legLen: 0.15,
    hip: Object.freeze([0.070, -0.160, 0.05]),
    tuck: -1.62,
    base: Object.freeze([-0.12, -0.10, 0.04]),
    // Brass does not flex: a fraction of the rig's wrist whip (Gauntlet's
    // mechCurl is 0.18 of its own; the root rig's hand is already gentler).
    curlGain: 0.45 / 0.75,
  }),
});

/** Fresnel rim per tier (Gauntlet's values: faint on the near-black crow). */
export const SPECIES_RIM = Object.freeze({
  crow: Object.freeze({ color: 0x9db8e0, power: 3.0, strength: Object.freeze({ high: 0.025, mid: 0.03, low: 0.18 }) }),
  owl: Object.freeze({ color: 0xfff1cf, power: 3.0, strength: Object.freeze({ high: 0.05, mid: 0.06, low: 0.14 }) }),
});

/**
 * Probe reflection strength: low on the crow so the sky never greys the black.
 * Gauntlet's were 0.42 / 0.8 against its lifted probe; the root bird-only sky
 * is the biome gradient itself (a saturated zenith), and the chase camera
 * looks along the crow's back at a grazing angle where Fresnel is near 1, so
 * the crow takes 0.3 here.
 */
export const SPECIES_ENV_INTENSITY = Object.freeze({ crow: 0.3, owl: 0.8 });

/**
 * Thin-film strength on the high tier (material.iridescence; the per-vertex
 * weights in aSurf.z still mask it to the dorsal vanes and gate it to upward
 * faces). Gauntlet's 1.0 read violet from the root chase camera, where every
 * dorsal vane is seen near grazing; 0.3 is a blue-violet SHEEN on a black bird.
 */
export const SPECIES_FILM_STRENGTH = Object.freeze({ crow: 0.3, owl: 1 });

/**
 * Shade on dielectrics (materials.js SHADE_NEUTRAL / SHADE_FLOOR /
 * SHADE_GLASS): the owl's cream enamel disc and amber enamel iris face away
 * from the sun and must read ivory and amber, not teal and grey. Retuned for
 * the root game's hemisphere sky; the crow keeps its black untouched.
 */
export const SPECIES_SHADE = Object.freeze({
  // `spec`: the sky reflection's hue pulled this far to neutral on every
  // dielectric (materials.js uSpecNeutral) — the crow's back mirrors the
  // biome's saturated zenith at grazing and read royal blue at 0.
  // `metal`: the same pull on every metal's reflection (uMetalNeutral), so
  // the owl's steel reads steel-grey and its brass brass, not sky-blue.
  crow: Object.freeze({ neutral: 0, floor: 0, spec: 0.5, metal: 0 }),
  owl: Object.freeze({ neutral: 0.8, floor: 0.8, spec: 0, metal: 0.6 }),
});

/**
 * Landing gear that RETRACTS. The legs are modelled standing (the toes flat on
 * the ground); tucked by rotation alone they would trail behind the belly with
 * the toes hanging down like a second tail. So as the rig tucks a leg
 * (rotation.z toward userData.tuck) the leg also draws in toward the hip, to
 * this fraction of its length when fully tucked — the crow's feet pulled up
 * into the belly feathers, the automaton's telescoping legs.
 */
export const LEG_RETRACT = Object.freeze({ crow: 0.3, owl: 0.3 });

/** Clockwork: wing positions per beat, the key's spin, the gear's tooth step. */
export const OWL_CLOCKWORK = Object.freeze({
  steps: 6,
  keyIdle: 1.6,          // rad/s, the spring letting go
  keyBoost: 11.0,        // rad/s under boost: the key whirs
  gearPerBeat: 0.9,      // rad of back-gear travel per wingbeat
  gearIdle: 0.35,        // rad/s while gliding
  gearTooth: TAU / 24,   // the barrel's tooth pitch: the train ticks a tooth at a time
});

const BLINK = Object.freeze({ min: 2.4, max: 5.6, dur: 0.13 });

function toGeometry(THREE, md) {
  const g = new THREE.BufferGeometry();
  for (const name in md.layout) {
    g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(md.arrays[name]), md.layout[name]));
  }
  const Index = md.vertexCount > 65535 ? Uint32Array : Uint16Array;
  g.setIndex(new THREE.BufferAttribute(new Index(md.index), 1));
  g.computeBoundingSphere();
  // The shader bends wings and fans the tail past the rest bounds.
  if (g.boundingSphere) g.boundingSphere.radius *= 1.25;
  return g;
}

/** Gauntlet-frame point -> root-frame point (R_y(-90): x' = -z, z' = x). */
function toRoot(p) {
  return [-p[2], p[1], p[0]];
}

/**
 * The root game's quality tiers -> a species LOOK. The bird's MATERIAL tier
 * follows the render tier (0: Ultra and Amazing at its best, 1: Okay, 2:
 * Light — `adaptiveTier.getTier()`), but its GEOMETRY is one step leaner than
 * Gauntlet's at the top: the default Ultra frame at the forest spawn already
 * measures ~75-77k triangles with the Pionus's 1.5k in it, against an 80k
 * budget, so a 4.7k crow or a 6.0k owl would push it over. Tier 0 therefore
 * pairs the PHYSICAL materials (keratin, thin film, sheen, clearcoat) with the
 * mid meshes — the owl's trimmed further (OWL_ROOT_MID) — so the whole bird
 * stays inside BIRD_BUDGET's 4,000 triangles and 8 draws at every tier.
 */
export function speciesTierFor(renderTier) {
  const t = Number(renderTier);
  if (t >= 2) return 'low';
  if (t === 1) return 'mid';
  return 'high';
}

/**
 * The owl's root-game mid mesh: Gauntlet's mid with the gear tooth walls,
 * the wing train on the arm coverts (552 of the triangles, two wings), some
 * rivets, a breast column and a few plates dropped: ~3.4k triangles with legs
 * instead of 5.0k. The back train in the bay — the one the chase camera
 * looks down on — keeps all three gears and every tooth, and turns with the
 * wingbeat.
 */
export const OWL_ROOT_MID = Object.freeze({
  gearWalls: false, wingGears: false, seamRivets: 3, discRivets: 3, breast: Object.freeze([2, 3]), eyeSegs: 10,
  tail: 5, tCoverts: 2, primaries: 7, secondaries: 5, gCoverts: 5, blades: 4,
  discSegs: 12, headSegs: 14, bodySegs: 14, legSegs: 4, plateSegs: 2, keySegs: 6, perTooth: 3, hubSegs: 5,
});

/** Geometry per (species, look tier). */
export const SPECIES_DETAIL = Object.freeze({
  crow: Object.freeze({ high: Object.freeze({ geometry: 'mid', lod: null }), mid: Object.freeze({ geometry: 'mid', lod: null }), low: Object.freeze({ geometry: 'low', lod: null }) }),
  owl: Object.freeze({ high: Object.freeze({ geometry: 'mid', lod: OWL_ROOT_MID }), mid: Object.freeze({ geometry: 'mid', lod: OWL_ROOT_MID }), low: Object.freeze({ geometry: 'low', lod: null }) }),
});

/** The pure build (no THREE): the spec the adapter uploads. The tests use it. */
export function buildSpeciesSpec(species, quality) {
  const q = SPECIES_TIERS.includes(quality) ? quality : 'high';
  const id = species === 'crow' ? 'crow' : 'owl';
  const f = SPECIES_FORM[id];
  const d = SPECIES_DETAIL[id][q];
  const opts = { quality: d.geometry, variant: 'normal', legs: { len: f.legLen } };
  if (d.lod) opts.lod = d.lod;
  return id === 'crow' ? buildCrow(opts) : buildOwl(opts);
}

/**
 * @param {object} THREE
 * @param {{ species: 'crow'|'owl', quality?: 'high'|'mid'|'low' }} opts
 */
export function createSpeciesBird(THREE, opts = {}) {
  const species = opts.species === 'crow' ? 'crow' : 'owl';
  const crow = species === 'crow';
  const quality = SPECIES_TIERS.includes(opts.quality) ? opts.quality : 'high';
  const form = SPECIES_FORM[species];
  const spec = buildSpeciesSpec(species, quality);
  const rig = spec.rig;
  const textures = acquireFeatherTextures(THREE);

  const geometries = [];
  const materials = [];
  const meshes = [];

  const model = new THREE.Group();
  model.name = crow ? 'birbSpeciesCrow' : 'birbSpeciesOwl';
  model.scale.setScalar(form.scale);

  // Gauntlet frame: everything rigid with the body hangs here.
  const frame = new THREE.Group();
  frame.name = 'speciesFrame';
  frame.rotation.y = -Math.PI / 2;
  model.add(frame);
  const head = new THREE.Group();
  head.name = 'speciesHead';
  head.position.set(rig.head[0], rig.head[1], rig.head[2]);
  frame.add(head);

  // --- rig nodes, root frame -------------------------------------------------
  const wingTipLocal = toRoot(spec.anchors.wingTip);
  const wristLocal = toRoot([rig.wristX, 0, -0.04]);
  const wings = [];
  const hands = [];
  for (let i = 0; i < 2; i++) {
    const left = i === 0;                       // root-rig name: leftWing is at +Z
    const g = new THREE.Group();
    g.name = left ? 'leftWing' : 'rightWing';
    const sh = toRoot([rig.shoulder[0], rig.shoulder[1], rig.shoulder[2]]);
    g.position.set(sh[0], sh[1], left ? sh[2] : -sh[2]);
    const b = form.base;
    g.rotation.set(left ? b[0] : -b[0], left ? b[1] : -b[1], b[2]);
    g.userData.baseRotation = g.rotation.clone();
    g.scale.z = left ? 1 : -1;
    const hand = new THREE.Object3D();
    hand.name = 'hand';
    hand.position.set(wristLocal[0], wristLocal[1], wristLocal[2]);
    hand.userData.baseRotation = new THREE.Euler(0, 0, 0);
    g.add(hand);
    const tip = new THREE.Object3D();
    tip.name = 'tipFeather';
    tip.position.set(wingTipLocal[0] - wristLocal[0], 0, wingTipLocal[2] - wristLocal[2]);
    hand.add(tip);
    const secondary = new THREE.Object3D();
    secondary.name = 'secondaryFeather';
    const sec = toRoot([rig.wristX * 0.55, 0, 0.22]);
    secondary.position.set(sec[0], 0, sec[2]);
    g.add(secondary);
    g.userData.hand = hand;
    g.userData.tipFeather = tip;
    g.userData.secondaryFeather = secondary;
    model.add(g);
    wings.push(g);
    hands.push(hand);
  }

  const tailNode = new THREE.Object3D();
  tailNode.name = 'tail';
  const tailAt = toRoot(spec.anchors.body.tail);
  tailNode.position.set(tailAt[0], tailAt[1], tailAt[2]);
  tailNode.userData.baseRotation = new THREE.Euler(0, 0, 0);
  model.add(tailNode);

  const feet = [];
  for (let i = 0; i < 2; i++) {
    const left = i === 0;
    const g = new THREE.Group();
    g.name = left ? 'leftFoot' : 'rightFoot';
    const hip = toRoot(form.hip);
    g.position.set(hip[0], hip[1], left ? Math.abs(hip[2]) : -Math.abs(hip[2]));
    g.rotation.z = form.tuck;
    g.userData.tuck = form.tuck;
    model.add(g);
    feet.push(g);
  }

  // --- mechanism nodes (owl): the shader reads their angles ------------------
  let mech = null;
  let mechUniforms = null;
  if (!crow) {
    const key = new THREE.Object3D();
    key.name = 'windKey';
    const gear = new THREE.Object3D();
    gear.name = 'backGear';
    frame.add(key);
    frame.add(gear);
    mech = { key, gear };
    mechUniforms = {
      uGearAngle: { get value() { return gear.rotation.y; } },
      uKeyAngle: { get value() { return key.rotation.y; } },
    };
  }

  // --- uniforms ----------------------------------------------------------------
  // The tail deformer reads the rig's tail node. Under ?aeropose=0 the old rig
  // writes the elevator into rotation.x (the aero rig's twist slot) with
  // bird-pose's tailPitchOffset sign (NEGATIVE drops the tail), so the pitch
  // getter follows whichever rig is live (see update()) and flips that one.
  let aeroLive = true;
  const tail = {
    uTailYaw: { get value() { return tailNode.rotation.y; } },
    uTailPitch: { get value() { return aeroLive ? tailNode.rotation.z : -tailNode.rotation.x; } },
    uTailFan: { get value() { return tailNode.scale.z; } },
    uTailZ: { value: rig.tailZ },
    uTailInv: { value: 1 / rig.tailLen },
  };
  const tailOff = {
    uTailYaw: { value: 0 }, uTailPitch: { value: 0 }, uTailFan: { value: 1 },
    uTailZ: { value: 0 }, uTailInv: { value: 0 },
  };
  const splay = { value: 0 };
  const handLen = Math.max(0.1, rig.wingSpan - rig.wristX);
  const wingSet = (hand) => ({
    // Root rig: + hand.rotation.x DROPS the hand; Gauntlet: + uCurl raises it
    // (3/4 at the wrist). Root + hand.rotation.y sweeps it FORWARD; Gauntlet
    // + uSweep trails the tip aft (+Z there is -X here).
    uCurl: { get value() { return -hand.rotation.x * form.curlGain; } },
    uSweep: { get value() { return -Math.sin(hand.rotation.y) * handLen; } },
    uSpanInv: { value: 1 / rig.wingSpan },
    uWristX: { value: rig.wristX },
    uSplay: splay,
  });
  const wingOff = {
    uCurl: { value: 0 }, uSweep: { value: 0 }, uSpanInv: { value: 0 }, uWristX: { value: 1 }, uSplay: { value: 0 },
  };
  const blink = { uBlink: { value: 0 } };
  const rim = SPECIES_RIM[species];
  const look = lookUniforms({
    lid: crow ? PALETTE.realCrowMembrane : PALETTE.realShutter,
    rim: { color: rim.color, power: rim.power, strength: rim.strength[quality] },
    film: quality === 'mid' ? spec.film : null,
    shade: SPECIES_SHADE[species],
  });
  const lowSpecular = crow ? 0x262c3e : 0x6a5c40;
  const material = (kind, deform, tailSet) => {
    const m = createRealMaterial(THREE, {
      tier: quality, kind, double: true, mech: !crow, textures,
      film: spec.film, sheen: spec.sheen, filmUp: crow, envIntensity: SPECIES_ENV_INTENSITY[species],
      lowSpecular,
      uniforms: Object.assign({}, deform, tailSet, blink, look, mechUniforms || {}),
    });
    if (m.isMeshPhysicalMaterial && m.iridescence > 0) m.iridescence = SPECIES_FILM_STRENGTH[species];
    materials.push(m);
    return m;
  };
  const lowMerged = crow && quality === 'low';
  const bodyMat = crow ? material('contour', wingOff, lowMerged ? tail : tailOff) : material('metal', wingOff, tail);
  const tailMat = crow && !lowMerged ? material('vane', wingOff, tail) : null;
  const wingMats = [
    material(crow ? 'vane' : 'metal', wingSet(hands[0]), tailOff),
    material(crow ? 'vane' : 'metal', wingSet(hands[1]), tailOff),
  ];

  const add = (parent, name, md, mat, rotateIn) => {
    const geo = toGeometry(THREE, md);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    if (rotateIn) mesh.rotation.y = -Math.PI / 2;
    parent.add(mesh);
    geometries.push(geo);
    meshes.push(mesh);
    return mesh;
  };
  let wingData = null;
  for (const m of spec.meshes) {
    if (m.role === 'body') add(frame, 'speciesBody', m.data, bodyMat, false);
    else if (m.role === 'head') add(head, 'speciesHeadMesh', m.data, bodyMat, false);
    else if (m.role === 'tail') add(frame, 'speciesTail', m.data, tailMat, false);
    else if (m.role === 'wing') wingData = m.data;
  }
  add(wings[0], 'speciesWing', wingData, wingMats[0], true);
  add(wings[1], 'speciesWing', wingData, wingMats[1], true);
  // Feet: the leg meshes are modelled at the hip in Gauntlet's frame. The
  // left foot group (+Z, the bird's right) carries the right leg.
  const legMeshes = [
    add(feet[0], 'speciesLeg', spec.legs.right, bodyMat, true),
    add(feet[1], 'speciesLeg', spec.legs.left, bodyMat, true),
  ];
  const legRetract = LEG_RETRACT[species];

  if (mech) {
    mech.key.position.set(spec.mech.keyBase[0], spec.mech.keyBase[1], spec.mech.keyBase[2]);
    mech.gear.position.set(spec.mech.bayCenter[0], spec.mech.bayCenter[1], spec.mech.bayCenter[2]);
  }

  let triangles = 0;
  for (const m of meshes) {
    const idx = m.geometry.index;
    triangles += (idx ? idx.count : m.geometry.getAttribute('position').count) / 3;
  }

  // --- per frame -----------------------------------------------------------------
  const rng = makeRng(crow ? 0xC20E : 0x0717);
  let blinkTimer = BLINK.min + rng() * (BLINK.max - BLINK.min);
  let blinkT = 0;
  let keyAngle = 0;
  let gearAccum = 0;
  let prevPhase = -1;
  const _stroke = { angle: 0, span: 1, hand: 0, handSweep: 0, twist: 0, downstroke: false };
  const _strokeQ = { angle: 0, span: 1, hand: 0, handSweep: 0, twist: 0, downstroke: false };
  const downFrac = AERO_POSE_DEFAULTS.downFrac;
  // The voice's cues for src/audio/flight-audio.js, rewritten every update:
  // the owl's escapement `tick` (a step crossed while beating) and gear
  // `whir` (0..1), the crow's `call` (take-off or a boost began). The audio
  // rate-limits the caw.
  const events = { tick: false, whir: 0, call: false };
  let prevStep = -1;
  let prevBoost = false;
  let prevAir = 0;

  /**
   * After the root rig has posed the wings, tail and feet for this frame.
   * `s`: { dt, aero (aeroPose.out or null), aeroLive, perch (0..1 perchBlend),
   * boosting, reducedMotion }. Zero allocation.
   */
  function update(s) {
    const dt = s && s.dt > 0 ? Math.min(s.dt, 0.1) : 0;
    const a = s && s.aeroLive ? s.aero : null;
    aeroLive = !!(s && s.aeroLive);
    const pb = s && Number.isFinite(s.perch) ? 1 - s.perch : 1;

    // Blink: the crow's nictitating membrane, the owl's steel shutter.
    if (blinkT > 0) {
      blinkT -= dt;
      const k = Math.min(1, Math.max(0, blinkT / BLINK.dur));
      blink.uBlink.value = blinkT > 0 ? Math.sin(k * Math.PI) : 0;
      if (blinkT <= 0) blinkTimer = BLINK.min + rng() * (BLINK.max - BLINK.min);
    } else {
      blinkTimer -= dt;
      if (blinkTimer <= 0) blinkT = BLINK.dur;
    }

    // Retract each leg with its tuck (LEG_RETRACT): standing 1, tucked
    // `legRetract`, smoothstepped so the gear reads as drawn up, not shrunk.
    for (let i = 0; i < 2; i++) {
      let k = feet[i].rotation.z / form.tuck;
      k = k < 0 ? 0 : (k > 1 ? 1 : k);
      k = k * k * (3 - 2 * k);
      legMeshes[i].scale.setScalar(1 - (1 - legRetract) * k);
    }

    const phase = a ? a.phase01 : 0;
    const beating = a ? a.air * a.envelope * a.depth : 0;
    const boosting = !!(s && s.boosting);
    const air = a ? a.air : 0;
    events.call = crow && ((boosting && !prevBoost) || (air > 0.7 && prevAir <= 0.3));
    prevBoost = boosting;
    prevAir = air;
    const step = Math.floor(phase * OWL_CLOCKWORK.steps);
    events.tick = !crow && beating > 0.05 && step !== prevStep;
    prevStep = step;
    events.whir = crow ? 0 : Math.min(1, beating * 1.5 + (boosting ? 0.6 : 0));

    if (crow) {
      // Fingered primaries fan on the powered DOWNstroke (Gauntlet's
      // bird-anim `down`), and on high lift (the aero pose's own splay).
      let down = 0;
      if (a && phase < downFrac) down = Math.sin(Math.PI * phase / downFrac) * Math.min(1, beating * 2.2);
      const lift = a ? a.air * (a.splay || 0) : 0;
      splay.value = s && s.reducedMotion ? 0 : Math.min(1, Math.max(down, lift)) * pb;
      return;
    }

    // --- clockwork ---------------------------------------------------------
    // The escapement: the aero stroke is re-evaluated at the quantised phase
    // and the difference added to the rig's wing writes, so the wing holds
    // `steps` positions per beat and jumps between them. Same mirror rules
    // as the rig: wingX opposite-signed, twist and hand same-signed.
    if (a && beating > 0.001 && !(s && s.reducedMotion)) {
      const n = OWL_CLOCKWORK.steps;
      const q = Math.floor(phase * n) / n;
      pionusStroke(phase, a.depth, _stroke);
      pionusStroke(q, a.depth, _strokeQ);
      const k = a.air * a.envelope * pb;
      const dX = (_strokeQ.angle - _stroke.angle) * k;
      const dZ = (_strokeQ.twist - _stroke.twist) * k;
      const dH = (_strokeQ.hand - _stroke.hand) * k;
      wings[0].rotation.x += dX;
      wings[1].rotation.x -= dX;
      wings[0].rotation.z += dZ;
      wings[1].rotation.z += dZ;
      hands[0].rotation.x += dH;
      hands[1].rotation.x += dH;
    }
    // Gears turn with the wingbeat (a tooth at a time), idle on a glide.
    let dPhase = 0;
    if (a) {
      if (prevPhase >= 0) { dPhase = phase - prevPhase; if (dPhase < 0) dPhase += 1; }
      prevPhase = phase;
    }
    gearAccum = (gearAccum + dPhase * OWL_CLOCKWORK.gearPerBeat * Math.min(1, beating * 3)
      + OWL_CLOCKWORK.gearIdle * dt) % (TAU * 64);
    mech.gear.rotation.y = Math.floor(gearAccum / OWL_CLOCKWORK.gearTooth) * OWL_CLOCKWORK.gearTooth;
    // The key: unwinding slowly, whirring under boost.
    keyAngle = (keyAngle + (s && s.boosting ? OWL_CLOCKWORK.keyBoost : OWL_CLOCKWORK.keyIdle) * dt) % TAU;
    mech.key.rotation.y = keyAngle;
    splay.value = 0;
  }

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (let i = 0; i < geometries.length; i++) geometries[i].dispose();
    for (let i = 0; i < materials.length; i++) {
      materials[i].envMap = null;
      materials[i].dispose();
    }
    releaseFeatherTextures(THREE);
    if (model.parent) model.parent.remove(model);
  }

  model.userData.species = species;
  model.userData.speciesTier = quality;

  return {
    model,
    species,
    quality,
    materials,
    // The physical/standard materials the bird-only sky binds to (none on low).
    envMaterials: quality === 'low' ? [] : materials.slice(),
    geometries,
    textures,
    mech,
    uniforms: {
      blink: blink.uBlink, splay,
      // The look knobs (shared by every material of this bird): __BIRB.speciesTune.
      rimStrength: look.uRimStrength, shadeNeutral: look.uShadeNeutral,
      shadeFloor: look.uShadeFloor, specNeutral: look.uSpecNeutral, metalNeutral: look.uMetalNeutral,
    },
    triangleCount: triangles,
    drawCallCount: meshes.length,
    events,
    update,
    dispose,
    get disposed() { return disposed; },
  };
}
