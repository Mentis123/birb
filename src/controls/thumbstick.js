const noop = () => {};

export function createThumbstick(root, { onChange = noop } = {}) {
  if (!root) return null;

  const handle = root.querySelector('[data-thumbstick-handle]');
  if (!handle) return null;

  const DEADZONE = 0.12;
  const state = {
    pointerId: null,
    pointerType: null,
    value: { x: 0, y: 0 },
    handleValue: { x: 0, y: 0 },
    captured: false,
    globalListeners: false,
  };

  const listenerOptions = { passive: false };

  const updateVisuals = () => {
    const maxDistance = (root.clientWidth - handle.clientWidth) / 2;
    const offsetX = state.handleValue.x * maxDistance;
    const offsetY = state.handleValue.y * maxDistance;
    handle.style.setProperty('--thumbstick-offset-x', `${offsetX}px`);
    handle.style.setProperty('--thumbstick-offset-y', `${offsetY}px`);
    const active = state.pointerId !== null || Math.hypot(offsetX, offsetY) > 0.5;
    root.classList.toggle('is-active', active);
  };

  const emitChange = () => {
    onChange(
      { x: state.value.x, y: state.value.y },
      { isActive: state.pointerId !== null, pointerType: state.pointerType }
    );
  };

  const setValues = ({ handleX = 0, handleY = 0, outputX = 0, outputY = 0 } = {}) => {
    state.handleValue.x = handleX;
    state.handleValue.y = handleY;
    state.value.x = outputX;
    state.value.y = outputY;
    updateVisuals();
    emitChange();
  };

  const translatePointer = (event) => {
    const rect = root.getBoundingClientRect();
    const maxDistance = rect.width / 2;
    if (maxDistance <= 0) {
      setValues();
      return;
    }

    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    let normalizedX = dx / maxDistance;
    let normalizedY = dy / maxDistance;
    const length = Math.hypot(normalizedX, normalizedY);
    if (length > 1) {
      normalizedX /= length;
      normalizedY /= length;
    }

    const handleMagnitude = Math.hypot(normalizedX, normalizedY);
    let outputX = 0;
    let outputY = 0;

    if (handleMagnitude > DEADZONE) {
      const scaledMagnitude = (handleMagnitude - DEADZONE) / (1 - DEADZONE);
      const dirX = handleMagnitude === 0 ? 0 : normalizedX / handleMagnitude;
      const dirY = handleMagnitude === 0 ? 0 : normalizedY / handleMagnitude;
      outputX = dirX * scaledMagnitude;
      outputY = dirY * scaledMagnitude;
    }

    setValues({ handleX: normalizedX, handleY: normalizedY, outputX, outputY });
  };

  const resetValues = () => {
    setValues({ handleX: 0, handleY: 0, outputX: 0, outputY: 0 });
  };

  const attachGlobalListeners = () => {
    if (state.globalListeners || typeof window === 'undefined') {
      return;
    }
    window.addEventListener('pointermove', handlePointerMove, listenerOptions);
    window.addEventListener('pointerup', handlePointerEnd, listenerOptions);
    window.addEventListener('pointercancel', handlePointerEnd, listenerOptions);
    state.globalListeners = true;
  };

  const detachGlobalListeners = () => {
    if (!state.globalListeners || typeof window === 'undefined') {
      return;
    }
    window.removeEventListener('pointermove', handlePointerMove, listenerOptions);
    window.removeEventListener('pointerup', handlePointerEnd, listenerOptions);
    window.removeEventListener('pointercancel', handlePointerEnd, listenerOptions);
    state.globalListeners = false;
  };

  const handlePointerDown = (event) => {
    if (state.pointerId !== null && state.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const supportsPointerCapture =
      typeof root.setPointerCapture === 'function' && typeof root.releasePointerCapture === 'function';
    const shouldCapture = supportsPointerCapture && event.pointerType !== 'touch';
    if (shouldCapture) {
      try {
        root.setPointerCapture(event.pointerId);
        state.captured = true;
      } catch (error) {
        state.captured = false;
      }
    } else {
      state.captured = false;
    }
    state.pointerId = event.pointerId;
    state.pointerType = event.pointerType || null;
    attachGlobalListeners();
    translatePointer(event);
  };

  const resetPointerState = () => {
    if (state.pointerId === null) {
      detachGlobalListeners();
      state.captured = false;
      return;
    }
    if (state.captured && typeof root.releasePointerCapture === 'function') {
      const hasCapture =
        typeof root.hasPointerCapture === 'function' ? root.hasPointerCapture(state.pointerId) : true;
      if (hasCapture) {
        try {
          root.releasePointerCapture(state.pointerId);
        } catch (error) {
          // Ignore release failures to avoid breaking touch input fallbacks.
        }
      }
    }
    state.pointerId = null;
    state.pointerType = null;
    state.captured = false;
    detachGlobalListeners();
  };

  const handlePointerMove = (event) => {
    if (state.pointerId !== event.pointerId) return;
    event.preventDefault();
    translatePointer(event);
  };

  const handlePointerEnd = (event) => {
    if (state.pointerId !== event.pointerId) return;
    event.preventDefault();
    resetPointerState();
    resetValues();
  };

  root.addEventListener('pointerdown', handlePointerDown, listenerOptions);
  root.addEventListener('lostpointercapture', handlePointerEnd, listenerOptions);

  return {
    reset() {
      resetPointerState();
      resetValues();
    },
    destroy() {
      root.removeEventListener('pointerdown', handlePointerDown, listenerOptions);
      root.removeEventListener('lostpointercapture', handlePointerEnd, listenerOptions);
      resetPointerState();
      resetValues();
    },
  };
}
