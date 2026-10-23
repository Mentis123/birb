// Studio mode (`?studio=1`) — a clean frame for recording a shot.
//
// Ported from the tabletop worlds kit's viewer studio. Hides every piece of
// game chrome (HUD, minimap, pills, gear) so the canvas is the whole picture,
// and offers a small panel: shot list, countdown, Play / Stop and "also save
// a WebM". Space plays, Esc stops, H hides the panel. During playback the
// panel and the cursor hide themselves.
//
//   ?studio=1                      the panel, game started for you
//   &shot=<name>                   preselect a shot
//   &record=1                      tick "save a WebM"
//   &count=0|3|5                   countdown seconds (default 3)
//   &autoplay=1                    play as soon as the world is up
//   &aspect=9:16                   a portrait frame (a phone reel), letterboxed
//   &res=1080|720|1440             the frame's WIDTH in pixels (default 1080)
//   &fps=30|60                     the video's frame rate (default 30)
//   &exact=0                       real-time WebM instead of frame-exact MP4
//
// Two ways to save the shot. FRAME-EXACT (the default where the browser has
// WebCodecs — Chrome, Edge, Safari 26): the game runs on a virtual clock of
// exactly 1/fps per frame (src/ui/frame-clock.js) and every frame is encoded
// to H.264 MP4 as it is drawn (src/ui/studio-encoder.js), so the file is
// smooth however slowly the machine renders it. REAL TIME (the fallback):
// captureStream + MediaRecorder, vp9 → vp8 → webm, 16 Mbps, which records
// whatever stutter the device had. The shot's fade is drawn inside the WebGL
// frame, so it is in the file either way.

const STYLE = `
body.birb-studio, body.birb-studio * { visibility: hidden !important; cursor: default; }
body.birb-studio canvas.birb-studio-canvas,
body.birb-studio .birb-studio-panel, body.birb-studio .birb-studio-panel *,
body.birb-studio .birb-studio-count { visibility: visible !important; }
body.birb-studio.birb-studio-playing, body.birb-studio.birb-studio-playing * { cursor: none !important; }
body.birb-studio.birb-studio-playing .birb-studio-panel { display: none; }
html.birb-studio-portrait, body.birb-studio-portrait { background: #000 !important; }
/* The game's canvas card has backdrop-filter (a containing block for fixed
   descendants) and overflow: hidden, which clipped the letterboxed frame. */
body.birb-studio-portrait .canvas-wrapper {
  backdrop-filter: none !important; -webkit-backdrop-filter: none !important; overflow: visible !important;
  transform: none !important; filter: none !important; contain: none !important;
}
body.birb-studio-portrait canvas.birb-studio-canvas {
  position: fixed !important; left: 50% !important; top: 50% !important; right: auto !important; bottom: auto !important;
  width: min(100vw, calc(100vh * var(--birb-studio-ar))) !important;
  height: min(100vh, calc(100vw / var(--birb-studio-ar))) !important;
  transform: translate(-50%, -50%) !important; z-index: 99999 !important;
}
.birb-studio-panel {
  position: fixed; left: 12px; top: 12px; z-index: 100000; display: flex; flex-wrap: wrap; gap: 8px;
  align-items: center; max-width: calc(100vw - 24px); padding: 10px 12px; border-radius: 12px;
  background: rgba(10, 14, 22, 0.88); color: #eef3ff; font: 600 13px/1.2 system-ui, sans-serif;
  border: 1px solid rgba(120, 220, 255, 0.35);
}
.birb-studio-panel select, .birb-studio-panel button {
  min-height: 36px; padding: 0 10px; border-radius: 8px; border: 1px solid rgba(120,220,255,0.4);
  background: #141c2b; color: #eef3ff; font: inherit;
}
.birb-studio-panel button[data-act="play"] { background: #1f6f8b; }
.birb-studio-panel label { display: flex; gap: 6px; align-items: center; }
.birb-studio-panel .birb-studio-msg { flex-basis: 100%; font-weight: 500; opacity: 0.8; }
.birb-studio-count {
  position: fixed; right: 14px; bottom: 14px; z-index: 100000; color: rgba(255,255,255,0.75);
  font: 700 18px system-ui, sans-serif; text-shadow: 0 1px 3px #000;
}
`;

function pickMime() {
  const options = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  if (typeof MediaRecorder === 'undefined') return null;
  return options.find((m) => MediaRecorder.isTypeSupported?.(m)) || null;
}

