import test from 'node:test';
import assert from 'node:assert/strict';
import { mapToView, earAnchors, computePlacement, createSmoother, EAR_DROP } from './src/try-on/placement.js';
import { validateConfig, cropRect, cropAdjust, trimFromAlpha, autoAnchor, scaleFromLength } from './src/try-on/assets.js';
import { FIXTURES } from './src/try-on/fixtures.js';
import { normalizeDetectState, startWebarEngine, WEBAR_LIMITS, EAR_K } from './src/try-on/engine-webar.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

// 640×480 video shown in a 300×600 portrait view (object-fit: cover → scale 1.25, crops the sides).
const view = { videoW: 640, videoH: 480, viewW: 300, viewH: 600, mirrored: true };

test('mapToView: cover crop is centred, mirroring applied once', () => {
  const c = mapToView({ x: 320, y: 240 }, view); // video centre → view centre
  near(c.x, 150); near(c.y, 300);
  const unmirrored = mapToView({ x: 100, y: 240 }, { ...view, mirrored: false });
  const mirrored = mapToView({ x: 100, y: 240 }, view);
  near(unmirrored.x + mirrored.x, view.viewW); // exact reflection about the view centre
  near(unmirrored.y, mirrored.y);
  // scale = max(300/640, 600/480) = 1.25; offsetX = (300 - 800) / 2 = -250
  near(unmirrored.x, 100 * 1.25 - 250);
});

// Face looking at the camera: wearer-right ear landmark (234) on image left, 454 on image right.
function face({ roll = 0, dz = 0, cx = 0.5, cy = 0.5, width = 0.3 } = {}) {
  const lm = [];
  const dx = Math.cos(roll) * width / 2, dy = Math.sin(roll) * width / 2 * (640 / 480);
  lm[234] = { x: cx - dx, y: cy - dy, z: -dz / 2 };
  lm[454] = { x: cx + dx, y: cy + dy, z: dz / 2 };
  return lm;
}

test('earAnchors: wearer-left is the image-right landmark; face width + drop', () => {
  const e = earAnchors(face(), 640, 480);
  assert.ok(e.left.x > e.right.x);
  near(e.faceWidth, 0.3 * 640);
  near(e.left.y, 240 + EAR_DROP * e.faceWidth);
  near(e.rollDeg, 0); near(e.yawDeg, 0);
  assert.equal(earAnchors([], 640, 480), null);
  assert.equal(earAnchors(face({ width: 0 }), 640, 480), null);
});

const config = {
  productId: 'p1', version: 1, assets: { left: '/a.webp', right: null }, mirrorLeftForRight: true,
  anchor: { left: { x: 0.4, y: 0.1 }, right: { x: 0.4, y: 0.1 } },
  offset: { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } },
  rotationDeg: { left: 0, right: 0 }, scaleRatio: 0.2, lengthMm: null,
};
const user = { offset: { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } }, scale: 1 };
const place = (lm, over = {}) =>
  computePlacement({ ears: earAnchors(lm, 640, 480), view, config, user, aspect: { left: 0.5 }, ...over });

test('left/right mean the wearer: in a mirrored view the wearer-left ear is on screen left', () => {
  const p = place(face());
  assert.equal(p.state, 'tracking');
  assert.ok(p.left.x < p.right.x);
  // view face width = 0.3*640*1.25 = 240 px; ears sit symmetrically about the view centre
  near(p.left.x + p.right.x, view.viewW);
  const unmirrored = place(face(), { view: { ...view, mirrored: false } });
  assert.ok(unmirrored.left.x > unmirrored.right.x);
});

test('size comes from face width, image aspect and user scale', () => {
  const p = place(face());
  near(p.left.h, 0.2 * 240); near(p.left.w, 0.2 * 240 * 0.5);
  near(place(face(), { user: { ...user, scale: 1.5 } }).left.h, 0.2 * 240 * 1.5);
  near(place(face(), { user: { ...user, scale: 99 } }).left.h, 0.2 * 240 * 2); // clamped
});

