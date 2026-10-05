// The real-time scene: one fullscreen pass that ray-traces the planet, its
// cloud shell, atmosphere, rings and moons against a baked sky.

import { NOISE } from './noise.js';
import { SURFACE } from './surface.js';

export const SCENE_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp samplerCube;
in vec2 vUv;
out vec4 fragColor;
const float PI = 3.14159265359;
${NOISE}
${SURFACE}

uniform vec2 uRes;
uniform vec3 uCamPos;
uniform mat3 uCamBasis;
uniform float uTanFov;
uniform float uPixelAngle;
uniform vec2 uShift;

uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunI;
uniform float uSunSize;

uniform mat3 uPlanetRot;
uniform samplerCube uClouds;
uniform samplerCube uSky;
uniform sampler2D uRingTex;

uniform float uCloudCover;
uniform float uCloudAlt;
uniform vec3 uCloudCol;
uniform float uCloudOn;
uniform float uCloudTime;

uniform float uAtmoOn;
uniform float uAtmoH;
uniform vec3 uBetaR;
uniform vec3 uBetaM;
uniform vec3 uBetaA;
uniform float uMieG;
uniform vec3 uAurora;
uniform float uAuroraOn;

uniform float uRingOn;
uniform vec2 uRingRad;

uniform int uMoonCount;
uniform vec4 uMoon[3];
uniform vec3 uMoonCol[3];
uniform vec3 uMoonCol2[3];

uniform float uVis;
uniform float uStarBright;
uniform int uDebug;

const float HR = 0.2;
const float HM = 0.07;

vec2 raySphere(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float cc = dot(oc, oc) - r * r;
  float h = b * b - cc;
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

// ---------------------------------------------------------------- atmosphere
// Schüler's approximation of the Chapman grazing-incidence function.
float chapman(float X, float h, float mu) {
  float c = sqrt(X + h);
  if (mu >= 0.0) return c / (c * mu + 1.0) * exp(-h);
  float x0 = sqrt(1.0 - mu * mu) * (X + h);
  float c0 = sqrt(x0);
  return 2.0 * c0 * exp(X - x0) - c / (1.0 - c * mu) * exp(-h);
}

vec2 opticalDepth(float r, float mu) {
  float hr = HR * uAtmoH, hm = HM * uAtmoH;
  float alt = max(r - 1.0, 0.0);
  return vec2(hr * chapman(1.0 / hr, alt / hr, mu), hm * chapman(1.0 / hm, alt / hm, mu));
}

vec3 extinction(vec2 od) {
  return (uBetaR + uBetaA) * od.x + uBetaM * 1.11 * od.y;
}

vec2 density(float r) {
  float h = max(r - 1.0, 0.0) / uAtmoH;
  return vec2(exp(-h / HR), exp(-h / HM));
}

// Sunlight reaching point p: planet umbra plus atmospheric extinction.
vec3 sunTrans(vec3 p) {
  float r = length(p);
  float tca = dot(p, uSunDir);
  float d2 = r * r - tca * tca;
  float soft = uAtmoOn > 0.5 ? 0.004 : 0.0015;
  float lit = tca > 0.0 ? 1.0 : smoothstep(1.0 - soft, 1.0 + soft, sqrt(max(d2, 0.0)));
  if (lit <= 0.0) return vec3(0.0);
  if (uAtmoOn < 0.5) return vec3(lit);
  float mu = tca / r;
  mu = max(mu, -sqrt(max(1.0 - 1.0 / (r * r), 0.0)) + 1e-4);
  return exp(-extinction(opticalDepth(r, mu))) * lit;
}

vec3 inscatter(vec3 ro, vec3 rd, float t0, float t1, out vec3 trans) {
  const int STEPS = 18;
  float ds = (t1 - t0) / float(STEPS);
  vec2 odv = vec2(0.0);
  vec3 sR = vec3(0.0), sM = vec3(0.0);
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * (t0 + ds * (float(i) + 0.5));
    vec2 dn = density(length(p)) * ds;
    odv += dn * 0.5;
    vec3 att = exp(-extinction(odv)) * sunTrans(p);
    odv += dn * 0.5;
    sR += att * dn.x;
    sM += att * dn.y;
  }
  trans = exp(-extinction(odv));
  float mu = dot(rd, uSunDir);
  float pr = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g = uMieG;
  float pm = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  return PI * uSunI * uSunColor * (sR * uBetaR * pr + sM * uBetaM * pm);
}

