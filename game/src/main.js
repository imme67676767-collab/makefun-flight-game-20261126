// Sky Ring Runner — entry point and game loop.
//
// Fly a prop plane down a mountain canyon, thread the glowing rings in
// order, grab the pickups between them, mind the weather and the traffic,
// and put her down on the far runway. This file owns the front-end flow
// (title -> map -> plane -> difficulty -> loading -> cinematic ->
// countdown -> flight -> celebration -> results), the cameras, scoring,
// hull damage, pickups, weather scheduling and the fixed-step loop; the
// world, plane, effects, instruments and sound live in their own modules.

import { BEST_KEY, BESTS_KEY, COLORS, DIFFICULTY, FLIGHT, HEALTH, MAPS, PICKUPS, PLANES, QUALITY, SCORE, STEP, WEATHER, WORLD } from './config.js';
import { createAudio } from './audio.js';
import { createFx } from './fx.js';
import { createHud } from './hud.js';
import { ACTION_CAMERA, ACTION_CONFIRM, ACTION_MUTE, ACTION_PAUSE, ACTION_RESET, createInput } from './input.js';
import { createPickups } from './pickups.js';
import { createPostFx } from './postfx.js';
import { createRandom } from './random.js';
import {
  buildPlaneModel, createFlightState, forwardOf, headingOf, placeInAir, resetToRunway, stepFlight, syncPlaneModel, wingtipPositions,
} from './plane.js';
import { applyLanguage, getSettings, loadSettings, setSetting, t } from './settings.js';
import { stageShot } from './shots.js';
import { createWeather } from './weather.js';
import { LAKE, SUN_DIR, buildWorld, heightAt, pathTangent, pathX } from './world.js';

const THREE = window.THREE;

const params = new URLSearchParams(window.location.search);
const SEED = Number.parseInt(params.get('seed') || '1', 10) || 1;
const SHOT = params.get('shot');

loadSettings();
// Always read settings live: setSetting() swaps in a fresh object, so a
// cached reference would go stale the moment anything changes.
const S = () => getSettings();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.skyHorizon);
scene.fog = new THREE.FogExp2(COLORS.fog, WORLD.fogDensity);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 12000);

// The sun: one warm directional light with soft shadows that follow the
// plane, plus a hemisphere fill — cool sky above, blue-grey ground bounce
// below — so lit faces run warm and shadowed faces run cold.
const sun = new THREE.DirectionalLight(0xffdfae, 2.9);
sun.castShadow = true;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 1.6;
scene.add(sun);
scene.add(sun.target);
const hemi = new THREE.HemisphereLight(0xa8c8ee, 0x54606e, 0.8);
scene.add(hemi);
// Faint warm bounce off the valley floor so undersides do not go dead.
const bounce = new THREE.DirectionalLight(0xffd9b0, 0.22);
bounce.position.set(300, 120, 500);
scene.add(bounce);

// Image-based lighting from a tiny procedural sky: gives the canopy glass
// and painted metal something real to reflect. Materials opt into a
// stronger reflection with userData.envI (the plane does); everything
// else stays at a whisper so the vertex colours keep their say.
{
  const envCanvas = document.createElement('canvas');
  envCanvas.width = 512;
  envCanvas.height = 256;
  const ectx = envCanvas.getContext('2d');
  const grad = ectx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#2b6fd6');
  grad.addColorStop(0.48, '#cfe9ff');
  grad.addColorStop(0.55, '#8fae7a');
  grad.addColorStop(1, '#4c5a3c');
  ectx.fillStyle = grad;
  ectx.fillRect(0, 0, 512, 256);
  const sunGlow = ectx.createRadialGradient(150, 88, 2, 150, 88, 70);
  sunGlow.addColorStop(0, 'rgba(255,244,200,1)');
  sunGlow.addColorStop(1, 'rgba(255,220,150,0)');
  ectx.fillStyle = sunGlow;
  ectx.fillRect(0, 0, 512, 256);
  const envTex = new THREE.CanvasTexture(envCanvas);
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  envTex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(envTex).texture;
  envTex.dispose();
  pmrem.dispose();
}

const post = createPostFx(renderer, scene, camera);

function applyQuality() {
  const q = QUALITY[S().quality] || QUALITY.high;
  renderer.shadowMap.enabled = q.shadows;
  sun.castShadow = q.shadows;
  sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
  sun.shadow.camera.left = -280;
  sun.shadow.camera.right = 280;
  sun.shadow.camera.top = 280;
  sun.shadow.camera.bottom = -280;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 1600;
  if (sun.shadow.map) {
    sun.shadow.map.dispose();
    sun.shadow.map = null;
  }
  post.setQuality(S().quality);
  hud.setCoverMotion(S().quality !== 'low');
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  post.setSize(Math.max(2, size.x), Math.max(2, size.y));
  scene.traverse((obj) => {
    if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => {
      m.needsUpdate = true;
      if ('envMapIntensity' in m) m.envMapIntensity = m.userData.envI ?? 0.35;
    });
  });
}

let model = buildPlaneModel(PLANES.aerobatic);
scene.add(model.group);
const fx = createFx(scene);
const input = createInput();
const hud = createHud();
const audio = createAudio();
let weather = null;

const game = {
  seed: SEED,
  mode: 'title', // title | mapselect | planeselect | difficulty | loading | cinematic | countdown | flying | paused | celebration | finished
  screen: 'title',
  difficultyKey: 'normal',
  difficulty: DIFFICULTY.normal,
  mapKey: 'canyon',
  planeKey: 'aerobatic',
  planeDef: PLANES.aerobatic,
  maxHp: PLANES.aerobatic.hp,
  world: null,
  pickups: null,
  state: null,
  currentRing: 0,
  ringsDone: 0,
  score: 0,
  ringScore: 0,
  breakdown: null,
  timeSec: 0,
  crashes: 0,
  time: 0,
  hp: PLANES.aerobatic.hp,
  fuel: 1, // cockpit fuel gauge: drains with throttle, refilled on reset
  boostUntil: -1,
  shieldUntil: -1,
  countdownLeft: 0,
  countdownShown: 4,
  cinematicT: 0,
  celebrationT: 0,
  confettiAt: 0,
  fadeT: -1, // >=0 while the crash fade runs
  cameraMode: 'chase',
  frozen: false,
  best: Number(localStorage.getItem(BEST_KEY) || 0),
  trailAcc: 0,
  prevPos: new THREE.Vector3(),
  weatherRollAt: 0,
  weatherPending: null,
  weatherCount: 0,
  weatherCooldownUntil: 0,
  lastWeatherKind: null,
  weatherRng: createRandom(SEED ^ 0x77aa),
  birdStrikeAt: 0,
  trafficHitAt: 0,
  trafficNear: false,
  stormNear: false,
  stormStrikeAt: 0,
  tornadoDamageAcc: 0,
  lastStick: { pitch: 0, roll: 0 },
  settingsFrom: 'title',
};

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const camPos = new THREE.Vector3(0, 30, 60);
const camQuat = new THREE.Quaternion();
let camInit = false;

