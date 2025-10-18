const noop = () => {};

const DEFAULT_OPTIONS = {
  deadzone: 0.12,
  onStart: noop,
  onChange: noop,
  onEnd: noop,
  axis: { x: 1, y: 1 },
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const normalizeVector = (x, y) => {
  const length = Math.hypot(x, y);
  if (length === 0) {
    return { x: 0, y: 0, length: 0 };
  }
  if (length <= 1) {
    return { x, y, length };
  }
  return { x: x / length, y: y / length, length: 1 };
};

const applyDeadzone = (x, y, deadzone) => {
  const length = Math.hypot(x, y);
  if (length <= deadzone) {
    return {
      x: 0,
      y: 0,
      magnitude: 0,
      angle: 0,
    };
  }
  const scaledMagnitude = clamp((length - deadzone) / (1 - deadzone), 0, 1);
  const directionX = length === 0 ? 0 : x / length;
  const directionY = length === 0 ? 0 : y / length;
  return {
    x: directionX * scaledMagnitude,
    y: directionY * scaledMagnitude,
    magnitude: scaledMagnitude,
    angle: Math.atan2(directionY, directionX),
  };
};

const createAxis = (optionsAxis = {}) => {
  const axis = { x: 1, y: 1 };
  if (typeof optionsAxis.x === 'number' && Number.isFinite(optionsAxis.x)) {
    axis.x = optionsAxis.x === 0 ? 1 : optionsAxis.x;
  }
  if (typeof optionsAxis.y === 'number' && Number.isFinite(optionsAxis.y)) {
    axis.y = optionsAxis.y === 0 ? 1 : optionsAxis.y;
  }
  return axis;
};

export function createThumbstick(root, options = {}) {
  if (!root) return null;

  const handle = root.querySelector('[data-thumbstick-handle]');
  if (!handle) return null;

  const config = {
    ...DEFAULT_OPTIONS,
    ...options,
    axis: createAxis(options.axis),
  };

  const state = {
    pointerId: null,
    pointerType: null,
    active: false,
    raw: { x: 0, y: 0 },
    output: { x: 0, y: 0, magnitude: 0, angle: 0 },
    outputRadius: Math.max(1, (root.clientWidth - handle.clientWidth) / 2),
  };

  const listenerOptions = { passive: false };
  const globalTarget = typeof window !== 'undefined' ? window : null;

  const getMetrics = () => {
    const rect = root.getBoundingClientRect();
    const maxDistance = Math.max(1, (root.clientWidth - handle.clientWidth) / 2);
    return {
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      maxDistance,
    };
  };

  const updateVisuals = () => {
    const offsetX = state.raw.x * state.outputRadius;
    const offsetY = state.raw.y * state.outputRadius;
    handle.style.setProperty('--thumbstick-offset-x', `${offsetX}px`);
    handle.style.setProperty('--thumbstick-offset-y', `${offsetY}px`);
    root.classList.toggle('is-active', state.active || Math.hypot(offsetX, offsetY) > 0.5);
  };

  const emitChange = () => {
    const payload = { x: state.output.x, y: state.output.y };
    const meta = {
      isActive: state.active,
      pointerType: state.pointerType,
      magnitude: state.output.magnitude,
      angle: state.output.angle,
      raw: { x: state.raw.x, y: state.raw.y },
      rawMagnitude: Math.hypot(state.raw.x, state.raw.y),
    };
    config.onChange(payload, meta);
  };

  const setNeutral = (emit = true) => {
    state.raw.x = 0;
    state.raw.y = 0;
    state.output = { x: 0, y: 0, magnitude: 0, angle: 0 };
    updateVisuals();
    if (emit) emitChange();
  };

  const updateFromPointer = (event) => {
    const metrics = getMetrics();
    state.outputRadius = metrics.maxDistance;
    const dx = event.clientX - metrics.centerX;
    const dy = event.clientY - metrics.centerY;

    const normalized = normalizeVector(dx / metrics.maxDistance, dy / metrics.maxDistance);

    state.raw.x = normalized.x;
    state.raw.y = normalized.y;

    let axisAdjustedX = normalized.x * config.axis.x;
    let axisAdjustedY = normalized.y * config.axis.y;
    const axisLength = Math.hypot(axisAdjustedX, axisAdjustedY);
    if (axisLength > 1) {
      axisAdjustedX /= axisLength;
      axisAdjustedY /= axisLength;
    }
    state.output = applyDeadzone(axisAdjustedX, axisAdjustedY, config.deadzone);

    updateVisuals();
    emitChange();
  };

  const resetPointerState = () => {
    const wasActive = state.pointerId !== null || state.active || state.output.magnitude !== 0;
    state.pointerId = null;
    state.pointerType = null;
    state.active = false;
    state.outputRadius = Math.max(1, (root.clientWidth - handle.clientWidth) / 2);
    setNeutral();
    if (wasActive) {
      config.onEnd();
    }
  };

  const handlePointerDown = (event) => {
    if (state.pointerId !== null && state.pointerId !== event.pointerId) {
      return;
    }
    if (event.button !== undefined && event.button !== 0) {
      return;
    }
    event.preventDefault();
    state.pointerId = event.pointerId;
    state.pointerType = event.pointerType || null;
    state.active = true;
    state.outputRadius = Math.max(1, (root.clientWidth - handle.clientWidth) / 2);

    if (typeof root.setPointerCapture === 'function') {
      try {
        root.setPointerCapture(event.pointerId);
      } catch (error) {
        // Ignore capture failures on unsupported platforms.
      }
    }

    config.onStart({ pointerType: state.pointerType });
    updateFromPointer(event);
    if (globalTarget) {
      globalTarget.addEventListener('pointermove', handlePointerMove, listenerOptions);
      globalTarget.addEventListener('pointerup', handlePointerUp, listenerOptions);
      globalTarget.addEventListener('pointercancel', handlePointerUp, listenerOptions);
    }
  };

  const handlePointerMove = (event) => {
    if (state.pointerId !== event.pointerId) return;
    event.preventDefault();
    updateFromPointer(event);
  };

  const handlePointerUp = (event) => {
    if (state.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (typeof root.releasePointerCapture === 'function') {
      try {
        root.releasePointerCapture(event.pointerId);
      } catch (error) {
        // Ignore release failures.
      }
    }
    if (globalTarget) {
      globalTarget.removeEventListener('pointermove', handlePointerMove, listenerOptions);
      globalTarget.removeEventListener('pointerup', handlePointerUp, listenerOptions);
      globalTarget.removeEventListener('pointercancel', handlePointerUp, listenerOptions);
    }
    resetPointerState();
  };

  const handleLostPointerCapture = (event) => {
    if (state.pointerId === null || state.pointerId !== event.pointerId) {
      return;
    }
    if (globalTarget) {
      globalTarget.removeEventListener('pointermove', handlePointerMove, listenerOptions);
      globalTarget.removeEventListener('pointerup', handlePointerUp, listenerOptions);
      globalTarget.removeEventListener('pointercancel', handlePointerUp, listenerOptions);
    }
    resetPointerState();
  };

  state.outputRadius = Math.max(1, (root.clientWidth - handle.clientWidth) / 2);
  setNeutral(false);

  root.addEventListener('pointerdown', handlePointerDown, listenerOptions);
  root.addEventListener('lostpointercapture', handleLostPointerCapture, listenerOptions);

  return {
    get value() {
      return { ...state.output };
    },
    reset() {
      resetPointerState();
    },
    destroy() {
      root.removeEventListener('pointerdown', handlePointerDown, listenerOptions);
      root.removeEventListener('lostpointercapture', handleLostPointerCapture, listenerOptions);
      if (globalTarget) {
        globalTarget.removeEventListener('pointermove', handlePointerMove, listenerOptions);
        globalTarget.removeEventListener('pointerup', handlePointerUp, listenerOptions);
        globalTarget.removeEventListener('pointercancel', handlePointerUp, listenerOptions);
      }
      resetPointerState();
    },
  };
}
