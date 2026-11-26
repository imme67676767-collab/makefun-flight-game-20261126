// The world: a seeded mountain canyon with a river, a road, villages,
// wind turbines, a lighthouse, balloons, birds and a waterfall, all of it
// procedural. heightAt() is the single source of truth — the terrain mesh,
// the trees, the buildings and the flight model's ground collision all read
// it, so what you see is exactly what you can hit. The sky is a gradient
// dome with a sun glow; clouds are soft billboards plus flattened puff
// clusters; one directional sun throws soft shadows that follow the plane.

import { COLORS, MAPS, QUALITY, WORLD } from './config.js';
import { createRandom, lerp, range, smoothstep } from './random.js';

const THREE = window.THREE;

/** Fixed sun direction (normalised): low warm afternoon sun from the west. */
export const SUN_DIR = new THREE.Vector3(-0.64, 0.38, -0.32).normalize();

const PHASES = { a: 0, b: 0, c: 0, hash: 0 };

/** Active map parameters (set by buildWorld); heightAt reads these. */
const MAP = { heightScale: 1, snowLine: 235, scatterMult: 1, palette: null };

/** */
export const LAKE = { x: 0, z: 430, r: 175, level: 30, bed: 23 };

function reseed(seed, mapDef = MAPS.canyon) {
  const rng = createRandom(seed ^ 0x9e3779b9);
  PHASES.a = rng() * 40;
  PHASES.b = rng() * 40;
  PHASES.c = rng() * 40;
  PHASES.hash = rng() * 100;
  MAP.heightScale = mapDef.heightScale;
  MAP.snowLine = mapDef.snowLine;
  MAP.scatterMult = mapDef.scatterMult;
  MAP.palette = mapDef.palette;
  LAKE.z = mapDef.lakeZ;
  LAKE.r = mapDef.lakeR;
  LAKE.x = pathX(LAKE.z) + mapDef.lakeOffsetX;
  LAKE.level = padHeightAt(LAKE.z) - 5;
  LAKE.bed = LAKE.level - 7;
}

/** Deterministic lattice hash for value noise. */
function hash2(ix, iz) {
  const n = Math.sin(ix * 127.1 + iz * 311.7 + PHASES.hash) * 43758.5453;
  return n - Math.floor(n);
}

function noise2(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  return lerp(
    lerp(hash2(ix, iz), hash2(ix + 1, iz), sx),
    lerp(hash2(ix, iz + 1), hash2(ix + 1, iz + 1), sx),
    sz,
  );
}

function fbm(x, z, octaves) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** Ridged noise: sharp crests like the reference mountain render. */
function ridged(x, z) {
  const n = fbm(x, z, 3);
  return Math.pow(1 - Math.abs(2 * n - 1), 1.7);
}

/** The canyon centreline: a lazy S-curve the river and the rings follow. */
export function pathX(z) {
  return 260 * Math.sin(z * 0.0016 + PHASES.a) + 130 * Math.sin(z * 0.0041 + PHASES.b);
}

/** Unit tangent of the centreline, pointing north (-Z). */
export function pathTangent(z) {
  const dx = (pathX(z - 6) - pathX(z + 6)) / 12;
  return new THREE.Vector3(dx, 0, -1).normalize();
}

function padHeightAt(z) {
  return 12 + fbm(pathX(z) * 0.0016 + PHASES.c, z * 0.0016, 4) * 55;
}

function flatten(x, z, padX, padZ, padH, h) {
  const d = Math.hypot(x - padX, z - padZ);
  return lerp(h, padH, smoothstep(330, 90, d));
}

/** Terrain height at (x, z). The one function everything agrees on. */
export function heightAt(x, z) {
  const d = Math.abs(x - pathX(z));
  const wall = smoothstep(90, 950, d);
  const hs = MAP.heightScale;
  let h = 12 + fbm(x * 0.0016 + PHASES.c, z * 0.0016, 4) * 55;
  h += wall * hs * (ridged(x * 0.00085, z * 0.00085) * 460 + fbm(x * 0.0045, z * 0.0045, 3) * 110);
  // Craggy detail so the canyon walls read as cliffs, not dunes.
  h += wall * hs * ridged(x * 0.0035 + 3.1, z * 0.0035) * 75;
  // A ring of high peaks wraps the whole map: the further from the canyon
  // corridor, the taller and steeper the snow-capped rim gets.
  const r = Math.hypot(x, z * 0.92);
  h += wall * hs * smoothstep(2000, 3400, r) * (ridged(x * 0.0006 + 7.3, z * 0.0006) * 430 + 150);
  h += wall * hs * smoothstep(1250, 3500, Math.abs(x)) * 240;
  h -= (1 - wall) * 5;
  // Carve the lake basin into the valley floor (bed below water level).
  const lakeD = Math.hypot(x - LAKE.x, z - LAKE.z);
  h = lerp(h, LAKE.bed, smoothstep(LAKE.r, LAKE.r * 0.42, lakeD));
  h = flatten(x, z, pathX(WORLD.startZ), WORLD.startZ, padHeightAt(WORLD.startZ), h);
  h = flatten(x, z, pathX(WORLD.finishZ), WORLD.finishZ, padHeightAt(WORLD.finishZ), h);
  return h;
}

/** Local slope (0 flat, 1 cliff) from finite differences. */
function slopeAt(x, z) {
  const e = 6;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.min(1, Math.hypot(dx, dz) / (2 * e));
}

function canvasTexture(width, height, draw, repeat = false) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** Fine grain multiplied over the terrain vertex colours. */
function detailTexture() {
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 5200; i++) {
      const v = 190 + Math.floor(Math.random() * 65);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    for (let i = 0; i < 260; i++) {
      const v = 150 + Math.floor(Math.random() * 50);
      ctx.fillStyle = `rgba(${v},${v},${v},0.5)`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 5, 3);
    }
  }, true);
  tex.repeat.set(110, 110);
  return tex;
}

/** Procedural rock normal map: value-noise height field run through a Sobel
 *  filter, tileable so the repeat seams stay invisible at glancing angles. */
function rockNormalTexture() {
  const S = 256;
  const height = new Float32Array(S * S);
  const cells = 24;
  const grid = [];
  for (let i = 0; i <= cells; i++) {
    grid.push([]);
    for (let j = 0; j <= cells; j++) grid[i].push(Math.random());
  }
  const sample = (x, y) => {
    const gx = (x / S) * cells;
    const gy = (y / S) * cells;
    const ix = Math.floor(gx) % cells;
    const iy = Math.floor(gy) % cells;
    const fx = gx - Math.floor(gx);
    const fy = gy - Math.floor(gy);
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = grid[iy][ix];
    const b = grid[iy][(ix + 1) % cells];
    const c = grid[(iy + 1) % cells][ix];
    const d = grid[(iy + 1) % cells][(ix + 1) % cells];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      height[y * S + x] = sample(x, y) * 0.65 + sample((x * 2) % S, (y * 2) % S) * 0.35;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const at = (x, y) => height[((y + S) % S) * S + ((x + S) % S)];
  const strength = 2.2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * S + x) * 4;
      img.data[i] = (dx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = inv * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(140, 140);
  tex.anisotropy = 4;
  return tex;
}

/** A soft cumulus puff: clustered radial gradients, shaded blue-grey below. */
function cloudTexture() {
  return canvasTexture(256, 256, (ctx) => {
    ctx.clearRect(0, 0, 256, 256);
    const puffs = [];
    for (let i = 0; i < 16; i++) {
      puffs.push({
        x: 50 + Math.random() * 156,
        y: 96 + Math.random() * 60,
        r: 26 + Math.random() * 44,
      });
    }
    for (const p of puffs) {
      const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, p.r);
      g.addColorStop(0, 'rgba(226,234,246,0.55)');
      g.addColorStop(1, 'rgba(226,234,246,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of puffs) {
      const g = ctx.createRadialGradient(p.x, p.y - p.r * 0.28, 2, p.x, p.y - p.r * 0.28, p.r * 0.85);
      g.addColorStop(0, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y - p.r * 0.28, p.r * 0.85, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Sun disc with a warm halo. */
function sunTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(128, 128, 4, 128, 128, 126);
    g.addColorStop(0, 'rgba(255,252,240,1)');
    g.addColorStop(0.16, 'rgba(255,240,200,0.95)');
    g.addColorStop(0.35, 'rgba(255,220,150,0.35)');
    g.addColorStop(1, 'rgba(255,210,130,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

/** Leaf-cluster texture for the tree crowns, alpha-cut. */
function leafTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const greens = ['#2e7d32', '#388e3c', '#43a047', '#2f6b2f', '#4c9a4c', '#357a38'];
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 4 + Math.random() * 9;
      ctx.fillStyle = greens[Math.floor(Math.random() * greens.length)];
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.62, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }, true);
}

function barkTexture() {
  const tex = canvasTexture(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#6d5138';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? '#5a4230' : '#7d5f42';
      const x = Math.random() * w;
      ctx.fillRect(x, Math.random() * h * 0.4, 3, 40 + Math.random() * 90);
    }
  }, true);
  tex.repeat.set(2, 2);
  return tex;
}

/** House walls with windows and a door, tinted per house by material colour. */
function houseTexture() {
  return canvasTexture(256, 160, (ctx, w, h) => {
    ctx.fillStyle = '#f2ead8';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#274b63';
    for (const x of [28, 96, 164, 216]) ctx.fillRect(x, 38, 30, 38);
    ctx.fillStyle = '#bfe0f2';
    for (const x of [28, 96, 164, 216]) ctx.fillRect(x + 4, 42, 22, 30);
    ctx.fillStyle = '#6d4c2f';
    ctx.fillRect(112, 92, 32, 68);
    ctx.fillStyle = '#3c2d1e';
    ctx.fillRect(0, h - 10, w, 10);
  });
}

/** Emissive companion to houseTexture: only the window panes, warm-lit,
 *  so village windows glow at dusk. Same layout, no rng draws. */
function houseGlowTexture() {
  return canvasTexture(256, 160, (ctx, w, h) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    for (const x of [28, 96, 164, 216]) {
      ctx.fillStyle = '#ffb45e';
      ctx.fillRect(x + 4, 42, 22, 30);
      ctx.fillStyle = 'rgba(255,214,150,0.85)';
      ctx.fillRect(x + 7, 45, 16, 24);
    }
  });
}

/** Runway asphalt: centreline dashes, threshold bars and the runway number. */
function runwayTexture(number) {
  return canvasTexture(256, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#3a3f45';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = 46 + Math.floor(Math.random() * 26);
      ctx.fillStyle = `rgb(${v},${v + 3},${v + 7})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    }
    // Concrete slab joints: transverse seams with a darker tar line.
    ctx.fillStyle = 'rgba(18,20,24,0.55)';
    for (let y = 0; y < h; y += 128) ctx.fillRect(0, y, w, 3);
    ctx.fillRect(w / 2 - 1, 0, 2, h);
    // Oil stains and rubber deposits around the touchdown zone.
    for (let i = 0; i < 26; i++) {
      const x = w * 0.3 + Math.random() * w * 0.4;
      const y = h * 0.12 + Math.random() * h * 0.3;
      const r = 8 + Math.random() * 26;
      const g = ctx.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, 'rgba(12,12,14,0.4)');
      g.addColorStop(1, 'rgba(12,12,14,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Twin tyre streaks worn into the touchdown zone.
    ctx.fillStyle = 'rgba(10,10,12,0.5)';
    for (const sx of [w * 0.38, w * 0.62]) {
      for (let y = h * 0.1; y < h * 0.52; y += 7) {
        if (Math.random() < 0.22) continue;
        ctx.fillRect(sx - 4 + (Math.random() - 0.5) * 3, y, 8, 6);
      }
    }
    ctx.fillStyle = '#e8edf2';
    ctx.fillRect(10, 0, 6, h);
    ctx.fillRect(w - 16, 0, 6, h);
    for (let y = 90; y < h - 60; y += 92) ctx.fillRect(w / 2 - 5, y, 10, 52);
    for (let i = 0; i < 6; i++) ctx.fillRect(38 + i * 32, 16, 20, 64);
    ctx.font = 'bold 92px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(number, w / 2, 190);
  });
}

function balloonTexture(colA, colB) {
  return canvasTexture(256, 128, (ctx, w, h) => {
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i % 2 ? colA : colB;
      ctx.fillRect((i * w) / 10, 0, w / 10 + 1, h);
    }
  }, true);
}

/** Falling-water streaks, scrolled downward by offset animation. */
function waterfallTexture() {
  const tex = canvasTexture(128, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 130; i++) {
      const x = Math.random() * w;
      const len = 26 + Math.random() * 70;
      const y = Math.random() * h;
      const g = ctx.createLinearGradient(0, y, 0, y + len);
      g.addColorStop(0, 'rgba(240,250,255,0)');
      g.addColorStop(0.4, 'rgba(240,250,255,0.75)');
      g.addColorStop(1, 'rgba(190,225,250,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, 2.5, len);
    }
  }, true);
  tex.repeat.set(1, 2);
  return tex;
}

/** Reed clump: vertical green blades with brown cattail heads, alpha-cut. */
function reedTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const x = 8 + Math.random() * (w - 16);
      const lean = (Math.random() - 0.5) * 14;
      const top = 8 + Math.random() * 30;
      ctx.strokeStyle = ['#4d7c3a', '#5d8f45', '#3e6b30'][i % 3];
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.quadraticCurveTo(x + lean * 0.4, h * 0.55, x + lean, top);
      ctx.stroke();
      if (Math.random() < 0.45) {
        ctx.fillStyle = '#6d4a26';
        ctx.fillRect(x + lean - 2, top, 4, 13);
      }
    }
  });
}

/** Wildflower sprig: green stems topped with bright dots, alpha-cut. */
function flowerTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const petals = ['#ff5f8f', '#ffd23c', '#ffffff', '#b78bff', '#ff8a3c'];
    for (let i = 0; i < 30; i++) {
      const x = 6 + Math.random() * (w - 12);
      const top = 30 + Math.random() * 45;
      ctx.strokeStyle = '#4d8a3f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + (Math.random() - 0.5) * 8, top);
      ctx.stroke();
      ctx.fillStyle = petals[Math.floor(Math.random() * petals.length)];
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * 4, top + Math.sin(a) * 4, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffdf6b';
      ctx.beginPath();
      ctx.arc(x, top, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Church wall: stone tint with tall arched stained-glass windows. */
function churchTexture() {
  return canvasTexture(256, 192, (ctx, w, h) => {
    ctx.fillStyle = '#ddd6c4';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      const v = 195 + Math.floor(Math.random() * 35);
      ctx.fillStyle = `rgb(${v},${v - 6},${v - 22})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 9, 6);
    }
    for (const x of [34, 108, 182]) {
      ctx.fillStyle = '#3a4a6b';
      ctx.beginPath();
      ctx.moveTo(x, 130);
      ctx.lineTo(x, 58);
      ctx.quadraticCurveTo(x + 20, 26, x + 40, 58);
      ctx.lineTo(x + 40, 130);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#7fb2d9';
      ctx.fillRect(x + 6, 66, 12, 58);
      ctx.fillStyle = '#d9a03c';
      ctx.fillRect(x + 22, 66, 12, 58);
    }
    ctx.fillStyle = '#4a3826';
    ctx.fillRect(0, h - 12, w, 12);
  });
}

