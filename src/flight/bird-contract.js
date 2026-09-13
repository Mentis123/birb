// The rig contract for the bird model.
//
// `index.html`'s pose code (and `src/flight/bird-pose.js` behind it) drives the
// bird BY NAME: it looks up `leftWing`, `rightWing`, `tail`, `leftFoot` and
// `rightFoot`, reads each animated group's `userData.baseRotation` as the
// neutral pose to offset from, writes flex into `userData.tipFeather.position.y`
// and `userData.secondaryFeather.position.y`, and mirrors the right wing with a
// NEGATIVE `scale.z` (it writes `rightWing.scale.z = -span` every frame).
//
// A model that does not expose exactly that is a statue: it renders, it looks
// plausible in a screenshot, and it cannot flap. The shipped `birb.glb` is the
// worked example — one mesh, one material, no names, no userData — and nothing
// in the codebase could tell. This module is that missing check, per
// docs/realism/BIRD_PLAN.md Phase 0 item 5.
//
// Deliberately PURE: no THREE import, no DOM. It walks a duck-typed tree
// (`children[]`, `name`, `userData`, `scale`) so it can run in `node --test`
// against a fake, and in the browser against a real Object3D or a freshly
// parsed glTF scene, with the same code.

/** Budget for the whole bird, from BIRD_PLAN.md's Phase 0 gate. */
export const BIRD_BUDGET = Object.freeze({ maxDrawCalls: 8, maxTriangles: 4000 });

/** Groups the rig looks up by name. */
const REQUIRED_NODES = ['leftWing', 'rightWing', 'tail', 'leftFoot', 'rightFoot'];

/** Groups whose neutral pose the rig offsets from. */
const NEEDS_BASE_ROTATION = ['leftWing', 'rightWing', 'tail'];

/** Groups that carry the feather empties the flex + ribbon trail need. */
const WINGS = ['leftWing', 'rightWing'];

function isObject(value) {
  return typeof value === 'object' && value !== null;
}

function hasNumericXYZ(value) {
  return isObject(value)
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.z);
}

/**
 * Depth-first search for a named node. Duck-typed: anything with a `name` and
 * an optional `children` array works, so a test fake, an Object3D and a parsed
 * glTF scene all walk identically.
 */
function findByName(root, name) {
  if (!isObject(root)) return null;
  if (root.name === name) return root;
  const kids = root.children;
  if (!Array.isArray(kids)) return null;
  for (let i = 0; i < kids.length; i++) {
    const hit = findByName(kids[i], name);
    if (hit) return hit;
  }
  return null;
}

/**
 * Validate a bird model against the rig contract.
 *
 * @param {object} model root node of the bird (duck-typed Object3D)
 * @returns {{ ok: boolean, failures: string[] }} every failure, each naming the
 *   node at fault, so a rejected model reports everything wrong with it in one
 *   pass instead of one problem per run.
 */
export function birdRigContract(model) {
  const failures = [];

  if (!isObject(model)) {
    failures.push(`bird model: expected an object tree with children[], got ${model === null ? 'null' : typeof model}`);
    return { ok: false, failures };
  }

  const found = Object.create(null);
  for (const name of REQUIRED_NODES) {
    const node = findByName(model, name);
    found[name] = node;
    if (!node) {
      failures.push(`bird model: no node named "${name}" — the rig looks it up by name and will silently skip it, so that part of the bird never animates`);
    }
  }

  for (const name of NEEDS_BASE_ROTATION) {
    const node = found[name];
    if (!node) continue; // already reported as missing
    const base = node.userData && node.userData.baseRotation;
    if (base === undefined || base === null) {
      failures.push(`${name}: missing userData.baseRotation — the rig offsets every pose from this neutral Euler, so without it the ${name === 'tail' ? 'tail' : 'wing'} animates from an undefined base`);
    } else if (!hasNumericXYZ(base)) {
      failures.push(`${name}: userData.baseRotation must have numeric x, y and z (got x=${base.x}, y=${base.y}, z=${base.z})`);
    }
  }

  for (const name of WINGS) {
    const node = found[name];
    if (!node) continue;
    const userData = isObject(node.userData) ? node.userData : {};

    const tip = userData.tipFeather;
    if (tip === undefined || tip === null) {
      failures.push(`${name}: missing userData.tipFeather — the rig writes flex into its position.y and src/effects/ribbon-trail.js reads its world position as the anchor for the wingtip ribbon, which silently vanishes without it`);
    } else if (!isObject(tip) || !isObject(tip.position)) {
      failures.push(`${name}: userData.tipFeather must be an object with a position — the rig writes tipFeather.position.y and the ribbon trail reads its world position`);
    }

    const secondary = userData.secondaryFeather;
    if (secondary === undefined || secondary === null) {
      failures.push(`${name}: missing userData.secondaryFeather — the rig writes flex lag into its position.y, which is the wing's follow-through`);
    } else if (!isObject(secondary) || !isObject(secondary.position)) {
      failures.push(`${name}: userData.secondaryFeather must be an object with a position — the rig writes secondaryFeather.position.y`);
    }
  }

  // The mirror convention. The rig writes `rightWing.scale.z = -span` and
  // `leftWing.scale.z = +span` every frame, so a model that mirrors the right
  // wing any other way (rotation, negated geometry, a flipped parent) gets its
  // right wing turned inside out the first time the flap runs.
  const leftWing = found.leftWing;
  if (leftWing) {
    if (!isObject(leftWing.scale) || !Number.isFinite(leftWing.scale.z)) {
      failures.push('leftWing: no numeric scale.z — the rig writes span into scale.z');
    } else if (!(leftWing.scale.z > 0)) {
      failures.push(`leftWing: scale.z must be POSITIVE (got ${leftWing.scale.z}) — the left wing is the unmirrored side and the rig writes scale.z = +span to it`);
    }
  }

  const rightWing = found.rightWing;
  if (rightWing) {
    if (!isObject(rightWing.scale) || !Number.isFinite(rightWing.scale.z)) {
      failures.push('rightWing: no numeric scale.z — the rig mirrors this wing with a negative scale.z');
    } else if (!(rightWing.scale.z < 0)) {
      failures.push(`rightWing: scale.z must be NEGATIVE (got ${rightWing.scale.z}) — the right wing is mirrored by negative Z scale and the rig writes scale.z = -span to it; a model mirrored any other way flaps backwards on that side`);
    }
  }

  return { ok: failures.length === 0, failures };
}

export default birdRigContract;
