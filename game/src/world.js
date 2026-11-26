// The world: a low-poly mountain canyon built from one analytic height
// function. The same function displaces the terrain mesh, places the trees,
// houses and rings, and answers "how high is the ground here" for collisions,
// so what the player sees is exactly what the plane can hit.

import { COLORS, WORLD } from './config.js';
import { createRandom, intRange, lerp, range, smoothstep } from './random.js';

const THREE = window.THREE;

/** The canyon centreline: a lazy S-curve running south to north. */
export function pathX(z) {
  return 270 * Math.sin(z * 0.00105) + 130 * Math.sin(z * 0.0026 + 1.3);
}

/** Unit tangent of the centreline at z, pointing north (the direction of flight). */
export function pathTangent(z) {
  const dx = (pathX(z - 12) - pathX(z + 12)) / 24;
  const len = Math.hypot(dx, 1);
  return new THREE.Vector3(dx / len, 0, -1 / len);
}

/** Height of the canyon floor (before the mountains are blended in). */
function canyonFloor(z) {
  return 10 + 5 * Math.sin(z * 0.004 + 0.7);
}

/** The two runway pads: flat ground the height function is blended toward. */
const PADS = [
  { x: pathX(WORLD.startZ), z: WORLD.startZ, h: 12 },
  { x: pathX(WORLD.finishZ), z: WORLD.finishZ, h: 12 },
];

/** Seed phases so each seed grows a different mountain range on the same canyon. */
let PHASES = [0, 0, 0, 0, 0, 0];

/**
 * Ground height at (x, z) in metres. Layered sines make the range, the canyon
 * carve keeps a flyable channel along the centreline, and the runway pads are
 * flattened last so take-off and landing always have level ground.
 */
export function heightAt(x, z) {
  const p = PHASES;
  let h = 66
    + 58 * Math.sin(x * 0.0016 + p[0]) * Math.cos(z * 0.0012 + p[1])
    + 40 * Math.sin(x * 0.0038 - z * 0.0029 + p[2])
    + 24 * Math.sin(x * 0.0091 + p[3]) * Math.sin(z * 0.0074 + p[4])
    + 52 * Math.abs(Math.sin(x * 0.0011 + z * 0.0009 + p[5]));
  const fromPath = Math.abs(x - pathX(z));
  h = lerp(canyonFloor(z), h, smoothstep(55, 400, fromPath));
  for (const pad of PADS) {
    const d = Math.hypot(x - pad.x, z - pad.z);
    h = lerp(pad.h, h, smoothstep(70, 240, d));
  }
  return Math.max(2, h);
}

/** A canvas texture drawn by a callback: runway paint, ring numbers, signs. */
function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** The runway surface: dark asphalt, white edges, centreline dashes, threshold bars, big numbers. */
function runwayTexture(numbers) {
  return canvasTexture(256, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#33383f';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3d434c';
    for (let i = 0; i < 260; i++) ctx.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    ctx.fillStyle = '#f2f4f6';
    ctx.fillRect(8, 0, 7, h);
    ctx.fillRect(w - 15, 0, 7, h);
    for (let y = 30; y < h - 30; y += 92) ctx.fillRect(w / 2 - 4, y, 8, 52);
    for (let i = 0; i < 6; i++) ctx.fillRect(28 + i * 34, 16, 18, 64);
    ctx.font = 'bold 92px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(numbers, w / 2, h - 130);
  });
}

/** One runway: painted strip, edge lights, and a windsock pole for flavour. */
function buildRunway(numbers, pad) {
  const group = new THREE.Group();
  const top = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.runwayWidth, WORLD.runwayLength),
    new THREE.MeshStandardMaterial({ map: runwayTexture(numbers), roughness: 0.95 }),
  );
  top.rotation.x = -Math.PI / 2;
  top.rotation.z = Math.PI; // numbers face the approaching pilot
  top.position.y = 0.35;
  top.receiveShadow = true;
  group.add(top);

  const lightGeo = new THREE.SphereGeometry(0.55, 8, 6);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  const perSide = 12;
  const lights = new THREE.InstancedMesh(lightGeo, lightMat, perSide * 2);
  const m = new THREE.Matrix4();
  let n = 0;
  for (let i = 0; i < perSide; i++) {
    const z = -WORLD.runwayLength / 2 + (i + 0.5) * (WORLD.runwayLength / perSide);
    for (const side of [-1, 1]) {
      m.makeTranslation(side * (WORLD.runwayWidth / 2 + 1.6), 0.7, z);
      lights.setMatrixAt(n++, m);
    }
  }
  group.add(lights);
  group.position.set(pad.x, pad.h, pad.z);
  return group;
}

