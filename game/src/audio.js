// All sound is synthesised with WebAudio — no audio files.
//
// The music is a cheerful chiptune loop at 120 BPM: a square-wave lead over
// Am–F–C–G, a sawtooth bass bouncing octaves, and electronic drums (sine
// kick, noise snare, high-pass hats). The menu runs it light; flight adds
// the snare and 16th-note hats; a storm muffles it through a low-pass. The
// engine and wind track throttle and speed, weather has its own loops
// (rain, gusts, tornado rumble), and every game event has a voice. The
// context starts on the first user gesture, as browsers require.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

const BPM = 120;
const STEP_SECONDS = 60 / BPM / 4; // 16th notes
const CHORDS = [
  { root: 45, tones: [57, 60, 64] }, // Am
  { root: 41, tones: [53, 57, 60] }, // F
  { root: 48, tones: [60, 64, 67] }, // C
  { root: 43, tones: [55, 59, 62] }, // G
];
/** Lead melody, one note per eighth note, four bars of eight. */
const MELODY = [
  69, 72, 76, 81, 79, 76, 72, 76,
  77, 76, 72, 69, 72, 76, 77, 79,
  72, 76, 79, 84, 79, 76, 79, 76,
  74, 79, 83, 79, 74, 71, 74, 79,
];

