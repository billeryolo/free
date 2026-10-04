// Bake shaders. These run once per world (into cubemaps), so they can afford
// many octaves of noise. The real-time shader only samples their results.

import { NOISE, CUBE_DIR } from './noise.js';

const HEADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 fragColor;
uniform int uFace;
uniform bool uEquirect;
const float PI = 3.14159265359;
${NOISE}
${CUBE_DIR}
vec3 bakeDir() {
  if (uEquirect) {
    float lon = (vUv.x - 0.5) * 2.0 * PI;
    float lat = (vUv.y - 0.5) * PI;
    return vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
  }
  return cubeDir(uFace, vUv);
}
vec3 rotateAxis(vec3 p, vec3 axis, float a) {
  float c = cos(a), s = sin(a);
  return p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
}
`;

// ---------------------------------------------------------------------------
// Terrain: R = elevation, G = moisture, B = feature mask, A = rock mask.
// ---------------------------------------------------------------------------
export const TERRAIN_FS = HEADER + /* glsl */ `
uniform int uStyle;      // 0 earthlike, 1 desert, 2 ice, 3 lava, 4 barren, 5 gas
uniform float uScale;
uniform float uWarpAmt;
uniform float uMountain;
uniform float uCrater;
uniform float uBands;
uniform float uTurb;
uniform int uOct;        // octave budget (lower for previews)
uniform vec4 uStorms[6]; // xyz = center, w = signed strength
uniform bool uEncode;    // pack elevation into RG bytes for CPU readback

float craterProfile(float d) {
  float bowl = d < 1.0 ? (d * d - 1.0) : 0.0;
  float rim = 0.35 * exp(-pow((d - 1.0) * 3.2, 2.0));
  return max(bowl, -0.75) + rim;
}

float craterField(vec3 n, float freq, float density) {
  vec3 v = voronoi(n * freq);
  if (v.z > density) return 0.0;
  float r = mix(0.12, 0.3, fract(v.z * 17.31));
  return craterProfile(v.x / r) * r;
}

float craters(vec3 n) {
  float c = 0.0;
  c += craterField(n, 3.0, 0.5) * 0.55;
  c += craterField(n + 1.3, 7.0, 0.6) * 0.32;
  c += craterField(n - 2.1, 15.0, 0.7) * 0.16;
  c += craterField(n + 5.7, 33.0, 0.8) * 0.08;
  c += craterField(n - 7.4, 70.0, 0.85) * 0.035;
  return c;
}

float terrace(float h, float steps, float sharp) {
  float s = h * steps;
  float f = fract(s);
  return (floor(s) + smoothstep(0.5 - sharp, 0.5 + sharp, f)) / steps;
}

