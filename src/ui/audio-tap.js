// Audio tap — the game's sound, as one MediaStream the recorder can use.
//
// Installed only in record mode (`?rec=1` / `?cinema=1`), BEFORE any game
// audio exists, because it works by changing how that audio is made:
//
//   1. Every `new AudioContext()` returns ONE shared context. The flight
//      audio and the ring chime each make their own context otherwise, and a
//      MediaRecorder records one audio track, not a mix of contexts.
//   2. Anything connected to that context's speakers is ALSO connected to a
//      MediaStreamDestination: the tap. What you hear is what is recorded.
//   3. An <audio> element (music, rockets, rings) is routed through the
//      shared context on its first play(), so it reaches the tap too. It still
//      plays out of the speakers, and its volume still applies.
//
// A normal boot never imports this module, so normal play is untouched.

export function installAudioTap(win = globalThis) {
  const AC = win.AudioContext || win.webkitAudioContext;
  if (!AC || win.__birbAudioTap) return win.__birbAudioTap || null;
  let ctx = null;
  let dest = null;
  const shared = () => {
    if (!ctx) {
      ctx = new AC();
      dest = ctx.createMediaStreamDestination();
    }
    return ctx;
  };
  // `new Shared()` returns the shared context: a constructor that returns an
  // object hands back that object. Keeping the prototype makes `instanceof
  // AudioContext` still true for it.
  function Shared() { return shared(); }
  Shared.prototype = AC.prototype;
  win.AudioContext = Shared;
  if (win.webkitAudioContext) win.webkitAudioContext = Shared;

  const connect = win.AudioNode.prototype.connect;
  win.AudioNode.prototype.connect = function tapConnect(target, ...rest) {
    const out = connect.call(this, target, ...rest);
    if (dest && this.context === ctx && target === ctx.destination) {
      try { connect.call(this, dest); } catch { /* already connected */ }
    }
    return out;
  };

  const tapped = new WeakSet();
  const play = win.HTMLMediaElement.prototype.play;
  win.HTMLMediaElement.prototype.play = function tapPlay(...args) {
    if (!tapped.has(this)) {
      tapped.add(this);
      try {
        const c = shared();
        if (c.state === 'suspended') c.resume();
        c.createMediaElementSource(this).connect(c.destination);
      } catch (err) {
        console.warn('[rec] could not route an audio element into the recording', err);
      }
    }
    return play.apply(this, args);
  };

  const tap = {
    /** The recorded mix (one audio track). */
    get stream() { shared(); return dest.stream; },
    get context() { return ctx; },
    resume() { const c = shared(); if (c.state === 'suspended') return c.resume(); return Promise.resolve(); },
  };
  win.__birbAudioTap = tap;
  return tap;
}
