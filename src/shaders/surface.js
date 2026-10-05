// Surface model shared by the real-time renderer and the atlas map: turns a
// baked terrain sample plus climate parameters into albedo, normal, water and
// emission.

export const SURFACE = /* glsl */ `
uniform samplerCube uTerrain;
uniform float uTexSize;
uniform int uStyle;          // 0 earthlike, 1 desert, 2 ice, 3 lava, 4 barren, 5 gas
uniform float uSea;          // sea level, elevation units
uniform float uLandRange;    // highest elevation - sea level
uniform float uSeaRange;     // sea level - lowest elevation
uniform float uRelief;
uniform float uTemp;         // climate offset, roughly -1 (frozen) .. +1 (scorched)
uniform float uMoist;        // humidity offset
uniform float uLiquid;       // 1 = liquid sea rendered, 0 = dry basins
uniform vec3 uDeep, uShallow, uSand, uLowWet, uLowDry, uHigh, uRock, uSnow;
uniform vec3 uEmit;
uniform float uCity;
uniform float uLava;
uniform float uIceSea;
uniform vec3 uGas[5];
uniform float uTime;

struct Surface {
  vec3 albedo;
  vec3 normal;     // planet-local
  float water;     // 1 = open water
  float rough;
  vec3 emission;   // always on (lava)
  vec3 night;      // only on the dark side (cities)
  float elev;      // 0..1 above sea level, negative below
};

vec3 gasRamp(float x) {
  x = clamp(x, 0.0, 1.0) * 4.0;
  int i = int(min(floor(x), 3.0));
  float f = x - float(i);
  vec3 a = uGas[0], b = uGas[1];
  if (i == 1) { a = uGas[1]; b = uGas[2]; }
  else if (i == 2) { a = uGas[2]; b = uGas[3]; }
  else if (i == 3) { a = uGas[3]; b = uGas[4]; }
  return mix(a, b, smoothstep(0.0, 1.0, f));
}

vec3 rotY(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

Surface surfaceAt(vec3 q, float footprint) {
  Surface s;
  s.emission = vec3(0.0);
  s.night = vec3(0.0);
  s.water = 0.0;
  s.rough = 0.85;

  float texel = 1.0 / (uTexSize * 0.64);
  float lod = max(log2(max(footprint / texel, 1e-4)), 0.0);
  float eps = texel * exp2(lod);
  vec3 up = abs(q.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t1 = normalize(cross(up, q));
  vec3 t2 = cross(q, t1);
  float detail = clamp(1.2 - footprint / texel, 0.0, 1.0);
  float lat = q.y;
  float alat = abs(lat);

  if (uStyle == 5) {
    // Gas giant: zonal flow. Two shear phases cross-fade so bands drift forever
    // without smearing.
    float jets = sin(lat * 23.0) * 0.6 + sin(lat * 9.0 + 1.3) * 0.4;
    float T = 60.0;
    float pa = fract(uTime / T);
    float pb = fract(uTime / T + 0.5);
    float wa = 1.0 - abs(2.0 * pa - 1.0);
    vec4 A = textureLod(uTerrain, rotY(q, jets * 0.07 * (pa - 0.5)), lod);
    vec4 B = textureLod(uTerrain, rotY(q, jets * 0.07 * (pb - 0.5)), lod);
    vec4 G = mix(B, A, wa);
    vec3 c = gasRamp(G.x);
    c *= 0.78 + 0.44 * G.y;
    c *= 0.92 + 0.16 * G.w;
    c = mix(c, uEmit * (0.7 + 0.6 * G.w) * (0.8 + 0.4 * G.y), G.z * 0.75);
    s.albedo = c;
    s.normal = q;
    s.rough = 1.0;
    s.elev = 0.0;
    return s;
  }

  vec4 T = textureLod(uTerrain, q, lod);
  float hx = textureLod(uTerrain, q + t1 * eps, lod).x;
  float hy = textureLod(uTerrain, q + t2 * eps, lod).x;
  float h = T.x;
  vec2 rawGrad = vec2(hx - h, hy - h) / eps;

  float hScale = 0.014 * uRelief / max(uLandRange, 1e-3);
  vec2 grad = rawGrad * hScale;

  // Procedural micro-relief once the camera outruns the texture resolution.
  float micro = 0.0;
  if (detail > 0.0) {
    vec3 dp = q * uTexSize * 1.6;
    vec4 n1 = noised(dp);
    vec4 n2 = noised(dp * 2.9 + 7.0);
    vec4 n3 = noised(dp * 8.3 - 3.0);
    vec3 g = n1.yzw + n2.yzw * 0.45 + n3.yzw * 0.2;
    micro = (n1.x + n2.x * 0.35 + n3.x * 0.12) * detail;
    float amp = 0.0045 * uRelief * detail * (uStyle == 4 ? 1.6 : 1.0);
    grad += vec2(dot(g, t1), dot(g, t2)) * amp;
    h += micro * texel * 3.0 * max(uLandRange, 0.05);
  }

  float eLin = (h - uSea) / max(uLandRange, 1e-3);
  // Most land is lowland: compress the elevation distribution toward sea level.
  float e = eLin > 0.0 ? pow(eLin, 1.7) : eLin;
  // Mid-frequency patchiness so biome borders stay fractal up close.
  float patchy = 0.0;
  if (detail > 0.0) patchy = fbm(q * uTexSize * 0.45, 5) * detail;
  float dep = (uSea - h) / max(uSeaRange, 1e-3);
  float aa = length(rawGrad) * footprint * 0.8 + 1e-5;
  float land = smoothstep(-aa, aa, h - uSea);
  float slope = length(grad);
  s.elev = e;

  // Climate: insolation falls toward the poles and with altitude; Hadley-cell
  // moisture bands give wet tropics, dry subtropics and temperate storm belts.
  float temp = 1.0 - pow(alat, 1.35) * 1.15 - max(e, 0.0) * 0.85 + uTemp * 0.7 + (T.y - 0.5) * 0.12;
  float hadley = 0.55 * smoothstep(0.32, 0.0, alat)
               - 0.55 * smoothstep(0.18, 0.42, alat) * smoothstep(0.66, 0.42, alat)
               + 0.25 * smoothstep(0.45, 0.7, alat) * smoothstep(0.98, 0.75, alat);
  float moist = clamp(T.y + hadley * 0.55 + uMoist - 0.05 + patchy * 0.35, 0.0, 1.0);
  float rockMask = clamp(T.w * 0.9 + smoothstep(0.35, 0.9, slope), 0.0, 1.0);
  float vary = T.y * 2.0 - 1.0 + patchy * 0.8;

  vec3 landCol;
  if (uStyle == 0) {
    // Arid ground varies between sand, ochre and bare rock.
    vec3 dry = mix(uLowDry, mix(uHigh, uRock, 0.5), smoothstep(0.1, 0.9, T.w * 0.6 + 0.5 + vary * 0.35) * 0.55);
    dry *= 0.86 + 0.28 * smoothstep(-0.6, 0.6, vary);
    vec3 veg = mix(dry, uLowWet * (0.85 + 0.3 * smoothstep(-0.5, 0.5, vary)), smoothstep(0.26, 0.5, moist));
    vec3 tundra = mix(uHigh, uLowDry, 0.35);
    veg = mix(veg, tundra, smoothstep(0.38, 0.12, temp));
    landCol = mix(veg, uHigh, smoothstep(0.22, 0.62, e + vary * 0.06));
    landCol = mix(landCol, uRock, rockMask * smoothstep(0.05, 0.35, e));
    if (uLiquid > 0.5) landCol = mix(uSand, landCol, smoothstep(0.001, 0.008, eLin + micro * 0.004));
    float snow = smoothstep(0.1, 0.0, temp + slope * 0.06 - micro * 0.03);
    landCol = mix(landCol, uSnow, snow);
    // Cities: temperate, fairly low, not frozen, not desert.
    float hab = smoothstep(0.08, 0.3, temp) * smoothstep(0.9, 0.55, temp) * smoothstep(0.55, 0.15, e) * smoothstep(0.15, 0.35, moist);
    float coast = smoothstep(0.25, 0.0, e) * 0.6 + 0.4;
    s.night = uEmit * T.z * hab * coast * land * uCity;
  } else if (uStyle == 1) {
    float dunes = 0.0;
    if (detail > 0.0) {
      vec3 dp = q * uTexSize * 0.9;
      float w = fbm(dp * 0.25, 3);
      dunes = sin(dot(dp, vec3(0.8, 0.3, 0.5)) * 3.0 + w * 6.0) * T.z * detail;
      grad += vec2(dot(vec3(0.8, 0.3, 0.5), t1), dot(vec3(0.8, 0.3, 0.5), t2)) * cos(dot(dp, vec3(0.8, 0.3, 0.5)) * 3.0 + w * 6.0) * 0.02 * T.z * detail;
    }
    vec3 base = mix(uLowDry, uSand, T.z * 0.8 + dunes * 0.05);
    base = mix(base, uLowWet, smoothstep(0.55, 0.85, moist) * 0.6);
    landCol = mix(base, uHigh, smoothstep(0.3, 0.75, e + vary * 0.08));
    landCol = mix(landCol, uRock, rockMask * 0.85);
    landCol *= 0.92 + 0.16 * vary;
    landCol = mix(landCol, uSnow, smoothstep(0.06, -0.04, temp) * smoothstep(0.78, 0.86, alat));
    if (uLiquid > 0.5) landCol = mix(uSand * 1.1, landCol, smoothstep(0.003, 0.02, eLin));
  } else if (uStyle == 2) {
    vec3 ice = mix(uLowDry, uLowWet, smoothstep(0.3, 0.7, moist));
    ice = mix(ice, uSnow, smoothstep(0.1, 0.5, e + alat * 0.4));
    ice = mix(ice, uHigh, rockMask * 0.6);
    landCol = mix(ice, uShallow, T.z * 0.85);
    landCol = mix(landCol, uRock, smoothstep(0.55, 1.0, slope) * 0.7);
  } else if (uStyle == 3) {
    vec3 crust = mix(uLowDry, uHigh, smoothstep(0.1, 0.6, e + vary * 0.1));
    crust = mix(crust, uRock, rockMask * 0.7);
    crust *= 0.75 + 0.5 * T.y;
    landCol = crust;
    float flicker = 0.75 + 0.25 * sin(uTime * 1.3 + T.y * 40.0);
    float glow = pow(T.z, 1.5) * uLava;
    landCol = mix(landCol, uEmit * 0.25, glow * 0.6);
    s.emission = uEmit * glow * flicker * 2.2;
  } else {
    vec3 reg = mix(uLowDry, uHigh, smoothstep(-0.2, 0.6, vary + e * 0.4));
    reg = mix(reg, uLowWet, T.z * 0.85);
    reg = mix(reg, uRock, smoothstep(0.25, 0.8, slope) * 0.5);
    landCol = reg * (0.88 + 0.24 * vary);
  }

  // Seas.
  vec3 seaCol;
  float seaWater = 1.0;
  float seaRough = 0.09;
  if (uStyle == 3) {
    // Lava sea: glowing cracks between cooling crust plates.
    vec3 v = voronoi(q * 16.0 + fbm3(q * 6.0, 3) * 0.6 + vec3(0.0, uTime * 0.002, 0.0));
    float cracks = smoothstep(0.1, 0.0, v.y - v.x) * (0.6 + 0.4 * gnoise(q * 60.0));
    float heat = mix(0.06, 1.0, cracks * cracks) * smoothstep(0.0, 0.6, dep + 0.2);
    seaCol = mix(uDeep, uShallow, cracks);
    s.emission += (1.0 - land) * uEmit * heat * uLava * 2.6;
    seaWater = 0.0;
    seaRough = 0.7;
  } else {
    seaCol = mix(uShallow, uDeep, smoothstep(0.0, 0.18, dep + patchy * 0.02));
    seaCol = mix(seaCol, uShallow * 1.15, smoothstep(0.02, 0.0, dep) * 0.4);
    float edge = gnoise(q * 5.0 + 3.0) * 0.6 + gnoise(q * 13.0) * 0.3 + gnoise(q * 37.0) * 0.12;
    float freeze = max(uIceSea, smoothstep(0.05, -0.05, temp + dep * 0.05 + edge * 0.16));
    if (freeze > 0.0) {
      float floes = 0.5 + 0.5 * gnoise(q * 90.0 + edge);
      vec3 seaIce = mix(uSnow * 0.78, uSnow * 0.95, floes) * (0.94 + 0.06 * edge);
      seaCol = mix(seaCol, seaIce, freeze);
      seaWater = 1.0 - freeze;
    }
  }

  if (uLiquid < 0.5) {
    // Dry basins read as darker lowland.
    seaCol = mix(landCol * 0.75, uLowWet * 0.8, 0.35);
    seaWater = 0.0;
    seaRough = 0.85;
    land = 1.0;
  }

  s.albedo = mix(seaCol, landCol, land);
  s.water = (1.0 - land) * seaWater;
  s.rough = mix(seaRough, 0.85, land);
  vec2 g = grad * land;
  s.normal = normalize(q - g.x * t1 - g.y * t2);
  return s;
}
`;