// Polar aurora: emissive curtains in a thin shell, sampled along the view ray.
vec3 aurora(vec3 ro, vec3 rd, float t0, float t1) {
  vec3 acc = vec3(0.0);
  const int N = 12;
  float ds = (t1 - t0) / float(N);
  for (int i = 0; i < N; i++) {
    vec3 p = ro + rd * (t0 + ds * (float(i) + 0.5));
    float r = length(p);
    float h = (r - 1.0) / uAtmoH;
    if (h < 0.15 || h > 0.9) continue;
    vec3 q = transpose(uPlanetRot) * (p / r);
    float colat = acos(abs(q.y));
    float ring = exp(-pow((colat - 0.36 - 0.04 * gnoise(vec3(q.xz * 3.0, 1.0))) / 0.035, 2.0));
    if (ring < 0.01) continue;
    float lon = atan(q.z, q.x);
    float curtain = 0.5 + 0.5 * sin(lon * 23.0 + gnoise(vec3(lon * 3.0, colat * 8.0, uTime * 0.08)) * 7.0 + uTime * 0.15);
    curtain = pow(curtain, 4.0) * (0.5 + 0.5 * gnoise(vec3(lon * 40.0, h * 2.0, uTime * 0.25)) + 0.5);
    float vert = smoothstep(0.15, 0.3, h) * smoothstep(0.9, 0.45, h);
    vec3 col = mix(uAurora, vec3(0.75, 0.2, 0.9), smoothstep(0.45, 0.85, h));
    float night = smoothstep(0.1, -0.15, dot(p / r, uSunDir));
    acc += col * curtain * ring * vert * night * ds;
  }
  return acc * 9.0 * uAuroraOn;
}

// ---------------------------------------------------------------- sky
vec3 starColor(float t) {
  vec3 cool = vec3(1.0, 0.62, 0.38);
  vec3 sun = vec3(1.0, 0.92, 0.82);
  vec3 hot = vec3(0.66, 0.78, 1.0);
  return t < 0.5 ? mix(cool, sun, t * 2.0) : mix(sun, hot, t * 2.0 - 1.0);
}

vec3 starLayer(vec3 d, float cells, float prob, float bright, int layer) {
  vec3 a = abs(d);
  vec2 uv;
  int face;
  if (a.x >= a.y && a.x >= a.z) { uv = d.yz / a.x; face = d.x > 0.0 ? 0 : 1; }
  else if (a.y >= a.z) { uv = d.xz / a.y; face = d.y > 0.0 ? 2 : 3; }
  else { uv = d.xy / a.z; face = d.z > 0.0 ? 4 : 5; }
  vec2 g = uv * cells;
  ivec2 c = ivec2(floor(g));
  vec2 f = fract(g);
  vec3 h = uhash33(ivec3(c, face * 131 + layer * 977));
  if (h.z > prob) return vec3(0.0);
  vec2 sp = 0.2 + 0.6 * h.xy;
  float angDist = length(f - sp) / cells / (1.0 + 0.5 * dot(uv, uv));
  float sigma = uPixelAngle * 0.8;
  float m = h.z / prob;
  float mag = pow(1.0 - m, 6.0) * 6.0 + 0.15;
  float k = exp(-angDist * angDist / (2.0 * sigma * sigma));
  float t = fract(h.x * 13.7 + h.y * 7.1);
  return starColor(t) * mag * k * bright;
}

