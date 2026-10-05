// Cartography: finds continents, seas and the highest peak on the survey
// grid, names them, and draws the equirectangular atlas plate.

import { fmt } from './format.js';
import { Namer } from './names.js';

function cellDir(x, y, W, H) {
  const lon = ((x + 0.5) / W - 0.5) * 2 * Math.PI;
  const lat = ((y + 0.5) / H - 0.5) * Math.PI;
  return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
}

const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

// Connected components over a boolean grid with longitude wrap-around.
function components(mask, W, H) {
  const label = new Int32Array(W * H).fill(-1);
  const comps = [];
  const stack = [];
  for (let start = 0; start < W * H; start++) {
    if (label[start] !== -1) continue;
    const val = mask[start];
    const id = comps.length;
    const cells = [];
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop();
      cells.push(i);
      const x = i % W, y = (i / W) | 0;
      const nb = [y * W + ((x + 1) % W), y * W + ((x - 1 + W) % W)];
      if (y > 0) nb.push(i - W);
      if (y < H - 1) nb.push(i + W);
      for (const j of nb) {
        if (label[j] === -1 && mask[j] === val) {
          label[j] = id;
          stack.push(j);
        }
      }
    }
    comps.push({ id, land: !!val, cells });
  }
  return { label, comps };
}

// Multi-source BFS distance from each cell to the nearest cell of another type.
function coastDistance(mask, W, H) {
  const dist = new Float32Array(W * H).fill(Infinity);
  const queue = [];
  for (let i = 0; i < W * H; i++) {
    const x = i % W, y = (i / W) | 0;
    const nb = [y * W + ((x + 1) % W), y * W + ((x - 1 + W) % W)];
    if (y > 0) nb.push(i - W);
    if (y < H - 1) nb.push(i + W);
    if (nb.some((j) => mask[j] !== mask[i])) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % W, y = (i / W) | 0;
    const lat = ((y + 0.5) / H - 0.5) * Math.PI;
    const ew = Math.max(Math.cos(lat), 0.05);
    const nb = [[y * W + ((x + 1) % W), ew], [y * W + ((x - 1 + W) % W), ew]];
    if (y > 0) nb.push([i - W, 1]);
    if (y < H - 1) nb.push([i + W, 1]);
    for (const [j, w] of nb) {
      if (mask[j] === mask[i] && dist[j] > dist[i] + w) {
        dist[j] = dist[i] + w;
        queue.push(j);
      }
    }
  }
  return dist;
}

const STYLE_NAMES = {
  terran: { land: (n) => n, sea: (n, r) => (r === 0 ? `${n} Ocean` : r < 3 ? `${n} Ocean` : `${n} Sea`), island: (n) => `${n} Isle` },
  ocean: { land: (n) => `${n} Isles`, sea: (n, r) => (r < 3 ? `${n} Ocean` : `${n} Sea`), island: (n) => `${n} Isle` },
  exotic: { land: (n) => n, sea: (n, r) => (r < 3 ? `${n} Ocean` : `${n} Sea`), island: (n) => `${n} Isle` },
  toxic: { land: (n) => `Terra ${n}`, sea: (n, r) => (r < 2 ? `${n} Brine Sea` : `Sea of ${n}`), island: (n) => `${n} Rise` },
  arid: { land: (n) => `${n} Plateau`, sea: (n) => `${n} Basin`, island: (n) => `${n} Mesa` },
  frozen: { land: (n) => `${n} Highlands`, sea: (n) => `${n} Ice Sheet`, island: (n) => `${n} Nunatak` },
  volcanic: { land: (n) => `${n} Craton`, sea: (n, r) => (r < 2 ? `${n} Lava Sea` : `Lacus ${n}`), island: (n) => `${n} Shield` },
  airless: { land: (n) => `Terra ${n}`, sea: (n) => `Mare ${n}`, island: (n) => `${n} Massif` },
};

