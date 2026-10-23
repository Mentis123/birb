// Flight recorder (`?rec=1`) — fly the bird yourself and save the video.
//
// One button, top centre (the corners belong to the gear and the HUD): REC starts recording the game canvas, tap again to
// stop, then SAVE hands the file to the share sheet (phones: "Save Video")
// or downloads it. The canvas only, so the joystick, pills and HUD are not in
// the picture. MediaRecorder records in real time, MP4 where the browser can
// (Safari, Chrome/Edge 126+), WebM otherwise.
//
// SAVE is its own tap on purpose: the share sheet needs a user gesture, and
// the file is only assembled after the recorder has flushed, which can be
// later than a gesture lasts.

const STYLE = `
.birb-rec {
  position: fixed; z-index: 10050; top: calc(env(safe-area-inset-top, 0px) + 10px); left: 50%; transform: translateX(-50%);
  min-width: 64px; min-height: 40px; padding: 0 14px; border-radius: 20px;
  border: 1px solid rgba(255,255,255,0.35); background: rgba(10,14,22,0.72); color: #fff;
  font: 700 14px/1 system-ui, sans-serif; letter-spacing: 0.04em; touch-action: manipulation;
  -webkit-user-select: none; user-select: none;
}
.birb-rec::before { content: ''; display: inline-block; width: 10px; height: 10px; margin-right: 7px;
  border-radius: 50%; background: #ff3b30; vertical-align: -1px; }
.birb-rec[data-state="recording"] { background: rgba(200,20,20,0.85); }
.birb-rec[data-state="recording"]::before { background: #fff; border-radius: 2px; }
.birb-rec[data-state="ready"] { background: rgba(20,120,60,0.9); }
.birb-rec[data-state="ready"]::before { display: none; }
`;

export function pickRecorderMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const options = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return options.find((m) => MediaRecorder.isTypeSupported?.(m)) || null;
}

export function installFlightRecorder({ canvas, fps = 60, bitrate = 20e6 }) {
  const mime = pickRecorderMime();
  if (!mime || !canvas?.captureStream) {
    console.warn('[rec] this browser cannot record the canvas');
    return null;
  }
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'birb-rec';
  btn.dataset.state = 'idle';
  btn.textContent = 'REC';
  document.body.appendChild(btn);

  let recorder = null;
  let chunks = [];
  let file = null;
  let t0 = 0;
  let clock = null;

  const ext = (type) => (type.startsWith('video/mp4') ? 'mp4' : 'webm');

  function start() {
    chunks = [];
    file = null;
    recorder = new MediaRecorder(canvas.captureStream(fps), { mimeType: mime, videoBitsPerSecond: bitrate });
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const type = (recorder?.mimeType || mime).split(';')[0];
      const blob = new Blob(chunks, { type });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      file = new File([blob], `birb-${stamp}.${ext(type)}`, { type });
      recorder = null;
      btn.dataset.state = 'ready';
      btn.textContent = `SAVE ${(blob.size / 1e6).toFixed(1)} MB`;
    };
    recorder.start(500);
    t0 = performance.now();
    btn.dataset.state = 'recording';
    const tick = () => {
      const s = Math.floor((performance.now() - t0) / 1000);
      btn.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    tick();
    clock = setInterval(tick, 500);
  }

  function stop() {
    clearInterval(clock);
    btn.textContent = '…';
    try { recorder?.stop(); } catch { /* already stopped */ }
  }

  async function save() {
    if (!file) return;
    const f = file;
    try {
      if (navigator.canShare?.({ files: [f] })) {
        await navigator.share({ files: [f], title: 'Birb' });
        reset();
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;   // share sheet dismissed: keep the file
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 10000);
    reset();
  }

  function reset() {
    file = null;
    btn.dataset.state = 'idle';
    btn.textContent = 'REC';
  }

  // The button must not steer the bird: keep its touches to itself.
  for (const ev of ['pointerdown', 'touchstart', 'mousedown']) {
    btn.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const st = btn.dataset.state;
    if (st === 'idle') start();
    else if (st === 'recording') stop();
    else if (st === 'ready') save();
  });

  return { start, stop, save, get state() { return btn.dataset.state; } };
}