test('symmetric pair: right reuses the left asset, flipped, with mirrored anchor', () => {
  const p = place(face());
  assert.deepEqual([p.left.asset, p.left.flipX], ['left', false]);
  assert.deepEqual([p.right.asset, p.right.flipX], ['left', true]);
  near(p.right.imgAnchor.x, 0.6); near(p.right.imgAnchor.y, 0.1);
  const pair = place(face(), { config: { ...config, mirrorLeftForRight: false, assets: { left: '/a', right: '/b' }, anchor: { left: { x: 0.4, y: 0.1 }, right: { x: 0.7, y: 0.2 } } } });
  assert.deepEqual([pair.right.asset, pair.right.flipX, pair.right.imgAnchor], ['right', false, { x: 0.7, y: 0.2 }]);
});

test('user and config offsets are in face widths along the face axes; tilt rotates them', () => {
  const o = { left: { x: 0.1, y: 0.25 }, right: { x: 0, y: 0 } };
  const base = place(face()).left;
  const moved = place(face(), { user: { ...user, offset: o } }).left;
  near(moved.x - base.x, 0.1 * 240); near(moved.y - base.y, 0.25 * 240);
  // tilt rotates the axes: 30° roll, mirrored view → view roll −30°
  const roll = 30 * Math.PI / 180;
  const t0 = place(face({ roll })).left;
  const t1 = place(face({ roll }), { user: { ...user, offset: { left: { x: 0.1, y: 0 }, right: { x: 0, y: 0 } } } }).left;
  near(t1.x - t0.x, 0.1 * 240 * Math.cos(-roll)); near(t1.y - t0.y, 0.1 * 240 * Math.sin(-roll));
});

test('roll: rotation is in view space (negated by mirroring) and adds the config correction', () => {
  const roll = 10 * Math.PI / 180;
  const unm = place(face({ roll }), { view: { ...view, mirrored: false } });
  const mir = place(face({ roll }));
  near(unm.left.rotationDeg, 10, 1e-3);
  near(mir.left.rotationDeg, -10, 1e-3);
  const corrected = place(face({ roll }), { config: { ...config, rotationDeg: { left: 5, right: -5 } } });
  near(corrected.left.rotationDeg, -10 + 5, 1e-3);
  near(corrected.right.rotationDeg, -10 - 5, 1e-3);
});

test('pose gating: far ear hides, big turn or tilt rejects', () => {
  const turnLeft = place(face({ dz: Math.tan(25 * Math.PI / 180) * 0.3 })); // yaw +25°
  assert.equal(turnLeft.state, 'tracking');
  assert.equal(turnLeft.left, null); assert.ok(turnLeft.right);
  const turnRight = place(face({ dz: -Math.tan(25 * Math.PI / 180) * 0.3 }));
  assert.equal(turnRight.right, null); assert.ok(turnRight.left);
  const sideways = place(face({ dz: Math.tan(50 * Math.PI / 180) * 0.3 }));
  assert.deepEqual([sideways.state, sideways.left, sideways.right], ['unsupported-pose', null, null]);
  assert.equal(place(face({ roll: 60 * Math.PI / 180 })).state, 'unsupported-pose');
  assert.equal(computePlacement({ ears: null, view, config, user }).state, 'no-face');
  const small = place(face({ dz: Math.tan(5 * Math.PI / 180) * 0.3 }));
  assert.ok(small.left && small.right);
});

