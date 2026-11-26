// Screenshot staging behind ?shot=start|play|end|cockpit. Each scene is
// the real game driven to a good-looking moment — the play scene is
// genuinely flown there by a small autopilot that banks toward the next
// ring — then frozen, so the frame is stable and the same seed always
// gives the same picture. Staging skips the loading screen and cinematic:
// the world builds straight through on the default map and plane.

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

/** */
export function autopilotInput(state, target) {
  const fwd = forwardOf(state, new THREE.Vector3());
  const to = target.clone().sub(state.pos);
  const desiredHeading = Math.atan2(to.x, -to.z);
  const currentHeading = Math.atan2(fwd.x, -fwd.z);
  const headingError = wrapAngle(desiredHeading - currentHeading);

  const horizontal = Math.hypot(to.x, to.z);
  const desiredPitch = Math.atan2(to.y, Math.max(30, horizontal));
  // In the coordinated-turn model a bank bleeds lift, so add back-pressure
  // proportional to the bank to hold the flight path toward the ring.
  const bankComp = Math.abs(state.roll) * 0.38;
  let pitch = clampUnit((desiredPitch - state.pitch) * 2.0 + bankComp);

  const aboveGround = state.pos.y - heightAt(state.pos.x, state.pos.z);
  if (aboveGround < 42) pitch = Math.max(pitch, 0.5);

  return { pitch, roll: Math.max(-0.55, Math.min(0.55, headingError * 0.75)), throttleSet: 0.72 };
}

/** */
export async function stageShot(name, game) {
  if (name === 'cockpit') {
    // First-person check scene: same approach as play, from the pilot's seat.
    await game.reset(game.seed, 'normal', 'canyon', 'aerobatic');
    game.markRingsPassed(3);
    const ring = game.world.rings[3];
    const tangent = pathTangent(ring.centre.z);
    const start = ring.centre.clone().addScaledVector(tangent, -520);
    start.y = Math.max(start.y + 25, heightAt(start.x, start.z) + 90);
    const yaw = Math.atan2(ring.centre.x - start.x, -(ring.centre.z - start.z));
    placeInAir(game.state, start, yaw, 54, 0.72);
    const steps = Math.round(2.2 / STEP);
    for (let i = 0; i < steps; i++) {
      game.step(STEP, autopilotInput(game.state, ring.centre));
    }
    game.setMissionData({ ringsDone: 3, score: 1240, timeSec: 48.6 });
    game.showScreen('hud');
    game.setCockpit();
    game.syncHud();
    return;
  }

  if (name === 'play') {
    await game.reset(game.seed, 'normal', 'canyon', 'aerobatic');
    game.markRingsPassed(6);
    const ring = game.world.rings[6];
    const tangent = pathTangent(ring.centre.z);
    const start = ring.centre.clone().addScaledVector(tangent, -520);
    start.y = Math.max(start.y + 25, heightAt(start.x, start.z) + 90);
    const yaw = Math.atan2(ring.centre.x - start.x, -(ring.centre.z - start.z));
    placeInAir(game.state, start, yaw, 54, 0.72);
    // Fly the approach for a few seconds so the trails form and the
    // plane settles into a natural bank toward the ring.
    const steps = Math.round(2.8 / STEP);
    for (let i = 0; i < steps; i++) {
      game.step(STEP, autopilotInput(game.state, ring.centre));
    }
    game.setMissionData({ ringsDone: 6, score: 2480, timeSec: 96.2 });
    // A boost in progress: the chip shows on the HUD and the FOV stretches,
    // while the next pickup hangs between this ring and the following one.
    game.activateBoost();
    game.showScreen('hud');
    game.setChaseCamera(true);
    game.syncHud();
    return;
  }

  if (name === 'end') {
    await game.reset(game.seed, 'normal', 'canyon', 'aerobatic');
    game.markRingsPassed(game.world.rings.length);
    resetToRunway(game.state, game.world.finishPad, true);
    game.state.pos.z = game.world.finishPad.z + 40;
    game.setMissionData({ ringsDone: game.world.rings.length, score: 3135, timeSec: 96.4 });
    game.setBreakdown({ ringScore: 1600, finish: 1000, timeBonus: 320, hpBonus: 215, crashPenalty: 0, total: 3135 });
    game.showScreen('results');
    game.setSideCamera();
    game.syncHud();
    return;
  }

  // start (and anything unknown): the title screen over the parked plane.
  await game.reset(game.seed, 'normal', 'canyon', 'aerobatic');
  game.showScreen('title');
  game.setOrbitCamera(-0.62);
  game.syncHud();
}
