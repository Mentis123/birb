/**
 * src/flight/species/wing-tip.js — where the crow's and the owl's RENDERED
 * wingtip actually is, so the ribbon trail leaves the feather it is drawn on.
 *
 * WHY THIS EXISTS. The wing meshes are bent in the vertex shader
 * (materials.js `realDeform`): the hand rotates about the wrist by 3/4 of
 * uCurl, the arm bends about the shoulder by the last 1/4 with a quadratic
 * falloff toward the body, uSweep trails the tip by a quadratic of the span,
 * and the crow's fingered primaries splay about their own roots. The rig's
 * `hand` node owns no geometry: the shader only reads it back through uniform
 * getters (uCurl = -handX * curlGain, uSweep = -sin(handY) * handLen). So a
 * tipFeather hung under the hand follows the hand's RIGID rotation — about the
 * wrist node's own origin, by the full handX rather than 3/4 of the
 * species-scaled curl, with no shoulder bend, no sweep, no splay, and with the
 * hand's scale.x and the rig's featherFlex (tipFeather.position.y) that the
 * geometry never sees. The ribbon (index.html, `tip.getWorldPosition`) then
 * draws off the wing, measurably so at mid-stroke.
 *
 * WHAT IT DOES. Evaluate a POINT, not a rotation: the same arithmetic the
 * shader applies to a vertex, applied to the one vertex the builders call the
 * wing tip (spec.anchors.wingTip — the outermost primary's feather tip, which
 * IS a vertex of the wing mesh; `findWingTipDef` reads that vertex's aDef so
 * the hand weight, splay factor and splay pivot are the geometry's own, not a
 * copy that could drift). The deformed point is in the wing MESH's frame
 * (Gauntlet: span on +X, -Z forward); the mesh sits in its wing group under
 * rotation.y = -pi/2 (x' = -z, z' = x, species-bird.js `toRoot`), so the
 * group-local point is one swizzle away. tipFeather then rides the group's own
 * transform — the rig's wing rotation and span scale and, on rightWing, the
 * scale.z = -1 mirror — exactly as the mesh does. The right wing is the SAME
 * geometry under that mirror, so its group-local point is identical and the
 * mirror needs no code here.
 *
 * Re-parenting tipFeather from the hand to the wing group makes this a plain
 * position write. If it stays under the hand, `update` also undoes the hand's
 * local transform (position, Euler in its own order, scale), which is exact
 * for any invertible hand pose; the group-parented form is preferred because
 * it does not depend on that inverse.
 *
 * The blocks of `realDeform` that are NOT re-implemented, and why:
 *   - the gear/key spin (REAL_MECH, aAxis.w > 0.5): the tip vertex is a
 *     primary plate, aAxis.w = 0 (`findWingTipDef` reports it; the test
 *     asserts it). The owl's wing train sits on the arm coverts.
 *   - the tail block: the wing materials get the tail-OFF uniforms (yaw 0,
 *     pitch 0, fan 1, uTailZ 0, uTailInv 0), for which it is the identity.
 *     The test transliterates it in full to prove that.
 *
 * Pure: no THREE, plain numbers. Zero per-frame allocation: `update` writes
 * into caller-owned and closure scratch objects only.
 */

/**
 * The shader's wing deformation of one vertex, in the wing mesh's frame.
 *
 * @param {{x:number,y:number,z:number}} out  caller-owned result
 * @param {number} px @param {number} py @param {number} pz  REST position
 *   (the vertex's `position` attribute: the shader takes sx, the arm falloff
 *   and the sweep weight from it, not from the splayed point)
 * @param {{hand:number,splay:number,pivotX:number,pivotZ:number}} def  aDef
 * @param {{curl:number,sweep:number,spanInv:number,wristX:number,splay:number}} u
 *   uCurl, uSweep, uSpanInv, uWristX, uSplay
 */
export function deformWingPoint(out, px, py, pz, def, u) {
  let x = px, y = py, z = pz;
  // aDef.y: a primary's splay about its own root, in the wing plane.
  if (def.splay !== 0) {
    const sa = def.splay * u.splay;
    const c = Math.cos(sa), s = Math.sin(sa);
    const dx = x - def.pivotX, dz = z - def.pivotZ;
    x = def.pivotX + dx * c + dz * s;
    z = def.pivotZ - dx * s + dz * c;
  }
  // (The tail block is the identity under the wing's tail-off uniforms.)
  // The wrist: the hand (aDef.x) turns about the wrist by 3/4 of the curl.
  const sx = px < 0 ? -1 : 1;
  const ah = u.curl * 0.75 * def.hand * sx;
  const ch = Math.cos(ah), sh = Math.sin(ah);
  const wx = sx * u.wristX;
  const hx = x - wx, hy = y;
  x = wx + hx * ch - hy * sh;
  y = hx * sh + hy * ch;
  // The shoulder: the last 1/4, weighted by the rest span fraction squared.
  let t = Math.abs(px) / Math.max(u.wristX, 1e-3);
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  const aa = u.curl * 0.25 * t * t * sx;
  const ca = Math.cos(aa), sa2 = Math.sin(aa);
  const ax = x, ay = y;
  x = ax * ca - ay * sa2;
  y = ax * sa2 + ay * ca;
  // The sweep trails the tip by the rest span fraction squared.
  let s2 = Math.abs(px) * u.spanInv;
  s2 = s2 < 0 ? 0 : (s2 > 1 ? 1 : s2);
  z += u.sweep * s2 * s2;
  out.x = x; out.y = y; out.z = z;
  return out;
}

/**
 * Wing-mesh frame -> wing-group frame. The mesh is added with rotation.y =
 * -pi/2 and no offset (species-bird.js `add(..., rotateIn)`): x' = -z, z' = x.
 * In-place safe.
 */
