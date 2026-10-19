/**
 * src/ui/realism-defaults.js — which realism packages a boot builds.
 *
 * Every realism package in this game was built opt-in (`?autoexp=1`,
 * `?localtm=1`, `?hextile=1`, ...) so that its off side stayed the true
 * before, byte for byte, while it was reviewed. The owner's direction
 * (2026-10-19): "visual realism to 11". So a boot whose preset is ULTRA —
 * the shipping default, and what Auto starts on — builds every package in
 * ULTRA_REALISM; any other boot preset builds none of them unless the URL
 * asks. An explicit `?key=1` / `?key=0` always wins, either way.
 *
 * Why the BOOT preset and not the live one: these packages build geometry,
 * compile shaders or allocate targets at boot (a reload is their rebuild
 * path; see boot-flags.js). The ones that live in the post pass (AO, the
 * eye) are also SWITCHED by the live preset — bloom-pass.js
 * setRealismEnabled — so stepping down from Ultra sheds their passes at
 * once; the surface ones (hex tiling) cost a few texture reads and stay.
 *
 * And why this keeps the frozen oracles honest: every frozen harness boots
 * `&quality=amazing` (G-ULTRA-DEFAULT), so on those boots nothing here
 * changes a single program or pass. The Ultra path is covered by
 * tools/birb-default.mjs and tools/birb-shaders.mjs, which boot with no
 * flag.
 *
 * Pure apart from the optional storage read; the preset arithmetic mirrors
 * index.html's readQualityRaw / readQualityPresetChoice exactly and is
 * unit-tested against the same inputs.
 */

/** localStorage keys — index.html's QUALITY_STORAGE_KEY / QUALITY_AUTO_LEVEL_KEY. */
export const QUALITY_STORAGE_KEY = 'birbQuality2';
export const QUALITY_AUTO_LEVEL_KEY = 'birbQualityAutoLevel';

/** The packages an Ultra boot turns on. */
export const ULTRA_REALISM = Object.freeze(['ao', 'autoexp', 'localtm', 'hextile', 'erosion', 'foliage']);

const PRESET_RE = /^(ultra|amazing|okay|light)$/;

/**
 * The preset this boot settles on: 'ultra' | 'amazing' | 'okay' | 'light'.
 * `saved` is localStorage[QUALITY_STORAGE_KEY], `autoLevel` is
 * localStorage[QUALITY_AUTO_LEVEL_KEY]. Nothing chosen, or Auto with no
 * settled level, is Ultra (Auto starts on Ultra).
 */
export function bootPresetId(search = '', saved = null, autoLevel = null) {
  const fromUrl = (/[?&]quality=(auto|ultra|amazing|okay|light)(?:&|$)/.exec(search || '') || [])[1];
  const raw = fromUrl || saved || null;
  if (raw !== null && raw !== 'auto') return PRESET_RE.test(raw) ? raw : 'ultra';
  return PRESET_RE.test(autoLevel || '') ? autoLevel : 'ultra';
}

function readStorage(storage, key) {
  try { return storage?.getItem(key) ?? null; } catch (_) { return null; }
}

/** The boot preset read from this page's URL and storage. */
export function currentBootPreset(search, storage) {
  const s = typeof search === 'string' ? search
    : (typeof window !== 'undefined' ? window.location?.search || '' : '');
  const st = storage !== undefined ? storage
    : (typeof window !== 'undefined' ? (() => { try { return window.localStorage; } catch (_) { return null; } })() : null);
  return bootPresetId(s, readStorage(st, QUALITY_STORAGE_KEY), readStorage(st, QUALITY_AUTO_LEVEL_KEY));
}

/**
 * Is package `key` on for this boot? `?key=1` on, `?key=0` off, otherwise
 * on exactly when the boot preset is Ultra and the key is an Ultra package
 * (and `?realism=0`, the Flags tab's switch for the whole set, is absent).
 */
export function realismOn(key, search, preset) {
  const s = typeof search === 'string' ? search
    : (typeof window !== 'undefined' ? window.location?.search || '' : '');
  const m = new RegExp(`[?&]${key}=([01])(?:&|#|$)`).exec(s);
  if (m) return m[1] === '1';
  // `?realism=0` is the Ultra before: no package is on unless asked for.
  if (/[?&]realism=0(?:&|#|$)/.test(s)) return false;
  const p = preset || currentBootPreset(s);
  return p === 'ultra' && ULTRA_REALISM.includes(key);
}
