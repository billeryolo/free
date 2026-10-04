// Small deterministic helpers: PRNG, colour space conversions, vector maths.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  constructor(seed) {
    this.next = mulberry32(seed);
  }
  float(a = 0, b = 1) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.float(a, b + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  weighted(entries) {
    let total = 0;
    for (const [, w] of entries) total += w;
    let r = this.next() * total;
    for (const [v, w] of entries) {
      r -= w;
      if (r <= 0) return v;
    }
    return entries[entries.length - 1][0];
  }
  gauss(mean = 0, sd = 1) {
    const u = 1 - this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  unitVector() {
    const z = this.float(-1, 1);
    const t = this.float(0, Math.PI * 2);
    const r = Math.sqrt(1 - z * z);
    return [r * Math.cos(t), z, r * Math.sin(t)];
  }
}

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// --- colour -----------------------------------------------------------------

export function hexToSrgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toGam = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

export const srgbToLinear = (c) => c.map(toLin);
export const linearToSrgb = (c) => c.map((v) => toGam(clamp(v, 0, 1)));
export const hexToLinear = (hex) => srgbToLinear(hexToSrgb(hex));

export function linearToHex(c) {
  return '#' + linearToSrgb(c).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

// OKLab (Björn Ottosson) for perceptual hue/lightness jitter.
export function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    Math.max(0, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    Math.max(0, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    Math.max(0, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

// Rotate hue (radians), scale chroma and lightness in OKLCh.
export function shiftColor(lin, dh = 0, dc = 1, dl = 1) {
  const [L, a, b] = linearToOklab(lin);
  const C = Math.hypot(a, b) * dc;
  const h = Math.atan2(b, a) + dh;
  return oklabToLinear([L * dl, C * Math.cos(h), C * Math.sin(h)]);
}

export const mixColor = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const scaleColor = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// Approximate blackbody colour (linear RGB, max component 1).
export function blackbody(tempK) {
  const t = tempK / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const lin = srgbToLinear([clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255]);
  const m = Math.max(...lin);
  return lin.map((v) => v / m);
}

// --- vectors ------------------------------------------------------------------

export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
};

// Column-major 3x3 matrices stored as flat arrays of 9.
export const m3 = {
  rotX(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [1, 0, 0, 0, c, s, 0, -s, c];
  },
  rotY(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [c, 0, -s, 0, 1, 0, s, 0, c];
  },
  rotZ(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [c, s, 0, -s, c, 0, 0, 0, 1];
  },
  mul(a, b) {
    const o = new Array(9);
    for (let c = 0; c < 3; c++)
      for (let r = 0; r < 3; r++)
        o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
    return o;
  },
  apply(m, v) {
    return [
      m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
      m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
      m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
    ];
  },
  transpose(m) {
    return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
  },
};
