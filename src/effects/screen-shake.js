/**
 * Screen shake + FOV kick system for Birb Flight Lab
 * Lightweight camera juice effects
 */
export class ScreenShake {
  constructor() {
    this.shakeIntensity = 0;
    this.shakeDuration = 0;
    this.shakeTimer = 0;
    this.shakeDecay = 0;

    // FOV kick
    this.fovKick = 0;
    this.fovKickDecay = 8;
    this.baseFov = 60;

    // Offset applied to camera
    this.offset = { x: 0, y: 0, z: 0 };
  }

  /**
   * Trigger a camera shake
   * @param {number} intensity - Max displacement (0.05 = subtle, 0.15 = medium, 0.3 = heavy)
   * @param {number} duration - Duration in seconds
   */
  shake(intensity = 0.1, duration = 0.3) {
    // Don't override a stronger shake with a weaker one
    if (intensity > this.shakeIntensity) {
      this.shakeIntensity = intensity;
      this.shakeDuration = duration;
      this.shakeTimer = duration;
    }
  }

  /**
   * Trigger a FOV kick (brief widen then snap back)
   * @param {number} amount - FOV degrees to add (e.g., 8 for noticeable, 4 for subtle)
   */
  kickFov(amount = 6) {
    this.fovKick = amount;
  }

  /**
   * Update shake state - call every frame
   * @param {number} delta - Time since last frame in seconds
   * @returns {{ offset: {x,y,z}, fovOffset: number }} Current shake values to apply
   */
  update(delta) {
    // Update shake
    if (this.shakeTimer > 0) {
      this.shakeTimer -= delta;
      const progress = Math.max(0, this.shakeTimer / this.shakeDuration);
      const currentIntensity = this.shakeIntensity * progress;

      this.offset.x = (Math.random() - 0.5) * 2 * currentIntensity;
      this.offset.y = (Math.random() - 0.5) * 2 * currentIntensity;
      this.offset.z = (Math.random() - 0.5) * 2 * currentIntensity * 0.5;

      if (this.shakeTimer <= 0) {
        this.shakeIntensity = 0;
        this.offset.x = 0;
        this.offset.y = 0;
        this.offset.z = 0;
      }
    }

    // Update FOV kick (exponential decay)
    if (this.fovKick > 0.1) {
      this.fovKick *= Math.exp(-this.fovKickDecay * delta);
    } else {
      this.fovKick = 0;
    }

    return {
      offset: this.offset,
      fovOffset: this.fovKick,
    };
  }

  /** Convenience presets */
  droneHit() { this.shake(0.12, 0.4); }
  nestHit() { this.shake(0.2, 0.5); }
  droneDestroyed() { this.shake(0.06, 0.2); }
  ringCollected() { this.kickFov(5); }
  treeImpact() { this.shake(0.25, 0.6); this.kickFov(8); }
  groundLand() { this.shake(0.12, 0.3); }
}
