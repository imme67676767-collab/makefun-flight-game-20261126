// The aeroplane: a low-poly model built from primitives, and the flight model
// that moves it. Everything is smoothed — throttle, pitch and roll all ease
// toward what the pilot asks for, a released stick drifts back to level, and
// the turn comes from the bank, the way a real wing turns. Nothing snaps.

import { COLORS, FLIGHT, WORLD } from './config.js';
import { lagFactor, lerp } from './random.js';

const THREE = window.THREE;

function part(geometry, color, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color, flatShading: true, roughness: 0.65, metalness: 0.08,
  }));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

/** The little red-and-white tourer: fuselage, wings, tail, spinning prop, nav lights. */
export function buildPlaneModel() {
  const plane = new THREE.Group();

  const fuselage = part(new THREE.CylinderGeometry(0.42, 0.95, 7.2, 9), COLORS.planeBody);
  fuselage.rotation.x = Math.PI / 2; // cylinder axis onto Z, slim end to the tail (+Z)
  plane.add(fuselage);

  const belly = part(new THREE.BoxGeometry(1.3, 0.5, 3.4), COLORS.planeTrim, 0, -0.62, -0.4);
  plane.add(belly);

  const canopy = part(new THREE.SphereGeometry(0.78, 10, 8), 0x1d2f45, 0, 0.72, -0.7);
  canopy.scale.set(0.85, 0.72, 1.5);
  canopy.material.roughness = 0.15;
  canopy.material.metalness = 0.4;
  plane.add(canopy);

  for (const side of [-1, 1]) {
    const wing = part(new THREE.BoxGeometry(5.6, 0.16, 1.9), COLORS.planeWing, side * 3.1, 0.18, -0.35);
    wing.rotation.z = side * -0.055; // a touch of dihedral
    plane.add(wing);
    const tip = part(new THREE.BoxGeometry(0.5, 0.2, 1.9), COLORS.planeBody, side * 5.85, 0.33, -0.35);
    plane.add(tip);
    const leg = part(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 5), 0x444a52, side * 1.5, -1.15, -0.7);
    plane.add(leg);
    const wheel = part(new THREE.CylinderGeometry(0.42, 0.42, 0.28, 9), 0x22262c, side * 1.5, -1.65, -0.7);
    wheel.rotation.z = Math.PI / 2;
    plane.add(wheel);
  }

  const tailplane = part(new THREE.BoxGeometry(3.7, 0.13, 1.15), COLORS.planeWing, 0, 0.35, 3.25);
  plane.add(tailplane);
  const fin = part(new THREE.BoxGeometry(0.13, 1.7, 1.3), COLORS.planeBody, 0, 1.05, 3.3);
  plane.add(fin);
  const tailWheel = part(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 8), 0x22262c, 0, -0.5, 3.45);
  tailWheel.rotation.z = Math.PI / 2;
  plane.add(tailWheel);

  const spinner = part(new THREE.ConeGeometry(0.42, 1.0, 9), COLORS.planeTrim, 0, 0, -3.95);
  spinner.rotation.x = -Math.PI / 2;
  plane.add(spinner);

  const prop = new THREE.Group();
  prop.position.set(0, 0, -3.72);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, flatShading: true, roughness: 0.5 });
  for (const angle of [0, Math.PI / 2]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.34, 3.5, 0.07), bladeMat);
    blade.rotation.z = angle;
    prop.add(blade);
  }
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.78, 24),
    new THREE.MeshBasicMaterial({ color: 0xdfe9f2, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  );
  prop.add(disc);
  plane.add(prop);

  const navLights = [];
  const navSpots = [
    { x: -6.05, y: 0.36, z: -0.35, color: 0xff3b30 },
    { x: 6.05, y: 0.36, z: -0.35, color: 0x35e065 },
    { x: 0, y: 0.45, z: 3.9, color: 0xffffff },
  ];
  for (const spot of navSpots) {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), new THREE.MeshBasicMaterial({ color: spot.color }));
    bulb.position.set(spot.x, spot.y, spot.z);
    plane.add(bulb);
    navLights.push(bulb);
  }

  // A simple dashboard, only seen from the cockpit camera.
  const dash = new THREE.Group();
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.62, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x232830, roughness: 0.85 }),
  );
  dash.add(panel);
  for (let i = -1; i <= 1; i++) {
    const gauge = new THREE.Mesh(
      new THREE.CircleGeometry(0.17, 18),
      new THREE.MeshBasicMaterial({ color: i === 0 ? 0x9fd8ff : 0xffd97a }),
    );
    gauge.position.set(i * 0.48, 0.05, 0.07);
    dash.add(gauge);
  }
  dash.position.set(0, 0.42, -1.75);
  dash.rotation.x = -0.35;
  dash.visible = false;
  plane.add(dash);

  return { group: plane, prop, navLights, dash };
}