test('smoother blends frames, clears hidden sides, and reset() drops stale positions', () => {
  const s = createSmoother({ alpha: 0.5 });
  const a = { state: 'tracking', left: { x: 0, y: 0, w: 10, h: 10, rotationDeg: 0 }, right: null };
  const b = { state: 'tracking', left: { x: 100, y: 40, w: 10, h: 10, rotationDeg: 20 }, right: null };
  assert.deepEqual(s.next(a).left, a.left);
  const mid = s.next(b).left;
  near(mid.x, 50); near(mid.y, 20); near(mid.rotationDeg, 10);
  s.next({ state: 'tracking', left: null, right: null }); // side hidden → history gone
  assert.deepEqual(s.next(b).left, b.left);
  s.next(a); s.reset(); // face lost → next frame snaps, doesn't glide from the old spot
  assert.deepEqual(s.next(b).left, b.left);
});

test('validateConfig accepts fixtures and returns the contract shape', () => {
  for (const f of FIXTURES) {
    const { ok, config: c, errors } = validateConfig(f);
    assert.ok(ok, JSON.stringify(errors));
    assert.equal(c.assets.right, null);
    near(c.anchor.right.x, 1 - f.anchor.left.x);
  }
});

test('validateConfig rejects out-of-bounds values with field-keyed errors', () => {
  const bad = {
    ...FIXTURES[0],
    scaleRatio: 2,
    anchor: { left: { x: 1.2, y: 0.5 }, right: { x: 0, y: 0 } },
    offset: { left: { x: 0.6, y: 0 }, right: { x: 0, y: 0 } },
    rotationDeg: { left: -46, right: 0 },
    lengthMm: -3,
    assets: { left: '', right: null },
  };
  const { ok, errors } = validateConfig(bad);
  assert.equal(ok, false);
  for (const k of ['scaleRatio', 'anchor.left.x', 'offset.left.x', 'rotationDeg.left', 'lengthMm', 'assets.left']) {
    assert.ok(errors[k], `expected error for ${k}`);
  }
  assert.equal(errors['anchor.left.y'], undefined);
  assert.equal(validateConfig(null).ok, false);
  assert.equal(validateConfig({ ...FIXTURES[0], scaleRatio: NaN }).ok, false);
});

test('validateConfig: unmirrored pair needs both images and both anchors', () => {
  const pair = { ...FIXTURES[0], mirrorLeftForRight: false };
  assert.equal(validateConfig(pair).errors['assets.right'], 'Upload an image.');
  const ok = validateConfig({ ...pair, assets: { left: '/l', right: '/r' }, anchor: { left: { x: 0.5, y: 0.1 }, right: { x: 0.3, y: 0.1 } } });
  assert.ok(ok.ok);
  assert.equal(ok.config.anchor.right.x, 0.3);
  assert.equal(validateConfig({ ...pair, assets: { left: '/l', right: '/r' }, anchor: { left: { x: 0.5, y: 0.1 }, right: { x: 0.3, y: 9 } } }).errors['anchor.right.y'] !== undefined, true);
});

// ---- WebAR.rocks engine adapter ------------------------------------------
const LABELS = ['leftEyeCtr', 'rightEyeCtr', 'leftEarBottom', 'leftEarEarring', 'rightEarBottom', 'rightEarEarring'];
// Mean positions from NN_EARS_4.json (viewport coords: x → right, y → up).
const MEAN = [[0.378, 0.374], [-0.365, 0.363], [0.835, 0.015], [0.874, -0.13], [-0.79, 0.02], [-0.839, -0.126]];
const detected = (over = {}) => ({ isDetected: true, ry: 0, landmarks: MEAN, ...over });