/** Barn wall: red boards with a white cross-braced door. */
function barnTexture() {
  return canvasTexture(256, 192, (ctx, w, h) => {
    ctx.fillStyle = '#a83a2c';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#97332a';
    for (let x = 0; x < w; x += 18) ctx.fillRect(x, 0, 3, h);
    ctx.fillStyle = '#f2ead8';
    ctx.fillRect(88, 62, 80, 118);
    ctx.fillStyle = '#8f2f24';
    ctx.fillRect(94, 68, 68, 106);
    ctx.strokeStyle = '#f2ead8';
    ctx.lineWidth = 7;
    ctx.strokeRect(94, 68, 68, 106);
    ctx.beginPath();
    ctx.moveTo(94, 68);
    ctx.lineTo(162, 174);
    ctx.moveTo(162, 68);
    ctx.lineTo(94, 174);
    ctx.stroke();
    ctx.fillStyle = '#f2ead8';
    ctx.fillRect(108, 14, 40, 30);
    ctx.fillStyle = '#274b63';
    ctx.fillRect(114, 20, 28, 18);
  });
}

/** Ploughed field: alternating crop stripes with furrow lines. */
function fieldTexture() {
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    const bands = ['#7fae4d', '#c8a84e', '#5d9440', '#a87f4a'];
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = bands[i];
      ctx.fillRect(0, (i * h) / 4, w, h / 4);
    }
    ctx.fillStyle = 'rgba(60,44,24,0.35)';
    for (let y = 4; y < h; y += 9) ctx.fillRect(0, y, w, 2);
  }, true);
  tex.repeat.set(3, 3);
  return tex;
}

/** Merge several transformed geometries into one (for instanced crowns). */
function mergeGeometries(parts) {
  let vTotal = 0;
  let iTotal = 0;
  for (const p of parts) {
    vTotal += p.attributes.position.count;
    iTotal += p.index ? p.index.count : p.attributes.position.count;
  }
  const pos = new Float32Array(vTotal * 3);
  const nor = new Float32Array(vTotal * 3);
  const uv = new Float32Array(vTotal * 2);
  const idx = new Uint32Array(iTotal);
  let vOff = 0;
  let iOff = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, vOff * 3);
    nor.set(p.attributes.normal.array, vOff * 3);
    if (p.attributes.uv) uv.set(p.attributes.uv.array, vOff * 2);
    const src = p.index ? p.index.array : [...Array(p.attributes.position.count).keys()];
    for (let i = 0; i < src.length; i++) idx[iOff + i] = src[i] + vOff;
    vOff += p.attributes.position.count;
    iOff += src.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

function transformed(geometry, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) {
  const m = new THREE.Matrix4()
    .makeRotationY(ry)
    .premultiply(new THREE.Matrix4().makeScale(sx, sy, sz))
    .setPosition(x, y, z);
  geometry.applyMatrix4(m);
  return geometry;
}

function std(color, roughness = 0.85, metalness = 0.02) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function addMesh(parent, geometry, material, x, y, z, castShadow = true) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = castShadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Terrain mesh: displaced grid, vertex colours by height and slope. */
function buildTerrain() {
  const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, WORLD.segments, WORLD.segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();
  const normals = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const pal = MAP.palette || {};
  const grassLow = new THREE.Color(pal.grassLow ?? COLORS.grassLow);
  const grassHigh = new THREE.Color(pal.grassHigh ?? COLORS.grassHigh);
  const rock = new THREE.Color(pal.rock ?? COLORS.rock);
  const snow = new THREE.Color(COLORS.snow);
  const sand = new THREE.Color(0xc9b18a);
  const dirt = new THREE.Color(0x8a6b44);
  const dryGrass = new THREE.Color(0xa9a44e);
  const c = new THREE.Color();
  const rockTint = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = pos.getY(i);
    const slope = 1 - normals.getY(i);
    c.copy(grassLow).lerp(grassHigh, smoothstep(10, 150, h));
    // Mottled meadow variation so flat ground never reads as one flat colour:
    // two noise scales push the hue between deep green and yellow-green.
    const mottle = fbm(x * 0.01, z * 0.01, 2);
    c.offsetHSL((mottle - 0.5) * 0.035, 0, (mottle - 0.5) * 0.13);
    const dry = fbm(x * 0.004 + 9.1, z * 0.004, 2);
    c.lerp(dryGrass, smoothstep(0.58, 0.78, dry) * smoothstep(0.3, 0.08, slope) * 0.55);
    // Bare-earth patches where the meadow thins out.
    const bare = fbm(x * 0.006 + 4.7, z * 0.006 + 1.3, 3);
    c.lerp(dirt, smoothstep(0.66, 0.8, bare) * smoothstep(0.25, 0.06, slope) * 0.6);
    // Sandy banks near the river.
    const dPath = Math.abs(x - pathX(z));
    c.lerp(sand, smoothstep(26, 10, dPath) * 0.55);
    // A sandy shore ring where the ground meets the lake.
    const dLake = Math.hypot(x - LAKE.x, z - LAKE.z);
    const shore = smoothstep(LAKE.r * 1.12, LAKE.r * 0.9, dLake) * smoothstep(LAKE.level - 2.5, LAKE.level + 1.5, h);
    c.lerp(sand, shore * 0.7);
    // Rock on steep faces and high ground, with sedimentary strata banding
    // so the cliffs read as layered stone rather than smooth ramps.
    const rockAmt = Math.max(smoothstep(0.13, 0.38, slope), smoothstep(175, 275, h) * 0.75);
    const strata = 0.92 + 0.16 * Math.sin(h * 0.11 + fbm(x * 0.002, z * 0.002, 2) * 5.0);
    rockTint.copy(rock).multiplyScalar(strata);
    c.lerp(rockTint, rockAmt);
    c.lerp(snow, smoothstep(MAP.snowLine, MAP.snowLine + 95, h) * smoothstep(0.6, 0.32, slope));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, map: detailTexture(), roughness: 1, metalness: 0,
    normalMap: rockNormalTexture(), normalScale: new THREE.Vector2(0.55, 0.55),
  });
  const terrain = new THREE.Mesh(geo, mat);
  terrain.receiveShadow = true;
  return terrain;
}

/** Gradient sky dome with sun glow; stormFactor greys it over. */
function buildSky() {
  const uniforms = {
    topColor: { value: new THREE.Color(COLORS.skyTop) },
    horizonColor: { value: new THREE.Color(COLORS.skyHorizon) },
    sunDirection: { value: SUN_DIR },
    sunColor: { value: new THREE.Color(0xffe9b8) },
    stormFactor: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 sunDirection;
      uniform vec3 sunColor;
      uniform float stormFactor;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float h = max(dir.y, 0.0);
        // Deep zenith falling off to a bright, slightly warm horizon band.
        vec3 col = mix(horizonColor, topColor, pow(h, 0.5));
        col = mix(col, topColor * 0.82, smoothstep(0.45, 1.0, h) * 0.55);
        float sunAmt = max(dot(dir, sunDirection), 0.0);
        // Tight solar disc, inner halo and a wide warm forward-scatter glow.
        col += sunColor * (pow(sunAmt, 1400.0) * 2.6 + pow(sunAmt, 220.0) * 0.75 + pow(sunAmt, 8.0) * 0.16);
        // Warm tint low around the sun azimuth, like late-afternoon haze.
        col += vec3(1.0, 0.72, 0.42) * pow(sunAmt, 3.0) * pow(1.0 - h, 3.0) * 0.16;
        col = mix(col, vec3(0.42, 0.47, 0.54), stormFactor * 0.75);
        // Atmospheric whitening right at the horizon line.
        col = mix(col, horizonColor * 1.06, pow(1.0 - h, 7.0) * 0.65);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(6200, 24, 14), mat);
  dome.frustumCulled = false;
  return { dome, uniforms };
}

/** Cumulus: billboard sprites in clusters plus flattened 3D puff clusters. */
function buildClouds(rng, quality) {
  const group = new THREE.Group();
  const tex = cloudTexture();
  const spriteMat = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, opacity: 0.92, fog: false,
  });
  const sprites = [];
  const clusters = Math.max(6, Math.round(quality.cloudSprites / 6));
  for (let c = 0; c < clusters; c++) {
    const cx = range(rng, -3300, 3300);
    const cz = range(rng, -3300, 3300);
    const cy = range(rng, 360, 560);
    const n = 4 + Math.floor(rng() * 4);
    for (let i = 0; i < n && sprites.length < quality.cloudSprites; i++) {
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(cx + range(rng, -150, 150), cy + range(rng, -22, 22), cz + range(rng, -150, 150));
      const s = range(rng, 200, 460);
      sprite.scale.set(s, s * 0.52, 1);
      sprite.userData.drift = range(rng, 1.2, 3.2);
      group.add(sprite);
      sprites.push(sprite);
    }
  }
  // 3D puffs for near-field volume: instanced flattened icosahedra with
  // baked cumulus shading — bright tops, blue-grey bellies, a warm kiss
  // on the sun side — so the near clouds read as volumes, not blobs.
  const puffGeo = new THREE.IcosahedronGeometry(1, 1);
  {
    const posAttr = puffGeo.attributes.position;
    const colors = new Float32Array(posAttr.count * 3);
    const top = new THREE.Color(0xffffff);
    const belly = new THREE.Color(0xb9cadd);
    const warm = new THREE.Color(0xfff3d9);
    const n = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < posAttr.count; i++) {
      n.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).normalize();
      c.copy(belly).lerp(top, smoothstep(-0.75, 0.65, n.y));
      const sunSide = Math.max(0, n.dot(SUN_DIR));
      c.lerp(warm, sunSide * sunSide * 0.45);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    puffGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  const puffMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 1, flatShading: true, transparent: true, opacity: 0.94,
    emissive: 0xaebfd2, emissiveIntensity: 0.42,
  });
  const puffs = new THREE.InstancedMesh(puffGeo, puffMat, quality.cloudPuffs);
  // A second, brighter layer riding on top of each puff: sunlit crowns over
  // the shaded bellies give the near clouds real volume and a soft edge.
  const topMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, flatShading: true, transparent: true, opacity: 0.82,
    emissive: 0xffffff, emissiveIntensity: 0.42,
  });
  const tops = new THREE.InstancedMesh(puffGeo, topMat, quality.cloudPuffs);
  const dummy = new THREE.Object3D();
  const puffData = [];
  const clusterData = [];
  const puffClusters = 14;
  let placed = 0;
  for (let c = 0; c < puffClusters && placed < quality.cloudPuffs; c++) {
    const cx = range(rng, -3300, 3300);
    const cz = range(rng, -3300, 3300);
    const cy = range(rng, 330, 500);
    // NOTE: no extra rng draws here — the shared sequence must stay identical
    // to the checkpoint so downstream placement (storm cells, rings) is
    // unchanged. The shadow blob borrows the first puff's drift below.
    let clusterDrift = 2.5;
    const n = Math.min(quality.cloudPuffs - placed, 8 + Math.floor(rng() * 10));
    for (let i = 0; i < n; i++) {
      const px = cx + range(rng, -120, 120);
      const py = cy + range(rng, -14, 14);
      const pz = cz + range(rng, -120, 120);
      const s = range(rng, 26, 62);
      dummy.position.set(px, py, pz);
      dummy.scale.set(s, s * 0.42, s * 0.8);
      dummy.rotation.y = rng() * Math.PI;
      dummy.updateMatrix();
      puffs.setMatrixAt(placed, dummy.matrix);
      dummy.position.y = py + s * 0.22;
      dummy.scale.set(s * 0.72, s * 0.3, s * 0.58);
      dummy.updateMatrix();
      tops.setMatrixAt(placed, dummy.matrix);
      const puffDrift = range(rng, 1.5, 3.5);
      if (i === 0) clusterDrift = puffDrift;
      puffData.push({ x: px, y: py, z: pz, s, ry: dummy.rotation.y, drift: puffDrift });
      placed++;
    }
    clusterData.push({ x: cx, z: cz, drift: clusterDrift, r: 240 + ((c * 137) % 180) });
  }
  puffs.count = placed;
  puffs.instanceMatrix.needsUpdate = true;
  tops.count = placed;
  tops.instanceMatrix.needsUpdate = true;
  group.add(puffs);
  group.add(tops);
  return { group, sprites, puffs, tops, puffData, clusters: clusterData, spriteMat, puffMat, topMat };
}

/** Soft dark blobs that drift under the cloud clusters: moving cloud shadows.
 *  One flat quad per cluster, hugging the terrain at its centre height. */
function buildCloudShadows(clusters) {
  const group = new THREE.Group();
  const tex = canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
    g.addColorStop(0, 'rgba(18,30,48,0.85)');
    g.addColorStop(0.55, 'rgba(18,30,48,0.45)');
    g.addColorStop(1, 'rgba(18,30,48,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const shadows = clusters.map((cl) => {
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.3, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(cl.r * 2, 1, cl.r * 1.5);
    m.position.set(cl.x, heightAt(cl.x, cl.z) + 2.2, cl.z);
    m.renderOrder = 2;
    group.add(m);
    return { mesh: m, cluster: cl };
  });
  return { group, shadows };
}