/** Fresh flight state parked on the start runway, nose pointing north. */
export function createFlightState(startPad) {
  return {
    pos: new THREE.Vector3(startPad.x, startPad.h + 1.9, startPad.z + WORLD.runwayLength / 2 - 26),
    yaw: 0,
    pitch: 0,
    roll: 0,
    speed: 0,
    throttle: 0,
    airborne: false,
    stalled: false,
    grounded: true,
    sinkRate: 0,
    propAngle: 0,
  };
}

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _forward = new THREE.Vector3();

/** Unit vector the nose points along, from the state's yaw and pitch. */
export function forwardOf(state, out = new THREE.Vector3()) {
  _euler.set(state.pitch, state.yaw, 0);
  return out.set(0, 0, -1).applyEuler(_euler);
}

/** Compass heading in degrees: 0 north, 90 east. */
export function headingOf(state) {
  forwardOf(state, _forward);
  const deg = Math.atan2(_forward.x, -_forward.z) * 180 / Math.PI;
  return (deg + 360) % 360;
}

/**
 * Advance the flight model one step.
 * input: { pitch, roll } in -1..1 (pitch +1 = pull up, roll +1 = bank right),
 *        { throttleDelta } in -1..1, or { throttleSet } to place the lever.
 * env:   { heightAt(x, z), windX } — terrain height and sideways gust in m/s.
 * Returns 'crash', 'landed', 'takeoff' or null.
 */
