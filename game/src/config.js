// Sky Ring Runner — every tuning number in one place.
//
// The world is measured in metres. The course runs south to north (toward -Z):
// the start runway sits at the south end of a winding canyon, the finish
// runway at the north end, and the target rings hang along the canyon between
// them. One seed lays out the same canyon, rings, trees and clouds every time.

export const WORLD = {
  size: 4200,            // terrain edge length (square, centred on origin)
  segments: 144,         // terrain grid resolution (flat-shaded, low poly)
  startZ: 1560,          // start runway centre
  finishZ: -1560,        // finish runway centre
  runwayLength: 340,
  runwayWidth: 34,
  ceiling: 620,          // soft altitude cap (the plane eases off above it)
  fogNear: 900,
  fogFar: 3400,
};

/** Difficulty presets: ring count, ring radius, par time for the time bonus, wind. */
export const DIFFICULTY = {
  easy:   { label: 'Easy',   rings: 6,  ringRadius: 17, parSeconds: 240, wind: 0 },
  normal: { label: 'Normal', rings: 10, ringRadius: 13, parSeconds: 210, wind: 0 },
  hard:   { label: 'Hard',   rings: 12, ringRadius: 10, parSeconds: 200, wind: 6 },
};

export const FLIGHT = {
  minSpeed: 16,          // m/s, below this the wing stalls
  cruiseSpeed: 46,       // m/s at mid throttle
  maxSpeed: 88,          // m/s at full throttle in level flight
  throttleRate: 0.55,    // throttle units per second while the key is held
  pitchRate: 1.15,       // rad/s at full stick
  rollRate: 2.4,         // rad/s at full stick
  maxPitch: 0.95,        // rad, stick stops here
  maxRoll: 1.15,         // rad
  levelRate: 1.6,        // 1/s, how fast a released stick eases back to level
  turnRate: 0.85,        // yaw rad/s at full bank and cruise speed
  gravityPull: 9.5,      // m/s^2 traded between climb and speed
  stallDrop: 7,          // m/s of sink while stalled
  takeoffSpeed: 26,      // m/s needed to leave the runway
  landMaxSpeed: 34,      // m/s, faster than this on touchdown is a crash
  landMaxSink: 5.5,      // m/s of descent allowed at touchdown
};

export const SCORE = {
  ringBase: 100,
  ringCentreBonus: 100,  // scaled by how close to the ring centre the pass was
  finishBase: 1000,
  timeBonusPerSecond: 10,
  crashPenalty: 150,
  ratings: [             // best first; the first threshold the score reaches wins
    { grade: 'S', min: 2700 },
    { grade: 'A', min: 2300 },
    { grade: 'B', min: 1800 },
    { grade: 'C', min: 0 },
  ],
};

export const COLORS = {
  skyTop: 0x2e6fd8,
  skyHorizon: 0xbfe3ff,
  fog: 0xcfe6f7,
  sun: 0xfff2d8,
  grassLow: 0x58a447,
  grassHigh: 0x7fb35a,
  rock: 0x8a7f74,
  snow: 0xf4f8fb,
  river: 0x3f8fd2,
  ringNext: 0xffc93c,
  ringTodo: 0x37d6e0,
  ringDone: 0x52e07a,
  planeBody: 0xe8452c,
  planeTrim: 0xf5f2ea,
  planeWing: 0x2c5fe8,
};

/** Fixed simulation step (seconds) so the game feels the same at any refresh rate. */
export const STEP = 1 / 60;

export const BEST_KEY = 'sky-ring-runner.best';
