// Orbit camera with inertia. Close to the surface it tilts toward the
// horizon so the limb and atmosphere stay in frame.

import { v3, clamp, smoothstep } from './util.js';

export const MIN_DIST = 1.035;
export const MAX_DIST = 14;

export class OrbitCamera {
  constructor() {
    this.yaw = -0.35;
    this.pitch = 0.22;
    this.dist = 3.6;
    this.target = { yaw: this.yaw, pitch: this.pitch, dist: this.dist };
    this.vel = { yaw: 0, pitch: 0 };
    this.fov = (36 * Math.PI) / 180;
    this.tilt = 0;
    this.pos = [0, 0, 1];
    this.basis = new Float32Array(9);
    this.right = [1, 0, 0];
    this.up = [0, 1, 0];
    this.fwd = [0, 0, -1];
    this.dragging = false;
    this.idle = 0;
    this.autoSpin = 0.018;
  }

  drag(dx, dy) {
    // Angular speed shrinks near the surface so dragging tracks the ground.
    const k = 0.0042 * clamp((this.dist - 1) / 2.2, 0.03, 1.2);
    this.vel.yaw = -dx * k;
    this.vel.pitch = dy * k;
    this.target.yaw += this.vel.yaw;
    this.target.pitch = clamp(this.target.pitch + this.vel.pitch, -1.45, 1.45);
    this.idle = 0;
  }

  release() {
    this.dragging = false;
  }

  zoom(factor) {
    const alt = this.target.dist - 1;
    this.target.dist = clamp(1 + alt * factor, MIN_DIST, MAX_DIST);
    this.idle = 0;
  }

  update(dt) {
    this.idle += dt;
    if (!this.dragging) {
      // Inertia after release.
      this.target.yaw += this.vel.yaw;
      this.target.pitch = clamp(this.target.pitch + this.vel.pitch, -1.45, 1.45);
      const decay = Math.exp(-dt * 4.5);
      this.vel.yaw *= decay;
      this.vel.pitch *= decay;
      if (this.idle > 6) {
        const ramp = smoothstep(6, 12, this.idle);
        this.target.yaw += dt * this.autoSpin * ramp * clamp((this.dist - 1) / 2, 0.15, 1);
      }
    }
    const k = 1 - Math.exp(-dt * 7);
    this.yaw += (this.target.yaw - this.yaw) * k;
    this.pitch += (this.target.pitch - this.pitch) * k;
    const kd = 1 - Math.exp(-dt * 5);
    this.dist += (this.target.dist - this.dist) * kd;

    const cp = Math.cos(this.pitch);
    const dir = [cp * Math.sin(this.yaw), Math.sin(this.pitch), cp * Math.cos(this.yaw)];
    this.pos = v3.scale(dir, this.dist);

    let fwd = v3.scale(dir, -1);
    let right = v3.norm(v3.cross(fwd, [0, 1, 0]));
    let up = v3.cross(right, fwd);

    // Horizon tilt: rotate the view up toward the limb when low.
    const horizon = Math.asin(clamp(1 / this.dist, 0, 1));
    const amount = smoothstep(2.4, 1.04, this.dist);
    this.tilt = amount * Math.max(0, horizon - 0.32);
    const ct = Math.cos(this.tilt), st = Math.sin(this.tilt);
    const f2 = v3.add(v3.scale(fwd, ct), v3.scale(up, st));
    const u2 = v3.sub(v3.scale(up, ct), v3.scale(fwd, st));
    fwd = f2;
    up = u2;

    this.fwd = fwd;
    this.right = right;
    this.up = up;
    this.basis.set([...right, ...up, ...fwd]);
  }

  // Project a world direction (from the camera) to [0,1] screen coordinates.
  projectDir(d, aspect) {
    const z = v3.dot(d, this.fwd);
    if (z <= 1e-4) return null;
    const t = Math.tan(this.fov / 2);
    const x = v3.dot(d, this.right) / (z * t * aspect);
    const y = v3.dot(d, this.up) / (z * t);
    return [x * 0.5 + 0.5, y * 0.5 + 0.5];
  }

  projectPoint(p, aspect) {
    return this.projectDir(v3.sub(p, this.pos), aspect);
  }
}
