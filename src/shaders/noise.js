// Shared GLSL: hashing, gradient noise (with analytic derivatives), fbm variants,
// cellular noise. Everything is seeded through `uSeed` so a world is a pure
// function of its seed.

export const NOISE = /* glsl */ `
uniform uint uSeed;

uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

vec3 hash33(ivec3 p) {
  uvec3 h = pcg3d(uvec3(p) + uSeed * uvec3(1u, 7u, 13u));
  return vec3(h) * (2.0 / 4294967295.0) - 1.0;
}

vec3 uhash33(ivec3 p) {
  uvec3 h = pcg3d(uvec3(p) + uSeed * uvec3(3u, 11u, 17u));
  return vec3(h) * (1.0 / 4294967295.0);
}

float hash13(ivec3 p) {
  return float(pcg3d(uvec3(p) + uSeed * uvec3(5u, 19u, 23u)).x) * (1.0 / 4294967295.0);
}

// Gradient noise with derivatives (value in .x, gradient in .yzw). After Inigo Quilez.
vec4 noised(vec3 x) {
  ivec3 i = ivec3(floor(x));
  vec3 f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);

  vec3 ga = hash33(i + ivec3(0, 0, 0));
  vec3 gb = hash33(i + ivec3(1, 0, 0));
  vec3 gc = hash33(i + ivec3(0, 1, 0));
  vec3 gd = hash33(i + ivec3(1, 1, 0));
  vec3 ge = hash33(i + ivec3(0, 0, 1));
  vec3 gf = hash33(i + ivec3(1, 0, 1));
  vec3 gg = hash33(i + ivec3(0, 1, 1));
  vec3 gh = hash33(i + ivec3(1, 1, 1));

  float va = dot(ga, f - vec3(0.0, 0.0, 0.0));
  float vb = dot(gb, f - vec3(1.0, 0.0, 0.0));
  float vc = dot(gc, f - vec3(0.0, 1.0, 0.0));
  float vd = dot(gd, f - vec3(1.0, 1.0, 0.0));
  float ve = dot(ge, f - vec3(0.0, 0.0, 1.0));
  float vf = dot(gf, f - vec3(1.0, 0.0, 1.0));
  float vg = dot(gg, f - vec3(0.0, 1.0, 1.0));
  float vh = dot(gh, f - vec3(1.0, 1.0, 1.0));

  float v = va + u.x * (vb - va) + u.y * (vc - va) + u.z * (ve - va)
          + u.x * u.y * (va - vb - vc + vd) + u.y * u.z * (va - vc - ve + vg)
          + u.z * u.x * (va - vb - ve + vf) + (-va + vb + vc - vd + ve - vf - vg + vh) * u.x * u.y * u.z;

  vec3 d = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.z * (ge - ga)
         + u.x * u.y * (ga - gb - gc + gd) + u.y * u.z * (ga - gc - ge + gg)
         + u.z * u.x * (ga - gb - ge + gf) + (-ga + gb + gc - gd + ge - gf - gg + gh) * u.x * u.y * u.z
         + du * (vec3(vb - va, vc - va, ve - va)
               + u.yzx * vec3(va - vb - vc + vd, va - vc - ve + vg, va - vb - ve + vf)
               + u.zxy * vec3(va - vb - ve + vf, va - vb - vc + vd, va - vc - ve + vg)
               + u.yzx * u.zxy * (-va + vb + vc - vd + ve - vf - vg + vh));
  return vec4(v, d);
}

// Gradient noise without derivatives (cheaper).
float gnoise(vec3 x) {
  ivec3 i = ivec3(floor(x));
  vec3 f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float va = dot(hash33(i + ivec3(0, 0, 0)), f - vec3(0.0, 0.0, 0.0));
  float vb = dot(hash33(i + ivec3(1, 0, 0)), f - vec3(1.0, 0.0, 0.0));
  float vc = dot(hash33(i + ivec3(0, 1, 0)), f - vec3(0.0, 1.0, 0.0));
  float vd = dot(hash33(i + ivec3(1, 1, 0)), f - vec3(1.0, 1.0, 0.0));
  float ve = dot(hash33(i + ivec3(0, 0, 1)), f - vec3(0.0, 0.0, 1.0));
  float vf = dot(hash33(i + ivec3(1, 0, 1)), f - vec3(1.0, 0.0, 1.0));
  float vg = dot(hash33(i + ivec3(0, 1, 1)), f - vec3(0.0, 1.0, 1.0));
  float vh = dot(hash33(i + ivec3(1, 1, 1)), f - vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y),
             mix(mix(ve, vf, u.x), mix(vg, vh, u.x), u.y), u.z);
}

float fbm(vec3 p, int oct) {
  float a = 0.0, b = 0.5;
  for (int i = 0; i < 12; i++) {
    if (i >= oct) break;
    a += b * gnoise(p);
    p = p * 2.03 + vec3(1.7, -9.2, 3.1);
    b *= 0.5;
  }
  return a;
}

vec3 fbm3(vec3 p, int oct) {
  return vec3(fbm(p, oct), fbm(p + vec3(31.4, 15.9, 26.5), oct), fbm(p + vec3(-47.1, 83.2, -12.8), oct));
}

// Derivative-damped fbm: slopes suppress further detail, which reads like erosion.
float erodedFbm(vec3 p, vec3 n, int oct, float gain) {
  float a = 0.0, b = 0.5, f = 1.0;
  vec3 d = vec3(0.0);
  for (int i = 0; i < 14; i++) {
    if (i >= oct) break;
    vec4 nz = noised(p * f);
    vec3 g = nz.yzw - n * dot(nz.yzw, n);
    d += g * b * f * 0.6;
    a += b * nz.x / (1.0 + dot(d, d));
    b *= gain;
    f *= 2.01;
  }
  return a;
}

// Ridged multifractal; each octave weighted by the previous one.
float ridged(vec3 p, int oct) {
  float sum = 0.0, amp = 0.5, prev = 1.0;
  for (int i = 0; i < 12; i++) {
    if (i >= oct) break;
    float n = 1.0 - abs(gnoise(p));
    n *= n;
    sum += n * amp * prev;
    prev = clamp(n * 1.6, 0.0, 1.0);
    p = p * 2.07 + vec3(4.1, 2.3, -7.7);
    amp *= 0.5;
  }
  return sum;
}

// Cellular noise: x = F1, y = F2, z = cell hash.
vec3 voronoi(vec3 x) {
  ivec3 i = ivec3(floor(x));
  vec3 f = fract(x);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int k = -1; k <= 1; k++)
  for (int j = -1; j <= 1; j++)
  for (int l = -1; l <= 1; l++) {
    ivec3 o = ivec3(l, j, k);
    vec3 r = vec3(o) + uhash33(i + o) - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = hash13(i + o); }
    else if (d < f2) { f2 = d; }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}
`;

// Cube face index + uv in [0,1] -> direction, matching GL's cubemap layout.
export const CUBE_DIR = /* glsl */ `
vec3 cubeDir(int face, vec2 uv) {
  vec2 c = uv * 2.0 - 1.0;
  vec3 d;
  if (face == 0) d = vec3(1.0, -c.y, -c.x);
  else if (face == 1) d = vec3(-1.0, -c.y, c.x);
  else if (face == 2) d = vec3(c.x, 1.0, c.y);
  else if (face == 3) d = vec3(c.x, -1.0, -c.y);
  else if (face == 4) d = vec3(c.x, -c.y, 1.0);
  else d = vec3(-c.x, -c.y, -1.0);
  return normalize(d);
}
`;
