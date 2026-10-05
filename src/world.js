// World generation: a seed becomes a star, a planet class, palettes,
// atmosphere, rings, moons and a survey record of physical data.

import { Rng, hexToLinear, shiftColor, scaleColor, mixColor, blackbody, clamp, lerp } from './util.js';
import { Namer } from './names.js';

export const CLASSES = {
  terran: { label: 'Temperate terrestrial', short: 'Terran', style: 0, weight: 3.2 },
  ocean: { label: 'Ocean world', short: 'Oceanic', style: 0, weight: 1.3 },
  exotic: { label: 'Exotic biosphere', short: 'Exotic', style: 0, weight: 1.5 },
  arid: { label: 'Arid desert world', short: 'Arid', style: 1, weight: 1.6 },
  frozen: { label: 'Frozen world', short: 'Frozen', style: 2, weight: 1.3 },
  volcanic: { label: 'Volcanic world', short: 'Volcanic', style: 3, weight: 1.1 },
  toxic: { label: 'Greenhouse world', short: 'Greenhouse', style: 0, weight: 0.8 },
  airless: { label: 'Airless rock', short: 'Airless', style: 4, weight: 1.0 },
  gas: { label: 'Gas giant', short: 'Gas giant', style: 5, weight: 1.6 },
  icegiant: { label: 'Ice giant', short: 'Ice giant', style: 5, weight: 0.9 },
};

export const CLASS_ORDER = ['terran', 'ocean', 'exotic', 'arid', 'frozen', 'volcanic', 'toxic', 'airless', 'gas', 'icegiant'];

// Surface palettes in sRGB hex: deep, shallow, sand, lowWet, lowDry, high, rock, snow.
const PALETTES = {
  terran: [
    ['#04142e', '#0e5a74', '#c9b68c', '#2b5a1d', '#a08a58', '#6d6048', '#5a5047', '#f3f6f9'],
    ['#051a33', '#11687a', '#d1c08f', '#3c6420', '#b39a5e', '#73624a', '#5e554d', '#f4f6f9'],
    ['#03122a', '#0c4f6c', '#c2ae84', '#204d26', '#8e7d52', '#5e5545', '#4f4844', '#eef3f7'],
  ],
  ocean: [
    ['#02102a', '#0f6f92', '#e3d3a5', '#2f6d2a', '#9a9a5a', '#5f6a45', '#55524a', '#f2f6fa'],
    ['#031836', '#138aa0', '#efe0b4', '#27652f', '#86915b', '#566246', '#4f4e48', '#f2f6fa'],
  ],
  exotic: [
    ['#06233a', '#22b3a3', '#e2c6a0', '#4b2266', '#a35d4f', '#4b3a55', '#3c3240', '#ece9ff'],
    ['#0c1c3a', '#2a9fbf', '#d9c09a', '#7a1b2c', '#8a6a3a', '#4d3d36', '#3f3430', '#fff1ec'],
    ['#091a30', '#2fbf8f', '#e6d3a8', '#1c3f78', '#5a7a9a', '#3d4058', '#33343f', '#f0f5ff'],
    ['#141a36', '#4a6ab0', '#e9cfa8', '#8a6d12', '#b0844a', '#5a4630', '#40342a', '#fff5e6'],
  ],
  arid: [
    ['#0e3646', '#2f7f86', '#e0b57a', '#7a6a3a', '#c58a4f', '#8a4e2e', '#5e3220', '#efe6da'],
    ['#2a1a14', '#6a4a3a', '#d2875a', '#6a3a2a', '#b5532c', '#7a3420', '#4a2216', '#f0dcd0'],
    ['#123a40', '#3a8a80', '#ead7a6', '#8a7a46', '#d4b277', '#a07a50', '#6e5034', '#f6efe0'],
  ],
  frozen: [
    ['#0f2440', '#4f8fbf', '#d8e2ea', '#a9c3d9', '#c9d8e6', '#9aa7b5', '#4c4f57', '#f2f7fc'],
    ['#2a2420', '#8a4a32', '#e6dccf', '#d9cbbb', '#efe6da', '#b9a898', '#5a4a40', '#fbf8f2'],
    ['#10283a', '#6fc0d0', '#dbeef0', '#b6dce6', '#d9edf2', '#9fb9c4', '#47525a', '#f6fcff'],
  ],
  volcanic: [
    ['#3a0c02', '#ff7b1f', '#3a2a22', '#2a221f', '#302622', '#4a3e37', '#1c1918', '#5a5048'],
    ['#2a0a02', '#ff9a2a', '#a08a30', '#6a4a20', '#c8b040', '#e0d070', '#4a3418', '#f0e8b0'],
    ['#30080a', '#ff5a3a', '#2a2228', '#16121a', '#1e1820', '#342a34', '#0e0c10', '#4a4450'],
  ],
  toxic: [
    ['#2a2c06', '#8a8a20', '#c0a060', '#6a6a2a', '#9a7a3a', '#7a5a3a', '#5a4630', '#e6e0b0'],
    ['#1a2a10', '#6a9a2a', '#b8a868', '#5a6a2a', '#8a7a4a', '#6a5a40', '#4a4030', '#dfe6b8'],
  ],
  airless: [
    ['#000000', '#000000', '#000000', '#4a4744', '#8a8580', '#b5b0aa', '#d0ccc6', '#ffffff'],
    ['#000000', '#000000', '#000000', '#4a3a30', '#8a6e58', '#a88a70', '#c8b098', '#ffffff'],
    ['#000000', '#000000', '#000000', '#3a3a40', '#6e6e78', '#9a9aa4', '#c2c2cc', '#ffffff'],
    ['#000000', '#000000', '#000000', '#5a4026', '#a07a4a', '#c09a64', '#dcc29a', '#ffffff'],
  ],
};

