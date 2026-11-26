// Sky Ring Runner — entry point and game loop.
//
// Fly a little tourer down a mountain canyon, thread the glowing rings in
// order, then put her down on the far runway. This file owns the state
// machine (menu, countdown, flight, pause, results), the cameras, scoring
// and the fixed-step loop; the world, plane, effects, instruments and sound
// live in their own modules.

import { BEST_KEY, DIFFICULTY, SCORE, STEP } from './config.js';
import { createAudio } from './audio.js';
import { createFx } from './fx.js';
import { createHud } from './hud.js';
import { ACTION_CAMERA, ACTION_CONFIRM, ACTION_MUTE, ACTION_PAUSE, ACTION_RESET, createInput } from './input.js';
import {
  buildPlaneModel, createFlightState, forwardOf, headingOf, placeInAir, resetToRunway, stepFlight, syncPlaneModel, wingtipPositions,
} from './plane.js';
import { stageShot } from './shots.js';
import { buildWorld, heightAt, pathTangent } from './world.js';

const THREE = window.THREE;

const params = new URLSearchParams(window.location.search);
const SEED = Number.parseInt(params.get('seed') || '1', 10) || 1;
const SHOT = params.get('shot');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 9000);

const model = buildPlaneModel();
scene.add(model.group);
const fx = createFx(scene);
const input = createInput();
const hud = createHud();
const audio = createAudio();

const game = {
  seed: SEED,
  mode: 'menu', // menu | countdown | flying | paused | finished
  difficultyKey: 'normal',
  difficulty: DIFFICULTY.normal,
  world: null,
  state: null,
  currentRing: 0,
  ringsDone: 0,
  score: 0,
  timeSec: 0,
  crashes: 0,
  time: 0,
  countdownLeft: 0,
  countdownShown: 4,
  fadeT: -1, // >=0 while the crash fade runs
  cameraMode: 'chase',
  frozen: false,
  best: Number(localStorage.getItem(BEST_KEY) || 0),
  trailAcc: 0,
  prevPos: new THREE.Vector3(),
};

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const camPos = new THREE.Vector3(0, 30, 60);
let camInit = false;

function onRunway(x, z) {
  for (const pad of [game.world.startPad, game.world.finishPad]) {
    if (Math.abs(x - pad.x) <= 25 && Math.abs(z - pad.z) <= 180) return true;
  }
  return false;
}

/** Rebuild the world and put a fresh plane on the start runway. */
function reset(seed, difficultyKey) {
  game.difficultyKey = difficultyKey;
  game.difficulty = DIFFICULTY[difficultyKey];
  if (game.world) {
    scene.remove(game.world.group);
    game.world.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
    });
  }
  game.world = buildWorld(scene, seed, game.difficulty);
  game.state = createFlightState(game.world.startPad);
  game.currentRing = 0;
  game.ringsDone = 0;
  game.score = 0;
  game.timeSec = 0;
  game.crashes = 0;
  game.fadeT = -1;
  game.prevPos.copy(game.state.pos);
  camInit = false;
  hud.setFade(0);
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

function gradeFor(score) {
  for (const row of SCORE.ratings) if (score >= row.min) return row.grade;
  return 'C';
}

