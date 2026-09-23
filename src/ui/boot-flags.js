/**
 * src/ui/boot-flags.js — the boot-time A/B switches, as a table.
 *
 * Every visual decision in this game since the authored textures landed was
 * judged by an A/B on a real phone, and every one of those A/Bs is a URL
 * flag: `?smooth=0`, `?feathers=0`, `?pionus=0`, `?wing=slim`. They are
 * documented in CLAUDE.md and in nobody's thumb. Typing `?levelturn=0` into
 * a phone's address bar mid-flight is the review loop this game actually
 * has, and it is why half of these comparisons get re-run by exactly one
 * person. The panel's Flags tab renders this table as buttons; tapping one
 * reloads the game with that flag in the URL.
 *
 * These are BOOT flags on purpose. Each of them is read once, during setup,
 * by a module that builds geometry or compiles a shader from the answer —
 * the bird variant builds a different mesh, smooth shading splices a
 * different program, the authored textures are decode-gated swaps with a
 * disposer. Making them live toggles would mean a rebuild path for each,
 * and a rebuild path that exists only for the panel is a second boot path
 * nothing else exercises. A reload IS the rebuild path, and it is the one
 * the harness and the player both use.
 *
 * Pure module: no DOM, no window. `readBootFlag` and `withBootFlag` are
 * string in, string out, so the URL arithmetic is unit-tested and the panel
 * only navigates.
 */

/**
 * A `toggle` flag is ON unless `?key=0` is in the URL — the convention every
 * opt-out in this codebase follows (`authoredBarkRequested`,
 * `smoothShadingRequested`, ...). A `select` flag carries a value; `null`
 * means "absent from the URL", which is the shipping default.
 *
 * `parent` names a flag whose OFF state forces this one off as well:
 * `?authored=0` opts out of every authored texture at once, and the regexes
 * that read the children (`/[?&](bark|authored)=0/`) cannot be argued with
 * from the child's own key. The panel renders such a child disabled while
 * its parent is off, rather than offering a switch that does nothing.
 */
export const BOOT_FLAGS = Object.freeze([
  // ---- Surfaces: the authored textures, each with its own opt-out ----
  { key: 'authored', group: 'Surfaces', kind: 'toggle', label: 'Authored textures',
    hint: 'Every authored surface at once: bark, sandstone, granite, snow, concrete, the forest ground map and the four skies.' },
  { key: 'bark', group: 'Surfaces', kind: 'toggle', label: 'Bark on trunks', parent: 'authored' },
  { key: 'stone', group: 'Surfaces', kind: 'toggle', label: 'Sandstone arch', parent: 'authored' },
  { key: 'canyon', group: 'Surfaces', kind: 'toggle', label: 'Canyon sandstone', parent: 'authored' },
  { key: 'granite', group: 'Surfaces', kind: 'toggle', label: 'Mountain granite', parent: 'authored' },
  { key: 'snow', group: 'Surfaces', kind: 'toggle', label: 'Snow caps', parent: 'authored' },
  { key: 'city', group: 'Surfaces', kind: 'toggle', label: 'City concrete', parent: 'authored' },
  { key: 'ground', group: 'Surfaces', kind: 'toggle', label: 'Forest ground map', parent: 'authored' },
  { key: 'groundbump', group: 'Surfaces', kind: 'toggle', label: 'Ground bump (soil grain)', parent: 'authored' },
  { key: 'skytex', group: 'Surfaces', kind: 'select', label: 'Authored sky',
    options: [
      { value: null, label: 'On' },
      { value: '0.5', label: 'Half mix' },
      { value: '0', label: 'Off' },
    ],
    hint: 'Half mixes the panorama 50/50 with the procedural gradient — the comparison the skies were judged by.' },
  // ---- Shading: the organic pass ----
  { key: 'smooth', group: 'Shading', kind: 'toggle', label: 'Smooth shading (soil rolls, rock fractures)' },
  { key: 'leaves', group: 'Shading', kind: 'toggle', label: 'Lacy canopy edges' },
  { key: 'snowline', group: 'Shading', kind: 'toggle', label: 'Snow on up-facing surfaces' },
  { key: 'ibl', group: 'Shading', kind: 'select', label: 'Image-based lighting',
    options: [
      { value: null, label: 'Off' },
      { value: '1', label: 'On' },
    ],
    hint: 'Off is the shipping default. On prefilters the sky once at boot and lights the scene with it.' },
  // ---- The bird ----
  { key: 'bird', group: 'Bird', kind: 'select', label: 'Bird build',
    options: [
      { value: null, label: 'v3' },
      { value: 'v1', label: 'v1' },
      { value: 'v2', label: 'v2' },
    ],
    hint: 'v3 is the bird with a wrist. v1 is the Phase 0 merge, v2 the one-plate candidate — both kept for the A/B.' },
  { key: 'wing', group: 'Bird', kind: 'select', label: 'Wing planform',
    options: [
      { value: null, label: 'Parrot' },
      { value: 'v3', label: 'v3' },
      { value: 'slim', label: 'Slim' },
      { value: 'stocky', label: 'Stocky' },
    ],
    hint: 'Measured off the render: AR 5.1 / 6.3 / 5.7 / 4.6. Parrot is the default; stocky reads as too small for the body.' },
  { key: 'pionus', group: 'Bird', kind: 'toggle', label: 'Bronze-winged Pionus plumage',
    hint: 'Off is the old blue jay palette and flat wings.' },
  { key: 'feathers', group: 'Bird', kind: 'toggle', label: 'Feather detail sheets', parent: 'authored' },
  { key: 'feathernormals', group: 'Bird', kind: 'toggle', label: 'Feather normal maps' },
  // ---- Flight ----
  { key: 'levelturn', group: 'Flight', kind: 'toggle', label: 'Level turns (yaw about the planet)',
    hint: 'Off yaws about the bird’s own up — the before, where a held dive spiralled and looped out of itself.' },
  { key: 'pitchinvert', group: 'Flight', kind: 'toggle', label: 'Pull back for nose up',
    hint: 'On (the default) is a control column: pull the stick back and the nose rises. Off is the direct sense, stick up for nose up. Stunt model only.' },
  { key: 'flight', group: 'Flight', kind: 'select', label: 'Flight model',
    options: [
      { value: null, label: 'Stunt (default)' },
      { value: 'classic', label: 'Classic (v1)' },
      { value: 'v2', label: 'Bank to turn (v2)' },
    ],
    hint: 'Stunt is the shipping default: the stick is roll and pitch RATE, the Boost pill is rudder and throttle, and rolls, loops and hammerheads are flown rather than triggered. Stunt and Classic also toggle live in the gear menu; v2 is URL-only. See docs/realism/STUNT_FLIGHT_PLAN.md.' },
  // ---- Audio ----
  { key: 'airsound', group: 'Audio', kind: 'toggle', label: 'Hear the air (wind, whistle, stall buffet, wingbeats)',
    hint: 'Procedural flight audio, no assets: the wind rises steeply with airspeed, a feather whistle at speed, a buffet near the stall, a whoosh on every downstroke. Off is the silent game. The SFX switch silences it too.' },
]);