const GAS_PALETTES = {
  gas: [
    { ramp: ['#f2e6d0', '#d9b38c', '#b5764c', '#8a5236', '#efe3cc'], storm: '#c0502e' },
    { ramp: ['#f4e7c4', '#e3cf9a', '#cfb27a', '#b89a63', '#f0e2b8'], storm: '#f2e4bb' },
    { ramp: ['#3a1a2a', '#6a2a3a', '#a04a3a', '#d07a4a', '#2a1020'], storm: '#ffb070' },
    { ramp: ['#d8c8e8', '#a890c8', '#7a5aa0', '#503878', '#efe4f4'], storm: '#f0a0c0' },
    { ramp: ['#e8eef0', '#c4b8a0', '#9a8a70', '#6a5a48', '#f4f0e8'], storm: '#5a3a2a' },
  ],
  icegiant: [
    { ramp: ['#2a4fb8', '#3d6fd6', '#5d93e8', '#1e3c96', '#8fb8f0'], storm: '#0e2466' },
    { ramp: ['#a8dfe0', '#93d0d6', '#bfe9e6', '#86c3cc', '#d0f0ec'], storm: '#f0ffff' },
    { ramp: ['#1f6a7a', '#2a8a96', '#5ab8b8', '#18505e', '#8ad8d0'], storm: '#e0fff8' },
  ],
};

const EARTH_TAU = [0.046, 0.108, 0.265];
export const HR = 0.2;
export const HM = 0.07;

const STAR_TYPES = [
  { cls: 'M', t: [2600, 3850], mass: [0.12, 0.55], radius: [0.15, 0.6], w: 2.5 },
  { cls: 'K', t: [3900, 5250], mass: [0.6, 0.85], radius: [0.65, 0.9], w: 2.2 },
  { cls: 'G', t: [5300, 6000], mass: [0.88, 1.12], radius: [0.88, 1.15], w: 2.0 },
  { cls: 'F', t: [6050, 7300], mass: [1.12, 1.5], radius: [1.15, 1.6], w: 1.0 },
  { cls: 'A', t: [7500, 9600], mass: [1.6, 2.4], radius: [1.6, 2.3], w: 0.35 },
];

