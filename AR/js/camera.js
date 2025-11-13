/**
 * Camera utilities for AR Shooter
 */

class CameraManager {
    constructor() {
        this.stream = null;
        this.currentFacingMode = 'environment';
        this.videoElement = null;
    }

    async requestPermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            stream.getTracks().forEach(track => track.stop());
            return true;
        } catch (error) {
            console.error('Camera permission denied:', error);
            return false;
        }
    }

    async start(videoElement, facingMode = 'environment') {
        this.videoElement = videoElement;
        this.currentFacingMode = facingMode;

        if (this.stream) {
            this.stop();
        }

        const constraints = {
            video: {
                facingMode: facingMode,
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: false
        };

        try {
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            videoElement.srcObject = this.stream;
            return { success: true, stream: this.stream };
        } catch (error) {
            // Fallback: try without facingMode
            try {
                this.stream = await navigator.mediaDevices.getUserMedia({ video: true });
                videoElement.srcObject = this.stream;
                return { success: true, stream: this.stream, fallback: true };
            } catch (fallbackError) {
                return { success: false, error: fallbackError };
            }
        }
    }

    stop() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
    }

    async switchCamera() {
        const newFacingMode = this.currentFacingMode === 'environment' ? 'user' : 'environment';
        if (this.videoElement) {
            return await this.start(this.videoElement, newFacingMode);
        }
        return { success: false, error: 'No video element' };
    }

    getVideoSettings() {
        if (this.stream) {
            const videoTrack = this.stream.getVideoTracks()[0];
            return videoTrack.getSettings();
        }
        return null;
    }

    static isSupported() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }

    static isSecure() {
        return window.location.protocol === 'https:' || window.location.hostname === 'localhost';
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CameraManager;
}
