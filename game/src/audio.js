// All sound is synthesised with WebAudio — no audio files. A gentle loop of
// pad chords, pentatonic arpeggio and (in flight) a soft hat keeps the canyon
// company; the engine and wind track throttle and speed; rings chime, stalls
// beep, the finish gets a little horn. The context starts on the first user
// gesture, as browsers require, and M silences everything.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

/** Chord roots (MIDI) for the four-bar loop: C, A minor, F, G. */
const CHORDS = [
  { root: 48, tones: [60, 64, 67] },
  { root: 45, tones: [57, 60, 64] },
  { root: 41, tones: [53, 57, 60] },
  { root: 43, tones: [55, 59, 62] },
];
/** C-major pentatonic ladder the arpeggio walks. */
const PENTA = [72, 74, 76, 79, 81, 84, 86, 88];
const ARP_PATTERN = [0, 2, 4, 3, 5, 4, 2, 1];
const BPM = 92;
const STEP_SECONDS = 60 / BPM / 2; // eighth notes

export function createAudio() {
  let ctx = null;
  let master = null;
  let musicBus = null;
  let sfxBus = null;
  let noiseBuffer = null;
  let engineOsc = null;
  let engineGain = null;
  let windGain = null;
  let warningOsc = null;
  let warningGain = null;
  let warningLfoGain = null;
  let muted = false;
  let musicOn = true;
  let flying = false;
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

  /** One pad chord: two detuned triangles through a low-pass, swelling and fading. */
  function padChord(tones, at, seconds) {
    for (const note of tones) {
      for (const detune of [-6, 6]) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = midi(note);
        osc.detune.value = detune;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 900;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.045, at + seconds * 0.3);
        gain.gain.linearRampToValueAtTime(0.0001, at + seconds);
        osc.connect(filter).connect(gain).connect(musicBus);
        osc.start(at);
        osc.stop(at + seconds + 0.05);
      }
    }
  }

  function pluck(note, at, volume = 0.09) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = midi(note);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
    osc.connect(gain).connect(musicBus);
    osc.start(at);
    osc.stop(at + 0.55);
  }

  function bassNote(note, at) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = midi(note);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.11, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + STEP_SECONDS * 1.8);
    osc.connect(gain).connect(musicBus);
    osc.start(at);
    osc.stop(at + STEP_SECONDS * 2);
  }

  function hat(at) {
    const src = noiseSource();
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 6500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.05, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    src.connect(filter).connect(gain).connect(musicBus);
    src.start(at);
    src.stop(at + 0.08);
  }

  /** Schedule eighth-note steps a little ahead of the clock. */
  function schedule() {
    while (nextStepTime < ctx.currentTime + 0.25) {
      const bar = Math.floor(stepIndex / 8) % CHORDS.length;
      const beat = stepIndex % 8;
      const chord = CHORDS[bar];
      if (beat === 0) padChord(chord.tones, nextStepTime, STEP_SECONDS * 8);
      if (beat === 0 || beat === 4) bassNote(chord.root, nextStepTime);
      if (beat % 2 === 0) pluck(PENTA[ARP_PATTERN[beat] % PENTA.length], nextStepTime);
      if (flying && beat % 2 === 1) hat(nextStepTime);
      stepIndex++;
      nextStepTime += STEP_SECONDS;
    }
  }

  function tone(freq, at, seconds, type, volume, bus) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    osc.connect(gain).connect(bus);
    osc.start(at);
    osc.stop(at + seconds + 0.05);
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
      musicBus = ctx.createGain();
      musicBus.gain.value = musicOn ? 0.8 : 0;
      musicBus.connect(master);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = 1;
      sfxBus.connect(master);
      noiseBuffer = makeNoise();

      // Engine: a sawtooth growl plus breath, both tracking the throttle.
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

      // Wind: looped noise through a band-pass, swelling with speed.
      const wind = noiseSource();
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 640;
      windFilter.Q.value = 0.7;
      windGain = ctx.createGain();
      windGain.gain.value = 0;
      wind.connect(windFilter).connect(windGain).connect(sfxBus);
      wind.start();

      // Stall / ground warning beeper, gated by an LFO while active.
      warningOsc = ctx.createOscillator();
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
      scheduler = window.setInterval(schedule, 110);
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
      if (musicBus) musicBus.gain.value = on ? 0.8 : 0;
    },
    isMusicOn() {
      return musicOn;
    },

    /** Per-frame: engine pitch and wind loudness follow the flight. */
    setFlight(throttle, speedNorm, isFlying) {
      flying = isFlying;
      if (!ctx) return;
      const t = ctx.currentTime;
      engineOsc.frequency.setTargetAtTime(52 + throttle * 78, t, 0.08);
      engineGain.gain.setTargetAtTime(isFlying ? 0.05 + throttle * 0.1 : 0.02 + throttle * 0.03, t, 0.1);
      windGain.gain.setTargetAtTime(isFlying ? speedNorm * speedNorm * 0.22 : 0, t, 0.15);
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

    countdownBeep(final) {
      if (!ctx) return;
      tone(final ? 990 : 660, ctx.currentTime, final ? 0.32 : 0.13, 'sine', 0.14, sfxBus);
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
