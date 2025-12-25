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
    // DEBUGGING: Completely disabled all movement
    // Bird should be 100% stationary
    this.velocity.set(0, 0, 0);
    this.rollAngle = 0;

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