export function stepFlight(state, input, env, dt) {
  // Throttle lever.
  if (input.throttleSet !== undefined) state.throttle = input.throttleSet;
  else state.throttle += (input.throttleDelta || 0) * FLIGHT.throttleRate * dt;
  state.throttle = Math.min(1, Math.max(0, state.throttle));

  // Stick: eased toward the ask, so the nose never jumps. Released = level.
  const pitchAsk = state.stalled ? -0.38 : (input.pitch || 0) * FLIGHT.maxPitch;
  const rollAsk = -(input.roll || 0) * FLIGHT.maxRoll;
  state.pitch += (pitchAsk - state.pitch) * lagFactor(dt, 0.34);
  state.roll += (rollAsk - state.roll) * lagFactor(dt, 0.3);
  if (Math.abs(input.roll || 0) < 0.02) state.roll += (0 - state.roll) * lagFactor(dt, 1 / FLIGHT.levelRate);

  // The bank turns the plane; faster flight turns a touch keener.
  const turnScale = Math.min(1.3, Math.max(0.45, state.speed / FLIGHT.cruiseSpeed));
  state.yaw += Math.sin(state.roll) * FLIGHT.turnRate * turnScale * dt;

  // Speed: throttle pulls toward its target, climbing trades speed for height.
  // The idle floor only applies in the air — on the ground, throttle 0 means stop.
  const floor = state.airborne ? FLIGHT.minSpeed * 0.75 : 0;
  const targetSpeed = lerp(floor, FLIGHT.maxSpeed, state.throttle);
  const gravityTrade = state.airborne ? Math.sin(state.pitch) * FLIGHT.gravityPull * 0.55 : 0;
  const accel = (targetSpeed - state.speed) * 0.4 - gravityTrade;
  state.speed = Math.max(0, state.speed + accel * dt);

  state.stalled = state.airborne && state.speed < FLIGHT.minSpeed;

  forwardOf(state, _forward);
  const vel = _forward.clone().multiplyScalar(state.speed);
  vel.x += env.windX || 0;
  if (state.stalled) vel.y -= FLIGHT.stallDrop;
  state.sinkRate = -vel.y;

  if (!state.airborne) {
    // Rolling on the ground: steer straight, lift off when fast and pulling.
    state.pos.x += vel.x * dt;
    state.pos.z += vel.z * dt;
    const groundY = env.heightAt(state.pos.x, state.pos.z) + 1.9;
    state.pos.y = groundY;
    state.pitch = Math.min(state.pitch, 0.12);
    if (state.speed > FLIGHT.takeoffSpeed && (input.pitch || 0) > 0.25) {
      state.airborne = true;
      state.grounded = false;
      return 'takeoff';
    }
    if (state.speed > FLIGHT.takeoffSpeed * 1.3) {
      state.airborne = true;
      state.grounded = false;
      return 'takeoff';
    }
    return null;
  }

  state.pos.addScaledVector(vel, dt);
  if (state.pos.y > WORLD.ceiling) {
    state.pos.y = WORLD.ceiling;
    state.pitch = Math.min(state.pitch, 0);
  }

  const groundY = env.heightAt(state.pos.x, state.pos.z) + 1.9;
  if (state.pos.y <= groundY) {
    state.pos.y = groundY;
    const gentle = state.speed <= FLIGHT.landMaxSpeed
      && state.sinkRate <= FLIGHT.landMaxSink
      && Math.abs(state.roll) < 0.35
      && env.onRunway(state.pos.x, state.pos.z);
    if (gentle) {
      state.airborne = false;
      state.grounded = true;
      state.pitch = 0;
      state.roll = 0;
      return 'landed';
    }
    return 'crash';
  }
  return null;
}

/** Park the state back on a runway (after a crash or a reset), engine idling. */
export function resetToRunway(state, pad, headingNorth = true) {
  state.pos.set(pad.x, pad.h + 1.9, pad.z + (headingNorth ? WORLD.runwayLength / 2 - 26 : -WORLD.runwayLength / 2 + 26));
  state.yaw = headingNorth ? 0 : Math.PI;
  state.pitch = 0;
  state.roll = 0;
  state.speed = 0;
  state.throttle = 0;
  state.airborne = false;
  state.grounded = true;
  state.stalled = false;
}

/** Put the state in the air at a point, already flying (respawns, screenshot staging). */
export function placeInAir(state, pos, yaw, speed, throttle) {
  state.pos.copy(pos);
  state.yaw = yaw;
  state.pitch = 0;
  state.roll = 0;
  state.speed = speed;
  state.throttle = throttle;
  state.airborne = true;
  state.grounded = false;
  state.stalled = false;
}

/** Sync the model to the state and spin the prop; strobes blink once a second. */
export function syncPlaneModel(model, state, dt, time) {
  model.group.position.copy(state.pos);
  _euler.set(state.pitch, state.yaw, state.roll);
  model.group.quaternion.setFromEuler(_euler);
  state.propAngle += dt * (6 + state.throttle * 46 + state.speed * 0.35);
  model.prop.rotation.z = state.propAngle;
  const strobe = (time % 1) < 0.09;
  model.navLights[2].visible = strobe;
}

/** World positions of the two wingtips, for the vapour trails. */
export function wingtipPositions(model, outLeft, outRight) {
  outLeft.set(-5.9, 0.3, -0.35);
  outRight.set(5.9, 0.3, -0.35);
  model.group.localToWorld(outLeft);
  model.group.localToWorld(outRight);
}
