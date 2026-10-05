// The survey interface: catalog entry, data readouts, travel, forge, input.

import { CLASSES, CLASS_ORDER } from './world.js';
import { fmt, formatPressure, formatTemp, formatCelsius, formatYear, hydrosphereLabel, hydrosphereValue } from './format.js';
import { linearToOklab, oklabToLinear, linearToHex, clamp, v3, m3 } from './util.js';
import { MIN_DIST } from './camera.js';

const $ = (id) => document.getElementById(id);

export function worldCode(world) {
  return `${world.seed.toString(36)}-${world.cls}`;
}

export function parseCode(str) {
  const m = /^#?([0-9a-z]{1,8})-([a-z]+)$/i.exec((str || '').trim());
  if (!m || !CLASSES[m[2].toLowerCase()]) return null;
  return { seed: parseInt(m[1], 36) >>> 0, cls: m[2].toLowerCase() };
}

// A legible accent drawn from the world's sky (or bands, or rock).
function accentFor(world) {
  let c;
  if (world.style === 5) c = Array.from(world.surface.uGas.slice(3, 6));
  else if (world.atmo.on) {
    const t = world.atmo.tau;
    const m = Math.max(...t);
    c = t.map((v, i) => (v / m) * 0.6 + world.atmo.mie[i] * 0.15 * (world.atmo.tauM > 0.05 ? 3 : 0));
  } else c = world.surface.uHigh;
  if (world.cls === 'volcanic') c = world.surface.uEmit;
  const [, a, b] = linearToOklab(c);
  const C = Math.hypot(a, b);
  const k = C > 1e-4 ? Math.min(0.11, Math.max(C, 0.05)) / C : 0;
  return linearToHex(oklabToLinear([0.84, a * k, b * k]));
}

// A log-scale strip of the planetary system: star, habitable zone (Kopparapu
// et al. 2013 conservative limits), frost line and this planet's orbit.
function orbitDiagram(w) {
  const W = 320, H = 54, x0 = 14, x1 = W - 6;
  const lo = Math.log10(0.01), hi = Math.log10(60);
  const X = (au) => x0 + ((Math.log10(Math.max(au, 0.01)) - lo) / (hi - lo)) * (x1 - x0);
  const L = w.star.lum;
  const hzIn = Math.sqrt(L / 1.1), hzOut = Math.sqrt(L / 0.53);
  const frost = 2.7 * Math.sqrt(L);
  const a = w.phys.orbitAU;
  const star = linearToHex(w.star.color);
  const ticks = [0.01, 0.1, 1, 10].map((t) => `<line x1="${X(t)}" x2="${X(t)}" y1="30" y2="34" class="od-tick"/><text x="${X(t)}" y="46" class="od-axis">${t < 1 ? t : t.toFixed(0)}</text>`).join('');
  const px = X(a);
  const anchor = px > W - 70 ? 'end' : px < 60 ? 'start' : 'middle';
  return `<svg class="orbit" viewBox="0 0 ${W} ${H}" role="img" aria-label="Orbit at ${fmt.fixed(a, 2)} AU; habitable zone ${fmt.fixed(hzIn, 2)} to ${fmt.fixed(hzOut, 2)} AU">
    <defs><radialGradient id="od-star"><stop offset="0" stop-color="${star}"/><stop offset="1" stop-color="${star}" stop-opacity="0"/></radialGradient></defs>
    <rect x="${X(hzIn)}" y="22" width="${Math.max(2, X(hzOut) - X(hzIn))}" height="12" class="od-hz"/>
    <line x1="${x0}" x2="${x1}" y1="28" y2="28" class="od-line"/>
    <line x1="${X(frost)}" x2="${X(frost)}" y1="20" y2="36" class="od-frost"/>
    ${ticks}
    <circle cx="4" cy="28" r="12" fill="url(#od-star)"/>
    <circle cx="4" cy="28" r="3.5" fill="${star}"/>
    <circle cx="${px}" cy="28" r="3.6" class="od-planet"/>
    <text x="${px}" y="13" text-anchor="${anchor}" class="od-label">${fmt.fixed(a, a < 0.1 ? 3 : 2)} AU</text>
    <text x="${x1}" y="46" text-anchor="end" class="od-axis">AU</text>
  </svg>
  <small class="od-legend"><i class="sw hz"></i>Habitable zone ${fmt.fixed(hzIn, 2)}–${fmt.fixed(hzOut, 2)} AU<i class="sw fr"></i>Frost line</small>`;
}

