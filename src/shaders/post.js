// Post-processing: physically-based bloom (13-tap down / tent up), lens
// flare, warp streaks, ACES tonemapping, vignette and grain.

const HEAD = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
`;

export const DOWN_FS = HEAD + /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform bool uKaris;

vec3 s(vec2 o) { return texture(uSrc, vUv + o * uTexel).rgb; }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 karis(vec3 a, vec3 b, vec3 c, vec3 d) {
  vec4 w = 1.0 / (1.0 + vec4(luma(a), luma(b), luma(c), luma(d)));
  return (a * w.x + b * w.y + c * w.z + d * w.w) / (w.x + w.y + w.z + w.w);
}

void main() {
  vec3 a = s(vec2(-2.0, 2.0)), b = s(vec2(0.0, 2.0)), c = s(vec2(2.0, 2.0));
  vec3 d = s(vec2(-2.0, 0.0)), e = s(vec2(0.0, 0.0)), f = s(vec2(2.0, 0.0));
  vec3 g = s(vec2(-2.0, -2.0)), h = s(vec2(0.0, -2.0)), i = s(vec2(2.0, -2.0));
  vec3 j = s(vec2(-1.0, 1.0)), k = s(vec2(1.0, 1.0)), l = s(vec2(-1.0, -1.0)), m = s(vec2(1.0, -1.0));
  vec3 o;
  if (uKaris) {
    o = karis(j, k, l, m) * 0.5
      + karis(a, b, d, e) * 0.125 + karis(b, c, e, f) * 0.125
      + karis(d, e, g, h) * 0.125 + karis(e, f, h, i) * 0.125;
  } else {
    o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  fragColor = vec4(max(o, 0.0), 1.0);
}
`;

export const UP_FS = HEAD + /* glsl */ `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uRadius;
void main() {
  vec2 r = uTexel * uRadius;
  vec3 o = texture(uSrc, vUv).rgb * 4.0;
  o += (texture(uSrc, vUv + vec2(-r.x, 0.0)).rgb + texture(uSrc, vUv + vec2(r.x, 0.0)).rgb
      + texture(uSrc, vUv + vec2(0.0, -r.y)).rgb + texture(uSrc, vUv + vec2(0.0, r.y)).rgb) * 2.0;
  o += texture(uSrc, vUv + vec2(-r.x, -r.y)).rgb + texture(uSrc, vUv + vec2(r.x, -r.y)).rgb
     + texture(uSrc, vUv + vec2(-r.x, r.y)).rgb + texture(uSrc, vUv + vec2(r.x, r.y)).rgb;
  fragColor = vec4(o / 16.0, 1.0);
}
`;

export const COMPOSITE_FS = HEAD + /* glsl */ `
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uRes;
uniform float uBloomStrength;
uniform float uBloomNorm;
uniform float uExposure;
uniform float uWarp;
uniform float uFade;
uniform float uTime;
uniform vec2 uSunScreen;
uniform float uSunVis;
uniform vec3 uSunColor;
uniform float uFlare;
uniform vec3 uWhite;

const mat3 ACES_IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const mat3 ACES_OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);

vec3 rrt(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 c) { return clamp(ACES_OUT * rrt(ACES_IN * c), 0.0, 1.0); }

vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 sceneAt(vec2 uv) { return texture(uScene, uv).rgb; }

vec3 flare(vec2 uv) {
  if (uSunVis <= 0.001) return vec3(0.0);
  float aspect = uRes.x / uRes.y;
  vec2 sun = uSunScreen;
  vec2 toC = vec2(0.5) - sun;
  vec3 acc = vec3(0.0);
  float ks[6] = float[](0.35, 0.62, 0.9, 1.25, 1.55, 2.1);
  float rs[6] = float[](0.018, 0.045, 0.025, 0.08, 0.035, 0.12);
  vec3 cs[6] = vec3[](vec3(1.0, 0.6, 0.3), vec3(0.3, 0.7, 1.0), vec3(0.8, 1.0, 0.5),
                      vec3(0.5, 0.4, 1.0), vec3(1.0, 0.5, 0.7), vec3(0.3, 0.9, 0.8));
  for (int i = 0; i < 6; i++) {
    vec2 p = sun + toC * ks[i] * 2.0;
    vec2 d = (uv - p) * vec2(aspect, 1.0);
    float r = length(d);
    float disc = smoothstep(rs[i], rs[i] * 0.7, r) * 0.6 + exp(-r * r / (rs[i] * rs[i] * 0.3)) * 0.4;
    acc += cs[i] * disc * 0.035;
  }
  // Anamorphic streak and starburst at the sun.
  vec2 ds = (uv - sun) * vec2(aspect, 1.0);
  float streak = exp(-abs(ds.y) * 220.0) * exp(-abs(ds.x) * 2.2) * 0.5;
  float ang = atan(ds.y, ds.x);
  float rays = pow(abs(sin(ang * 6.0 + 0.4)), 40.0) * exp(-length(ds) * 7.0) * 0.6;
  acc += vec3(0.55, 0.7, 1.0) * streak + vec3(1.0, 0.9, 0.8) * rays;
  return acc * uSunColor * uSunVis * uFlare;
}

void main() {
  vec2 uv = vUv;
  vec2 fromC = uv - 0.5;
  float r2 = dot(fromC, fromC);

  // Lateral chromatic aberration, stronger at the edges and while warping.
  float ca = 0.0012 + uWarp * 0.012;
  vec3 col;
  col.r = sceneAt(uv - fromC * ca * r2 * 4.0).r;
  col.g = sceneAt(uv).g;
  col.b = sceneAt(uv + fromC * ca * r2 * 4.0).b;

  // Warp: radial streaks out of the vanishing point.
  if (uWarp > 0.001) {
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < 20; i++) {
      float t = float(i) / 19.0;
      float w = 1.0 - t * 0.7;
      acc += sceneAt(uv - fromC * t * uWarp * 0.55) * w;
      wsum += w;
    }
    col = mix(col, acc / wsum * (1.0 + uWarp * 2.5), smoothstep(0.0, 0.25, uWarp));
    col += vec3(0.35, 0.55, 1.0) * pow(uWarp, 3.0) * 0.8 * (1.0 - r2 * 2.0);
  }

  vec3 bloom = texture(uBloom, uv).rgb * uBloomNorm;
  col = mix(col, bloom, uBloomStrength);
  col += flare(uv);
  col *= uExposure * uWhite;

  col = aces(col);
  col = toSrgb(col);

  float vig = 1.0 - smoothstep(0.35, 1.25, length(fromC * vec2(uRes.x / uRes.y, 1.0)) * 1.15);
  col *= mix(0.72, 1.0, vig);

  float n = hash(gl_FragCoord.xy + fract(uTime) * 917.0);
  col += (n - 0.5) * (1.6 / 255.0) + (hash(gl_FragCoord.yx * 1.3 + uTime) - 0.5) * 0.012 * (1.0 - dot(col, vec3(0.33)));
  col *= uFade;
  fragColor = vec4(col, 1.0);
}
`;

// Simple textured copy used for previews and thumbnails.
export const COPY_FS = HEAD + /* glsl */ `
uniform sampler2D uSrc;
void main() { fragColor = texture(uSrc, vUv); }
`;