/** Low scrub bushes: squashed icosahedra scattered over the valley floor. */
function buildBushes(rng, quality, clearSpots) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const count = quality.bushes ?? 200;
  const bushes = new THREE.InstancedMesh(geo, mat, count);
  bushes.castShadow = true;
  bushes.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  let placed = 0;
  let guard = 0;
  while (placed < count && guard < count * 12) {
    guard++;
    const x = range(rng, -3200, 3200);
    const z = range(rng, -3200, 3200);
    const h = heightAt(x, z);
    if (h > 190 || slopeAt(x, z) > 0.45) continue;
    if (Math.abs(x - pathX(z)) < 20) continue;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r * 0.95) continue;
    let blocked = false;
    for (const spot of clearSpots) {
      if (Math.hypot(x - spot.x, z - spot.z) < spot.r) { blocked = true; break; }
    }
    if (blocked) continue;
    const s = range(rng, 0.9, 2.6);
    dummy.position.set(x, h + s * 0.32, z);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    dummy.scale.set(s, s * range(rng, 0.5, 0.75), s);
    dummy.updateMatrix();
    bushes.setMatrixAt(placed, dummy.matrix);
    tint.setHSL(0.27 + rng() * 0.05, 0.45 + rng() * 0.2, 0.3 + rng() * 0.14);
    bushes.setColorAt(placed, tint);
    placed++;
  }
  bushes.count = placed;
  bushes.instanceMatrix.needsUpdate = true;
  if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;
  return bushes;
}

/** */
function buildTrees(rng, quality, clearSpots) {
  const group = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 1 });
  const crownMat = new THREE.MeshStandardMaterial({
    map: leafTexture(), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 1,
  });
  // Trunk with two main branches reaching into the crown.
  const branch = (len, tilt, ry) => {
    const g = new THREE.CylinderGeometry(0.05, 0.11, len, 5);
    g.translate(0, len / 2, 0);
    const m = new THREE.Matrix4().makeRotationY(ry).multiply(new THREE.Matrix4().makeRotationZ(tilt));
    m.setPosition(0, 2.1, 0);
    g.applyMatrix4(m);
    return g;
  };
  const trunkGeo = mergeGeometries([
    (() => { const g = new THREE.CylinderGeometry(0.13, 0.34, 2.9, 6); g.translate(0, 1.45, 0); return g; })(),
    branch(1.7, 0.55, 0.4),
    branch(1.5, -0.62, 2.4),
    branch(1.3, 0.35, 4.2),
  ]);
  // Crown variants: [cluster count, spread, height, base radius] sketches,
  // each cluster a small icosahedron sprayed around the variant's envelope.
  const variantSpecs = [
    { clusters: 12, spread: 1.15, baseY: 3.4, rise: 1.5, r: 0.95 },  // round
    { clusters: 13, spread: 0.8, baseY: 3.2, rise: 2.4, r: 0.85 },   // tall
    { clusters: 14, spread: 1.55, baseY: 3.1, rise: 1.0, r: 0.9 },   // wide
    { clusters: 11, spread: 1.25, baseY: 3.0, rise: 1.7, r: 0.8 },   // scruffy
  ];
  const crownGeos = variantSpecs.map((spec, vi) => {
    const vrng = createRandom(7000 + vi * 131);
    const parts = [];
    for (let i = 0; i < spec.clusters; i++) {
      const a = vrng() * Math.PI * 2;
      const rad = Math.sqrt(vrng()) * spec.spread;
      const y = spec.baseY + vrng() * spec.rise;
      const cr = spec.r * (0.65 + vrng() * 0.6);
      parts.push(transformed(
        new THREE.IcosahedronGeometry(cr, 1),
        Math.cos(a) * rad, y, Math.sin(a) * rad,
        1, 0.82, 1, vrng() * Math.PI,
      ));
    }
    return mergeGeometries(parts);
  });

  const count = quality.trees;
  const perVariant = crownGeos.map(() => Math.ceil(count / crownGeos.length));
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  trunks.castShadow = true;
  const crownMeshes = crownGeos.map((geo, vi) => {
    const m = new THREE.InstancedMesh(geo, crownMat, perVariant[vi]);
    m.castShadow = true;
    return m;
  });
  const placedPer = crownGeos.map(() => 0);
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  let placed = 0;
  let guard = 0;
  while (placed < count && guard < count * 14) {
    guard++;
    const x = range(rng, -3300, 3300);
    const z = range(rng, -3300, 3300);
    const h = heightAt(x, z);
    if (h > 210) continue;
    if (slopeAt(x, z) > 0.42) continue;
    if (Math.abs(x - pathX(z)) < 26) continue; // keep the river clear
    let blocked = false;
    for (const spot of clearSpots) {
      if (Math.hypot(x - spot.x, z - spot.z) < spot.r) { blocked = true; break; }
    }
    if (blocked) continue;
    const vi = Math.floor(rng() * crownGeos.length);
    if (placedPer[vi] >= perVariant[vi]) continue;
    const s = range(rng, 1.0, 2.1);
    dummy.position.set(x, h - 0.15, z);
    dummy.rotation.set(range(rng, -0.05, 0.05), rng() * Math.PI * 2, range(rng, -0.05, 0.05));
    dummy.scale.set(s * range(rng, 0.9, 1.1), s * range(rng, 0.9, 1.15), s);
    dummy.updateMatrix();
    trunks.setMatrixAt(placed, dummy.matrix);
    crownMeshes[vi].setMatrixAt(placedPer[vi], dummy.matrix);
    tint.setHSL(0.26 + rng() * 0.05, 0.42 + rng() * 0.2, 0.42 + rng() * 0.16);
    crownMeshes[vi].setColorAt(placedPer[vi], tint);
    placedPer[vi]++;
    placed++;
  }
  trunks.count = placed;
  trunks.instanceMatrix.needsUpdate = true;
  group.add(trunks);
  crownMeshes.forEach((m, vi) => {
    m.count = placedPer[vi];
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    group.add(m);
  });
  return group;
}

/** Scattered boulders, mostly where the slopes get steep. */
function buildRocks(rng) {
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = std(0x8d8a86, 0.95);
  const count = 150;
  const rocks = new THREE.InstancedMesh(geo, mat, count);
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  const dummy = new THREE.Object3D();
  let placed = 0;
  let guard = 0;
  while (placed < count && guard < count * 10) {
    guard++;
    const x = range(rng, -3300, 3300);
    const z = range(rng, -3300, 3300);
    const h = heightAt(x, z);
    if (Math.abs(x - pathX(z)) < 18) continue;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r) continue;
    const s = range(rng, 0.7, 3.4);
    dummy.position.set(x, h + s * 0.25, z);
    dummy.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    dummy.scale.set(s, s * range(rng, 0.6, 1), s);
    dummy.updateMatrix();
    rocks.setMatrixAt(placed, dummy.matrix);
    placed++;
  }
  rocks.count = placed;
  rocks.instanceMatrix.needsUpdate = true;
  return rocks;
}

/** Poplars: tall thin windbreak trees along the valley floor. Private rng
 *  (passed in) so the shared placement sequence stays untouched. */
function buildPoplars(rng, quality, clearSpots) {
  const group = new THREE.Group();
  const count = Math.round((quality.trees ?? 300) * 0.16);
  const trunkGeo = new THREE.CylinderGeometry(0.09, 0.22, 3.4, 5);
  trunkGeo.translate(0, 1.7, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1, 1);
  crownGeo.scale(0.62, 2.5, 0.62);
  crownGeo.translate(0, 5.2, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, std(0x6d5138, 1), count);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({
    color: 0x3d7a3a, roughness: 1, flatShading: true,
  }), count);
  trunks.castShadow = true;
  crowns.castShadow = true;
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  let placed = 0;
  let guard = 0;
  while (placed < count && guard < count * 14) {
    guard++;
    const x = range(rng, -2600, 2600);
    const z = range(rng, -3200, 3200);
    const h = heightAt(x, z);
    if (h > 150 || slopeAt(x, z) > 0.3) continue;
    if (Math.abs(x - pathX(z)) < 34) continue;
    let blocked = false;
    for (const spot of clearSpots) {
      if (Math.hypot(x - spot.x, z - spot.z) < spot.r) { blocked = true; break; }
    }
    if (blocked) continue;
    dummy.position.set(x, h - 0.15, z);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    dummy.scale.setScalar(range(rng, 1.1, 1.9));
    dummy.updateMatrix();
    trunks.setMatrixAt(placed, dummy.matrix);
    crowns.setMatrixAt(placed, dummy.matrix);
    tint.setHSL(0.27 + rng() * 0.04, 0.4 + rng() * 0.18, 0.34 + rng() * 0.14);
    crowns.setColorAt(placed, tint);
    placed++;
  }
  trunks.count = placed;
  crowns.count = placed;
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  group.add(trunks, crowns);
  return group;
}

/** Flat rock slabs: a second rock variant, tilted plates half-buried on
 *  the slopes. Private rng, bounded count. */
function buildRockSlabs(rng) {
  const geo = new THREE.BoxGeometry(1, 0.32, 1);
  const mat = std(0x7e7c78, 0.95);
  const count = 70;
  const slabs = new THREE.InstancedMesh(geo, mat, count);
  slabs.castShadow = true;
  slabs.receiveShadow = true;
  const dummy = new THREE.Object3D();
  let placed = 0;
  let guard = 0;
  while (placed < count && guard < count * 10) {
    guard++;
    const x = range(rng, -3300, 3300);
    const z = range(rng, -3300, 3300);
    const h = heightAt(x, z);
    if (h < 60) continue;
    if (Math.abs(x - pathX(z)) < 20) continue;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r) continue;
    const s = range(rng, 1.2, 4.2);
    dummy.position.set(x, h + s * 0.08, z);
    dummy.rotation.set(range(rng, -0.35, 0.35), rng() * Math.PI * 2, range(rng, -0.35, 0.35));
    dummy.scale.set(s, s, s * range(rng, 0.6, 1));
    dummy.updateMatrix();
    slabs.setMatrixAt(placed, dummy.matrix);
    placed++;
  }
  slabs.count = placed;
  slabs.instanceMatrix.needsUpdate = true;
  return slabs;
}

/** A ribbon that hugs the terrain along the canyon (river, road). */
function buildRibbon(offsetX, width, lift, material) {
  const positions = [];
  const indices = [];
  const step = 40;
  let row = 0;
  for (let z = WORLD.startZ + 420; z >= WORLD.finishZ - 420; z -= step) {
    const cx = pathX(z) + offsetX;
    const tangent = pathTangent(z);
    const sideX = -tangent.z;
    const sideZ = tangent.x;
    for (const s of [-1, 1]) {
      const x = cx + sideX * (width / 2) * s;
      const zz = z + sideZ * (width / 2) * s;
      positions.push(x, heightAt(x, zz) + lift, zz);
    }
    if (row > 0) {
      const a = (row - 1) * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    row++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}

/** A little bridge where the road crosses the river. */
function buildBridge(z) {
  const group = new THREE.Group();
  const cx = pathX(z) + 17;
  const deckY = Math.max(heightAt(cx - 24, z), heightAt(cx + 24, z)) + 6;
  const deckMat = std(0x9a8f7d, 0.9);
  const deck = addMesh(group, new THREE.BoxGeometry(56, 1.4, 9), deckMat, cx, deckY, z);
  deck.rotation.y = Math.atan2(pathTangent(z).x, -pathTangent(z).z) * 0;
  for (const s of [-1, 1]) {
    const px = cx + s * 22;
    const ground = heightAt(px, z);
    const pylon = addMesh(group, new THREE.BoxGeometry(3.4, deckY - ground, 7), deckMat, px, (deckY + ground) / 2, z);
    pylon.castShadow = true;
    addMesh(group, new THREE.BoxGeometry(56, 0.7, 0.5), std(0x7a6f5d, 0.9), cx, deckY + 1.1, z + s * 4.2);
  }
  return group;
}

/** One house: textured walls, pyramid roof, chimney. */
function buildHouse(rng, wallTex, glowTex, roofMats) {
  const house = new THREE.Group();
  const w = range(rng, 5.5, 8);
  const d = range(rng, 4.5, 6.5);
  const hgt = range(rng, 2.8, 3.6);
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTex, roughness: 0.9,
    emissive: 0xffc98a, emissiveMap: glowTex, emissiveIntensity: 0.7,
    color: new THREE.Color().setHSL(rng() * 0.12, 0.25, range(rng, 0.82, 0.97)),
  });
  addMesh(house, new THREE.BoxGeometry(w, hgt, d), wallMat, 0, hgt / 2, 0);
  const roof = addMesh(house, new THREE.ConeGeometry(Math.hypot(w, d) * 0.62, range(rng, 1.8, 2.6), 4), roofMats[Math.floor(rng() * roofMats.length)], 0, hgt + 1.1, 0);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(w / Math.hypot(w, d) * 1.25, 1, d / Math.hypot(w, d) * 1.25);
  addMesh(house, new THREE.BoxGeometry(0.7, 1.3, 0.7), std(0x8a7f74, 0.95), w * 0.28, hgt + 1.4, 0);
  house.userData.chimney = new THREE.Vector3(w * 0.28, hgt + 2.1, 0);
  return house;
}

/** A village church: stone nave, steep roof, bell tower with spire and cross. */
function buildChurch() {
  const church = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ map: churchTexture(), roughness: 0.95 });
  addMesh(church, new THREE.BoxGeometry(8, 5.5, 15), wallMat, 0, 2.75, 0);
  const roof = addMesh(church, new THREE.ConeGeometry(7.6, 4.2, 4), std(0x4a5560, 0.85), 0, 7.6, 0);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(0.78, 1, 1.5);
  // Bell tower at the front, with arched belfry openings and a spire.
  addMesh(church, new THREE.BoxGeometry(4.2, 11, 4.2), wallMat, 0, 5.5, -9.2);
  addMesh(church, new THREE.BoxGeometry(4.6, 0.5, 4.6), std(0x8a7f74, 0.95), 0, 11.1, -9.2);
  const spire = addMesh(church, new THREE.ConeGeometry(3.1, 5.4, 4), std(0x3d4a57, 0.85), 0, 14, -9.2);
  spire.rotation.y = Math.PI / 4;
  const gold = new THREE.MeshBasicMaterial({ color: 0xffd97a });
  const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.5, 0.16), gold);
  crossV.position.set(0, 17.4, -9.2);
  const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.16, 0.16), gold);
  crossH.position.set(0, 17.5, -9.2);
  church.add(crossV, crossH);
  return church;
}

