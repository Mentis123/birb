const noop = () => {};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const applyDeadzone = (value, deadzone) => {
  const dz = clamp(deadzone ?? 0, 0, 0.95);
  const magnitude = Math.abs(value);
  if (magnitude <= dz) {
    return 0;
  }
  const sign = Math.sign(value) || 1;
  return sign * clamp((magnitude - dz) / (1 - dz), 0, 1);
};

const applyExpo = (value, expo) => {
  const k = clamp(expo ?? 0, 0, 1);
  return (1 - k) * value + k * value * value * value;
};

const shapeAxis = (value, { deadzone = 0, expo = 0 } = {}) => {
  const dead = applyDeadzone(value, deadzone);
  return clamp(applyExpo(dead, expo), -1, 1);
};

const defaultOptions = {
  radius: 80,
  deadzone: 0.12,
  expo: 0.3,
  axis: { x: 1, y: 1 },
  onStart: noop,
  onChange: noop,
  onEnd: noop,
};

export class VirtualStick {
  constructor(zone, options = {}) {
    if (!zone) {
      throw new Error('VirtualStick requires a capture zone element');
    }

    this.zone = zone;
    this.config = {
      ...defaultOptions,
      ...options,
      axis: {
        x: options.axis?.x ?? defaultOptions.axis.x,
        y: options.axis?.y ?? defaultOptions.axis.y,
      },
    };
    this.activePointerId = null;
    this.pointerType = null;
    this.center = { x: 0, y: 0 };
    this.value = { x: 0, y: 0, active: false };

    this.ring = document.createElement('div');
    this.ring.className = 'vj-ring';
    this.knob = document.createElement('div');
    this.knob.className = 'vj-knob';

    document.body.append(this.ring, this.knob);

    this.listenerOptions = { passive: false };
    this.config.radius = Math.max(1, Number.isFinite(this.config.radius) ? this.config.radius : 80);

    this.zone.addEventListener('pointerdown', this.handlePointerDown, this.listenerOptions);
    window.addEventListener('pointermove', this.handlePointerMove, this.listenerOptions);
    window.addEventListener('pointerup', this.handlePointerUp, this.listenerOptions);
    window.addEventListener('pointercancel', this.handlePointerUp, this.listenerOptions);
    this.zone.style.touchAction = 'none';
  }

  show(x, y) {
    this.ring.style.left = `${x}px`;
    this.ring.style.top = `${y}px`;
    this.knob.style.left = `${x}px`;
    this.knob.style.top = `${y}px`;
    this.ring.style.opacity = '1';
    this.knob.style.opacity = '1';
  }

  hide() {
    this.ring.style.opacity = '0';
    this.knob.style.opacity = '0';
  }

  update(x, y, active) {
    const clampedX = clamp(x, -1, 1);
    const clampedY = clamp(y, -1, 1);
    const magnitude = Math.min(Math.hypot(clampedX, clampedY), 1);
    const rawMagnitude = Math.min(Math.hypot(x, y), 1);
    const angle = Math.atan2(clampedY, clampedX);

    this.value = { x: clampedX, y: clampedY, active };

    const meta = {
      isActive: active,
      pointerType: this.pointerType,
      magnitude,
      angle,
      raw: { x: clampedX, y: clampedY },
      rawMagnitude,
    };

    this.config.onChange({ x: clampedX, y: clampedY }, meta);
  }

  reset() {
    const wasActive = this.activePointerId !== null || this.value.active;
    const previousPointer = this.pointerType;
    this.activePointerId = null;
    this.hide();
    this.update(0, 0, false);
    if (wasActive) {
      this.config.onEnd({ pointerType: previousPointer });
    }
    this.pointerType = null;
  }

  destroy() {
    this.reset();
    this.zone.removeEventListener('pointerdown', this.handlePointerDown, this.listenerOptions);
    window.removeEventListener('pointermove', this.handlePointerMove, this.listenerOptions);
    window.removeEventListener('pointerup', this.handlePointerUp, this.listenerOptions);
    window.removeEventListener('pointercancel', this.handlePointerUp, this.listenerOptions);
    this.ring.remove();
    this.knob.remove();
  }

  handlePointerDown = (event) => {
    if (this.activePointerId !== null && this.activePointerId !== event.pointerId) {
      return;
    }
    this.activePointerId = event.pointerId;
    this.pointerType = event.pointerType || null;
    this.center.x = event.clientX;
    this.center.y = event.clientY;
    this.show(this.center.x, this.center.y);
    this.config.onStart({ pointerType: this.pointerType });
    this.update(0, 0, true);
    event.preventDefault();
  };

  handlePointerMove = (event) => {
    if (event.pointerId !== this.activePointerId) {
      return;
    }
    const dx = event.clientX - this.center.x;
    const dy = event.clientY - this.center.y;
    const distance = Math.hypot(dx, dy);
    const maxDistance = Math.max(1, this.config.radius);
    const scale = distance > maxDistance ? maxDistance / distance : 1;
    const clampedDx = dx * scale;
    const clampedDy = dy * scale;
    this.knob.style.left = `${this.center.x + clampedDx}px`;
    this.knob.style.top = `${this.center.y + clampedDy}px`;
    const normalizedX = (clampedDx / maxDistance) * (this.config.axis?.x ?? 1);
    const normalizedY = (clampedDy / maxDistance) * (this.config.axis?.y ?? 1);
    this.update(normalizedX, normalizedY, true);
    event.preventDefault();
  };

  handlePointerUp = (event) => {
    if (event.pointerId !== this.activePointerId) {
      return;
    }
    const pointerType = this.pointerType;
    this.activePointerId = null;
    this.hide();
    this.update(0, 0, false);
    this.config.onEnd({ pointerType });
    this.pointerType = null;
    event.preventDefault();
  };
}

export function createFloatingThumbstick(zone, options = {}) {
  if (!zone) return null;

  const config = { ...defaultOptions, ...options };
  if (options.radius == null) {
    const rect = zone.getBoundingClientRect?.();
    const base = Math.min(rect?.width ?? 0, rect?.height ?? 0);
    if (base > 0) {
      config.radius = Math.max(60, Math.min(96, base * 0.55));
    }
  }
  const state = {
    output: { x: 0, y: 0, magnitude: 0, angle: 0 },
  };

  const stick = new VirtualStick(zone, {
    radius: config.radius,
    onStart: config.onStart,
    onEnd: config.onEnd,
    onChange(value, meta) {
      const shapedX = shapeAxis(value.x, config);
      const shapedY = shapeAxis(value.y, config);
      const magnitude = Math.min(Math.hypot(shapedX, shapedY), 1);
      const angle = Math.atan2(shapedY, shapedX);
      state.output = { x: shapedX, y: shapedY, magnitude, angle };
      const payloadMeta = {
        isActive: meta.isActive,
        pointerType: meta.pointerType,
        magnitude,
        angle,
        raw: { x: value.x, y: value.y },
        rawMagnitude: meta.rawMagnitude,
      };
      config.onChange({ x: shapedX, y: shapedY }, payloadMeta);
    },
  });

  return {
    get value() {
      return { ...state.output };
    },
    reset() {
      stick.reset();
    },
    destroy() {
      stick.destroy();
    },
  };
}

export const inputShaping = {
  applyDeadzone,
  applyExpo,
  shapeAxis,
};