/**
 * @param {object} o
 * @param {URLSearchParams} o.params
 * @param {HTMLCanvasElement} o.canvas
 * @param {() => Promise<Array<{name,title}>>} o.listShots
 * @param {(name:string, opts:object) => Promise<{ok:boolean, error?:string, duration?:number}>} o.play
 * @param {() => void} o.stop
 * @param {() => {name:string|null, t?:number, done?:boolean}} o.status
 */
/** `?aspect=9:16&res=1080` → { width: 1080, height: 1920 } (even, for the encoder), or null. */
export function studioFrameSize(params) {
  const m = /^(\d+(?:\.\d+)?)[:x/](\d+(?:\.\d+)?)$/.exec(params.get('aspect') || '');
  if (!m) return null;
  const ar = Number(m[1]) / Number(m[2]);
  if (!(ar > 0.2 && ar < 5)) return null;
  const res = Math.max(240, Math.min(2160, Number(params.get('res')) || 1080));
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(res), height: even(res / ar), ar };
}

export async function installStudio({ params, canvas, listShots, play, stop, status, seek, frameClock, resize }) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  document.body.classList.add('birb-studio');
  canvas.classList.add('birb-studio-canvas');
  const frameSize = studioFrameSize(params);
  if (frameSize) {
    window.__birbStudioFrame = { width: frameSize.width, height: frameSize.height };
    document.body.style.setProperty('--birb-studio-ar', String(frameSize.ar));
    document.body.classList.add('birb-studio-portrait');
    document.documentElement.classList.add('birb-studio-portrait');
    resize?.();
  }
  const fps = Number(params.get('fps')) === 60 ? 60 : 30;

  const panel = document.createElement('div');
  panel.className = 'birb-studio-panel';
  panel.innerHTML = `
    <strong>Studio</strong>
    <select data-k="shot" aria-label="Shot"></select>
    <select data-k="count" aria-label="Countdown">
      <option value="0">No countdown</option><option value="3">3 s</option><option value="5">5 s</option>
    </select>
    <label><input type="checkbox" data-k="record"> Save WebM</label>
    <button data-act="play" type="button">Play</button>
    <button data-act="stop" type="button">Stop</button>
    <span class="birb-studio-msg" data-k="msg">Space plays · Esc stops · H hides this</span>`;
  document.body.appendChild(panel);
  const counter = document.createElement('div');
  counter.className = 'birb-studio-count';
  document.body.appendChild(counter);

  const $ = (k) => panel.querySelector(`[data-k="${k}"]`);
  const msg = (t) => { $('msg').textContent = t; };
  const shots = await listShots();
  for (const s of shots) {
    const o = document.createElement('option');
    o.value = s.name; o.textContent = s.title ? `${s.title} (${s.name})` : s.name;
    $('shot').appendChild(o);
  }
  if (params.get('shot')) $('shot').value = params.get('shot');
  $('count').value = ['0', '3', '5'].includes(params.get('count')) ? params.get('count') : '3';
  $('record').checked = params.get('record') === '1';
  const mime = pickMime();
  const exactWanted = params.get('exact') !== '0' && typeof VideoEncoder !== 'undefined' && !!frameClock && !!seek;
  if (!mime && !exactWanted) { $('record').disabled = true; $('record').parentElement.title = 'This browser cannot record the canvas'; }
  if (exactWanted) $('record').parentElement.lastChild.textContent = ' Save MP4 (frame-exact)';
  if (frameSize) msg(`${frameSize.width}x${frameSize.height} @ ${fps} fps · Space plays · Esc stops · H hides this`);

  let recorder = null;
  let chunks = [];
  let running = false;
  let watch = null;
  let countTimer = null;

  function finishRecording(name) {
    if (!recorder) return;
    const r = recorder;
    recorder = null;
    r.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      chunks = [];
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${name || 'birb-shot'}.webm`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      msg(`Saved ${a.download} (${(blob.size / 1e6).toFixed(1)} MB)`);
    };
    try { r.stop(); } catch { /* already stopped */ }
  }

  // Frame-exact: park on frame 0, warm the world up on the virtual clock
  // (shaders compile, the eye adapts, textures decode), then encode one
  // frame per shot step. The encoder stalls the clock when it falls behind.
  async function recordExact(name) {
    const parked = await play(name, { hold: true, paused: true });
    if (!parked.ok) { running = false; msg(`${name}: ${parked.error}`); return; }
    const w = canvas.width, h = canvas.height;
    let rec = null;
    try {
      const { createMp4Recorder } = await import('./studio-encoder.js');
      rec = await createMp4Recorder({ canvas, width: w, height: h, fps });
    } catch (err) { console.warn('[studio] encoder failed to load', err); }
    if (!rec) { running = false; msg('No MP4 encoder here — try &exact=0 for a real-time WebM'); return; }
    document.body.classList.add('birb-studio-playing');
    const WARM = 2 * fps;
    const total = Math.round(parked.duration * fps) + 1;
    const t0 = performance.now();
    let finishing = false;
    const done = (blob, err) => {
      frameClock.stop();
      running = false;
      document.body.classList.remove('birb-studio-playing');
      counter.textContent = '';
      if (err || !blob) { msg(`Recording failed: ${err?.message || err}`); console.warn('[studio]', err); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${name}-${w}x${h}-${fps}fps.mp4`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      const secs = ((performance.now() - t0) / 1000).toFixed(0);
      msg(`Saved ${a.download} (${(blob.size / 1e6).toFixed(1)} MB, ${rec.codec}, made in ${secs} s)`);
      window.__birbStudio.last = { name: a.download, bytes: blob.size, codec: rec.codec, frames: total, seconds: +secs };
    };
    frameClock.start(fps, performance.now(), {
      stall: () => rec.backlog > 4,
      before: () => {
        const k = frameClock.frame - WARM;
        seek(Math.max(0, Math.min(parked.duration, k / fps)));
      },
      after: () => {
        if (!frameClock.fresh || finishing) return;
        const k = frameClock.frame - WARM;
        if (k < 0) { counter.textContent = 'warming up'; return; }
        try { rec.addFrame(k); } catch (err) { finishing = true; done(null, err); return; }
        counter.textContent = `${k + 1} / ${total}`;
        if (k + 1 >= total) {
          finishing = true;
          rec.finish().then((b) => done(b), (err) => done(null, err));
        }
      },
    });
    window.__birbStudio.cancelExact = () => { if (!finishing) { finishing = true; rec.cancel(); frameClock.stop(); running = false; document.body.classList.remove('birb-studio-playing'); msg('Recording cancelled'); } };
  }

  function end() {
    window.__birbStudio?.cancelExact?.();
    running = false;
    clearInterval(watch);
    clearInterval(countTimer);
    counter.textContent = '';
    document.body.classList.remove('birb-studio-playing');
    finishRecording($('shot').value);
  }

  async function start() {
    if (running) return;
    const name = $('shot').value;
    if (!name) { msg('No shots for this biome'); return; }
    running = true;
    if ($('record').checked && exactWanted) { await recordExact(name); return; }
    let left = Number($('count').value) || 0;
    // Park on frame 0 during the countdown so a trim point is obvious.
    const parked = await play(name, { hold: true, paused: true });
    if (!parked.ok) { running = false; msg(`${name}: ${parked.error}${parked.audit ? ' — ' + parked.audit.checks.filter((c) => !c.pass).map((c) => c.name + ' ' + c.detail).join('; ') : ''}`); return; }
    document.body.classList.add('birb-studio-playing');
    const go = async () => {
      if ($('record').checked && mime) {
        chunks = [];
        recorder = new MediaRecorder(canvas.captureStream(60), { mimeType: mime, videoBitsPerSecond: 16e6 });
        recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
        recorder.start(250);
      }
      const r = await play(name, { hold: true });
      if (!r.ok) { msg(r.error); end(); return; }
      watch = setInterval(() => {
        const st = status();
        counter.textContent = st.name ? `${(r.duration - (st.t || 0)).toFixed(0)}` : '';
        // `hold` keeps the last frame on screen; the recording stops there.
        if (!st.name || st.done) { setTimeout(end, 400); clearInterval(watch); }
      }, 200);
    };
    if (left > 0) {
      counter.textContent = String(left);
      countTimer = setInterval(() => {
        left -= 1;
        counter.textContent = left > 0 ? String(left) : '';
        if (left <= 0) { clearInterval(countTimer); go(); }
      }, 1000);
    } else go();
  }

  panel.querySelector('[data-act="play"]').addEventListener('click', start);
  panel.querySelector('[data-act="stop"]').addEventListener('click', () => { stop(); end(); });
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ') { e.preventDefault(); start(); }
    else if (e.key === 'Escape') { stop(); end(); }
    else if (e.key === 'h' || e.key === 'H') panel.style.display = panel.style.display === 'none' ? '' : 'none';
  });
  if (params.get('autoplay') === '1') setTimeout(start, 600);
  window.__birbStudio = { start, stop: () => { stop(); end(); }, shots: () => shots.map((s) => s.name) };
  return window.__birbStudio;
}
