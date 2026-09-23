/**
 * `?plumage=0` is the TRUE before: the Standard-material bird exactly as it
 * shipped at e252ca1 — metal-faked bronze wing (metalness 0.34, roughness
 * 0.36), contour at metalness 0.12 / roughness 0.55, the 0.34 ambient lift on
 * both, the hand-made rim and feather sheen at full strength, and no
 * environment map anywhere on the bird.
 *
 * An escape hatch that is not the before is worthless as evidence: every A/B
 * this repo has judged a feature on was run against its flag's off side. The
 * boot is also a separate boot, so the runner's no-console-warnings rule
 * covers the off path's shaders too.
 */
export const name = 'plumage-off';
export const query = 'plumage=0';

export default async function run(ctx) {
  const p = await ctx.page.evaluate(() => window.__BIRB.plumage());
  ctx.check(p && p.enabled === false && p.env === null, 'no physical plumage and no bird sky under ?plumage=0');
  const c = p?.contour; const v = p?.vane;
  ctx.check(c?.type === 'MeshStandardMaterial' && v?.type === 'MeshStandardMaterial',
    `both feather materials are MeshStandardMaterial (${c?.type} / ${v?.type})`);
  ctx.check(c?.metalness === 0.12 && c?.roughness === 0.55 && c?.emissiveIntensity === 0.34,
    `the contour is the shipped one (metal ${c?.metalness}, rough ${c?.roughness}, lift ${c?.emissiveIntensity})`);
  ctx.check(v?.metalness === 0.34 && v?.roughness === 0.36 && v?.emissiveIntensity === 0.34,
    `the vane is the shipped one (metal ${v?.metalness}, rough ${v?.roughness}, lift ${v?.emissiveIntensity})`);
  ctx.check(!c?.envMap && !v?.envMap, 'nothing on the bird has an env map');
  ctx.check(c?.rim === 0.42 && v?.rim === 0.42 && v?.featherSheen === 0.72,
    `the hand-made rim and sheen run at full strength (rim ${c?.rim}/${v?.rim}, sheen ${v?.featherSheen})`);
  ctx.check(c?.hemi === null && v?.hemi === null, 'no plumage lighting patch on either material');
}