function makeStar(rng) {
  const st = rng.weighted(STAR_TYPES.map((s) => [s, s.w]));
  const k = rng.next();
  const temp = lerp(st.t[0], st.t[1], k);
  const sub = clamp(Math.round((1 - k) * 9), 0, 9);
  const mass = lerp(st.mass[0], st.mass[1], k);
  const radius = lerp(st.radius[0], st.radius[1], k);
  const lum = radius * radius * Math.pow(temp / 5778, 4);
  const raw = blackbody(temp);
  // Eyes adapt; keep the tint but not the full saturation.
  const color = mixColor(raw, [1, 1, 1], 0.6);
  return { spectral: `${st.cls}${sub}V`, temp, mass, radius, lum, color };
}

function palette(rng, list, hueJitter = 0.12, lightJitter = 0.08) {
  const p = rng.pick(list).map(hexToLinear);
  const dh = rng.float(-hueJitter, hueJitter);
  const dl = 1 + rng.float(-lightJitter, lightJitter);
  const vegShift = rng.float(-hueJitter, hueJitter) * 1.5;
  return p.map((c, i) => shiftColor(c, i === 3 || i === 4 ? dh + vegShift : dh * 0.5, 1, i === 7 ? 1 : dl));
}

function valueNoise1D(rng, n) {
  const pts = Array.from({ length: n + 1 }, () => rng.next());
  return (x) => {
    const t = clamp(x, 0, 1) * n;
    const i = Math.min(n - 1, Math.floor(t));
    const f = t - i;
    const s = f * f * (3 - 2 * f);
    return pts[i] * (1 - s) + pts[i + 1] * s;
  };
}

function ringProfile(rng, colA, colB) {
  const N = 2048;
  const data = new Uint8Array(N * 4);
  const bands = [];
  const nb = rng.int(3, 6);
  for (let i = 0; i < nb; i++) bands.push({ c: rng.float(0.05, 0.95), w: rng.float(0.05, 0.28), a: rng.float(0.35, 1) });
  const gaps = [];
  const ng = rng.int(1, 3);
  for (let i = 0; i < ng; i++) gaps.push({ c: rng.float(0.2, 0.9), w: rng.float(0.006, 0.025) });
  const coarse = valueNoise1D(rng, 24);
  const mid = valueNoise1D(rng, 140);
  const fine = valueNoise1D(rng, 700);
  const tint = valueNoise1D(rng, 9);
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    let d = 0;
    for (const b of bands) d += b.a * Math.exp(-Math.pow((u - b.c) / b.w, 2));
    d = Math.min(1, d * 0.85 + 0.08);
    d *= 0.55 + 0.45 * coarse(u);
    d *= 0.82 + 0.18 * mid(u);
    d *= 0.9 + 0.1 * fine(u);
    for (const g of gaps) d *= 1 - 0.95 * Math.exp(-Math.pow((u - g.c) / g.w, 2));
    const edge = smoothstepJs(0, 0.05, u) * smoothstepJs(1, 0.97, u);
    d = clamp(d * edge, 0, 1);
    // Inner ringlets are dusky, outer ones brighter and icier.
    const c = mixColor(colA, colB, clamp(tint(u) * 0.8 + u * 0.4, 0, 1));
    const lum = 0.65 + 0.35 * u + 0.15 * (mid(u) - 0.5);
    data[i * 4 + 0] = clamp(Math.sqrt(c[0] * lum) * 255, 0, 255);
    data[i * 4 + 1] = clamp(Math.sqrt(c[1] * lum) * 255, 0, 255);
    data[i * 4 + 2] = clamp(Math.sqrt(c[2] * lum) * 255, 0, 255);
    data[i * 4 + 3] = d * 255;
  }
  return data;
}