vec3 background(vec3 rd) {
  vec3 col = texture(uSky, rd).rgb;
  vec3 st = starLayer(rd, 60.0, 0.012, 2.2, 0)
          + starLayer(rd, 150.0, 0.014, 0.7, 1)
          + starLayer(rd, 380.0, 0.012, 0.28, 2);
  col += st * uStarBright;
  float mu = dot(rd, uSunDir);
  float cosR = cos(uSunSize);
  float disc = smoothstep(cosR - uPixelAngle * uSunSize * 2.0, cosR, mu);
  float ang = acos(clamp(mu, -1.0, 1.0));
  float corona = exp(-ang / (uSunSize * 1.4)) * 2.5 + exp(-ang / (uSunSize * 8.0)) * 0.25 + exp(-ang * 2.5) * 0.015;
  col += uSunColor * (disc * 220.0 + corona);
  return col;
}

// ---------------------------------------------------------------- clouds
float cloudSample(vec3 q, float lod) {
  vec3 qa = rotY(q, uCloudTime * 0.012);
  vec2 c = textureLod(uClouds, qa, lod).rg;
  float m = 0.5 + 0.5 * sin(uCloudTime * 0.035);
  return mix(c.r, c.g, m);
}

float cloudAlpha(float dens, float fine) {
  float cov = 1.0 - uCloudCover;
  float lo = cov * 0.9 + 0.15;
  float a = smoothstep(lo, lo + 0.2, dens + fine * 0.06);
  return a * uCloudOn;
}

// ---------------------------------------------------------------- rings
vec4 ringSample(float u, vec2 du) {
  return textureGrad(uRingTex, vec2(u, 0.5), vec2(du.x, 0.0), vec2(du.y, 0.0));
}

float ringShadow(vec3 p, vec3 axis) {
  if (uRingOn < 0.5) return 1.0;
  float dn = dot(uSunDir, axis);
  if (abs(dn) < 1e-4) return 1.0;
  float t = -dot(p, axis) / dn;
  if (t <= 0.0) return 1.0;
  float r = length(p + uSunDir * t);
  float u = (r - uRingRad.x) / (uRingRad.y - uRingRad.x);
  if (u < 0.0 || u > 1.0) return 1.0;
  return 1.0 - textureLod(uRingTex, vec2(u, 0.5), 3.0).a * 0.85;
}

// ---------------------------------------------------------------- moons
float moonShadow(vec3 p) {
  float s = 1.0;
  for (int i = 0; i < 3; i++) {
    if (i >= uMoonCount) break;
    vec3 c = uMoon[i].xyz;
    float r = uMoon[i].w;
    vec3 oc = c - p;
    float t = dot(oc, uSunDir);
    if (t <= 0.0) continue;
    float d = length(oc - uSunDir * t);
    float pen = r * 0.25 + t * uSunSize;
    s *= mix(0.08, 1.0, smoothstep(r - pen, r + pen, d));
  }
  return s;
}

vec4 moonHeight(vec3 q, float seed) {
  // Gradient noise relief plus one analytic crater layer.
  vec3 o = vec3(seed * 17.0, seed * 31.0, seed * 7.0);
  vec4 n = noised(q * 3.0 + o) * 0.5 + noised(q * 7.0 + o) * 0.25 + noised(q * 15.0 + o) * 0.12;
  vec4 h = vec4(n.x * 0.04, n.yzw * 0.04 * vec3(3.0));
  ivec3 cell = ivec3(floor(q * 5.0 + o));
  vec3 f = fract(q * 5.0 + o);
  for (int k = -1; k <= 1; k++)
  for (int j = -1; j <= 1; j++)
  for (int l = -1; l <= 1; l++) {
    ivec3 off = ivec3(l, j, k);
    vec3 rnd = uhash33(cell + off);
    if (rnd.z > 0.55) continue;
    vec3 rv = vec3(off) + rnd - f;
    float rad = 0.2 + 0.25 * fract(rnd.z * 9.7);
    float d = length(rv) / rad;
    if (d > 1.6) continue;
    float bowl = d < 1.0 ? (d * d - 1.0) : 0.0;
    float dbowl = d < 1.0 ? 2.0 * d : 0.0;
    float rim = 0.3 * exp(-pow((d - 1.0) * 3.0, 2.0));
    float drim = rim * (-2.0 * 9.0 * (d - 1.0));
    float amp = 0.05 * rad;
    vec3 dd = -rv / max(length(rv), 1e-4) / rad * 5.0;
    h.x += (bowl + rim) * amp;
    h.yzw += (dbowl + drim) * amp * dd;
  }
  return h;
}

