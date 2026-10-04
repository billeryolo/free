// Orchestrates world generation, baking, the camera and the frame loop.

import { Renderer } from './renderer.js';
import { OrbitCamera } from './camera.js';
import { generateWorld, atmoUniforms } from './world.js';
import { v3, m3, clamp, smoothstep, lerp } from './util.js';

export const DEFAULT_SETTINGS = {
  ocean: null,      // fraction; null = the world's own value
  clouds: null,
  atmosphere: 1,
  temperature: 0,
  relief: 1,
  timeScale: 1,
  rings: true,
  moons: true,
  aurora: true,
  sunAngle: 0,
};

export class App {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = opts;
    const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    const terrainSize = opts.terrainSize ?? (mobile ? 512 : 1024);
    this.renderer = new Renderer(canvas, { terrainSize, cloudSize: terrainSize, skySize: mobile ? 512 : 1024 });
    this.camera = new OrbitCamera();
    this.settings = { ...DEFAULT_SETTINGS };
    this.time = 0;
    this.planetTime = 0;
    this.listeners = {};
    this.maxScale = opts.renderScale ?? (mobile ? 0.6 : 1);
    this.scale = this.maxScale;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, opts.maxDpr ?? 2);
    this.frameTimes = [];
    this.transition = null;
    this.vis = 1;
    this.warp = 0;
    this.fade = opts.fadeIn === false ? 1 : 0;
    this.octaves = opts.octaves ?? 12;
    this.resize();
  }

  on(evt, fn) {
    (this.listeners[evt] ||= []).push(fn);
  }

  emit(evt, data) {
    for (const fn of this.listeners[evt] || []) fn(data);
  }

  resize() {
    const w = Math.max(1, Math.round(this.canvas.clientWidth * this.pixelRatio));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * this.pixelRatio));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.renderer.resize(w, h, this.scale);
  }

  // ---------------------------------------------------------------- worlds

  load(seed, cls) {
    const world = generateWorld(seed >>> 0, cls);
    this.renderer.bakeNow(world, { octaves: this.octaves });
    this.setWorld(world);
    return world;
  }

  setWorld(world) {
    this.world = world;
    this.settings.ocean = null;
    this.settings.clouds = null;
    this.planetTime = Math.random() * 1000;
    this.updateSea();
    this.emit('world', world);
  }

  // Travel to a new world: warp out, bake across frames, warp in.
  travel(seed, cls) {
    if (this.transition) return;
    const world = generateWorld(seed >>> 0, cls);
    const steps = this.renderer.bakeSteps(world, { octaves: this.octaves });
    this.transition = { phase: 'out', t: 0, world, steps };
    this.emit('travel', world);
  }

  oceanFraction() {
    return this.settings.ocean ?? this.world.oceanTarget;
  }

  cloudCover() {
    return this.settings.clouds ?? this.world.clouds.cover;
  }

  updateSea() {
    const w = this.world;
    const s = w.survey;
    const f = clamp(this.oceanFraction(), 0, 0.995);
    let sea = s.min - 0.01;
    if (f > 0.0005) {
      let lo = 0, hi = s.cum.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (s.cum[mid] < f) lo = mid + 1;
        else hi = mid;
      }
      sea = s.sorted[lo];
    }
    this.sea = sea;
    this.landRange = Math.max(s.max - sea, 0.02);
    this.seaRange = Math.max(sea - s.min, 0.02);
    this.emit('sea', { sea, fraction: f });
  }

  set(key, value) {
    this.settings[key] = value;
    if (key === 'ocean') this.updateSea();
    this.emit('settings', this.settings);
  }

  // ---------------------------------------------------------------- frame

  planetRotation() {
    const w = this.world;
    const spinPeriod = 300 * (w.dayHours / 24);
    const spin = (this.planetTime / spinPeriod) * Math.PI * 2;
    const tilt = m3.mul(m3.rotY(0.6), m3.rotZ(w.tilt));
    return { rot: m3.mul(tilt, m3.rotY(spin)), tilt };
  }

  sunDir() {
    const a = 0.75 + this.settings.sunAngle;
    return v3.norm([Math.sin(a), 0.18, Math.cos(a)]);
  }

  moonPositions(tiltMat) {
    const out = [];
    if (!this.settings.moons) return out;
    for (const m of this.world.moons) {
      const a = m.phase + (this.planetTime / m.period) * Math.PI * 2;
      let p = [Math.cos(a) * m.orbit, 0, Math.sin(a) * m.orbit];
      p = m3.apply(m3.rotX(m.incl), p);
      p = m3.apply(m3.rotY(m.node), p);
      p = m3.apply(tiltMat, p);
      out.push({ pos: p, radius: m.radius, moon: m });
    }
    return out;
  }

  sunVisibility(sun, moons) {
    const cam = this.camera;
    const aspect = this.canvas.width / this.canvas.height;
    const scr = cam.projectDir(sun, aspect);
    if (!scr) return { vis: 0, scr: [-1, -1] };
    const w = this.world;
    const atmoH = w.atmo.on ? w.atmo.height * this.settings.atmosphere : 0;
    const right = v3.norm(v3.cross(sun, [0, 1, 0]));
    const up = v3.cross(right, sun);
    let vis = 0;
    const N = 12;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = i === 0 ? 0 : w.sunSize * 0.8;
      const d = v3.norm(v3.add(sun, v3.add(v3.scale(right, Math.cos(a) * r), v3.scale(up, Math.sin(a) * r))));
      let s = 1;
      const tca = -v3.dot(cam.pos, d);
      if (tca > 0) {
        const closest = Math.sqrt(Math.max(v3.dot(cam.pos, cam.pos) - tca * tca, 0));
        s *= smoothstep(1, 1 + atmoH * 0.6 + 0.002, closest);
      }
      for (const m of moons) {
        const oc = v3.sub(m.pos, cam.pos);
        const t = v3.dot(oc, d);
        if (t > 0) {
          const cd = Math.sqrt(Math.max(v3.dot(oc, oc) - t * t, 0));
          if (cd < m.radius) s = 0;
        }
      }
      if (w.rings && this.settings.rings) {
        // A dense ring in front of the sun dims the flare.
        const axis = m3.apply(this.planetRotation().rot, [0, 1, 0]);
        const dn = v3.dot(d, axis);
        if (Math.abs(dn) > 1e-4) {
          const t = -v3.dot(cam.pos, axis) / dn;
          if (t > 0) {
            const hp = v3.add(cam.pos, v3.scale(d, t));
            const rr = v3.len(hp);
            if (rr > w.rings.inner && rr < w.rings.outer) {
              const u = (rr - w.rings.inner) / (w.rings.outer - w.rings.inner);
              const idx = Math.min(1023, Math.floor(u * 1023));
              s *= 1 - (w.rings.data[idx * 4 + 3] / 255) * 0.9;
            }
          }
        }
      }
      vis += s;
    }
    vis /= N;
    const edge = smoothstep(-0.05, 0.1, scr[0]) * smoothstep(1.05, 0.9, scr[0]) * smoothstep(-0.05, 0.1, scr[1]) * smoothstep(1.05, 0.9, scr[1]);
    return { vis: vis * edge, scr };
  }

  sceneUniforms() {
    const w = this.world;
    const st = this.settings;
    const cam = this.camera;
    const { rot, tilt } = this.planetRotation();
    const sun = this.sunDir();
    const moons = this.moonPositions(tilt);
    const atmo = atmoUniforms(w.atmo, st.atmosphere);
    const moonArr = new Float32Array(12);
    const moonCol = new Float32Array(9);
    const moonCol2 = new Float32Array(9);
    moons.slice(0, 3).forEach((m, i) => {
      moonArr.set([...m.pos, m.radius], i * 4);
      moonCol.set(m.moon.col, i * 3);
      moonCol2.set(m.moon.col2, i * 3);
    });
    const surf = w.surface;
    const u = {
      ...surf,
      ...atmo,
      uSeed: w.seed,
      uStyle: w.style,
      uCamPos: cam.pos,
      uCamBasis: cam.basis,
      uTanFov: Math.tan(cam.fov / 2),
      uPixelAngle: (2 * Math.tan(cam.fov / 2)) / this.renderer.hdr.h,
      uTime: this.planetTime,
      uCloudTime: this.planetTime,
      uSunDir: sun,
      uSunColor: w.star.color,
      uSunI: 5.0,
      uSunSize: w.sunSize,
      uPlanetRot: rot,
      uSea: this.sea,
      uLandRange: this.landRange,
      uSeaRange: this.seaRange,
      uRelief: surf.uRelief * st.relief,
      uTemp: surf.uTemp + st.temperature,
      uCloudOn: w.clouds.on,
      uCloudCover: this.cloudCover(),
      uCloudAlt: w.clouds.alt,
      uCloudCol: w.clouds.col,
      uAurora: w.aurora.col,
      uAuroraOn: w.aurora.on && st.aurora && w.atmo.on ? 1 : 0,
      uRingOn: w.rings && st.rings ? 1 : 0,
      uRingRad: w.rings ? [w.rings.inner, w.rings.outer] : [2, 3],
      uMoonCount: Math.min(3, moons.length),
      uMoon: moonArr,
      uMoonCol: moonCol,
      uMoonCol2: moonCol2,
      uVis: this.vis,
      uStarBright: 1,
      uDebug: this.debug ?? 0,
    };
    return { u, sun, moons, rot };
  }

  // Camera-style auto white balance: sunlight filtered through the air at a
  // typical sun angle should read as (nearly) neutral.
  whiteBalance(atmo) {
    const star = this.world.star.color;
    let t = [1, 1, 1];
    if (atmo.uAtmoOn) {
      const odR = 0.2 * atmo.uAtmoH, odM = 0.07 * atmo.uAtmoH;
      t = [0, 1, 2].map((i) => Math.exp(-((atmo.uBetaR[i] + atmo.uBetaA[i]) * odR + atmo.uBetaM[i] * 1.11 * odM) * 1.3));
    }
    const lit = [0, 1, 2].map((i) => star[i] * t[i]);
    let wb = lit.map((v) => lerp(1, 1 / Math.max(v, 0.05), 0.65));
    const lum = 0.2126 * wb[0] * lit[0] + 0.7152 * wb[1] * lit[1] + 0.0722 * wb[2] * lit[2];
    return wb.map((v) => v / lum);
  }

  frame(dt) {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.planetTime += dt * this.settings.timeScale;
    this.fade = Math.min(1, this.fade + dt * 0.7);
    this.stepTransition(dt);
    this.camera.update(dt);
    if (!this.world) return;

    const { u, sun, moons, rot } = this.sceneUniforms();
    const wb = this.whiteBalance(u);
    this.lastRot = rot;
    this.lastSun = sun;
    const sv = this.sunVisibility(sun, moons);
    const post = {
      uBloomStrength: 0.06,
      uExposure: 0.5,
      uWarp: this.warp,
      uFade: smoothstep(0, 1, this.fade),
      uTime: this.time,
      uSunScreen: sv.scr,
      uSunVis: sv.vis * this.vis,
      uSunColor: this.world.star.color,
      uFlare: 1,
      uWhite: wb,
    };
    this.renderer.render(u, post);
    this.emit('frame', { dt, rot, sun, moons });
    this.adaptResolution(dt);
  }

  stepTransition(dt) {
    const tr = this.transition;
    if (!tr) return;
    tr.t += dt;
    if (tr.phase === 'out') {
      const k = clamp(tr.t / 0.9, 0, 1);
      this.warp = k * k;
      this.vis = 1 - smoothstep(0.3, 1, k);
      this.camera.target.dist = Math.min(this.camera.target.dist * (1 + dt * 0.8), 9);
      if (k >= 1) {
        tr.phase = 'bake';
        tr.t = 0;
      }
    } else if (tr.phase === 'bake') {
      this.warp = 1;
      this.vis = 0;
      // A few bake steps per frame keeps the warp animating.
      for (let i = 0; i < 2 && tr.steps.length; i++) tr.steps.shift()();
      if (!tr.steps.length) {
        this.setWorld(tr.world);
        this.camera.dist = 8;
        this.camera.target.dist = 3.6;
        tr.phase = 'in';
        tr.t = 0;
      }
    } else if (tr.phase === 'in') {
      const k = clamp(tr.t / 1.4, 0, 1);
      this.warp = (1 - k) * (1 - k);
      this.vis = smoothstep(0.1, 0.8, k);
      if (k >= 1) {
        this.warp = 0;
        this.vis = 1;
        this.transition = null;
        this.emit('arrived', this.world);
      }
    }
  }

  // Keep the frame rate up by trading resolution.
  adaptResolution(dt) {
    if (this.opts.fixedScale) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 30) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    let s = this.scale;
    if (avg > 1 / 45) s = Math.max(0.45, s * 0.85);
    else if (avg < 1 / 58) s = Math.min(this.maxScale, s * 1.08);
    if (Math.abs(s - this.scale) > 0.01) {
      this.scale = s;
      this.resize();
    }
  }
}
