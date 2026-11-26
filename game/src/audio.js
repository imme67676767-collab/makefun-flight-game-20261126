// All sound is synthesised with WebAudio — no audio files.
//
// Round 4/5 rebuild. The engine is a real synthesized voice (sawtooth +
// square through a throttle-tracking lowpass, 3-blade prop slap with
// jitter, ignition flutter, exhaust pops, first-order rpm inertia), the
// wind is band-passed noise that sharpens in a dive and dulls in a climb,
// and the flight sits in a small acoustic space: cloud muffling, canyon
// echo down low, open reverb up high, stereo pan with bank. Damage makes
// the engine rough and intermittent; critical hull adds a heartbeat pulse
// locked to the HUD's red edge pulse (shared HULL_PULSE period). Music is
// ambient electronic at 96 BPM: slow pads and sparse bells in the menu
// (with a whisper of radio hiss), a speed-driven pulse in flight, a
// harmony layer after each ring, and automatic ducking under impacts and
// warnings. The context starts on the first user gesture, as browsers
// require.

import { HULL_PULSE } from './config.js';

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

const BPM = 96;
const STEP_SECONDS = 60 / BPM / 4; // 16th notes
const CHORDS = [
  { root: 45, tones: [57, 60, 64] }, // Am
  { root: 41, tones: [53, 57, 60] }, // F
  { root: 48, tones: [60, 64, 67] }, // C
  { root: 43, tones: [55, 59, 62] }, // G
];