/** A farm: red barn, silo, fenced pasture, striped field, hay bales. */
function buildFarm(rng) {
  const farm = new THREE.Group();
  const barnMat = new THREE.MeshStandardMaterial({ map: barnTexture(), roughness: 0.9 });
  addMesh(farm, new THREE.BoxGeometry(10, 5, 8), barnMat, 0, 2.5, 0);
  const roof = addMesh(farm, new THREE.ConeGeometry(7.4, 3.4, 4), std(0x6b7280, 0.85), 0, 6.7, 0);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1.02, 1, 0.82);
  addMesh(farm, new THREE.CylinderGeometry(1.9, 1.9, 9, 12), std(0xb9c2c9, 0.55, 0.25), 7.5, 4.5, -2);
  addMesh(farm, new THREE.SphereGeometry(1.9, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), std(0x9aa6b0, 0.55, 0.25), 7.5, 9, -2);
  // Fenced pasture: posts and two rails merged into one mesh.
  const fenceParts = [];
  const fx = 30;
  const fz = 24;
  const sides = [
    { x: 0, z: -fz / 2, len: fx, ry: 0 }, { x: 0, z: fz / 2, len: fx, ry: 0 },
    { x: -fx / 2, z: 0, len: fz, ry: Math.PI / 2 }, { x: fx / 2, z: 0, len: fz, ry: Math.PI / 2 },
  ];
  for (const side of sides) {
    const posts = Math.floor(side.len / 3);
    for (let i = 0; i <= posts; i++) {
      const t = -side.len / 2 + (i / posts) * side.len;
      const px = side.x + (side.ry === 0 ? t : 0);
      const pz = side.z + (side.ry === 0 ? 0 : t);
      fenceParts.push(transformed(new THREE.BoxGeometry(0.18, 1.15, 0.18), px, 0.57, pz));
    }
    for (const ry of [0.5, 0.95]) {
      fenceParts.push(transformed(new THREE.BoxGeometry(side.len, 0.12, 0.08), side.x, ry, side.z, 1, 1, 1, side.ry));
    }
  }
  const fence = new THREE.Mesh(mergeGeometries(fenceParts), std(0x8a6a42, 0.95));
  fence.position.set(16, 0, 6);
  fence.castShadow = true;
  fence.receiveShadow = true;
  farm.add(fence);
  // Striped crop field beside the barn.
  const field = new THREE.Mesh(
    new THREE.PlaneGeometry(48, 36),
    new THREE.MeshStandardMaterial({ map: fieldTexture(), roughness: 1 }),
  );
  field.rotation.x = -Math.PI / 2;
  field.position.set(-16, 0.3, 14);
  field.receiveShadow = true;
  farm.add(field);
  // Hay bales scattered in the field and pasture.
  const baleMat = std(0xd9b95e, 1);
  for (let i = 0; i < 6; i++) {
    const bale = addMesh(farm, new THREE.CylinderGeometry(1.05, 1.05, 1.5, 10), baleMat, range(rng, -34, 2), 1.05, range(rng, -2, 30));
    bale.rotation.z = Math.PI / 2;
    bale.rotation.y = rng() * Math.PI;
  }
  return farm;
}

/** */
function buildVillages(rng, clearSpots, count = 3) {
  const group = new THREE.Group();
  const smokeEmitters = [];
  const wallTex = houseTexture();
  const glowTex = houseGlowTexture();
  const roofMats = [std(0xa8442e, 0.85), std(0x5d6d7e, 0.85), std(0x7a4a35, 0.85)];
  const sites = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    sites.push({ z: Math.round(lerp(1700, -1700, t) + range(rng, -160, 160)), side: i % 2 ? -1 : 1 });
  }
  for (const site of sites) {
    const baseX = pathX(site.z) + site.side * 88;
    clearSpots.push({ x: baseX, z: site.z, r: 95 });
    const church = buildChurch();
    church.position.set(baseX, heightAt(baseX, site.z) - 0.2, site.z);
    church.rotation.y = rng() * Math.PI * 2;
    group.add(church);
    const n = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const x = baseX + range(rng, -55, 55);
      const z = site.z + range(rng, -60, 60);
      const house = buildHouse(rng, wallTex, glowTex, roofMats);
      house.position.set(x, heightAt(x, z) - 0.2, z);
      house.rotation.y = rng() * Math.PI * 2;
      group.add(house);
      if (i < 2) {
        const top = house.userData.chimney.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), house.rotation.y);
        smokeEmitters.push(new THREE.Vector3(x + top.x, heightAt(x, z) - 0.2 + top.y, z + top.z));
      }
    }
    const farmX = baseX + site.side * 70;
    const farmZ = site.z + 55;
    clearSpots.push({ x: farmX, z: farmZ, r: 60 });
    const farm = buildFarm(rng);
    farm.position.set(farmX, heightAt(farmX, farmZ) - 0.2, farmZ);
    farm.rotation.y = rng() * Math.PI * 2;
    group.add(farm);
  }
  return { group, smokeEmitters };
}

/** Chimney smoke: a pool of soft sprites per emitter, rising and fading. */
function buildSmoke(emitters) {
  const group = new THREE.Group();
  const tex = cloudTexture();
  const puffs = [];
  for (const emitter of emitters) {
    for (let i = 0; i < 7; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0, depthWrite: false, color: 0xd8dde2,
      }));
      group.add(sprite);
      puffs.push({ sprite, emitter, offset: i / 7 });
    }
  }
  return { group, puffs };
}

/** Wind turbines on the high ground, rotors turning. */
function buildTurbines(rng) {
  const group = new THREE.Group();
  const rotors = [];
  const white = std(0xeef2f5, 0.5, 0.1);
  let placed = 0;
  let guard = 0;
  while (placed < 5 && guard < 300) {
    guard++;
    const x = range(rng, -1900, 1900);
    const z = range(rng, -1900, 1900);
    const h = heightAt(x, z);
    if (h < 170 || slopeAt(x, z) > 0.3) continue;
    if (Math.abs(x - pathX(z)) < 300) continue;
    const turbine = new THREE.Group();
    turbine.position.set(x, h - 0.5, z);
    addMesh(turbine, new THREE.CylinderGeometry(0.9, 1.5, 27, 10), white, 0, 13.5, 0);
    addMesh(turbine, new THREE.BoxGeometry(2.2, 2.2, 5.5), white, 0, 27.5, 0);
    const rotor = new THREE.Group();
    rotor.position.set(0, 27.5, -3.2);
    for (let i = 0; i < 3; i++) {
      const blade = addMesh(rotor, new THREE.BoxGeometry(0.55, 10.5, 0.16), white, 0, 5.2, 0);
      const holder = new THREE.Group();
      holder.rotation.z = (i / 3) * Math.PI * 2;
      holder.add(blade);
      rotor.add(holder);
    }
    addMesh(rotor, new THREE.SphereGeometry(0.9, 10, 8), white, 0, 0, 0);
    turbine.add(rotor);
    turbine.rotation.y = rng() * Math.PI * 2;
    rotors.push(rotor);
    group.add(turbine);
    placed++;
  }
  return { group, rotors };
}

/** A striped lighthouse with a slowly sweeping beam. */
function buildLighthouse() {
  const group = new THREE.Group();
  const x = pathX(WORLD.finishZ) + 150;
  const z = WORLD.finishZ + 130;
  const base = heightAt(x, z);
  group.position.set(x, base - 0.5, z);
  const bands = [0xf2f4f6, 0xd23b2e, 0xf2f4f6, 0xd23b2e, 0xf2f4f6];
  bands.forEach((color, i) => {
    const r = 3.2 - i * 0.28;
    addMesh(group, new THREE.CylinderGeometry(r - 0.28, r, 4.4, 14), std(color, 0.6), 0, 2.2 + i * 4.4, 0);
  });
  addMesh(group, new THREE.CylinderGeometry(2.1, 2.1, 1.6, 12), std(0x2b2f36, 0.6), 0, 23.2, 0);
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe9a8 }),
  );
  lamp.position.y = 23.2;
  group.add(lamp);
  addMesh(group, new THREE.ConeGeometry(2.6, 2, 12), std(0x2b2f36, 0.6), 0, 25, 0);
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(7, 90, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffe9a8, transparent: true, opacity: 0.13,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  beam.rotation.z = Math.PI / 2;
  beam.position.set(45, 23.2, 0);
  const beamPivot = new THREE.Group();
  beamPivot.add(beam);
  group.add(beamPivot);
  return { group, beamPivot };
}

/** Hot-air balloons drifting on slow circles. */
function buildBalloons(rng) {
  const group = new THREE.Group();
  const balloons = [];
  const schemes = [['#e8452c', '#ffd23c'], ['#2456c8', '#f4f6f8'], ['#7a3fa0', '#ffb84d']];
  for (let i = 0; i < 3; i++) {
    const balloon = new THREE.Group();
    const envelope = new THREE.Mesh(
      new THREE.SphereGeometry(6.2, 20, 14),
      new THREE.MeshStandardMaterial({ map: balloonTexture(schemes[i][0], schemes[i][1]), roughness: 0.6 }),
    );
    envelope.scale.set(1, 1.12, 1);
    envelope.castShadow = true;
    balloon.add(envelope);
    addMesh(balloon, new THREE.BoxGeometry(1.7, 1.3, 1.7), std(0x8a6a42, 0.95), 0, -8, 0);
    const anchor = new THREE.Vector3(
      pathX(range(rng, -1200, 1200)) + range(rng, -500, 500),
      range(rng, 210, 310),
      range(rng, -1400, 1400),
    );
    balloons.push({ group: balloon, anchor, phase: rng() * Math.PI * 2, radius: range(rng, 90, 200), speed: range(rng, 0.014, 0.026) });
    group.add(balloon);
  }
  return { group, balloons };
}

/** */
function buildBirds(rng, quality) {
  const group = new THREE.Group();
  const flocks = [];
  const birdPositions = [];
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -1.5, 0, 0.5, -1.5, 0, -0.4], 3));
  wingGeo.computeVertexNormals();
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x33404d, side: THREE.DoubleSide });
  const bodyGeo = new THREE.ConeGeometry(0.16, 0.85, 6);
  const perFlock = Math.max(3, Math.round(quality.birds / 2));
  for (let f = 0; f < 2; f++) {
    const birds = [];
    for (let i = 0; i < perFlock; i++) {
      const bird = new THREE.Group();
      const left = new THREE.Mesh(wingGeo, birdMat);
      const right = new THREE.Mesh(wingGeo, birdMat);
      right.scale.x = -1;
      const body = new THREE.Mesh(bodyGeo, birdMat);
      body.rotation.x = -Math.PI / 2;
      bird.add(left, right, body);
      const baseOffset = new THREE.Vector3(range(rng, -30, 30), range(rng, -8, 8), range(rng, -30, 30));
      bird.position.set(0, 160, 0);
      group.add(bird);
      birdPositions.push(bird.position);
      birds.push({
        group: bird, left, right,
        vel: new THREE.Vector3(0, 0, -13),
        baseOffset,
        seedA: rng() * Math.PI * 2,
        seedB: rng() * Math.PI * 2,
        // Each bird also circles its own slot, thermal-style, so paths
        // curve continuously instead of tracking the anchor in a line.
        orbitR: range(rng, 16, 28),
        orbitRate: range(rng, 0.4, 0.6) * (f ? -1 : 1),
        mode: rng() < 0.5 ? 'flap' : 'glide',
        modeTimer: range(rng, 1.5, 5),
        flapPhase: rng() * Math.PI * 2,
        prevHeading: 0,
        bank: 0,
        struck: false,
        fallTimer: 0,
      });
    }
    flocks.push({
      birds,
      centre: new THREE.Vector3(pathX(f ? -1500 : 1500) + range(rng, -300, 300), 0, f ? -1500 : 1500),
      altBase: range(rng, 150, 210),
      radius: range(rng, 200, 300),
      // Anchor tangential speed (speed x radius) stays well under the
      // birds' 13.5 m/s cruise, so they orbit with it instead of chasing
      // it in a straight pursuit line.
      speed: range(rng, 0.015, 0.024),
      phase: rng() * Math.PI * 2,
    });
  }

  const _target = new THREE.Vector3();
  const _desired = new THREE.Vector3();
  const _steer = new THREE.Vector3();

  function anchorAt(flock, time, out) {
    const a = flock.phase + time * flock.speed;
    const driftX = Math.sin(time * 0.03 + flock.phase) * 70;
    const driftZ = Math.cos(time * 0.025 + flock.phase) * 70;
    out.set(
      flock.centre.x + driftX + Math.cos(a) * flock.radius,
      flock.altBase + Math.sin(time * 0.11 + flock.phase) * 30,
      flock.centre.z + driftZ + Math.sin(a) * flock.radius,
    );
    return out;
  }

  // Spawn each bird at its formation slot so the flock starts orbiting,
  // not commuting across the map in a straight line.
  {
    const spawn = new THREE.Vector3();
    for (const flock of flocks) {
      anchorAt(flock, 0, spawn);
      for (const b of flock.birds) b.group.position.copy(spawn).add(b.baseOffset);
    }
  }

  /** Animate the flocks one step; planePos scatters them when close. */
  function updateBirds(dt, time, planePos) {
    for (const flock of flocks) {
      anchorAt(flock, time, _target);
      for (const b of flock.birds) {
        const pos = b.group.position;
        if (b.struck) {
          b.fallTimer += dt;
          b.vel.y -= 7 * dt;
          b.vel.multiplyScalar(Math.max(0, 1 - 0.7 * dt));
          pos.addScaledVector(b.vel, dt);
          b.group.rotation.z += dt * 7;
          b.group.rotation.x += dt * 3;
          if (pos.y < heightAt(pos.x, pos.z) + 0.6 || b.fallTimer > 7) {
            pos.copy(_target).add(b.baseOffset);
            b.vel.set(0, 0, -13);
            b.group.rotation.set(0, 0, 0);
            b.struck = false;
            b.mode = 'flap';
            b.modeTimer = 3;
          }
          continue;
        }
        // Formation slot slowly morphs so the flock never looks rigid,
        // and each bird circles its slot like a thermal rider.
        const oa = time * b.orbitRate + b.seedA * 3;
        const tx = _target.x + b.baseOffset.x + Math.cos(oa) * b.orbitR + Math.sin(time * 0.31 + b.seedA) * 9;
        const ty = _target.y + b.baseOffset.y + Math.sin(time * 0.47 + b.seedB) * 6;
        const tz = _target.z + b.baseOffset.z + Math.sin(oa) * b.orbitR + Math.cos(time * 0.27 + b.seedA) * 9;
        _desired.set(tx - pos.x, (ty - pos.y) * 0.7, tz - pos.z);
        const dist = Math.max(1, _desired.length());
        _desired.divideScalar(dist).multiplyScalar(13.5);
        // Flap climbs, glide sinks: the classic flap-glide cycle.
        b.modeTimer -= dt;
        if (b.modeTimer <= 0) {
          b.mode = b.mode === 'flap' ? 'glide' : 'flap';
          b.modeTimer = b.mode === 'flap' ? range(Math.random, 2, 4) : range(Math.random, 3, 6);
        }
        _desired.y += b.mode === 'flap' ? 1.6 : -1.25;
        // Scatter from the plane: flee hard and flap.
        const dx = pos.x - planePos.x;
        const dy = pos.y - planePos.y;
        const dz = pos.z - planePos.z;
        const dPlane = Math.hypot(dx, dy, dz);
        if (dPlane < 75) {
          const flee = (75 - dPlane) * 0.55;
          _desired.x += (dx / Math.max(1, dPlane)) * flee;
          _desired.y += (dy / Math.max(1, dPlane)) * flee * 0.5 + 1.5;
          _desired.z += (dz / Math.max(1, dPlane)) * flee;
          b.mode = 'flap';
          b.modeTimer = Math.max(b.modeTimer, 1.2);
        }
        // Limited-acceleration steering gives curved, banked flight paths.
        _steer.copy(_desired).sub(b.vel);
        const steerLen = _steer.length();
        if (steerLen > 6.5) _steer.multiplyScalar(6.5 / steerLen);
        b.vel.addScaledVector(_steer, dt);
        pos.addScaledVector(b.vel, dt);
        const speed = Math.max(1, b.vel.length());
        const heading = Math.atan2(b.vel.x, -b.vel.z);
        let dh = heading - b.prevHeading;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        b.prevHeading = heading;
        const turnRate = dt > 0 ? dh / dt : 0;
        const bankTarget = Math.max(-0.75, Math.min(0.75, -turnRate * 1.1));
        b.bank += (bankTarget - b.bank) * Math.min(1, dt * 3);
        b.group.rotation.set(Math.asin(Math.max(-1, Math.min(1, b.vel.y / speed))) * 0.7, Math.atan2(-b.vel.x, -b.vel.z), b.bank);
        const flap = b.mode === 'flap'
          ? Math.sin(time * 10 + b.flapPhase) * 0.8
          : 0.18;
        b.left.rotation.z = flap;
        b.right.rotation.z = -flap;
      }
    }
  }

  /** Mark the nearest bird to pos as struck (it tumbles and respawns). */
  function strikeBirdAt(pos, radius = 4) {
    let best = null;
    let bestD = radius;
    for (const flock of flocks) {
      for (const b of flock.birds) {
        if (b.struck) continue;
        const d = b.group.position.distanceTo(pos);
        if (d < bestD) { bestD = d; best = b; }
      }
    }
    if (!best) return false;
    best.struck = true;
    best.fallTimer = 0;
    best.vel.multiplyScalar(0.3);
    return true;
  }

  return { group, flocks, birdPositions, updateBirds, strikeBirdAt };
}

