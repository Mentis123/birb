/**
 * Gyroscope utilities for AR Shooter
 */

class GyroManager {
    constructor() {
        this.isActive = false;
        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        this.hasPermission = false;
        this.listeners = [];
    }

    static isSupported() {
        return 'DeviceOrientationEvent' in window;
    }

    needsPermission() {
        return this.isIOS &&
               typeof DeviceOrientationEvent !== 'undefined' &&
               typeof DeviceOrientationEvent.requestPermission === 'function';
    }

    async requestPermission() {
        if (!this.needsPermission()) {
            this.hasPermission = true;
            return { granted: true, needsPermission: false };
        }

        try {
            const response = await DeviceOrientationEvent.requestPermission();
            this.hasPermission = (response === 'granted');
            return {
                granted: this.hasPermission,
                needsPermission: true,
                response
            };
        } catch (error) {
            console.error('Permission request failed:', error);
            return {
                granted: false,
                needsPermission: true,
                error
            };
        }
    }

    start(callback) {
        if (!GyroManager.isSupported()) {
            return { success: false, error: 'DeviceOrientation not supported' };
        }

        const handler = (event) => {
            this.isActive = true;
            callback({
                alpha: event.alpha || 0,  // Z axis (0-360)
                beta: event.beta || 0,    // X axis (-180 to 180)
                gamma: event.gamma || 0,  // Y axis (-90 to 90)
                absolute: event.absolute || false
            });
        };

        window.addEventListener('deviceorientation', handler);
        this.listeners.push(handler);

        return { success: true };
    }

    stop() {
        this.listeners.forEach(handler => {
            window.removeEventListener('deviceorientation', handler);
        });
        this.listeners = [];
        this.isActive = false;
    }

    // Convert device orientation to Three.js Euler angles
    static toEuler(alpha, beta, gamma) {
        // Convert degrees to radians
        const alphaRad = alpha * (Math.PI / 180);
        const betaRad = beta * (Math.PI / 180);
        const gammaRad = gamma * (Math.PI / 180);

        return {
            x: betaRad,
            y: gammaRad,
            z: alphaRad
        };
    }

    // Apply device orientation to Three.js camera
    static applyToCamera(camera, alpha, beta, gamma) {
        // More complex transformation accounting for screen orientation
        const euler = new THREE.Euler();

        const alphaRad = alpha * (Math.PI / 180);
        const betaRad = beta * (Math.PI / 180);
        const gammaRad = gamma * (Math.PI / 180);

        // Screen orientation offset
        const screenOrientation = window.orientation || 0;
        const screenOrientationRad = screenOrientation * (Math.PI / 180);

        euler.set(betaRad, alphaRad, -gammaRad, 'YXZ');
        camera.quaternion.setFromEuler(euler);
        camera.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1),
            -screenOrientationRad
        ));
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GyroManager;
}
