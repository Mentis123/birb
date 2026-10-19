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
//
// The WebM comes from the canvas itself (captureStream + MediaRecorder,
// vp9 → vp8 → webm, 16 Mbps), so what you get is exactly the frames the
// device drew — on a machine with a GPU, real time at full quality. The
// shot's fade is drawn inside the WebGL frame, so it is in the file too.

const STYLE = `
body.birb-studio, body.birb-studio * { visibility: hidden !important; cursor: default; }
body.birb-studio canvas.birb-studio-canvas,
body.birb-studio .birb-studio-panel, body.birb-studio .birb-studio-panel *,
body.birb-studio .birb-studio-count { visibility: visible !important; }
body.birb-studio.birb-studio-playing, body.birb-studio.birb-studio-playing * { cursor: none !important; }
body.birb-studio.birb-studio-playing .birb-studio-panel { display: none; }
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
export async function installStudio({ params, canvas, listShots, play, stop, status }) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  document.body.classList.add('birb-studio');
  canvas.classList.add('birb-studio-canvas');

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
  if (!mime) { $('record').disabled = true; $('record').parentElement.title = 'This browser cannot record the canvas'; }

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

  function end() {
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
