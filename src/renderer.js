// Owns the GL context: bakes worlds into cubemaps, renders frames, and reads
// back survey data (elevation histogram, equirectangular maps).

import { createContext, Program, Target, Cube, FULLSCREEN_VS, hdrFormat } from './gl.js';
import { TERRAIN_FS, CLOUDS_FS, SKY_FS } from './shaders/bake.js';
import { SCENE_FS } from './shaders/scene.js';
import { MAP_FS } from './shaders/map.js';
import { DOWN_FS, UP_FS, COMPOSITE_FS } from './shaders/post.js';

const BLOOM_LEVELS = 6;

export class Renderer {
  constructor(canvas, { terrainSize = 1024, cloudSize = 1024, skySize = 1024 } = {}) {
    const ctx = createContext(canvas);
    if (!ctx) throw new Error('WebGL2 is not available in this browser.');
    this.canvas = canvas;
    this.gl = ctx.gl;
    this.caps = ctx.caps;
    const gl = this.gl;
    this.vao = gl.createVertexArray();

    const P = (fs, name) => new Program(gl, FULLSCREEN_VS, fs, name);
    this.progs = {
      terrain: P(TERRAIN_FS, 'terrain'),
      clouds: P(CLOUDS_FS, 'clouds'),
      sky: P(SKY_FS, 'sky'),
      scene: P(SCENE_FS, 'scene'),
      map: P(MAP_FS, 'map'),
      down: P(DOWN_FS, 'bloom-down'),
      up: P(UP_FS, 'bloom-up'),
      composite: P(COMPOSITE_FS, 'composite'),
    };

    const size = Math.min(terrainSize, this.caps.maxCube);
    const hdrCube = this.caps.hdr ? gl.RGBA16F : gl.RGBA8;
    this.terrainSize = size;
    this.terrain = new Cube(gl, size, hdrCube);
    this.clouds = new Cube(gl, Math.min(cloudSize, size), gl.RG8);
    this.sky = new Cube(gl, Math.min(skySize, size), hdrCube);

    this.ringTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.ringTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

    const fmt = hdrFormat(gl, this.caps);
    this.hdr = new Target(gl, 4, 4, fmt);
    this.bloom = [];
    for (let i = 0; i < BLOOM_LEVELS; i++) this.bloom.push(new Target(gl, 2, 2, fmt));

    this.byteFmt = { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
    this.statsTarget = new Target(gl, 256, 128, this.byteFmt, { filter: gl.NEAREST });
    this.mapTarget = new Target(gl, 1024, 512, this.byteFmt);
    this.renderScale = 1;
  }

  resize(w, h, scale) {
    this.renderScale = scale;
    const rw = Math.max(16, Math.round(w * scale));
    const rh = Math.max(16, Math.round(h * scale));
    this.hdr.resize(rw, rh);
    let bw = rw, bh = rh;
    for (const t of this.bloom) {
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
      t.resize(bw, bh);
    }
  }

  draw() {
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  // A world bake as a list of small steps so it can be spread across frames.
  bakeSteps(world, { octaves = 12 } = {}) {
    const gl = this.gl;
    const steps = [];
    const terrainU = { ...world.bake, uSeed: world.seed, uOct: octaves, uEquirect: false, uEncode: false };
    for (let f = 0; f < 6; f++) {
      steps.push(() => {
        gl.bindVertexArray(this.vao);
        this.terrain.bindFace(f);
        this.progs.terrain.use().setAll(terrainU).set('uFace', f);
        this.draw();
      });
    }
    steps.push(() => this.terrain.generateMips());
    const cloudU = { ...world.cloudBake, uSeed: (world.seed * 2654435761) >>> 0, uEquirect: false };
    for (let f = 0; f < 6; f++) {
      steps.push(() => {
        gl.bindVertexArray(this.vao);
        this.clouds.bindFace(f);
        this.progs.clouds.use().setAll(cloudU).set('uFace', f);
        this.draw();
      });
    }
    steps.push(() => this.clouds.generateMips());
    const skyU = { ...world.sky, uSeed: (world.seed ^ 0x9e3779b9) >>> 0, uEquirect: false };
    for (let f = 0; f < 6; f++) {
      steps.push(() => {
        gl.bindVertexArray(this.vao);
        this.sky.bindFace(f);
        this.progs.sky.use().setAll(skyU).set('uFace', f);
        this.draw();
      });
    }
    steps.push(() => this.sky.generateMips());
    steps.push(() => this.uploadRings(world.rings));
    steps.push(() => {
      world.survey = this.readSurvey(world, terrainU);
    });
    return steps;
  }

  bakeNow(world, opts) {
    for (const s of this.bakeSteps(world, opts)) s();
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }

  uploadRings(rings) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.ringTex);
    if (rings) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, rings.data.length / 4, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rings.data);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // Equirectangular elevation readback: a weighted histogram for sea level
  // and the raw grid for naming continents.
  readSurvey(world, terrainU) {
    const gl = this.gl;
    const t = this.statsTarget;
    gl.bindVertexArray(this.vao);
    t.bind();
    this.progs.terrain.use().setAll(terrainU).set('uEquirect', true).set('uEncode', true).set('uOct', Math.min(terrainU.uOct, 9));
    this.draw();
    const px = new Uint8Array(t.w * t.h * 4);
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const W = t.w, H = t.h;
    const heights = new Float32Array(W * H);
    const weights = new Float32Array(W * H);
    let min = Infinity, max = -Infinity;
    for (let y = 0; y < H; y++) {
      const lat = ((y + 0.5) / H - 0.5) * Math.PI;
      const w = Math.cos(lat);
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const h = ((px[i * 4] + px[i * 4 + 1] / 255) / 255) * 2 - 1;
        heights[i] = h;
        weights[i] = w;
        if (h < min) min = h;
        if (h > max) max = h;
      }
    }
    const order = Array.from(heights.keys()).sort((a, b) => heights[a] - heights[b]);
    const cum = new Float32Array(order.length);
    let acc = 0;
    for (let k = 0; k < order.length; k++) {
      acc += weights[order[k]];
      cum[k] = acc;
    }
    for (let k = 0; k < cum.length; k++) cum[k] /= acc;
    const sorted = order.map((i) => heights[i]);
    return { W, H, heights, min, max, sorted, cum };
  }

  // Render the coloured relief map (equirectangular) and read it back.
  renderMap(uniforms, w = 1024, h = 512) {
    const gl = this.gl;
    const t = this.mapTarget;
    t.resize(w, h);
    gl.bindVertexArray(this.vao);
    t.bind();
    const p = this.progs.map.use();
    p.setAll(uniforms);
    p.tex('uTerrain', this.terrain.tex, gl.TEXTURE_CUBE_MAP);
    p.tex('uClouds', this.clouds.tex, gl.TEXTURE_CUBE_MAP);
    this.draw();
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return px;
  }

  render(u, post) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);

    this.hdr.bind();
    const s = this.progs.scene.use();
    s.setAll(u);
    s.set('uRes', [this.hdr.w, this.hdr.h]);
    s.set('uTexSize', this.terrainSize);
    s.tex('uTerrain', this.terrain.tex, gl.TEXTURE_CUBE_MAP);
    s.tex('uClouds', this.clouds.tex, gl.TEXTURE_CUBE_MAP);
    s.tex('uSky', this.sky.tex, gl.TEXTURE_CUBE_MAP);
    s.tex('uRingTex', this.ringTex);
    this.draw();

    // Bloom: downsample chain, then additive tent upsample back up.
    const down = this.progs.down.use();
    let src = this.hdr;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      const dst = this.bloom[i];
      dst.bind();
      down.set('uTexel', [1 / src.w, 1 / src.h]).set('uKaris', i === 0);
      down.tex('uSrc', src.tex);
      this.draw();
      src = dst;
    }
    const up = this.progs.up.use();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = BLOOM_LEVELS - 1; i > 0; i--) {
      const from = this.bloom[i];
      const to = this.bloom[i - 1];
      to.bind();
      up.set('uTexel', [1 / from.w, 1 / from.h]).set('uRadius', 1.0);
      up.tex('uSrc', from.tex);
      this.draw();
    }
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const c = this.progs.composite.use();
    c.setAll(post);
    c.set('uRes', [this.canvas.width, this.canvas.height]);
    c.set('uBloomNorm', 1 / BLOOM_LEVELS);
    c.tex('uScene', this.hdr.tex);
    c.tex('uBloom', this.bloom[0].tex);
    this.draw();
  }
}
