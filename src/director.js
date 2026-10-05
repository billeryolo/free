// Cinematic tour: a director that flies the camera through a short shot list
// on each world, then travels on. Any manual input hands control back.

const ease = (t) => t * t * (3 - 2 * t);

function nearestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d;
}

export class Director {
  constructor(app, ui) {
    this.app = app;
    this.ui = ui;
    this.active = false;
    this.shots = [];
    this.shot = null;
    this.t = 0;
    app.on('arrived', () => {
      if (!this.active) return;
      this.plan();
      this.flashName();
    });
    app.on('frame', ({ dt }) => this.update(dt));
  }

  toggle(force) {
    const on = force ?? !this.active;
    if (on === this.active) return;
    this.active = on;
    document.getElementById('ui').classList.toggle('touring', on);
    document.getElementById('btn-tour')?.setAttribute('aria-pressed', String(on));
    if (on) {
      if (!this.app.transition) this.plan();
      this.flashName();
      this.ui.toast('Tour started · press any key or drag to take the controls', 3500);
    } else {
      this.shots = [];
      this.shot = null;
    }
  }

  // In a tour the name appears on arrival, then leaves the frame to the world.
  flashName() {
    const c = document.querySelector('.catalog');
    c.classList.remove('tour-name');
    void c.offsetWidth;
    c.classList.add('tour-name');
  }

  // Shots are expressed relative to the sun so every world gets the same
  // grammar: establishing orbit, a low pass over the day side near the
  // terminator, the sun rising over the limb, then a pull-out and a jump.
  plan() {
    const app = this.app;
    const a = 0.75 + app.settings.sunAngle;
    const home = app.homeDist();
    const w = app.world;
    const shots = [
      { dur: 9, yaw: a - 1.45, pitch: 0.25, dist: home },
      { dur: 11, yaw: a - 1.0, pitch: 0.08, dist: home * 0.9 },
    ];
    if (w.style !== 5) {
      shots.push({ dur: 9, yaw: a - 0.5, pitch: 0.22, dist: 1.12 });
      shots.push({ dur: 10, yaw: a - 0.25, pitch: 0.12, dist: 1.06 });
    } else {
      shots.push({ dur: 10, yaw: a - 0.6, pitch: -0.32, dist: home * 0.7 });
    }
    // Slip behind the planet with the sun hidden, then rise until it clears the limb.
    shots.push({ dur: 9, yaw: a + Math.PI - 0.04, pitch: -0.03, dist: home * 1.05 });
    shots.push({ dur: 10, yaw: a + Math.PI - 0.1, pitch: 0.1, dist: home * 1.05 });
    shots.push({ dur: 6, yaw: a + Math.PI + 0.5, pitch: 0.3, dist: home * 1.5, travel: true });
    this.shots = shots;
    this.next();
  }

  next() {
    const cam = this.app.camera;
    const s = this.shots.shift();
    if (!s) {
      this.shot = null;
      return;
    }
    this.shot = {
      ...s,
      from: { yaw: cam.target.yaw, pitch: cam.target.pitch, dist: cam.target.dist },
      toYaw: nearestAngle(cam.target.yaw, s.yaw),
    };
    this.t = 0;
  }

  update(dt) {
    if (!this.active || !this.shot || this.app.transition) return;
    const cam = this.app.camera;
    const s = this.shot;
    this.t += dt;
    const k = ease(Math.min(1, this.t / s.dur));
    cam.target.yaw = s.from.yaw + (s.toYaw - s.from.yaw) * k;
    cam.target.pitch = s.from.pitch + (s.pitch - s.from.pitch) * k;
    // Distance moves in log space so dives feel even.
    const ld = Math.log(s.from.dist - 1 + 1e-3) + (Math.log(s.dist - 1 + 1e-3) - Math.log(s.from.dist - 1 + 1e-3)) * k;
    cam.target.dist = 1 + Math.exp(ld);
    cam.vel.yaw = cam.vel.pitch = 0;
    cam.idle = 0;
    if (s.travel && this.t > s.dur * 0.55) {
      this.shot = null;
      this.ui.newWorld();
      return;
    }
    if (this.t >= s.dur) this.next();
  }
}