vec3 shadeMoon(int i, vec3 P, vec3 rd) {
  vec3 c = uMoon[i].xyz;
  float r = uMoon[i].w;
  vec3 n0 = normalize(P - c);
  // Tidally locked frame: one face always toward the planet.
  vec3 fz = normalize(-c);
  vec3 fx = normalize(cross(vec3(0.0, 1.0, 0.0), fz));
  vec3 fy = cross(fz, fx);
  vec3 q = vec3(dot(n0, fx), dot(n0, fy), dot(n0, fz));
  float seed = float(i) * 3.17 + 1.0;
  vec4 h = moonHeight(q, seed);
  vec3 g = h.yzw - q * dot(h.yzw, q);
  vec3 nl = normalize(q - g * 1.2);
  vec3 n = normalize(nl.x * fx + nl.y * fy + nl.z * fz);
  float maria = smoothstep(0.0, 0.25, fbm(q * 2.0 + seed, 3));
  vec3 alb = mix(uMoonCol[i], uMoonCol2[i], maria);
  alb *= 0.85 + 0.3 * (fbm(q * 9.0 + seed * 3.0, 3) + 0.5);
  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 light = sunTrans(P) * uSunI * uSunColor;
  // A faint red glow inside the umbra when the planet has air.
  if (uAtmoOn > 0.5 && dot(P, uSunDir) < 0.0) {
    float d = length(P - uSunDir * dot(P, uSunDir));
    light += uSunColor * vec3(0.9, 0.25, 0.08) * 0.08 * smoothstep(0.4, 1.0, d) * uSunI;
  }
  // Planetshine on the night side.
  float ps = max(dot(n, normalize(-c)), 0.0) * max(dot(normalize(c), uSunDir) * -0.5 + 0.5, 0.0);
  return alb * (light * ndl * moonShadow(P + n * 0.001) + uSunI * 0.004 * ps + 0.0015);
}