export class UI {
  constructor(app, extras = {}) {
    this.app = app;
    this.extras = extras;
    this.history = [];
    this.index = -1;
    this.nextClass = null;
    this.labelsOn = false;
    this.labelEls = [];
    this.hintTimer = null;
    this.buildChips();
    this.bindInput();
    this.bindButtons();

    app.on('world', (w) => this.onWorld(w));
    app.on('travel', () => this.onTravel());
    app.on('arrived', () => this.revealName());
    app.on('sea', () => this.updateHydro());
    app.on('frame', (f) => this.onFrame(f));
  }

  // ---------------------------------------------------------------- travel

  go(seed, cls, { push = true } = {}) {
    if (this.app.transition) return;
    this.captureThumb();
    if (push) {
      this.history = this.history.slice(0, this.index + 1);
      this.history.push({ seed, cls });
      this.index = this.history.length - 1;
    }
    this.app.travel(seed, cls);
    this.updateNav();
  }

  newWorld() {
    const seed = (Math.random() * 2 ** 32) >>> 0;
    this.go(seed, this.nextClass ?? undefined);
  }

  prev() {
    if (this.index <= 0 || this.app.transition) return;
    this.index--;
    const h = this.history[this.index];
    this.go(h.seed, h.cls, { push: false });
  }

  next() {
    if (this.app.transition) return;
    if (this.index < this.history.length - 1) {
      this.index++;
      const h = this.history[this.index];
      this.go(h.seed, h.cls, { push: false });
    } else this.newWorld();
  }

  // A small portrait of the current world for the logbook, cropped around the
  // planet's disc in the live view.
  captureThumb() {
    const entry = this.history[this.index];
    const app = this.app;
    if (!entry || !app.world || app.vis < 0.99) return;
    try {
      const shot = app.capture(app.camera.shift);
      const cam = app.camera;
      const aspect = shot.width / shot.height;
      const c = cam.projectPoint([0, 0, 0], aspect);
      if (!c) return;
      const ang = Math.asin(Math.min(1, 1 / cam.dist));
      const rpx = (Math.tan(ang) / Math.tan(cam.fov / 2)) * (shot.height / 2) * 1.12;
      const cx = c[0] * shot.width, cy = (1 - c[1]) * shot.height;
      const t = document.createElement('canvas');
      t.width = t.height = 96;
      const g = t.getContext('2d');
      g.fillStyle = '#04050a';
      g.fillRect(0, 0, 96, 96);
      g.drawImage(shot, cx - rpx, cy - rpx, rpx * 2, rpx * 2, 0, 0, 96, 96);
      entry.thumb = t.toDataURL('image/jpeg', 0.82);
    } catch {
      /* thumbnails are optional */
    }
  }

  toggleLog(force) {
    const el = $('logbook');
    const open = force ?? el.hidden;
    el.hidden = !open;
    $('btn-log').setAttribute('aria-pressed', String(open));
    if (open) this.renderLog();
  }

  renderLog() {
    const list = $('log-list');
    $('log-count').textContent = `${this.history.length} world${this.history.length === 1 ? '' : 's'} visited this session`;
    list.innerHTML = '';
    this.history.forEach((h, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.setAttribute('aria-current', String(i === this.index));
      const img = document.createElement(h.thumb ? 'img' : 'span');
      img.className = 'thumb';
      if (h.thumb) {
        img.src = h.thumb;
        img.alt = '';
      }
      const text = document.createElement('span');
      text.innerHTML = `<span class="nm"></span><span class="meta"></span>`;
      text.querySelector('.nm').textContent = h.name ?? '…';
      text.querySelector('.meta').textContent = h.label ?? '';
      const no = document.createElement('span');
      no.className = 'no';
      no.textContent = String(i + 1).padStart(2, '0');
      b.append(img, text, no);
      b.addEventListener('click', () => {
        if (i === this.index || this.app.transition) return;
        this.captureThumb();
        this.index = i;
        this.go(h.seed, h.cls, { push: false });
        this.renderLog();
      });
      li.appendChild(b);
      list.appendChild(li);
    });
  }

  recordInitial(world) {
    this.history = [{ seed: world.seed, cls: world.cls }];
    this.index = 0;
    this.updateNav();
  }

