// Shot player — drives the render camera from a compiled flythrough shot.
//
// Runs once per frame, right before the frame is presented, AFTER the chase
// rig has done its own update: it overwrites the camera's transform and fov
// for that frame only, so the moment a shot stops (Esc, a touch, the end) the
// chase rig simply carries on from where the bird is. Nothing about the
// flight model changes; the player only moves what is drawn.
//
// Shot time runs from the WALL CLOCK (a dropped frame skips ahead rather than
// stretching the shot — what a recording needs), and the caller slaves the
// living world's clock to `sample.sceneTime`, so an actor ref and the actor it
// names are always the same instant.
//
// The fade is a clip-space quad INSIDE the WebGL frame, so it survives a
// canvas recording (a DOM overlay would not).

export function createShotPlayer({ THREE, scene, camera }) {
  let compiled = null;
  let opts = {};
  let startWall = 0;
  let pausedAt = null;
  let saved = null;
  let done = false;
  let last = null;

  const fadeMat = new THREE.ShaderMaterial({
    uniforms: { uFade: { value: 0 } },
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform float uFade; void main(){ gl_FragColor = vec4(0.0, 0.0, 0.0, uFade); }',
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const fadeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fadeMat);
  fadeQuad.name = 'shot-fade';
  fadeQuad.frustumCulled = false;
  fadeQuad.renderOrder = 1e9;
  fadeQuad.raycast = () => {};

  const _look = new THREE.Vector3();

  function begin() {
    saved = { fov: camera.fov, up: camera.up.clone() };
    if (!fadeQuad.parent) scene.add(fadeQuad);
  }

  function end() {
    if (saved) {
      camera.fov = saved.fov;
      camera.up.copy(saved.up);
      camera.updateProjectionMatrix();
    }
    saved = null;
    if (fadeQuad.parent) fadeQuad.parent.remove(fadeQuad);
    fadeMat.uniforms.uFade.value = 0;
  }

  return {
    get active() { return !!compiled; },
    get compiled() { return compiled; },
    /** Start a compiled shot. opts: { loop, hold, paused } */
    play(shot, o = {}) {
      if (compiled) end();
      compiled = shot;
      opts = o;
      done = false;
      startWall = performance.now();
      pausedAt = o.paused ? 0 : null;
      begin();
      return { name: shot.name, duration: shot.duration };
    },
    /** Hold the shot at time t (seconds). */
    seek(t) {
      if (!compiled) return null;
      pausedAt = Math.max(0, Math.min(compiled.duration, +t || 0));
      return pausedAt;
    },
    /** Resume from a held time: the wall clock restarts there. */
    resume() {
      if (!compiled || pausedAt === null) return;
      startWall = performance.now() - pausedAt * 1000;
      pausedAt = null;
    },
    stop() {
      const was = compiled?.name || null;
      compiled = null;
      end();
      return was;
    },
    status() {
      return compiled
        ? { name: compiled.name, duration: compiled.duration, t: last?.t ?? 0, done, paused: pausedAt !== null, fade: last?.fade ?? 0 }
        : { name: null };
    },
    /**
     * Apply the shot to the camera for this frame. Returns the sample (so the
     * caller can place the lead bird and slave the actor clock) or null when
     * nothing is playing. A shot that reaches its end stops itself unless
     * `loop` or `hold` was asked for.
     */
    apply(nowMs = performance.now()) {
      if (!compiled) return null;
      let t = pausedAt !== null ? pausedAt : (nowMs - startWall) / 1000;
      if (t >= compiled.duration) {
        if (opts.loop) { startWall = nowMs; t = 0; }
        else if (opts.hold) { t = compiled.duration; done = true; }
        else { done = true; const s = compiled.sample(compiled.duration); this.stop(); return { ...s, ended: true }; }
      }
      const s = compiled.sample(t);
      last = s;
      camera.position.set(s.position[0], s.position[1], s.position[2]);
      camera.up.set(s.up[0], s.up[1], s.up[2]);
      _look.set(s.lookAt[0], s.lookAt[1], s.lookAt[2]);
      camera.lookAt(_look);
      if (Math.abs(camera.fov - s.fov) > 1e-3) { camera.fov = s.fov; camera.updateProjectionMatrix(); }
      camera.updateMatrixWorld();
      fadeMat.uniforms.uFade.value = s.fade;
      return s;
    },
    dispose() {
      this.stop();
      fadeQuad.geometry.dispose();
      fadeMat.dispose();
    },
  };
}
