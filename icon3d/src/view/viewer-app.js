import { loadThree, THREE_VERSION } from '../core/three-loader.js';
import { buildIcon } from '../model/icon-mesh.js';
import { buildRibbon } from '../model/ribbon.js';
import { exportSVG, downloadSVG } from '../model/export-svg.js';
import { runGate, runBakeCheck } from '../model/gate.js';
import { exportGLB, downloadGLB, buildExportScene } from '../model/export.js';
import { createStudio } from './studio.js';
import { createOrbit } from './orbit.js';
import { createQrOverlay } from '../ui/qr-overlay.js';
import { getIcon, ICONS, DEFAULT_ICON } from '../icons/index.js';

const DEG = Math.PI / 180;

function requestedIconIds(params) {
    const raw = params.get('icons') || params.get('icon') || DEFAULT_ICON;
    return [...new Set(raw.split(',').map((id) => id.trim()).filter((id) => ICONS[id]))].slice(0, 3);
}

export async function bootViewer() {
    const params = new URLSearchParams(location.search);
    let iconIds = requestedIconIds(params);
    if (!iconIds.length) iconIds = [DEFAULT_ICON];

    const fatalEl = document.querySelector('[data-fatal]');
    const toastEl = document.querySelector('[data-toast]');
    let toastTimer = 0;
    const fatal = (err) => {
        fatalEl.textContent = 'These icons could not be extruded. ' + (err?.message || err);
        fatalEl.classList.add('on');
        console.error(err);
    };
    const toast = (message, ms = 2200) => {
        toastEl.textContent = message;
        toastEl.classList.add('on');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('on'), ms);
    };

    const productionQuery = new URLSearchParams();
    productionQuery.set('icons', iconIds.join(','));
    createQrOverlay({
        url: `https://birbmobile.vercel.app/svg/view?${productionQuery}`,
        label: 'birbmobile.vercel.app/svg/view',
        kicker: 'Scan to view',
    });

    try {
        const THREE = await loadThree();
        const canvas = document.getElementById('scene');
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.NeutralToneMapping;
        renderer.toneMappingExposure = 1;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 120);
        const ICON_SIZE = iconIds.length === 1 ? 2 : 1.8;
        const showTile = params.get('tile') !== '0';
        let mode = params.get('mode') === 'clay' ? 'clay' : 'colour';
        let singleBuilder = params.get('build') === 'plates' ? 'plates' : 'ribbon';
        let builtItems = [];
        let compositionWidth = 2;
        let compositionHeight = 2;
        let compositionDepth = 0.4;

        const builderFor = (id) => {
            if (iconIds.length === 1 && id === 'copilot-2023') return singleBuilder === 'plates' ? buildIcon : buildRibbon;
            return getIcon(id).defaultBuilder === 'ribbon' ? buildRibbon : buildIcon;
        };

        function buildComposition() {
            builtItems = iconIds.map((id) => {
                const icon = getIcon(id);
                const built = builderFor(id)(THREE, icon, { size: ICON_SIZE });
                built.setMode(mode);
                scene.add(built.group);
                return { id, icon, built, builder: builderFor(id) === buildRibbon ? 'ribbon' : 'plates' };
            });
            const gap = iconIds.length > 1 ? 0.48 : 0;
            compositionWidth = builtItems.reduce((sum, item) => sum + item.built.width, 0) + gap * (builtItems.length - 1);
            compositionHeight = Math.max(...builtItems.map((item) => item.built.height));
            compositionDepth = Math.max(...builtItems.map((item) => item.built.depthExtent[1] - item.built.depthExtent[0]));
            let x = -compositionWidth / 2;
            for (const item of builtItems) {
                item.built.group.position.x = x + item.built.width / 2;
                x += item.built.width + gap;
            }
        }

        buildComposition();
        const widestIcon = Math.max(...builtItems.map((item) => item.built.width));
        const studio = createStudio(THREE, renderer, scene, compositionWidth, {
            tile: showTile,
            tileScale: iconIds.length === 1 ? 1.5 : 1.18,
            tileDepth: widestIcon * 1.65,
        });
        scene.fog = new THREE.Fog(scene.background, 9, 40);

        const narrow = () => innerWidth / innerHeight < 0.75;
        const orbit = createOrbit(camera, canvas, {
            yaw: 30 * DEG,
            pitch: 15 * DEG,
            targetY: compositionHeight * 0.5,
            distance: 5,
            minDistance: 1.4,
            maxDistance: 24,
            minPitch: -3 * DEG,
            maxPitch: 75 * DEG,
            minTargetY: 0.1,
            maxTargetY: 3,
            panRadius: Math.max(2.5, compositionWidth * 0.62),
            idleSpin: params.get('spin') === '0' || matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.10,
            idleDelay: 2.5,
        });

        function fitDistance() {
            const v = camera.fov * DEG;
            const h = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
            const fitWidth = compositionWidth * 0.55 / Math.tan(h / 2);
            const fitHeight = compositionHeight * 0.58 / Math.tan(v / 2);
            return Math.max(fitWidth, fitHeight) * 1.12 + compositionDepth;
        }
        const targetHeight = () => compositionHeight * (narrow() ? 0.42 : 0.5);
        let userZoomed = false;
        function resize() {
            const w = innerWidth, h = innerHeight;
            renderer.setSize(w, h, false);
            camera.fov = narrow() ? 48 : 36;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            if (!userZoomed) {
                orbit.setView(orbit.yaw, orbit.pitch, fitDistance(), true);
                orbit.targetY = targetHeight();
            }
            orbit.invalidate();
        }
        addEventListener('resize', resize);
        resize();
        canvas.addEventListener('wheel', () => { userZoomed = true; }, { passive: true });
        canvas.addEventListener('pointerdown', (event) => { if (event.isPrimary === false) userZoomed = true; });

        const pills = document.querySelector('[data-pills]');
        const back = document.querySelector('[data-back]');
        back.href = `/svg?selected=${encodeURIComponent(iconIds.join(','))}`;
        const markOn = (attr, value) => {
            pills.querySelectorAll(`[${attr}]`).forEach((button) => button.classList.toggle('on', button.getAttribute(attr) === value));
        };
        function updateControls() {
            const one = iconIds.length === 1;
            const copilot = one && iconIds[0].startsWith('copilot-');
            const ribbonCapable = one && iconIds[0] === 'copilot-2023';
            document.querySelector('[data-build-group]').hidden = !ribbonCapable;
            document.querySelector('[data-variant-group]').hidden = !copilot;
            document.querySelectorAll('[data-export]').forEach((button) => {
                button.disabled = !one;
                button.title = one ? button.dataset.singleTitle : 'Open one icon to export it';
            });
            markOn('data-mode', mode);
            markOn('data-icon', iconIds[0]);
            markOn('data-build', singleBuilder);
        }
        function setMode(next) {
            mode = next === 'clay' ? 'clay' : 'colour';
            builtItems.forEach(({ built }) => built.setMode(mode));
            markOn('data-mode', mode);
            orbit.invalidate();
        }
        function rebuild() {
            for (const { built } of builtItems) {
                scene.remove(built.group);
                built.dispose();
            }
            buildComposition();
            orbit.targetY = targetHeight();
            userZoomed = false;
            resize();
            updateControls();
        }
        function setIcon(id) {
            if (!ICONS[id]) return;
            iconIds = [id];
            singleBuilder = id === 'copilot-2023' ? singleBuilder : 'plates';
            rebuild();
        }
        function setIcons(ids) {
            const valid = [...new Set(ids)].filter((id) => ICONS[id]).slice(0, 3);
            if (!valid.length) return;
            iconIds = valid;
            rebuild();
        }
        function setBuilder(id) {
            if (iconIds.length !== 1 || iconIds[0] !== 'copilot-2023') return;
            singleBuilder = id === 'plates' ? 'plates' : 'ribbon';
            rebuild();
        }

        pills.addEventListener('click', async (event) => {
            const button = event.target.closest('button');
            if (!button) return;
            if (button.dataset.mode) setMode(button.dataset.mode);
            else if (button.dataset.icon) setIcon(button.dataset.icon);
            else if (button.dataset.build) setBuilder(button.dataset.build);
            else if (button.dataset.export) {
                if (builtItems.length !== 1) return;
                const { id, icon, built, builder } = builtItems[0];
                if (button.dataset.export === 'glb') {
                    button.disabled = true;
                    toast('Baking…', 6000);
                    try {
                        const bytes = await exportGLB(THREE, THREE_VERSION, built, { tile: studio.tile });
                        downloadGLB(bytes, `${id}-${builder}.glb`);
                        toast(`${id}-${builder}.glb · ${(bytes.byteLength / 1024).toFixed(0)} KB`);
                    } catch (err) {
                        console.warn('GLB export failed', err);
                        toast('GLB export needs the CDN — try again online');
                    } finally {
                        button.disabled = false;
                    }
                } else {
                    const { svg, stats } = exportSVG(built, icon, {
                        yaw: orbit.yaw / DEG, pitch: orbit.pitch / DEG, size: 1024,
                    });
                    downloadSVG(svg, `${id}-${builder}.svg`);
                    toast(`${id}-${builder}.svg · ${stats.pieces} shapes · ${(stats.bytes / 1024).toFixed(0)} KB`);
                }
            }
        });
        updateControls();

        const hint = document.querySelector('[data-hint]');
        let touched = false;
        canvas.addEventListener('pointerdown', () => {
            if (touched) return;
            touched = true;
            setTimeout(() => hint.classList.add('gone'), 900);
        });
        document.querySelector('[data-loading]').classList.add('gone');

        let last = performance.now();
        let frames = 0, fpsAccum = 0, fps = 60;
        function stats() {
            return {
                drawCalls: renderer.info.render.calls,
                triangles: renderer.info.render.triangles,
                fps: Math.round(fps),
                icons: iconIds.slice(),
                icon: iconIds.length === 1 ? iconIds[0] : null,
                build: builtItems.length === 1 ? builtItems[0].builder : 'mixed',
                mode,
                pieces: builtItems.reduce((sum, item) => sum + item.built.pieces.length, 0),
                composition: [compositionWidth, compositionHeight],
                yaw: Math.round(orbit.yaw / DEG),
                pitch: Math.round(orbit.pitch / DEG),
                distance: Math.round(orbit.distance * 100) / 100,
            };
        }
        function frame(now) {
            const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
            last = now;
            fpsAccum += dt; frames++;
            if (fpsAccum >= 0.5) { fps = frames / fpsAccum; frames = 0; fpsAccum = 0; }
            if (orbit.update(dt)) {
                renderer.render(scene, camera);
                document.documentElement.dataset.icon3dCamera = JSON.stringify(stats());
            }
            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);

        const requireSingle = () => {
            if (builtItems.length !== 1) throw new Error('This diagnostic is available for a single icon view');
            return builtItems[0];
        };
        window.__ICON3D = {
            THREE, renderer, scene, camera, orbit, studio,
            get icon() { return builtItems[0].built; },
            get icons() { return builtItems.map((item) => item.built); },
            setMode, setIcon, setIcons, setBuilder,
            exportSVG(options = {}) {
                const { icon, built } = requireSingle();
                return exportSVG(built, icon, { yaw: orbit.yaw / DEG, pitch: orbit.pitch / DEG, size: 1024, ...options });
            },
            setView(yawDeg, pitchDeg, distance) {
                userZoomed = true;
                orbit.setView(yawDeg * DEG, pitchDeg * DEG, distance ?? orbit.distance, true);
                orbit.update(0);
                renderer.render(scene, camera);
            },
            gate(px = 512) {
                const { icon, built } = requireSingle();
                const result = runGate(THREE, renderer, icon, built, px);
                result.bake = runBakeCheck(THREE, renderer, built, px);
                orbit.invalidate();
                renderer.render(scene, camera);
                return result;
            },
            async exportGLB() {
                const { built } = requireSingle();
                const bytes = await exportGLB(THREE, THREE_VERSION, built, { tile: studio.tile });
                return { bytes: bytes.byteLength, magic: String.fromCharCode(...new Uint8Array(bytes, 0, 4)) };
            },
            bake(px = 128) {
                const { built } = requireSingle();
                const { scene: baked, textures } = buildExportScene(THREE, built, { px, tile: studio.tile });
                let meshes = 0;
                baked.traverse((object) => { if (object.isMesh) meshes++; });
                const sizes = textures.map((texture) => [texture.image.width, texture.image.height]);
                textures.forEach((texture) => texture.dispose());
                return { meshes, textures: sizes };
            },
        };
        window.__ICON3D_STATS = stats;
        document.documentElement.dataset.icon3dCamera = JSON.stringify(stats());
        window.__ICON3D_READY = true;
    } catch (err) {
        fatal(err);
    }
}

bootViewer();
