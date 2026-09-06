/**
 * Build-time nest selection. Host identity prevents duplicate nests on one prop;
 * surface spacing prevents different nearby props reading as one crowded crown.
 * Instanced hosts must supply hostId (never use the whole InstancedMesh as a host).
 * Highest crown wins within each grove; input order breaks equal-height ties.
 */
export function selectNestPlacements(placements, sphereRadius, minSpacing = 18) {
  const radius = Math.max(1, Number.isFinite(sphereRadius) ? sphereRadius : 120);
  const candidates = placements.filter((p) => {
    const v = p?.position;
    const n = p?.surfaceNormal;
    return v && n && [v.x, v.y, v.z, n.x, n.y, n.z].every(Number.isFinite)
      && Math.hypot(v.x, v.y, v.z) > 0 && Math.hypot(n.x, n.y, n.z) > 0;
  }).slice().sort((a, b) => Math.hypot(b.position.x, b.position.y, b.position.z)
    - Math.hypot(a.position.x, a.position.y, a.position.z));
  const hosts = new Set();
  const groves = new Set();
  const chosen = [];
  const directions = [];
  const cosineLimit = Math.cos(Math.min(Math.PI, Math.max(0, minSpacing) / radius));
  for (const p of candidates) {
    const host = p.hostId ?? p.hostObject;
    if (host != null && hosts.has(host)) continue;
    if (p.groveId != null && groves.has(p.groveId)) continue;
    const v = p.position;
    const length = Math.hypot(v.x, v.y, v.z);
    const x = v.x / length, y = v.y / length, z = v.z / length;
    if (directions.some((n) => n.x * x + n.y * y + n.z * z > cosineLimit)) continue;
    chosen.push(p);
    directions.push({ x, y, z });
    if (host != null) hosts.add(host);
    if (p.groveId != null) groves.add(p.groveId);
  }
  return chosen;
}
