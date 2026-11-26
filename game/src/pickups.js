// Floating pickups between the rings: boost, shield and repair.
//
// Each pickup is a glowing octahedron core inside a tilted ring, with a
// painted icon billboard so the type reads at a glance. They bob and spin,
// vanish in a burst when collected, and reappear after a while so a long
// flight can refuel. Placement is deterministic from the course seed:
// one pickup midway between each pair of consecutive rings, nudged off
// the centreline so collecting one is a small detour, not a freebie.

import { COLORS, PICKUPS } from './config.js';
import { range } from './random.js';

const THREE = window.THREE;

const TYPES = [
  { key: 'boost', color: COLORS.pickupBoost },
  { key: 'shield', color: COLORS.pickupShield },
  { key: 'repair', color: COLORS.pickupRepair },
];

/** Painted icon: white glyph on a coloured disc. */
function iconTexture(kind, hex) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const color = `#${hex.toString(16).padStart(6, '0')}`;
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  if (kind === 'boost') {
    // Lightning bolt.
    ctx.beginPath();
    ctx.moveTo(72, 18);
    ctx.lineTo(40, 70);
    ctx.lineTo(60, 70);
    ctx.lineTo(52, 110);
    ctx.lineTo(90, 56);
    ctx.lineTo(68, 56);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'shield') {
    ctx.beginPath();
    ctx.moveTo(64, 20);
    ctx.lineTo(98, 32);
    ctx.lineTo(98, 62);
    ctx.quadraticCurveTo(98, 92, 64, 108);
    ctx.quadraticCurveTo(30, 92, 30, 62);
    ctx.lineTo(30, 32);
    ctx.closePath();
    ctx.fill();
  } else {
    // Repair cross.
    ctx.fillRect(52, 28, 24, 72);
    ctx.fillRect(28, 52, 72, 24);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createPickups(scene, rings, rng) {
  const group = new THREE.Group();
  scene.add(group);
  const items = [];
  const textures = {};
  for (const type of TYPES) textures[type.key] = iconTexture(type.key, type.color);

  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i].centre;
    const b = rings[i + 1].centre;
    const mid = a.clone().lerp(b, 0.5);
    // Nudge sideways off the direct line between the rings.
    const side = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3(0, 1, 0)).normalize();
    mid.addScaledVector(side, range(rng, -26, 26));
    mid.y += range(rng, -8, 10);
    const type = TYPES[i % TYPES.length];

    const holder = new THREE.Group();
    holder.position.copy(mid);
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.7, 0),
      new THREE.MeshStandardMaterial({
        color: type.color, emissive: type.color, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.2,
      }),
    );
    core.castShadow = true;
    holder.add(core);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.9, 0.16, 8, 28),
      new THREE.MeshBasicMaterial({ color: type.color, transparent: true, opacity: 0.85 }),
    );
    ring.rotation.x = Math.PI / 2.4;
    holder.add(ring);
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures[type.key], transparent: true, depthWrite: false }));
    icon.scale.set(4.6, 4.6, 1);
    icon.position.y = 0.2;
    holder.add(icon);
    group.add(holder);

    items.push({
      type: type.key,
      color: type.color,
      holder,
      core,
      ring,
      baseY: mid.y,
      pos: mid,
      active: true,
      respawnAt: 0,
      respawns: 0, // each pickup comes back at most once per run
      phase: rng() * Math.PI * 2,
    });
  }

  return {
    group,
    items,
    /** Animate bobbing/spinning and bring back collected pickups on time. */
    update(dt, time) {
      for (const item of items) {
        if (!item.active) {
          if (time >= item.respawnAt) {
            item.active = true;
            item.holder.visible = true;
          }
          continue;
        }
        item.holder.position.y = item.baseY + Math.sin(time * 1.6 + item.phase) * 1.1;
        item.core.rotation.y += dt * 1.8;
        item.core.rotation.x += dt * 0.7;
        item.ring.rotation.z += dt * 1.1;
      }
    },
    /** If the plane is close enough to an active pickup, collect it. */
    tryCollect(planePos, time) {
      for (const item of items) {
        if (!item.active) continue;
        if (planePos.distanceTo(item.holder.position) <= PICKUPS.collectRadius) {
          item.active = false;
          item.holder.visible = false;
          item.respawns++;
          item.respawnAt = item.respawns <= 1 ? time + PICKUPS.respawnSeconds : Infinity;
          return item;
        }
      }
      return null;
    },
    /** Nearest active pickup of a type, for screenshot staging. */
    nearestOfType(type, fromPos) {
      let best = null;
      let bestDist = Infinity;
      for (const item of items) {
        if (item.type !== type || !item.active) continue;
        const d = fromPos.distanceTo(item.pos);
        if (d < bestDist) { bestDist = d; best = item; }
      }
      return best;
    },
    reset() {
      for (const item of items) {
        item.active = true;
        item.holder.visible = true;
        item.respawns = 0;
      }
    },
  };
}