test('webar: viewport coords map to unmirrored video pixels, model "left" is the image-right ear', () => {
  const ears = normalizeDetectState(detected(), LABELS, 640, 480);
  assert.ok(ears.left.x > ears.right.x);
  // leftEarBottom (0.835, 0.015) → px ((0.5+0.4175)*640, (0.5-0.0075)*480); earring point mixed in at k
  const bottom = { x: (0.5 + 0.5 * 0.835) * 640, y: (0.5 - 0.5 * 0.015) * 480 };
  const earring = { x: (0.5 + 0.5 * 0.874) * 640, y: (0.5 - 0.5 * -0.13) * 480 };
  near(ears.left.x, bottom.x * (1 - EAR_K) + earring.x * EAR_K);
  near(ears.left.y, bottom.y * (1 - EAR_K) + earring.y * EAR_K);
  const rightBottom = { x: (0.5 + 0.5 * -0.79) * 640, y: (0.5 - 0.5 * 0.02) * 480 };
  near(ears.faceWidth, Math.hypot(bottom.x - rightBottom.x, bottom.y - rightBottom.y));
  near(ears.yawDeg, 0); assert.ok(Math.abs(ears.rollDeg) < 1);
});

test('webar: yaw sign follows the demo hide logic; swapped labels flip sides and sign', () => {
  assert.ok(normalizeDetectState(detected({ ry: 0.2 }), LABELS, 640, 480).yawDeg > 0); // left hides at ry > 0
  const swapped = MEAN.map((p, i) => (i === 2 || i === 3 ? [-p[0], p[1]] : i === 4 || i === 5 ? [-p[0], p[1]] : p));
  const e = normalizeDetectState(detected({ ry: 0.2, landmarks: swapped }), LABELS, 640, 480);
  assert.ok(e.left.x > e.right.x, 'sides come from geometry, not labels');
  assert.ok(e.yawDeg < 0);
  assert.equal(normalizeDetectState(detected({ isDetected: false }), LABELS, 640, 480), null);
  assert.equal(normalizeDetectState(detected({ landmarks: null }), LABELS, 640, 480), null);
});

test('webar ears feed computePlacement: mirrored view puts the wearer-left on screen left; engine pose gate is tighter', () => {
  const ears = normalizeDetectState(detected(), LABELS, 640, 480);
  const p = computePlacement({ ears, view, config, user, limits: WEBAR_LIMITS });
  assert.equal(p.state, 'tracking'); assert.ok(p.left.x < p.right.x);
  const turned = normalizeDetectState(detected({ ry: 8 * Math.PI / 180 }), LABELS, 640, 480); // 8° toward the left
  assert.equal(computePlacement({ ears: turned, view, config, user, limits: WEBAR_LIMITS }).left, null);
  assert.ok(computePlacement({ ears: turned, view, config, user }).left, 'MediaPipe default (20°) still shows it');
});

function fakeLib({ ready = 'ok', destroyMs = 0 } = {}) {
  const lib = { inits: 0, destroys: 0, order: [], opts: null,
    init(opts) {
      lib.inits++; lib.order.push('init'); lib.opts = opts;
      if (ready === 'ok') Promise.resolve().then(() => opts.callbackReady(false, { landmarksLabels: LABELS }));
      else if (ready !== 'never') Promise.resolve().then(() => opts.callbackReady(ready));
    },
    destroy() { lib.destroys++; lib.order.push('destroy-start'); return new Promise(r => setTimeout(() => { lib.order.push('destroy-end'); r(); }, destroyMs)); },
  };
  return lib;
}
const video = { videoWidth: 640, videoHeight: 480 };
const deps = (lib, extra = {}) => ({
  loadLib: async () => lib,
  createStabilizer: async () => ({ update: (lm) => lm }),
  createCanvas: () => ({ width: 0, height: 0, removed: false, remove() { this.removed = true; } }),
  now: () => Date.now(),
  ...extra,
});
const trackState = (over) => ({ isDetected: true, ry: 0, landmarks: MEAN, s: 0.5, ...over });

test('webar adapter: runs, reports ears, stop() destroys once and ignores late frames', async () => {
  const lib = fakeLib(); const got = [];
  const engine = await startWebarEngine({ video, signal: new AbortController().signal, onEars: (e) => got.push(e), deps: deps(lib) });
  assert.deepEqual(lib.opts.videoSettings, { videoElement: video }, 'camera stays owned by the caller');
  lib.opts.callbackTrack(trackState());
  lib.opts.callbackTrack(trackState({ isDetected: false }));
  assert.equal(got.length, 2); assert.ok(got[0].left); assert.equal(got[1], null);
  await engine.stop(); await engine.stop();
  assert.equal(lib.destroys, 1);
  lib.opts.callbackTrack(trackState());
  assert.equal(got.length, 2, 'late result after stop is dropped');
});

