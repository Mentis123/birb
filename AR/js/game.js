/**
 * Game logic utilities for AR Shooter
 */

class GameController {
    constructor() {
        this.score = 0;
        this.highScore = this.loadHighScore();
        this.shotsFired = 0;
        this.hits = 0;
        this.startTime = null;
        this.gameTime = 0;
    }

    start() {
        this.score = 0;
        this.shotsFired = 0;
        this.hits = 0;
        this.startTime = Date.now();
        this.gameTime = 0;
    }

    addScore(points) {
        this.score += points;
        if (this.score > this.highScore) {
            this.highScore = this.score;
            this.saveHighScore();
        }
        return this.score;
    }

    recordShot(hit) {
        this.shotsFired++;
        if (hit) {
            this.hits++;
        }
    }

    getAccuracy() {
        if (this.shotsFired === 0) return 0;
        return Math.round((this.hits / this.shotsFired) * 100);
    }

    getGameTime() {
        if (!this.startTime) return 0;
        return Math.floor((Date.now() - this.startTime) / 1000);
    }

    getStats() {
        return {
            score: this.score,
            highScore: this.highScore,
            shotsFired: this.shotsFired,
            hits: this.hits,
            accuracy: this.getAccuracy(),
            gameTime: this.getGameTime()
        };
    }

    saveHighScore() {
        try {
            localStorage.setItem('arShooterHighScore', this.highScore.toString());
        } catch (e) {
            console.warn('Could not save high score:', e);
        }
    }

    loadHighScore() {
        try {
            const saved = localStorage.getItem('arShooterHighScore');
            return saved ? parseInt(saved, 10) : 0;
        } catch (e) {
            return 0;
        }
    }

    reset() {
        this.score = 0;
        this.shotsFired = 0;
        this.hits = 0;
        this.startTime = null;
        this.gameTime = 0;
    }
}

// Particle effect for hits
class ParticleEffect {
    static createHitEffect(scene, position, color = 0x4CAF50) {
        const particles = [];
        const particleCount = 10;

        const geometry = new THREE.SphereGeometry(0.02, 4, 4);
        const material = new THREE.MeshBasicMaterial({ color });

        for (let i = 0; i < particleCount; i++) {
            const particle = new THREE.Mesh(geometry, material);
            particle.position.copy(position);

            // Random velocity
            particle.userData = {
                velocity: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.1,
                    (Math.random() - 0.5) * 0.1,
                    (Math.random() - 0.5) * 0.1
                ),
                life: 1.0,
                decay: 0.02
            };

            scene.add(particle);
            particles.push(particle);
        }

        return particles;
    }

    static updateParticles(particles, scene) {
        for (let i = particles.length - 1; i >= 0; i--) {
            const particle = particles[i];
            const data = particle.userData;

            // Update position
            particle.position.add(data.velocity);

            // Apply gravity
            data.velocity.y -= 0.005;

            // Decay
            data.life -= data.decay;
            particle.material.opacity = data.life;

            // Remove if dead
            if (data.life <= 0) {
                scene.remove(particle);
                particle.geometry.dispose();
                particle.material.dispose();
                particles.splice(i, 1);
            }
        }
    }
}

// Sound effects (using Web Audio API)
class SoundManager {
    constructor() {
        this.audioContext = null;
        this.enabled = true;
        this.init();
    }

    init() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
        } catch (e) {
            console.warn('Web Audio API not supported:', e);
            this.enabled = false;
        }
    }

    playShoot() {
        if (!this.enabled || !this.audioContext) return;

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.frequency.value = 800;
        oscillator.type = 'square';

        gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);

        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + 0.1);
    }

    playHit() {
        if (!this.enabled || !this.audioContext) return;

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.frequency.value = 1200;
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0.4, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.2);

        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + 0.2);
    }

    playMiss() {
        if (!this.enabled || !this.audioContext) return;

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.frequency.value = 200;
        oscillator.type = 'sawtooth';

        gainNode.gain.setValueAtTime(0.2, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.15);

        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + 0.15);
    }

    toggle() {
        this.enabled = !this.enabled;
        return this.enabled;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GameController, ParticleEffect, SoundManager };
}
