// Sky Ring Runner — every tuning number in one place.
//
// The world is measured in metres. The course runs south to north (toward -Z):
// the start runway sits at the south end of a winding canyon, the finish
// runway at the north end, and the target rings hang along the canyon between
// them. One seed lays out the same canyon, rings, trees and clouds every time.

export const WORLD = {
  size: 7000,            // terrain edge length (square, centred on origin)
  segments: 320,         // terrain grid resolution (smooth-shaded)
  startZ: 2400,          // start runway centre
  finishZ: -2400,        // finish runway centre
  runwayLength: 340,
  runwayWidth: 34,
  ceiling: 820,          // soft altitude cap (the plane eases off above it)
  fogNear: 1400,
  fogFar: 6500,
  fogDensity: 0.0001,   // FogExp2 density for the clear-day aerial perspective
};

/** Difficulty presets: ring count, ring radius, par time, base wind, weather odds. */
export const DIFFICULTY = {
  easy:   { label: 'Easy',   rings: 6,  ringRadius: 17, parSeconds: 300, wind: 0, weatherChance: 0.22 },
  normal: { label: 'Normal', rings: 10, ringRadius: 13, parSeconds: 260, wind: 0, weatherChance: 0.38 },
  hard:   { label: 'Hard',   rings: 12, ringRadius: 10, parSeconds: 250, wind: 6, weatherChance: 0.55 },
};

/** */
export const MAPS = {
  canyon: {
    stars: 2,
    heightScale: 1.0,
    snowLine: 235,
    lakeZ: 640, lakeOffsetX: 230, lakeR: 230,
    scatterMult: 1.0,
    villages: 3,
    weatherMult: 1.0,
    stormClouds: 3,
    traffic: 3,
    ringAltMin: 52, ringAltMax: 95, ringLateral: 55,
    palette: null, // default COLORS
  },
  lakeside: {
    stars: 1,
    heightScale: 0.32,
    snowLine: 900,
    lakeZ: 420, lakeOffsetX: 320, lakeR: 380,
    scatterMult: 1.25,
    villages: 5,
    weatherMult: 0.55,
    stormClouds: 1,
    traffic: 2,
    ringAltMin: 42, ringAltMax: 72, ringLateral: 70,
    palette: { grassLow: 0x57a845, grassHigh: 0x8cc465, rock: 0x9a958c },
  },
  snowpeak: {
    stars: 3,
    heightScale: 1.4,
    snowLine: 120,
    lakeZ: -520, lakeOffsetX: 210, lakeR: 190,
    scatterMult: 0.8,
    villages: 2,
    weatherMult: 1.6,
    stormClouds: 5,
    traffic: 4,
    ringAltMin: 62, ringAltMax: 120, ringLateral: 48,
    palette: { grassLow: 0x4d8a4a, grassHigh: 0x6fae63, rock: 0x7e7c78 },
  },
};

/** */
export const PLANES = {
  aerobatic: {
    hp: 100,
    thrust0: 10.2, thrustSlope: 0.042,
    kDrag0: 0.00072, kDragI: 0.00135,
    kLift: 0.0132, stallAlpha: 0.26,
    maxRoll: 1.28, pitchOmega: 3.4, rollOmega: 4.2,
    takeoffSpeed: 26, boostFactor: 1.45,
    stats: { speed: 62, hull: 55, agility: 92, climb: 74 },
    colors: { body: 0xf4f6f8, trim: 0x2456c8, accent: 0xe8452c },
    wing: 'mid',
  },
  racer: {
    hp: 70,
    thrust0: 13.0, thrustSlope: 0.036,
    kDrag0: 0.00052, kDragI: 0.0011,
    kLift: 0.0112, stallAlpha: 0.22,
    maxRoll: 1.02, pitchOmega: 3.0, rollOmega: 3.1,
    takeoffSpeed: 34, boostFactor: 1.52,
    stats: { speed: 97, hull: 30, agility: 48, climb: 88 },
    colors: { body: 0xffd23c, trim: 0x1d2126, accent: 0xe8452c },
    wing: 'low',
  },
  trainer: {
    hp: 145,
    thrust0: 8.4, thrustSlope: 0.05,
    kDrag0: 0.00095, kDragI: 0.0016,
    kLift: 0.0158, stallAlpha: 0.31,
    maxRoll: 0.82, pitchOmega: 2.7, rollOmega: 2.6,
    takeoffSpeed: 21, boostFactor: 1.34,
    stats: { speed: 38, hull: 95, agility: 40, climb: 52 },
    colors: { body: 0xe8f0e4, trim: 0x3f8f4f, accent: 0xff9a3c },
    wing: 'high',
  },
};

