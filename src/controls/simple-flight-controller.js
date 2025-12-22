import * as THREE from 'three';

export class SimpleFlightController {
  constructor() {
    // Bird state
    this.position = new THREE.Vector3(0, 5, 0);
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();

    // Physics constants
    this.speed = 2.5;              // Forward speed (constant)
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
    this.smoothedYaw = THREE.MathUtils.damp(
      this.smoothedYaw,
      this.input.yaw,
      this.yawResponse,
      deltaTime,
    );

    this.smoothedPitch = THREE.MathUtils.damp(
      this.smoothedPitch,
      this.input.pitch,
      this.pitchResponse,
      deltaTime,
    );

    const pitchInput = this.invertPitch ? -this.smoothedPitch : this.smoothedPitch;

    // 1. Apply rotation from inputs
    const yawDelta = this.smoothedYaw * this.turnSpeed * deltaTime;
    const pitchDelta = pitchInput * this.pitchSpeed * deltaTime;

    const yawQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), // Y-axis (world up)
      yawDelta
    );

    const rightAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quaternion);
    const pitchQuat = new THREE.Quaternion().setFromAxisAngle(
      rightAxis,
      -pitchDelta // Negative for intuitive up/down
    );

    this.quaternion.premultiply(yawQuat).multiply(pitchQuat).normalize();

    // 2. Calculate forward direction
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);

    // 3. Calculate vertical velocity (lift vs gravity)
    const lift = pitchInput * this.liftForce + this.neutralLift;
    const verticalTarget = lift - this.gravity;

    // 4. Update velocity
    this.velocity.copy(forward).multiplyScalar(this.speed);
    this.velocity.y = THREE.MathUtils.damp(
      this.velocity.y,
      verticalTarget,
      this.verticalResponse,
      deltaTime,
    );

    // 4b. Bank roll for visuals
    const targetRoll = -this.smoothedYaw * this.maxRoll;
    this.rollAngle = THREE.MathUtils.damp(
      this.rollAngle,
      targetRoll,
      this.rollResponse,
      deltaTime,
    );

    // 5. Update position
    this.position.addScaledVector(this.velocity, deltaTime);

    // 6. Prevent going underground
    if (this.position.y < 0.5) {
      this.position.y = 0.5;
      if (this.velocity.y < 0) {
        this.velocity.y = 0;
      }
    }

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
