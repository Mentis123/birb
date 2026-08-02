/**
 * three-loader.js — the single place Birb Gauntlet resolves Three.js from.
 *
 * Production loads the pinned CDN build (house rule: no bundler, no build
 * step). The `?three=local` escape hatch points at a locally installed copy so
 * the headless screenshot harness can run in environments with no CDN egress —
 * it is never fetched during a normal page load.
 *
 * Version is pinned deliberately. Do not bump it without testing on a real
 * iPhone; Three's renderer internals move between minor releases.
 */

export const THREE_VERSION = '0.183.2';
export const THREE_CDN = `https://esm.sh/three@${THREE_VERSION}`;

// Installed under an ALIAS (`npm i three-real@npm:three`) on purpose.
// `node_modules/three/index.js` is a hand-written minimal stub that this repo
// tracks in git and that the Birb Mobile unit tests import as 'three'.
// Installing the real package at `node_modules/three` overwrites that stub and
// breaks `npm test`, so the real build lives beside it instead.
export const THREE_LOCAL = '/node_modules/three-real/build/three.module.js';
const THREE_LOCAL_FALLBACK = '/node_modules/three/build/three.module.js';

/** Resolve the Three.js module URL for the current page. */
export function threeUrl() {
    try {
        const params = new URLSearchParams(location.search);
        if (params.get('three') === 'local') return THREE_LOCAL;
    } catch { /* non-browser context — fall through to the CDN */ }
    return THREE_CDN;
}

/** Dynamically import Three.js. */
export async function loadThree() {
    const url = threeUrl();
    if (url !== THREE_LOCAL) return import(/* webpackIgnore: true */ url);
    // Tolerate either local layout so the harness keeps working whichever way
    // Three happens to be installed.
    try {
        return await import(/* webpackIgnore: true */ THREE_LOCAL);
    } catch {
        return import(/* webpackIgnore: true */ THREE_LOCAL_FALLBACK);
    }
}