function onRunway(x, z) {
  for (const pad of [game.world.startPad, game.world.finishPad]) {
    if (Math.abs(x - pad.x) <= 25 && Math.abs(z - pad.z) <= 180) return true;
  }
  return false;
}

/** Release a whole group: geometries, materials and their textures. */
function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.isInstancedMesh) obj.dispose();
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) {
        if (mat.map) mat.map.dispose();
        mat.dispose();
      }
    }
  });
}

function makeWeather() {
  if (weather) weather.dispose();
  weather = createWeather(scene, S().quality, {
    onLightning: (intensity) => {
      hud.flashLightning();
      audio.thunder(intensity);
    },
    onStrike: () => {
      if (game.mode === 'flying' && game.state.airborne) applyDamage(HEALTH.lightning, 'lightning');
    },
    onEnd: () => {
      hud.setWeatherBanner(null);
      hud.toast(t('weather.clear'));
      audio.setRain(0);
      audio.setGust(0);
      audio.setTornado(0);
      audio.setStormAudio(0);
      game.world.setStorm(0);
      // Fairness: a breather after every event before the dice roll again.
      game.weatherCooldownUntil = game.time + 20;
      game.weatherRollAt = Math.max(game.weatherRollAt, game.weatherCooldownUntil);
    },
  });
}

/** */
async function reset(seed, difficultyKey, mapKey = game.mapKey, planeKey = game.planeKey, onProgress = null, yieldFn = null) {
  game.difficultyKey = difficultyKey;
  game.difficulty = DIFFICULTY[difficultyKey];
  game.mapKey = mapKey;
  game.planeKey = planeKey;
  game.planeDef = PLANES[planeKey];
  game.maxHp = game.planeDef.hp;
  if (game.world) {
    scene.remove(game.world.group);
    disposeGroup(game.world.group);
  }
  if (game.pickups) {
    scene.remove(game.pickups.group);
    disposeGroup(game.pickups.group);
  }
  // Swap the airframe when the chosen plane changes.
  if (model.planeKey !== planeKey) {
    scene.remove(model.group);
    disposeGroup(model.group);
    model = buildPlaneModel(game.planeDef);
    model.planeKey = planeKey;
    model.cockpit.visible = game.cameraMode === 'cockpit';
    scene.add(model.group);
  }
  game.world = await buildWorld(scene, seed, game.difficulty, S().quality, MAPS[mapKey], onProgress, yieldFn);
  game.pickups = createPickups(scene, game.world.rings, createRandom(seed ^ 0x51ab));
  makeWeather();
  game.state = createFlightState(game.world.startPad);
  game.currentRing = 0;
  game.ringsDone = 0;
  game.score = 0;
  game.ringScore = 0;
  game.breakdown = null;
  game.timeSec = 0;
  game.crashes = 0;
  game.hp = game.maxHp;
  game.fuel = 1;
  game.boostUntil = -1;
  game.shieldUntil = -1;
  game.fadeT = -1;
  game.weatherPending = null;
  game.weatherCount = 0;
  game.weatherCooldownUntil = 0;
  game.lastWeatherKind = null;
  game.weatherRng = createRandom(seed ^ 0x77aa);
  game.weatherRollAt = game.time + 10;
  game.tornadoDamageAcc = 0;
  game.trafficNear = false;
  game.stormNear = false;
  game.prevPos.copy(game.state.pos);
  camInit = false;
  hud.setFade(0);
  hud.setWeatherBanner(null);
  hud.setBuffs([]);
  model.shieldBubble.visible = false;
  syncPlaneModel(model, game.state, 0, game.time);
}

/** */
async function rebuildWorldPreserving() {
  const keep = {
    state: game.state, currentRing: game.currentRing, ringsDone: game.ringsDone,
    score: game.score, ringScore: game.ringScore, timeSec: game.timeSec,
    crashes: game.crashes, hp: game.hp, fuel: game.fuel,
    boostUntil: game.boostUntil, shieldUntil: game.shieldUntil,
  };
  if (game.world) {
    scene.remove(game.world.group);
    disposeGroup(game.world.group);
  }
  if (game.pickups) {
    scene.remove(game.pickups.group);
    disposeGroup(game.pickups.group);
  }
  game.world = await buildWorld(scene, game.seed, game.difficulty, S().quality, MAPS[game.mapKey]);
  game.pickups = createPickups(scene, game.world.rings, createRandom(game.seed ^ 0x51ab));
  makeWeather();
  game.state = keep.state;
  game.score = keep.score;
  game.ringScore = keep.ringScore;
  game.timeSec = keep.timeSec;
  game.crashes = keep.crashes;
  game.hp = keep.hp;
  game.fuel = keep.fuel;
  game.boostUntil = keep.boostUntil;
  game.shieldUntil = keep.shieldUntil;
  markRingsPassed(keep.ringsDone);
  game.prevPos.copy(game.state.pos);
  syncPlaneModel(model, game.state, 0, game.time);
}

function markRingsPassed(n) {
  game.world.rings.forEach((ring, i) => { ring.passed = i < n; });
  game.currentRing = n;
  game.ringsDone = n;
  game.world.setRingStates(n);
}

function setMissionData({ ringsDone, score, timeSec }) {
  game.ringsDone = ringsDone;
  game.score = score;
  game.timeSec = timeSec;
}

function setBreakdown(breakdown) {
  game.breakdown = breakdown;
}

function gradeFor(score) {
  for (const row of SCORE.ratings) if (score >= row.min) return row.grade;
  return 'C';
}

/** The full score breakdown for the results screen. */
function computeBreakdown() {
  const timeBonus = Math.round(Math.max(0, game.difficulty.parSeconds - game.timeSec) * SCORE.timeBonusPerSecond);
  const hpBonus = Math.round((Math.max(0, game.hp) / game.maxHp) * SCORE.hpBonusMax);
  const crashPenalty = game.crashes * SCORE.crashPenalty;
  const total = game.ringScore + SCORE.finishBase + timeBonus + hpBonus - crashPenalty;
  return { ringScore: game.ringScore, finish: SCORE.finishBase, timeBonus, hpBonus, crashPenalty, total };
}