/** */
function buildStormClouds(rng, mapDef) {
  const group = new THREE.Group();
  const tex = cloudTexture();
  const darkMat = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, opacity: 0.96, color: 0x3d4654, fog: false,
  });
  const flashMat = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, opacity: 0, color: 0xeaf2ff,
    blending: THREE.AdditiveBlending, fog: false,
  });
  const cells = [];
  const count = mapDef.stormClouds;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const z = lerp(1700, -1700, t) + range(rng, -300, 300);
    const centre = new THREE.Vector3(
      pathX(z) + range(rng, -420, 420),
      range(rng, 210, 330),
      z,
    );
    const radius = range(rng, 130, 195);
    const cell = new THREE.Group();
    const n = 11 + Math.floor(rng() * 4);
    for (let j = 0; j < n; j++) {
      const sprite = new THREE.Sprite(darkMat);
      sprite.position.set(
        range(rng, -radius * 0.55, radius * 0.55),
        range(rng, -26, 30),
        range(rng, -radius * 0.55, radius * 0.55),
      );
      const s = range(rng, 150, 300);
      sprite.scale.set(s, s * 0.55, 1);
      cell.add(sprite);
    }
    const flash = new THREE.Sprite(flashMat.clone());
    flash.scale.set(radius * 1.5, radius * 0.9, 1);
    cell.add(flash);
    cell.position.copy(centre);
    group.add(cell);
    cells.push({
      group: cell, pos: cell.position, radius,
      flash, flashAt: range(rng, 1, 5), flashT: -1,
      drift: range(rng, 1.5, 3),
    });
  }
  function updateStormClouds(dt, time) {
    for (const c of cells) {
      c.pos.x += c.drift * dt;
      if (c.pos.x > 3300) c.pos.x = -3300;
      if (c.flashT >= 0) {
        c.flashT += dt;
        // Double-blink lightning: two quick pulses then dark.
        const k = c.flashT;
        c.flash.material.opacity = (k < 0.09 || (k > 0.16 && k < 0.26)) ? 0.85 : 0;
        if (k > 0.3) { c.flashT = -1; c.flashAt = time + 1.5 + Math.random() * 4.5; }
      } else if (time >= c.flashAt) {
        c.flashT = 0;
      }
    }
  }
  return { group, cells, updateStormClouds };
}

/** A simple AI prop plane for traffic (nose toward -Z). */
function buildTrafficPlane(color) {
  const plane = new THREE.Group();
  const bodyMat = std(color, 0.5, 0.1);
  const dark = std(0x2b2f36, 0.6, 0.2);
  const body = addMesh(plane, new THREE.CylinderGeometry(0.55, 0.28, 6.4, 10), bodyMat, 0, 0, 0.4, false);
  body.rotation.x = Math.PI / 2;
  addMesh(plane, new THREE.BoxGeometry(8.6, 0.16, 1.5), bodyMat, 0, 0.1, -0.4, false);
  addMesh(plane, new THREE.BoxGeometry(2.9, 0.12, 0.95), bodyMat, 0, 0.25, 3.1, false);
  addMesh(plane, new THREE.BoxGeometry(0.12, 1.15, 0.95), dark, 0, 0.7, 3.1, false);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.25, 20),
    new THREE.MeshBasicMaterial({ color: 0xdfe9f2, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  );
  disc.position.set(0, 0, -2.85);
  plane.add(disc);
  plane.rotation.order = 'YXZ';
  return plane;
}

/** */
function buildTraffic(rng, quality, mapDef) {
  const group = new THREE.Group();
  const planes = [];
  const trafficPositions = [];
  const colors = [0xd23b2e, 0x2e7fd2, 0xf2f4f6, 0xffb02e, 0x3fae6a];
  const count = quality.shadows ? mapDef.traffic : Math.max(1, mapDef.traffic - 1);
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const z = lerp(1600, -1600, t) + range(rng, -250, 250);
    const plane = buildTrafficPlane(colors[i % colors.length]);
    group.add(plane);
    trafficPositions.push(plane.position);
    planes.push({
      group: plane,
      centre: new THREE.Vector3(pathX(z) + range(rng, -260, 260), range(rng, 175, 330), z),
      radius: range(rng, 520, 980),
      speed: range(rng, 42, 58),
      dir: i % 2 ? -1 : 1,
      angle: rng() * Math.PI * 2,
      phase: rng() * Math.PI * 2,
      prevHeading: 0,
      bank: 0,
    });
  }
  function updateTraffic(dt, time) {
    for (const p of planes) {
      p.angle += (p.speed / p.radius) * dt * p.dir;
      const breathe = 1 + 0.08 * Math.sin(time * 0.06 + p.phase);
      const r = p.radius * breathe;
      const x = p.centre.x + Math.cos(p.angle) * r;
      const z = p.centre.z + Math.sin(p.angle) * r;
      const y = p.centre.y + Math.sin(time * 0.09 + p.phase) * 10;
      const vx = -Math.sin(p.angle) * p.speed * p.dir;
      const vz = Math.cos(p.angle) * p.speed * p.dir;
      p.group.position.set(x, y, z);
      const heading = Math.atan2(vx, -vz);
      let dh = heading - p.prevHeading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      p.prevHeading = heading;
      const turnRate = dt > 0 ? dh / dt : 0;
      const bankTarget = Math.max(-0.62, Math.min(0.62, -turnRate * p.speed / 9.81));
      p.bank += (bankTarget - p.bank) * Math.min(1, dt * 2.5);
      p.group.rotation.set(0, -heading, p.bank);
    }
  }
  return { group, planes, trafficPositions, updateTraffic };
}
/** Two distant airliners cruising big lazy circles, pure scenery. */
function buildDistantPlanes(rng) {
  const group = new THREE.Group();
  const planes = [];
  for (let i = 0; i < 2; i++) {
    const plane = new THREE.Group();
    const body = addMesh(plane, new THREE.CylinderGeometry(1.5, 1.1, 17, 10), std(0xeef2f5, 0.5), 0, 0, 0, false);
    body.rotation.x = Math.PI / 2;
    addMesh(plane, new THREE.BoxGeometry(15, 0.35, 2.6), std(0xd23b2e, 0.5), 0, 0, 0.5, false);
    addMesh(plane, new THREE.BoxGeometry(0.3, 3.4, 1.8), std(0xd23b2e, 0.5), 0, 1.6, 7.8, false);
    addMesh(plane, new THREE.BoxGeometry(5.4, 0.3, 1.6), std(0xeef2f5, 0.5), 0, 0.5, 7.8, false);
    planes.push({
      group: plane,
      centre: new THREE.Vector3(range(rng, -600, 600), range(rng, 400, 470), range(rng, -900, 900)),
      radius: range(rng, 1000, 1400),
      speed: range(rng, 0.016, 0.024) * (i ? -1 : 1),
      phase: rng() * Math.PI * 2,
    });
    group.add(plane);
  }
  return { group, planes };
}

/** A waterfall spilling off the canyon's west wall, with mist at its foot. */
function buildWaterfall(rng) {
  const group = new THREE.Group();
  const z = 520;
  const lipX = pathX(z) - 165;
  const lipY = heightAt(lipX, z);
  const footX = pathX(z) - 55;
  const footY = heightAt(footX, z);
  const drop = Math.max(18, lipY - footY);
  const tex = waterfallTexture();
  const falls = new THREE.Mesh(
    new THREE.PlaneGeometry(11, drop),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.9 }),
  );
  falls.position.set((lipX + footX) / 2, footY + drop / 2, z);
  falls.rotation.y = Math.PI / 2;
  falls.rotation.x = -0.32;
  group.add(falls);
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(16, 20),
    new THREE.MeshStandardMaterial({ color: COLORS.river, metalness: 0.5, roughness: 0.2 }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(footX, footY + 0.7, z);
  group.add(pool);
  const mistTex = cloudTexture();
  const mists = [];
  for (let i = 0; i < 8; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: mistTex, transparent: true, opacity: 0.4, depthWrite: false }));
    sprite.position.set(footX + range(rng, -7, 7), footY + range(rng, 2, 7), z + range(rng, -7, 7));
    const s = range(rng, 9, 18);
    sprite.scale.set(s, s * 0.6, 1);
    sprite.userData.phase = rng() * Math.PI * 2;
    group.add(sprite);
    mists.push(sprite);
  }
  return { group, tex, mists };
}

/** Two crossed vertical quads — the classic cheap billboard for plants. */
function crossQuads(w, h) {
  const a = new THREE.PlaneGeometry(w, h);
  a.translate(0, h / 2, 0);
  const b = new THREE.PlaneGeometry(w, h);
  b.translate(0, h / 2, 0);
  b.rotateY(Math.PI / 2);
  return mergeGeometries([a, b]);
}

/** A short stream ribbon from the river into the lake, hugging the ground. */
function buildInlet() {
  const positions = [];
  const indices = [];
  const fromX = pathX(LAKE.z);
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = lerp(fromX, LAKE.x - LAKE.r * 0.55, t);
    const cz = LAKE.z + Math.sin(t * Math.PI) * 14;
    for (const s of [-1, 1]) {
      const x = cx;
      const z = cz + s * 4.5;
      positions.push(x, heightAt(x, z) + 0.85, z);
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: COLORS.river, metalness: 0.55, roughness: 0.18, transparent: true, opacity: 0.94,
  }));
  mesh.receiveShadow = true;
  return mesh;
}

/** A little rowing boat: tapered hull, bench, optional mast. */
function buildBoat(hullColor, withMast) {
  const boat = new THREE.Group();
  const hullMat = std(hullColor, 0.6);
  const hull = addMesh(boat, new THREE.BoxGeometry(5.6, 1.1, 2.1), hullMat, 0, 0.55, 0);
  hull.scale.set(1, 1, 1);
  const bow = addMesh(boat, new THREE.ConeGeometry(1.05, 2.2, 4), hullMat, 3.6, 0.55, 0);
  bow.rotation.z = -Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  bow.scale.set(1, 1, 0.55);
  addMesh(boat, new THREE.BoxGeometry(5.8, 0.16, 2.3), std(0x8a6a42, 0.9), 0, 1.12, 0);
  addMesh(boat, new THREE.BoxGeometry(0.5, 0.12, 1.8), std(0x6d5138, 0.9), -0.6, 0.95, 0);
  addMesh(boat, new THREE.BoxGeometry(0.5, 0.12, 1.8), std(0x6d5138, 0.9), 1.4, 0.95, 0);
  if (withMast) {
    addMesh(boat, new THREE.CylinderGeometry(0.07, 0.09, 5.4, 6), std(0x6d5138, 0.9), 0.4, 3.4, 0);
    const sail = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ color: 0xf4f1e6, side: THREE.DoubleSide, roughness: 0.9 }),
    );
    sail.geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0.45, 6.0, 0, 0.45, 1.3, 0, 3.1, 1.3, 0,
    ], 3));
    sail.geometry.computeVertexNormals();
    sail.castShadow = true;
    boat.add(sail);
  }
  return boat;
}

