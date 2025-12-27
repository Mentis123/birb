import * as THREE from 'three';

export class SimpleFlightController {
  constructor() {
    // Bird state
    this.position = new THREE.Vector3(0, 5, 0);
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();

    // Physics constants
    this.speed = 2.7;              // Forward speed (constant)
    this.turnSpeed = Math.PI / 2;  // Radians per second
    this.pitchSpeed = Math.PI / 4; // Half of turn speed
    this.liftForce = 2.0;          // Upward lift from pitch
    this.gravity = 0.6;            // Downward pull
    this.neutralLift = 0.25;       // Keeps glide from feeling too sink-heavy

    // Responsiveness
    this.yawResponse = 3.5;
    this.pitchResponse = 3.2;
    this.verticalResponse = 2.75;
    this.rollResponse = 4.5;
    this.maxRoll = Math.PI / 4.5;
    this.smoothedYaw = 0;
    this.smoothedPitch = 0;
    this.rollAngle = 0;
    this.yawAngle = 0;
    this.pitchAngle = 0;

    this.invertPitch = false;

    // Control inputs
    this.input = {
      yaw: 0,   // -1 (left) to 1 (right)
      pitch: 0, // -1 (down) to 1 (up)
      roll: 0,
      throttle: 0.5 // Mock throttle for camera logic if needed
    };
  }

  update(deltaTime) {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) {
      this.velocity.set(0, 0, 0);
      return {
        position: this.position.clone(),
        quaternion: this.quaternion.clone(),
        velocity: this.velocity.clone(),
        roll: this.rollAngle,
      };
    }

    // Smooth the yaw input
    this.smoothedYaw = THREE.MathUtils.damp(
      this.smoothedYaw,
      this.input.yaw,
      this.yawResponse,
      deltaTime,
    );

    // Smooth the pitch input (with optional inversion)
    const targetPitchInput = this.invertPitch ? -this.input.pitch : this.input.pitch;
    this.smoothedPitch = THREE.MathUtils.damp(
      this.smoothedPitch,
      targetPitchInput,
      this.pitchResponse,
      deltaTime,
    );

    // Apply yaw rotation (turning left/right)
    const yawDelta = this.smoothedYaw * this.turnSpeed * deltaTime;
    const pitchDelta = this.smoothedPitch * this.pitchSpeed * deltaTime;

    this.yawAngle += yawDelta;
    this.pitchAngle += pitchDelta;

    // Update orientation from accumulated yaw/pitch (no roll baked into physics)
    const tilt = new THREE.Euler(this.pitchAngle, this.yawAngle, 0, 'YXZ');
    this.quaternion.setFromEuler(tilt);

    // Compute forward velocity aligned with facing direction
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion).normalize();
    this.velocity.copy(forward).multiplyScalar(this.speed);

    this.position.addScaledVector(this.velocity, deltaTime);

    // Visual banking - wing dips on the side we're turning toward
    const targetRoll = -this.smoothedYaw * this.maxRoll;
    this.rollAngle = THREE.MathUtils.damp(
      this.rollAngle,
      targetRoll,
      this.rollResponse,
      deltaTime,
    );

    return {
      position: this.position.clone(),
      quaternion: this.quaternion.clone(),
      velocity: this.velocity.clone(),
      roll: this.rollAngle,
    };
  }

  setInputs(yaw, pitch) {
    this.input.yaw = THREE.MathUtils.clamp(yaw, -1, 1);
    this.input.pitch = THREE.MathUtils.clamp(pitch, -1, 1);
  }

  setInvertPitch(invert) {
    this.invertPitch = Boolean(invert);
  }
}
