import { Vector3 } from 'three';
import { SimpleFlightController } from '../../src/controls/simple-flight-controller.js';

export function runFlightHarness(sequence, { deltaTime = 0.05, controller } = {}) {
  const ctrl = controller ?? new SimpleFlightController();
  const trace = [];
  let time = 0;

  for (const step of sequence) {
    const frames = Math.max(1, Math.round(step.duration / deltaTime));
    ctrl.setInputs(step.yaw ?? 0, step.pitch ?? 0);

    for (let i = 0; i < frames; i += 1) {
      time += deltaTime;
      const snapshot = ctrl.update(deltaTime);
      trace.push({ time: Number(time.toFixed(6)), ...snapshot });
    }
  }

  return trace;
}

export function forwardFromQuaternion(quaternion) {
  return new Vector3(0, 0, -1).applyQuaternion(quaternion).normalize();
}
