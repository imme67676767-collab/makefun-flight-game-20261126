// Screenshot staging behind ?shot=start|play|end. Each scene is the real game
// driven to a good-looking moment — the play scene is genuinely flown there
// by a small autopilot that banks toward the next ring — then frozen, so the
// frame is stable and the same seed always gives the same picture.

import { STEP } from './config.js';
import { forwardOf, placeInAir, resetToRunway } from './plane.js';
import { heightAt, pathTangent } from './world.js';

const THREE = window.THREE;

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function clampUnit(v) {
  return Math.max(-1, Math.min(1, v));
}

/**
 * A gentle autopilot: bank toward the target, pitch to its height, hold a
 * cruising throttle, and never let the ground get close. It flies the same
 * physics a player does, so the staged frame is one a real flight reaches.
 */
export function autopilotInput(state, target) {
  const fwd = forwardOf(state, new THREE.Vector3());
  const to = target.clone().sub(state.pos);
  const desiredHeading = Math.atan2(to.x, -to.z);
  const currentHeading = Math.atan2(fwd.x, -fwd.z);
  const headingError = wrapAngle(desiredHeading - currentHeading);

  const horizontal = Math.hypot(to.x, to.z);
  const desiredPitch = Math.atan2(to.y, Math.max(30, horizontal));
  let pitch = clampUnit((desiredPitch - state.pitch) * 2.4);

  const aboveGround = state.pos.y - heightAt(state.pos.x, state.pos.z);
  if (aboveGround < 38) pitch = Math.max(pitch, 0.55);

  return { pitch, roll: clampUnit(headingError * 1.5), throttleSet: 0.72 };
}

/**
 * Set the game to the named scene. `game` is the object main.js builds; this
 * function only drives its public handles (reset, step, cameras, screens).
 */
export function stageShot(name, game) {
  if (name === 'play') {
    game.reset(game.seed, 'normal');
    game.markRingsPassed(2);
    const ring = game.world.rings[2];
    const tangent = pathTangent(ring.centre.z);
    const start = ring.centre.clone().addScaledVector(tangent, -300);
    start.y = Math.max(start.y, heightAt(start.x, start.z) + 70);
    const yaw = Math.atan2(tangent.x, -tangent.z);
    placeInAir(game.state, start, yaw, 54, 0.72);
    // Fly the approach for a couple of seconds so the trails form and the
    // plane settles into a natural bank toward the ring.
    const steps = Math.round(2.4 / STEP);
    for (let i = 0; i < steps; i++) {
      game.step(STEP, autopilotInput(game.state, ring.centre));
    }
    game.setMissionData({ ringsDone: 2, score: 1240, timeSec: 48.6 });
    game.showScreen('hud');
    game.setChaseCamera(true);
    game.syncHud();
    return;
  }

  if (name === 'end') {
    game.reset(game.seed, 'normal');
    game.markRingsPassed(game.world.rings.length);
    resetToRunway(game.state, game.world.finishPad, true);
    game.state.pos.z = game.world.finishPad.z + 40;
    game.setMissionData({ ringsDone: game.world.rings.length, score: 2385, timeSec: 96.4 });
    game.showScreen('results');
    game.setSideCamera();
    game.syncHud();
    return;
  }

  // start (and anything unknown): the menu over the parked plane and the range.
  game.reset(game.seed, 'normal');
  game.showScreen('menu');
  game.setOrbitCamera(-0.62);
  game.syncHud();
}