/** A floating number badge that hangs above a ring. */
function ringBadge(index) {
  const texture = canvasTexture(128, 128, (ctx) => {
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(12, 24, 38, 0.85)';
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#ffc93c';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 62px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), 64, 68);
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(11, 11, 1);
  return sprite;
}

/** Gradient sky dome: deep blue overhead melting into a pale horizon. */
function buildSky() {
  const geo = new THREE.SphereGeometry(6500, 24, 14);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(COLORS.skyTop) },
      horizon: { value: new THREE.Color(COLORS.skyHorizon) },
    },
    vertexShader: 'varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vPos;'
      + 'void main() { float t = clamp(normalize(vPos).y * 1.6 + 0.18, 0.0, 1.0);'
      + ' gl_FragColor = vec4(mix(horizon, top, pow(t, 0.72)), 1.0); }',
  });
  return new THREE.Mesh(geo, mat);
}

/** The terrain mesh: displaced plane, vertex colours by height and steepness. */
function buildTerrain() {
  const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, WORLD.segments, WORLD.segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();
  const colors = new Float32Array(pos.count * 3);
  const cLow = new THREE.Color(COLORS.grassLow);
  const cHigh = new THREE.Color(COLORS.grassHigh);
  const cRock = new THREE.Color(COLORS.rock);
  const cSnow = new THREE.Color(COLORS.snow);
  const c = new THREE.Color();
  const nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i);
    c.copy(cLow).lerp(cHigh, smoothstep(10, 70, h));
    c.lerp(cRock, smoothstep(85, 150, h));
    c.lerp(cSnow, smoothstep(185, 255, h));
    c.lerp(cRock, smoothstep(0.82, 0.55, nrm.getY(i)) * 0.75); // steep faces go rocky
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  mesh.receiveShadow = true;
  return mesh;
}