export const FLIGHT = {
  minSpeed: 16,          // m/s, below this the wing stalls
  cruiseSpeed: 46,       // m/s at mid throttle
  maxSpeed: 88,          // m/s at full throttle in level flight
  throttleRate: 0.55,    // throttle units per second while the key is held
  pitchRate: 1.15,       // rad/s at full stick
  rollRate: 2.4,         // rad/s at full stick
  maxPitch: 0.95,        // rad, stick stops here
  maxRoll: 1.28,         // rad (unlimited-aerobatic authority)
  levelRate: 1.6,        // 1/s, how fast a released stick eases back to level
  turnRate: 0.85,        // yaw rad/s at full bank and cruise speed
  gravityPull: 9.5,      // m/s^2 traded between climb and speed
  stallDrop: 7,          // m/s of sink while stalled
  takeoffSpeed: 26,      // m/s needed to leave the runway
  landMaxSpeed: 34,      // m/s, faster than this on touchdown is a hard hit
  landMaxSink: 5.5,      // m/s of descent allowed at touchdown
  boostFactor: 1.38,     // speed multiplier while the boost pickup lasts
};

/** Hull health: impacts, lightning and the tornado wear it down; zero = boom. */
export const HEALTH = {
  max: 100,
  hardHitSpeed: 52,      // touchdown faster than this hurts a lot
  hardHitSink: 10,       // ...or sinking faster than this
  roughLanding: 12,      // off-runway but gentle: bumps and scrapes
  hardLanding: 38,       // firm arrival on a runway
  crashLanding: 65,      // arriving like a lawn dart
  lightning: 18,
  birdStrike: 8,
  trafficHit: 35,
  stormStrike: 12,
  tornadoPerSecond: 9,
  repairAmount: 38,
};

/** Pickups floating along the course between the rings. */
export const PICKUPS = {
  boostSeconds: 7,
  shieldSeconds: 10,
  collectRadius: 9,
  respawnSeconds: 25,    // a collected pickup comes back after this long
};

/** Random weather events: one at a time, rolled while flying. */
export const WEATHER = {
  rollEverySeconds: 16,  // how often the dice roll for a new event
  minSeconds: 13,
  maxSeconds: 21,
  warningSeconds: 3,     // banner lead time before the event bites
  gustStrength: 17,      // m/s of sideways push at the peak of a gust front
  stormTurbulence: 0.55, // stick noise amplitude in a thunderstorm
  rainFogFar: 1150,      // visibility in heavy rain
  tornadoPullRadius: 130,
  tornadoCoreRadius: 34,
};

/** Quality tiers: what the world builder and renderer spend. */
export const QUALITY = {
  high:   { shadows: true,  shadowMap: 2048, post: true,  bloom: true,  ao: true,  trees: 520, pines: 380, bushes: 340, flowers: 420, reeds: 150, butterflies: 16, deer: 5, cattle: 4, sheep: 6, eagles: 2, cloudSprites: 150, cloudPuffs: 220, birds: 20, rainDrops: 2200 },
  medium: { shadows: true,  shadowMap: 1024, post: true,  bloom: true,  ao: false, trees: 320, pines: 230, bushes: 210, flowers: 260, reeds: 95,  butterflies: 11, deer: 4, cattle: 3, sheep: 5, eagles: 2, cloudSprites: 90,  cloudPuffs: 130, birds: 14, rainDrops: 1400 },
  low:    { shadows: false, shadowMap: 512,  post: false, bloom: false, ao: false, trees: 160, pines: 110, bushes: 110, flowers: 130, reeds: 55,  butterflies: 7,  deer: 3, cattle: 2, sheep: 3, eagles: 1, cloudSprites: 45,  cloudPuffs: 60,  birds: 8,  rainDrops: 800 },
};

/** Low-hull heartbeat: one period shared by the HUD edge pulse and the audio thump. */
export const HULL_PULSE = {
  threshold: 0.25,   // hull fraction at or below which the pulse runs
  periodSec: 1.05,   // seconds per heartbeat cycle (visual + audio stay in sync)
};

export const SCORE = {
  ringBase: 100,
  ringCentreBonus: 100,  // scaled by how close to the ring centre the pass was
  finishBase: 1000,
  timeBonusPerSecond: 10, // per second under par (never negative)
  hpBonusMax: 500,        // scaled by remaining hull fraction
  crashPenalty: 150,
  ratings: [             // best first; the first threshold the score reaches wins
    { grade: 'S', min: 3300 },
    { grade: 'A', min: 2700 },
    { grade: 'B', min: 1900 },
    { grade: 'C', min: 0 },
  ],
};

export const COLORS = {
  skyTop: 0x2b6fd6,
  skyHorizon: 0xcfe9ff,
  fog: 0xa9c9e8,
  sun: 0xfff1d6,
  grassLow: 0x4f9c3f,
  grassHigh: 0x7cb557,
  rock: 0x8d8a86,
  snow: 0xf6fafc,
  river: 0x2f7fc4,
  ringNext: 0xffc93c,
  ringTodo: 0x37d6e0,
  ringDone: 0x52e07a,
  planeBody: 0xf4f6f8,
  planeTrim: 0x2456c8,
  planeAccent: 0xe8452c,
  pickupBoost: 0xff9a1f,
  pickupShield: 0x37c8e0,
  pickupRepair: 0x52e07a,
};

/** Fixed simulation step (seconds) so the game feels the same at any refresh rate. */
export const STEP = 1 / 60;

export const BEST_KEY = 'sky-ring-runner.best';
export const BESTS_KEY = 'sky-ring-runner.bests';
export const SETTINGS_KEY = 'sky-ring-runner.settings';
