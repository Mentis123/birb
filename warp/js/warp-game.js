/* global THREE */

(() => {
  'use strict';

  const CONFIG = Object.freeze({
    initialSpeed: 18,
    maximumSpeed: 34,
    speedRamp: 0.13,
    targetCount: 12,
    initialFuel: 0,
    catchFuel: 10,
    fragmentFuel: 13,
    caughtJunk: 24,
    burnedFuel: 10,
    maxJunk: 100,
    overdriveDuration: 8,
    overdriveJunkPurge: 18,
    actionCooldown: 180,
    maxAimRadians: THREE.MathUtils.degToRad(45),
  });

  const dom = {
    startScreen: document.getElementById('startScreen'),
    startButton: document.getElementById('startButton'),
    startError: document.getElementById('startError'),
    gameView: document.getElementById('gameView'),
    canvas: document.getElementById('gameCanvas'),
    score: document.getElementById('scoreDisplay'),
    combo: document.getElementById('comboDisplay'),
    fuel: document.getElementById('fuelDisplay'),
    warpCells: [...document.querySelectorAll('.warp-cell b')],
    junk: document.getElementById('junkDisplay'),
    junkMeter: document.getElementById('junkMeter'),
    laneStatus: document.getElementById('laneStatus'),
    reticle: document.getElementById('reticle'),
    lockLabel: document.getElementById('lockLabel'),
    feedback: document.getElementById('feedback'),
    speed: document.querySelector('#speedReadout b'),
    fireButton: document.getElementById('fireButton'),
    catchButton: document.getElementById('catchButton'),
    calibrateButton: document.getElementById('calibrateButton'),
    pauseButton: document.getElementById('pauseButton'),
    pauseScreen: document.getElementById('pauseScreen'),
    resumeButton: document.getElementById('resumeButton'),
    gameOverScreen: document.getElementById('gameOverScreen'),
    restartButton: document.getElementById('restartButton'),
    finalScore: document.getElementById('finalScore'),
    finalFuel: document.getElementById('finalFuel'),
    finalCombo: document.getElementById('finalCombo'),
  };

  const state = {
    started: false,
    playing: false,
    paused: false,
    score: 0,
    fuel: CONFIG.initialFuel,
    junk: 0,
    combo: 0,
    bestCombo: 0,
    elapsed: 0,
    speed: CONFIG.initialSpeed,
    spawnTimer: 0,
    overdriveTimer: 0,
    overdrives: 0,
    lastActionAt: 0,
    aim: new THREE.Vector2(),
    aimTarget: new THREE.Vector2(),
    lockedTarget: null,
    inputMode: 'pointer',
    lastOrientation: null,
    baseOrientation: null,
  };

  let scene;
  let camera;
  let renderer;
  let clock;
  let raycaster;
  let starField;
  let starData = [];
  let tunnelRings = [];
  let targets = [];
  let effects = [];
  let audio;
  let animationFrame;

  const scratch = {
    projected: new THREE.Vector3(),
    deviceEuler: new THREE.Euler(),
    deviceQuaternion: new THREE.Quaternion(),
    relativeQuaternion: new THREE.Quaternion(),
    relativeEuler: new THREE.Euler(),
    screenQuaternion: new THREE.Quaternion(),
    xAxisQuarterTurn: new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)),
    color: new THREE.Color(),
  };

  class WarpAudio {
    constructor() {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.context = AudioContext ? new AudioContext() : null;
      this.master = null;

      if (this.context) {
        this.master = this.context.createGain();
        this.master.gain.value = 0.18;
        this.master.connect(this.context.destination);
      }
    }

    resume() {
      if (this.context && this.context.state === 'suspended') {
        return this.context.resume();
      }
      return Promise.resolve();
    }

    tone(frequency, duration, type = 'sine', slideTo = frequency, volume = 0.35) {
      if (!this.context || !this.master) return;
      const now = this.context.currentTime;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + duration);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start(now);
      oscillator.stop(now + duration);
    }

    fire() {
      this.tone(210, 0.12, 'sawtooth', 70, 0.32);
      window.setTimeout(() => this.tone(740, 0.09, 'square', 310, 0.13), 24);
    }

    catch() {
      this.tone(260, 0.24, 'sine', 980, 0.27);
    }

    success(type) {
      if (type === 'green') {
        this.tone(640, 0.18, 'sine', 1180, 0.23);
      } else {
        this.tone(140, 0.2, 'square', 54, 0.24);
      }
    }

    mistake() {
      this.tone(120, 0.3, 'sawtooth', 58, 0.3);
    }
  }

  function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x010108);
    scene.fog = new THREE.FogExp2(0x050517, 0.009);

    camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 220);
    camera.position.set(0, 0, 4);
    camera.lookAt(0, 0, -20);

    renderer = new THREE.WebGLRenderer({
      canvas: dom.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputEncoding = THREE.sRGBEncoding;

    raycaster = new THREE.Raycaster();
    clock = new THREE.Clock();
    audio = new WarpAudio();

    scene.add(new THREE.HemisphereLight(0x7fdfff, 0x100019, 1.25));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
    keyLight.position.set(-4, 6, 5);
    scene.add(keyLight);

    createStarField();
    createTunnelRings();
  }

  function createStarField() {
    const count = window.innerWidth < 700 ? 620 : 980;
    const positions = new Float32Array(count * 18);
    const colors = new Float32Array(count * 18);
    const palette = [0x54efff, 0xffffff, 0xa475ff, 0x5d8dff];

    starData = [];
    for (let index = 0; index < count; index += 1) {
      const star = {
        angle: Math.random() * Math.PI * 2,
        radius: 3 + Math.pow(Math.random(), 0.58) * 21,
        z: -8 - Math.random() * 164,
        length: 4 + Math.pow(Math.random(), 0.65) * 16,
        speed: 0.45 + Math.random() * 1.55,
        width: 0.022 + Math.pow(Math.random(), 1.8) * 0.12,
        brightness: 0.48 + Math.random() * 0.52,
        color: palette[Math.floor(Math.random() * palette.length)],
      };
      starData.push(star);
      writeStar(index, star, positions);
      writeStarColor(index, star, colors);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    starField = new THREE.Mesh(geometry, material);
    starField.frustumCulled = false;
    scene.add(starField);
  }

  function writeStar(index, star, positions) {
    const x = Math.cos(star.angle) * star.radius;
    const y = Math.sin(star.angle) * star.radius;
    const acrossX = -Math.sin(star.angle);
    const acrossY = Math.cos(star.angle);
    const headWidth = star.width;
    const tailWidth = star.width * 0.24;
    const headLeftX = x + acrossX * headWidth;
    const headLeftY = y + acrossY * headWidth;
    const headRightX = x - acrossX * headWidth;
    const headRightY = y - acrossY * headWidth;
    const tailLeftX = x + acrossX * tailWidth;
    const tailLeftY = y + acrossY * tailWidth;
    const tailRightX = x - acrossX * tailWidth;
    const tailRightY = y - acrossY * tailWidth;
    const tailZ = star.z - star.length;
    const offset = index * 18;

    positions[offset] = headLeftX;
    positions[offset + 1] = headLeftY;
    positions[offset + 2] = star.z;
    positions[offset + 3] = headRightX;
    positions[offset + 4] = headRightY;
    positions[offset + 5] = star.z;
    positions[offset + 6] = tailLeftX;
    positions[offset + 7] = tailLeftY;
    positions[offset + 8] = tailZ;
    positions[offset + 9] = headRightX;
    positions[offset + 10] = headRightY;
    positions[offset + 11] = star.z;
    positions[offset + 12] = tailRightX;
    positions[offset + 13] = tailRightY;
    positions[offset + 14] = tailZ;
    positions[offset + 15] = tailLeftX;
    positions[offset + 16] = tailLeftY;
    positions[offset + 17] = tailZ;
  }

  function writeStarColor(index, star, colors) {
    scratch.color.setHex(star.color);
    const head = star.brightness;
    const tail = star.brightness * 0.16;
    const brightnessByVertex = [head, head, tail, head, tail, tail];
    let offset = index * 18;
    brightnessByVertex.forEach((brightness) => {
      colors[offset] = scratch.color.r * brightness;
      colors[offset + 1] = scratch.color.g * brightness;
      colors[offset + 2] = scratch.color.b * brightness;
      offset += 3;
    });
  }

  function createTunnelRings() {
    const ringGeometry = new THREE.TorusGeometry(12.5, 0.025, 3, 96);
    tunnelRings = [];

    for (let index = 0; index < 22; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: index % 3 === 0 ? 0x8f5eff : 0x32d9ff,
        transparent: true,
        opacity: index % 3 === 0 ? 0.15 : 0.08,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeometry, material);
      ring.position.z = -10 - index * 8;
      ring.rotation.z = index * 0.17;
      ring.userData.spin = (index % 2 ? 1 : -1) * (0.025 + Math.random() * 0.045);
      scene.add(ring);
      tunnelRings.push(ring);
    }
  }

  function resetStar(star) {
    star.angle = Math.random() * Math.PI * 2;
    star.radius = 3 + Math.pow(Math.random(), 0.58) * 21;
    star.z = -155 - Math.random() * 22;
    star.length = 4 + Math.pow(Math.random(), 0.65) * 16;
    star.speed = 0.45 + Math.random() * 1.55;
    star.width = 0.022 + Math.pow(Math.random(), 1.8) * 0.12;
  }

  function updateTunnel(delta) {
    const positions = starField.geometry.attributes.position.array;
    starData.forEach((star, index) => {
      star.z += state.speed * star.speed * delta;
      if (star.z > 7) resetStar(star);
      writeStar(index, star, positions);
    });
    starField.geometry.attributes.position.needsUpdate = true;

    tunnelRings.forEach((ring) => {
      ring.position.z += state.speed * delta;
      ring.rotation.z += ring.userData.spin * delta * state.speed;
      if (ring.position.z > 7) {
        ring.position.z -= tunnelRings.length * 8;
      }
    });
  }

  function createHazard() {
    const group = new THREE.Group();
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: 0x7b061c,
      emissive: 0xff143d,
      emissiveIntensity: 1.8,
      metalness: 0.7,
      roughness: 0.32,
      flatShading: true,
    });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.35, 0), coreMaterial);
    group.add(core);

    const spikeGeometry = new THREE.ConeGeometry(0.28, 1.55, 5);
    const spikeMaterial = new THREE.MeshBasicMaterial({ color: 0xff3157 });
    const directions = [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ];
    directions.forEach(([x, y, z]) => {
      const spike = new THREE.Mesh(spikeGeometry, spikeMaterial);
      spike.position.set(x, y, z).multiplyScalar(1.55);
      spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x, y, z));
      group.add(spike);
    });

    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.1, 1),
      new THREE.MeshBasicMaterial({ color: 0xff3157, wireframe: true, transparent: true, opacity: 0.28 })
    );
    group.add(shell);
    group.userData.pulseMaterials = [coreMaterial, shell.material];
    return group;
  }

  function createResource() {
    const group = new THREE.Group();
    const coreMaterial = new THREE.MeshPhongMaterial({
      color: 0x18e978,
      emissive: 0x064d2d,
      emissiveIntensity: 0.72,
      shininess: 92,
      transparent: true,
      opacity: 0.95,
      flatShading: true,
    });
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.55, 0), coreMaterial);
    crystal.scale.y = 1.35;
    group.add(crystal);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x42ff9e,
      transparent: true,
      opacity: 0.54,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.055, 5, 48), ringMaterial);
    ring.rotation.x = Math.PI / 2.8;
    group.add(ring);

    const secondRing = ring.clone();
    secondRing.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    group.add(secondRing);
    group.userData.rings = [ring, secondRing];
    group.userData.pulseMaterials = [coreMaterial, ringMaterial];
    return group;
  }

  function spawnTarget(options = {}) {
    const isFragment = Boolean(options.isFragment);
    const targetLimit = CONFIG.targetCount + (isFragment ? 5 : 0);
    if (!state.playing || targets.length >= targetLimit) return null;

    const type = options.type || (Math.random() < 0.54 ? 'red' : 'green');
    const target = type === 'red' ? createHazard() : createResource();
    const exitAngle = options.exitAngle ?? Math.random() * Math.PI * 2;
    const startRadius = options.startRadius ?? (0.04 + Math.random() * 0.12);
    const endRadius = options.endRadius ?? (1.18 + Math.random() * 0.2);
    const startLaneX = options.startLaneX ?? Math.cos(exitAngle) * startRadius;
    const startLaneY = options.startLaneY ?? Math.sin(exitAngle) * startRadius * 0.72;
    const endLaneX = options.endLaneX ?? Math.cos(exitAngle) * endRadius;
    const endLaneY = options.endLaneY ?? Math.sin(exitAngle) * endRadius * 0.76;
    const scale = options.scale ?? (0.88 + Math.random() * 0.22);

    target.scale.setScalar(scale);
    target.userData.isWarpTarget = true;
    target.userData.type = type;
    target.userData.isFragment = isFragment;
    target.userData.fuelValue = options.fuelValue ?? CONFIG.catchFuel;
    target.userData.age = options.age ?? 0;
    target.userData.duration = options.duration ?? (5.7 + Math.random() * 1.35);
    target.userData.startZ = options.startZ ?? (-62 - Math.random() * 10);
    target.userData.endZ = options.endZ ?? -4.5;
    target.userData.exitAngle = exitAngle;
    target.userData.startLaneX = startLaneX;
    target.userData.startLaneY = startLaneY;
    target.userData.endLaneX = endLaneX;
    target.userData.endLaneY = endLaneY;
    target.userData.currentLaneX = startLaneX;
    target.userData.currentLaneY = startLaneY;
    target.userData.curve = options.curve ?? ((Math.random() - 0.5) * 0.16);
    target.userData.phase = Math.random() * Math.PI * 2;
    target.userData.drift = isFragment ? 0.006 : 0.012 + Math.random() * 0.012;
    target.userData.spin = new THREE.Vector3(
      (Math.random() - 0.5) * 1.5,
      (Math.random() - 0.5) * 1.7,
      (Math.random() - 0.5) * 1.2
    );
    target.position.z = target.userData.startZ;
    positionTargetInLane(target);

    scene.add(target);
    targets.push(target);
    return target;
  }

  function spawnFormation() {
    if (targets.length >= CONFIG.targetCount - 2) return;
    const exitAngle = Math.random() * Math.PI * 2;
    const count = Math.random() < 0.58 ? 3 : 2;
    const radialX = Math.cos(exitAngle);
    const radialY = Math.sin(exitAngle) * 0.76;
    const tangentX = -Math.sin(exitAngle);
    const tangentY = Math.cos(exitAngle) * 0.76;
    const firstType = Math.random() < 0.62 ? 'red' : 'green';

    for (let index = 0; index < count; index += 1) {
      const offset = (index - (count - 1) * 0.5);
      const type = index === 0 ? firstType : (Math.random() < 0.52 ? 'red' : 'green');
      spawnTarget({
        type,
        exitAngle,
        age: -index * 0.24,
        startZ: -58 - index * 2.5,
        startLaneX: radialX * (0.04 + index * 0.018) + tangentX * offset * 0.055,
        startLaneY: radialY * (0.04 + index * 0.018) + tangentY * offset * 0.055,
        endLaneX: radialX * (1.2 + index * 0.045) + tangentX * offset * 0.17,
        endLaneY: radialY * (1.2 + index * 0.045) + tangentY * offset * 0.17,
        duration: 6.1 + index * 0.32 + Math.random() * 0.55,
        curve: offset * 0.075,
      });
    }
  }

  function positionTargetInLane(target) {
    const data = target.userData;
    const depth = Math.max(0.1, camera.position.z - target.position.z);
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * depth;
    const driftX = Math.sin(state.elapsed * 1.45 + data.phase) * data.drift;
    const driftY = Math.cos(state.elapsed * 1.18 + data.phase) * data.drift * 0.7;
    target.position.x = (data.currentLaneX + driftX) * halfHeight * camera.aspect;
    target.position.y = (data.currentLaneY + driftY) * halfHeight;
  }

  function removeTarget(target) {
    const index = targets.indexOf(target);
    if (index >= 0) targets.splice(index, 1);
    scene.remove(target);
    target.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => material.dispose());
      }
    });
    if (state.lockedTarget === target) state.lockedTarget = null;
  }

  function clearTargets() {
    [...targets].forEach(removeTarget);
    targets = [];
  }

  function updateTargets(delta) {
    for (let index = targets.length - 1; index >= 0; index -= 1) {
      const target = targets[index];
      const data = target.userData;
      data.age += delta;
      const progress = THREE.MathUtils.clamp(data.age / data.duration, 0, 1);
      const laneProgress = progress * progress * (3 - 2 * progress);
      const depthProgress = Math.pow(progress, 1.28);
      const curvePulse = Math.sin(progress * Math.PI) * data.curve;
      data.currentLaneX = THREE.MathUtils.lerp(data.startLaneX, data.endLaneX, laneProgress)
        - Math.sin(data.exitAngle) * curvePulse;
      data.currentLaneY = THREE.MathUtils.lerp(data.startLaneY, data.endLaneY, laneProgress)
        + Math.cos(data.exitAngle) * curvePulse * 0.72;
      target.position.z = THREE.MathUtils.lerp(data.startZ, data.endZ, depthProgress);
      positionTargetInLane(target);
      target.rotation.x += data.spin.x * delta;
      target.rotation.y += data.spin.y * delta;
      target.rotation.z += data.spin.z * delta;

      if (data.rings) {
        data.rings[0].rotation.z += delta * 1.8;
        data.rings[1].rotation.y -= delta * 1.4;
      }

      const pulse = 1 + Math.sin(state.elapsed * 4.2 + data.phase) * 0.08;
      if (data.pulseMaterials && data.pulseMaterials[0].emissiveIntensity !== undefined) {
        data.pulseMaterials[0].emissiveIntensity = (data.type === 'red' ? 1.8 : 0.72) * pulse;
      }

      if (progress >= 1) {
        handlePass(target);
      }
    }
  }

  function handlePass(target) {
    removeTarget(target);
  }

  function releaseResourceFragments(target) {
    const data = target.userData;
    const startX = data.currentLaneX;
    const startY = data.currentLaneY;
    const startZ = target.position.z;
    const baseAngle = data.exitAngle;

    [-1, 0, 1].forEach((offset, index) => {
      const angle = baseAngle + offset * 0.24;
      const endRadius = 1.22 + index * 0.06;
      spawnTarget({
        type: 'green',
        isFragment: true,
        fuelValue: CONFIG.fragmentFuel,
        exitAngle: angle,
        startZ,
        endZ: -3.5,
        startLaneX: startX + offset * 0.018,
        startLaneY: startY - Math.abs(offset) * 0.012,
        endLaneX: Math.cos(angle) * endRadius,
        endLaneY: Math.sin(angle) * endRadius * 0.76,
        duration: 3.65 + index * 0.28,
        scale: 0.54 + Math.random() * 0.08,
        curve: offset * 0.12,
      });
    });
  }

  function findLockedTarget() {
    let best = null;
    let bestDistance = Infinity;

    targets.forEach((target) => {
      if (target.position.z > 2 || target.position.z < -115) return;
      scratch.projected.copy(target.position).project(camera);
      if (scratch.projected.z < -1 || scratch.projected.z > 1) return;
      const distance = Math.hypot(scratch.projected.x - state.aim.x, scratch.projected.y - state.aim.y);
      const progress = THREE.MathUtils.clamp(target.userData.age / target.userData.duration, 0, 1);
      const fragmentAssist = target.userData.isFragment ? 0.035 : 0;
      const overdriveAssist = state.overdriveTimer > 0 ? 0.075 : 0;
      const lockRadius = 0.105 + progress * 0.09 + fragmentAssist + overdriveAssist;
      if (distance < lockRadius && distance < bestDistance) {
        best = target;
        bestDistance = distance;
      }
    });
    return best;
  }

  function updateAim(delta) {
    const smoothing = 1 - Math.exp(-delta * 13);
    state.aim.lerp(state.aimTarget, smoothing);
    const left = 50 + state.aim.x * 42;
    const top = 50 - state.aim.y * 38;
    dom.reticle.style.left = `${left}%`;
    dom.reticle.style.top = `${top}%`;

    state.lockedTarget = findLockedTarget();
    dom.reticle.classList.remove('lock-red', 'lock-green');
    if (state.lockedTarget) {
      const type = state.lockedTarget.userData.type;
      dom.reticle.classList.add(type === 'red' ? 'lock-red' : 'lock-green');
      dom.lockLabel.textContent = type === 'red' ? 'ORE // FIRE' : 'CORE // CATCH';
    } else {
      dom.lockLabel.textContent = 'SEARCH';
    }
  }

  function performAction(action) {
    if (!state.playing || state.paused) return;
    const now = performance.now();
    if (now - state.lastActionAt < CONFIG.actionCooldown) return;
    state.lastActionAt = now;
    audio.resume();

    const button = action === 'fire' ? dom.fireButton : dom.catchButton;
    button.classList.add('pressed');
    window.setTimeout(() => button.classList.remove('pressed'), 100);

    if (action === 'fire') audio.fire();
    else audio.catch();

    const target = state.lockedTarget || findLockedTarget();
    if (!target) {
      createTracer(action, null);
      showFeedback(action === 'fire' ? 'SHOT WIDE' : 'NO LOCK', 'neutral');
      return;
    }

    const type = target.userData.type;
    const correct = (action === 'fire' && type === 'red') || (action === 'catch' && type === 'green');
    createTracer(action, target.position.clone());

    if (correct) {
      state.combo += 1;
      state.bestCombo = Math.max(state.bestCombo, state.combo);
      const multiplier = Math.min(5, 1 + Math.floor(state.combo / 4));
      const overdriveMultiplier = state.overdriveTimer > 0 ? 2 : 1;
      const points = (type === 'red' ? 75 : 100) * multiplier * overdriveMultiplier;
      state.score += points;

      if (type === 'green') {
        const fuelValue = target.userData.fuelValue;
        state.fuel = Math.min(100, state.fuel + fuelValue);
        createCaptureEffect(target);
        showFeedback(`CORE BANKED +${fuelValue}%`, 'good');
        if (state.fuel >= 100) activateOverdrive();
      } else {
        createExplosion(target.position.clone(), 0xff3157);
        releaseResourceFragments(target);
        showFeedback('ORE CRACKED // 3 CORES', 'good');
      }
      flash('good');
      audio.success(type);
      vibrate(type === 'red' ? [38, 26, 55] : 42);
    } else {
      resetCombo();
      if (action === 'fire') {
        state.fuel = Math.max(0, state.fuel - CONFIG.burnedFuel);
        createExplosion(target.position.clone(), 0x42ff9e);
        showFeedback(`CORE VAPORISED -${CONFIG.burnedFuel}%`, 'bad');
      } else {
        state.junk = Math.min(CONFIG.maxJunk, state.junk + CONFIG.caughtJunk);
        createCaptureEffect(target, true);
        showFeedback(`RAW ORE IN CARGO +${CONFIG.caughtJunk} JUNK`, 'bad');
      }
      flash('bad');
      audio.mistake();
      vibrate([95, 35, 95]);
    }

    removeTarget(target);
    updateHud();
    checkGameOver();
  }

  function activateOverdrive() {
    state.fuel = 0;
    state.overdrives += 1;
    state.overdriveTimer = CONFIG.overdriveDuration;
    state.junk = Math.max(0, state.junk - CONFIG.overdriveJunkPurge);
    state.score += 500;
    dom.gameView.classList.add('overdrive');
    showFeedback(`OVERDRIVE // x2 YIELD // -${CONFIG.overdriveJunkPurge} JUNK`, 'good');
    flash('good');
    audio.catch();
    window.setTimeout(() => audio.success('green'), 120);
    vibrate([45, 30, 45, 30, 100]);
  }

  function updateOverdrive(delta) {
    if (state.overdriveTimer <= 0) return;
    state.overdriveTimer = Math.max(0, state.overdriveTimer - delta);
    if (state.overdriveTimer === 0) {
      dom.gameView.classList.remove('overdrive');
      showFeedback('OVERDRIVE COOLED', 'neutral');
    }
  }

  function createTracer(action, targetPosition) {
    const origin = new THREE.Vector3(state.aim.x * 0.9, state.aim.y * 0.6 - 1.2, 2.5);
    let destination;
    if (targetPosition) {
      destination = targetPosition;
    } else {
      raycaster.setFromCamera(state.aim, camera);
      destination = raycaster.ray.origin.clone().add(raycaster.ray.direction.clone().multiplyScalar(75));
    }

    const geometry = new THREE.BufferGeometry().setFromPoints([origin, destination]);
    const material = new THREE.LineBasicMaterial({
      color: action === 'fire' ? 0xff3157 : 0x42ff9e,
      transparent: true,
      opacity: action === 'fire' ? 1 : 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    effects.push({ kind: 'fade', object: line, material, life: action === 'fire' ? 0.13 : 0.24, maxLife: action === 'fire' ? 0.13 : 0.24 });
  }

  function createExplosion(position, color) {
    const group = new THREE.Group();
    group.position.copy(position);
    scene.add(group);
    const fragments = [];
    const geometry = new THREE.TetrahedronGeometry(0.18, 0);

    for (let index = 0; index < 22; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: index % 4 === 0 ? 0xffffff : color,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const fragment = new THREE.Mesh(geometry, material);
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 13,
        (Math.random() - 0.5) * 13,
        (Math.random() - 0.5) * 13
      );
      fragment.userData.velocity = velocity;
      group.add(fragment);
      fragments.push(fragment);
    }

    effects.push({ kind: 'explosion', object: group, fragments, life: 0.72, maxLife: 0.72, geometry });
  }

  function createCaptureEffect(target, isJunk = false) {
    const ghost = target.clone(true);
    ghost.position.copy(target.position);
    ghost.userData.velocity = new THREE.Vector3(-ghost.position.x, -ghost.position.y, 5 - ghost.position.z).multiplyScalar(2.5);
    ghost.traverse((child) => {
      if (child.geometry) child.geometry = child.geometry.clone();
      if (child.material) {
        child.material = child.material.clone();
        child.material.transparent = true;
      }
    });
    scene.add(ghost);
    effects.push({ kind: 'capture', object: ghost, life: 0.34, maxLife: 0.34, isJunk });
  }

  function updateEffects(delta) {
    for (let index = effects.length - 1; index >= 0; index -= 1) {
      const effect = effects[index];
      effect.life -= delta;
      const progress = 1 - Math.max(0, effect.life) / effect.maxLife;

      if (effect.kind === 'fade') {
        effect.material.opacity = 1 - progress;
      } else if (effect.kind === 'explosion') {
        effect.fragments.forEach((fragment) => {
          fragment.position.addScaledVector(fragment.userData.velocity, delta);
          fragment.scale.setScalar(1 + progress * 1.8);
          fragment.material.opacity = 1 - progress;
        });
      } else if (effect.kind === 'capture') {
        effect.object.position.addScaledVector(effect.object.userData.velocity, delta);
        effect.object.scale.multiplyScalar(Math.max(0.7, 1 - delta * 5.2));
        effect.object.rotation.z += delta * 12;
        effect.object.traverse((child) => {
          if (child.material) child.material.opacity = 1 - progress;
        });
      }

      if (effect.life <= 0) {
        disposeEffect(effect);
        effects.splice(index, 1);
      }
    }
  }

  function disposeEffect(effect) {
    scene.remove(effect.object);
    effect.object.traverse((child) => {
      if (child.geometry && child.geometry !== effect.geometry) child.geometry.dispose();
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => material.dispose());
      }
    });
    if (effect.geometry) effect.geometry.dispose();
  }

  function clearEffects() {
    effects.forEach(disposeEffect);
    effects = [];
  }

  function resetCombo() {
    state.combo = 0;
  }

  function updateHud() {
    const multiplier = Math.min(5, 1 + Math.floor(state.combo / 4));
    dom.score.textContent = String(Math.max(0, state.score)).padStart(6, '0');
    const yieldLabel = state.overdriveTimer > 0 ? ` // YIELD x${multiplier * 2}` : ` // x${multiplier}`;
    dom.combo.textContent = state.combo > 0 ? `REFINE ${state.combo}${yieldLabel}` : 'REFINE x1';
    dom.fuel.textContent = `${Math.round(state.fuel)}%`;
    const cellCapacity = 100 / dom.warpCells.length;
    dom.warpCells.forEach((cell, index) => {
      const fill = THREE.MathUtils.clamp((state.fuel - index * cellCapacity) / cellCapacity, 0, 1) * 100;
      cell.style.width = `${fill}%`;
    });
    dom.junk.textContent = Math.round(state.junk);
    dom.junkMeter.style.width = `${state.junk}%`;
    dom.speed.textContent = (state.speed / CONFIG.initialSpeed).toFixed(1);
    dom.laneStatus.textContent = state.overdriveTimer > 0
      ? `OVERDRIVE ${state.overdriveTimer.toFixed(1)} // x2`
      : state.junk >= 75
        ? 'CARGO CRITICAL'
        : state.junk >= 45
          ? 'CONTAMINATION RISING'
          : 'MINING STREAM';
  }

  function showFeedback(message, tone) {
    dom.feedback.textContent = message;
    dom.feedback.className = `feedback ${tone}`;
    void dom.feedback.offsetWidth;
    dom.feedback.classList.add('show');
  }

  function flash(tone) {
    const className = `flash-${tone}`;
    document.body.classList.remove('flash-good', 'flash-bad');
    void document.body.offsetWidth;
    document.body.classList.add(className);
    window.setTimeout(() => document.body.classList.remove(className), 320);
  }

  function vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  function checkGameOver() {
    if (state.junk < CONFIG.maxJunk) return;
    state.playing = false;
    state.overdriveTimer = 0;
    dom.gameView.classList.remove('overdrive');
    dom.finalScore.textContent = state.score;
    dom.finalFuel.textContent = state.overdrives;
    dom.finalCombo.textContent = state.bestCombo;
    dom.gameOverScreen.hidden = false;
    showFeedback('CARGO BAY CLOGGED', 'bad');
  }

  function resetRun() {
    clearTargets();
    clearEffects();
    state.score = 0;
    state.fuel = CONFIG.initialFuel;
    state.junk = 0;
    state.combo = 0;
    state.bestCombo = 0;
    state.elapsed = 0;
    state.speed = CONFIG.initialSpeed;
    state.spawnTimer = 0;
    state.overdriveTimer = 0;
    state.overdrives = 0;
    state.lastActionAt = 0;
    state.aim.set(0, 0);
    state.aimTarget.set(0, 0);
    state.lockedTarget = null;
    state.baseOrientation = state.lastOrientation ? state.lastOrientation.clone() : null;
    state.playing = true;
    state.paused = false;
    dom.pauseScreen.hidden = true;
    dom.gameOverScreen.hidden = true;
    dom.gameView.classList.remove('overdrive');

    const openingRun = [
      { type: 'red', exitAngle: 3.05, age: 1.2, duration: 6.5, endRadius: 1.28 },
      { type: 'green', exitAngle: 0.15, age: 0.35, duration: 6.8, endRadius: 1.24 },
      { type: 'red', exitAngle: 2.1, age: -0.8, duration: 6.7, endRadius: 1.3 },
    ];
    openingRun.forEach((target) => spawnTarget(target));
    updateHud();
    showFeedback('STREAM OPEN // CRACK RED FIRST', 'neutral');
  }

  async function requestOrientationPermission() {
    if (typeof DeviceOrientationEvent === 'undefined') return false;
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const result = await DeviceOrientationEvent.requestPermission();
        return result === 'granted';
      } catch (error) {
        console.warn('Motion permission was not granted; using pointer aiming.', error);
        return false;
      }
    }
    return true;
  }

  function quaternionFromOrientation(event) {
    const alpha = THREE.MathUtils.degToRad(event.alpha || 0);
    const beta = THREE.MathUtils.degToRad(event.beta || 0);
    const gamma = THREE.MathUtils.degToRad(event.gamma || 0);
    const screenAngle = window.screen.orientation && Number.isFinite(window.screen.orientation.angle)
      ? window.screen.orientation.angle
      : (window.orientation || 0);
    const orient = THREE.MathUtils.degToRad(screenAngle);

    scratch.deviceEuler.set(beta, alpha, -gamma, 'YXZ');
    scratch.deviceQuaternion.setFromEuler(scratch.deviceEuler);
    scratch.deviceQuaternion.multiply(scratch.xAxisQuarterTurn);
    scratch.screenQuaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -orient);
    scratch.deviceQuaternion.multiply(scratch.screenQuaternion);
    return scratch.deviceQuaternion.clone();
  }

  function handleOrientation(event) {
    if (event.alpha === null && event.beta === null && event.gamma === null) return;
    const quaternion = quaternionFromOrientation(event);
    state.lastOrientation = quaternion;
    state.inputMode = 'gyro';
    if (!state.baseOrientation) state.baseOrientation = quaternion.clone();

    scratch.relativeQuaternion.copy(state.baseOrientation).invert().multiply(quaternion);
    scratch.relativeEuler.setFromQuaternion(scratch.relativeQuaternion, 'YXZ');
    const yaw = THREE.MathUtils.clamp(scratch.relativeEuler.y, -CONFIG.maxAimRadians, CONFIG.maxAimRadians);
    const pitch = THREE.MathUtils.clamp(scratch.relativeEuler.x, -CONFIG.maxAimRadians, CONFIG.maxAimRadians);
    state.aimTarget.set(
      THREE.MathUtils.clamp(-yaw / CONFIG.maxAimRadians, -0.94, 0.94),
      THREE.MathUtils.clamp(pitch / CONFIG.maxAimRadians, -0.9, 0.9)
    );
  }

  function calibrate() {
    if (state.lastOrientation) {
      state.baseOrientation = state.lastOrientation.clone();
      state.aimTarget.set(0, 0);
      showFeedback('AIM RECALIBRATED', 'neutral');
      vibrate(28);
    } else {
      showFeedback('MOVE POINTER TO AIM', 'neutral');
    }
  }

  function handlePointerMove(event) {
    if (!state.started || event.target.closest('button')) return;
    if (event.pointerType === 'touch' && state.inputMode === 'gyro') return;
    state.inputMode = 'pointer';
    state.aimTarget.set(
      THREE.MathUtils.clamp((event.clientX / window.innerWidth) * 2 - 1, -0.94, 0.94),
      THREE.MathUtils.clamp(-((event.clientY / window.innerHeight) * 2 - 1), -0.9, 0.9)
    );
  }

  function togglePause(forcePaused) {
    if (!state.started || !state.playing) return;
    state.paused = typeof forcePaused === 'boolean' ? forcePaused : !state.paused;
    dom.pauseScreen.hidden = !state.paused;
    if (state.paused) {
      clock.stop();
    } else {
      clock.start();
      audio.resume();
    }
  }

  async function startGame() {
    dom.startError.hidden = true;
    dom.startButton.disabled = true;
    dom.startButton.querySelector('span').textContent = 'CALIBRATING...';

    try {
      if (typeof THREE === 'undefined') throw new Error('Three.js could not load. Check your connection and try again.');
      if (!renderer) initScene();
      await requestOrientationPermission();
      window.addEventListener('deviceorientation', handleOrientation, true);
      await audio.resume();

      state.started = true;
      dom.startScreen.hidden = true;
      dom.gameView.hidden = false;
      resetRun();
      clock.start();
      if (!animationFrame) animate();
    } catch (error) {
      console.error(error);
      dom.startError.textContent = error.message || 'Unable to start the warp lane.';
      dom.startError.hidden = false;
      dom.startButton.disabled = false;
      dom.startButton.querySelector('span').textContent = 'TRY AGAIN';
    }
  }

  function animate() {
    animationFrame = window.requestAnimationFrame(animate);
    if (!renderer) return;
    const delta = Math.min(clock.getDelta(), 0.05);

    if (state.started && !state.paused) {
      updateTunnel(delta * (state.playing ? 1 : 0.28));
      updateEffects(delta);
      updateAim(delta);

      if (state.playing) {
        state.elapsed += delta;
        updateOverdrive(delta);
        const baseSpeed = Math.min(CONFIG.maximumSpeed, CONFIG.initialSpeed + state.elapsed * CONFIG.speedRamp);
        state.speed = Math.min(CONFIG.maximumSpeed * 1.2, baseSpeed * (state.overdriveTimer > 0 ? 1.22 : 1));
        state.spawnTimer -= delta;
        if (state.spawnTimer <= 0 && targets.length < CONFIG.targetCount - 2) {
          spawnFormation();
          state.spawnTimer = Math.max(2.05, 2.85 - state.elapsed * 0.004);
        }
        updateTargets(delta);
        updateHud();
      }
    }

    renderer.render(scene, camera);
  }

  function handleResize() {
    if (!renderer || !camera) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  function bindActionButton(button, action) {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      performAction(action);
    });
  }

  dom.startButton.addEventListener('click', startGame);
  bindActionButton(dom.fireButton, 'fire');
  bindActionButton(dom.catchButton, 'catch');
  dom.calibrateButton.addEventListener('click', calibrate);
  dom.pauseButton.addEventListener('click', () => togglePause());
  dom.resumeButton.addEventListener('click', () => togglePause(false));
  dom.restartButton.addEventListener('click', () => {
    audio.resume();
    resetRun();
    clock.start();
  });

  window.addEventListener('pointermove', handlePointerMove, { passive: true });
  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', () => window.setTimeout(calibrate, 250));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.playing && !state.paused) togglePause(true);
  });
  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.code === 'KeyF' || event.code === 'Space') performAction('fire');
    if (event.code === 'KeyC' || event.code === 'Enter') performAction('catch');
    if (event.code === 'KeyR') calibrate();
    if (event.code === 'Escape' || event.code === 'KeyP') togglePause();
  });

  document.addEventListener('contextmenu', (event) => event.preventDefault());
})();
