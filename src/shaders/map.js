// Equirectangular shaded-relief map of the current world, for the atlas plate.

import { NOISE } from './noise.js';
import { SURFACE } from './surface.js';

export const MAP_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp samplerCube;
in vec2 vUv;
out vec4 fragColor;
const float PI = 3.14159265359;
${NOISE}
${SURFACE}
uniform samplerCube uClouds;
uniform float uCloudCover;
uniform float uShowClouds;
uniform vec2 uMapRes;

vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  float lon = (vUv.x - 0.5) * 2.0 * PI;
  float lat = (vUv.y - 0.5) * PI;
  vec3 q = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
  float foot = 2.0 * PI / uMapRes.x;
  Surface s = surfaceAt(q, foot);
  vec3 east = vec3(cos(lon), 0.0, -sin(lon));
  vec3 north = vec3(-sin(lat) * sin(lon), cos(lat), -sin(lat) * cos(lon));
  vec3 L = normalize(q * 0.55 + north * 0.6 - east * 0.6);
  float shade = clamp(dot(s.normal, L) / max(dot(q, L), 0.1), 0.35, 1.8);
  vec3 c = s.albedo * mix(1.0, shade, 1.0 - s.water * 0.8);
  c += s.emission * 0.25;
  if (uShowClouds > 0.5) {
    vec2 cl = texture(uClouds, q).rg;
    float lo = (1.0 - uCloudCover) * 0.9 + 0.15;
    float a = smoothstep(lo, lo + 0.22, cl.r) * 0.85;
    c = mix(c, vec3(0.9), a);
  }
  c *= 1.9;
  c = c / (1.0 + c * 0.6);
  fragColor = vec4(toSrgb(c), 1.0);
}
`;
