/**
 * touch-input.js
 * 
 * Minimal touch input handler. Returns raw joystick values.
 * No smoothing, no shaping, no normalization beyond [-1, 1].
 */

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

export function createTouchInput(containerElement, nippleLib) {
  if (!containerElement || !nippleLib) {
    throw new Error('createTouchInput requires container element and nipplejs');
  }

  // Current input state
  const state = {
    x: 0,        // -1 (left) to +1 (right)
    y: 0,        // -1 (down) to +1 (up)
    active: false,
  };

  // Create joystick
  const manager = nippleLib.create({
    zone: containerElement,
    mode: 'dynamic',
    size: 100,
    color: '#ffffff',
    fadeTime: 100,
    restOpacity: 0,
  });

  // Handle joystick movement
  manager.on('move', (event, data) => {
    if (data.vector) {
      state.x = clamp(data.vector.x, -1, 1);
      state.y = clamp(data.vector.y, -1, 1);
      state.active = true;
    }
  });

  // Handle joystick release
  manager.on('end', () => {
    state.x = 0;
    state.y = 0;
    state.active = false;
  });

  // Public API
  return {
    /** Get current input. Returns { x, y, active } */
    get() {
      return { ...state };
    },

    /** Check if joystick is being touched */
    isActive() {
      return state.active;
    },

    /** Clean up */
    dispose() {
      manager.destroy();
    },
  };
}

// Optional: Keyboard input for desktop testing
export function createKeyboardInput() {
  const keys = new Set();
  
  const onKeyDown = (e) => keys.add(e.code);
  const onKeyUp = (e) => keys.delete(e.code);
  
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
  }

  return {
    get() {
      const x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0)
              - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      const y = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0)
              - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      return { x, y, active: x !== 0 || y !== 0 };
    },
    isActive() {
      return keys.size > 0;
    },
    dispose() {
      if (typeof document !== 'undefined') {
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keyup', onKeyUp);
      }
    },
  };
}

// Combine multiple input sources
export function combineInputs(...sources) {
  return {
    get() {
      let x = 0, y = 0, active = false;
      for (const source of sources) {
        const input = source.get();
        x += input.x;
        y += input.y;
        active = active || input.active;
      }
      return {
        x: clamp(x, -1, 1),
        y: clamp(y, -1, 1),
        active,
      };
    },
    isActive() {
      return sources.some(s => s.isActive());
    },
    dispose() {
      sources.forEach(s => s.dispose());
    },
  };
}