  updateNav() {
    $('btn-prev').disabled = this.index <= 0;
    $('btn-next').disabled = false;
  }

  // ---------------------------------------------------------------- world

  onTravel() {
    document.querySelector('.catalog').style.opacity = '0';
    $('survey').style.opacity = '0';
    this.clearLabels();
  }

  onWorld(w) {
    // Keep history entries exact (class may have been chosen by the seed).
    const entry = this.history[this.index];
    if (entry) Object.assign(entry, { cls: w.cls, name: w.name, label: `${CLASSES[w.cls].short} · ${w.designation}` });
    if (!$('logbook').hidden) this.renderLog();
    document.documentElement.style.setProperty('--accent', accentFor(w));
    $('designation').textContent = w.designation;
    $('star').textContent = `${w.star.spectral} star · ${fmt.fixed(w.phys.orbitAU, w.phys.orbitAU < 0.1 ? 3 : 2)} AU`;
    $('class').textContent = w.classLabel;
    $('esi').textContent = w.style === 5 ? '' : `ESI ${fmt.fixed(w.phys.esi, 2)}`;
    $('name').textContent = w.name;
    document.title = `${w.name} · Orbis`;
    this.renderStats(w);
    this.buildForge(w);
    try {
      history.replaceState(null, '', `#${worldCode(w)}`);
    } catch {
      /* sandboxed frames may refuse; the code is still shown in the share toast */
    }
    if (!this.app.transition) this.revealName();
  }

  revealName() {
    const w = this.app.world;
    const el = $('name');
    el.innerHTML = '';
    let i = 0;
    w.name.split(' ').forEach((word, wi) => {
      if (wi > 0) el.appendChild(document.createTextNode(' '));
      const wspan = document.createElement('span');
      wspan.style.whiteSpace = 'nowrap';
      for (const ch of word) {
        const s = document.createElement('span');
        s.className = 'ch';
        s.textContent = ch;
        s.style.animationDelay = `${0.15 + i++ * 0.045}s`;
        wspan.appendChild(s);
      }
      el.appendChild(wspan);
    });
    el.setAttribute('aria-label', w.name);
    el.style.setProperty('--name-scale', String(Math.min(1, Math.max(0.62, 9 / Math.max(w.name.length, 1)))));
    document.querySelector('.catalog').style.opacity = '1';
    $('survey').style.opacity = '1';
    if (this.labelsOn) this.buildLabels();
  }

  renderStats(w) {
    const p = w.phys;
    const rows = [];
    const row = (k, main, sub, id) => rows.push(`<dt>${k}</dt><dd${id ? ` id="${id}"` : ''}>${main}${sub ? `<small>${sub}</small>` : ''}</dd>`);
    row('Orbit', `${fmt.fixed(p.orbitAU, p.orbitAU < 0.1 ? 3 : 2)} AU · ${formatYear(p.yearDays)}`, `${w.star.spectral} star · ${fmt.int(w.star.temp)} K · ${fmt.fixed(w.star.lum, w.star.lum < 0.1 ? 3 : 2)} L☉`);
    rows.push(`<dd class="wide">${orbitDiagram(w)}</dd>`);
    row('Size', `${fmt.fixed(p.radius, 2)} R⊕ · ${fmt.fixed(p.mass, p.mass < 10 ? 2 : 1)} M⊕`, `${fmt.int(p.radiusKm)} km radius · ${fmt.fixed(p.density, 2)} g/cm³`);
    row('Gravity', `${fmt.fixed(p.gravity, 2)} g`, `Escape velocity ${fmt.fixed(p.vesc, 1)} km/s`);
    row('Temperature', formatTemp(p.tempK), `Mean surface · ${formatCelsius(p.tempK)}`);
    row('Rotation', `${fmt.fixed(p.dayHours, 1)} h day`, `Axial tilt ${fmt.fixed(p.tilt, 1)}°`);
    row('Atmosphere', formatPressure(w.style === 5 ? 1000 : p.pressure), p.composition);
    row(hydrosphereLabel(w), '', '', 'hydro');
    if (w.style !== 5) row('Highest point', '<span id="peak">Surveying…</span>', '', 'peakrow');
    row('Moons', w.moons.length ? w.moons.map((m) => m.name).join(', ') : 'None', w.moons.length ? w.moons.map((m) => `${fmt.int(m.radiusKm)} km`).join(' · ') : '');
    row('Rings', w.rings ? 'Present' : 'None', w.rings ? `${fmt.fixed(w.rings.inner, 2)}–${fmt.fixed(w.rings.outer, 2)} planetary radii` : '');
    if (w.style !== 5) {
      row('Similarity', `ESI ${fmt.fixed(p.esi, 2)}`, `<span class="esibar"><i style="width:${Math.round(p.esi * 100)}%"></i></span>`);
    }
    if (w.inhabited) row('Night side', 'Artificial light', 'Signs of a technological civilisation');
    $('stats').innerHTML = rows.join('');
    this.updateHydro();
  }