export function createAudio() {
  let ctx = null;
  let master = null;
  let musicBus = null;
  let musicFilter = null;
  let sfxBus = null;
  let noiseBuffer = null;
  let engineOsc = null;
  let engineGain = null;
  let windGain = null;
  let rainGain = null;
  let gustGain = null;
  let tornadoGain = null;
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
    src.start(at);
    src.stop(at + seconds + 0.05);
  }

  /** Soft pad under the chiptune, swelling across the bar. */
  function padChord(tones, at, seconds) {
    for (const note of tones) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = midi(note);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1100;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.03, at + seconds * 0.3);
      gain.gain.linearRampToValueAtTime(0.0001, at + seconds);
      osc.connect(filter).connect(gain).connect(musicBus);
      osc.start(at);
      osc.stop(at + seconds + 0.05);
    }
  }

  function kick(at) {
    tone(150, at, 0.13, 'sine', 0.5, musicBus, 44);
  }

  function snare(at) {
    noiseHit(at, 0.11, 'bandpass', 1900, 0.22, musicBus);
    tone(195, at, 0.07, 'triangle', 0.12, musicBus);
  }

  function hat(at, volume) {
    noiseHit(at, 0.04, 'highpass', 7200, volume, musicBus);
  }

  function lead(note, at) {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = midi(note);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.055, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + STEP_SECONDS * 1.9);
    osc.connect(gain).connect(musicBus);
    osc.start(at);
    osc.stop(at + STEP_SECONDS * 2);
  }

  function bass(note, at) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = midi(note);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 620;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.1, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + STEP_SECONDS * 1.7);
    osc.connect(filter).connect(gain).connect(musicBus);
    osc.start(at);
    osc.stop(at + STEP_SECONDS * 2);
  }

  /** Schedule 16th-note steps a little ahead of the clock. */
  function schedule() {
    while (nextStepTime < ctx.currentTime + 0.22) {
      const bar = Math.floor(stepIndex / 16) % CHORDS.length;
      const step = stepIndex % 16;
      const chord = CHORDS[bar];
      if (step === 0) padChord(chord.tones, nextStepTime, STEP_SECONDS * 16);
      if (step % 4 === 0) kick(nextStepTime);
      if (flying && (step === 4 || step === 12)) snare(nextStepTime);
      if (step % 4 === 2) hat(nextStepTime, 0.09);
      else if (flying && step % 2 === 0) hat(nextStepTime, 0.045);
      if (step % 2 === 0) {
        lead(MELODY[bar * 8 + step / 2], nextStepTime);
        bass(step % 4 === 2 ? chord.root + 12 : chord.root, nextStepTime);
      }
      stepIndex++;
      nextStepTime += STEP_SECONDS;
    }
  }

  function loopedNoise(filterType, freq, q = 0.8) {
    const src = noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(sfxBus);
    src.start();
    return gain;
  }

  return {
    /** Create the context and start the music; call from a user gesture. */
    init() {
      if (ctx) {
        if (ctx.state === 'suspended') ctx.resume();
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
      musicBus = ctx.createGain();
      musicBus.gain.value = musicOn ? musicVol * 0.85 : 0;
      musicBus.connect(musicFilter);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = sfxVol;
      sfxBus.connect(master);
      noiseBuffer = makeNoise();

      // Engine: a sawtooth growl tracking the throttle.
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 58;
      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 420;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter).connect(engineGain).connect(sfxBus);
      engineOsc.start();

      windGain = loopedNoise('bandpass', 640, 0.7);
      rainGain = loopedNoise('lowpass', 1500);
      gustGain = loopedNoise('bandpass', 420, 0.6);
      tornadoGain = loopedNoise('lowpass', 220);

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
      if (master) master.gain.value = on ? 0 : 0.9;
    },
    isMuted() {
      return muted;
    },

    setMusicOn(on) {
      musicOn = on;
      if (musicBus) musicBus.gain.value = on ? musicVol * 0.85 : 0;
    },
    isMusicOn() {
      return musicOn;
    },

    /** Settings sliders: 0..1 each. */
    setVolumes(nextMusic, nextSfx) {
      musicVol = nextMusic;
      sfxVol = nextSfx;
      if (musicBus) musicBus.gain.value = musicOn ? musicVol * 0.85 : 0;
      if (sfxBus) sfxBus.gain.value = sfxVol;
    },

    /** Muffle the music as a storm rolls over (0 clear, 1 storm). */
    setStormAudio(f) {
      if (!ctx || !musicFilter) return;
      musicFilter.frequency.setTargetAtTime(9000 - f * 7800, ctx.currentTime, 0.4);
    },

    /** Per-frame: engine pitch and wind loudness follow the flight. */
    setFlight(throttle, speedNorm, isFlying, boost01 = 0) {
      flying = isFlying;
      if (!ctx) return;
      const t = ctx.currentTime;
      engineOsc.frequency.setTargetAtTime((52 + throttle * 78) * (1 + boost01 * 0.32), t, 0.08);
      engineGain.gain.setTargetAtTime(isFlying ? 0.05 + throttle * 0.1 : 0.02 + throttle * 0.03, t, 0.1);
      windGain.gain.setTargetAtTime(isFlying ? speedNorm * speedNorm * 0.22 : 0, t, 0.15);
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
    },

    ringChime(centreBonus) {
      if (!ctx) return;
      const t = ctx.currentTime;
      tone(880, t, 0.55, 'sine', 0.16, sfxBus);
      tone(1318.5, t + 0.02, 0.5, 'sine', 0.1, sfxBus);
      if (centreBonus > 0.6) tone(1760, t + 0.06, 0.45, 'sine', 0.08, sfxBus);
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
      src.start(t);
      src.stop(t + 1.6);
    },

    countdownBeep(final) {
      if (!ctx) return;
      tone(final ? 990 : 660, ctx.currentTime, final ? 0.32 : 0.13, 'sine', 0.14, sfxBus);
    },

    /** Short UI click for menu buttons and cards. */
    click() {
      if (!ctx) return;
      const t = ctx.currentTime;
      tone(880, t, 0.05, 'triangle', 0.1, sfxBus);
      tone(1320, t + 0.03, 0.06, 'sine', 0.07, sfxBus);
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
      src.start(t);
      src.stop(t + 0.6);
    },

    damageThud() {
      if (!ctx) return;
      const t = ctx.currentTime;
      noiseHit(t, 0.22, 'lowpass', 700, 0.32, sfxBus);
      tone(120, t, 0.2, 'sine', 0.24, sfxBus, 55);
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
      src.start(t);
      src.stop(t + 1.3);
      tone(90, t, 0.9, 'sine', 0.4, sfxBus, 32);
    },

    click() {
      if (!ctx) return;
      tone(1150, ctx.currentTime, 0.07, 'sine', 0.07, sfxBus);
    },

    stopScheduler() {
      if (scheduler) window.clearInterval(scheduler);
      scheduler = 0;
    },
  };
}