/** Low-poly clouds: instanced flattened puffs in loose clusters, drifting east. */
function buildClouds(random) {
  const puffGeo = new THREE.IcosahedronGeometry(1, 1);
  const puffMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, flatShading: true, roughness: 1, transparent: true, opacity: 0.88,
  });
  const clouds = [];
  let puffTotal = 0;
  const cloudCount = 38;
  for (let i = 0; i < cloudCount; i++) {
    const puffs = intRange(random, 3, 6);
    clouds.push({
      x: range(random, -WORLD.size / 2, WORLD.size / 2),
      y: range(random, 300, 440),
      z: range(random, -WORLD.size / 2, WORLD.size / 2),
      puffs: Array.from({ length: puffs }, () => ({
        dx: range(random, -26, 26), dy: range(random, -4, 5), dz: range(random, -12, 12),
        s: range(random, 10, 24),
      })),
    });
    puffTotal += puffs;
  }
  const mesh = new THREE.InstancedMesh(puffGeo, puffMat, puffTotal);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  function layout() {
    let n = 0;
    for (const cloud of clouds) {
      for (const puff of cloud.puffs) {
        v.set(cloud.x + puff.dx, cloud.y + puff.dy, cloud.z + puff.dz);
        s.set(puff.s, puff.s * 0.45, puff.s * 0.7);
        m.compose(v, q, s);
        mesh.setMatrixAt(n++, m);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  layout();
  return {
    mesh,
    update(dt) {
      for (const cloud of clouds) {
        cloud.x += dt * 4.5;
        if (cloud.x > WORLD.size / 2 + 80) cloud.x = -WORLD.size / 2 - 80;
      }
      layout();
    },
  };
}

/** Pines scattered on the lower slopes, clear of the canyon centre and runways. */
function buildTrees(random) {
  const trunkGeo = new THREE.CylinderGeometry(0.5, 0.8, 3.4, 5);
  const crownGeo = new THREE.ConeGeometry(3.1, 9, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, flatShading: true, roughness: 1 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x2e7d46, flatShading: true, roughness: 1 });
  const spots = [];
  let guard = 0;
  while (spots.length < 280 && guard++ < 6000) {
    const x = range(random, -WORLD.size / 2 + 60, WORLD.size / 2 - 60);
    const z = range(random, -WORLD.size / 2 + 60, WORLD.size / 2 - 60);
    const h = heightAt(x, z);
    if (h < 9 || h > 125) continue;
    if (Math.abs(x - pathX(z)) < 95) continue;
    if (PADS.some((pad) => Math.hypot(x - pad.x, z - pad.z) < 190)) continue;
    spots.push({ x, z, h, s: range(random, 0.8, 1.7), r: range(random, 0, Math.PI * 2) });
  }
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  spots.forEach((spot, i) => {
    e.set(0, spot.r, 0);
    q.setFromEuler(e);
    s.set(spot.s, spot.s, spot.s);
    v.set(spot.x, spot.h + 1.7 * spot.s, spot.z);
    m.compose(v, q, s);
    trunks.setMatrixAt(i, m);
    v.set(spot.x, spot.h + (3.4 + 4.2) * spot.s, spot.z);
    m.compose(v, q, s);
    crowns.setMatrixAt(i, m);
  });
  trunks.castShadow = true;
  crowns.castShadow = true;
  const group = new THREE.Group();
  group.add(trunks, crowns);
  return group;
}

/** A handful of little houses with pyramid roofs along the canyon banks. */
function buildHouses(random) {
  const group = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xf3e5cf, flatShading: true, roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xb34a32, flatShading: true, roughness: 0.9 });
  for (let i = 0; i < 13; i++) {
    const z = range(random, -1500, 1500);
    const side = random() < 0.5 ? -1 : 1;
    const x = pathX(z) + side * range(random, 85, 150);
    const h = heightAt(x, z);
    if (h > 60) continue;
    const house = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(9, 5.5, 7), wallMat);
    walls.position.y = 2.75;
    walls.castShadow = true;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(7.4, 4.2, 4), roofMat);
    roof.position.y = 7.6;
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1.15, 1, 0.9);
    roof.castShadow = true;
    house.add(walls, roof);
    house.position.set(x, h, z);
    house.rotation.y = range(random, 0, Math.PI * 2);
    group.add(house);
  }
  return group;
}

/** The river: a ribbon following the canyon floor, its surface rippling. */
function buildRiver() {
  const steps = 90;
  const positions = [];
  const indices = [];
  for (let i = 0; i <= steps; i++) {
    const z = -1950 + (3900 * i) / steps;
    const cx = pathX(z);
    for (const side of [-1, 1]) {
      const x = cx + side * 13;
      positions.push(x, heightAt(x, z) + 0.7, z);
    }
    if (i < steps) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const base = Float32Array.from(positions);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: COLORS.river, transparent: true, opacity: 0.78, roughness: 0.25, metalness: 0.15,
  }));
  return {
    mesh,
    update(time) {
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        pos.setY(i, base[i * 3 + 1] + Math.sin(time * 1.7 + base[i * 3 + 2] * 0.05) * 0.35);
      }
      pos.needsUpdate = true;
    },
  };
}