export function meshToWingGroup(out, p) {
  const x = p.x, z = p.z;
  out.x = -z;
  out.y = p.y;
  out.z = x;
  return out;
}

/**
 * A point in a node's PARENT frame -> the node's own frame: the inverse of its
 * local TRS (position, then the Euler in its own order, then scale). An Euler
 * of order "ABC" is R_A R_B R_C, so its inverse applies R_A^T first. A zero
 * scale component cannot be inverted and maps that axis to 0. In-place safe.
 */
export function parentToLocal(out, p, node) {
  let x = p.x - node.position.x;
  let y = p.y - node.position.y;
  let z = p.z - node.position.z;
  const r = node.rotation;
  const order = r.order || 'XYZ';
  for (let i = 0; i < 3; i++) {
    const axis = order.charCodeAt(i);        // 88 X, 89 Y, 90 Z
    const a = axis === 88 ? r.x : (axis === 89 ? r.y : r.z);
    if (a === 0) continue;
    const c = Math.cos(a), s = Math.sin(a);
    if (axis === 88) { const ny = y * c + z * s; z = -y * s + z * c; y = ny; }
    else if (axis === 89) { const nx = x * c - z * s; z = x * s + z * c; x = nx; }
    else { const nx = x * c + y * s; y = -x * s + y * c; x = nx; }
  }
  const sc = node.scale;
  out.x = sc.x !== 0 ? x / sc.x : 0;
  out.y = sc.y !== 0 ? y / sc.y : 0;
  out.z = sc.z !== 0 ? z / sc.z : 0;
  return out;
}

/**
 * The tip vertex's deformer attributes, read from the wing geometry: the
 * vertex nearest `tip` (the builders place the anchor ON a vertex; the
 * distance is returned so a caller or test can insist on it). Build time
 * only (allocates).
 *
 * @param {ArrayLike<number>} positions  xyz per vertex (MeshData arrays.position)
 * @param {ArrayLike<number>} aDefs      aDef per vertex (4 each)
 * @param {ArrayLike<number>} tip        [x, y, z] in the wing mesh's frame
 * @param {ArrayLike<number>} [aAxis]    aAxis per vertex (owl), for `mech`
 * @returns {{ def: {hand:number,splay:number,pivotX:number,pivotZ:number},
 *   index: number, distance: number, rest: number[], mech: number }}
 */
export function findWingTipDef(positions, aDefs, tip, aAxis) {
  let best = -1;
  let bestD = Infinity;
  const n = Math.floor(positions.length / 3);
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(positions[i * 3] - tip[0], positions[i * 3 + 1] - tip[1], positions[i * 3 + 2] - tip[2]);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best < 0) throw new Error('wing-tip: empty wing geometry');
  return {
    def: Object.freeze({
      hand: aDefs[best * 4], splay: aDefs[best * 4 + 1], pivotX: aDefs[best * 4 + 2], pivotZ: aDefs[best * 4 + 3],
    }),
    index: best,
    distance: bestD,
    rest: [positions[best * 3], positions[best * 3 + 1], positions[best * 3 + 2]],
    mech: aAxis ? aAxis[best * 4 + 3] : 0,
  };
}

/**
 * The per-frame tracker. One serves both wings (they share the geometry; only
 * their uniforms differ).
 *
 * @param {object} o
 * @param {ArrayLike<number>} o.tip  the tip point in the wing mesh's frame
 *   (spec.anchors.wingTip)
 * @param {{hand:number,splay:number,pivotX:number,pivotZ:number}} o.def  the
 *   tip vertex's aDef (`findWingTipDef(...).def`)
 * @returns {{ update(u: object, tipNode: object, handNode?: object): void,
 *   point: {x:number,y:number,z:number} }}
 *   `update(u, tipNode, handNode)`: `u` is the wing material's deform uniform
 *   set ({ uCurl, uSweep, uSpanInv, uWristX, uSplay }, each `.value` — the
 *   same getters the shader is fed, so the tracker cannot disagree with the
 *   GPU about the rig mapping). Writes tipNode.position (all three components,
 *   overwriting the rig's featherFlex, which the geometry does not have). If
 *   `handNode` is given and is tipNode's parent, the point is expressed in the
 *   hand's frame; otherwise tipNode must be a direct child of the wing group.
 *   `point` is the last group-local result.
 */
export function createWingTipTracker(o) {
  // The GPU reads the vertex from a Float32Array (species-bird.js toGeometry),
  // so the rest point and the attributes are taken at float32 too: the tracker
  // then agrees with the uploaded vertex to double rounding, not to ~5e-8.
  const f = Math.fround;
  const rx = f(o.tip[0]), ry = f(o.tip[1]), rz = f(o.tip[2]);
  const def = Object.freeze({
    hand: f(o.def.hand), splay: f(o.def.splay), pivotX: f(o.def.pivotX), pivotZ: f(o.def.pivotZ),
  });
  const u = { curl: 0, sweep: 0, spanInv: 0, wristX: 1, splay: 0 };
  const point = { x: 0, y: 0, z: 0 };
  const local = { x: 0, y: 0, z: 0 };
  function update(uniforms, tipNode, handNode) {
    u.curl = uniforms.uCurl.value;
    u.sweep = uniforms.uSweep.value;
    u.spanInv = uniforms.uSpanInv.value;
    u.wristX = uniforms.uWristX.value;
    u.splay = uniforms.uSplay.value;
    deformWingPoint(point, rx, ry, rz, def, u);
    meshToWingGroup(point, point);
    let p = point;
    if (handNode && tipNode.parent === handNode) p = parentToLocal(local, point, handNode);
    tipNode.position.x = p.x;
    tipNode.position.y = p.y;
    tipNode.position.z = p.z;
  }
  return { update, point };
}