test('webar adapter: abort during init rejects, destroys the library, and releases the canvas', async () => {
  const lib = fakeLib({ ready: 'never' }); const abort = new AbortController(); let canvas;
  const d = deps(lib, { createCanvas: () => (canvas = { width: 0, height: 0, removed: false, remove() { this.removed = true; } }) });
  const started = startWebarEngine({ video, signal: abort.signal, onEars() {}, deps: d });
  await new Promise(r => setTimeout(r, 5));
  abort.abort();
  await assert.rejects(started, { name: 'AbortError' });
  await new Promise(r => setTimeout(r, 5));
  assert.equal(lib.destroys, 1); assert.ok(canvas.removed);
});

test('webar adapter: init errors map to state codes and clean up', async () => {
  for (const [err, code] of [['GL_INCOMPATIBLE', 'unsupported-device'], ['WEBCAM_UNAVAILABLE', 'no-camera'], ['GLCONTEXT_LOST', 'model-failure']]) {
    const lib = fakeLib({ ready: err });
    await assert.rejects(startWebarEngine({ video, signal: new AbortController().signal, onEars() {}, deps: deps(lib) }), { code });
    assert.equal(lib.destroys, 1);
  }
});

test('webar adapter: a new start waits for the previous destroy to finish', async () => {
  const lib = fakeLib({ destroyMs: 30 });
  const first = await startWebarEngine({ video, signal: new AbortController().signal, onEars() {}, deps: deps(lib) });
  first.stop(); // not awaited: simulates an immediate engine switch back
  const second = await startWebarEngine({ video, signal: new AbortController().signal, onEars() {}, deps: deps(lib) });
  assert.deepEqual(lib.order, ['init', 'destroy-start', 'destroy-end', 'init']);
  await second.stop();
});

test('webar adapter: a stalled render loop clears the overlay instead of freezing it', async () => {
  const lib = fakeLib(); let clock = 0; const got = [];
  const engine = await startWebarEngine({ video, signal: new AbortController().signal, onEars: (e) => got.push(e), deps: deps(lib, { now: () => clock }) });
  lib.opts.callbackTrack(trackState());
  clock += 5000; // no callbackTrack for 5 s
  await new Promise(r => setTimeout(r, 700));
  assert.equal(got.at(-1), null);
  await engine.stop();
});

test('webar adapter: one ALREADY_INITIALIZED is destroyed and retried, a second one fails', async () => {
  const lib = fakeLib({ ready: 'ALREADY_INITIALIZED' });
  await assert.rejects(startWebarEngine({ video, signal: new AbortController().signal, onEars() {}, deps: deps(lib) }), { message: 'ALREADY_INITIALIZED' });
  assert.equal(lib.inits, 2); assert.equal(lib.destroys, 2);
  let calls = 0; const flaky = fakeLib();
  const realInit = flaky.init; flaky.init = (o) => (calls++ === 0 ? Promise.resolve().then(() => o.callbackReady('ALREADY_INITIALIZED')) : realInit(o));
  const engine = await startWebarEngine({ video, signal: new AbortController().signal, onEars() {}, deps: deps(flaky) });
  assert.equal(calls, 2); await engine.stop();
});

