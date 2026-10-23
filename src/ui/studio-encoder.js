// Studio encoder — frame-exact MP4 straight from the canvas, in the browser.
//
// WebCodecs' VideoEncoder takes one VideoFrame per rendered frame with an
// EXPLICIT timestamp (frame / fps), and mp4-muxer writes the samples into an
// MP4 — so the file plays at a smooth fps however slowly the machine drew it.
// That is the difference from MediaRecorder, which stamps frames with the
// wall clock and records whatever stutter the device had.
//
// H.264 first (plays everywhere: phones, QuickTime, every upload form), VP9
// in MP4 as a fallback for a browser without an H.264 encoder. Returns null
// when WebCodecs is missing; the studio then falls back to real-time WebM.
//
// Loaded only by the studio (`?studio=1`), never on a normal boot.

// jsdelivr, not esm.sh: the recorder is online-only by nature (studio), so it
// is deliberately outside the service worker's CDN_MODULES precache.
const MUXER_URL = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/+esm';

const CANDIDATES = [
  { codec: 'avc1.640033', muxer: 'avc' },   // High, level 5.1
  { codec: 'avc1.4d0033', muxer: 'avc' },   // Main, level 5.1
  { codec: 'avc1.42e033', muxer: 'avc' },   // Constrained Baseline
  { codec: 'vp09.00.41.08', muxer: 'vp9' },
];

export async function pickCodec(width, height, fps, bitrate) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  for (const c of CANDIDATES) {
    const config = { codec: c.codec, width, height, bitrate, framerate: fps };
    if (c.muxer === 'avc') config.avc = { format: 'avc' };
    try {
      const r = await VideoEncoder.isConfigSupported(config);
      if (r.supported) return { ...c, config };
    } catch { /* try the next */ }
  }
  return null;
}

/**
 * @returns {Promise<null | { codec:string, addFrame(i:number):void, readonly backlog:number,
 *   finish():Promise<Blob>, cancel():void }>}
 */
export async function createMp4Recorder({ canvas, width, height, fps = 30, bitrate }) {
  const rate = bitrate || Math.round(width * height * fps * 0.35);   // ~22 Mbps at 1080x1920x30
  const pick = await pickCodec(width, height, fps, rate);
  if (!pick) return null;
  const { Muxer, ArrayBufferTarget } = await import(MUXER_URL);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: pick.muxer, width, height, frameRate: fps },
    fastStart: 'in-memory',
  });
  let failed = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { failed = e; },
  });
  encoder.configure(pick.config);
  const step = 1e6 / fps;
  return {
    codec: pick.codec,
    addFrame(i) {
      if (failed) throw failed;
      // The canvas is read in the same task it was drawn in, so the WebGL
      // drawing buffer is still the frame just presented.
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * step), duration: Math.round(step) });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
    },
    get backlog() { return encoder.encodeQueueSize; },
    async finish() {
      await encoder.flush();
      if (failed) throw failed;
      encoder.close();
      muxer.finalize();
      return new Blob([target.buffer], { type: 'video/mp4' });
    },
    cancel() { try { encoder.close(); } catch { /* closed */ } },
  };
}
