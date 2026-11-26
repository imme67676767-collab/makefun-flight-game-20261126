// Random weather events: thunderstorm, gust front, heavy rain, tornado.
//
// One event runs at a time. This module owns the visuals (rain streaks,
// lightning bolts, the tornado funnel) and reports the flight effects each
// frame — wind push, tornado pull, turbulence, slippery controls, fog —
// while the game decides when events start and what they cost. Callbacks
// report lightning (for the thunderclap) and direct strikes (for damage).

import { QUALITY, WEATHER } from './config.js';
import { range } from './random.js';

const THREE = window.THREE;

function streakTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(190,220,245,0)');
  g.addColorStop(0.5, 'rgba(190,220,245,0.85)');
  g.addColorStop(1, 'rgba(190,220,245,0)');
  ctx.fillStyle = g;
  ctx.fillRect(6, 0, 4, 64);
  return new THREE.CanvasTexture(canvas);
}

function swirlTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    const y = Math.random() * 256;
    const len = 40 + Math.random() * 120;
    const x = Math.random() * 256;
    ctx.fillStyle = `rgba(210,218,228,${0.12 + Math.random() * 0.3})`;
    ctx.fillRect(x, y, len, 3 + Math.random() * 5);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 3);
  return tex;
}

export function createWeather(scene, qualityKey = 'high', callbacks = {}) {
  const quality = QUALITY[qualityKey] || QUALITY.high;

  // --- rain: a box of streaks that follows the plane ---
  const dropCount = quality.rainDrops;
  const dropPos = new Float32Array(dropCount * 3);
  const BOX = { x: 300, y: 180, z: 300 };
  for (let i = 0; i < dropCount; i++) {
    dropPos[i * 3] = (Math.random() - 0.5) * BOX.x;
    dropPos[i * 3 + 1] = (Math.random() - 0.5) * BOX.y;
    dropPos[i * 3 + 2] = (Math.random() - 0.5) * BOX.z;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(dropPos, 3).setUsage(THREE.DynamicDrawUsage));
  const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({
    size: 2.4, map: streakTexture(), transparent: true, opacity: 0.55,
    color: 0xcfe4f7, depthWrite: false, sizeAttenuation: true,
  }));
  rain.frustumCulled = false;
  rain.visible = false;
  scene.add(rain);

  // --- tornado: stacked swirling funnel + orbiting debris ---
  const tornado = new THREE.Group();
  const funnelMat = new THREE.MeshBasicMaterial({
    map: swirlTexture(), transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
  });
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(30, 6, 200, 20, 6, true), funnelMat);
  funnel.position.y = 100;
  tornado.add(funnel);
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(16, 3, 200, 14, 4, true),
    new THREE.MeshBasicMaterial({ color: 0x9aa7b5, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
  );
  core.position.y = 100;
  tornado.add(core);
  const debrisCount = 260;
  const debrisPos = new Float32Array(debrisCount * 3);
  const debrisData = [];
  for (let i = 0; i < debrisCount; i++) {
    debrisData.push({ angle: Math.random() * Math.PI * 2, h: Math.random(), speed: 1.6 + Math.random() * 2.4 });
  }
  const debrisGeo = new THREE.BufferGeometry();
  debrisGeo.setAttribute('position', new THREE.BufferAttribute(debrisPos, 3).setUsage(THREE.DynamicDrawUsage));
  const debris = new THREE.Points(debrisGeo, new THREE.PointsMaterial({
    size: 1.7, color: 0x8a7a63, transparent: true, opacity: 0.8, depthWrite: false,
  }));
  debris.frustumCulled = false;
  tornado.add(debris);
  tornado.visible = false;
  scene.add(tornado);

  // --- lightning bolt: a jagged line, flashed briefly ---
  const boltGeo = new THREE.BufferGeometry();
  const boltPos = new Float32Array(9 * 3);
  boltGeo.setAttribute('position', new THREE.BufferAttribute(boltPos, 3).setUsage(THREE.DynamicDrawUsage));
  const bolt = new THREE.Line(boltGeo, new THREE.LineBasicMaterial({ color: 0xeaf4ff, transparent: true, opacity: 0.95 }));
  bolt.frustumCulled = false;
  bolt.visible = false;
  scene.add(bolt);
  let boltUntil = 0;

  let kind = null;          // 'storm' | 'gust' | 'rain' | 'tornado' | null
  let endsAt = 0;
  let nextBoltAt = 0;
  const tornadoPos = new THREE.Vector3();
  const gustDir = new THREE.Vector3(1, 0, 0);

  function strikeBolt(focus, groundY) {
    const bx = focus.x + (Math.random() - 0.5) * 700;
    const bz = focus.z + (Math.random() - 0.5) * 700;
    const topY = focus.y + 260 + Math.random() * 120;
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      boltPos[i * 3] = bx + (Math.random() - 0.5) * 26 * (1 - t * 0.5);
      boltPos[i * 3 + 1] = topY + (groundY - topY) * t;
      boltPos[i * 3 + 2] = bz + (Math.random() - 0.5) * 26 * (1 - t * 0.5);
    }
    boltGeo.attributes.position.needsUpdate = true;
    bolt.visible = true;
    boltUntil = performance.now() / 1000 + 0.12;
    const dist = Math.hypot(bx - focus.x, bz - focus.z);
    if (callbacks.onLightning) callbacks.onLightning(Math.max(0, 1 - dist / 800));
    // A close bolt can find the plane.
    if (dist < 260 && Math.random() < 0.16 && callbacks.onStrike) callbacks.onStrike();
  }

  return {
    get kind() { return kind; },
    get active() { return kind !== null; },
    get tornadoPos() { return tornadoPos; },

    /** Start an event; tornado placement and gust direction use the plane. */
    start(nextKind, time, planePos, heightAtFn) {
      kind = nextKind;
      endsAt = time + range(Math.random, WEATHER.minSeconds, WEATHER.maxSeconds);
      nextBoltAt = time + 1;
      rain.visible = kind === 'rain' || kind === 'storm';
      tornado.visible = kind === 'tornado';
      if (kind === 'tornado') {
        // Park it near the course ahead of the plane, wandering slowly.
        tornadoPos.set(planePos.x + (Math.random() - 0.5) * 160, 0, planePos.z - 420);
        tornadoPos.y = heightAtFn(tornadoPos.x, tornadoPos.z);
        tornado.position.copy(tornadoPos);
      }
      if (kind === 'gust') {
        const a = Math.random() * Math.PI * 2;
        gustDir.set(Math.cos(a), 0, Math.sin(a));
      }
    },

    stop() {
      kind = null;
      rain.visible = false;
      tornado.visible = false;
      bolt.visible = false;
    },

    /** */
    dispose() {
      this.stop();
      for (const obj of [rain, tornado, bolt]) {
        scene.remove(obj);
        obj.traverse((node) => {
          if (node.geometry) node.geometry.dispose();
          if (node.material) {
            for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
              if (mat.map) mat.map.dispose();
              mat.dispose();
            }
          }
        });
      }
    },

    /** */
    update(dt, time, plane, heightAtFn) {
      const fx = {
        windX: 0, windZ: 0, pullX: 0, pullZ: 0,
        turbulence: 0, lagScale: 1, fogFar: null, stormFactor: 0,
        tornadoDist: Infinity, gustStrength: 0,
      };
      if (!kind) return fx;
      if (time >= endsAt) {
        this.stop();
        if (callbacks.onEnd) callbacks.onEnd();
        return fx;
      }
      const remaining = endsAt - time;
      const fade = Math.min(1, remaining / 2.5);

      if (kind === 'storm') {
        fx.stormFactor = fade;
        fx.turbulence = WEATHER.stormTurbulence * fade;
        fx.fogFar = 2400;
        if (time >= nextBoltAt) {
          nextBoltAt = time + 1.8 + Math.random() * 2.8;
          strikeBolt(plane.pos, heightAtFn(plane.pos.x, plane.pos.z));
        }
      } else if (kind === 'gust') {
        const pulse = (0.55 + 0.45 * Math.sin(time * 0.9)) * fade;
        fx.windX = gustDir.x * WEATHER.gustStrength * pulse;
        fx.windZ = gustDir.z * WEATHER.gustStrength * pulse;
        fx.gustStrength = Math.hypot(fx.windX, fx.windZ);
        fx.turbulence = 0.18 * fade;
      } else if (kind === 'rain') {
        fx.fogFar = WEATHER.rainFogFar;
        fx.lagScale = 1.7;
        fx.turbulence = 0.1 * fade;
        fx.stormFactor = 0.35 * fade;
      } else if (kind === 'tornado') {
        fx.stormFactor = 0.45 * fade;
        // Slow wander.
        tornadoPos.x += Math.sin(time * 0.11) * 3.2 * dt;
        tornadoPos.z += Math.cos(time * 0.09) * 2.4 * dt;
        tornadoPos.y = heightAtFn(tornadoPos.x, tornadoPos.z);
        tornado.position.copy(tornadoPos);
        funnel.rotation.y += dt * 3.4;
        core.rotation.y -= dt * 4.6;
        funnelMat.map.offset.y -= dt * 0.35;
        for (let i = 0; i < debrisCount; i++) {
          const d = debrisData[i];
          d.angle += dt * d.speed;
          d.h += dt * 0.05;
          if (d.h > 1) d.h = 0;
          const r = 4 + d.h * 26;
          debrisPos[i * 3] = Math.cos(d.angle) * r;
          debrisPos[i * 3 + 1] = d.h * 195;
          debrisPos[i * 3 + 2] = Math.sin(d.angle) * r;
        }
        debrisGeo.attributes.position.needsUpdate = true;
        // Suction and spin near the funnel.
        const dx = tornadoPos.x - plane.pos.x;
        const dz = tornadoPos.z - plane.pos.z;
        const dist = Math.hypot(dx, dz);
        fx.tornadoDist = dist;
        if (plane.airborne && dist < WEATHER.tornadoPullRadius && dist > 1) {
          const pull = (1 - dist / WEATHER.tornadoPullRadius) * 26 * fade;
          fx.pullX = (dx / dist) * pull;
          fx.pullZ = (dz / dist) * pull;
          fx.turbulence = Math.max(fx.turbulence, (1 - dist / WEATHER.tornadoPullRadius) * 0.8);
        }
      }

      if (rain.visible) {
        rain.position.set(plane.pos.x, plane.pos.y + 30, plane.pos.z);
        const slant = kind === 'storm' ? 14 : 5;
        for (let i = 0; i < dropCount; i++) {
          dropPos[i * 3 + 1] -= 58 * dt;
          dropPos[i * 3] += slant * dt;
          if (dropPos[i * 3 + 1] < -BOX.y / 2) dropPos[i * 3 + 1] += BOX.y;
          if (dropPos[i * 3] > BOX.x / 2) dropPos[i * 3] -= BOX.x;
        }
        rainGeo.attributes.position.needsUpdate = true;
      }
      if (bolt.visible && performance.now() / 1000 > boltUntil) bolt.visible = false;
      return fx;
    },
  };
}