test('crop: rect from edge trims, anchor re-mapped, size kept on the face', () => {
  const rect = cropRect(1000, 500, { l: 10, t: 20, r: 30, b: 0 });
  assert.deepEqual(rect, { x0: 100, y0: 100, w: 600, h: 400 });
  const out = cropAdjust({ W: 1000, H: 500, rect, anchor: { x: 0.5, y: 0.5 }, scaleRatio: 0.2 });
  near(out.anchor.x, (500 - 100) / 600); near(out.anchor.y, (250 - 100) / 400);
  near(out.scaleRatio, 0.2 * 400 / 500); // 20% shorter image → proportionally smaller ratio, same size on the face
  assert.deepEqual(cropAdjust({ W: 1000, H: 500, rect, anchor: { x: 0.02, y: 0.1 }, scaleRatio: 0.2 }).anchor, { x: 0, y: 0 }); // anchor cropped away → clamped to the edge
  assert.equal(cropAdjust({ W: 10, H: 1000, rect: { x0: 0, y0: 0, w: 10, h: 1 }, anchor: { x: 0, y: 0 }, scaleRatio: 0.2 }).scaleRatio, 0.02); // stays inside the config bounds
});

test('crop: auto-trim hugs the visible pixels and rounds outward', () => {
  const W = 100, H = 50, data = new Uint8ClampedArray(W * H * 4);
  const dot = (x, y) => { data[(y * W + x) * 4 + 3] = 255; };
  assert.equal(trimFromAlpha(data, W, H), null);
  dot(20, 10); dot(79, 39); // visible box x 20..79, y 10..39
  assert.deepEqual(trimFromAlpha(data, W, H), { l: 20, t: 20, r: 20, b: 20 });
  data[(5 * W + 33) * 4 + 3] = 5; // faint pixel below the threshold is ignored
  assert.equal(trimFromAlpha(data, W, H).l, 20);
  data[(0 * W + 0) * 4 + 3] = 255; // a visible corner pixel → nothing is trimmed on the left/top
  const t = trimFromAlpha(data, W, H); assert.equal(t.l, 0); assert.equal(t.t, 0);
});

function shape(W, H, on) { const d = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (on(x, y)) d[(y * W + x) * 4 + 3] = 255; return d; }

test('auto size: length in mm → scale ratio inside the config bounds', () => {
  near(scaleFromLength(30), 0.2); near(scaleFromLength(15), 0.1);
  assert.equal(scaleFromLength(0), null); assert.equal(scaleFromLength(''), null); assert.equal(scaleFromLength('abc'), null);
  assert.equal(scaleFromLength(1), 0.02); assert.equal(scaleFromLength(900), 1);
  assert.ok(validateConfig({ ...FIXTURES[0], scaleRatio: scaleFromLength(45) }).ok);
});

test('auto anchor: solid square → centre; hanging shapes → the hook at the top', () => {
  const stud = shape(40, 40, (x, y) => Math.hypot(x - 19.5, y - 19.5) < 20);
  assert.deepEqual(autoAnchor(stud, 40, 40), { x: 0.5, y: 0.5 });
  const drop = shape(40, 100, (x, y) => (y < 20 && x >= 18 && x < 22) || (y >= 20 && Math.hypot(x - 19.5, y - 70) < 19));
  const a = autoAnchor(drop, 40, 100); near(a.x, 0.5, 0.02); assert.ok(a.y <= 0.1);
  const offCentreHook = shape(60, 100, (x, y) => (y < 10 && x >= 8 && x < 12) || (y >= 10 && x > 4 && x < 56 && y < 90));
  assert.ok(autoAnchor(offCentreHook, 60, 100).x < 0.25, 'follows the hook, not the body');
  const hoop = shape(100, 100, (x, y) => { const r = Math.hypot(x - 49.5, y - 49.5); return r < 49 && r > 41; });
  const h = autoAnchor(hoop, 100, 100); near(h.x, 0.5, 0.02); assert.ok(h.y <= 0.1, 'a hoop hangs from its top');
  assert.deepEqual(autoAnchor(new Uint8ClampedArray(4 * 4 * 4), 4, 4), { x: 0.5, y: 0.1 }, 'empty image falls back safely');
});