// ---------------------------------------------------------------- main
void main() {
  vec2 ndc = vUv * 2.0 - 1.0 - uShift;
  float aspect = uRes.x / uRes.y;
  vec3 ro = uCamPos;
  vec3 rd = normalize(uCamBasis * vec3(ndc.x * uTanFov * aspect, ndc.y * uTanFov, 1.0));
  vec3 axis = uPlanetRot * vec3(0.0, 1.0, 0.0);
  mat3 toLocal = transpose(uPlanetRot);

  vec3 bg = background(rd);
  vec3 col = bg;

  // Ring plane intersection (computed in uniform control flow for derivatives).
  float dn = dot(rd, axis);
  float tRing = abs(dn) > 1e-6 ? -dot(ro, axis) / dn : -1.0;
  vec3 hpRing = ro + rd * max(tRing, 0.0);
  float rRing = length(hpRing);
  float uR = (rRing - uRingRad.x) / max(uRingRad.y - uRingRad.x, 1e-3);
  vec2 duR = vec2(dFdx(uR), dFdy(uR));
  duR = clamp(duR, vec2(-0.25), vec2(0.25));
  vec4 rs = ringSample(clamp(uR, 0.0, 1.0), duR);
  bool ringHit = uRingOn > 0.5 && tRing > 0.0 && uR >= 0.0 && uR <= 1.0;

  // Nearest opaque hit: planet or a moon.
  vec2 tp = raySphere(ro, rd, vec3(0.0), 1.0);
  float tHit = 1e9;
  int hitId = -1;
  if (tp.x > 0.0) { tHit = tp.x; hitId = 0; }
  for (int i = 0; i < 3; i++) {
    if (i >= uMoonCount) break;
    vec2 tm = raySphere(ro, rd, uMoon[i].xyz, uMoon[i].w);
    if (tm.x > 0.0 && tm.x < tHit) { tHit = tm.x; hitId = i + 1; }
  }

  // Ring behind the hit point is hidden; ring behind nothing sits on the sky.
  if (ringHit && tRing > tHit) ringHit = false;

  vec3 ringCol = vec3(0.0);
  float ringA = 0.0;
  if (ringHit) {
    float a = rs.a;
    float lit = sign(dot(uSunDir, axis)) * sign(dot(-rd, axis));
    float muS = abs(dot(uSunDir, axis));
    vec3 L = sunTrans(hpRing) * uSunI * uSunColor * moonShadow(hpRing);
    float fwd = pow(max(dot(rd, uSunDir), 0.0), 6.0);
    float front = (0.25 + 0.75 * muS) * 0.9;
    float back = (1.0 - a) * 2.2 * muS + fwd * 1.5;
    float lighting = lit > 0.0 ? front : back * 0.6;
    vec3 rc = rs.rgb * rs.rgb;
    ringCol = rc * L * lighting * 0.55 + rc * uSunI * 0.004;
    ringA = a;
  }

  vec3 surf = bg;
  if (hitId == 0) {
    vec3 P = ro + rd * tHit;
    vec3 Nw = P;
    vec3 q = toLocal * P;
    float footprint = uPixelAngle * tHit / max(abs(dot(rd, Nw)), 0.25);
    Surface s = surfaceAt(q, uPixelAngle * tHit);
    vec3 N = uPlanetRot * s.normal;
    vec3 V = -rd;

    float cs = 1.0;
    if (uCloudOn > 0.5) {
      float mu = max(dot(Nw, uSunDir), 0.05);
      vec3 sp = normalize(P + uSunDir * (uCloudAlt / mu));
      float d = cloudSample(toLocal * sp, 2.0);
      cs = 1.0 - cloudAlpha(d, 0.0) * 0.65;
    }
    vec3 Lsun = sunTrans(P * 1.0005) * uSunI * uSunColor * ringShadow(P, axis) * moonShadow(P) * cs;
    float ndl = max(dot(N, uSunDir), 0.0);
    float term = smoothstep(-0.02, 0.08, dot(Nw, uSunDir));
    ndl *= mix(1.0, term, 0.6);

    vec3 skyTint = uAtmoOn > 0.5 ? normalize(uBetaR + 1e-4) : vec3(0.0);
    float dayAmt = smoothstep(-0.2, 0.5, dot(Nw, uSunDir));
    vec3 ambient = uSunI * uSunColor * skyTint * 0.035 * dayAmt * (0.6 + 0.4 * dot(N, Nw)) + vec3(0.0012, 0.0014, 0.002);

    vec3 c = s.albedo * (Lsun * ndl + ambient);

    // Ocean: GGX glint and a Fresnel sky reflection.
    if (s.water > 0.0) {
      vec3 Nwat = N;
      float wave = clamp(1.0 - footprint * 300.0, 0.0, 1.0);
      if (wave > 0.0) {
        vec3 wq = q * 900.0 + vec3(uTime * 0.6, 0.0, uTime * 0.4);
        vec4 w1 = noised(wq);
        vec4 w2 = noised(wq * 2.3 + vec3(0.0, uTime * 0.8, 0.0));
        vec3 g = (w1.yzw + w2.yzw * 0.5);
        g -= Nw * dot(g, Nw);
        Nwat = normalize(N - g * 0.06 * wave);
      }
      float rough = mix(0.22, s.rough, wave);
      vec3 H = normalize(uSunDir + V);
      float nh = max(dot(Nwat, H), 0.0);
      float a2 = rough * rough * rough * rough;
      float dd = nh * nh * (a2 - 1.0) + 1.0;
      float D = a2 / (PI * dd * dd);
      float nv = max(dot(Nwat, V), 1e-3);
      float F = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
      float ndlw = max(dot(Nwat, uSunDir), 0.0);
      float k = rough * 0.5 + 0.02;
      float G = (ndlw / (ndlw * (1.0 - k) + k)) * (nv / (nv * (1.0 - k) + k));
      float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
      vec3 spec = Lsun * D * G * Fs / (4.0 * nv + 1e-3);
      vec3 skyRef = uSunI * uSunColor * skyTint * 0.06 * dayAmt;
      c = mix(c, skyRef, F * s.water);
      c += spec * s.water;
    }

    float night = 1.0 - smoothstep(-0.12, 0.04, dot(Nw, uSunDir));
    c += s.night * night * 1.6;
    c += s.emission;
    surf = c;
    if (uDebug == 1) { fragColor = vec4(s.night, 1.0); return; }
    if (uDebug == 2) { fragColor = vec4(textureLod(uTerrain, q, 0.0).zzz, 1.0); return; }
    if (uDebug == 3) { fragColor = vec4(s.albedo, 1.0); return; }
  } else if (hitId > 0) {
    surf = shadeMoon(hitId - 1, ro + rd * tHit, rd);
  }

  // Ring behind the planet's limb but in front of the sky.
  if (ringHit && hitId < 0) {
    surf = mix(surf, ringCol, ringA);
    ringHit = false;
  }

  // Cloud shell (front intersection).
  if (uCloudOn > 0.5) {
    vec2 tc = raySphere(ro, rd, vec3(0.0), 1.0 + uCloudAlt);
    if (tc.x > 0.0 && tc.x < tHit) {
      vec3 C = ro + rd * tc.x;
      vec3 Cn = normalize(C);
      vec3 cq = toLocal * Cn;
      float foot = uPixelAngle * tc.x;
      float lodC = max(log2(max(foot * uTexSize * 0.64, 1.0)), 0.0);
      float d = cloudSample(cq, lodC);
      float fine = 0.0;
      if (foot < 0.004) fine = fbm(cq * 260.0 + uCloudTime * 0.01, 3) * smoothstep(0.004, 0.001, foot);
      float a = cloudAlpha(d, fine);
      // Grazing views look through more cloud.
      float mu = abs(dot(Cn, rd));
      a = 1.0 - pow(1.0 - a, 1.0 / max(mu, 0.18));
      if (hitId != 0) {
        // Limb: the far side of the shell would be behind the planet; only front.
        a *= smoothstep(0.0, 0.02, tc.y - tc.x);
      }
      if (a > 0.001) {
        vec3 sp = normalize(Cn + uSunDir * 0.012);
        float ds = cloudSample(toLocal * sp, lodC + 1.0);
        float self = exp(-max(ds - (1.0 - uCloudCover) * 0.9 - 0.15, 0.0) * 3.0);
        float ndl = dot(Cn, uSunDir);
        float thick = smoothstep(0.0, 0.35, d - (1.0 - uCloudCover) * 0.9 - 0.15);
        float light = smoothstep(-0.1, 0.12, ndl) * (0.22 + 0.78 * max(ndl, 0.0)) * (0.6 + 0.4 * self);
        light *= 0.8 + 0.35 * thick;
        vec3 Lc = sunTrans(C) * uSunI * uSunColor * ringShadow(C, axis) * moonShadow(C);
        float fwd = pow(max(dot(rd, uSunDir), 0.0), 8.0) * (1.0 - a) * 2.0;
        vec3 skyTint = uAtmoOn > 0.5 ? normalize(uBetaR + 1e-4) : vec3(0.0);
        vec3 amb = uSunI * uSunColor * skyTint * 0.05 * smoothstep(-0.2, 0.4, ndl) + vec3(0.001);
        vec3 cc = uCloudCol * (Lc * (light * 0.9 + fwd) + amb);
        surf = mix(surf, cc, a);
      }
    }
  }

  col = surf;

  // Atmosphere along the ray, up to the first opaque hit.
  if (uAtmoOn > 0.5) {
    float Ra = 1.0 + uAtmoH;
    vec2 ta = raySphere(ro, rd, vec3(0.0), Ra);
    if (ta.y > 0.0) {
      float t0 = max(ta.x, 0.0);
      float t1 = min(ta.y, tHit);
      if (t1 > t0) {
        vec3 trans;
        vec3 ins = inscatter(ro, rd, t0, t1, trans);
        col = col * trans + ins;
        if (uAuroraOn > 0.0) col += aurora(ro, rd, t0, t1);
      }
    }
  }

  // Ring in front of everything else.
  if (ringHit) col = mix(col, ringCol, ringA);

  col = mix(bg, col, uVis);
  fragColor = vec4(max(col, 0.0), 1.0);
}
`;
