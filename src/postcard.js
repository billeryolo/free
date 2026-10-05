// Postcards: a still of the current view, set with the world's name and
// vital statistics like a vintage travel card.

import { fmt, hydrosphereValue } from './format.js';

// Inside the claude.ai viewer, files go through the `downloads` capability;
// on an ordinary host a plain download link works.
let downloadsPromise = null;
function getDownloads() {
  if (!window.claude?.use) return Promise.resolve(undefined);
  downloadsPromise ??= window.claude.use('downloads').catch(() => null);
  return downloadsPromise;
}

export class Postcard {
  constructor(app) {
    this.app = app;
    this.el = null;
    this.url = null;
  }

  close() {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }

  open() {
    const app = this.app;
    const w = app.world;
    if (!w || app.transition) return;
    this.close();
    const aspect = app.canvas.width / app.canvas.height;
    const shot = app.capture([aspect > 1.1 ? 0.22 : 0, aspect < 0.9 ? 0.18 : 0]);
    const card = this.compose(shot, w);
    const el = document.createElement('div');
    el.className = 'postcard';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', `Postcard from ${w.name}`);
    const filename = `${w.name.replace(/\s+/g, '-').toLowerCase()}-postcard.png`;
    el.innerHTML = `
      <figure>
        <img alt="Postcard of ${w.name}, ${w.classLabel.toLowerCase()}">
        <figcaption>${card.width} × ${card.height} PNG</figcaption>
        <div class="actions">
          <a class="btn primary" data-save download="${filename}">Save image</a>
          <button class="btn" data-close>Close</button>
        </div>
      </figure>`;
    document.getElementById('ui').appendChild(el);
    this.el = el;
    const save = el.querySelector('[data-save]');
    const caption = el.querySelector('figcaption');
    el.querySelector('[data-close]').addEventListener('click', () => this.close());
    el.addEventListener('click', (e) => { if (e.target === el) this.close(); });
    let blob = null;
    card.toBlob((b) => {
      if (!b || !this.el) return;
      blob = b;
      this.url = URL.createObjectURL(b);
      el.querySelector('img').src = this.url;
      save.href = this.url;
    }, 'image/png');
    getDownloads().then((downloads) => {
      if (downloads === undefined || !this.el) return;
      if (downloads === null) {
        save.hidden = true;
        caption.textContent = 'Right-click or long-press the image to keep it.';
        return;
      }
      save.removeAttribute('download');
      save.removeAttribute('href');
      save.setAttribute('role', 'button');
      save.tabIndex = 0;
      save.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!blob) return;
        try {
          await downloads.save({ filename, data: blob });
          caption.textContent = 'Postcard saved.';
        } catch (err) {
          if (err?.code === 'declined') return;
          caption.textContent = 'Saving is not available here. Right-click or long-press the image to keep it.';
        }
      });
    });
  }

  compose(shot, w) {
    const W = 1800;
    const H = Math.round(W / Math.max(1.2, Math.min(2.2, shot.width / shot.height)));
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    // Cover-fit the render.
    const s = Math.max(W / shot.width, H / shot.height);
    const dw = shot.width * s, dh = shot.height * s;
    g.drawImage(shot, (W - dw) / 2, (H - dh) / 2, dw, dh);

    // Legibility wash on the left.
    const grad = g.createLinearGradient(0, 0, W * 0.6, 0);
    grad.addColorStop(0, 'rgba(3,4,8,0.72)');
    grad.addColorStop(1, 'rgba(3,4,8,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    const ink = '#ece6d8';
    const dim = 'rgba(236,230,216,0.62)';
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#9cc3ff';
    const m = Math.round(W * 0.045);

    // Frame.
    g.strokeStyle = 'rgba(236,230,216,0.35)';
    g.lineWidth = 2;
    g.strokeRect(m * 0.5, m * 0.5, W - m, H - m);

    g.textBaseline = 'alphabetic';
    g.fillStyle = dim;
    g.font = '400 22px "Martian Mono", ui-monospace, monospace';
    g.letterSpacing = '6px';
    g.fillText('GREETINGS FROM', m * 1.4, H - m * 1.4 - 190);
    g.letterSpacing = '0px';

    g.fillStyle = ink;
    const size = w.name.length > 10 ? 120 : 150;
    g.font = `italic 400 ${size}px "Bodoni Moda", Didot, Georgia, serif`;
    g.fillText(w.name, m * 1.3, H - m * 1.4 - 52);

    g.fillStyle = accent;
    g.font = '400 24px "Martian Mono", ui-monospace, monospace';
    g.fillText(`${w.classLabel} · ${w.designation}`, m * 1.4, H - m * 1.4);

    // Vital statistics, right-aligned.
    const p = w.phys;
    const hydro = hydrosphereValue(w, this.app.oceanFraction()).main;
    const lines = [
      `${fmt.fixed(p.radius, 2)} R⊕ · ${fmt.fixed(p.gravity, 2)} g`,
      `${fmt.int(p.tempK)} K · ${fmt.fixed(p.dayHours, 1)} h day`,
      w.style === 5 ? `${w.moons.length} moon${w.moons.length === 1 ? '' : 's'}` : hydro,
      `${w.star.spectral} star · ${fmt.fixed(p.orbitAU, 2)} AU`,
    ];
    g.textAlign = 'right';
    g.fillStyle = dim;
    g.font = '400 20px "Martian Mono", ui-monospace, monospace';
    lines.forEach((l, i) => g.fillText(l, W - m * 1.4, H - m * 1.4 - (lines.length - 1 - i) * 34));

    // Stamp, drawn on its own layer so the perforations do not punch the photo.
    const sw = 150, sh = 180;
    const sx = W - m * 1.3 - sw, sy = m * 1.3;
    const st = document.createElement('canvas');
    st.width = sw + 20;
    st.height = sh + 20;
    const sg = st.getContext('2d');
    sg.fillStyle = 'rgba(236,230,216,0.94)';
    sg.fillRect(10, 10, sw, sh);
    sg.globalCompositeOperation = 'destination-out';
    sg.beginPath();
    for (let x = 10; x <= 10 + sw; x += 15) {
      sg.moveTo(x + 5, 10); sg.arc(x, 10, 5, 0, Math.PI * 2);
      sg.moveTo(x + 5, 10 + sh); sg.arc(x, 10 + sh, 5, 0, Math.PI * 2);
    }
    for (let y = 10; y <= 10 + sh; y += 15) {
      sg.moveTo(15, y); sg.arc(10, y, 5, 0, Math.PI * 2);
      sg.moveTo(15 + sw, y); sg.arc(10 + sw, y, 5, 0, Math.PI * 2);
    }
    sg.fill();
    sg.globalCompositeOperation = 'source-over';
    sg.strokeStyle = '#16161c';
    sg.lineWidth = 1.5;
    sg.strokeRect(22, 22, sw - 24, sh - 24);
    sg.fillStyle = '#16161c';
    sg.textAlign = 'center';
    sg.font = 'italic 400 46px "Bodoni Moda", Didot, Georgia, serif';
    sg.fillText('Orbis', 10 + sw / 2, 80);
    sg.font = '400 13px "Martian Mono", ui-monospace, monospace';
    sg.letterSpacing = '3px';
    sg.fillText(w.classLabel.split(' ')[0].toUpperCase(), 10 + sw / 2, 118);
    sg.fillText(w.style === 5 ? 'GIANT' : `ESI ${fmt.fixed(p.esi, 2)}`, 10 + sw / 2, 142);
    g.drawImage(st, sx - 10, sy - 10);

    // Postmark.
    g.save();
    g.translate(sx - 70, sy + 115);
    g.rotate(-0.25);
    g.strokeStyle = 'rgba(236,230,216,0.55)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, 0, 58, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(0, 0, 46, 0, Math.PI * 2);
    g.stroke();
    g.textAlign = 'center';
    g.fillStyle = 'rgba(236,230,216,0.7)';
    g.font = '400 12px "Martian Mono", ui-monospace, monospace';
    g.letterSpacing = '2px';
    g.fillText(new Date().toISOString().slice(0, 10), 0, 5);
    g.letterSpacing = '0px';
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      for (let x = 66; x <= 210; x += 3) {
        const y = -18 + i * 12 + Math.sin((x - 66) * 0.26) * 4;
        if (x === 66) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.restore();
    return c;
  }
}