  updateHydro() {
    const el = $('hydro');
    if (!el || !this.app.world) return;
    const v = hydrosphereValue(this.app.world, this.app.oceanFraction());
    el.innerHTML = `${v.main}<small>${v.sub}</small>`;
  }

  setPeak(text) {
    const el = $('peak');
    if (el) el.textContent = text;
  }

  // ---------------------------------------------------------------- chips

  buildChips() {
    const wrap = $('chips');
    const opts = [['any', 'Any'], ...CLASS_ORDER.map((k) => [k, CLASSES[k].short])];
    wrap.innerHTML = '';
    for (const [k, label] of opts) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.setAttribute('role', 'radio');
      b.dataset.cls = k;
      b.textContent = label;
      b.setAttribute('aria-checked', String(k === 'any'));
      b.addEventListener('click', () => {
        this.nextClass = k === 'any' ? null : k;
        for (const c of wrap.children) c.setAttribute('aria-checked', String(c === b));
        if (k !== 'any') this.newWorld();
      });
      wrap.appendChild(b);
    }
  }

  // ---------------------------------------------------------------- forge

  buildForge(w) {
    const app = this.app;
    const isGas = w.style === 5;
    const defs = [
      { key: 'ocean', label: hydrosphereLabel(w), min: 0, max: 0.99, step: 0.005, value: () => app.oceanFraction(), fmt: fmt.pct, show: !isGas },
      { key: 'clouds', label: 'Cloud cover', min: 0, max: 1, step: 0.01, value: () => app.cloudCover(), fmt: fmt.pct, show: !!w.clouds.on },
      { key: 'atmosphere', label: 'Atmosphere', min: 0, max: 2.5, step: 0.01, value: () => app.settings.atmosphere, fmt: fmt.pct, show: !!w.atmo.on },
      {
        key: 'temperature', label: 'Climate', min: -1, max: 1, step: 0.01, value: () => app.settings.temperature,
        fmt: (v) => (Math.abs(v) < 0.04 ? 'As surveyed' : `${v > 0 ? '+' : '−'}${fmt.int(Math.abs(v) * 40)} K`), show: !isGas && w.style !== 4,
      },
      { key: 'relief', label: 'Relief', min: 0, max: 2.5, step: 0.01, value: () => app.settings.relief, fmt: fmt.pct, show: !isGas },
      { key: 'timeScale', label: 'Time flow', min: 0, max: 12, step: 0.1, value: () => app.settings.timeScale, fmt: (v) => (v === 0 ? 'Paused' : `${fmt.fixed(v, 1)}×`), show: true },
      { key: 'sunAngle', label: 'Sun position', min: -Math.PI, max: Math.PI, step: 0.01, value: () => app.settings.sunAngle, fmt: (v) => `${fmt.int((v * 180) / Math.PI)}°`, show: true },
    ];
    const box = $('controls');
    box.innerHTML = '';
    for (const d of defs) {
      if (!d.show) continue;
      const id = `ctl-${d.key}`;
      const wrap = document.createElement('div');
      wrap.className = 'ctl';
      wrap.innerHTML = `<div class="row"><label class="label" for="${id}">${d.label}</label><output for="${id}"></output></div>
        <input type="range" id="${id}" min="${d.min}" max="${d.max}" step="${d.step}">`;
      const input = wrap.querySelector('input');
      const out = wrap.querySelector('output');
      const sync = () => {
        const v = d.value();
        input.value = v;
        out.textContent = d.fmt(v);
        input.style.setProperty('--p', `${((v - d.min) / (d.max - d.min)) * 100}%`);
      };
      input.addEventListener('input', () => {
        app.set(d.key, parseFloat(input.value));
        sync();
      });
      sync();
      box.appendChild(wrap);
    }
    const tg = $('toggles');
    tg.innerHTML = '';
    const toggles = [
      { key: 'rings', label: 'Rings', show: !!w.rings },
      { key: 'moons', label: 'Moons', show: w.moons.length > 0 },
      { key: 'aurora', label: 'Aurorae', show: !!w.aurora.on && !!w.atmo.on },
    ];
    for (const t of toggles) {
      if (!t.show) continue;
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = t.label;
      b.setAttribute('aria-pressed', String(!!app.settings[t.key]));
      b.addEventListener('click', () => {
        app.set(t.key, !app.settings[t.key]);
        b.setAttribute('aria-pressed', String(!!app.settings[t.key]));
      });
      tg.appendChild(b);
    }
  }

  toggleForge(force) {
    const f = $('forge');
    const open = force ?? f.hidden;
    f.hidden = !open;
    $('btn-forge').setAttribute('aria-expanded', String(open));
    $('btn-forge-m').setAttribute('aria-pressed', String(open));
  }

  // ---------------------------------------------------------------- labels

  toggleLabels(force) {
    this.labelsOn = force ?? !this.labelsOn;
    $('btn-labels').setAttribute('aria-pressed', String(this.labelsOn));
    if (this.labelsOn) this.buildLabels();
    else this.clearLabels();
  }

  clearLabels() {
    $('labels').innerHTML = '';
    this.labelEls = [];
  }

  buildLabels() {
    this.clearLabels();
    const w = this.app.world;
    if (!w) return;
    const box = $('labels');
    const add = (text, kind, data) => {
      const el = document.createElement('div');
      el.className = `glabel ${kind}`;
      el.textContent = text;
      box.appendChild(el);
      this.labelEls.push({ el, kind, ...data });
    };
    for (const r of w.regions ?? []) add(r.name, r.kind, { dir: r.dir });
    if (w.peak) add(`${w.peak.name} · ${fmt.int(w.peak.meters)} m`, 'peak', { dir: w.peak.dir });
    w.moons.forEach((m, i) => add(m.name, 'moon', { moon: i }));
  }

  onFrame({ rot, moons }) {
    if (!this.labelsOn || !this.labelEls.length) return;
    const app = this.app;
    const cam = app.camera;
    const W = app.canvas.clientWidth, H = app.canvas.clientHeight;
    const aspect = W / H;
    for (const L of this.labelEls) {
      let p, facing = 1;
      if (L.moon !== undefined) {
        const m = moons[L.moon];
        if (!m) { L.el.style.opacity = 0; continue; }
        p = m.pos;
        // Hidden behind the planet?
        const toM = v3.sub(p, cam.pos);
        const d = v3.norm(toM);
        const tca = -v3.dot(cam.pos, d);
        const closest = Math.sqrt(Math.max(v3.dot(cam.pos, cam.pos) - tca * tca, 0));
        if (tca > 0 && closest < 1 && tca < v3.len(toM)) facing = 0;
      } else {
        const wdir = m3.apply(rot, L.dir);
        p = v3.scale(wdir, 1.0 + (L.kind === 'peak' ? 0.004 : 0.012));
        const view = v3.norm(v3.sub(cam.pos, p));
        facing = clamp((v3.dot(wdir, view) - 0.12) / 0.3, 0, 1);
      }
      const s = cam.projectPoint(p, aspect);
      if (!s || facing <= 0) {
        L.el.style.opacity = 0;
        continue;
      }
      L.el.style.opacity = facing * (app.vis > 0.9 ? 1 : 0);
      L.el.style.transform = `translate(${(s[0] * W).toFixed(1)}px, ${((1 - s[1]) * H).toFixed(1)}px) translate(${L.kind === 'moon' ? '12px' : '-50%'}, -50%)`;
    }
  }

  // ---------------------------------------------------------------- misc

  toast(msg, ms = 2200) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  toggleHidden() {
    const hidden = $('ui').classList.toggle('hidden');
    this.app.uiHidden = hidden;
  }

  async share() {
    const w = this.app.world;
    const code = worldCode(w);
    // Inside an embedding frame our own URL is not the one people can open,
    // so share the world code, which works after # on the page's real link.
    let framed = false;
    try { framed = window.self !== window.top; } catch { framed = true; }
    const text = framed ? code : `${location.href.split('#')[0]}#${code}`;
    try {
      await navigator.clipboard.writeText(text);
      this.toast(framed ? `Copied world code ${code} · add it after # in this page's link` : `Link copied · world ${code}`, framed ? 5000 : 2200);
    } catch {
      this.toast(`World code ${code} · add it after # in this page's link`, 6000);
    }
  }

  dismissHint() {
    const h = $('hint');
    if (h.style.opacity === '0') return;
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => (h.style.opacity = '0'), 2500);
  }

  // ---------------------------------------------------------------- input

  bindInput() {
    const canvas = this.app.canvas;
    const cam = this.app.camera;
    const pointers = new Map();
    let pinch = 0;
    canvas.addEventListener('pointerdown', (e) => {
      this.extras.director?.toggle(false);
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      cam.dragging = true;
      cam.vel.yaw = cam.vel.pitch = 0;
      canvas.classList.add('dragging');
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
      this.dismissHint();
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pointers.size === 1) cam.drag(dx, dy);
      else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) cam.zoom(pinch / d);
        pinch = d;
      }
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        cam.release();
        canvas.classList.remove('dragging');
      }
      pinch = 0;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.extras.director?.toggle(false);
      const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      cam.zoom(Math.exp(clamp(d, -200, 200) * 0.0014));
      this.dismissHint();
    }, { passive: false });
    canvas.addEventListener('dblclick', () => {
      cam.target.dist = cam.target.dist > 1.6 ? MIN_DIST + 0.09 : this.app.homeDist();
    });

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (this.extras.director?.active && k !== 'c') {
        this.extras.director.toggle(false);
        if (k !== ' ' && k !== 'escape') return;
      }
      const map = {
        c: () => this.extras.director?.toggle(),
        j: () => this.toggleLog(),
        ' ': () => this.newWorld(),
        n: () => this.newWorld(),
        arrowleft: () => this.prev(),
        arrowright: () => this.next(),
        l: () => this.toggleLabels(),
        h: () => this.toggleHidden(),
        f: () => this.toggleForge(),
        a: () => this.extras.atlas?.toggle(),
        m: () => this.extras.sound?.toggle(),
        p: () => this.extras.postcard?.open(),
        escape: () => {
          this.toggleLog(false);
          this.extras.atlas?.close();
          this.extras.postcard?.close();
          this.toggleForge(false);
        },
        '=': () => cam.zoom(0.8),
        '+': () => cam.zoom(0.8),
        '-': () => cam.zoom(1.25),
      };
      if (e.target instanceof HTMLInputElement && (k === 'arrowleft' || k === 'arrowright')) return;
      const fn = map[k];
      if (fn) {
        e.preventDefault();
        fn();
      }
    });
  }

  bindButtons() {
    $('btn-new').addEventListener('click', () => this.newWorld());
    $('btn-prev').addEventListener('click', () => this.prev());
    $('btn-next').addEventListener('click', () => this.next());
    $('btn-forge').addEventListener('click', () => this.toggleForge());
    $('btn-forge-m').addEventListener('click', () => this.toggleForge());
    $('btn-forge-close').addEventListener('click', () => this.toggleForge(false));
    $('btn-labels').addEventListener('click', () => this.toggleLabels());
    $('btn-tour').addEventListener('click', () => this.extras.director?.toggle());
    $('btn-log').addEventListener('click', () => this.toggleLog());
    $('btn-log-close').addEventListener('click', () => this.toggleLog(false));
    $('btn-hide').addEventListener('click', () => this.toggleHidden());
    $('btn-share').addEventListener('click', () => this.share());
    $('btn-survey').addEventListener('click', () => {
      const s = $('survey');
      s.classList.toggle('open');
      $('btn-survey').setAttribute('aria-pressed', String(s.classList.contains('open')));
    });
    $('btn-reroll').addEventListener('click', () => {
      const w = this.app.world;
      this.go((Math.random() * 2 ** 32) >>> 0, w.cls);
    });
    $('btn-reset').addEventListener('click', () => {
      const s = this.app.settings;
      Object.assign(s, { ocean: null, clouds: null, atmosphere: 1, temperature: 0, relief: 1, timeScale: 1, sunAngle: 0, rings: true, moons: true, aurora: true });
      this.app.updateSea();
      this.buildForge(this.app.world);
      this.toast('Restored to survey values');
    });
  }
}
