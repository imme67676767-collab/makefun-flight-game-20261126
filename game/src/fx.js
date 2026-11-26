// Effects: one pooled particle system drives the wingtip vapour trails, the
// golden burst on a ring pass and the fireball of a crash, plus two pooled
// meshes for the shockwave flash and the ring ripple. Nothing allocates in
// the frame loop: every particle lives in pre-sized typed arrays.

const THREE = window.THREE;

const POOL = 1600;

/** A soft round sprite so points read as puffs and sparks, not squares. */
function puffTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export function createFx(scene) {
  const positions = new Float32Array(POOL * 3);
  const colors = new Float32Array(POOL * 3);
  const velocities = new Float32Array(POOL * 3);
  const life = new Float32Array(POOL);
  const maxLife = new Float32Array(POOL);
  const baseColor = new Float32Array(POOL * 3);
  const gravity = new Float32Array(POOL);
  const drag = new Float32Array(POOL);
  let cursor = 0;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.85,
    map: puffTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  }));
  points.frustumCulled = false;
  scene.add(points);

  const flashPool = [];
  for (let i = 0; i < 2; i++) {
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(1, 18, 12),
      new THREE.MeshBasicMaterial({ color: 0xffb056, transparent: true, opacity: 0, depthWrite: false }),
    );
    flash.visible = false;
    scene.add(flash);
    flashPool.push({ mesh: flash, t: 1 });
  }

  const ripplePool = [];
  for (let i = 0; i < 3; i++) {
    const ripple = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.05, 8, 42),
      new THREE.MeshBasicMaterial({ color: 0xffc93c, transparent: true, opacity: 0, depthWrite: false }),
    );
    ripple.visible = false;
    scene.add(ripple);
    ripplePool.push({ mesh: ripple, t: 1 });
  }

  // Engine smoke: dark sprites (normal blending — the additive point pool
  // cannot do dark smoke). A small fixed pool; the emitter state is set
  // every frame by setSmoke() and consumed here in update().
  const smokePool = [];
  const smokeTex = puffTexture();
  for (let i = 0; i < 26; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: smokeTex, color: 0x4a4642, transparent: true, opacity: 0, depthWrite: false,
    }));
    sprite.visible = false;
    scene.add(sprite);
    smokePool.push({ sprite, age: 1, life: 1, vx: 0, vy: 0, vz: 0, grow: 2 });
  }
  const smokeEmit = { rate01: 0, acc: 0, pos: new THREE.Vector3(), drift: new THREE.Vector3() };

  function spawn(x, y, z, vx, vy, vz, color, lifeSeconds, gravityFactor, dragFactor) {
    const i = cursor;
    cursor = (cursor + 1) % POOL;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    velocities[i * 3] = vx;
    velocities[i * 3 + 1] = vy;
    velocities[i * 3 + 2] = vz;
    baseColor[i * 3] = color.r;
    baseColor[i * 3 + 1] = color.g;
    baseColor[i * 3 + 2] = color.b;
    life[i] = lifeSeconds;
    maxLife[i] = lifeSeconds;
    gravity[i] = gravityFactor;
    drag[i] = dragFactor;
  }

  const _color = new THREE.Color();

  return {
    /** A spherical burst: ring passes (gold, weightless) and crashes (orange, falling). */
    burst(pos, hex, count, speed, lifeSeconds, gravityFactor = 0) {
      _color.set(hex);
      for (let n = 0; n < count; n++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const sp = speed * (0.35 + Math.random() * 0.85);
        spawn(
          pos.x, pos.y, pos.z,
          Math.sin(phi) * Math.cos(theta) * sp,
          Math.cos(phi) * sp,
          Math.sin(phi) * Math.sin(theta) * sp,
          _color, lifeSeconds * (0.6 + Math.random() * 0.7), gravityFactor, 1.6,
        );
      }
    },

    /** One vapour puff from a wingtip; called at a rate that grows with speed. */
    trailPuff(pos, strength) {
      _color.setRGB(0.16, 0.18, 0.2);
      spawn(
        pos.x + (Math.random() - 0.5) * 0.4,
        pos.y + (Math.random() - 0.5) * 0.4,
        pos.z + (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 1.2,
        -0.8 - Math.random(),
        (Math.random() - 0.5) * 1.2,
        _color, 0.45 + strength * 0.35, -0.4, 0.6,
      );
    },

    /** One bright vortex puff from a wingtip: whiter and longer-lived than
     *  the faint speed vapour, so a hard bank draws a visible ribbon. */
    vortexPuff(pos, strength) {
      _color.setRGB(0.52, 0.55, 0.6);
      spawn(
        pos.x + (Math.random() - 0.5) * 0.3,
        pos.y + (Math.random() - 0.5) * 0.3,
        pos.z + (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.8,
        -0.5 - Math.random() * 0.6,
        (Math.random() - 0.5) * 0.8,
        _color, 0.8 + strength * 0.7, -0.25, 0.35,
      );
    },

    /** Point the smoke emitter: rate01 0 (healthy) .. 1 (about to quit).
     *  drift is the backward airflow the smoke should be carried by. */
    setSmoke(pos, rate01, drift) {
      smokeEmit.pos.copy(pos);
      smokeEmit.rate01 = Math.max(0, Math.min(1, rate01));
      if (drift) smokeEmit.drift.copy(drift);
    },

    /** Kill every live smoke sprite at once (repair / respawn). */
    clearSmoke() {
      smokeEmit.rate01 = 0;
      smokeEmit.acc = 0;
      for (const s of smokePool) {
        s.age = s.life;
        s.sprite.visible = false;
        s.sprite.material.opacity = 0;
      }
    },

    /** How many smoke sprites are currently alive (probe/debug). */
    smokeAlive() {
      let n = 0;
      for (const s of smokePool) if (s.age < s.life) n++;
      return n;
    },

    /** The crash fireball: a bright sphere that swells and fades in half a second. */
    flash(pos) {
      const slot = flashPool.find((f) => f.t >= 1) || flashPool[0];
      slot.mesh.position.copy(pos);
      slot.mesh.visible = true;
      slot.t = 0;
    },

    /** A golden ripple expanding from a ring the plane just threaded. */
    ripple(pos, quaternion, radius) {
      const slot = ripplePool.find((r) => r.t >= 1) || ripplePool[0];
      slot.mesh.position.copy(pos);
      slot.mesh.quaternion.copy(quaternion);
      slot.mesh.scale.setScalar(radius);
      slot.mesh.visible = true;
      slot.t = 0;
      slot.radius = radius;
    },

    update(dt) {
      for (let i = 0; i < POOL; i++) {
        if (life[i] <= 0) {
          colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = 0;
          continue;
        }
        life[i] -= dt;
        const fade = Math.max(0, life[i] / maxLife[i]);
        velocities[i * 3 + 1] -= 9.8 * gravity[i] * dt;
        const damp = Math.max(0, 1 - drag[i] * dt);
        velocities[i * 3] *= damp;
        velocities[i * 3 + 1] *= damp;
        velocities[i * 3 + 2] *= damp;
        positions[i * 3] += velocities[i * 3] * dt;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
        colors[i * 3] = baseColor[i * 3] * fade;
        colors[i * 3 + 1] = baseColor[i * 3 + 1] * fade;
        colors[i * 3 + 2] = baseColor[i * 3 + 2] * fade;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;

      // Smoke: spawn at a rate that grows with damage, then age each puff.
      if (smokeEmit.rate01 > 0.01) {
        smokeEmit.acc += dt * (4 + smokeEmit.rate01 * 16);
        while (smokeEmit.acc >= 1) {
          smokeEmit.acc -= 1;
          const slot = smokePool.find((s) => s.age >= s.life);
          if (!slot) break;
          slot.age = 0;
          slot.life = 1.1 + Math.random() * 0.6;
          slot.grow = 2.2 + smokeEmit.rate01 * 1.6;
          slot.sprite.position.copy(smokeEmit.pos);
          slot.sprite.position.x += (Math.random() - 0.5) * 0.3;
          slot.sprite.position.y += (Math.random() - 0.5) * 0.3;
          slot.sprite.position.z += (Math.random() - 0.5) * 0.3;
          slot.vx = smokeEmit.drift.x + (Math.random() - 0.5) * 1.4;
          slot.vy = smokeEmit.drift.y + 0.7 + Math.random() * 0.5;
          slot.vz = smokeEmit.drift.z + (Math.random() - 0.5) * 1.4;
          slot.sprite.visible = true;
        }
      }
      for (const s of smokePool) {
        if (s.age >= s.life) continue;
        s.age += dt;
        const f = Math.min(1, s.age / s.life);
        s.sprite.position.x += s.vx * dt;
        s.sprite.position.y += s.vy * dt;
        s.sprite.position.z += s.vz * dt;
        const size = 0.8 + f * s.grow;
        s.sprite.scale.set(size, size * 0.8, 1);
        s.sprite.material.opacity = 0.5 * (1 - f) * Math.min(1, s.age * 5);
        if (f >= 1) s.sprite.visible = false;
      }

      for (const slot of flashPool) {
        if (slot.t >= 1) continue;
        slot.t = Math.min(1, slot.t + dt * 2.2);
        const grow = 2 + slot.t * 15;
        slot.mesh.scale.setScalar(grow);
        slot.mesh.material.opacity = 0.75 * (1 - slot.t);
        if (slot.t >= 1) slot.mesh.visible = false;
      }
      for (const slot of ripplePool) {
        if (slot.t >= 1) continue;
        slot.t = Math.min(1, slot.t + dt * 1.5);
        slot.mesh.scale.setScalar(slot.radius * (1 + slot.t * 0.85));
        slot.mesh.material.opacity = 0.9 * (1 - slot.t);
        if (slot.t >= 1) slot.mesh.visible = false;
      }
    },
  };
}
