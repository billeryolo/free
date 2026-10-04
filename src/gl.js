// Thin WebGL2 helpers: programs with reflected uniforms, render targets, cubemaps.

export const FULLSCREEN_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export function createContext(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  });
  if (!gl) return null;
  const caps = {
    floatTargets: !!gl.getExtension('EXT_color_buffer_float'),
    halfTargets: !!gl.getExtension('EXT_color_buffer_half_float'),
    floatLinear: !!gl.getExtension('OES_texture_float_linear'),
    maxCube: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
  };
  caps.hdr = caps.floatTargets || caps.halfTargets;
  return { gl, caps };
}

function annotate(src, log) {
  const lines = src.split('\n');
  const out = [];
  const re = /ERROR: \d+:(\d+):/g;
  let m;
  const marked = new Set();
  while ((m = re.exec(log))) marked.add(+m[1]);
  for (const n of marked) {
    for (let i = Math.max(1, n - 3); i <= Math.min(lines.length, n + 2); i++) {
      out.push(`${i === n ? '>>' : '  '} ${String(i).padStart(4)}| ${lines[i - 1]}`);
    }
    out.push('');
  }
  return out.join('\n');
}

function compileShader(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    console.error(`[${label}] shader compile failed\n${log}\n${annotate(src, log)}`);
    throw new Error(`${label}: ${log}`);
  }
  return sh;
}

export class Program {
  constructor(gl, vs, fs, label = 'program') {
    this.gl = gl;
    this.label = label;
    const p = gl.createProgram();
    gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vs, label));
    gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fs, label));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`${label}: link failed: ${gl.getProgramInfoLog(p)}`);
    }
    this.program = p;
    this.uniforms = {};
    this.units = {};
    let unit = 0;
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      const loc = gl.getUniformLocation(p, info.name);
      const isSampler =
        info.type === gl.SAMPLER_2D || info.type === gl.SAMPLER_CUBE || info.type === gl.SAMPLER_3D;
      if (isSampler) this.units[name] = unit++;
      this.uniforms[name] = { loc, type: info.type, size: info.size };
    }
    gl.useProgram(p);
    for (const [name, u] of Object.entries(this.units)) gl.uniform1i(this.uniforms[name].loc, u);
  }

  use() {
    this.gl.useProgram(this.program);
    return this;
  }

  set(name, v) {
    const u = this.uniforms[name];
    if (!u) return this;
    const gl = this.gl;
    const loc = u.loc;
    switch (u.type) {
      case gl.FLOAT:
        u.size > 1 ? gl.uniform1fv(loc, v) : gl.uniform1f(loc, v);
        break;
      case gl.FLOAT_VEC2: gl.uniform2fv(loc, v); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(loc, v); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(loc, v); break;
      case gl.INT:
      case gl.BOOL:
        gl.uniform1i(loc, v);
        break;
      case gl.UNSIGNED_INT: gl.uniform1ui(loc, v >>> 0); break;
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(loc, false, v); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(loc, false, v); break;
      default: break;
    }
    return this;
  }

  setAll(obj) {
    for (const k in obj) this.set(k, obj[k]);
    return this;
  }

  tex(name, texture, target) {
    const unit = this.units[name];
    if (unit === undefined) return this;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target ?? gl.TEXTURE_2D, texture);
    return this;
  }
}

export function hdrFormat(gl, caps) {
  if (caps.hdr) return { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
  return { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
}

export class Target {
  constructor(gl, w, h, fmt, { filter = gl.LINEAR, wrap = gl.CLAMP_TO_EDGE } = {}) {
    this.gl = gl;
    this.fmt = fmt;
    this.filter = filter;
    this.wrap = wrap;
    this.tex = gl.createTexture();
    this.fbo = gl.createFramebuffer();
    this.resize(w, h);
  }

  resize(w, h) {
    w = Math.max(1, w | 0);
    h = Math.max(1, h | 0);
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    this.w = w;
    this.h = h;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.fmt.internal, w, h, 0, this.fmt.format, this.fmt.type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, this.wrap);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.w, this.h);
  }
}

// A cubemap that can be rendered into face by face.
export class Cube {
  constructor(gl, size, internal, { mips = true } = {}) {
    this.gl = gl;
    this.size = size;
    this.levels = mips ? Math.floor(Math.log2(size)) + 1 : 1;
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.tex);
    gl.texStorage2D(gl.TEXTURE_CUBE_MAP, this.levels, internal, size, size);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fbos = [];
    for (let f = 0; f < 6; f++) {
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, this.tex, 0);
      this.fbos.push(fbo);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.mips = mips;
  }

  bindFace(f) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[f]);
    gl.viewport(0, 0, this.size, this.size);
  }

  generateMips() {
    if (!this.mips) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.tex);
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteTexture(this.tex);
    for (const f of this.fbos) gl.deleteFramebuffer(f);
  }
}
