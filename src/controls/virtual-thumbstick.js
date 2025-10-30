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
  radius: 56,
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
    this.currentPointerId = null;
    this.pointerType = null;
    this.center = { x: 0, y: 0 };
    this.value = { x: 0, y: 0, active: false };

    this.listenerOptions = { passive: false };
    this.handleContextMenu = (event) => {
      event.preventDefault();
    };
    this.config.radius = Math.max(1, Number.isFinite(this.config.radius) ? this.config.radius : 80);

    this.container = document.createElement('div');
    this.container.className = 'virtual-stick';
    this.container.style.width = `${this.config.radius * 2}px`;
    this.container.style.height = `${this.config.radius * 2}px`;

    this.base = document.createElement('div');
    this.base.className = 'virtual-stick__base';

    this.thumb = document.createElement('div');
    this.thumb.className = 'virtual-stick__thumb';

    this.container.append(this.base, this.thumb);
    document.body.append(this.container);
    this.hideTimeout = null;
    this.hide();

    this.zone.addEventListener('pointerdown', this.handlePointerDown, this.listenerOptions);
    window.addEventListener('pointermove', this.handlePointerMove, this.listenerOptions);
    window.addEventListener('pointerup', this.handlePointerUp, this.listenerOptions);
    window.addEventListener('pointercancel', this.handlePointerUp, this.listenerOptions);
    this.zone.style.touchAction = 'none';
    this.zone.style.setProperty('user-select', 'none');
    this.zone.style.setProperty('-webkit-user-select', 'none');
    this.zone.style.setProperty('-webkit-touch-callout', 'none');
    this.container.style.setProperty('-webkit-user-select', 'none');
    this.container.style.setProperty('user-select', 'none');
    this.container.addEventListener('contextmenu', this.handleContextMenu);
    this.zone.addEventListener('contextmenu', this.handleContextMenu);
  }

  show(x, y) {
    if (this.hideTimeout !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    this.container.style.left = `${x}px`;
    this.container.style.top = `${y}px`;
    this.container.style.display = 'block';
    const activate = () => this.container.classList.add('is-active');
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(activate);
    } else if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(activate);
    } else {
      activate();
    }
    this.thumb.style.transform = 'translate(-50%, -50%)';
  }

  hide() {
    this.container.classList.remove('is-active');
    if (this.hideTimeout !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    const completeHide = () => {
      this.container.style.display = 'none';
      this.hideTimeout = null;
    };
    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
      this.hideTimeout = window.setTimeout(completeHide, 160);
    } else {
      completeHide();
    }
    this.thumb.style.transform = 'translate(-50%, -50%)';
  }

  update(x, y, active, overrides = {}) {
    const clampedX = clamp(x, -1, 1);
    const clampedY = clamp(y, -1, 1);
    const magnitude = Math.min(Math.hypot(clampedX, clampedY), 1);
    const rawMagnitude = Math.min(Math.hypot(x, y), 1);
    const angle = Math.atan2(clampedY, clampedX);

    this.value = { x: clampedX, y: clampedY, active };

    const meta = {
      isActive: active,
      pointerType: this.pointerType,
      pointerId:
        overrides.pointerId ?? (active ? this.activePointerId : this.currentPointerId),
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
    const previousPointerId = this.activePointerId ?? this.currentPointerId;
    this.activePointerId = null;
    this.currentPointerId = null;
    this.hide();
    this.update(0, 0, false, { pointerId: previousPointerId });
    if (wasActive) {
      this.config.onEnd({ pointerType: previousPointer, pointerId: previousPointerId });
    }
    this.pointerType = null;
  }

  destroy() {
    if (this.hideTimeout !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    this.reset();
    this.zone.removeEventListener('pointerdown', this.handlePointerDown, this.listenerOptions);
    window.removeEventListener('pointermove', this.handlePointerMove, this.listenerOptions);
    window.removeEventListener('pointerup', this.handlePointerUp, this.listenerOptions);
    window.removeEventListener('pointercancel', this.handlePointerUp, this.listenerOptions);
    this.container.removeEventListener('contextmenu', this.handleContextMenu);
    this.zone.removeEventListener('contextmenu', this.handleContextMenu);
    this.container.remove();
  }

  handlePointerDown = (event) => {
    if (this.activePointerId !== null && this.activePointerId !== event.pointerId) {
      return;
    }
    this.activePointerId = event.pointerId;
    this.currentPointerId = event.pointerId;
    this.pointerType = event.pointerType || null;
    this.center.x = event.clientX;
    this.center.y = event.clientY;
    this.show(this.center.x, this.center.y);
    this.config.onStart({ pointerType: this.pointerType, pointerId: this.activePointerId });
    this.update(0, 0, true, { pointerId: this.activePointerId });
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
    const offsetX = clampedDx;
    const offsetY = clampedDy;
    this.thumb.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`;
    const normalizedX = (clampedDx / maxDistance) * (this.config.axis?.x ?? 1);
    const normalizedY = (clampedDy / maxDistance) * (this.config.axis?.y ?? 1);
    this.update(normalizedX, normalizedY, true, { pointerId: this.activePointerId });
    event.preventDefault();
  };

  handlePointerUp = (event) => {
    if (event.pointerId !== this.activePointerId) {
      return;
    }
    const pointerType = this.pointerType;
    const pointerId = this.activePointerId;
    this.activePointerId = null;
    this.hide();
    this.update(0, 0, false, { pointerId });
    this.config.onEnd({ pointerType, pointerId });
    this.currentPointerId = null;
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
        pointerId: meta.pointerId ?? null,
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
