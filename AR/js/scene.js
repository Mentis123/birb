/**
 * Scene management utilities for AR Shooter
 */

class SceneManager {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.targets = [];
        this.isAnimating = false;
    }

    init() {
        // Scene
        this.scene = new THREE.Scene();

        // Camera - typical AR FOV
        this.camera = new THREE.PerspectiveCamera(
            70,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 0, 0);

        // Renderer with alpha for transparent background
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            alpha: true,
            antialias: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 10, 5);
        this.scene.add(directionalLight);

        // Handle resize
        window.addEventListener('resize', () => this.onResize());

        return this;
    }

    onResize() {
        if (this.camera && this.renderer) {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        }
    }

    createTarget(position) {
        const geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);

        const color = new THREE.Color();
        color.setHSL(Math.random(), 0.7, 0.6);

        const material = new THREE.MeshPhongMaterial({
            color: color,
            shininess: 80
        });

        const cube = new THREE.Mesh(geometry, material);
        cube.position.copy(position);

        // Random rotation
        cube.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI
        );

        // Animation data
        cube.userData = {
            initialPos: cube.position.clone(),
            floatOffset: Math.random() * Math.PI * 2,
            floatSpeed: 0.5 + Math.random() * 0.5,
            rotSpeed: {
                x: (Math.random() - 0.5) * 0.02,
                y: (Math.random() - 0.5) * 0.02,
                z: (Math.random() - 0.5) * 0.02
            }
        };

        // Add edges
        const edges = new THREE.EdgesGeometry(geometry);
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
        const wireframe = new THREE.LineSegments(edges, lineMaterial);
        cube.add(wireframe);

        this.scene.add(cube);
        this.targets.push(cube);

        return cube;
    }

    spawnTargets(count = 8) {
        for (let i = 0; i < count; i++) {
            const distance = 2 + Math.random() * 3;
            const angleH = (Math.random() - 0.5) * Math.PI * 0.8;
            const angleV = (Math.random() - 0.5) * Math.PI * 0.6;

            const position = new THREE.Vector3(
                Math.sin(angleH) * Math.cos(angleV) * distance,
                Math.sin(angleV) * distance,
                -Math.cos(angleH) * Math.cos(angleV) * distance
            );

            this.createTarget(position);
        }
    }

    removeTarget(target) {
        const index = this.targets.indexOf(target);
        if (index > -1) {
            this.targets.splice(index, 1);
            this.scene.remove(target);
            // Clean up geometry and material
            target.geometry.dispose();
            target.material.dispose();
        }
    }

    updateTargets(time) {
        this.targets.forEach(target => {
            const offset = target.userData.floatOffset;
            const speed = target.userData.floatSpeed;
            const floatAmount = Math.sin(time * speed + offset) * 0.1;

            target.position.y = target.userData.initialPos.y + floatAmount;

            target.rotation.x += target.userData.rotSpeed.x;
            target.rotation.y += target.userData.rotSpeed.y;
            target.rotation.z += target.userData.rotSpeed.z;
        });
    }

    render() {
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    startAnimation(updateCallback) {
        this.isAnimating = true;

        const animate = (currentTime) => {
            if (!this.isAnimating) return;

            requestAnimationFrame(animate);

            const time = currentTime * 0.001;
            this.updateTargets(time);

            if (updateCallback) {
                updateCallback(time, currentTime);
            }

            this.render();
        };

        animate(0);
    }

    stopAnimation() {
        this.isAnimating = false;
    }

    // Raycasting for hit detection
    raycast(origin = this.camera.position, direction = new THREE.Vector3(0, 0, -1)) {
        const raycaster = new THREE.Raycaster();

        // Transform direction by camera rotation
        direction.applyQuaternion(this.camera.quaternion);
        raycaster.set(origin, direction);

        const intersects = raycaster.intersectObjects(this.targets);
        return intersects.length > 0 ? intersects[0] : null;
    }

    cleanup() {
        this.stopAnimation();

        // Remove all targets
        this.targets.forEach(target => {
            this.scene.remove(target);
            target.geometry.dispose();
            target.material.dispose();
        });
        this.targets = [];

        // Dispose renderer
        if (this.renderer) {
            this.renderer.dispose();
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SceneManager;
}
