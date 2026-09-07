/**
 * dev/builders.js — the registry the isolation probe picks a geometry builder
 * from. Every builder honours the buildIcon() contract in
 * src/model/icon-mesh.js: build(THREE, icon, opts) → { group, inner, pieces,
 * bounds, scale, width, height, thickness, depthExtent, setMode, dispose }, so
 * the gate, the export bake and the page can swap one for another.
 *
 * Add a candidate here as a lazy import; the probe loads only the one asked
 * for, so a broken candidate cannot take the others down with it.
 */
export const BUILDERS = {
    plates: () => import('../src/model/icon-mesh.js').then((m) => m.buildIcon),
    ribbon: () => import('../src/model/ribbon.js').then((m) => m.buildRibbon),
};

export async function loadBuilder(name) {
    const load = BUILDERS[name];
    if (!load) throw new Error(`unknown builder "${name}" — one of: ${Object.keys(BUILDERS).join(', ')}`);
    return load();
}
