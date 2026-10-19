// Pins — soft labels over the places worth finding.
//
// Ported in spirit from the tabletop worlds kit's pins-layer.js (one DOM pin
// per place, faded by distance, hidden off screen and behind the camera,
// dimmed — never hidden — when something stands in the way, labels that clash
// lose their text and keep their dot, a cap on a phone). Two game changes:
//
//   - pins are NOT buttons. A pin under the thumb would steal the joystick's
//     touch; `pointer-events: none` on the whole layer, always.
//   - an unfound place shows only a "?" and only when you are close; its name
//     is the reward for having been there (src/ui/discovery.js).
//
// Per frame: one projection and two style writes per visible pin (~6), no
// allocation. Occlusion is one sight test per 120 ms, round robin.

const CSS = `
.birb-pins { position: absolute; inset: 0; pointer-events: none; z-index: 2; overflow: hidden; }
.birb-pin { position: absolute; left: 0; top: 0; display: flex; flex-direction: column; align-items: center;
  transform: translate(-9999px, 0); transition: opacity 260ms ease; will-change: transform, opacity; }
.birb-pin__label { font: 600 11px/1 system-ui, sans-serif; letter-spacing: 0.01em; white-space: nowrap;
  padding: 4px 8px; border-radius: 999px; color: #fff4dc; background: rgba(12, 14, 26, 0.78);
  border: 1px solid rgba(240, 208, 137, 0.55); box-shadow: 0 0 10px rgba(240, 208, 137, 0.25); }
.birb-pin__stem { width: 1px; height: 12px; background: rgba(240, 208, 137, 0.7); }
.birb-pin__dot { width: 8px; height: 8px; border-radius: 50%; background: #f0d089; box-shadow: 0 0 0 2px rgba(12,14,26,0.6); }
.birb-pin--unfound .birb-pin__label { color: #dfe8ff; border-color: rgba(160, 200, 255, 0.5); box-shadow: none; }
.birb-pin--unfound .birb-pin__dot { background: #a8c8ff; }
.birb-pin--occluded { filter: saturate(0.4); }
.birb-pin--occluded .birb-pin__label { opacity: 0.45; }
.birb-pin--nolabel .birb-pin__label { visibility: hidden; }
.birb-pin--fresh .birb-pin__label { animation: birb-pin-pop 1.4s ease-out 1; }
@keyframes birb-pin-pop { 0% { transform: scale(0.6); } 25% { transform: scale(1.18); } 100% { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .birb-pin--fresh .birb-pin__label { animation: none; } }
`;

/** Opacity for a pin at distance d: full inside 70% of range, gone at range. */
export function pinOpacity(d, range) {
  if (!(range > 0)) return 0;
  return Math.max(0, Math.min(1, (range - d) / (range * 0.3)));
}

/**
 * @param {object} o
 * @param {object} o.THREE
 * @param {HTMLElement} [o.parent]  defaults to document.body
 * @param {boolean} [o.coarse]      phone: cap pins, shorter labels range
 */
