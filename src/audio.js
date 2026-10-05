// Generative ambient score. Each world gets a key, a mode and a palette of
// timbres from its seed and class: a drone, a slowly changing pad, sparse
// FM bells, and filtered noise for wind, surf or magma.

import { Rng } from './util.js';

const MODES = {
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  hijaz: [0, 1, 4, 5, 7, 8, 10],
  whole: [0, 2, 4, 6, 8, 10],
};

const CLASS_MODES = {
  terran: ['lydian', 'mixolydian', 'dorian'],
  ocean: ['lydian', 'dorian', 'aeolian'],
  exotic: ['whole', 'lydian', 'hijaz'],
  arid: ['phrygian', 'hijaz', 'dorian'],
  frozen: ['aeolian', 'lydian', 'dorian'],
  volcanic: ['phrygian', 'hijaz'],
  toxic: ['hijaz', 'whole', 'phrygian'],
  airless: ['aeolian', 'whole'],
  gas: ['dorian', 'mixolydian', 'aeolian'],
  icegiant: ['lydian', 'aeolian'],
};

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Soundscape {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.layers = null;
    this.world = null;
    this.altitude = 3;
  }

  init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(6.5);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.9;
    this.reverb.connect(this.wet).connect(this.master);
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.55;
    this.dry.connect(this.master);
    this.noise = this.noiseBuffer(4);
    return true;
  }

  impulse(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 800 ? i / 800 : 1);
      }
    }
    return buf;
  }

  noiseBuffer(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Pinkish noise (Paul Kellet's filter).
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return buf;
  }

  async toggle() {
    if (!this.ctx && !this.init()) return false;
    this.on = !this.on;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    if (this.on) {
      await this.ctx.resume();
      this.master.gain.linearRampToValueAtTime(0.85, t + 2.5);
      if (!this.layers && this.world) this.setWorld(this.world);
    } else {
      this.master.gain.linearRampToValueAtTime(0, t + 1.2);
      setTimeout(() => {
        if (!this.on) {
          this.layers?.stop(0);
          this.layers = null;
          this.ctx.suspend();
        }
      }, 1400);
    }
    return this.on;
  }

  setWorld(world) {
    this.world = world;
    if (!this.on || !this.ctx) return;
    const old = this.layers;
    this.layers = this.build(world);
    if (old) old.stop(4);
  }

  // Duck the score during warp, swell the wind near the surface.
  update(altitude, warp) {
    if (!this.layers) return;
    this.altitude = altitude;
    const t = this.ctx.currentTime;
    const near = Math.max(0, Math.min(1, (1.6 - altitude) / 0.6));
    this.layers.wind.gain.setTargetAtTime(this.layers.windBase * (0.35 + near * 1.4), t, 0.4);
    this.layers.bus.gain.setTargetAtTime(1 - warp * 0.7, t, 0.2);
  }

  // A rising whoosh for travel, independent of the world's score.
  whoosh() {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(180, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 1.2);
    f.frequency.exponentialRampToValueAtTime(300, t + 3.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 1.0);
    g.gain.linearRampToValueAtTime(0, t + 3.4);
    src.connect(f).connect(g);
    g.connect(this.dry);
    g.connect(this.reverb);
    src.start(t);
    src.stop(t + 3.6);
  }

  build(world) {
    const ctx = this.ctx;
    const rng = new Rng(world.seed ^ 0x1b873593);
    const t0 = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.value = 1;
    const fade = ctx.createGain();
    fade.gain.setValueAtTime(0, t0);
    fade.gain.linearRampToValueAtTime(1, t0 + 5);
    bus.connect(fade);
    fade.connect(this.dry);
    fade.connect(this.reverb);
    const nodes = [];
    const timers = [];
    const cls = world.cls;

    const mode = MODES[rng.pick(CLASS_MODES[cls] ?? ['aeolian'])];
    const low = cls === 'gas' || cls === 'icegiant' || cls === 'volcanic';
    const root = (low ? 31 : 36) + rng.int(0, 11);
    const deg = (i, oct = 0) => root + 12 * (oct + Math.floor(i / mode.length)) + mode[((i % mode.length) + mode.length) % mode.length];

    // Drone: root and fifth, slowly breathing through a low-pass.
    const droneF = ctx.createBiquadFilter();
    droneF.type = 'lowpass';
    droneF.frequency.value = low ? 220 : 380;
    droneF.Q.value = 2;
    const droneG = ctx.createGain();
    droneG.gain.value = 0.16;
    droneF.connect(droneG).connect(bus);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rng.float(0.03, 0.07);
    const lfoG = ctx.createGain();
    lfoG.gain.value = low ? 120 : 200;
    lfo.connect(lfoG).connect(droneF.frequency);
    lfo.start();
    nodes.push(lfo);
    for (const [m, type, det] of [[root, 'sine', 0], [root, 'triangle', 5], [root + 7, 'sine', -4], [root - 12, 'sine', 0]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = mtof(m);
      o.detune.value = det;
      o.connect(droneF);
      o.start();
      nodes.push(o);
    }

    // Pad: four voices, each a detuned saw pair, voice-led between chords.
    const padF = ctx.createBiquadFilter();
    padF.type = 'lowpass';
    padF.frequency.value = cls === 'frozen' || cls === 'icegiant' ? 1400 : 900;
    padF.Q.value = 0.7;
    const padG = ctx.createGain();
    padG.gain.value = 0.045;
    padF.connect(padG).connect(bus);
    const voices = [];
    for (let v = 0; v < 4; v++) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(padF);
      const oscs = [-7, 7].map((d) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.detune.value = d + rng.float(-3, 3);
        o.connect(g);
        o.start();
        nodes.push(o);
        return o;
      });
      voices.push({ g, oscs });
    }
    const progression = [0, rng.pick([5, 3]), rng.pick([3, 4]), rng.pick([6, 4, 1])];
    let step = 0;
    const chord = () => {
      const t = ctx.currentTime;
      const d = progression[step % progression.length];
      step++;
      const notes = [deg(d, 1), deg(d + 2, 1), deg(d + 4, 1), deg(d + 6, 1)];
      voices.forEach((v, i) => {
        const f = mtof(notes[i]);
        for (const o of v.oscs) o.frequency.setTargetAtTime(f, t, 1.6);
        v.g.gain.cancelScheduledValues(t);
        v.g.gain.setTargetAtTime(0.7 + 0.3 * Math.random(), t, 2.5);
      });
    };
    chord();
    timers.push(setInterval(chord, rng.float(14, 22) * 1000));

    // Bells: two-operator FM, sparse and widely panned.
    const ratio = cls === 'frozen' || cls === 'icegiant' ? 3.5 : cls === 'volcanic' || cls === 'toxic' ? 1.41 : rng.pick([2, 3, 2.76]);
    const bellOct = cls === 'frozen' || cls === 'icegiant' ? 3 : cls === 'volcanic' ? 1 : 2;
    const density = cls === 'airless' ? 0.35 : 0.65;
    const pent = [0, 1, 2, 4, 5];
    const bell = () => {
      if (Math.random() > density) return;
      const t = ctx.currentTime + 0.05;
      const m = deg(rng.pick(pent) + rng.int(0, 1) * mode.length, bellOct);
      const f = mtof(m);
      const car = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const modG = ctx.createGain();
      const amp = ctx.createGain();
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      car.frequency.value = f;
      mod.frequency.value = f * ratio;
      modG.gain.setValueAtTime(f * 2.2, t);
      modG.gain.exponentialRampToValueAtTime(f * 0.05, t + 2.5);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(0.06, t + 0.01);
      amp.gain.exponentialRampToValueAtTime(0.0005, t + 5.5);
      mod.connect(modG).connect(car.frequency);
      car.connect(amp);
      if (pan) {
        pan.pan.value = Math.random() * 1.6 - 0.8;
        amp.connect(pan).connect(bus);
      } else amp.connect(bus);
      car.start(t);
      mod.start(t);
      car.stop(t + 6);
      mod.stop(t + 6);
    };
    timers.push(setInterval(bell, rng.float(1800, 3200)));

    // Noise bed: wind in an atmosphere, surf on ocean worlds, rumble on lava.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const nf = ctx.createBiquadFilter();
    const wind = ctx.createGain();
    let windBase = world.atmo.on ? 0.12 * Math.min(1.5, world.atmo.density) : 0.015;
    if (cls === 'volcanic') {
      nf.type = 'lowpass';
      nf.frequency.value = 140;
      windBase = 0.5;
    } else {
      nf.type = 'bandpass';
      nf.frequency.value = cls === 'ocean' ? 500 : 800;
      nf.Q.value = 0.6;
      const sweep = ctx.createOscillator();
      sweep.frequency.value = cls === 'ocean' ? 0.09 : 0.05;
      const sweepG = ctx.createGain();
      sweepG.gain.value = cls === 'ocean' ? 260 : 450;
      sweep.connect(sweepG).connect(nf.frequency);
      sweep.start();
      nodes.push(sweep);
    }
    if (cls === 'ocean' || cls === 'terran') {
      // Slow swells.
      const swell = ctx.createOscillator();
      swell.frequency.value = rng.float(0.07, 0.12);
      const swellG = ctx.createGain();
      swellG.gain.value = 0.5;
      const swellBias = ctx.createGain();
      swellBias.gain.value = 1;
      swell.connect(swellG).connect(swellBias.gain);
      src.connect(nf).connect(swellBias).connect(wind);
      swell.start();
      nodes.push(swell);
    } else {
      src.connect(nf).connect(wind);
    }
    wind.gain.value = windBase * 0.35;
    wind.connect(bus);
    src.start();
    nodes.push(src);

    return {
      bus,
      wind,
      windBase,
      stop: (seconds) => {
        const t = ctx.currentTime;
        fade.gain.cancelScheduledValues(t);
        fade.gain.setValueAtTime(fade.gain.value, t);
        fade.gain.linearRampToValueAtTime(0, t + seconds + 0.01);
        timers.forEach(clearInterval);
        setTimeout(() => {
          for (const n of nodes) {
            try { n.stop(); } catch { /* already stopped */ }
          }
          fade.disconnect();
        }, (seconds + 0.2) * 1000);
      },
    };
  }
}