export function bootFlagByKey(key) {
  return BOOT_FLAGS.find((f) => f.key === key) || null;
}

function paramsOf(search) {
  const s = typeof search === 'string' ? search : '';
  return new URLSearchParams(s.startsWith('?') ? s.slice(1) : s);
}

/**
 * The flag's current state as the game's own readers would see it.
 *
 * toggle → `{ on: boolean, forcedOff: boolean }` — `forcedOff` is true when
 *          the parent is off, so the panel can say WHY the switch is grey.
 * select → `{ value: string|null }` — an unknown value reads as the default
 *          (null), exactly as the game's regexes treat it.
 */
export function readBootFlag(search, key) {
  const flag = bootFlagByKey(key);
  if (!flag) return null;
  const params = paramsOf(search);
  if (flag.kind === 'toggle') {
    const ownOff = params.get(flag.key) === '0';
    const parentOff = !!(flag.parent && params.get(flag.parent) === '0');
    return { on: !ownOff && !parentOff, forcedOff: parentOff && !ownOff };
  }
  const raw = params.get(flag.key);
  const known = flag.options.some((o) => o.value !== null && o.value === raw);
  return { value: known ? raw : null };
}

/**
 * The search string with ONE flag changed and every other parameter kept —
 * `?debug=1`, `?goto=stone-arch`, `?env=city` all survive, which matters
 * because the person flipping a flag is standing at the landmark they
 * navigated to.
 *
 * toggle: `value` is a boolean; on REMOVES the key (on is the default and a
 *         `?bark=1` in the URL is noise the game does not read).
 * select: `value` is an option value or null for the default (removed).
 *
 * Returns the search WITHOUT a leading '?', empty when nothing remains.
 */
export function withBootFlag(search, key, value) {
  const flag = bootFlagByKey(key);
  const params = paramsOf(search);
  if (!flag) return params.toString();
  if (flag.kind === 'toggle') {
    if (value) params.delete(flag.key);
    else params.set(flag.key, '0');
  } else {
    const known = flag.options.some((o) => o.value !== null && o.value === value);
    if (value === null || value === undefined || !known) params.delete(flag.key);
    else params.set(flag.key, String(value));
  }
  return params.toString();
}

/** Every boot flag removed; everything else (debug, goto, env) kept. */
export function withoutBootFlags(search) {
  const params = paramsOf(search);
  for (const flag of BOOT_FLAGS) params.delete(flag.key);
  return params.toString();
}

/** True when any flag in the table is set away from its default. */
export function anyBootFlagSet(search) {
  return BOOT_FLAGS.some((flag) => {
    const state = readBootFlag(search, flag.key);
    return flag.kind === 'toggle' ? !state.on : state.value !== null;
  });
}
