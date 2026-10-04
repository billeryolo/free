import { App } from './app.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const app = new App(canvas, {
  terrainSize: params.has('tex') ? +params.get('tex') : undefined,
  octaves: params.has('oct') ? +params.get('oct') : undefined,
  fadeIn: !params.has('nofade'),
  fixedScale: params.has('fixed'),
  renderScale: params.has('scale') ? +params.get('scale') : undefined,
  maxDpr: params.has('dpr') ? +params.get('dpr') : undefined,
});
window.app = app;
const seed = params.has('seed') ? parseInt(params.get('seed'), 36) : (Math.random() * 2 ** 32) >>> 0;
app.load(seed, params.get('class') || undefined);
if (params.has('debug')) app.debug = +params.get('debug');
if (params.has('sun')) app.settings.sunAngle = +params.get('sun');
if (params.has('time')) app.planetTime = +params.get('time');
if (params.has('dist')) { app.camera.dist = app.camera.target.dist = +params.get('dist'); }
if (params.has('yaw')) { app.camera.yaw = app.camera.target.yaw = +params.get('yaw'); }
if (params.has('pitch')) { app.camera.pitch = app.camera.target.pitch = +params.get('pitch'); }
let last = performance.now();
function loop(now) {
  app.frame((now - last) / 1000);
  last = now;
  requestAnimationFrame(loop);
}
window.addEventListener('resize', () => app.resize());
requestAnimationFrame(loop);