export function createAudio() {
  let ctx = null;
  let master = null;
  let musicBus = null;
  let duckGain = null;
  let musicFilter = null;
  let sfxBus = null;
  let airBus = null;
  let cloudFilter = null;
  let enginePan = null;
  let reverb = null;
  let reverbWet = null;
  let echoWet = null;
  let ringBus = null;
  let noiseBuffer = null;
  let engine = null;
  let wind = null;
  let rainGain = null;
  let gustGain = null;
  let tornadoGain = null;
  let tireGain = null;
  let stallGain = null;
  let hissGain = null;
  let warningGain = null;
  let warningLfoGain = null;
  let muted = false;
  let musicOn = true;
  let flying = false;
  let musicVol = 0.75;
  let sfxVol = 0.9;
  let nextStepTime = 0;
  let stepIndex = 0;
  let scheduler = 0;
  let curSpeedNorm = 0;
  let combo = 0;
  let lastRingAt = -99;
  let harmonyUntil = 0;
  let heartbeatTimer = 0;
  let heartbeatOn = false;
  let warningWasOn = false;

  function makeNoise() {
    const len = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function noiseSource() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    return src;
  }

  function tone(freq, at, seconds, type, volume, bus, slideTo = null) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + seconds);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    osc.connect(gain).connect(bus);
    // One-shot: drop the nodes from the graph once the voice ends.
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    osc.start(at);
    osc.stop(at + seconds + 0.05);
  }

  function noiseHit(at, seconds, filterType, freq, volume, bus) {
    const src = noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    src.connect(filter).connect(gain).connect(bus);
    src.onended = () => { src.disconnect(); filter.disconnect(); gain.disconnect(); };
    src.start(at);
    src.stop(at + seconds + 0.05);
  }

  /** Soft pad swelling across the bar (menu + flight bed). */
  function padChord(tones, at, seconds) {
    for (const note of tones) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = midi(note);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.028, at + seconds * 0.3);
      gain.gain.linearRampToValueAtTime(0.0001, at + seconds);
      osc.connect(filter).connect(gain).connect(musicBus);
      osc.onended = () => { osc.disconnect(); filter.disconnect(); gain.disconnect(); };
      osc.start(at);
      osc.stop(at + seconds + 0.05);
    }
  }

  /** Sparse sine bell with a faint harmonic, long decay. */
  function bell(note, at, volume) {
    tone(midi(note), at, 1.3, 'sine', volume, musicBus);
    tone(midi(note) * 2, at, 0.5, 'sine', volume * 0.35, musicBus);
  }

  function kick(at) {
    tone(120, at, 0.12, 'sine', 0.3, musicBus, 42);
  }

  function hat(at, volume) {
    noiseHit(at, 0.035, 'highpass', 7200, volume, musicBus);
  }

  function bassSoft(note, at) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midi(note);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.07, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + STEP_SECONDS * 3.2);
    osc.connect(filter).connect(gain).connect(musicBus);
    osc.onended = () => { osc.disconnect(); filter.disconnect(); gain.disconnect(); };
    osc.start(at);
    osc.stop(at + STEP_SECONDS * 3.5);
  }

  /** Ambient-electronic scheduler: pads + bells in the menu, a speed-
   *  driven pulse in flight, harmony arps while a ring afterglow lasts. */
  function schedule() {
    while (nextStepTime < ctx.currentTime + 0.22) {
      const bar = Math.floor(stepIndex / 16) % CHORDS.length;
      const step = stepIndex % 16;
      const chord = CHORDS[bar];
      if (step === 0) padChord(chord.tones, nextStepTime, STEP_SECONDS * 16);
      if (!flying) {
        if (step === 0 || step === 6 || step === 11) {
          bell(chord.tones[(stepIndex >> 2) % 3] + 12, nextStepTime, 0.05);
        }
      } else {
        if (step === 0 || step === 8) kick(nextStepTime);
        if (step === 0 || step === 8) bassSoft(chord.root, nextStepTime);
        if (step % 2 === 0 && ((stepIndex * 7) % 10) / 10 < curSpeedNorm) hat(nextStepTime, 0.05);
        if (nextStepTime < harmonyUntil && step % 2 === 0) {
          const arp = [0, 1, 2, 1][(step / 2) % 4];
          bell(chord.tones[arp] + 12, nextStepTime, 0.045);
        }
      }
      stepIndex++;
      nextStepTime += STEP_SECONDS;
    }
  }

  function loopedNoise(filterType, freq, q = 0.8, dest = null) {
    const src = noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(dest || sfxBus);
    src.start();
    return gain;
  }

  /** Generated stereo impulse response for the altitude reverb. */
  function makeImpulse(seconds = 1.4, decay = 2.6) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buffer = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buffer;
  }

  /** Duck the music under impacts and warnings. */
  function duck(amount = 0.3, hold = 0.14) {
    if (!ctx || !duckGain) return;
    const t = ctx.currentTime;
    duckGain.gain.cancelScheduledValues(t);
    duckGain.gain.setTargetAtTime(amount, t, 0.015);
    duckGain.gain.setTargetAtTime(1, t + hold, 0.22);
  }

  /** Critical-hull heartbeat: double low thump at the HUD pulse period. */
  function setHeartbeat(on) {
    if (on === heartbeatOn) return;
    heartbeatOn = on;
    if (on) {
      const thump = () => {
        if (!ctx) return;
        const t = ctx.currentTime;
        tone(56, t, 0.14, 'sine', 0.5, sfxBus, 40);
        tone(52, t + 0.17, 0.12, 'sine', 0.34, sfxBus, 38);
      };
      thump();
      heartbeatTimer = window.setInterval(thump, HULL_PULSE.periodSec * 1000);
    } else if (heartbeatTimer) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = 0;
    }
  }

  // --- engine voice (Xiaozhi's design, integrated) -------------------------
  // Sawtooth + square through a throttle-tracking lowpass; ignition
  // flutter LFO (deep at idle); 3-blade prop slap and per-rev exhaust pops
  // with random rate jitter; rpm follows the throttle with first-order
  // inertia. Damage adds random dropouts and crackle (rough01).
  function createEngineVoice(dest) {
    const t0 = ctx.currentTime;
    let rpm = 40;
    let lastT = t0;
    let rough01 = 0;

    const osc1 = ctx.createOscillator(); osc1.type = 'sawtooth';
    const osc2 = ctx.createOscillator(); osc2.type = 'square';
    osc2.detune.value = 8;
    const mixGain = ctx.createGain(); mixGain.gain.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
    const engineGain = ctx.createGain(); engineGain.gain.value = 0;
    const damageGain = ctx.createGain(); damageGain.gain.value = 1;
    const flutterGain = ctx.createGain(); flutterGain.gain.value = 1;

    osc1.connect(mixGain); osc2.connect(mixGain);
    mixGain.connect(lp); lp.connect(flutterGain); flutterGain.connect(engineGain);
    engineGain.connect(damageGain); damageGain.connect(dest);

    const lfo = ctx.createOscillator(); lfo.type = 'sine';
    const lfoDepth = ctx.createGain();
    lfo.connect(lfoDepth); lfoDepth.connect(flutterGain.gain);
    lfo.start(t0); osc1.start(t0); osc2.start(t0);

    // Propeller blade slap: noise through bandpass, pulsed by square LFO.
    const slapSrc = noiseSource();
    const slapBP = ctx.createBiquadFilter(); slapBP.type = 'bandpass';
    slapBP.frequency.value = 900; slapBP.Q.value = 1.5;
    const slapGain = ctx.createGain(); slapGain.gain.value = 0;
    const slapLFO = ctx.createOscillator(); slapLFO.type = 'square';
    const slapDepth = ctx.createGain(); slapDepth.gain.value = 1;
    slapLFO.connect(slapDepth); slapDepth.connect(slapGain.gain);
    slapSrc.connect(slapBP); slapBP.connect(slapGain); slapGain.connect(dest);
    slapLFO.start(t0);

    // Exhaust pop: lowpass noise pulsed once per revolution.
    const popSrc = noiseSource();
    const popLP = ctx.createBiquadFilter(); popLP.type = 'lowpass'; popLP.frequency.value = 160;
    const popGain = ctx.createGain(); popGain.gain.value = 0;
    const popLFO = ctx.createOscillator(); popLFO.type = 'square';
    const popDepth = ctx.createGain(); popDepth.gain.value = 1;
    popLFO.connect(popDepth); popDepth.connect(popGain.gain);
    popSrc.connect(popLP); popLP.connect(popGain); popGain.connect(dest);
    popLFO.start(t0);

    // Damage crackle: sparse high-band noise bursts, level ~ rough^2.
    const crackleSrc = noiseSource();
    const crackleBP = ctx.createBiquadFilter(); crackleBP.type = 'bandpass';
    crackleBP.frequency.value = 2600; crackleBP.Q.value = 0.8;
    const crackleGain = ctx.createGain(); crackleGain.gain.value = 0;
    crackleSrc.connect(crackleBP); crackleBP.connect(crackleGain); crackleGain.connect(dest);

    // Jitter + damage modulation tick.
    const modTimer = setInterval(() => {
      const n = ctx.currentTime;
      const j = 1 + (Math.random() * 0.04 - 0.02);
      slapLFO.detune.setTargetAtTime(1200 * (j - 1), n, 0.05);
      popLFO.detune.setTargetAtTime(1200 * (j - 1), n, 0.05);
      if (rough01 > 0.02) {
        // Random dropouts and crackle bursts as the damage worsens.
        const dip = 1 - rough01 * 0.65 * Math.random();
        damageGain.gain.setTargetAtTime(dip, n, 0.03);
        crackleGain.gain.setTargetAtTime(rough01 * rough01 * 0.09 * Math.random(), n, 0.02);
      } else {
        damageGain.gain.setTargetAtTime(1, n, 0.1);
        crackleGain.gain.setTargetAtTime(0, n, 0.05);
      }
    }, 110);

    function set(throttle, speedNorm, isFlying, boost01, extra = {}) {
      const now = ctx.currentTime;
      const dt = Math.min(now - lastT, 0.2); lastT = now;
      rough01 = Math.max(0, Math.min(1, extra.rough01 || 0));
      // First-order lowpass toward the target base freq (tau = 0.35 s):
      // the engine spools instead of snapping — throttle inertia.
      const base = 40 + throttle * 140;
      const target = base * (1 + boost01 * 0.3);
      rpm += (target - rpm) * (1 - Math.exp(-dt / 0.35));
      const f = Math.max(rpm, 20);

      osc1.frequency.setTargetAtTime(f, now, 0.05);
      osc2.frequency.setTargetAtTime(f * 0.5, now, 0.05);
      lp.frequency.setTargetAtTime(300 + throttle * 2100, now, 0.08);

      // Ignition flutter: 6-12 Hz, deep at idle, shallow at high rpm.
      const depth = 0.5 * (1 - throttle * 0.75);
      lfo.frequency.setTargetAtTime(6 + (f / 180) * 6, now, 0.1);
      lfoDepth.gain.setTargetAtTime(depth, now, 0.1);

      // Blade slap at 3x rpm (three blades).
      slapLFO.frequency.setTargetAtTime(f * 3, now, 0.05);
      slapDepth.gain.setTargetAtTime(0.5, now, 0.05);
      slapGain.gain.setTargetAtTime(isFlying ? 0.02 + throttle * 0.06 : 0.01, now, 0.1);

      // Exhaust pop once per rev; blends away at high rpm.
      popLFO.frequency.setTargetAtTime(f, now, 0.05);
      const popAmt = Math.max(0, 0.09 * (1 - throttle * 1.4)) * (isFlying ? 1 : 0.5);
      popGain.gain.setTargetAtTime(popAmt, now, 0.1);

      const g = isFlying ? 0.05 + throttle * 0.12 : 0.02 + throttle * 0.04;
      engineGain.gain.setTargetAtTime(g, now, 0.08);
    }

    function stop() {
      clearInterval(modTimer);
      const n = ctx.currentTime;
      engineGain.gain.setTargetAtTime(0, n, 0.05);
      slapGain.gain.setTargetAtTime(0, n, 0.05);
      popGain.gain.setTargetAtTime(0, n, 0.05);
      crackleGain.gain.setTargetAtTime(0, n, 0.05);
      const end = n + 0.3;
      [osc1, osc2, lfo, slapLFO, popLFO].forEach((o) => { try { o.stop(end); } catch (e) { /* already stopped */ } });
      [slapSrc, popSrc, crackleSrc].forEach((s) => { try { s.stop(end); } catch (e) { /* already stopped */ } });
    }

    function state() {
      return {
        freq: Math.round(rpm * 10) / 10,
        cutoff: Math.round(lp.frequency.value),
        bladeFreq: Math.round(rpm * 3 * 10) / 10,
        gain: Math.round(engineGain.gain.value * 1000) / 1000,
        rough: Math.round(rough01 * 100) / 100,
      };
    }

    return { set, stop, state };
  }

  // --- wind voice (Xiaozhi's design, integrated) ---------------------------
  // Band-passed noise tracking airspeed plus a low rumble. A dive sharpens
  // the band, a climb dulls it; ground effect swells the rumble down low.
  function createWindVoice(dest) {
    const src = noiseSource();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
    const bpGain = ctx.createGain(); bpGain.gain.value = 0;
    const rumbleLP = ctx.createBiquadFilter(); rumbleLP.type = 'lowpass'; rumbleLP.frequency.value = 200;
    const rumbleGain = ctx.createGain(); rumbleGain.gain.value = 0;

    src.connect(bp); bp.connect(bpGain); bpGain.connect(dest);
    src.connect(rumbleLP); rumbleLP.connect(rumbleGain); rumbleGain.connect(dest);

    function set(speedNorm, isFlying, extra = {}) {
      const n = ctx.currentTime;
      const vspeed = extra.vspeed || 0;
      const diveFactor = Math.max(0.65, Math.min(1.4, 1 - vspeed * 0.012));
      bp.frequency.setTargetAtTime((380 + speedNorm * 1600) * diveFactor, n, 0.15);
      bpGain.gain.setTargetAtTime(isFlying ? speedNorm * speedNorm * 0.22 : 0, n, 0.15);
      const agl = extra.agl ?? 999;
      const ground = isFlying && extra.airborne && agl < 25 ? (1 - agl / 25) * 0.1 : 0;
      rumbleGain.gain.setTargetAtTime(isFlying ? speedNorm * 0.06 + ground : 0, n, 0.15);
    }

    function stop() {
      const n = ctx.currentTime;
      bpGain.gain.setTargetAtTime(0, n, 0.1);
      rumbleGain.gain.setTargetAtTime(0, n, 0.1);
      try { src.stop(n + 0.4); } catch (e) { /* already stopped */ }
    }

    function state() {
      return {
        freq: Math.round(bp.frequency.value),
        gain: Math.round(bpGain.gain.value * 1000) / 1000,
        rumble: Math.round(rumbleGain.gain.value * 1000) / 1000,
      };
    }

    return { set, stop, state };
  }

  return {
    /** Create the context and start the music; call from a user gesture. */
    init() {
      if (ctx) {
        // 'suspended' (autoplay policy) and 'interrupted' (iOS) both
        // need a gesture-driven resume; init() is only called from one.
        if (ctx.state !== 'running') ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(ctx.destination);
      musicFilter = ctx.createBiquadFilter();
      musicFilter.type = 'lowpass';
      musicFilter.frequency.value = 9000;
      musicFilter.connect(master);
      duckGain = ctx.createGain();
      duckGain.gain.value = 1;
      duckGain.connect(musicFilter);
      musicBus = ctx.createGain();
      musicBus.gain.value = musicOn ? musicVol * 0.5 : 0; // music sits well under the engine
      musicBus.connect(duckGain);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = sfxVol;
      sfxBus.connect(master);
      noiseBuffer = makeNoise();

      // Acoustic space for engine + wind: cloud muffle filter in series,
      // reverb and canyon-echo sends in parallel.
      cloudFilter = ctx.createBiquadFilter();
      cloudFilter.type = 'lowpass';
      cloudFilter.frequency.value = 18000;
      cloudFilter.connect(sfxBus);
      airBus = ctx.createGain();
      airBus.connect(cloudFilter);
      enginePan = ctx.createStereoPanner();
      enginePan.connect(airBus);
      reverb = ctx.createConvolver();
      reverb.buffer = makeImpulse();
      reverbWet = ctx.createGain();
      reverbWet.gain.value = 0;
      reverb.connect(reverbWet).connect(sfxBus);
      airBus.connect(reverb);
      const echoDelay = ctx.createDelay(1);
      echoDelay.delayTime.value = 0.28;
      const echoFbFilter = ctx.createBiquadFilter();
      echoFbFilter.type = 'lowpass';
      echoFbFilter.frequency.value = 1600;
      const echoFb = ctx.createGain();
      echoFb.gain.value = 0.25;
      echoWet = ctx.createGain();
      echoWet.gain.value = 0;
      airBus.connect(echoDelay);
      echoDelay.connect(echoFbFilter).connect(echoFb).connect(echoDelay);
      echoDelay.connect(echoWet).connect(sfxBus);
      // Ring chimes get their own bus with a short reverb send.
      ringBus = ctx.createGain();
      ringBus.connect(sfxBus);
      const ringSend = ctx.createGain();
      ringSend.gain.value = 0.5;
      ringBus.connect(ringSend).connect(reverb);

      engine = createEngineVoice(enginePan);
      wind = createWindVoice(airBus);
      rainGain = loopedNoise('lowpass', 1500);
      gustGain = loopedNoise('bandpass', 420, 0.6);
      tornadoGain = loopedNoise('lowpass', 220);
      tireGain = loopedNoise('lowpass', 140);
      stallGain = loopedNoise('bandpass', 300, 1.1);
      hissGain = loopedNoise('bandpass', 2400, 0.5);

      // Stall / ground warning beeper, gated by an LFO while active.
      const warningOsc = ctx.createOscillator();
      warningOsc.type = 'square';
      warningOsc.frequency.value = 880;
      warningGain = ctx.createGain();
      warningGain.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 3.2;
      warningLfoGain = ctx.createGain();
      warningLfoGain.gain.value = 0;
      lfo.connect(warningLfoGain).connect(warningGain.gain);
      warningOsc.connect(warningGain).connect(sfxBus);
      warningOsc.start();
      lfo.start();

      nextStepTime = ctx.currentTime + 0.1;
      scheduler = window.setInterval(schedule, 90);
    },

    setMuted(on) {
      muted = on;
      if (master) master.gain.setTargetAtTime(on ? 0 : 0.9, ctx.currentTime, 0.03);
    },
    isMuted() {
      return muted;
    },

    setMusicOn(on) {
      musicOn = on;
      if (musicBus) musicBus.gain.setTargetAtTime(on ? musicVol * 0.5 : 0, ctx.currentTime, 0.03);
    },
    isMusicOn() {
      return musicOn;
    },

    /** Settings sliders: 0..1 each. */
    setVolumes(nextMusic, nextSfx) {
      musicVol = nextMusic;
      sfxVol = nextSfx;
      if (musicBus) musicBus.gain.setTargetAtTime(musicOn ? musicVol * 0.5 : 0, ctx.currentTime, 0.03);
      if (sfxBus) sfxBus.gain.setTargetAtTime(sfxVol, ctx.currentTime, 0.03);
    },

    /** Muffle the music as a storm rolls over (0 clear, 1 storm). */
    setStormAudio(f) {
      if (!ctx || !musicFilter) return;
      musicFilter.frequency.setTargetAtTime(9000 - f * 7800, ctx.currentTime, 0.4);
    },

    /** Per-frame flight audio. extra (all optional): roll, vspeed, agl,
     *  airborne, speed (m/s), stalled, hullFrac, inCloud. */
    setFlight(throttle, speedNorm, isFlying, boost01 = 0, extra = {}) {
      flying = isFlying;
      curSpeedNorm = speedNorm;
      if (!ctx) return;
      const t = ctx.currentTime;
      const hullFrac = extra.hullFrac ?? 1;
      const rough01 = Math.max(0, Math.min(1, (0.45 - hullFrac) / 0.45));
      if (engine) engine.set(throttle, speedNorm, isFlying, boost01, { rough01 });
      if (wind) wind.set(speedNorm, isFlying, extra);
      if (enginePan) {
        enginePan.pan.setTargetAtTime(Math.max(-1, Math.min(1, extra.roll || 0)) * 0.3, t, 0.1);
      }
      // Tyre rumble during the takeoff roll; gone the moment we lift off.
      const onGround = isFlying && extra.airborne === false;
      if (tireGain) {
        tireGain.gain.setTargetAtTime(onGround ? Math.min(1, (extra.speed || 0) / 55) * 0.16 : 0, t, 0.12);
      }
      // Stall buffet: rough separated air over the wing.
      if (stallGain) stallGain.gain.setTargetAtTime(extra.stalled ? 0.07 : 0, t, 0.08);
      // Inside cloud / a storm cell the whole air band goes muffled.
      if (cloudFilter) {
        cloudFilter.frequency.setTargetAtTime(extra.inCloud ? 700 : 18000, t, extra.inCloud ? 0.07 : 0.3);
      }
      // Altitude spaces: open reverb up high, short echo in the canyon.
      const agl = extra.agl ?? 200;
      if (reverbWet) {
        reverbWet.gain.setTargetAtTime(Math.max(0, Math.min(1, (agl - 70) / 320)) * 0.4, t, 0.4);
      }
      if (echoWet) {
        echoWet.gain.setTargetAtTime(agl < 75 && extra.airborne ? (1 - agl / 75) * 0.2 : 0, t, 0.3);
      }
      // Menu radio hiss, off in flight.
      if (hissGain) hissGain.gain.setTargetAtTime(isFlying ? 0 : 0.005, t, 0.5);
      setHeartbeat(isFlying && hullFrac < HULL_PULSE.threshold);
    },

    setRain(level) {
      if (rainGain) rainGain.gain.setTargetAtTime(level * 0.16, ctx.currentTime, 0.3);
    },
    setGust(level) {
      if (gustGain) gustGain.gain.setTargetAtTime(level * 0.2, ctx.currentTime, 0.25);
    },
    setTornado(level) {
      if (tornadoGain) tornadoGain.gain.setTargetAtTime(level * 0.34, ctx.currentTime, 0.3);
    },

    setWarning(on) {
      if (!ctx || !warningGain) return;
      warningGain.gain.setTargetAtTime(on ? 0.035 : 0, ctx.currentTime, 0.05);
      if (warningLfoGain) warningLfoGain.gain.setTargetAtTime(on ? 0.035 : 0, ctx.currentTime, 0.05);
      if (on && !warningWasOn) duck(0.45, 0.1);
      warningWasOn = on;
    },

    /** Ring threaded: rising three-note arpeggio + metallic ding, pitch
     *  climbing a semitone per consecutive ring (combo), short reverb. */
    ringChime(centreBonus) {
      if (!ctx) return;
      const t = ctx.currentTime;
      combo = (t - lastRingAt < 18) ? Math.min(combo + 1, 9) : 1;
      lastRingAt = t;
      const mult = Math.pow(2, (combo - 1) / 12);
      const base = 784 * mult;
      [1, 1.2599, 1.4983].forEach((r, i) => tone(base * r, t + i * 0.07, 0.5, 'sine', 0.13, ringBus));
      [2.76, 5.4, 8.9].forEach((r, i) => tone(base * r, t + 0.02, 0.28 - i * 0.06, 'sine', 0.05 - i * 0.012, ringBus));
      if (centreBonus > 0.6) tone(base * 2, t + 0.21, 0.55, 'sine', 0.09, ringBus);
      harmonyUntil = t + 4.5;
    },

    /** Ring plane crossed just outside the hoop: soft descending pair. */
    ringMiss() {
      if (!ctx) return;
      combo = 0;
      const t = ctx.currentTime;
      tone(392, t, 0.16, 'sine', 0.07, sfxBus);
      tone(311, t + 0.09, 0.22, 'sine', 0.06, sfxBus);
    },

    pickup(type) {
      if (!ctx) return;
      const t = ctx.currentTime;
      if (type === 'boost') {
        [660, 880, 1174, 1568].forEach((f, i) => tone(f, t + i * 0.06, 0.16, 'square', 0.09, sfxBus));
      } else if (type === 'shield') {
        [1046, 1318, 1568].forEach((f, i) => tone(f, t + i * 0.07, 0.4, 'sine', 0.09, sfxBus));
      } else {
        tone(784, t, 0.3, 'sine', 0.11, sfxBus);
        tone(1174, t + 0.1, 0.42, 'sine', 0.11, sfxBus);
      }
    },

    thunder(intensity) {
      if (!ctx) return;
      const t = ctx.currentTime + (1 - intensity) * 0.7;
      const src = noiseSource();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(420, t);
      filter.frequency.exponentialRampToValueAtTime(55, t + 1.3);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.12 + intensity * 0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      src.connect(filter).connect(gain).connect(sfxBus);
      src.onended = () => { src.disconnect(); filter.disconnect(); gain.disconnect(); };
      src.start(t);
      src.stop(t + 1.6);
      duck(0.5, 0.1);
    },

    countdownBeep(final) {
      if (!ctx) return;
      tone(final ? 990 : 660, ctx.currentTime, final ? 0.32 : 0.13, 'sine', 0.14, sfxBus);
    },

    /** Mechanical switch click for menu buttons and cards. */
    click() {
      if (!ctx) return;
      const t = ctx.currentTime;
      noiseHit(t, 0.035, 'bandpass', 1900, 0.1, sfxBus);
      tone(1150, t, 0.05, 'sine', 0.06, sfxBus);
    },

    /** Barely-there tick when the pointer crosses a control. */
    hover() {
      if (!ctx) return;
      const t = ctx.currentTime;
      noiseHit(t, 0.02, 'highpass', 3200, 0.035, sfxBus);
      tone(1980, t, 0.025, 'sine', 0.025, sfxBus);
    },

    /** A little fanfare arpeggio for the finish celebration. */
    victory() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
      notes.forEach((f, i) => tone(f, t + i * 0.13, 0.34, 'triangle', 0.13, sfxBus));
      tone(1318.5, t + notes.length * 0.13, 0.6, 'sine', 0.12, sfxBus);
    },

    finishHorn() {
      if (!ctx) return;
      const t = ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        tone(freq, t + i * 0.13, 0.4, 'triangle', 0.15, sfxBus);
      });
    },

    crashThud() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const src = noiseSource();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(900, t);
      filter.frequency.exponentialRampToValueAtTime(90, t + 0.5);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      src.connect(filter).connect(gain).connect(sfxBus);
      src.onended = () => { src.disconnect(); filter.disconnect(); gain.disconnect(); };
      src.start(t);
      src.stop(t + 0.6);
      duck(0.3, 0.2);
    },

    /** Impact: low thump plus metallic shatter, music ducks under it. */
    damageThud() {
      if (!ctx) return;
      const t = ctx.currentTime;
      noiseHit(t, 0.22, 'lowpass', 700, 0.32, sfxBus);
      tone(120, t, 0.2, 'sine', 0.24, sfxBus, 55);
      noiseHit(t + 0.01, 0.14, 'bandpass', 2400, 0.16, sfxBus);
      noiseHit(t + 0.05, 0.1, 'highpass', 3800, 0.08, sfxBus);
      duck(0.3, 0.16);
    },

    explosion() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const src = noiseSource();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1400, t);
      filter.frequency.exponentialRampToValueAtTime(40, t + 1.1);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.7, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      src.connect(filter).connect(gain).connect(sfxBus);
      src.onended = () => { src.disconnect(); filter.disconnect(); gain.disconnect(); };
      src.start(t);
      src.stop(t + 1.3);
      tone(90, t, 0.9, 'sine', 0.4, sfxBus, 32);
      duck(0.22, 0.3);
    },

    /** Node-graph snapshot for headless verification (no listening test). */
    debugState() {
      if (!ctx) return { ready: false };
      return {
        ready: true,
        engine: engine ? engine.state() : null,
        wind: wind ? wind.state() : null,
        pan: enginePan ? Math.round(enginePan.pan.value * 100) / 100 : 0,
        cloudCutoff: cloudFilter ? Math.round(cloudFilter.frequency.value) : 0,
        reverbWet: reverbWet ? Math.round(reverbWet.gain.value * 1000) / 1000 : 0,
        echoWet: echoWet ? Math.round(echoWet.gain.value * 1000) / 1000 : 0,
        duckGain: duckGain ? Math.round(duckGain.gain.value * 1000) / 1000 : 1,
        musicGain: musicBus ? Math.round(musicBus.gain.value * 1000) / 1000 : 0,
        combo,
        heartbeatOn,
      };
    },

    stopScheduler() {
      if (scheduler) window.clearInterval(scheduler);
      scheduler = 0;
      setHeartbeat(false);
    },
  };
}