export function createPinsLayer({ THREE, parent = document.body, coarse = false }) {
  if (!document.getElementById('birb-pins-style')) {
    const st = document.createElement('style');
    st.id = 'birb-pins-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const layer = document.createElement('div');
  layer.className = 'birb-pins';
  layer.setAttribute('aria-hidden', 'true');
  parent.appendChild(layer);

  const pins = new Map();     // id -> { el, label, shown, x, y, occluded }
  const _v = new THREE.Vector3();
  let occlusionClock = 0;
  let occlusionIndex = 0;
  let visible = true;
  let lastSet = null;

  function pinFor(l) {
    let p = pins.get(l.id);
    if (p) return p;
    const el = document.createElement('div');
    el.className = 'birb-pin';
    el.innerHTML = '<span class="birb-pin__label"></span><span class="birb-pin__stem"></span><span class="birb-pin__dot"></span>';
    layer.appendChild(el);
    p = { el, labelEl: el.firstChild, label: '', found: null, x: -1e4, y: 0, occluded: false, occludedShown: false, clash: false, op: -1 };
    pins.set(l.id, p);
    return p;
  }

  function setLandmarks(landmarks) {
    if (landmarks === lastSet) return;
    lastSet = landmarks;
    const keep = new Set((landmarks || []).map((l) => l.id));
    for (const [id, p] of pins) if (!keep.has(id)) { p.el.remove(); pins.delete(id); }
  }

  // Label rectangles already placed this frame, preallocated.
  const rects = new Float32Array(4 * 32);
  let rectCount = 0;

  function place(l, camera, birdPos, w, h, shownCount) {
    const p = pinFor(l);
    const reach = (l.viewDistance || 34) * (l.found ? (coarse ? 3 : 4) : 2.2);
    const dx = birdPos.x - l.position.x, dy = birdPos.y - l.position.y, dz = birdPos.z - l.position.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let op = pinOpacity(d, reach);
    _v.set(l.position.x, l.position.y, l.position.z).project(camera);
    const onScreen = _v.z < 1 && _v.x > -0.97 && _v.x < 0.97 && _v.y > -0.94 && _v.y < 0.94;
    if (!onScreen || (coarse && shownCount >= 6)) op = 0;
    const label = l.found ? (l.label || l.id) : '?';
    if (label !== p.label) { p.labelEl.textContent = label; p.label = label; }
    if (p.found !== !!l.found) {
      p.found = !!l.found;
      p.el.classList.toggle('birb-pin--unfound', !p.found);
    }
    if (p.occludedShown !== p.occluded) { p.el.classList.toggle('birb-pin--occluded', p.occluded); p.occludedShown = p.occluded; }
    if (op <= 0.01) {
      if (p.op !== 0) { p.el.style.opacity = '0'; p.op = 0; }
      return shownCount;
    }
    const x = Math.round((_v.x * 0.5 + 0.5) * w);
    const y = Math.round((-_v.y * 0.5 + 0.5) * h);
    // Label clash: the later (unfound, or later in the list) pin keeps its dot.
    const lw = 12 + label.length * 6.5;
    const x0 = x - lw / 2 - 6, x1 = x + lw / 2 + 6, y0 = y - 40, y1 = y - 14;
    let clash = false;
    for (let r = 0; r < rectCount; r++) {
      const o = r * 4;
      if (rects[o] < x1 && x0 < rects[o + 2] && rects[o + 1] < y1 && y0 < rects[o + 3]) { clash = true; break; }
    }
    if (!clash && rectCount < 32) {
      const o = rectCount * 4;
      rects[o] = x0; rects[o + 1] = y0; rects[o + 2] = x1; rects[o + 3] = y1;
      rectCount++;
    }
    if (p.clash !== clash) { p.el.classList.toggle('birb-pin--nolabel', clash); p.clash = clash; }
    if (x !== p.x || y !== p.y) {
      p.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      p.x = x; p.y = y;
    }
    const o = Math.round(op * 20) / 20;
    if (o !== p.op) { p.el.style.opacity = String(o); p.op = o; }
    return shownCount + 1;
  }

  return {
    get element() { return layer; },
    setVisible(on) {
      if (on === visible) return;
      visible = on;
      layer.style.display = on ? '' : 'none';
    },
    /** Pop the label of a place just found. */
    celebrate(id) {
      const p = pins.get(id);
      if (!p) return;
      p.el.classList.remove('birb-pin--fresh');
      void p.el.offsetWidth;   // restart the animation
      p.el.classList.add('birb-pin--fresh');
    },
    /**
     * @param {THREE.Camera} camera
     * @param {Array} landmarks          entries with id, label, position, viewDistance, found
     * @param {{x,y,z}} birdPos
     * @param {number} dt
     * @param {(from:THREE.Vector3, to:{x,y,z}) => boolean} sightBlocked
     */
    update(camera, landmarks, birdPos, dt, sightBlocked) {
      if (!visible) return;
      setLandmarks(landmarks);
      const w = window.innerWidth, h = window.innerHeight;
      const list = landmarks || [];
      // Occlusion: one place per tick, round robin.
      occlusionClock += dt || 0;
      if (occlusionClock > 0.12 && list.length) {
        occlusionClock = 0;
        occlusionIndex = (occlusionIndex + 1) % list.length;
        const l = list[occlusionIndex];
        const p = pinFor(l);
        p.occluded = !!sightBlocked?.(camera.position, l.position);
      }
      // Found places first (their labels win a clash), then the unknowns.
      // Two passes over the list rather than a sorted copy: this runs every
      // frame and allocates nothing but the transform strings it must write.
      rectCount = 0;
      let shownCount = 0;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < list.length; i++) {
          const l = list[i];
          if (!!l.found !== (pass === 0)) continue;
          shownCount = place(l, camera, birdPos, w, h, shownCount);
        }
      }
    },
    dispose() { layer.remove(); pins.clear(); },
  };
}
