// Live 3D previews for the plane-select cards: one small shared WebGL
// renderer draws each plane model (slow turntable, studio lights, ground
// shadow) and blits the frame into the card's 2D canvas. If WebGL is
// unavailable the caller falls back to the old 2D sketch, so the menu
// never breaks. Rendering only runs while the plane-select screen shows.

import { buildPlaneModel } from './plane.js';

const THREE = window.THREE;

const W = 480;
const H = 236;

export function createPlanePreviews() {
  let renderer = null;
  let scene = null;
  let camera = null;
  let raf = 0;
  let lastT = 0;
  const entries = new Map(); // key -> { ctx2d, model, holder }

  function init() {
    if (renderer) return true;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch (err) {
      return false;
    }
    renderer.setSize(W, H);
    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(34, W / H, 0.5, 120);
    camera.position.set(8.6, 3.9, 9.6);
    camera.lookAt(0, 0.6, 0);
    // Gradient sky environment so the clearcoat paint has something to
    // reflect (same trick as the main scene, miniature version).
    const envCanvas = document.createElement('canvas');
    envCanvas.width = 64;
    envCanvas.height = 32;
    const ectx = envCanvas.getContext('2d');
    const grad = ectx.createLinearGradient(0, 0, 0, 32);
    grad.addColorStop(0, '#7fb2e8');
    grad.addColorStop(0.55, '#cfe4f7');
    grad.addColorStop(0.62, '#8a97a3');
    grad.addColorStop(1, '#4c545e');
    ectx.fillStyle = grad;
    ectx.fillRect(0, 0, 64, 32);
    const envTex = new THREE.CanvasTexture(envCanvas);
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    envTex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(envTex).texture;
    envTex.dispose();
    pmrem.dispose();
    // Studio three-point rig: warm key with shadows, cool fill, rim.
    const key = new THREE.DirectionalLight(0xffe3b3, 3.0);
    key.position.set(6, 10, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    key.shadow.camera.left = -9;
    key.shadow.camera.right = 9;
    key.shadow.camera.top = 9;
    key.shadow.camera.bottom = -9;
    key.shadow.camera.near = 2;
    key.shadow.camera.far = 40;
    key.shadow.bias = -0.0005;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fc4ff, 0.9);
    fill.position.set(-8, 3, -6);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.4);
    rim.position.set(-3, 5, -10);
    scene.add(rim);
    scene.add(new THREE.HemisphereLight(0xbdd8ff, 0x3a4149, 0.7));
    // Ground disc that only catches the shadow (card gradient shows through).
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(9.5, 40),
      new THREE.ShadowMaterial({ opacity: 0.32 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    return true;
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
    lastT = t;
    for (const entry of entries.values()) {
      // All holders share the stage at the origin: show one at a time.
      entry.holder.visible = true;
      entry.holder.rotation.y += dt * 0.55;
      if (entry.model.prop) entry.model.prop.rotation.z += dt * 2.4;
      renderer.render(scene, camera);
      entry.ctx2d.clearRect(0, 0, W, H);
      entry.ctx2d.drawImage(renderer.domElement, 0, 0);
      entry.holder.visible = false;
    }
  }

  return {
    /** True when the shared renderer could be created. */
    get available() {
      return init();
    },

    /** Register a card canvas for a plane definition (built once, cached). */
    attach(key, canvas, planeDef) {
      if (!init()) return false;
      if (entries.has(key)) {
        entries.get(key).ctx2d = canvas.getContext('2d');
        return true;
      }
      const model = buildPlaneModel(planeDef);
      const holder = new THREE.Group();
      model.group.position.y = 2.03; // wheels (y=-2.03) rest on the disc
      holder.add(model.group);
      holder.visible = false;
      scene.add(holder);
      entries.set(key, { ctx2d: canvas.getContext('2d'), model, holder });
      return true;
    },

    /** Start the turntable loop (plane-select screen visible). */
    start() {
      if (!renderer || raf) return;
      lastT = performance.now();
      raf = requestAnimationFrame(frame);
    },

    /** Stop rendering and hide the models (any other screen). */
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      for (const entry of entries.values()) entry.holder.visible = false;
    },
  };
}