function showScreen(name) {
  hud.hideMenu();
  hud.hideResults();
  hud.showPause(false);
  if (name === 'menu') {
    hud.showHud(false);
    hud.showMenu(game.best);
  } else if (name === 'results') {
    hud.showHud(true);
    hud.showResults({
      timeSec: game.timeSec,
      score: game.score,
      grade: gradeFor(game.score),
      ringsDone: game.ringsDone,
      ringsTotal: game.world.rings.length,
      crashes: game.crashes,
      landed: true,
    });
  } else {
    hud.showHud(true);
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
  const fov = 60 + speedNorm * 9;
  if (Math.abs(camera.fov - fov) > 0.15) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

function setCockpitCamera() {
  const state = game.state;
  _v1.set(0, 1.12, -0.95);
  model.group.localToWorld(_v1);
  camera.position.copy(_v1);
  forwardOf(state, _v2);
  _v3.copy(_v1).addScaledVector(_v2, 30);
  camera.up.set(Math.sin(state.roll), Math.cos(state.roll), 0);
  camera.lookAt(_v3);
  if (Math.abs(camera.fov - 68) > 0.15) {
    camera.fov = 68;
    camera.updateProjectionMatrix();
  }
}

/** Menu camera: a slow orbit around the parked plane. */
function setOrbitCamera(angle) {
  const p = game.state.pos;
  camera.position.set(p.x + Math.sin(angle) * 17, p.y + 4.6, p.z + Math.cos(angle) * 17);
  camera.up.set(0, 1, 0);
  camera.lookAt(p.x, p.y + 1, p.z);
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
  // Aim a touch past the plane so it sits left of centre, clear of the card.
  camera.lookAt(p.x + 5, p.y + 0.8, p.z);
  if (Math.abs(camera.fov - 55) > 0.15) {
    camera.fov = 55;
    camera.updateProjectionMatrix();
  }
}

function syncHud() {
  const state = game.state;
  hud.setInstruments({
    // Height above the ground below — the number that matters on approach.
    alt: Math.max(0, state.pos.y - heightAt(state.pos.x, state.pos.z) - 1.9),
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
  if (state.stalled) text = 'STALL — NOSE DOWN, ADD POWER';
  else if (state.airborne && state.pos.y - heightAt(state.pos.x, state.pos.z) < 24 && state.sinkRate > 3 && !onRunway(state.pos.x, state.pos.z)) text = 'PULL UP';
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
    const t = prevD / (prevD - nowD);
    _v3.copy(game.prevPos).lerp(game.state.pos, t);
    const radial = _v3.distanceTo(ring.centre);
    if (radial <= ring.radius) {
      const centreBonus = 1 - radial / ring.radius;
      const gained = SCORE.ringBase + Math.round(SCORE.ringCentreBonus * centreBonus);
      game.score += gained;
      ring.passed = true;
      game.ringsDone++;
      game.currentRing++;
      game.world.setRingStates(game.currentRing);
      fx.burst(ring.centre, 0xffc93c, 46, 13, 0.9);
      fx.ripple(ring.centre, ring.hoop.quaternion, ring.radius);
      audio.ringChime(centreBonus);
      if (game.currentRing >= game.world.rings.length) hud.toast('All rings! Land on the far runway.');
      else hud.toast(`Ring ${game.ringsDone} — +${gained}`);
    }
  }
}

function finishRun() {
  const timeBonus = Math.max(0, game.difficulty.parSeconds - game.timeSec) * SCORE.timeBonusPerSecond;
  game.score += SCORE.finishBase + Math.round(timeBonus);
  game.mode = 'finished';
  audio.finishHorn();
  audio.setFlight(0, 0, false);
  if (game.score > game.best) {
    game.best = Math.round(game.score);
    localStorage.setItem(BEST_KEY, String(game.best));
  }
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
  camInit = false;
}

/** One fixed simulation step: physics, rings, effects, camera, instruments. */
function step(dt, rawInput) {
  const state = game.state;
  game.prevPos.copy(state.pos);

  const wind = game.difficulty.wind
    ? Math.sin(game.time * 0.5) * game.difficulty.wind + Math.sin(game.time * 1.7) * game.difficulty.wind * 0.4
    : 0;
  const event = stepFlight(state, rawInput, { heightAt, windX: wind, onRunway }, dt);

  if (game.mode === 'flying') game.timeSec += dt;

  if (event === 'crash' && game.fadeT < 0) {
    game.crashes++;
    game.score = Math.max(0, game.score - SCORE.crashPenalty);
    fx.flash(state.pos);
    fx.burst(state.pos, 0xff8a3c, 70, 17, 1.1, 1);
    fx.burst(state.pos, 0x555c66, 30, 8, 1.6, -0.3);
    audio.crashThud();
    hud.toast('Crashed! Back to the last ring.');
    game.fadeT = 0;
  } else if (event === 'landed') {
    if (game.currentRing >= game.world.rings.length && game.mode === 'flying') {
      finishRun();
    } else if (game.mode === 'flying') {
      hud.toast('Down safe — throttle up and thread the rings!');
    }
  } else if (event === 'takeoff') {
    hud.toast('Airborne — follow the gold ring!');
  }

  if (state.airborne) checkRingPass();

  // Wingtip vapour, denser the faster she goes.
  if (state.airborne && state.speed > 30) {
    game.trailAcc += dt * (state.speed - 26) * 0.9;
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

  if (game.mode === 'menu') setOrbitCamera(game.time * 0.11 - 0.6);
  else if (game.mode === 'finished') setSideCamera();
  else if (game.cameraMode === 'cockpit') setCockpitCamera();
  else setChaseCamera();

  // Engine shudder: a whisper of shake that grows with the throttle.
  if (game.mode === 'flying') {
    const shake = state.throttle * 0.05 + (state.stalled ? 0.22 : 0);
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
  }

  audio.setFlight(state.throttle, Math.min(1, state.speed / 88), game.mode === 'flying');
  syncHud();
}

function startCountdown() {
  reset(game.seed, game.difficultyKey);
  game.mode = 'countdown';
  game.countdownLeft = 3.2;
  game.countdownShown = 4;
  showScreen('hud');
  setChaseCamera(true);
  hud.toast('Throttle up with W / Shift when the light goes green!');
}

function handleActions(actions) {
  if (actions & ACTION_MUTE) {
    audio.setMuted(!audio.isMuted());
    hud.toast(audio.isMuted() ? 'Sound off' : 'Sound on', 900);
  }
  if (actions & ACTION_CAMERA && (game.mode === 'flying' || game.mode === 'countdown')) {
    game.cameraMode = game.cameraMode === 'chase' ? 'cockpit' : 'chase';
    model.dash.visible = game.cameraMode === 'cockpit';
    hud.setCockpit(game.cameraMode === 'cockpit');
    camInit = false;
  }
  if (actions & ACTION_RESET && (game.mode === 'flying' || game.mode === 'paused')) {
    hud.showPause(false);
    startCountdown();
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
    if (game.mode === 'menu') startCountdown();
    else if (game.mode === 'finished') {
      showScreen('menu');
      game.mode = 'menu';
      reset(game.seed, game.difficultyKey);
    }
  }
}

hud.onButtons({
  onStart: () => { audio.init(); audio.click(); startCountdown(); },
  onDifficulty: (key) => {
    audio.init();
    audio.click();
    reset(game.seed, key);
    showScreen('menu');
  },
  onAgain: () => { audio.click(); startCountdown(); },
  onResume: () => {
    audio.click();
    game.mode = 'flying';
    hud.showPause(false);
  },
  onRestart: () => { audio.click(); hud.showPause(false); startCountdown(); },
  onMusic: () => {
    audio.init();
    audio.setMusicOn(!audio.isMusicOn());
    hud.setMusicButton(audio.isMusicOn());
  },
});

window.addEventListener('pointerdown', () => audio.init(), { once: true });
window.addEventListener('keydown', () => audio.init(), { once: true });
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Boot: build the world, then either stage a screenshot scene or open the menu.
reset(SEED, 'normal');
if (SHOT) {
  game.frozen = true;
  stageShot(SHOT, {
    seed: SEED,
    get state() { return game.state; },
    get world() { return game.world; },
    reset,
    markRingsPassed,
    setMissionData,
    showScreen,
    setChaseCamera,
    setOrbitCamera,
    setSideCamera,
    step,
    syncHud,
  });
  // stageShot may have rebuilt the world; refresh the handles it used.
  game.world.setRingStates(game.currentRing);
  syncPlaneModel(model, game.state, 0, 0);
  game.world.update(0, 0, game.state.pos, game.currentRing);
  if (SHOT === 'play') setChaseCamera(true);
  if (SHOT === 'end') { game.mode = 'finished'; setSideCamera(); }
  if (SHOT === 'start') setOrbitCamera(-0.62);
  syncHud();
} else {
  game.mode = 'menu';
  showScreen('menu');
}

let last = performance.now();
let accumulator = 0;
let framesRendered = 0;
window.__game = game; // debug/inspection hook (harmless in normal play)

function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (!game.frozen) {
    handleActions(input.takeActions());
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
        hud.toast('GO!');
      }
      accumulator += dtReal;
      while (accumulator >= STEP) {
        step(STEP, { pitch: 0, roll: 0, throttleSet: 0 });
        accumulator -= STEP;
      }
    } else if (game.mode === 'flying' || game.mode === 'menu' || game.mode === 'finished') {
      accumulator += dtReal;
      while (accumulator >= STEP) {
        game.time += STEP;
        if (game.mode === 'flying') {
          const stick = input.stick();
          step(STEP, { pitch: stick.pitch, roll: stick.roll, throttleDelta: input.throttleDelta() });
        } else {
          // Menu and results: the world idles (clouds drift, prop ticks over).
          syncPlaneModel(model, game.state, STEP, game.time);
          game.world.update(STEP, game.time, game.state.pos, game.currentRing);
          fx.update(STEP);
          if (game.mode === 'menu') setOrbitCamera(game.time * 0.11 - 0.6);
          else setSideCamera();
          syncHud();
        }
        accumulator -= STEP;
      }
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

  renderer.render(scene, camera);
  framesRendered++;
  if (SHOT && framesRendered >= 3) window.__shotReady = true;
}
requestAnimationFrame(frame);