/** */
function buildLake(rng, quality) {
  const group = new THREE.Group();
  const waterMat = new THREE.MeshStandardMaterial({
    color: COLORS.river, metalness: 0.85, roughness: 0.13, transparent: true, opacity: 0.97,
  });
  // Full-strength sky reflection on the water (tiered by quality) so the
  // PMREM sun spot glints off the surface; scenery stays at a whisper.
  waterMat.userData.envI = quality.waterEnv ?? 0.8;
  const water = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r * 0.96, 44), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(LAKE.x, LAKE.level, LAKE.z);
  water.receiveShadow = true;
  group.add(water);
  // Sun glitter path: an additive streaked band laid along the sun azimuth
  // through the lake centre — the bright lane a real low sun draws on
  // water. Skipped on low tier.
  let glitterMat = null;
  if (quality.glitter) {
    const glitterTex = canvasTexture(128, 256, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < 340; i++) {
        const x = w / 2 + (Math.random() - 0.5) * w * 0.72;
        const y = Math.random() * h;
        const len = 5 + Math.random() * 16;
        const fall = 1 - Math.abs(x - w / 2) / (w * 0.5);
        ctx.fillStyle = `rgba(255,238,196,${0.1 + fall * 0.5})`;
        ctx.fillRect(x, y, 1.6, len);
      }
      const fade = ctx.createLinearGradient(0, 0, 0, h);
      fade.addColorStop(0, 'rgba(0,0,0,1)');
      fade.addColorStop(0.18, 'rgba(0,0,0,0)');
      fade.addColorStop(0.82, 'rgba(0,0,0,0)');
      fade.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = fade;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    });
    glitterMat = new THREE.MeshBasicMaterial({
      map: glitterTex, transparent: true, opacity: 0.32, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const glitterGeo = new THREE.PlaneGeometry(110, LAKE.r * 1.7);
    glitterGeo.rotateX(-Math.PI / 2);
    const glitter = new THREE.Mesh(glitterGeo, glitterMat);
    glitter.position.set(LAKE.x, LAKE.level + 0.18, LAKE.z);
    glitter.rotation.y = Math.atan2(SUN_DIR.x, SUN_DIR.z);
    glitter.renderOrder = 3;
    group.add(glitter);
  }
  group.add(buildInlet());

  // Dock reaching in from the west shore, posts down into the water.
  const dock = new THREE.Group();
  const dockZ = LAKE.z + 26;
  const shoreX = LAKE.x - LAKE.r * 0.9;
  const dockY = LAKE.level + 0.9;
  const woodMat = std(0x8a6a42, 0.95);
  addMesh(dock, new THREE.BoxGeometry(30, 0.45, 3.6), woodMat, shoreX + 13, dockY, dockZ);
  for (let i = 0; i < 5; i++) {
    for (const s of [-1, 1]) {
      addMesh(dock, new THREE.CylinderGeometry(0.22, 0.22, 3.4, 6), std(0x6d5138, 0.95), shoreX + 1 + i * 6.4, dockY - 1.4, dockZ + s * 1.5);
    }
  }
  group.add(dock);

  const moored = buildBoat(0x2456c8, false);
  moored.position.set(shoreX + 24, LAKE.level + 0.1, dockZ + 4.4);
  moored.rotation.y = 0.4;
  group.add(moored);
  const drifting = buildBoat(0xd23b2e, true);
  group.add(drifting);
  const boats = [
    { group: moored, anchor: moored.position.clone(), phase: rng() * 6, drift: 0 },
    { group: drifting, anchor: new THREE.Vector3(LAKE.x + 30, LAKE.level + 0.1, LAKE.z - 40), phase: rng() * 6, drift: 1 },
  ];

  // Reeds where the shore meets the water.
  const reedGeo = crossQuads(2.8, 2.4);
  const reedMat = new THREE.MeshStandardMaterial({
    map: reedTexture(), alphaTest: 0.32, side: THREE.DoubleSide, roughness: 1,
  });
  const reeds = new THREE.InstancedMesh(reedGeo, reedMat, quality.reeds);
  const dummy = new THREE.Object3D();
  let placed = 0;
  let guard = 0;
  while (placed < quality.reeds && guard < quality.reeds * 16) {
    guard++;
    const a = rng() * Math.PI * 2;
    const rr = LAKE.r * range(rng, 0.74, 1.02);
    const x = LAKE.x + Math.cos(a) * rr;
    const z = LAKE.z + Math.sin(a) * rr;
    const h = heightAt(x, z);
    if (Math.abs(h - LAKE.level) > 2.4) continue;
    dummy.position.set(x, Math.max(h, LAKE.level - 0.4) - 0.1, z);
    dummy.rotation.set(0, rng() * Math.PI, 0);
    dummy.scale.setScalar(range(rng, 0.8, 1.5));
    dummy.updateMatrix();
    reeds.setMatrixAt(placed, dummy.matrix);
    placed++;
  }
  reeds.count = placed;
  reeds.instanceMatrix.needsUpdate = true;
  group.add(reeds);

  return { group, waterMat, boats, glitterMat };
}

/** Conifer belt: instanced pines (trunk + three stacked cones) on the slopes. */
function buildPines(rng, quality, clearSpots) {
  const group = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.3, 2.4, 6);
  trunkGeo.translate(0, 1.2, 0);
  const foliageGeo = mergeGeometries([
    transformed(new THREE.ConeGeometry(1.95, 2.9, 8), 0, 3.1, 0),
    transformed(new THREE.ConeGeometry(1.5, 2.5, 8), 0, 4.6, 0),
    transformed(new THREE.ConeGeometry(1.05, 2.1, 8), 0, 5.9, 0),
  ]);
  const trunks = new THREE.InstancedMesh(trunkGeo, std(0x5a4230, 1), quality.pines);
  const crowns = new THREE.InstancedMesh(foliageGeo, new THREE.MeshStandardMaterial({
    color: 0x2c5a34, roughness: 1, flatShading: true,
  }), quality.pines);
  trunks.castShadow = true;
  crowns.castShadow = true;
  const dummy = new THREE.Object3D();
  let placed = 0;
  let guard = 0;
  while (placed < quality.pines && guard < quality.pines * 16) {
    guard++;
    const x = range(rng, -3300, 3300);
    const z = range(rng, -3300, 3300);
    const h = heightAt(x, z);
    if (h < 100 || h > 300) continue; // the mid-altitude conifer belt
    if (slopeAt(x, z) > 0.5) continue;
    if (Math.abs(x - pathX(z)) < 30) continue;
    let blocked = false;
    for (const spot of clearSpots) {
      if (Math.hypot(x - spot.x, z - spot.z) < spot.r) { blocked = true; break; }
    }
    if (blocked) continue;
    dummy.position.set(x, h - 0.15, z);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    dummy.scale.setScalar(range(rng, 1.15, 2.5));
    dummy.updateMatrix();
    trunks.setMatrixAt(placed, dummy.matrix);
    crowns.setMatrixAt(placed, dummy.matrix);
    placed++;
  }
  trunks.count = placed;
  crowns.count = placed;
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  group.add(trunks, crowns);
  return group;
}

/** Wildflower meadows: clustered instanced flower sprigs on the valley floor. */
function buildFlowers(rng, quality, clearSpots) {
  const geo = crossQuads(1.7, 1.15);
  const mat = new THREE.MeshStandardMaterial({
    map: flowerTexture(), alphaTest: 0.3, side: THREE.DoubleSide, roughness: 1,
  });
  const flowers = new THREE.InstancedMesh(geo, mat, quality.flowers);
  const dummy = new THREE.Object3D();
  let placed = 0;
  let guard = 0;
  while (placed < quality.flowers && guard < quality.flowers * 4) {
    guard++;
    // Pick a meadow centre on flat valley ground, then speckle around it.
    const cx = range(rng, -1500, 1500);
    const cz = range(rng, -2600, 2600);
    if (heightAt(cx, cz) > 125 || slopeAt(cx, cz) > 0.16) continue;
    if (Math.abs(cx - pathX(cz)) < 30) continue;
    let blocked = false;
    for (const spot of clearSpots) {
      if (Math.hypot(cx - spot.x, cz - spot.z) < spot.r) { blocked = true; break; }
    }
    if (blocked) continue;
    const n = Math.min(quality.flowers - placed, 7 + Math.floor(rng() * 8));
    for (let i = 0; i < n; i++) {
      const x = cx + range(rng, -24, 24);
      const z = cz + range(rng, -24, 24);
      dummy.position.set(x, heightAt(x, z) - 0.05, z);
      dummy.rotation.set(0, rng() * Math.PI, 0);
      dummy.scale.setScalar(range(rng, 0.8, 1.6));
      dummy.updateMatrix();
      flowers.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
  }
  flowers.count = placed;
  flowers.instanceMatrix.needsUpdate = true;
  return flowers;
}

/** */
function buildQuadruped(kind) {
  const animal = new THREE.Group();
  const legs = [];
  let headPivot;
  let tail;
  if (kind === 'deer') {
    const coat = std(0xb08954, 0.95);
    const dark = std(0x6d5138, 0.95);
    addMesh(animal, new THREE.BoxGeometry(1.5, 0.72, 0.58), coat, 0, 1.08, 0);
    addMesh(animal, new THREE.BoxGeometry(0.3, 0.3, 0.4), std(0xf2ead8, 0.95), -0.78, 1.2, 0);
    headPivot = new THREE.Group();
    headPivot.position.set(0.72, 1.3, 0);
    addMesh(headPivot, new THREE.BoxGeometry(0.5, 0.55, 0.3), coat, 0.12, 0.22, 0);
    addMesh(headPivot, new THREE.BoxGeometry(0.44, 0.28, 0.26), coat, 0.42, 0.42, 0);
    addMesh(headPivot, new THREE.BoxGeometry(0.2, 0.16, 0.18), dark, 0.68, 0.34, 0);
    for (const s of [-1, 1]) {
      const antler = addMesh(headPivot, new THREE.CylinderGeometry(0.02, 0.035, 0.55, 5), dark, 0.3, 0.78, s * 0.13);
      antler.rotation.x = s * 0.5;
      antler.rotation.z = -0.35;
      const tine = addMesh(headPivot, new THREE.CylinderGeometry(0.015, 0.025, 0.3, 5), dark, 0.42, 0.86, s * 0.22);
      tine.rotation.z = -0.9;
    }
    animal.add(headPivot);
    for (const [lx, lz] of [[0.55, 0.2], [0.55, -0.2], [-0.55, 0.2], [-0.55, -0.2]]) {
      const leg = new THREE.Group();
      leg.position.set(lx, 0.78, lz);
      addMesh(leg, new THREE.BoxGeometry(0.09, 0.8, 0.09), coat, 0, -0.4, 0);
      animal.add(leg);
      legs.push(leg);
    }
    tail = addMesh(animal, new THREE.BoxGeometry(0.28, 0.1, 0.1), coat, -0.85, 1.32, 0);
  } else if (kind === 'cow') {
    const hide = std(0xf2f0ea, 0.95);
    const patch = std(0x2e2a26, 0.95);
    addMesh(animal, new THREE.BoxGeometry(1.95, 1.0, 0.88), hide, 0, 1.18, 0);
    addMesh(animal, new THREE.BoxGeometry(0.7, 0.6, 0.92), patch, -0.3, 1.3, 0);
    addMesh(animal, new THREE.BoxGeometry(0.5, 0.45, 0.92), patch, 0.55, 1.05, 0);
    headPivot = new THREE.Group();
    headPivot.position.set(0.95, 1.45, 0);
    addMesh(headPivot, new THREE.BoxGeometry(0.55, 0.6, 0.42), hide, 0.2, 0.1, 0);
    addMesh(headPivot, new THREE.BoxGeometry(0.3, 0.3, 0.4), std(0xd9a7a0, 0.95), 0.55, -0.05, 0);
    for (const s of [-1, 1]) {
      const horn = addMesh(headPivot, new THREE.ConeGeometry(0.05, 0.34, 6), std(0xd9cfb8, 0.9), 0.05, 0.42, s * 0.3);
      horn.rotation.x = s * 1.2;
    }
    animal.add(headPivot);
    for (const [lx, lz] of [[0.7, 0.3], [0.7, -0.3], [-0.7, 0.3], [-0.7, -0.3]]) {
      const leg = new THREE.Group();
      leg.position.set(lx, 0.85, lz);
      addMesh(leg, new THREE.BoxGeometry(0.13, 0.85, 0.13), hide, 0, -0.42, 0);
      animal.add(leg);
      legs.push(leg);
    }
    tail = addMesh(animal, new THREE.BoxGeometry(0.08, 0.7, 0.08), hide, -1.02, 1.15, 0);
  } else { // sheep
    const wool = new THREE.MeshStandardMaterial({ color: 0xf4f1e6, roughness: 1, flatShading: true });
    const dark = std(0x3a352f, 0.95);
    const body = addMesh(animal, new THREE.IcosahedronGeometry(0.72, 1), wool, 0, 0.92, 0);
    body.scale.set(1.25, 0.85, 0.9);
    headPivot = new THREE.Group();
    headPivot.position.set(0.78, 1.05, 0);
    addMesh(headPivot, new THREE.BoxGeometry(0.42, 0.3, 0.28), dark, 0.22, 0, 0);
    addMesh(headPivot, new THREE.IcosahedronGeometry(0.2, 0), wool, 0.05, 0.16, 0);
    animal.add(headPivot);
    for (const [lx, lz] of [[0.45, 0.22], [0.45, -0.22], [-0.45, 0.22], [-0.45, -0.22]]) {
      const leg = new THREE.Group();
      leg.position.set(lx, 0.55, lz);
      addMesh(leg, new THREE.BoxGeometry(0.08, 0.55, 0.08), dark, 0, -0.27, 0);
      animal.add(leg);
      legs.push(leg);
    }
    tail = addMesh(animal, new THREE.IcosahedronGeometry(0.16, 0), wool, -0.85, 1.0, 0);
  }
  return { group: animal, headPivot, legs, tail };
}

/** */
function buildAnimals(rng, quality) {
  const group = new THREE.Group();
  const grazers = [];
  const herds = [
    { kind: 'deer', count: quality.deer, centre: new THREE.Vector3(pathX(80) + 300, 0, 80), radius: 75 },
    { kind: 'cow', count: quality.cattle, centre: new THREE.Vector3(pathX(-120) - 190, 0, -60), radius: 55 },
    { kind: 'sheep', count: quality.sheep, centre: new THREE.Vector3(pathX(980) + 210, 0, 1040), radius: 60 },
  ];
  for (const herd of herds) {
    for (let i = 0; i < herd.count; i++) {
      const built = buildQuadruped(herd.kind);
      const x = herd.centre.x + range(rng, -herd.radius, herd.radius) * 0.6;
      const z = herd.centre.z + range(rng, -herd.radius, herd.radius) * 0.6;
      built.group.position.set(x, heightAt(x, z), z);
      built.group.rotation.y = rng() * Math.PI * 2;
      group.add(built.group);
      grazers.push({
        ...built,
        home: herd.centre,
        homeRadius: herd.radius,
        state: 'graze',
        timer: range(rng, 1, 6),
        target: new THREE.Vector3(x, 0, z),
        speed: range(rng, 0.8, 1.5),
        phase: rng() * Math.PI * 2,
        headDown: 1,
      });
    }
  }
  return { group, grazers };
}

/** Eagles riding thermals: wide wings, banked circles, rare flap bursts. */
function buildEagles(rng, quality) {
  const group = new THREE.Group();
  const eagles = [];
  const thermals = [
    new THREE.Vector3(LAKE.x, 300, LAKE.z),
    new THREE.Vector3(pathX(-800) - 200, 340, -800),
  ];
  for (let i = 0; i < quality.eagles; i++) {
    const eagle = new THREE.Group();
    const brown = std(0x5a4230, 0.9);
    const body = addMesh(eagle, new THREE.CylinderGeometry(0.22, 0.12, 1.5, 7), brown, 0, 0, 0, false);
    body.rotation.z = Math.PI / 2;
    addMesh(eagle, new THREE.SphereGeometry(0.24, 8, 6), std(0xf4f6f8, 0.9), 0.85, 0.08, 0, false);
    const beak = addMesh(eagle, new THREE.ConeGeometry(0.09, 0.3, 6), std(0xffc93c, 0.8), 1.12, 0.02, 0, false);
    beak.rotation.z = -Math.PI / 2;
    addMesh(eagle, new THREE.BoxGeometry(0.55, 0.05, 0.7), std(0xf4f6f8, 0.9), -0.95, 0, 0, false);
    const wings = [];
    for (const s of [-1, 1]) {
      const wingPivot = new THREE.Group();
      const wing = addMesh(wingPivot, new THREE.BoxGeometry(0.85, 0.05, 2.1), brown, -0.05, 0, s * 1.15, false);
      wing.scale.set(1, 1, 1);
      const tip = addMesh(wingPivot, new THREE.BoxGeometry(0.6, 0.04, 0.9), brown, -0.15, 0, s * 2.5, false);
      tip.rotation.y = s * 0.25;
      eagle.add(wingPivot);
      wings.push({ pivot: wingPivot, side: s });
    }
    group.add(eagle);
    eagles.push({
      group: eagle, wings,
      centre: thermals[i % thermals.length].clone(),
      radius: range(rng, 110, 190),
      speed: range(rng, 0.09, 0.13) * (i ? -1 : 1),
      phase: rng() * Math.PI * 2,
      flapSeed: rng() * 100,
    });
  }
  return { group, eagles };
}

/** Butterflies fluttering over the meadows on lazy lissajous paths. */
function buildButterflies(rng, quality) {
  const group = new THREE.Group();
  const butterflies = [];
  const wingColors = [0xff8a3c, 0xf4f6f8, 0x7fb2d9, 0xffd23c, 0xff5f8f];
  for (let i = 0; i < quality.butterflies; i++) {
    const bf = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: wingColors[Math.floor(rng() * wingColors.length)], side: THREE.DoubleSide,
    });
    const wings = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.3), mat);
      wing.position.x = s * 0.22;
      wing.rotation.x = -Math.PI / 2;
      pivot.add(wing);
      bf.add(pivot);
      wings.push({ pivot, side: s });
    }
    const anchor = new THREE.Vector3(
      pathX(range(rng, -1200, 1200)) + range(rng, -160, 160), 0, range(rng, -1400, 1400),
    );
    group.add(bf);
    butterflies.push({ group: bf, wings, anchor, phase: rng() * Math.PI * 2, speed: range(rng, 0.5, 0.9) });
  }
  return { group, butterflies };
}

