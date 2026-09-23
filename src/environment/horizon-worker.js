/**
 * The horizon bake, off the main thread.
 *
 * horizon-map.js marches ~34 million samples for a 512x256 map with 8
 * azimuths — about a quarter of a second on a desktop core, and a phone's
 * core is slower. On the main thread that is a quarter-second hitch every
 * time a world is built; in a module worker it costs the frame nothing and
 * the shadows fade in when it lands (horizon-shadow.js). spherical-world.js
 * falls back to a time-sliced bake on the main thread if this worker cannot
 * start, so a browser without module workers still gets the same bytes.
 *
 * The inputs arrive by structured clone (the caller keeps its copies for
 * that fallback); the four outputs are TRANSFERRED back.
 */
import { createHorizonBake } from './horizon-map.js';

self.onmessage = (event) => {
  const { id, radius, width, height, terrain, occluder, options } = event.data || {};
  try {
    const t0 = performance.now();
    const bake = createHorizonBake({ radius, width, height, terrain, occluder, ...(options || {}) });
    bake.step(height);
    const ms = performance.now() - t0;
    const [groundA, groundB] = bake.ground;
    const [propA, propB] = bake.prop;
    self.postMessage({
      id, ok: true, ms, marched: bake.marched, propTexels: bake.propTexels,
      groundA, groundB, propA, propB,
    }, [groundA.buffer, groundB.buffer, propA.buffer, propB.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