vec4 terrainRocky(vec3 n) {
  vec3 p = n * uScale;
  vec3 w = fbm3(p * 0.85 + 11.0, 4);
  vec3 pw = p + w * uWarpAmt;
  float c = fbm(pw, min(uOct, 8));
  c += 0.3 * fbm(pw * 0.45 - 3.0, 3);

  float landish = smoothstep(-0.08, 0.3, c);
  float region = smoothstep(-0.25, 0.35, fbm(p * 1.3 + 40.0, 3));
  float ridge = ridged(pw * 2.3 + 5.0, min(uOct, 8));
  float mm = smoothstep(0.0, 0.32, c) * (0.35 + 0.65 * region);
  float hills = erodedFbm(n * uScale * 4.5 + 9.0, n, uOct, 0.5);

  float h = c * 0.9;
  h += mm * ridge * uMountain * 0.7;
  h += hills * 0.11 * (0.35 + landish);
  h += (1.0 - landish) * 0.05 * ridged(pw * 1.6 - 13.0, 4);

  float moist = 0.5 + 0.8 * fbm(n * 2.1 + w * 0.6 + 70.0, 5);

  float feature = 0.0;
  float rock = clamp(mm * ridge * 1.4, 0.0, 1.0);

  if (uStyle == 0) {
    // Settlements: clustered cells, denser in "civilised" regions.
    float civ = smoothstep(-0.15, 0.3, fbm(n * 2.7 + 99.0, 4));
    vec3 big = voronoi(n * 34.0);
    vec3 mid = voronoi(n * 90.0 + 3.0);
    vec3 small = voronoi(n * 220.0);
    float metro = smoothstep(0.5, 0.0, big.x) * step(0.35, big.z);
    float towns = smoothstep(0.35, 0.0, mid.x) * step(0.4, mid.z);
    float hamlets = smoothstep(0.32, 0.0, small.x) * step(0.45, small.z);
    float sprawl = smoothstep(0.1, 0.45, fbm(n * 18.0 + 5.0, 4));
    feature = civ * clamp(metro * metro * 1.2 + towns * 0.7 + hamlets * 0.45 + sprawl * 0.12, 0.0, 1.0);
  } else if (uStyle == 1) {
    // Desert: mesas, canyons, dune seas.
    float t = terrace(h * 1.4 + 0.5, 7.0, 0.12) - 0.5;
    h = mix(h, t / 1.4, 0.55 * region);
    float canyon = pow(1.0 - abs(gnoise(pw * 3.1 + 2.0)), 10.0);
    canyon += 0.6 * pow(1.0 - abs(gnoise(pw * 7.3 - 8.0)), 12.0);
    h -= canyon * 0.13 * smoothstep(-0.1, 0.2, c);
    moist *= 0.35;
    feature = smoothstep(0.1, -0.15, c + 0.2 * region);   // dune seas in basins
    rock = clamp(rock + canyon * 0.8 + region * 0.25, 0.0, 1.0);
  } else if (uStyle == 2) {
    // Ice: fractured shell with long lineae.
    vec3 v1 = voronoi(n * 9.0 + w);
    vec3 v2 = voronoi(n * 26.0 - w);
    float cracks = smoothstep(0.05, 0.0, v1.y - v1.x) + 0.6 * smoothstep(0.035, 0.0, v2.y - v2.x);
    float lineae = pow(1.0 - abs(gnoise(pw * 2.0 + 30.0)), 40.0) + pow(1.0 - abs(gnoise(pw * 4.5 - 30.0)), 60.0) * 0.7;
    feature = clamp(cracks * 0.7 + lineae, 0.0, 1.0);
    h = mix(h, h * 0.6, 0.5) - feature * 0.025;
  } else if (uStyle == 3) {
    // Volcanic: glowing rivers in the lowlands and hot calderas.
    float rivers = pow(1.0 - abs(gnoise(pw * 4.2 + 3.0)), 28.0);
    rivers += 0.6 * pow(1.0 - abs(gnoise(pw * 9.0 - 3.0)), 36.0);
    float low = smoothstep(0.2, -0.1, c);
    vec3 vc = voronoi(n * 14.0);
    float calderas = smoothstep(0.12, 0.0, vc.x) * step(0.8, vc.z);
    float flows = smoothstep(0.75, 1.0, fbm(pw * 2.5 + 11.0, 5) + 0.3 * low);
    feature = clamp(rivers * (0.1 + low * 0.8) + calderas + flows * 0.4, 0.0, 1.0);
    h -= feature * 0.03;
    h += craters(n) * 0.25 * uCrater;
    rock = clamp(rock + 0.3, 0.0, 1.0);
  } else if (uStyle == 4) {
    // Airless: craters and dark maria.
    float maria = smoothstep(0.05, -0.2, fbm(n * 1.6 + 7.0, 4));
    h = h * 0.45 + craters(n) * uCrater - maria * 0.12;
    feature = maria;
    moist = 0.5 + 0.5 * fbm(n * 6.0, 3);
  }

  return vec4(h, moist, feature, rock);
}

// Iterated curl-noise advection: tangential swirls that read like fluid eddies,
// stretched along latitude.
vec3 curlAdvect(vec3 q, float amp) {
  for (int i = 0; i < 6; i++) {
    float f = 3.0 * pow(1.85, float(i));
    vec3 g = noised(q * vec3(f, f * 2.6, f) + float(i) * 7.1).yzw;
    vec3 c = cross(q, g);
    q = normalize(q + c * amp / f);
  }
  return q;
}