export function surveyRegions(world, sea) {
  const s = world.survey;
  if (!s || world.style === 5) {
    if (world.style === 5) {
      const st = world.bake.uStorms;
      const namer = new Namer(world.seed ^ 0x2545f491);
      const regions = [];
      if (Math.abs(st[3]) > 0.55) {
        regions.push({ name: `Great ${namer.region()} Storm`, kind: 'sea', dir: [st[0], st[1], st[2]] });
      }
      return { regions, peak: null };
    }
    return { regions: [], peak: null };
  }
  const { W, H, heights } = s;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = heights[i] > sea ? 1 : 0;
  const { comps } = components(mask, W, H);
  const dist = coastDistance(mask, W, H);
  const weight = (i) => Math.cos((((i / W) | 0) + 0.5) / H * Math.PI - Math.PI / 2);
  let totalW = 0;
  for (let y = 0; y < H; y++) totalW += Math.cos(((y + 0.5) / H - 0.5) * Math.PI) * W;

  for (const c of comps) {
    let a = 0;
    let best = c.cells[0], bestD = -1;
    for (const i of c.cells) {
      a += weight(i);
      if (dist[i] > bestD) { bestD = dist[i]; best = i; }
    }
    c.area = a / totalW;
    c.anchor = best;
    c.depth = bestD;
  }

  const namer = new Namer(world.seed ^ 0x2545f491);
  const style = STYLE_NAMES[world.cls] ?? STYLE_NAMES.terran;
  const regions = [];
  const dirOf = (i) => cellDir(i % W, (i / W) | 0, W, H);

  // Land masses.
  const lands = comps.filter((c) => c.land).sort((a, b) => b.area - a.area);
  let li = 0;
  for (const c of lands) {
    if (c.area < 0.0025 || li >= 8) break;
    const big = c.area > 0.012;
    const n = namer.region();
    regions.push({ name: big ? style.land(n) : style.island(n), kind: 'land', dir: dirOf(c.anchor), area: c.area });
    li++;
  }

  // Water bodies: big oceans get several labels at mutually distant deep points.
  const seas = comps.filter((c) => !c.land).sort((a, b) => b.area - a.area);
  let rank = 0;
  for (const c of seas) {
    if (c.area < 0.004 || rank >= 7) break;
    const nLabels = c.area > 0.45 ? 3 : c.area > 0.2 ? 2 : 1;
    const picks = [];
    const sorted = c.cells.slice().sort((a, b) => dist[b] - dist[a]);
    for (const i of sorted) {
      if (picks.length >= nLabels) break;
      const d = dirOf(i);
      if (picks.every((p) => angle(p, d) > 1.0)) picks.push(d);
    }
    for (const d of picks) {
      regions.push({ name: style.sea(namer.region(), rank), kind: 'sea', dir: d, area: c.area / picks.length });
      rank++;
    }
  }

  // Highest point.
  let hi = 0;
  for (let i = 1; i < W * H; i++) if (heights[i] > heights[hi]) hi = i;
  const peak = heights[hi] > sea
    ? { name: namer.peak(), dir: dirOf(hi), meters: world.phys.peakScale * (world.cls === 'airless' ? 0.8 : 1) }
    : null;
  return { regions, peak };
}

// ---------------------------------------------------------------- the plate

export class Atlas {
  constructor(app, ui) {
    this.app = app;
    this.ui = ui;
    this.el = null;
    this.showClouds = false;
  }

  toggle() {
    if (this.el) this.close();
    else this.open();
  }

  close() {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    document.getElementById('btn-atlas').setAttribute('aria-pressed', 'false');
  }

  open() {
    const app = this.app;
    const w = app.world;
    if (!w || app.transition) return;
    const el = document.createElement('div');
    el.className = 'atlas';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', `Atlas of ${w.name}`);
    const kmPerDeg = (2 * Math.PI * w.phys.radiusKm) / 360;
    el.innerHTML = `
      <button class="icon close" aria-label="Close atlas"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <figure>
        <header>
          <div>
            <p class="label" style="margin:0 0 8px">${w.designation} · Equirectangular projection</p>
            <h2>Atlas of ${w.name}</h2>
          </div>
          <div class="toggles"><button class="chip" id="atlas-clouds" aria-pressed="false">Cloud cover</button></div>
        </header>
        <div class="plate"><canvas width="2048" height="1024"></canvas></div>
        <figcaption>
          <span>Graticule every 30° · 1° of arc ≈ ${fmt.int(kmPerDeg)} km at the equator</span>
          <span>Surveyed ${new Date().toISOString().slice(0, 10)}</span>
        </figcaption>
      </figure>`;
    document.getElementById('ui').appendChild(el);
    this.el = el;
    document.getElementById('btn-atlas').setAttribute('aria-pressed', 'true');
    el.querySelector('.close').addEventListener('click', () => this.close());
    el.addEventListener('click', (e) => { if (e.target === el) this.close(); });
    const cb = el.querySelector('#atlas-clouds');
    cb.hidden = !w.clouds.on;
    cb.addEventListener('click', () => {
      this.showClouds = !this.showClouds;
      cb.setAttribute('aria-pressed', String(this.showClouds));
      this.draw();
    });
    this.draw();
  }