/** Fish that leap out of the lake now and then, with a splash at both ends. */
function buildFish(rng) {
  const group = new THREE.Group();
  const fish = [];
  const splashes = [];
  const splashTex = cloudTexture();
  for (let i = 0; i < 6; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: splashTex, transparent: true, opacity: 0, depthWrite: false, color: 0xeaf6ff,
    }));
    group.add(sprite);
    splashes.push({ sprite, age: 99 });
  }
  const fishMat = new THREE.MeshStandardMaterial({ color: 0x9fc6d8, metalness: 0.6, roughness: 0.35 });
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Group();
    const body = addMesh(f, new THREE.ConeGeometry(0.16, 0.95, 7), fishMat, 0, 0, 0, false);
    body.rotation.z = -Math.PI / 2;
    body.scale.set(1, 1, 0.55);
    const tailFin = addMesh(f, new THREE.BoxGeometry(0.3, 0.42, 0.04), fishMat, -0.55, 0, 0, false);
    tailFin.rotation.z = 0.2;
    f.visible = false;
    group.add(f);
    fish.push({
      group: f, state: 'wait', timer: range(rng, 1, 7),
      from: new THREE.Vector3(), dir: new THREE.Vector3(1, 0, 0),
      dist: 6, height: 2.4, t: 0, duration: 0.85,
    });
  }
  return { group, fish, splashes };
}

/** A runway: asphalt slab with painted markings, edge lights, cones. */
function buildRunway(pad, number) {
  const group = new THREE.Group();
  group.position.set(pad.x, pad.h + 0.35, pad.z);
  const slab = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.runwayWidth, WORLD.runwayLength),
    new THREE.MeshStandardMaterial({ map: runwayTexture(number), roughness: 0.95 }),
  );
  slab.rotation.x = -Math.PI / 2;
  slab.receiveShadow = true;
  group.add(slab);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffd98a });
  const lightGeo = new THREE.SphereGeometry(0.55, 8, 6);
  const haloTex = canvasTexture(64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
    g.addColorStop(0, 'rgba(255,224,150,0.85)');
    g.addColorStop(0.35, 'rgba(255,210,110,0.35)');
    g.addColorStop(1, 'rgba(255,200,90,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  const haloMat = new THREE.SpriteMaterial({
    map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  for (let i = 0; i < 12; i++) {
    const z = -WORLD.runwayLength / 2 + (i / 11) * WORLD.runwayLength;
    for (const s of [-1, 1]) {
      const lamp = new THREE.Mesh(lightGeo, lightMat);
      lamp.position.set(s * (WORLD.runwayWidth / 2 + 1.6), 0.55, z);
      group.add(lamp);
      const halo = new THREE.Sprite(haloMat);
      halo.position.copy(lamp.position);
      halo.scale.set(4.2, 4.2, 1);
      group.add(halo);
    }
  }
  const coneMat = std(0xff7a2e, 0.7);
  for (let i = 0; i < 6; i++) {
    const z = -WORLD.runwayLength / 2 + 14 + i * 62;
    addMesh(group, new THREE.ConeGeometry(0.9, 1.9, 8), coneMat, WORLD.runwayWidth / 2 + 5, 0.95, z);
  }
  // PAPI: four approach lights in a row beside the threshold, facing the
  // incoming pilot (approach is from +Z, so lenses face +Z, row on the
  // pilot's left at -X). setWhite(n): n white + (4-n) red — 2+2 on glide.
  const papiLenses = [];
  const papiHalos = [];
  const papiBoxMat = std(0x2b2f36, 0.7, 0.2);
  for (let i = 0; i < 4; i++) {
    const px = -(WORLD.runwayWidth / 2 + 3.4 + i * 3.2);
    const pz = WORLD.runwayLength / 2 - 26;
    addMesh(group, new THREE.BoxGeometry(0.34, 0.9, 0.34), papiBoxMat, px, 0.45, pz);
    addMesh(group, new THREE.BoxGeometry(0.62, 0.44, 0.3), papiBoxMat, px, 1.05, pz);
    const lensMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.32), lensMat);
    lens.position.set(px, 1.05, pz + 0.16);
    lens.userData.papiIndex = i;
    group.add(lens);
    papiLenses.push(lensMat);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55,
    }));
    halo.position.set(px, 1.05, pz + 0.3);
    halo.scale.set(3.4, 3.4, 1);
    group.add(halo);
    papiHalos.push(halo.material);
  }
  group.userData.papi = {
    lenses: papiLenses,
    setWhite(n) {
      const white = Math.max(0, Math.min(4, Math.round(n)));
      for (let i = 0; i < 4; i++) {
        const isWhite = i < white;
        papiLenses[i].color.set(isWhite ? 0xffffff : 0xff2a1e);
        papiHalos[i].color.set(isWhite ? 0xfff6e0 : 0xff5040);
      }
    },
  };
  group.userData.papi.setWhite(2);
  return group;
}

function badgeTexture(number) {
  return canvasTexture(128, 128, (ctx) => {
    ctx.clearRect(0, 0, 128, 128);
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10,24,44,0.82)';
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#ffd97a';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 58px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(number), 64, 68);
  });
}

/** The target rings hanging along the canyon, with badges and light pillars. */
function buildRings(rng, difficulty, mapDef = MAPS.canyon) {
  const group = new THREE.Group();
  const rings = [];
  const zStart = WORLD.startZ - 330;
  const zEnd = WORLD.finishZ + 330;
  for (let i = 0; i < difficulty.rings; i++) {
    const t = difficulty.rings === 1 ? 0.5 : i / (difficulty.rings - 1);
    const z = lerp(zStart, zEnd, t);
    const cx = pathX(z) + range(rng, -mapDef.ringLateral, mapDef.ringLateral);
    const cy = heightAt(cx, z) + range(rng, mapDef.ringAltMin, mapDef.ringAltMax);
    const centre = new THREE.Vector3(cx, cy, z);
    const tangent = pathTangent(z);
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent.clone().negate());
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(difficulty.ringRadius, 0.55, 10, 40),
      new THREE.MeshBasicMaterial({ color: COLORS.ringTodo }),
    );
    torus.position.copy(centre);
    torus.quaternion.copy(quat);
    group.add(torus);
    const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTexture(i + 1), transparent: true, depthWrite: false }));
    badge.position.copy(centre).y += difficulty.ringRadius + 5;
    badge.scale.set(11, 11, 1);
    group.add(badge);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.1, cy - heightAt(cx, z), 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: COLORS.ringTodo, transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    pillar.position.set(cx, (cy + heightAt(cx, z)) / 2, z);
    group.add(pillar);
    rings.push({
      centre, quat, normal: tangent.clone(), radius: difficulty.ringRadius, torus, badge, pillar,
      passed: false, phase: rng() * Math.PI * 2,
    });
  }
  return { group, rings };
}