vec4 terrainGas(vec3 n) {
  // Swirl the sphere around storm centres before laying down bands.
  vec3 q = n;
  float stormMask = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 s = uStorms[i];
    if (s.w == 0.0) continue;
    float d = acos(clamp(dot(q, s.xyz), -1.0, 1.0));
    float r = 0.06 + abs(s.w) * 0.22;
    float k = smoothstep(r, 0.0, d);
    q = rotateAxis(q, s.xyz, sign(s.w) * k * k * 5.5);
    if (i == 0) {
      // Oval: compress latitude distance so the storm elongates along the bands.
      vec3 e = normalize(cross(vec3(0.0, 1.0, 0.0), s.xyz));
      vec3 nn = normalize(cross(s.xyz, e));
      vec3 lv = n - s.xyz * dot(n, s.xyz);
      float de = length(vec2(dot(lv, e) * 0.62, dot(lv, nn)));
      stormMask = smoothstep(r * 0.75, r * 0.2, de);
    }
  }
  q = curlAdvect(q, 0.09 * uTurb);
  vec3 stretch = vec3(1.2, 7.0, 1.2);
  vec3 warp = fbm3(q * stretch * 0.9 + 5.0, 5);
  vec3 qw = q + warp * vec3(0.12, 0.03, 0.12) * uTurb;
  float fine = fbm(qw * vec3(3.0, 26.0, 3.0) + 2.0, min(uOct, 7));
  float y = qw.y + 0.025 * fine * uTurb + 0.015 * fbm(qw * 14.0, 4) * uTurb;
  // Irregular band widths: layered 1D noise along latitude.
  float b1 = gnoise(vec3(3.1, y * uBands * 0.55, 1.7));
  float b2 = gnoise(vec3(7.3, y * uBands * 1.4, 2.9));
  float b3 = gnoise(vec3(1.1, y * uBands * 3.3, 5.3));
  float ramp = clamp(0.5 + b1 * 1.1 + b2 * 0.5 + b3 * 0.22 + fine * 0.22, 0.0, 1.0);
  float bright = 0.5 + 0.5 * fbm(qw * vec3(6.0, 30.0, 6.0) - 4.0, 5);
  float streak = 0.5 + 0.5 * fbm(qw * vec3(2.0, 60.0, 2.0) + 9.0, 4);
  return vec4(ramp, bright, stormMask, streak);
}

void main() {
  vec3 n = bakeDir();
  vec4 t = uStyle == 5 ? terrainGas(n) : terrainRocky(n);
  if (uEncode) {
    float v = clamp(t.x * 0.5 + 0.5, 0.0, 1.0) * 255.0;
    fragColor = vec4(floor(v) / 255.0, fract(v), clamp(t.y, 0.0, 1.0), clamp(t.z, 0.0, 1.0));
  } else {
    fragColor = t;
  }
}
`;

// ---------------------------------------------------------------------------
// Clouds: two independent fields (R, G) that the renderer cross-fades over time.
// ---------------------------------------------------------------------------
export const CLOUDS_FS = HEADER + /* glsl */ `
uniform vec4 uCyclones[4];
uniform float uCloudScale;
uniform float uBanding;

float cloudField(vec3 n, vec3 off) {
  vec3 q = n;
  for (int i = 0; i < 4; i++) {
    vec4 c = uCyclones[i];
    if (c.w == 0.0) continue;
    float d = acos(clamp(dot(q, c.xyz), -1.0, 1.0));
    float r = 0.16 + abs(c.w) * 0.2;
    float k = smoothstep(r, 0.0, d);
    q = rotateAxis(q, c.xyz, sign(c.w) * k * k * (4.0 + 2.5 * abs(c.w)));
  }
  float lat = q.y;
  vec3 p = q * uCloudScale + off;
  // Zonal stretch: weather systems elongate along the lines of latitude.
  vec3 ps = p * vec3(1.0, 1.0 + uBanding * 2.5 + 0.6, 1.0);
  vec3 w1 = fbm3(ps * 0.45, 3);
  vec3 pw = ps + w1 * 1.3;
  vec3 w2 = fbm3(pw * 1.7 + 7.0, 3) * 0.45;
  float weather = fbm(p * 0.55 + 3.0, 3);
  float base = fbm(pw * 1.1 + w2, 6);
  float billow = 1.0 - abs(fbm(pw * 4.2 + w2 * 3.0, 5) * 2.0);
  float streaks = fbm(pw * vec3(3.0, 9.0, 3.0) + w2 * 2.0, 4);
  float v = base * 0.85 + weather * 0.7 + (billow - 0.55) * 0.3 + streaks * 0.15;
  // Climate bands: wet equator and storm tracks, dry subtropics and poles.
  float a = abs(lat);
  float climate = 0.16 * smoothstep(0.22, 0.0, a) - 0.18 * smoothstep(0.15, 0.35, a) * smoothstep(0.6, 0.4, a)
                + 0.12 * smoothstep(0.4, 0.6, a) * smoothstep(0.95, 0.75, a);
  return clamp(0.5 + v + climate, 0.0, 1.0);
}

