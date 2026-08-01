/**
 * three-loader.js — the single place VYOM resolves Three.js from.
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
export const THREE_LOCAL = '/node_modules/three/build/three.module.js';

/** Resolve the Three.js module URL for the current page. */
export function threeUrl() {
    try {
        const params = new URLSearchParams(location.search);
        if (params.get('three') === 'local') return THREE_LOCAL;
    } catch { /* non-browser context — fall through to the CDN */ }
    return THREE_CDN;
}

/** Dynamically import Three.js. */
export function loadThree() {
    return import(/* webpackIgnore: true */ threeUrl());
}