  draw() {
    const app = this.app;
    const w = app.world;
    const canvas = this.el.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const MW = 1024, MH = 512;
    const { u } = app.sceneUniforms();
    const px = app.renderer.renderMap({ ...u, uTexSize: app.renderer.terrainSize, uMapRes: [MW, MH], uShowClouds: this.showClouds ? 1 : 0 }, MW, MH);
    const img = new ImageData(MW, MH);
    for (let y = 0; y < MH; y++) {
      const src = (MH - 1 - y) * MW * 4;
      img.data.set(px.subarray(src, src + MW * 4), y * MW * 4);
    }
    const tmp = document.createElement('canvas');
    tmp.width = MW;
    tmp.height = MH;
    tmp.getContext('2d').putImageData(img, 0, 0);
    const CW = canvas.width, CH = canvas.height;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tmp, 0, 0, CW, CH);

    // Graticule.
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let lon = -180; lon <= 180; lon += 30) {
      const x = ((lon + 180) / 360) * CW;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CH);
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = ((90 - lat) / 180) * CH;
      ctx.moveTo(0, y);
      ctx.lineTo(CW, y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(0, CH / 2);
    ctx.lineTo(CW, CH / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Degree ticks on a dark margin strip so they read over ice and cloud.
    ctx.fillStyle = 'rgba(4,5,10,0.55)';
    ctx.fillRect(0, 0, CW, 36);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '500 18px "Martian Mono", ui-monospace, monospace';
    ctx.textBaseline = 'top';
    for (let lon = -150; lon <= 150; lon += 30) {
      const x = ((lon + 180) / 360) * CW;
      ctx.fillText(`${Math.abs(lon)}°${lon < 0 ? 'W' : lon > 0 ? 'E' : ''}`, x + 6, 8);
    }
    ctx.textBaseline = 'bottom';
    for (let lat = -60; lat <= 60; lat += 30) {
      if (lat === 0) continue;
      const y = ((90 - lat) / 180) * CH;
      const t = `${Math.abs(lat)}°${lat < 0 ? 'S' : 'N'}`;
      ctx.fillStyle = 'rgba(4,5,10,0.55)';
      ctx.fillRect(0, y - 30, ctx.measureText(t).width + 16, 26);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(t, 8, y - 6);
    }

    // Place names.
    const toXY = (d) => {
      const lat = Math.asin(Math.max(-1, Math.min(1, d[1])));
      const lon = Math.atan2(d[0], d[2]);
      return [((lon / (2 * Math.PI)) + 0.5) * CW, (0.5 - lat / Math.PI) * CH];
    };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = (text, x, y, font, color, spacing) => {
      ctx.font = font;
      ctx.letterSpacing = spacing;
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      ctx.shadowBlur = 4;
      ctx.fillText(text, x, y);
      ctx.shadowBlur = 0;
    };
    for (const r of w.regions ?? []) {
      const [x, y] = toXY(r.dir);
      const big = (r.area ?? 0) > 0.03;
      if (r.kind === 'land') label(r.name.toUpperCase(), x, y, `500 ${big ? 30 : 22}px "Bodoni Moda", Didot, Georgia, serif`, 'rgba(255,255,255,0.95)', big ? '8px' : '5px');
      else label(r.name, x, y, `italic 400 ${big ? 34 : 26}px "Bodoni Moda", Didot, Georgia, serif`, 'rgba(210,230,255,0.92)', '3px');
    }
    if (w.peak) {
      const [x, y] = toXY(w.peak.dir);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(x, y - 9);
      ctx.lineTo(x + 8, y + 6);
      ctx.lineTo(x - 8, y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.textAlign = 'left';
      label(`${w.peak.name} · ${fmt.int(w.peak.meters)} m`, x + 14, y, '400 17px "Martian Mono", ui-monospace, monospace', 'rgba(255,255,255,0.9)', '1px');
      ctx.textAlign = 'center';
    }
    ctx.letterSpacing = '0px';
  }
}