void main() {
  vec3 n = bakeDir();
  fragColor = vec4(cloudField(n, vec3(0.0)), cloudField(n, vec3(17.3, -9.1, 4.4)), 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Sky: galactic band, dust lanes and emission nebulae (HDR, linear).
// ---------------------------------------------------------------------------
export const SKY_FS = HEADER + /* glsl */ `
uniform vec3 uGalNormal;
uniform vec3 uGalCenter;
uniform vec4 uNebula[3];     // xyz = direction, w = angular size
uniform vec3 uNebColA[3];
uniform vec3 uNebColB[3];
uniform float uGalBright;

void main() {
  vec3 d = bakeDir();
  vec3 col = vec3(0.0);

  // Galactic band.
  float b = dot(d, uGalNormal);
  float towardCore = dot(d, uGalCenter) * 0.5 + 0.5;
  float width = mix(0.09, 0.2, pow(towardCore, 3.0));
  float band = exp(-b * b / (width * width));
  float glow = exp(-b * b / (width * width * 9.0));
  float stars = 0.5 + 0.9 * fbm(d * 14.0, 6);
  float clumps = pow(max(fbm(d * 5.0 + 3.0, 6) + 0.5, 0.0), 2.5);
  float dust = smoothstep(-0.05, 0.35, fbm(d * vec3(9.0) + vec3(2.0, 8.0, 1.0), 7) + 0.25 * (1.0 - abs(b) / width));
  vec3 coreCol = vec3(1.0, 0.78, 0.55);
  vec3 armCol = vec3(0.62, 0.72, 1.0);
  vec3 gcol = mix(armCol, coreCol, pow(towardCore, 2.0));
  float core = pow(towardCore, 6.0);
  float g = band * (0.35 + clumps * 1.2) * stars * (1.0 - 0.85 * dust * band) + glow * 0.12;
  g *= 0.6 + 2.4 * core;
  col += gcol * g * uGalBright;

  // Emission and reflection nebulae.
  for (int i = 0; i < 3; i++) {
    vec4 nb = uNebula[i];
    if (nb.w <= 0.0) continue;
    float ang = acos(clamp(dot(d, nb.xyz), -1.0, 1.0));
    float fall = exp(-pow(ang / nb.w, 2.0));
    if (fall < 0.002) continue;
    vec3 p = d * (3.0 / nb.w) + float(i) * 13.7;
    vec3 w = fbm3(p * 0.6, 5);
    float f = fbm(p + w * 1.6, 7);
    float f2 = fbm(p * 2.0 - w * 2.4 + 5.0, 6);
    float fil = pow(clamp(0.55 + f, 0.0, 1.0), 3.5);
    float wisp = pow(clamp(0.5 + f2, 0.0, 1.0), 4.0);
    float dark = smoothstep(0.1, 0.45, fbm(p * 1.4 + 20.0, 5));
    vec3 c = mix(uNebColA[i], uNebColB[i], clamp(wisp * 1.5, 0.0, 1.0));
    col += c * (fil * 1.4 + wisp * 0.8) * fall * (1.0 - dark * 0.75);
  }

  // Very faint diffuse background so black is never perfectly flat.
  col += vec3(0.0025, 0.003, 0.005) * (0.6 + 0.4 * fbm(d * 3.0, 3));
  fragColor = vec4(col, 1.0);
}
`;