function loadBests() {
  try {
    const list = JSON.parse(localStorage.getItem(BESTS_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function recordBest(breakdown) {
  const entry = {
    map: game.mapKey, plane: game.planeKey, difficulty: game.difficultyKey,
    score: breakdown.total, grade: gradeFor(breakdown.total),
    timeSec: Math.round(game.timeSec * 10) / 10, date: new Date().toISOString(),
  };
  const list = loadBests();
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  try {
    localStorage.setItem(BESTS_KEY, JSON.stringify(list.slice(0, 8)));
  } catch { /* private mode: the flight still counts for this session */ }
  if (breakdown.total > game.best) {
    game.best = breakdown.total;
    try { localStorage.setItem(BEST_KEY, String(game.best)); } catch { /* ignore */ }
  }
}

/** */
function showScreen(name) {
  game.screen = name;
  if (name === 'hud') {
    hud.showScreen(null);
    hud.showHud(true);
    return;
  }
  hud.showScreen(name);
  hud.showHud(name === 'results' || name === 'pause');
  if (name === 'title') {
    hud.setBestLine(game.best);
    hud.selectCard('map', game.mapKey);
    hud.selectCard('plane', game.planeKey);
  }
  if (name === 'best') hud.renderBest(loadBests());
  if (name === 'results') {
    const breakdown = game.breakdown || { ringScore: game.score, finish: 0, timeBonus: 0, hpBonus: 0, crashPenalty: 0, total: game.score };
    hud.showResults({
      timeSec: game.timeSec,
      grade: gradeFor(breakdown.total),
      ringsDone: game.ringsDone,
      ringsTotal: game.world.rings.length,
      crashes: game.crashes,
      landed: true,
      breakdown,
    });
  }
}

/** Chase camera: behind and above, springy, leaning a little with the bank. */
function setChaseCamera(snap = false) {
  const state = game.state;
  forwardOf(state, _v1);
  _v2.copy(state.pos).addScaledVector(_v1, -13.5);
  _v2.y += 4.4;
  if (snap || !camInit) {
    camPos.copy(_v2);
    camInit = true;
  } else {
    camPos.lerp(_v2, 1 - Math.exp(-STEP / 0.22));
  }
  camera.position.copy(camPos);
  _v3.copy(state.pos).addScaledVector(_v1, 20);
  _v3.y += 1.2;
  camera.up.set(Math.sin(state.roll) * 0.35, 1, 0).normalize();
  camera.lookAt(_v3);
  const speedNorm = Math.min(1, state.speed / 88);
  const boost01 = game.time < game.boostUntil ? 1 : 0;
  const fov = 60 + speedNorm * 9 + boost01 * 6;
  if (Math.abs(camera.fov - fov) > 0.15) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

/** */
function setCockpitCamera() {
  const state = game.state;
  _v1.set(0, 1.18, -0.4);
  model.group.localToWorld(_v1);
  camera.position.copy(_v1);
  if (!camInit) {
    camQuat.copy(model.group.quaternion);
    camInit = true;
  } else {
    camQuat.slerp(model.group.quaternion, 1 - Math.exp(-STEP / 0.055));
  }
  camera.quaternion.copy(camQuat);
  const boost01 = game.time < game.boostUntil ? 1 : 0;
  const fov = 72 + boost01 * 5;
  if (Math.abs(camera.fov - fov) > 0.15) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

/** Menu camera: a slow orbit around the parked plane. */
function setOrbitCamera(angle) {
  const p = game.state.pos;
  camera.position.set(p.x + Math.sin(angle) * 17, p.y + 4.6, p.z + Math.cos(angle) * 17);
  camera.up.set(0, 1, 0);
  camera.lookAt(p.x, p.y + 1, p.z);
  camera.translateX(7.6);
  if (Math.abs(camera.fov - 58) > 0.15) {
    camera.fov = 58;
    camera.updateProjectionMatrix();
  }
}

/** Results camera: off the nose quarter, plane and runway in frame. */
function setSideCamera() {
  const p = game.state.pos;
  camera.position.set(p.x + 13, p.y + 3.6, p.z - 13);
  camera.up.set(0, 1, 0);
  camera.lookAt(p.x + 5, p.y + 0.8, p.z);
  if (Math.abs(camera.fov - 55) > 0.15) {
    camera.fov = 55;
    camera.updateProjectionMatrix();
  }
}

const CINEMATIC_SECONDS = 5.2;
const _cinePos = new THREE.Vector3();
const _cineLook = new THREE.Vector3();

function smooth01(x) {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
}

/** */
function setCinematicCamera(frac) {
  const p = game.state.pos;
  const start = game.world.startPad;
  const poses = [
    { pos: [start.x + 120, start.h + 300, start.z + 520], look: [LAKE.x, LAKE.level, LAKE.z] },
    { pos: [LAKE.x + 60, LAKE.level + 55, LAKE.z + 300], look: [p.x, p.y + 2, p.z] },
    { pos: [p.x + 26, p.y + 7, p.z + 20], look: [p.x, p.y + 1.2, p.z] },
    { pos: [p.x, p.y + 4.4, p.z + 13.5], look: [p.x, p.y + 1.2, p.z - 20] },
  ];
  const seg = Math.min(poses.length - 2, Math.floor(frac * (poses.length - 1)));
  const local = smooth01(frac * (poses.length - 1) - seg);
  const a = poses[seg];
  const b = poses[seg + 1];
  _cinePos.set(
    a.pos[0] + (b.pos[0] - a.pos[0]) * local,
    a.pos[1] + (b.pos[1] - a.pos[1]) * local,
    a.pos[2] + (b.pos[2] - a.pos[2]) * local,
  );
  _cineLook.set(
    a.look[0] + (b.look[0] - a.look[0]) * local,
    a.look[1] + (b.look[1] - a.look[1]) * local,
    a.look[2] + (b.look[2] - a.look[2]) * local,
  );
  camera.position.copy(_cinePos);
  camera.up.set(0, 1, 0);
  camera.lookAt(_cineLook);
  if (Math.abs(camera.fov - 60) > 0.15) {
    camera.fov = 60;
    camera.updateProjectionMatrix();
  }
}

/** Celebration camera: a slow orbit around the finished plane. */
function setCelebrationCamera(angle) {
  const p = game.state.pos;
  camera.position.set(p.x + Math.sin(angle) * 16, p.y + 5.2, p.z + Math.cos(angle) * 16);
  camera.up.set(0, 1, 0);
  camera.lookAt(p.x, p.y + 1.2, p.z);
  if (Math.abs(camera.fov - 56) > 0.15) {
    camera.fov = 56;
    camera.updateProjectionMatrix();
  }
}

/** Keep the sun's shadow box centred on the plane, snapped to reduce shimmer. */
function updateSun() {
  const p = game.state.pos;
  const snap = 4;
  const tx = Math.round(p.x / snap) * snap;
  const tz = Math.round(p.z / snap) * snap;
  sun.target.position.set(tx, p.y, tz);
  sun.position.set(tx + SUN_DIR.x * 700, p.y + SUN_DIR.y * 700, tz + SUN_DIR.z * 700);
}

function syncHud() {
  const state = game.state;
  const altAgl = Math.max(0, state.pos.y - heightAt(state.pos.x, state.pos.z) - 1.9);
  hud.setInstruments({
    alt: altAgl,
    speedKmh: state.speed * 3.6,
    headingDeg: headingOf(state),
    pitch: state.pitch,
    roll: state.roll,
    throttle: state.throttle,
  });
  hud.setMission({
    timeSec: game.timeSec,
    ringsDone: game.ringsDone,
    ringsTotal: game.world.rings.length,
    score: game.score,
  });
  hud.setHull(game.hp / game.maxHp, game.hp);
  const buffs = [];
  if (game.time < game.boostUntil) {
    buffs.push({ key: 'boost', label: t('buff.boost'), frac: (game.boostUntil - game.time) / PICKUPS.boostSeconds });
  }
  if (game.time < game.shieldUntil) {
    buffs.push({ key: 'shield', label: t('buff.shield'), frac: (game.shieldUntil - game.time) / PICKUPS.shieldSeconds });
  }
  hud.setBuffs(buffs);
  model.setGauges(altAgl, state.speed * 3.6, headingOf(state), {
    rpm01: Math.min(1, 0.22 + state.throttle * 0.72 + state.speed * 0.0012),
    fuel01: game.fuel,
    throttle01: state.throttle,
    pitch: state.pitch,
    roll: state.roll,
  });
  model.setStick(game.lastStick.pitch, game.lastStick.roll, Math.min(1, state.buffet + state.throttle * 0.15));
  updateTargetMarker();
  updateWarning();
}

function targetPoint(out) {
  const ring = game.world.rings[game.currentRing];
  if (ring) return out.copy(ring.centre);
  const pad = game.world.finishPad;
  return out.set(pad.x, pad.h + 6, pad.z);
}

function updateTargetMarker() {
  if (game.mode === 'finished' || (game.mode !== 'flying' && !SHOT)) {
    hud.setTarget({ show: false });
    return;
  }
  targetPoint(_v1);
  const dist = _v1.distanceTo(game.state.pos);
  _v2.copy(_v1).project(camera);
  const behind = _v2.z > 1;
  let x = (_v2.x * 0.5 + 0.5) * window.innerWidth;
  let y = (-_v2.y * 0.5 + 0.5) * window.innerHeight;
  const margin = 54;
  const off = behind || x < margin || x > window.innerWidth - margin || y < margin || y > window.innerHeight - margin;
  if (off) {
    if (behind) {
      x = window.innerWidth - x;
      y = window.innerHeight - 40;
    }
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const angle = Math.atan2(y - cy, x - cx);
    const rx = cx - margin;
    const ry = cy - margin;
    const scale = Math.min(rx / Math.max(1, Math.abs(Math.cos(angle))), ry / Math.max(1, Math.abs(Math.sin(angle))));
    hud.setTarget({
      show: true,
      x: cx + Math.cos(angle) * scale,
      y: cy + Math.sin(angle) * scale,
      dist,
      edge: true,
      angleDeg: angle * 180 / Math.PI + 90,
    });
  } else {
    hud.setTarget({ show: true, x, y, dist, edge: false, angleDeg: 45 });
  }
}

function updateWarning() {
  const state = game.state;
  let text = '';
  if (state.stalled) text = t('warn.stall');
  else if (state.airborne && state.pos.y - heightAt(state.pos.x, state.pos.z) < 24 && state.sinkRate > 3 && !onRunway(state.pos.x, state.pos.z)) text = t('warn.pullup');
  else if (game.trafficNear && game.mode === 'flying') text = t('warn.traffic');
  else if (game.stormNear && game.mode === 'flying') text = t('warn.stormNear');
  else if (game.hp <= game.maxHp * 0.22 && game.mode === 'flying') text = t('warn.hull');
  hud.setWarning(text);
  audio.setWarning(Boolean(text) && game.mode === 'flying');
}

/** Did the plane just thread the current ring? Score it and light the next. */
function checkRingPass() {
  const ring = game.world.rings[game.currentRing];
  if (!ring) return;
  const prevD = _v1.copy(game.prevPos).sub(ring.centre).dot(ring.normal);
  const nowD = _v2.copy(game.state.pos).sub(ring.centre).dot(ring.normal);
  if (prevD < 0 && nowD >= 0) {
    const tt = prevD / (prevD - nowD);
    _v3.copy(game.prevPos).lerp(game.state.pos, tt);
    const radial = _v3.distanceTo(ring.centre);
    if (radial > ring.radius && radial <= ring.radius * 2.5) audio.ringMiss();
    if (radial <= ring.radius) {
      const centreBonus = 1 - radial / ring.radius;
      const gained = SCORE.ringBase + Math.round(SCORE.ringCentreBonus * centreBonus);
      game.ringScore += gained;
      game.score = Math.max(0, game.ringScore - game.crashes * SCORE.crashPenalty);
      ring.passed = true;
      game.ringsDone++;
      game.currentRing++;
      game.world.setRingStates(game.currentRing);
      fx.burst(ring.centre, 0xffc93c, 46, 13, 0.9);
      fx.ripple(ring.centre, ring.quat, ring.radius);
      audio.ringChime(centreBonus);
      hud.scorePop(gained);
      hud.ringFlash();
      if (game.currentRing >= game.world.rings.length) hud.toast(t('toast.allRings'));
      else hud.toast(t('toast.ring', { n: game.ringsDone, g: gained }));
    }
  }
}

const CELEBRATION_SECONDS = 3.6;
const CONFETTI_COLORS = [0xffc93c, 0x37c8e0, 0x52e07a, 0xff6b9d, 0xb78bff];

function finishRun() {
  game.breakdown = computeBreakdown();
  game.score = game.breakdown.total;
  recordBest(game.breakdown);
  game.mode = 'celebration';
  game.celebrationT = 0;
  game.confettiAt = 0;
  audio.finishHorn();
  audio.victory();
  audio.setFlight(0, 0, false);
  hud.setSkipHint(true);
}

function endCelebration() {
  hud.setSkipHint(false);
  game.mode = 'finished';
  showScreen('results');
  setSideCamera();
}

function respawnAfterCrash() {
  const ring = game.world.rings[game.currentRing];
  if (ring) {
    const tangent = pathTangent(ring.centre.z);
    const pos = ring.centre.clone().addScaledVector(tangent, -280);
    pos.y = Math.max(pos.y, heightAt(pos.x, pos.z) + 75);
    placeInAir(game.state, pos, Math.atan2(tangent.x, -tangent.z), 52, 0.7);
  } else {
    const pad = game.world.finishPad;
    placeInAir(game.state, new THREE.Vector3(pad.x, pad.h + 130, pad.z + 420), 0, 48, 0.6);
  }
  game.prevPos.copy(game.state.pos);
  game.hp = game.maxHp;
  game.tornadoDamageAcc = 0;
  camInit = false;
}

/** The hull hits zero: fireball, penalty, fade back to the last ring. */
function explode() {
  if (game.fadeT >= 0) return;
  game.crashes++;
  game.score = Math.max(0, game.ringScore - game.crashes * SCORE.crashPenalty);
  fx.flash(game.state.pos);
  fx.burst(game.state.pos, 0xff8a3c, 80, 18, 1.2, 1);
  fx.burst(game.state.pos, 0x555c66, 34, 9, 1.7, -0.3);
  audio.explosion();
  hud.toast(t('toast.crashed'));
  game.fadeT = 0;
}

const SHIELD_ABSORB = 40; // the shield swallows up to this much per hit

/** */
function applyDamage(amount, cause) {
  if (game.fadeT >= 0 || game.mode !== 'flying') return false;
  let landed = amount;
  if (game.time < game.shieldUntil) {
    fx.burst(game.state.pos, COLORS.pickupShield, 22, 9, 0.5);
    landed = Math.max(0, amount - SHIELD_ABSORB);
    if (landed === 0) {
      hud.toast(t('toast.shieldBlock'), 1100);
      return true;
    }
    hud.toast(t('toast.shieldBlock'), 1100);
  }
  game.hp -= landed;
  hud.flashDamage();
  audio.damageThud();
  fx.burst(game.state.pos, 0xff8a3c, 18, 8, 0.6, 0.5);
  if (game.hp <= 0) {
    game.hp = 0;
    explode();
  }
  return false;
}

/** A pickup was flown through: switch on its effect. */
function collectPickup(item) {
  fx.burst(item.holder.position, item.color, 30, 10, 0.7);
  audio.pickup(item.type);
  if (item.type === 'boost') {
    game.boostUntil = game.time + PICKUPS.boostSeconds;
    hud.toast(t('toast.boost'), 1100);
  } else if (item.type === 'shield') {
    game.shieldUntil = game.time + PICKUPS.shieldSeconds;
    model.shieldBubble.visible = true;
    hud.toast(t('toast.shield'), 1100);
  } else if (game.hp >= game.maxHp) {
    // Full hull: the repair kit converts to points instead of wasting.
    game.ringScore += 50;
    game.score = Math.max(0, game.ringScore - game.crashes * SCORE.crashPenalty);
    hud.toast(t('toast.repair', { n: 0 }), 1100);
  } else {
    const healed = Math.min(HEALTH.repairAmount, game.maxHp - game.hp);
    game.hp += healed;
    hud.toast(t('toast.repair', { n: Math.round(healed) }), 1100);
  }
}

const WEATHER_KINDS = ['storm', 'gust', 'rain', 'tornado'];
const WEATHER_MAX_PER_RUN = 4;

/** */
function scheduleWeather() {
  if (!S().events || game.mode !== 'flying' || weather.active || game.weatherPending) return;
  if (game.time < game.weatherRollAt || game.time < game.weatherCooldownUntil) return;
  if (game.weatherCount >= WEATHER_MAX_PER_RUN) return;
  if (game.currentRing >= game.world.rings.length) return;
  game.weatherRollAt = game.time + WEATHER.rollEverySeconds;
  const chance = game.difficulty.weatherChance * MAPS[game.mapKey].weatherMult;
  if (game.weatherRng() > chance) return;
  const kinds = WEATHER_KINDS.filter((k) => k !== game.lastWeatherKind);
  const kind = kinds[Math.floor(game.weatherRng() * kinds.length)];
  game.lastWeatherKind = kind;
  game.weatherCount++;
  game.weatherPending = { kind, at: game.time + WEATHER.warningSeconds };
  hud.setWeatherBanner(t(`weather.${kind}`));
}

/** One fixed simulation step: physics, rings, effects, camera, instruments. */
function step(dt, rawInput) {
  const state = game.state;
  game.prevPos.copy(state.pos);
  game.lastStick = { pitch: rawInput.pitch || 0, roll: rawInput.roll || 0 };

  // Weather: pending events start after their banner; active ones push back.
  if (game.weatherPending && game.time >= game.weatherPending.at) {
    weather.start(game.weatherPending.kind, game.time, state.pos, heightAt);
    game.weatherPending = null;
  }
  scheduleWeather();
  const wfx = weather.update(dt, game.time, { pos: state.pos, airborne: state.airborne }, heightAt);
  game.world.setStorm(wfx.stormFactor);
  audio.setStormAudio(wfx.stormFactor);
  audio.setRain(weather.kind === 'rain' ? 0.9 : (weather.kind === 'storm' ? 0.5 : 0));
  audio.setGust(wfx.gustStrength / WEATHER.gustStrength);
  audio.setTornado(weather.kind === 'tornado' ? Math.max(0, 1 - wfx.tornadoDist / 420) : 0);
  if (wfx.tornadoDist < WEATHER.tornadoCoreRadius && state.airborne) {
    game.tornadoDamageAcc += HEALTH.tornadoPerSecond * dt;
    if (game.tornadoDamageAcc >= 4) {
      applyDamage(game.tornadoDamageAcc, 'tornado');
      game.tornadoDamageAcc = 0;
    }
  } else {
    // Left the core: the wear accumulator does not carry over.
    game.tornadoDamageAcc = 0;
  }

  // Storm cells: inside one the air is rough, sight is short, and the
  // lightning sometimes finds you. Near one, the HUD warns.
  let inStormCell = false;
  game.stormNear = false;
  for (const cell of game.world.stormCells) {
    const d = cell.pos.distanceTo(state.pos);
    if (d < cell.radius) inStormCell = true;
    else if (d < cell.radius + 200) game.stormNear = true;
  }
  if (inStormCell && state.airborne && game.mode === 'flying') {
    if (game.time >= game.stormStrikeAt) {
      game.stormStrikeAt = game.time + 2.5 + Math.random() * 2.5;
      hud.flashLightning();
      audio.thunder(1);
      applyDamage(HEALTH.stormStrike, 'storm');
      hud.toast(t('toast.stormStrike'), 1200);
    }
  }
  const targetFog = inStormCell ? 500 : (wfx.fogFar ?? WORLD.fogFar);
  // Exponential fog: map the old linear "far" distances onto a density so
  // weather still closes the world in exactly as before.
  const targetDensity = 0.65 / targetFog;
  scene.fog.density += (targetDensity - scene.fog.density) * Math.min(1, dt * 1.5);

  const windTotal = Math.hypot(wfx.windX, wfx.windZ);
  hud.setWind({
    show: windTotal > 3 && game.mode === 'flying',
    angleDeg: Math.atan2(wfx.windX, -wfx.windZ) * 180 / Math.PI - 90,
    strengthMs: windTotal,
  });

  // Turbulence shakes the stick; the boost pickup stretches the speed target.
  const stickIn = { ...rawInput };
  const turbulence = wfx.turbulence + (inStormCell && state.airborne ? 0.5 : 0);
  if (turbulence > 0 && state.airborne) {
    stickIn.pitch = Math.max(-1, Math.min(1, (stickIn.pitch || 0) + (Math.random() - 0.5) * turbulence));
    stickIn.roll = Math.max(-1, Math.min(1, (stickIn.roll || 0) + (Math.random() - 0.5) * turbulence));
  }
  const baseWind = game.difficulty.wind
    ? Math.sin(game.time * 0.5) * game.difficulty.wind + Math.sin(game.time * 1.7) * game.difficulty.wind * 0.4
    : 0;
  const boost01 = game.time < game.boostUntil ? 1 : 0;
  const event = stepFlight(state, stickIn, {
    heightAt,
    onRunway,
    windX: baseWind + wfx.windX,
    windZ: wfx.windZ,
    pullX: wfx.pullX,
    pullZ: wfx.pullZ,
    speedFactor: boost01 ? game.planeDef.boostFactor : 1,
    lagScale: wfx.lagScale,
    plane: game.planeDef,
  }, dt);

  if (game.mode === 'flying') game.timeSec += dt;
  if (state.airborne || state.throttle > 0.02) {
    game.fuel = Math.max(0, game.fuel - dt * (0.00035 + state.throttle * 0.0016));
  }

  if (event === 'impact') {
    const hit = state.lastImpact;
    const severe = hit.speed > HEALTH.hardHitSpeed || hit.sink > HEALTH.hardHitSink;
    const blocked = applyDamage(severe ? HEALTH.crashLanding : HEALTH.hardLanding, 'impact');
    if (game.fadeT < 0) {
      state.airborne = false;
      state.grounded = true;
      state.speed *= 0.35;
      state.pitch = 0;
      state.roll = 0;
      if (!blocked) hud.toast(t('toast.hard'));
    }
  } else if (event === 'rough') {
    applyDamage(HEALTH.roughLanding, 'rough');
    if (game.fadeT < 0) hud.toast(t('toast.rough'));
  } else if (event === 'landed') {
    if (game.currentRing >= game.world.rings.length && game.mode === 'flying') {
      finishRun();
    } else if (game.mode === 'flying') {
      hud.toast(t('toast.downSafe'));
    }
  } else if (event === 'takeoff') {
    hud.toast(t('toast.airborne'));
  }

  if (state.airborne) checkRingPass();

  // Bird strike: flying through a flock can cost hull and a cloud of feathers.
  if (state.airborne && game.mode === 'flying' && game.time >= game.birdStrikeAt) {
    for (const bp of game.world.birdPositions) {
      if (bp.distanceToSquared(state.pos) < 16 && game.world.strikeBirdAt(state.pos)) {
        applyDamage(HEALTH.birdStrike, 'bird');
        fx.burst(state.pos, 0xf4f6f8, 26, 6, 0.9, 0.7);
        hud.toast(t('toast.birdStrike'), 1200);
        game.birdStrikeAt = game.time + 1.5;
        break;
      }
    }
  }

  // Traffic: other planes share the course. Near ones warn; touching hurts.
  game.trafficNear = false;
  if (state.airborne && game.mode === 'flying') {
    for (const tp of game.world.trafficPositions) {
      const d2 = tp.distanceToSquared(state.pos);
      if (d2 < 45 * 45) game.trafficNear = true;
      if (d2 < 36 && game.time >= game.trafficHitAt) {
        game.trafficHitAt = game.time + 2;
        applyDamage(HEALTH.trafficHit, 'traffic');
        fx.burst(state.pos, 0xff8a3c, 40, 12, 0.9, 0.6);
        hud.toast(t('toast.trafficHit'), 1400);
      }
    }
  }

  // Pickups bob, spin, and get collected by flying through them.
  game.pickups.update(dt, game.time);
  if (state.airborne && game.mode === 'flying') {
    const got = game.pickups.tryCollect(state.pos, game.time);
    if (got) collectPickup(got);
  }
  if (game.time >= game.shieldUntil) model.shieldBubble.visible = false;

  // Wingtip vapour, denser the faster she goes (and thicker on boost).
  if (state.airborne && state.speed > 30) {
    game.trailAcc += dt * (state.speed - 26) * (boost01 ? 0.9 : 0.5);
    wingtipPositions(model, _v1, _v2);
    while (game.trailAcc > 1) {
      game.trailAcc -= 1;
      fx.trailPuff(_v1, state.speed / 88);
      fx.trailPuff(_v2, state.speed / 88);
    }
  }

  syncPlaneModel(model, state, dt, game.time);
  game.world.update(dt, game.time, state.pos, game.currentRing);
  fx.update(dt);
  updateSun();

  if (game.cameraMode === 'cockpit') setCockpitCamera();
  else setChaseCamera();

  // Engine shudder: a whisper of shake that grows with the throttle.
  if (game.mode === 'flying') {
    const shake = state.throttle * 0.05 + (state.stalled ? 0.22 : 0);
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
  }

  audio.setFlight(state.throttle, Math.min(1, state.speed / 88), game.mode === 'flying', boost01, {
    roll: state.roll,
    vspeed: state.vel.y,
    agl: state.pos.y - heightAt(state.pos.x, state.pos.z),
    airborne: state.airborne,
    speed: state.speed,
    stalled: state.stalled,
    hullFrac: game.maxHp ? game.hp / game.maxHp : 1,
    inCloud: game.stormNear,
  });
  syncHud();
}

function startCountdown() {
  game.mode = 'countdown';
  game.countdownLeft = 3.2;
  game.countdownShown = 4;
  showScreen('hud');
  hud.setSkipHint(false);
  setChaseCamera(true);
  hud.toast(t('toast.throttle'));
}

/** Loading -> cinematic -> countdown, with real build progress. */
async function startRun() {
  game.mode = 'loading';
  showScreen('loading');
  hud.setLoading(0, 'terrain');
  let tipIndex = 1;
  hud.setLoadingTip(t(`loading.tip${tipIndex}`));
  const tipTimer = window.setInterval(() => {
    tipIndex = tipIndex % 4 + 1;
    hud.setLoadingTip(t(`loading.tip${tipIndex}`));
  }, 1600);
  const yieldFn = () => new Promise((resolve) => requestAnimationFrame(resolve));
  try {
    await reset(game.seed, game.difficultyKey, game.mapKey, game.planeKey,
      (frac, stage) => hud.setLoading(frac, stage), yieldFn);
  } finally {
    window.clearInterval(tipTimer);
  }
  game.mode = 'cinematic';
  game.cinematicT = 0;
  showScreen('hud');
  hud.setSkipHint(true);
}

function endCinematic() {
  hud.setSkipHint(false);
  game.state.throttle = 0;
  startCountdown();
}

function setCameraMode(mode) {
  game.cameraMode = mode;
  model.cockpit.visible = mode === 'cockpit';
  hud.setCockpit(mode === 'cockpit');
  camInit = false;
}

function handleActions(actions) {
  if (actions & ACTION_MUTE) {
    audio.setMuted(!audio.isMuted());
    hud.toast(audio.isMuted() ? t('toast.soundOff') : t('toast.soundOn'), 900);
  }
  if (actions & ACTION_CAMERA && (game.mode === 'flying' || game.mode === 'countdown')) {
    setCameraMode(game.cameraMode === 'chase' ? 'cockpit' : 'chase');
  }
  if (actions & ACTION_RESET && (game.mode === 'flying' || game.mode === 'paused')) {
    hud.showPause(false);
    restartRun();
  }
  if (actions & ACTION_PAUSE) {
    if (game.mode === 'flying') {
      game.mode = 'paused';
      hud.showPause(true);
      audio.setFlight(0, 0, false);
    } else if (game.mode === 'paused') {
      game.mode = 'flying';
      hud.showPause(false);
    }
  }
  if (actions & ACTION_CONFIRM) {
    if (game.mode === 'cinematic') endCinematic();
    else if (game.mode === 'celebration') endCelebration();
    else if (game.mode === 'title') { audio.init(); showScreen('mapselect'); game.mode = 'mapselect'; }
    else if (game.mode === 'finished') backToTitle();
  }
}

/** Quick restart: rebuild straight through (no loading screen), countdown. */
async function restartRun() {
  game.mode = 'loading';
  await reset(game.seed, game.difficultyKey, game.mapKey, game.planeKey);
  startCountdown();
}

async function backToTitle() {
  hud.showPause(false);
  await reset(game.seed, game.difficultyKey, game.mapKey, game.planeKey);
  game.mode = 'title';
  showScreen('title');
}

/** Push the stored settings into every subsystem that reads them. */
function applySettings() {
  const s = S();
  input.setSensitivity(s.sensitivity);
  audio.setVolumes(s.musicVol, s.sfxVol);
  applyLanguage();
  hud.setSettingsValues(s);
  hud.setMusicButton(audio.isMusicOn());
  hud.refreshCards();
  if (game.screen === 'title') hud.setBestLine(game.best);
  if (game.screen === 'best') hud.renderBest(loadBests());
}

hud.buildCards((kind, key) => {
  audio.init();
  audio.click();
  if (kind === 'map') game.mapKey = key;
  else game.planeKey = key;
  hud.selectCard(kind, key);
});

hud.setHoverSound(() => audio.hover());
hud.onButtons({
  onPlay: () => { audio.init(); audio.click(); game.mode = 'mapselect'; showScreen('mapselect'); },
  onHelp: () => { audio.init(); audio.click(); game.mode = 'help'; showScreen('help'); },
  onBest: () => { audio.init(); audio.click(); game.mode = 'best'; showScreen('best'); },
  onSettings: () => {
    audio.init();
    audio.click();
    game.settingsFrom = game.screen;
    hud.setSettingsValues(S());
    hud.showSettings(true);
  },
  onMapBack: () => { audio.click(); game.mode = 'title'; showScreen('title'); },
  onMapNext: () => { audio.click(); game.mode = 'planeselect'; showScreen('planeselect'); },
  onPlaneBack: () => { audio.click(); game.mode = 'mapselect'; showScreen('mapselect'); },
  onPlaneNext: () => { audio.click(); game.mode = 'difficulty'; showScreen('difficulty'); },
  onDiffBack: () => { audio.click(); game.mode = 'planeselect'; showScreen('planeselect'); },
  onStart: () => { audio.init(); audio.click(); startRun(); },
  onHelpBack: () => { audio.click(); game.mode = 'title'; showScreen('title'); },
  onBestBack: () => { audio.click(); game.mode = 'title'; showScreen('title'); },
  onAgain: () => { audio.click(); startRun(); },
  onResultsTitle: () => { audio.click(); backToTitle(); },
  onResume: () => {
    audio.click();
    game.mode = 'flying';
    hud.showPause(false);
  },
  onRestart: () => { audio.click(); hud.showPause(false); restartRun(); },
  onMusic: () => {
    audio.init();
    audio.setMusicOn(!audio.isMusicOn());
    hud.setMusicButton(audio.isMusicOn());
  },
  onMenu: () => { audio.click(); backToTitle(); },
  onDifficulty: (key) => {
    audio.init();
    audio.click();
    game.difficultyKey = key;
    game.difficulty = DIFFICULTY[key];
  },
});

hud.onSettings({
  onSensitivity: (v) => { setSetting('sensitivity', v); applySettings(); },
  onMusicVol: (v) => { setSetting('musicVol', v); applySettings(); },
  onSfxVol: (v) => { setSetting('sfxVol', v); applySettings(); },
  onLanguage: (lang) => { setSetting('lang', lang); applySettings(); },
  onEvents: () => {
    setSetting('events', !S().events);
    if (!S().events && weather) {
      weather.stop();
      game.weatherPending = null;
      hud.setWeatherBanner(null);
      audio.setRain(0);
      audio.setGust(0);
      audio.setTornado(0);
      audio.setStormAudio(0);
      game.world.setStorm(0);
    }
    applySettings();
  },
  onQuality: async (quality) => {
    setSetting('quality', quality);
    applyQuality();
    await rebuildWorldPreserving();
    hud.setSettingsValues(S());
    hud.showSettings(true);
  },
  onBack: () => { audio.click(); hud.showSettings(false); },
});

// Clicks skip the cinematic / celebration (never start a flight).
window.addEventListener('pointerdown', (event) => {
  if (event.target && event.target.closest && event.target.closest('button, input, .overlay, .card')) return;
  if (game.mode === 'cinematic') endCinematic();
  else if (game.mode === 'celebration') endCelebration();
});

window.addEventListener('pointerdown', () => audio.init(), { once: true });
window.addEventListener('keydown', () => audio.init(), { once: true });
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  post.setSize(Math.max(2, size.x), Math.max(2, size.y));
});

// Boot: build the world, then either stage a screenshot scene or open the title.
applyQuality();
applySettings();
let booted = false;
if (SHOT) {
  game.frozen = true;
  await stageShot(SHOT, {
    seed: SEED,
    get state() { return game.state; },
    get world() { return game.world; },
    get pickups() { return game.pickups; },
    reset,
    markRingsPassed,
    setMissionData,
    setBreakdown,
    showScreen,
    setChaseCamera,
    setOrbitCamera,
    setSideCamera,
    step,
    syncHud,
    activateBoost: () => { game.boostUntil = game.time + PICKUPS.boostSeconds; },
    setHull: (v) => { game.hp = v; },
    setCockpit: () => setCameraMode('cockpit'),
  });
  game.world.setRingStates(game.currentRing);
  syncPlaneModel(model, game.state, 0, 0);
  game.world.update(0, 0, game.state.pos, game.currentRing);
  game.pickups.update(0, 0);
  updateSun();
  if (SHOT === 'play') setChaseCamera(true);
  if (SHOT === 'cockpit') setCockpitCamera();
  if (SHOT === 'end') { game.mode = 'finished'; setSideCamera(); }
  if (SHOT === 'start') setOrbitCamera(-0.62);
  syncHud();
} else {
  await reset(SEED, 'normal', 'canyon', 'aerobatic');
  game.mode = 'title';
  showScreen('title');
}
booted = true;

let last = performance.now();
let accumulator = 0;
let framesRendered = 0;
game.step = step;
game.reset = reset;
game.respawnAfterCrash = respawnAfterCrash;
game.heightAt = heightAt;
game.placeInAir = placeInAir;
game.debug = { input, getSettings, renderer, audio, get weather() { return weather; } };
window.__game = game; // debug/inspection hook (harmless in normal play)

const IDLE_MODES = new Set(['title', 'mapselect', 'planeselect', 'difficulty', 'help', 'best', 'finished']);

function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (!game.frozen && booted) {
    handleActions(input.takeActions());
    input.setActive(game.mode === 'flying');

    if (game.mode === 'countdown') {
      game.countdownLeft -= dtReal;
      const shown = Math.ceil(game.countdownLeft);
      if (shown !== game.countdownShown && shown >= 1) {
        game.countdownShown = shown;
        hud.setCountdown(shown);
        audio.countdownBeep(false);
      }
      if (game.countdownLeft <= 0) {
        hud.setCountdown(null);
        audio.countdownBeep(true);
        game.mode = 'flying';
        hud.toast(t('toast.go'));
      }
      accumulator += dtReal;
      while (accumulator >= STEP) {
        game.time += STEP;
        step(STEP, { pitch: 0, roll: 0, throttleSet: 0 });
        accumulator -= STEP;
      }
    } else if (game.mode === 'cinematic') {
      game.cinematicT += dtReal;
      const frac = game.cinematicT / CINEMATIC_SECONDS;
      // The engine spools up as the camera closes in.
      game.state.throttle = Math.min(0.4, frac * 0.5);
      audio.setFlight(game.state.throttle, 0, true, 0);
      accumulator += dtReal;
      while (accumulator >= STEP) {
        game.time += STEP;
        syncPlaneModel(model, game.state, STEP, game.time);
        game.world.update(STEP, game.time, game.state.pos, game.currentRing);
        game.pickups.update(STEP, game.time);
        fx.update(STEP);
        accumulator -= STEP;
      }
      updateSun();
      setCinematicCamera(Math.min(1, frac));
      syncHud();
      if (frac >= 1) endCinematic();
    } else if (game.mode === 'celebration') {
      game.celebrationT += dtReal;
      if (game.time >= game.confettiAt) {
        game.confettiAt = game.time + 0.35;
        const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
        _v1.copy(game.state.pos);
        _v1.y += 6 + Math.random() * 5;
        fx.burst(_v1, color, 42, 11, 1.6, 0.85);
      }
      accumulator += dtReal;
      while (accumulator >= STEP) {
        game.time += STEP;
        syncPlaneModel(model, game.state, STEP, game.time);
        game.world.update(STEP, game.time, game.state.pos, game.currentRing);
        game.pickups.update(STEP, game.time);
        fx.update(STEP);
        accumulator -= STEP;
      }
      updateSun();
      setCelebrationCamera(game.celebrationT * 0.55 - 0.6);
      syncHud();
      if (game.celebrationT >= CELEBRATION_SECONDS) endCelebration();
    } else if (game.mode === 'flying') {
      accumulator += dtReal;
      while (accumulator >= STEP) {
        game.time += STEP;
        const stick = input.stick();
        step(STEP, { pitch: stick.pitch, roll: stick.roll, throttleDelta: input.throttleDelta() });
        accumulator -= STEP;
      }
    } else if (IDLE_MODES.has(game.mode)) {
      accumulator += dtReal;
      while (accumulator >= STEP) {
        game.time += STEP;
        syncPlaneModel(model, game.state, STEP, game.time);
        game.world.update(STEP, game.time, game.state.pos, game.currentRing);
        game.pickups.update(STEP, game.time);
        fx.update(STEP);
        accumulator -= STEP;
      }
      updateSun();
      if (game.mode === 'finished') setSideCamera();
      else setOrbitCamera(game.time * 0.11 - 0.6);
      syncHud();
    }

    // Crash fade: black out, respawn at the bottom of the fade, come back.
    if (game.fadeT >= 0) {
      game.fadeT += dtReal;
      const half = 0.55;
      if (game.fadeT < half) hud.setFade(game.fadeT / half);
      else if (game.fadeT < half + 0.05) {
        respawnAfterCrash();
        hud.setFade(1);
      } else if (game.fadeT < half * 2 + 0.05) hud.setFade(1 - (game.fadeT - half - 0.05) / half);
      else {
        hud.setFade(0);
        game.fadeT = -1;
      }
    }
  }

  post.render();
  framesRendered++;
  if (SHOT && booted && framesRendered >= 3) window.__shotReady = true;
}
requestAnimationFrame(frame);