function smoothstepJs(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function makeStorms(rng, count, big) {
  const a = new Float32Array(24);
  for (let i = 0; i < Math.min(count, 6); i++) {
    const lat = (rng.float(-0.55, 0.55)) * (i === 0 ? 0.7 : 1);
    const lon = rng.float(0, Math.PI * 2);
    const c = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
    const s = (i === 0 ? big : rng.float(0.1, 0.45)) * (rng.chance(0.5) ? 1 : -1);
    a.set([...c, s], i * 4);
  }
  return a;
}

function makeCyclones(rng, count) {
  const a = new Float32Array(16);
  for (let i = 0; i < Math.min(count, 4); i++) {
    const hemi = rng.chance(0.5) ? 1 : -1;
    const lat = hemi * rng.float(0.2, 0.6);
    const lon = rng.float(0, Math.PI * 2);
    const c = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
    a.set([...c, hemi * rng.float(0.3, 1.0)], i * 4);
  }
  return a;
}

function makeSky(rng, star) {
  const gn = rng.unitVector();
  let gc = rng.unitVector();
  // Project the core direction into the galactic plane.
  const d = gc[0] * gn[0] + gc[1] * gn[1] + gc[2] * gn[2];
  gc = gc.map((v, i) => v - gn[i] * d);
  const l = Math.hypot(...gc) || 1;
  gc = gc.map((v) => v / l);
  const neb = new Float32Array(12);
  const colA = new Float32Array(9);
  const colB = new Float32Array(9);
  const NEB_COLORS = [
    ['#ff3a6a', '#40c8ff'],
    ['#ff5a3a', '#ffd080'],
    ['#4a6aff', '#c070ff'],
    ['#20d0b0', '#3a6aff'],
    ['#ff4ab0', '#ff9a40'],
    ['#7a40ff', '#ff4060'],
  ];
  const count = rng.int(1, 3);
  for (let i = 0; i < count; i++) {
    const dir = rng.unitVector();
    neb.set([...dir, rng.float(0.25, 0.6)], i * 4);
    const [a, b] = rng.pick(NEB_COLORS);
    const k = rng.float(0.05, 0.13);
    colA.set(scaleColor(hexToLinear(a), k), i * 3);
    colB.set(scaleColor(hexToLinear(b), k * 0.8), i * 3);
  }
  return { uGalNormal: gn, uGalCenter: gc, uNebula: neb, uNebColA: colA, uNebColB: colB, uGalBright: rng.float(0.05, 0.12) };
}

// Earth Similarity Index (Schulze-Makuch et al. 2011).
function esi(radius, density, vesc, temp) {
  const term = (x, x0, w) => Math.pow(1 - Math.abs((x - x0) / (x + x0)), w / 4);
  return term(radius, 1, 0.57) * term(density, 1, 1.07) * term(vesc, 1, 0.7) * term(temp, 288, 5.58);
}

const COMPOSITIONS = {
  terran: [['N₂', 77], ['O₂', 21], ['Ar', 1], ['CO₂', 1]],
  ocean: [['N₂', 70], ['H₂O', 16], ['O₂', 12], ['Ar', 2]],
  exotic: [['N₂', 64], ['O₂', 27], ['Ne', 6], ['CO₂', 3]],
  arid: [['CO₂', 94], ['N₂', 3], ['Ar', 2], ['O₂', 1]],
  frozen: [['N₂', 96], ['CH₄', 3], ['CO', 1]],
  volcanic: [['SO₂', 66], ['CO₂', 25], ['H₂S', 6], ['Na', 3]],
  toxic: [['CO₂', 92], ['SO₂', 5], ['N₂', 3]],
  airless: [],
  gas: [['H₂', 89], ['He', 10], ['CH₄', 1]],
  icegiant: [['H₂', 81], ['He', 15], ['CH₄', 4]],
};

function composition(rng, cls) {
  const base = COMPOSITIONS[cls];
  if (!base.length) return 'Trace exosphere';
  const jittered = base.map(([g, p]) => [g, Math.max(0.5, p * rng.float(0.85, 1.15))]);
  const total = jittered.reduce((s, [, p]) => s + p, 0);
  let parts = jittered.map(([g, p]) => [g, (p / total) * 100]);
  parts = parts.map(([g, p]) => [g, p >= 10 ? Math.round(p) : Math.round(p * 10) / 10]);
  return parts.map(([g, p]) => `${g} ${p}%`).join(' · ');
}

export function generateWorld(seed, forcedClass) {
  const rng = new Rng(seed);
  const namer = new Namer(seed);
  const cls = forcedClass ?? rng.weighted(CLASS_ORDER.map((k) => [k, CLASSES[k].weight]));
  const C = CLASSES[cls];
  const style = C.style;
  const star = makeStar(rng);
  const isGiant = style === 5;

  // ---- bake parameters
  const bake = {
    uStyle: style,
    uScale: rng.float(1.1, 2.1),
    uWarpAmt: rng.float(0.35, 0.95),
    uMountain: rng.float(0.6, 1.3),
    uCrater: 0,
    uBands: rng.float(7, 15),
    uTurb: rng.float(0.6, 1.4),
    uStorms: makeStorms(rng, rng.int(2, 6), rng.float(0.5, 1.0)),
  };
  if (cls === 'airless') bake.uCrater = rng.float(0.7, 1.3);
  if (cls === 'volcanic') bake.uCrater = rng.float(0.0, 0.5);
  if (cls === 'ocean') bake.uScale = rng.float(1.6, 2.6);
  if (cls === 'icegiant') {
    bake.uBands = rng.float(4, 8);
    bake.uTurb = rng.float(0.3, 0.8);
  }

  // ---- palettes
  let pal;
  let gas = null;
  let stormCol = [1, 1, 1];
  if (isGiant) {
    const g = rng.pick(GAS_PALETTES[cls]);
    const dh = rng.float(-0.12, 0.12);
    gas = g.ramp.map((h) => shiftColor(hexToLinear(h), dh, 1, rng.float(0.9, 1.05)));
    stormCol = shiftColor(hexToLinear(g.storm), dh);
    pal = PALETTES.terran[0].map(hexToLinear);
  } else {
    pal = palette(rng, PALETTES[cls], cls === 'exotic' ? 0.25 : 0.1);
  }
  const [deep, shallow, sand, lowWet, lowDry, high, rock, snow] = pal;

  // ---- climate and hydrosphere
  const climate = {
    terran: { T: [262, 302], ocean: [0.55, 0.78], liquid: 1, moist: [-0.05, 0.1] },
    ocean: { T: [278, 312], ocean: [0.9, 0.975], liquid: 1, moist: [0.05, 0.2] },
    exotic: { T: [270, 310], ocean: [0.45, 0.75], liquid: 1, moist: [-0.05, 0.15] },
    arid: { T: [285, 345], ocean: [0.0, 0.14], liquid: rng.chance(0.55) ? 1 : 0, moist: [-0.4, -0.2] },
    frozen: { T: [90, 235], ocean: [0.2, 0.6], liquid: 1, moist: [0, 0.2] },
    volcanic: { T: [650, 1400], ocean: [0.08, 0.35], liquid: 1, moist: [0, 0] },
    toxic: { T: [380, 720], ocean: [0.3, 0.6], liquid: 1, moist: [-0.1, 0.1] },
    airless: { T: [90, 420], ocean: [0.25, 0.45], liquid: 0, moist: [0, 0] },
    gas: { T: [70, 170], ocean: [0, 0], liquid: 0, moist: [0, 0] },
    icegiant: { T: [45, 80], ocean: [0, 0], liquid: 0, moist: [0, 0] },
  }[cls];
  if (cls === 'gas' && rng.chance(0.2)) climate.T = [900, 1600]; // hot Jupiter
  const tempK = rng.float(...climate.T);
  let uTemp = clamp((tempK - 285) / 40, -1, 1);
  if (cls === 'frozen') uTemp = -0.9;
  if (cls === 'arid') uTemp = clamp((tempK - 300) / 60, -0.3, 1);
  if (cls === 'toxic') uTemp = 0.4;

  // ---- emission
  const inhabited = (cls === 'terran' && rng.chance(0.6)) || (cls === 'ocean' && rng.chance(0.4)) || (cls === 'exotic' && rng.chance(0.3));
  const cityHue = rng.pick(['#ffb060', '#ffc98a', '#ffa34a', '#9ad8ff', '#d8ff9a']);
  let emit = scaleColor(hexToLinear(cls === 'exotic' ? rng.pick(['#9ad8ff', '#d8ff9a', '#ffb060']) : cityHue), 1.6);
  let lava = 0;
  if (cls === 'volcanic') {
    emit = scaleColor(hexToLinear(rng.pick(['#ff5a14', '#ff3a10', '#ff7a1a', '#ff4a30'])), 3.2);
    lava = rng.float(0.7, 1.0);
  }
  if (isGiant) emit = stormCol;

  // ---- atmosphere
  const atmoProfiles = {
    terran: { h: [0.028, 0.04], tau: EARTH_TAU, tauM: 0.035, abs: [0, 0, 0], density: [0.6, 0.9], g: 0.76, pressure: [0.7, 1.6] },
    ocean: { h: [0.032, 0.045], tau: EARTH_TAU.map((v) => v * 1.15), tauM: 0.035, abs: [0, 0, 0], density: [0.7, 1.0], g: 0.78, pressure: [1.2, 3.5] },
    exotic: { h: [0.03, 0.045], tau: null, tauM: 0.03, abs: [0, 0, 0], density: [0.6, 1.0], g: 0.76, pressure: [0.6, 2.2] },
    arid: { h: [0.022, 0.035], tau: EARTH_TAU.map((v) => v * 0.45), tauM: 0.08, mie: [1.0, 0.62, 0.36], abs: [0.0, 0.02, 0.05], density: [0.6, 1.1], g: 0.8, pressure: [0.01, 0.6] },
    frozen: { h: [0.02, 0.032], tau: EARTH_TAU.map((v) => v * 0.7), tauM: 0.02, abs: [0, 0, 0], density: [0.5, 1.0], g: 0.76, pressure: [0.05, 1.5] },
    volcanic: { h: [0.03, 0.045], tau: [0.03, 0.035, 0.045], tauM: 0.14, mie: [1.0, 0.55, 0.3], abs: [0.0, 0.04, 0.1], density: [0.8, 1.3], g: 0.82, pressure: [2, 40] },
    toxic: { h: [0.04, 0.06], tau: EARTH_TAU.map((v) => v * 0.8), tauM: 0.2, mie: [1.0, 0.85, 0.45], abs: [0.0, 0.03, 0.14], density: [1.0, 1.5], g: 0.85, pressure: [8, 92] },
    airless: null,
    gas: { h: [0.04, 0.05], tau: EARTH_TAU.map((v) => v * 0.45), tauM: 0.03, abs: [0, 0, 0], density: [1.0, 1.3], g: 0.8, pressure: [1000, 1000] },
    icegiant: { h: [0.04, 0.055], tau: [0.02, 0.085, 0.2], tauM: 0.03, abs: [0.07, 0.008, 0.0], density: [1.0, 1.4], g: 0.8, pressure: [1000, 1000] },
  };
  const ap = atmoProfiles[cls];
  let atmo = { on: 0, height: 0.03, tau: [0, 0, 0], tauM: 0, mie: [1, 1, 1], absorb: [0, 0, 0], g: 0.76, density: 0 };
  let pressure = 0;
  if (ap) {
    let tau = ap.tau;
    if (!tau) {
      const hue = rng.pick([[0.11, 0.07, 0.2], [0.05, 0.16, 0.14], [0.16, 0.08, 0.1], [0.06, 0.1, 0.24], [0.1, 0.06, 0.22]]);
      tau = hue;
    }
    const density = rng.float(...ap.density);
    atmo = { on: 1, height: rng.float(...ap.h), tau, tauM: ap.tauM, mie: ap.mie ?? [1, 1, 1], absorb: ap.abs, g: ap.g, density };
    pressure = rng.float(...ap.pressure);
  }

  // ---- clouds
  const cloudProfiles = {
    terran: { cover: [0.36, 0.55], col: '#f4f6f8' },
    ocean: { cover: [0.48, 0.66], col: '#f6f8fa' },
    exotic: { cover: [0.3, 0.55], col: rng.pick(['#f4f6f8', '#f4eef8', '#eef8f4']) },
    arid: { cover: [0.04, 0.16], col: '#e8d2b8' },
    frozen: { cover: [0.15, 0.35], col: '#eef2f8' },
    volcanic: { cover: [0.25, 0.45], col: '#4a4440' },
    toxic: { cover: [0.5, 0.66], col: '#dcc070' },
    airless: null,
    gas: null,
    icegiant: null,
  };
  const cp = cloudProfiles[cls];
  const clouds = cp
    ? { on: 1, cover: rng.float(...cp.cover), col: hexToLinear(cp.col), alt: rng.float(0.005, 0.008) }
    : { on: 0, cover: 0, col: [1, 1, 1], alt: 0.006 };
  const cloudBake = {
    uCyclones: makeCyclones(rng, cls === 'terran' || cls === 'ocean' ? rng.int(1, 4) : rng.int(0, 2)),
    uCloudScale: rng.float(2.0, 3.2),
    uBanding: cls === 'toxic' ? 1.0 : rng.float(0.0, 0.5),
  };

  // ---- aurora
  const auroraOn = (['terran', 'frozen', 'ocean', 'exotic', 'gas', 'icegiant'].includes(cls) && rng.chance(0.55)) ? 1 : 0;
  const auroraCol = hexToLinear(rng.pick(['#3aff7a', '#3aff9a', '#5affd0', '#ff4a8a', '#7a8aff']));

  // ---- physical properties
  const radiusRange = {
    terran: [0.75, 1.5], ocean: [1.2, 2.4], exotic: [0.8, 1.7], arid: [0.4, 1.2], frozen: [0.3, 1.4],
    volcanic: [0.5, 1.8], toxic: [0.8, 1.4], airless: [0.12, 0.8], gas: [6, 12.5], icegiant: [3.2, 5.5],
  }[cls];
  const radius = rng.float(...radiusRange);
  const densityRel = isGiant ? (cls === 'gas' ? rng.float(0.12, 0.3) : rng.float(0.22, 0.32)) : cls === 'ocean' ? rng.float(0.55, 0.8) : rng.float(0.7, 1.15);
  const mass = densityRel * radius ** 3;
  const gravity = mass / (radius * radius);
  const vesc = Math.sqrt(mass / radius);

  // Orbit from radiative balance: T_eq = T* sqrt(R*/2a) (1-A)^1/4.
  const greenhouse = { terran: 33, ocean: 40, exotic: 30, arid: 8, frozen: 5, volcanic: 150, toxic: 250, airless: 0, gas: 0, icegiant: 0 }[cls];
  const albedo = { terran: 0.3, ocean: 0.32, exotic: 0.28, arid: 0.25, frozen: 0.6, volcanic: 0.15, toxic: 0.7, airless: 0.12, gas: 0.45, icegiant: 0.3 }[cls];
  const teq = Math.max(30, tempK - greenhouse);
  const aRstar = 0.5 * Math.pow(star.temp / teq, 2) * Math.sqrt(1 - albedo);
  const orbitAU = aRstar * star.radius * 0.00465;
  const yearDays = Math.sqrt(orbitAU ** 3 / star.mass) * 365.25;
  const dayHours = isGiant ? rng.float(9, 18) : rng.float(14, 46);
  const tilt = rng.chance(0.06) ? rng.float(70, 98) : rng.float(0, 32);

  const landFrac = 1 - rng.float(...climate.ocean);
  const oceanTarget = isGiant ? 0 : 1 - landFrac;

  // ---- rings
  const ringChance = { gas: 0.62, icegiant: 0.5, frozen: 0.15, airless: 0.1 }[cls] ?? 0.06;
  let rings = null;
  if (rng.chance(ringChance)) {
    const inner = rng.float(1.3, 1.7);
    const outer = inner + rng.float(0.45, isGiant ? 1.4 : 0.8);
    const RING_TINTS = [['#8a7a66', '#e8dcc4'], ['#6a6058', '#d8d0c8'], ['#7a6248', '#f0d8b0'], ['#5a6670', '#d8e4ec'], ['#806a5a', '#e8c8a8']];
    const [ta, tb] = rng.pick(RING_TINTS).map(hexToLinear);
    const ra = isGiant ? mixColor(gas[2], ta, 0.5) : ta;
    const rb = isGiant ? mixColor(gas[0], tb, 0.4) : tb;
    rings = { inner, outer, data: ringProfile(rng, ra, rb) };
  }

  // ---- moons
  const moonCount = isGiant ? rng.weighted([[1, 2], [2, 3], [3, 3]]) : rng.weighted([[0, 3], [1, 4], [2, 2], [3, 0.6]]);
  const MOON_COLORS = [
    ['#8a8580', '#4a4744'],
    ['#b5a68a', '#6a5a48'],
    ['#e0e4ea', '#9aa4b0'],
    ['#d8c050', '#8a6a2a'],
    ['#a86a4a', '#5a3a2a'],
    ['#c8c0b8', '#7a706a'],
  ];
  const moons = [];
  let orbitR = (rings ? rings.outer : 1.4) + rng.float(0.9, 1.6);
  for (let i = 0; i < moonCount; i++) {
    const r = isGiant ? rng.float(0.04, 0.12) : rng.float(0.07, 0.24);
    const [a, b] = rng.pick(MOON_COLORS);
    moons.push({
      name: namer.moon(),
      radius: r,
      orbit: orbitR,
      period: rng.float(90, 220) * Math.sqrt(orbitR / 3),
      phase: rng.float(0, Math.PI * 2),
      incl: rng.float(-0.18, 0.18),
      node: rng.float(0, Math.PI * 2),
      col: scaleColor(hexToLinear(a), 0.8),
      col2: scaleColor(hexToLinear(b), 0.8),
      radiusKm: Math.round(r * radius * 6371 * (isGiant ? 0.6 : 1)),
    });
    orbitR += rng.float(1.0, 2.4) + r * 4;
  }

  const name = namer.planet();
  const designation = namer.designation(rng.int(0, 4));

  return {
    seed,
    cls,
    classLabel: C.label,
    style,
    name,
    designation,
    namer,
    star,
    bake,
    cloudBake,
    sky: makeSky(rng, star),
    oceanTarget,
    surface: {
      uDeep: deep, uShallow: shallow, uSand: sand, uLowWet: lowWet, uLowDry: lowDry, uHigh: high, uRock: rock, uSnow: snow,
      uEmit: emit,
      uCity: inhabited ? rng.float(0.6, 1.0) : 0,
      uLava: lava,
      uIceSea: cls === 'frozen' ? 1 : 0,
      uLiquid: climate.liquid,
      uTemp,
      uMoist: rng.float(...climate.moist),
      uRelief: cls === 'airless' ? rng.float(1.2, 1.8) : rng.float(0.8, 1.3),
      uGas: gas ? new Float32Array(gas.flat()) : new Float32Array(15),
    },
    clouds,
    atmo,
    aurora: { on: auroraOn, col: auroraCol },
    rings,
    moons,
    inhabited,
    sunSize: clamp(0.0045 * star.radius / Math.max(orbitAU, 0.02) * 1.6, 0.0035, 0.02),
    tilt: (tilt * Math.PI) / 180,
    dayHours,
    phys: {
      radius,
      radiusKm: Math.round(radius * 6371),
      mass,
      gravity,
      vesc: vesc * 11.19,
      density: densityRel * 5.51,
      tempK,
      orbitAU,
      yearDays,
      dayHours,
      tilt,
      pressure,
      composition: composition(rng, cls),
      esi: esi(radius, densityRel, vesc, tempK),
      peakScale: rng.float(5200, 13000) / Math.sqrt(Math.max(gravity, 0.2)),
    },
  };
}

// Physical atmosphere coefficients for the shader, scaled by the user's
// density control.
export function atmoUniforms(atmo, densityScale = 1) {
  if (!atmo.on) return { uAtmoOn: 0, uAtmoH: 0.03, uBetaR: [0, 0, 0], uBetaM: [0, 0, 0], uBetaA: [0, 0, 0], uMieG: 0.76 };
  const d = atmo.density * densityScale;
  const hr = HR * atmo.height;
  const hm = HM * atmo.height;
  return {
    uAtmoOn: d > 0.01 ? 1 : 0,
    uAtmoH: atmo.height,
    uBetaR: atmo.tau.map((t) => (t * d) / hr),
    uBetaM: atmo.mie.map((m) => (atmo.tauM * m * d) / hm),
    uBetaA: atmo.absorb.map((t) => (t * d) / hr),
    uMieG: atmo.g,
  };
}
