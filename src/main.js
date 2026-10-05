import { App } from './app.js';
import { UI, parseCode } from './ui.js';
import { Atlas, surveyRegions } from './atlas.js';
import { fmt } from './format.js';
import { Soundscape } from './audio.js';
import { Postcard } from './postcard.js';
import { Director } from './director.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const intro = $('intro');

function fail(err) {
  console.error(err);
  intro.classList.add('error');
  $('intro-status').textContent = '';
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function boot() {
  const canvas = $('view');
  let app;
  try {
    app = new App(canvas, {
      terrainSize: params.has('tex') ? +params.get('tex') : undefined,
      octaves: params.has('oct') ? +params.get('oct') : undefined,
      fadeIn: !params.has('nofade'),
      fixedScale: params.has('fixed'),
      renderScale: params.has('scale') ? +params.get('scale') : undefined,
      maxDpr: params.has('dpr') ? +params.get('dpr') : undefined,
    });
  } catch (e) {
    fail(e);
    return;
  }
  window.app = app;
  if (params.has('debug')) app.debug = +params.get('debug');

  // Cartography runs whenever the world or its sea level changes.
  let regionTimer = 0;
  const survey = () => {
    const w = app.world;
    const r = surveyRegions(w, app.sea);
    w.regions = r.regions;
    w.peak = r.peak;
  };
  app.on('world', survey);

  const atlas = new Atlas(app);
  const postcard = new Postcard(app);
  const sound = new Soundscape();
  const soundBtn = $('btn-sound');
  const soundCtl = {
    async toggle() {
      const on = await sound.toggle();
      soundBtn.setAttribute('aria-pressed', String(!!on));
      return on;
    },
  };
  const ui = new UI(app, { atlas, postcard, sound: soundCtl });
  atlas.ui = ui;
  window.ui = ui;
  const director = new Director(app, ui);
  ui.extras.director = director;
  app.renderer.canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    ui.toast('The graphics device was reset. Reload the page to continue exploring.', 600000);
  });
  const peakText = () => {
    const w = app.world;
    ui.setPeak(w.peak ? `${w.peak.name} · ${fmt.int(w.peak.meters)} m` : 'Below sea level');
  };
  app.on('world', peakText);
  app.on('sea', () => {
    clearTimeout(regionTimer);
    regionTimer = setTimeout(() => {
      if (!app.world || app.transition) return;
      survey();
      peakText();
      if (ui.labelsOn) ui.buildLabels();
    }, 120);
  });

  $('btn-atlas').addEventListener('click', () => atlas.toggle());
  $('btn-postcard').addEventListener('click', () => postcard.open());
  soundBtn.addEventListener('click', () => soundCtl.toggle());
  app.on('world', (w) => sound.setWorld(w));
  app.on('travel', () => {
    sound.whoosh();
    atlas.close();
    postcard.close();
  });
  app.on('frame', () => sound.update(app.camera.dist, app.warp));

  // First world: from the link, the query string, or a pleasant random pick.
  const code = parseCode(location.hash);
  let seed, cls;
  if (code) ({ seed, cls } = code);
  else if (params.has('seed')) {
    seed = parseInt(params.get('seed'), 36) >>> 0;
    cls = params.get('class') || undefined;
  } else {
    seed = (Math.random() * 2 ** 32) >>> 0;
    const firsts = ['terran', 'terran', 'terran', 'ocean', 'exotic', 'gas', 'gas', 'arid', 'frozen', 'icegiant'];
    cls = firsts[Math.floor(Math.random() * firsts.length)];
  }

  await nextFrame();
  await nextFrame();
  try {
    app.load(seed, cls);
  } catch (e) {
    fail(e);
    return;
  }
  ui.recordInitial(app.world);
  ui.revealName();

  const cam = app.camera;
  if (params.has('dist')) cam.dist = cam.target.dist = +params.get('dist');
  else { cam.dist = app.homeDist() * 1.9; cam.target.dist = app.homeDist() * 1.25; }
  if (params.has('yaw')) cam.yaw = cam.target.yaw = +params.get('yaw');
  if (params.has('pitch')) cam.pitch = cam.target.pitch = +params.get('pitch');
  if (params.has('sun')) app.settings.sunAngle = +params.get('sun');
  if (params.has('time')) app.planetTime = +params.get('time');
  if (params.has('labels')) ui.toggleLabels(true);
  if (params.has('tour')) director.toggle(true);
  if (params.has('hideui')) ui.toggleHidden();

  let last = performance.now();
  const loop = (now) => {
    app.frame((now - last) / 1000);
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.addEventListener('resize', () => app.resize());

  const begin = () => {
    intro.classList.add('gone');
    $('ui').classList.remove('pre');
    if (!params.has('dist')) cam.target.dist = app.homeDist();
    setTimeout(() => intro.remove(), 1500);
  };
  $('intro-status').textContent = 'Ready';
  $('btn-begin').addEventListener('click', begin);
  $('btn-begin-sound').addEventListener('click', () => {
    begin();
    soundCtl.toggle();
  });
  if (params.has('nointro') || code) begin();
}

boot();