/** The target rings: torus hoops with state colours, a light pillar, a number badge. */
function buildRings(random, difficulty) {
  const group = new THREE.Group();
  const rings = [];
  const matTodo = new THREE.MeshStandardMaterial({
    color: COLORS.ringTodo, emissive: COLORS.ringTodo, emissiveIntensity: 0.55,
    transparent: true, opacity: 0.6, roughness: 0.4,
  });
  const matNext = new THREE.MeshStandardMaterial({
    color: COLORS.ringNext, emissive: COLORS.ringNext, emissiveIntensity: 1.1, roughness: 0.35,
  });
  const matDone = new THREE.MeshStandardMaterial({
    color: COLORS.ringDone, emissive: COLORS.ringDone, emissiveIntensity: 0.5,
    transparent: true, opacity: 0.3, roughness: 0.5,
  });
  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(difficulty.ringRadius * 0.45, difficulty.ringRadius * 0.45, 460, 20, 1, true),
    new THREE.MeshBasicMaterial({
      color: COLORS.ringNext, transparent: true, opacity: 0.09,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  group.add(pillar);

  const firstZ = 1180;
  const lastZ = -1180;
  for (let i = 0; i < difficulty.rings; i++) {
    const t = difficulty.rings === 1 ? 0 : i / (difficulty.rings - 1);
    const z = lerp(firstZ, lastZ, t);
    const x = pathX(z) + range(random, -55, 55);
    const y = Math.min(WORLD.ceiling - 60, heightAt(x, z) + range(random, 52, 95));
    const centre = new THREE.Vector3(x, y, z);
    const normal = pathTangent(z);
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(difficulty.ringRadius, 0.85, 10, 42), matTodo);
    hoop.position.copy(centre);
    hoop.lookAt(centre.clone().add(normal));
    hoop.castShadow = true;
    const badge = ringBadge(i);
    badge.position.copy(centre).y += difficulty.ringRadius + 8;
    group.add(hoop, badge);
    rings.push({ centre, normal, radius: difficulty.ringRadius, hoop, badge, passed: false });
  }

  function setStates(currentIndex) {
    rings.forEach((ring, i) => {
      ring.hoop.material = ring.passed ? matDone : i === currentIndex ? matNext : matTodo;
    });
    const current = rings[currentIndex];
    pillar.visible = Boolean(current);
    if (current) pillar.position.set(current.centre.x, current.centre.y, current.centre.z);
  }
  setStates(0);

  return {
    group,
    rings,
    setStates,
    update(time, currentIndex) {
      const current = rings[currentIndex];
      if (current) {
        const pulse = 1 + Math.sin(time * 3.2) * 0.045;
        current.hoop.scale.setScalar(pulse);
        matNext.emissiveIntensity = 1.05 + Math.sin(time * 3.2) * 0.35;
      }
      pillar.material.opacity = 0.075 + Math.sin(time * 2.1) * 0.025;
      for (const ring of rings) ring.hoop.rotation.z += 0.0006;
    },
  };
}

/**
 * Build the whole world for a seed and difficulty.
 * Returns the scene group plus the handles the game loop drives each frame.
 */
export function buildWorld(scene, seed, difficulty) {
  const random = createRandom(seed * 7919 + 13);
  PHASES = Array.from({ length: 6 }, () => range(random, 0, Math.PI * 2));

  scene.fog = new THREE.Fog(COLORS.fog, WORLD.fogNear, WORLD.fogFar);
  scene.add(buildSky());

  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5d7a4a, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(COLORS.sun, 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -260;
  sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260;
  sun.shadow.camera.bottom = -260;
  sun.shadow.camera.near = 40;
  sun.shadow.camera.far = 1400;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const sunDir = new THREE.Vector3(0.55, 0.9, 0.35).normalize();

  const group = new THREE.Group();
  group.add(buildTerrain());
  group.add(buildRunway('27', PADS[0]));
  group.add(buildRunway('09', PADS[1]));
  const clouds = buildClouds(random);
  group.add(clouds.mesh);
  group.add(buildTrees(random));
  group.add(buildHouses(random));
  const river = buildRiver();
  group.add(river.mesh);
  const rings = buildRings(random, difficulty);
  group.add(rings.group);
  scene.add(group);

  return {
    group,
    rings: rings.rings,
    setRingStates: rings.setStates,
    startPad: PADS[0],
    finishPad: PADS[1],
    update(dt, time, focus, currentRing) {
      clouds.update(dt);
      river.update(time);
      rings.update(time, currentRing);
      // The shadow camera rides with the plane so shadows stay crisp nearby.
      const snapped = focus.clone();
      snapped.x = Math.round(snapped.x / 4) * 4;
      snapped.z = Math.round(snapped.z / 4) * 4;
      sun.position.copy(snapped).addScaledVector(sunDir, 620);
      sun.target.position.copy(snapped);
    },
  };
}
