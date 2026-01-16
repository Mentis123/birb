/**
 * bird-visual.js
 * 
 * Visual effects for the bird model. Adds banking on turns,
 * pitch tilt on climbs/dives. Pure cosmetic - doesn't affect physics.
 */

export const VISUAL_DEFAULTS = {
    maxBankAngle: Math.PI * 0.25,   // 45° - noticeable but not extreme
    maxPitchTilt: Math.PI * 0.15,  // ~27° - subtle nose up/down
    bankResponse: 8,                // How fast bank responds to input
    pitchResponse: 6,               // How fast pitch tilt responds
};

export class BirdVisual {
    constructor(THREE, options = {}) {
        this.THREE = THREE;
        const { Quaternion, Euler } = THREE;

        // Configuration
        this.maxBankAngle = options.maxBankAngle ?? VISUAL_DEFAULTS.maxBankAngle;
        this.maxPitchTilt = options.maxPitchTilt ?? VISUAL_DEFAULTS.maxPitchTilt;
        this.bankResponse = options.bankResponse ?? VISUAL_DEFAULTS.bankResponse;
        this.pitchResponse = options.pitchResponse ?? VISUAL_DEFAULTS.pitchResponse;

        // Model orientation offset (if model doesn't face -Z)
        this.modelOffset = options.modelOffset
            ? options.modelOffset.clone()
            : new Quaternion();

        // Current visual state
        this._bank = 0;
        this._pitchTilt = 0;

        // Output quaternion
        this._visualQuaternion = new Quaternion();
        this._bankQuaternion = new Quaternion();
        this._pitchQuaternion = new Quaternion();
    }

    /**
     * Update visual effects based on input
     * @param {Quaternion} flightQuaternion - The physics quaternion from BirdFlight
     * @param {Object} input - { x: yaw input, y: pitch input }
     * @param {number} deltaTime
     * @returns {Quaternion} The visual quaternion to apply to the model
     */
    update(flightQuaternion, input, deltaTime) {
        // Target bank based on yaw input (turn right = bank right)
        // User Polished: Turn LEFT (Input -1) -> Left Wing Down (+Z Bank).
        // Since Bank +Z is Left Wing Down (Counter-Clockwise Roll), 
        // Input -1 should equal Positive Bank.
        // Input +1 (Right) should equal Negative Bank (Right Wing Down).
        const targetBank = -(input?.x ?? 0) * this.maxBankAngle;

        // Target pitch tilt based on pitch input (pitch up = nose up)
        const targetPitch = (input?.y ?? 0) * this.maxPitchTilt;

        // Smooth interpolation
        const bankAlpha = 1 - Math.exp(-this.bankResponse * deltaTime);
        const pitchAlpha = 1 - Math.exp(-this.pitchResponse * deltaTime);

        this._bank += (targetBank - this._bank) * bankAlpha;
        this._pitchTilt += (targetPitch - this._pitchTilt) * pitchAlpha;

        // Build visual quaternion
        // Start with flight quaternion (actual orientation)
        this._visualQuaternion.copy(flightQuaternion);

        // Apply model offset (e.g., if GLB faces -X instead of -Z)
        this._visualQuaternion.multiply(this.modelOffset);

        // Apply pitch tilt (nose up/down) around local X
        this._pitchQuaternion.setFromAxisAngle(
            new this.THREE.Vector3(1, 0, 0),
            this._pitchTilt
        );
        this._visualQuaternion.multiply(this._pitchQuaternion);

        // Apply bank (roll) around local Z
        this._bankQuaternion.setFromAxisAngle(
            new this.THREE.Vector3(0, 0, 1),
            this._bank
        );
        this._visualQuaternion.multiply(this._bankQuaternion);

        return this._visualQuaternion;
    }

    /**
     * Set model orientation offset
     * Use when your model doesn't face -Z by default
     */
    setModelOffset(quaternion) {
        this.modelOffset.copy(quaternion);
    }

    /**
     * Create offset from a forward vector
     * @param {Vector3} modelForward - The direction the model faces (e.g., -X for your GLB)
     */
    setModelForward(modelForward) {
        const targetForward = new this.THREE.Vector3(0, 0, -1);
        this.modelOffset.setFromUnitVectors(modelForward, targetForward);
    }

    /**
     * Reset visual state
     */
    reset() {
        this._bank = 0;
        this._pitchTilt = 0;
    }
}
