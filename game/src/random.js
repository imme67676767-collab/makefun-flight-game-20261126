// Seeded randomness. One seed always lays out the same canyon, rings, trees
// and clouds, which is what makes the screenshot scenes repeatable: seed 1
// flies the same course in the screenshots as it does for a player.

/**
 * A small fast PRNG (mulberry32 family). Returns a function giving floats in
 * [0, 1). The state lives in the closure so several independent streams can
 * run side by side (terrain, decoration, gusts).
 */
export function createRandom(seed) {
  let state = (seed | 0) || 1;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A float in [min, max) from a stream made by createRandom. */
export function range(random, min, max) {
  return min + random() * (max - min);
}

/** An integer in [min, max] inclusive from a stream made by createRandom. */
export function intRange(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

/** One item of a list, chosen by the stream. */
export function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

/** Smooth 0..1 ramp between two edges (the classic smoothstep curve). */
export function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Linear interpolation with the blend clamped to [0, 1]. */
export function lerp(a, b, t) {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

/** Frame-rate independent easing factor for a first-order lag with time constant tau. */
export function lagFactor(dt, tau) {
  return 1 - Math.exp(-dt / tau);
}