/** */
/** */
export async function buildWorld(scene, seed, difficulty, qualityKey = 'high', mapDef = MAPS.canyon, onProgress = null, yieldFn = null) {
  reseed(seed, mapDef);
  const baseQuality = QUALITY[qualityKey] || QUALITY.high;
  const mult = mapDef.scatterMult;
  const quality = {
    ...baseQuality,
    trees: Math.round(baseQuality.trees * mult),
    pines: Math.round(baseQuality.pines * mult),
    flowers: Math.round(baseQuality.flowers * mult),
    reeds: Math.round(baseQuality.reeds * mult),
  };
  const rng = createRandom(seed);
  const group = new THREE.Group();
  scene.add(group);
  const report = async (frac, stage) => {
    if (onProgress) onProgress(frac, stage);
    if (yieldFn) await yieldFn();
  };

  const sky = buildSky();
  group.add(sky.dome);
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunTexture(), transparent: true, opacity: 0.92, depthWrite: false, fog: false,
  }));
  sunSprite.scale.set(1500, 1500, 1);
  group.add(sunSprite);

  await report(0.04, 'terrain');
  group.add(buildTerrain());

  const riverMat = new THREE.MeshStandardMaterial({
    color: COLORS.river, metalness: 0.55, roughness: 0.18, transparent: true, opacity: 0.94,
  });
  riverMat.userData.envI = 0.9; // same sun-glint family as the lake
  const river = buildRibbon(0, 15, 1.15, riverMat);
  group.add(river);
  const road = buildRibbon(38, 9, 0.55, std(0xc9b18a, 1));
  group.add(road);
  group.add(buildBridge(-350));

  const clearSpots = [
    { x: pathX(WORLD.startZ), z: WORLD.startZ, r: 250 },
    { x: pathX(WORLD.finishZ), z: WORLD.finishZ, r: 250 },
    { x: LAKE.x, z: LAKE.z, r: LAKE.r + 30 },
  ];
  const lake = buildLake(rng, quality);
  group.add(lake.group);
  await report(0.34, 'vegetation');
  group.add(buildTrees(rng, quality, clearSpots));
  group.add(buildPines(rng, quality, clearSpots));
  group.add(buildBushes(createRandom(seed ^ 0xB05E5), quality, clearSpots)); // private rng: keep shared sequence intact
  group.add(buildFlowers(rng, quality, clearSpots));
  group.add(buildRocks(rng));
  group.add(buildPoplars(createRandom(seed ^ 0xB0B1), quality, clearSpots)); // private rng
  group.add(buildRockSlabs(createRandom(seed ^ 0x51AB))); // private rng
  await report(0.55, 'buildings');
  const villages = buildVillages(rng, clearSpots, mapDef.villages);
  group.add(villages.group);
  const smoke = buildSmoke(villages.smokeEmitters);
  group.add(smoke.group);
  const turbines = buildTurbines(rng);
  group.add(turbines.group);
  const lighthouse = buildLighthouse();
  group.add(lighthouse.group);
  const waterfall = buildWaterfall(rng);
  group.add(waterfall.group);
  await report(0.74, 'creatures');
  const animals = buildAnimals(rng, quality);
  group.add(animals.group);
  const eagles = buildEagles(rng, quality);
  group.add(eagles.group);
  const butterflies = buildButterflies(rng, quality);
  group.add(butterflies.group);
  const fishSet = buildFish(rng);
  group.add(fishSet.group);
  const birds = buildBirds(rng, quality);
  group.add(birds.group);
  const traffic = buildTraffic(rng, quality, mapDef);
  group.add(traffic.group);
  const distant = buildDistantPlanes(rng);
  group.add(distant.group);
  const balloons = buildBalloons(rng);
  group.add(balloons.group);
  await report(0.9, 'course');
  const clouds = buildClouds(rng, quality);
  group.add(clouds.group);
  const cloudShadows = buildCloudShadows(clouds.clusters);
  group.add(cloudShadows.group);
  const stormClouds = buildStormClouds(rng, mapDef);
  group.add(stormClouds.group);

  const startPad = { x: pathX(WORLD.startZ), z: WORLD.startZ, h: padHeightAt(WORLD.startZ) };
  const finishPad = { x: pathX(WORLD.finishZ), z: WORLD.finishZ, h: padHeightAt(WORLD.finishZ) };
  group.add(buildRunway(startPad, '36'));
  const finishRunway = buildRunway(finishPad, '18');
  group.add(finishRunway);

  const ringSet = buildRings(rng, difficulty, mapDef);
  group.add(ringSet.group);
  await report(1, 'done');

  // Keep the image-based lighting at a whisper for scenery materials; the
  // plane opts into full reflections via userData.envI.
  group.traverse((obj) => {
    if (obj.material) {
      for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
        if ('envMapIntensity' in m) m.envMapIntensity = m.userData.envI ?? 0.35;
      }
    }
  });

  const cloudWhite = new THREE.Color(0xffffff);
  const cloudGrey = new THREE.Color(0x8a97a8);
  const dummy = new THREE.Object3D();

  function setRingStates(currentIndex) {
    ringSet.rings.forEach((ring, i) => {
      const color = ring.passed ? COLORS.ringDone : (i === currentIndex ? COLORS.ringNext : COLORS.ringTodo);
      ring.torus.material.color.set(color);
      ring.pillar.material.color.set(color);
      ring.pillar.visible = i === currentIndex;
      ring.badge.visible = !ring.passed;
    });
  }
  setRingStates(0);

  return {
    group,
    heightAt,
    rings: ringSet.rings,
    setRingStates,
    startPad,
    finishPad,
    birdPositions: birds.birdPositions,
    strikeBirdAt: birds.strikeBirdAt,
    trafficPositions: traffic.trafficPositions,
    stormCells: stormClouds.cells,
    cloudPuffs: clouds.puffData, // live positions (drift in update) for in-cloud tests
    papiLenses: finishRunway.userData.papi.lenses,
    /** PAPI approach lights on the finish runway: n white + (4-n) red. */
    setPapi(n) { finishRunway.userData.papi.setWhite(n); },
    /** Grey the sky and clouds over as a storm rolls in (0 clear, 1 storm). */
    setStorm(f) {
      sky.uniforms.stormFactor.value = f;
      clouds.spriteMat.color.copy(cloudWhite).lerp(cloudGrey, f);
      clouds.puffMat.color.copy(cloudWhite).lerp(cloudGrey, f);
      clouds.topMat.color.copy(cloudWhite).lerp(cloudGrey, f);
      sunSprite.material.opacity = 0.92 * (1 - f * 0.85);
    },
    /** Animate the living scenery; focus is the plane (sun + dome follow). */
    update(dt, time, focus, currentRing) {
      sky.dome.position.copy(focus);
      sunSprite.position.copy(focus).addScaledVector(SUN_DIR, 5600);

      for (const sprite of clouds.sprites) {
        sprite.position.x += sprite.userData.drift * dt;
        if (sprite.position.x > 3400) sprite.position.x = -3400;
      }
      clouds.puffData.forEach((p, i) => {
        p.x += p.drift * dt;
        if (p.x > 3400) p.x = -3400;
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.set(p.s, p.s * 0.42, p.s * 0.8);
        dummy.rotation.set(0, p.ry, 0);
        dummy.updateMatrix();
        clouds.puffs.setMatrixAt(i, dummy.matrix);
        dummy.position.y = p.y + p.s * 0.22;
        dummy.scale.set(p.s * 0.72, p.s * 0.3, p.s * 0.58);
        dummy.updateMatrix();
        clouds.tops.setMatrixAt(i, dummy.matrix);
      });
      clouds.puffs.instanceMatrix.needsUpdate = true;
      clouds.tops.instanceMatrix.needsUpdate = true;
      for (const sh of cloudShadows.shadows) {
        sh.cluster.x += sh.cluster.drift * dt;
        if (sh.cluster.x > 3400) sh.cluster.x = -3400;
        sh.mesh.position.x = sh.cluster.x;
        sh.mesh.position.y = heightAt(sh.cluster.x, sh.cluster.z) + 2.2;
      }

      for (const rotor of turbines.rotors) rotor.rotation.z += dt * 1.15;
      lighthouse.beamPivot.rotation.y = time * 0.35;

      for (const b of balloons.balloons) {
        const a = b.phase + time * b.speed;
        b.group.position.set(
          b.anchor.x + Math.cos(a) * b.radius,
          b.anchor.y + Math.sin(time * 0.24 + b.phase) * 6,
          b.anchor.z + Math.sin(a) * b.radius,
        );
      }

      birds.updateBirds(dt, time, focus);
      traffic.updateTraffic(dt, time);
      stormClouds.updateStormClouds(dt, time);

      for (const p of distant.planes) {
        const a = p.phase + time * p.speed;
        p.group.position.set(
          p.centre.x + Math.cos(a) * p.radius,
          p.centre.y,
          p.centre.z + Math.sin(a) * p.radius,
        );
        p.group.rotation.y = -a + (p.speed > 0 ? 0 : Math.PI);
        p.group.rotation.z = 0.18 * Math.sign(p.speed);
      }

      waterfall.tex.offset.y -= dt * 0.55;
      for (const mist of waterfall.mists) {
        mist.material.opacity = 0.3 + 0.16 * Math.sin(time * 1.4 + mist.userData.phase);
      }

      // Lake: sun-glint shimmer, boats bobbing (one slowly drifting).
      lake.waterMat.roughness = 0.13 + 0.05 * Math.sin(time * 0.7);
      if (lake.glitterMat) lake.glitterMat.opacity = 0.3 + 0.08 * Math.sin(time * 0.9);
      for (const boat of lake.boats) {
        const bob = Math.sin(time * 0.9 + boat.phase) * 0.14;
        if (boat.drift) {
          const a = time * 0.02 + boat.phase;
          boat.group.position.set(
            LAKE.x + Math.cos(a) * 55, LAKE.level + 0.1 + bob, LAKE.z + Math.sin(a) * 55,
          );
          boat.group.rotation.y = -a + Math.PI / 2;
        } else {
          boat.group.position.y = boat.anchor.y + bob;
        }
        boat.group.rotation.x = Math.sin(time * 0.7 + boat.phase) * 0.03;
        boat.group.rotation.z = Math.cos(time * 0.8 + boat.phase) * 0.03;
      }

      // Chimney smoke: each puff rises, swells, drifts with the wind, fades.
      for (const puff of smoke.puffs) {
        const age = (time * 0.22 + puff.offset) % 1;
        puff.sprite.position.set(
          puff.emitter.x + age * 3.2,
          puff.emitter.y + age * 10,
          puff.emitter.z + age * 1.1,
        );
        const s = 1.6 + age * 5.5;
        puff.sprite.scale.set(s, s * 0.75, 1);
        puff.sprite.material.opacity = 0.32 * (1 - age) * Math.min(1, age * 6);
      }

      // Grazing animals: graze (head down) -> walk (legs swing) -> graze.
      for (const g of animals.grazers) {
        g.timer -= dt;
        if (g.state === 'graze') {
          g.headDown = Math.min(1, g.headDown + dt * 1.4);
          for (const leg of g.legs) leg.rotation.z *= 0.8;
          if (g.tail) g.tail.rotation.y = Math.sin(time * 2.2 + g.phase) * 0.5;
          if (g.timer <= 0) {
            g.state = 'walk';
            g.timer = 14;
            const a = Math.random() * Math.PI * 2;
            const rr = Math.random() * g.homeRadius;
            g.target.set(g.home.x + Math.cos(a) * rr, 0, g.home.z + Math.sin(a) * rr);
          }
        } else {
          g.headDown = Math.max(0, g.headDown - dt * 2);
          const dx = g.target.x - g.group.position.x;
          const dz = g.target.z - g.group.position.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 1.2 || g.timer <= 0) {
            g.state = 'graze';
            g.timer = 3 + Math.random() * 4.5;
          } else {
            const heading = Math.atan2(-dz, dx);
            let dh = heading - g.group.rotation.y;
            while (dh > Math.PI) dh -= Math.PI * 2;
            while (dh < -Math.PI) dh += Math.PI * 2;
            g.group.rotation.y += Math.max(-dt * 1.2, Math.min(dt * 1.2, dh));
            g.group.position.x += Math.cos(g.group.rotation.y) * g.speed * dt;
            g.group.position.z += -Math.sin(g.group.rotation.y) * g.speed * dt;
            const swing = Math.sin(time * 5.2 + g.phase) * 0.45;
            g.legs[0].rotation.z = swing;
            g.legs[3].rotation.z = swing;
            g.legs[1].rotation.z = -swing;
            g.legs[2].rotation.z = -swing;
          }
        }
        g.headPivot.rotation.z = -g.headDown * 0.85 + Math.sin(time * 1.3 + g.phase) * 0.05 * g.headDown;
        g.group.position.y = heightAt(g.group.position.x, g.group.position.z);
      }

      // Eagles: banked thermal circles, mostly gliding, rare flap bursts.
      for (const e of eagles.eagles) {
        const a = e.phase + time * e.speed;
        const cx = e.centre.x + Math.sin(time * 0.05 + e.phase) * 60;
        const cz = e.centre.z + Math.cos(time * 0.04 + e.phase) * 60;
        const breathe = 1 + 0.14 * Math.sin(time * 0.07 + e.phase);
        e.group.position.set(
          cx + Math.cos(a) * e.radius * breathe,
          e.centre.y + Math.sin(time * 0.11 + e.phase) * 22,
          cz + Math.sin(a) * e.radius * breathe,
        );
        e.group.rotation.y = -a + (e.speed > 0 ? Math.PI : 0);
        e.group.rotation.z = 0.38 * Math.sign(e.speed);
        const flapGate = Math.max(0, Math.sin(time * 0.23 + e.flapSeed) - 0.72) * 3.4;
        const flap = Math.sin(time * 6.5 + e.flapSeed) * 0.55 * Math.min(1, flapGate);
        for (const w of e.wings) w.pivot.rotation.x = -w.side * flap + w.side * 0.08;
      }

      // Butterflies: flapping wings on wandering lissajous paths.
      for (const bf of butterflies.butterflies) {
        const t = time * bf.speed + bf.phase;
        const x = bf.anchor.x + Math.sin(t * 0.7) * 14 + Math.sin(t * 1.9) * 4;
        const z = bf.anchor.z + Math.cos(t * 0.53) * 14 + Math.cos(t * 1.6) * 4;
        bf.group.position.set(x, heightAt(x, z) + 0.8 + Math.sin(t * 2.3) * 0.35, z);
        bf.group.rotation.y = Math.atan2(Math.cos(t * 0.7), -Math.sin(t * 0.53)) + Math.PI;
        const flap = Math.sin(time * 21 + bf.phase * 7) * 0.95;
        for (const w of bf.wings) w.pivot.rotation.z = w.side * flap;
      }

      // Fish: wait below the surface, then leap in an arc with splashes.
      const spawnSplash = (x, z) => {
        const s = fishSet.splashes.find((sp) => sp.age > 0.6);
        if (!s) return;
        s.age = 0;
        s.sprite.position.set(x, LAKE.level + 0.5, z);
      };
      for (const f of fishSet.fish) {
        if (f.state === 'wait') {
          f.timer -= dt;
          if (f.timer <= 0) {
            const a = Math.random() * Math.PI * 2;
            const rr = Math.random() * LAKE.r * 0.55;
            f.from.set(LAKE.x + Math.cos(a) * rr, LAKE.level, LAKE.z + Math.sin(a) * rr);
            const da = Math.random() * Math.PI * 2;
            f.dir.set(Math.cos(da), 0, Math.sin(da));
            f.dist = 5 + Math.random() * 3.5;
            f.height = 2 + Math.random() * 1.2;
            f.t = 0;
            f.state = 'leap';
            f.group.visible = true;
            spawnSplash(f.from.x, f.from.z);
          }
        } else {
          f.t += dt / f.duration;
          if (f.t >= 1) {
            spawnSplash(f.from.x + f.dir.x * f.dist, f.from.z + f.dir.z * f.dist);
            f.group.visible = false;
            f.state = 'wait';
            f.timer = 3 + Math.random() * 9;
          } else {
            const arc = Math.sin(Math.PI * f.t);
            f.group.position.set(
              f.from.x + f.dir.x * f.dist * f.t,
              LAKE.level + arc * f.height,
              f.from.z + f.dir.z * f.dist * f.t,
            );
            f.group.rotation.y = Math.atan2(-f.dir.z, f.dir.x);
            f.group.rotation.z = Math.atan2(Math.PI * f.height * Math.cos(Math.PI * f.t), f.dist);
          }
        }
      }
      for (const s of fishSet.splashes) {
        if (s.age > 0.6) { s.sprite.material.opacity = 0; continue; }
        s.age += dt;
        const k = Math.min(1, s.age / 0.55);
        const sc = 1.2 + k * 3.4;
        s.sprite.scale.set(sc, sc * 0.55, 1);
        s.sprite.material.opacity = 0.75 * (1 - k);
        s.sprite.position.y = LAKE.level + 0.5 + k * 0.7;
      }

      ringSet.rings.forEach((ring, i) => {
        if (i === currentRing && !ring.passed) {
          const pulse = 1 + Math.sin(time * 3.2 + ring.phase) * 0.045;
          ring.torus.scale.setScalar(pulse);
        } else {
          ring.torus.scale.setScalar(1);
        }
      });
    },
  };
}
