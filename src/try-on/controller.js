import './try-on.css';
import { startCamera } from './camera.js';
import { createRenderer } from './renderer.js';
import { loadAsset } from './assets.js';
// The WebAR.rocks engine is loaded on demand (lab only) — see ./engine-webar.js.

const MODEL_URL = '/try-on/v1/face_landmarker.task';
const WASM_BASE = '/try-on/v1/wasm';
const MESSAGES = {
  intro: 'Preview these earrings using your camera. Camera images stay on your device.',
  loading: 'Loading face tracking…', permission: 'Waiting for camera permission…',
  tracking: 'Face forward. Move hair away from your ears for a clearer preview.',
  'no-face': 'Move into the frame and face the camera in good light.',
  'unsupported-pose': 'Face forward to preview the earrings.',
  paused: 'Camera paused. Select Resume camera when you are ready.',
  'permission-denied': 'Camera permission was denied. Allow access in your browser settings, then retry.',
  'no-camera': 'No camera is available on this device.',
  'insecure-context': 'The camera only works on a secure (https://) page. Open this site over https and try again.',
  'camera-busy': 'The camera is in use by another app. Close it and retry.',
  'missing-asset': 'The earring artwork could not be loaded. Try another style.',
  'model-failure': 'Face tracking could not load. Check your connection and retry.',
  'unsupported-device': 'Face tracking is not supported on this device.',
};
const emptyUser = () => ({ offset: { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } }, scale: 1 });
const codeOf = error => error?.code || (error?.name === 'AbortError' ? 'paused' : 'model-failure');

// Shared by the customer dialog, the admin editor and the isolated lab.
export function createPreviewSession({ view, canvas, onState = () => {}, onMetrics: emitMetrics = () => {}, engine = 'webar' }) {
  let camera = null, worker = null, fallback = null, renderer = null, webar = null;
  let startedAt = 0, reportedStart = false, running = false;
  let abort = null, frameHandle = null, frameKind = null, inFlight = false;
  let generation = 0, lastSent = -1, lastResult = -1, config = null;
  let imageAbort = null, assetFailed = false, loadedAssets = null, loadedImages = null;
  const current = id => id === generation && !abort?.signal.aborted;
  // The first result after Start also reports startup time (click → first engine result).
  function onMetrics(metrics) {
    if (!reportedStart) { reportedStart = true; emitMetrics({ startMs: performance.now() - startedAt, mode: metrics.mode }); }
    emitMetrics(metrics);
  }

  function cancelFrame() {
    if (frameHandle === null) return;
    if (frameKind === 'video') camera?.video.cancelVideoFrameCallback?.(frameHandle);
    else cancelAnimationFrame(frameHandle);
    frameHandle = null;
  }
  function stop() {
    running = false;
    generation++;
    abort?.abort();
    imageAbort?.abort();
    cancelFrame();
    worker?.terminate();
    worker = null;
    fallback?.close();
    fallback = null;
    webar?.stop();
    webar = null;
    camera?.stop();
    camera?.video.remove();
    camera = null;
    renderer?.clear();
    inFlight = false;
    lastSent = lastResult = -1;
  }
  async function setProduct(nextConfig) {
    config = nextConfig;
    assetFailed = false;
    imageAbort?.abort();
    imageAbort = new AbortController();
    const ownAbort = imageAbort;
    const key = nextConfig ? `${nextConfig.assets.left}|${nextConfig.mirrorLeftForRight ? '' : nextConfig.assets.right}` : null;
    if (key && key === loadedAssets && loadedImages) { renderer?.setProduct(nextConfig, loadedImages); return; }
    renderer?.setProduct(null, null);
    if (!nextConfig) return;
    try {
      const left = await loadAsset(nextConfig.assets.left, ownAbort.signal);
      const right = nextConfig.mirrorLeftForRight ? null : await loadAsset(nextConfig.assets.right, ownAbort.signal);
      if (ownAbort.signal.aborted || config !== nextConfig) return;
      loadedAssets = key;
      loadedImages = { left, right };
      renderer?.setProduct(nextConfig, loadedImages);
    } catch (error) {
      if (!ownAbort.signal.aborted) { assetFailed = true; onState('missing-asset', error); }
    }
  }
  function setUser(user) { renderer?.setUser(user); }
  let debugOn = false; // lab aid, survives the renderer being recreated on each start()
  function setDebug(value) { debugOn = !!value; renderer?.setDebug(debugOn); }

  async function initWorker(id) {
    if (typeof Worker !== 'function' || typeof createImageBitmap !== 'function') throw new Error('Worker unavailable');
    const instance = new Worker(new URL('./tracker.worker.js', import.meta.url), { type: 'module' });
    worker = instance;
    await new Promise((resolve, reject) => {
      const signal = abort.signal;
      const settle = (callback, value) => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); callback(value); };
      const onAbort = () => settle(reject, Object.assign(new Error('Cancelled'), { code: 'aborted' }));
      const timer = setTimeout(() => settle(reject, new Error('Worker startup timed out')), 15000);
      signal.addEventListener('abort', onAbort, { once: true });
      instance.onmessage = ({ data }) => {
        if (!current(id)) return;
        if (data.type === 'ready') settle(resolve);
        else if (data.type === 'error') settle(reject, Object.assign(new Error(data.code), { code: data.code }));
      };
      instance.onerror = () => settle(reject, new Error('Worker failed'));
      instance.postMessage({ type: 'init', modelUrl: MODEL_URL, wasmBase: WASM_BASE });
    });
    if (!current(id)) return;
    instance.onmessage = ({ data }) => {
      if (!current(id)) return;
      if (data.type === 'error') { onState(data.code); stop(); return; }
      if (data.type !== 'result' || data.session !== id || data.ts < lastSent || data.ts <= lastResult) return;
      lastResult = data.ts;
      inFlight = false;
      onState(assetFailed ? 'missing-asset' : renderer.render(data.landmarks));
      onMetrics({ inferenceMs: data.inferenceMs, ts: data.ts, mode: 'worker' });
      schedule(id);
    };
  }
  async function initFallback(id) {
    const [{ FaceLandmarker }, modelResponse, wasmResponse, loaderResponse] = await Promise.all([
      import('@mediapipe/tasks-vision'), fetch(MODEL_URL), fetch(`${WASM_BASE}/vision_wasm_internal.wasm`), fetch(`${WASM_BASE}/vision_wasm_internal.js`),
    ]);
    if (!current(id)) return;
    if (!modelResponse.ok || /html/i.test(modelResponse.headers.get('content-type') || '') || !wasmResponse.ok || !loaderResponse.ok || !/wasm|octet-stream/i.test(wasmResponse.headers.get('content-type') || '') || !/javascript/i.test(loaderResponse.headers.get('content-type') || '')) throw new Error('Invalid model assets');
    const loaderUrl = URL.createObjectURL(new Blob([await loaderResponse.text()], { type: 'text/javascript' }));
    let tracker;
    try { tracker = await FaceLandmarker.createFromOptions({ wasmLoaderPath: loaderUrl, wasmBinaryPath: `${WASM_BASE}/vision_wasm_internal.wasm` }, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
      runningMode: 'VIDEO', numFaces: 1,
      outputFaceBlendshapes: false, outputFacialTransformationMatrixes: true,
    }); } finally { URL.revokeObjectURL(loaderUrl); }
    if (!current(id)) tracker.close(); else fallback = tracker;
  }
  function schedule(id) {
    if (!current(id) || !camera || inFlight) return;
    if (camera.video.requestVideoFrameCallback) {
      frameKind = 'video';
      frameHandle = camera.video.requestVideoFrameCallback((_now, metadata) => {
        frameHandle = null;
        processFrame(id, metadata.mediaTime * 1000);
      });
    } else {
      frameKind = 'raf';
      frameHandle = requestAnimationFrame(() => { frameHandle = null; processFrame(id, performance.now()); });
    }
  }
  async function processFrame(id, ts) {
    if (!current(id) || inFlight || !camera || ts <= lastSent) { schedule(id); return; }
    if (fallback && ts - lastSent < 65) { schedule(id); return; }
    inFlight = true;
    lastSent = ts;
    try {
      if (worker) {
        const bitmap = await createImageBitmap(camera.video);
        if (!current(id)) { bitmap.close(); return; }
        try { worker.postMessage({ type: 'frame', bitmap, ts, session: id }, [bitmap]); }
        catch (error) { bitmap.close(); throw error; }
      } else {
        const started = performance.now();
        // The main-thread fallback can consume Video directly on browsers that
        // lack ImageBitmap support for video frames.
        const result = fallback.detectForVideo(camera.video, ts);
        if (current(id)) {
          lastResult = ts;
          onState(assetFailed ? 'missing-asset' : renderer.render(result.faceLandmarks?.[0] || null));
          onMetrics({ inferenceMs: performance.now() - started, ts, mode: 'main thread' });
        }
        inFlight = false;
        schedule(id);
      }
    } catch (error) {
      inFlight = false;
      if (current(id)) { onState('unsupported-device', error); stop(); }
    }
  }
  async function start() {
    stop();
    abort = new AbortController();
    const id = generation;
    running = true;
    startedAt = performance.now();
    reportedStart = false;
    const hidden = () => { if (document.hidden && current(id)) { stop(); onState('paused'); } };
    document.addEventListener('visibilitychange', hidden, { signal: abort.signal });
    renderer = createRenderer({ canvas, video: { get videoWidth() { return camera?.video.videoWidth || 0; }, get videoHeight() { return camera?.video.videoHeight || 0; } } });
    renderer.setDebug(debugOn);
    if (config) await setProduct(config);
    if (engine === 'webar') return startWebar(id);
    onState('loading');
    try {
      try { await initWorker(id); }
      catch {
        worker?.terminate(); worker = null;
        if (current(id)) await initFallback(id);
      }
      if (!current(id)) return;
      onState('permission');
      camera = await startCamera({
        signal: abort.signal,
        onEnded: () => { if (current(id)) { stop(); onState('camera-busy'); } },
        onPause: () => { if (current(id)) { stop(); onState('paused'); } },
      });
      if (!current(id)) { camera.stop(); return; }
      camera.video.className = 'try-on-video';
      view.prepend(camera.video);
      renderer.resize();
      onState('no-face');
      schedule(id);
    } catch (error) {
      if (current(id)) { const code = codeOf(error); stop(); onState(code, error); }
    }
  }
  // Candidate engine: camera first (the library reads our <video>), then its model.
  async function startWebar(id) {
    let latestEars = null, drawQueued = false;
    try {
      onState('permission');
      camera = await startCamera({
        signal: abort.signal,
        onEnded: () => { if (current(id)) { stop(); onState('camera-busy'); } },
        onPause: () => { if (current(id)) { stop(); onState('paused'); } },
      });
      if (!current(id)) { camera.stop(); return; }
      camera.video.className = 'try-on-video';
      view.prepend(camera.video);
      renderer.resize();
      onState('loading');
      const { startWebarEngine, WEBAR_LIMITS } = await import('./engine-webar.js');
      const handle = await startWebarEngine({
        video: camera.video,
        signal: abort.signal,
        onError: code => { if (current(id)) { stop(); onState(code); } },
        // The library calls back far faster than the screen refreshes (~100/s with no face):
        // keep only the newest result and draw once per frame. Metrics still count every callback.
        onEars: (ears, ts) => {
          if (!current(id)) return;
          latestEars = ears;
          if (!drawQueued) {
            drawQueued = true;
            requestAnimationFrame(() => {
              drawQueued = false;
              if (current(id)) onState(assetFailed ? 'missing-asset' : renderer.renderEars(latestEars, WEBAR_LIMITS));
            });
          }
          onMetrics({ inferenceMs: null, ts, mode: 'webar' });
        },
      });
      if (!current(id)) { handle.stop(); return; }
      webar = handle;
      onState('no-face');
    } catch (error) {
      if (current(id)) { const code = codeOf(error); stop(); onState(code, error); }
    }
  }
  // Switching engines tears everything down first; a running session restarts on the new one.
  function setEngine(next) {
    if (next === engine) return;
    const wasRunning = running;
    stop();
    engine = next;
    if (wasRunning) start();
  }
  return { start, stop, setProduct, setUser, setEngine, setDebug, get engine() { return engine; }, get video() { return camera?.video || null; } };
}

export function openTryOn({ product, products, configs, onAddToBag, returnFocus }) {
  const available = products.filter(p => p.itemCategory === 'Earrings' && configs.has(p.id));
  if (!available.length) return;
  let selected = product;
  let state = null;
  let user = emptyUser();
  const priorOverflow = document.body.style.overflow;
  const sourceDialog = returnFocus?.closest?.('[role="dialog"]');
  const priorHidden = sourceDialog?.getAttribute('aria-hidden');
  const priorInert = sourceDialog?.inert;
  if (sourceDialog) { sourceDialog.inert = true; sourceDialog.setAttribute('aria-hidden', 'true'); }
  const root = document.createElement('div');
  root.className = 'try-on-backdrop';
  root.innerHTML = `<section class="try-on-dialog" role="dialog" aria-modal="true" aria-labelledby="try-on-title" tabindex="-1">
    <header class="try-on-header"><div><span class="try-on-eyebrow">NGL ACCESSORIES</span><h2 id="try-on-title">Virtual try-on</h2></div><button type="button" class="try-on-close" aria-label="Close try-on">×</button></header>
    <div class="try-on-main"><div class="try-on-view"><canvas class="try-on-canvas" aria-hidden="true"></canvas><div class="try-on-view-message" aria-hidden="true"></div></div>
      <div class="try-on-panel"><div><span class="try-on-eyebrow">STYLE PREVIEW</span><h3 class="try-on-name"></h3><p class="try-on-price"></p></div>
        <p class="try-on-status" role="status" aria-live="polite"></p>
        <button type="button" class="try-on-start">Start camera</button><button type="button" class="try-on-retry" hidden>Retry</button>
        <div class="try-on-controls" hidden><label>Style<select class="try-on-select"></select></label>
          <label>Left horizontal position <input type="range" class="try-on-left-x" min="-0.25" max="0.25" step="0.01" value="0"></label>
          <label>Left vertical position <input type="range" class="try-on-left-y" min="-0.25" max="0.25" step="0.01" value="0"></label>
          <label>Right horizontal position <input type="range" class="try-on-right-x" min="-0.25" max="0.25" step="0.01" value="0"></label>
          <label>Right vertical position <input type="range" class="try-on-right-y" min="-0.25" max="0.25" step="0.01" value="0"></label>
          <label>Size <input type="range" class="try-on-size" min="0.5" max="2" step="0.05" value="1"></label>
          <button type="button" class="try-on-reset">Reset adjustments</button></div>
        <button type="button" class="try-on-bag">Add to bag</button><p class="try-on-note">Style preview — size and placement are approximate.</p>
      </div></div></section>`;
  document.body.append(root);
  document.body.style.overflow = 'hidden';
  const $ = selector => root.querySelector(selector);
  const view = $('.try-on-view');
  const preview = createPreviewSession({ view, canvas: $('.try-on-canvas'), onState: setState });
  const select = $('.try-on-select');
  for (const item of available) { const option = new Option(item.name, item.id); select.add(option); }
  function setState(next) {
    if (!root.isConnected) return;
    if (state === next) return;
    state = next;
    $('.try-on-status').textContent = MESSAGES[next] || MESSAGES['model-failure'];
    $('.try-on-view-message').textContent = ['tracking', 'intro'].includes(next) ? '' : $('.try-on-status').textContent;
    $('.try-on-start').hidden = next !== 'intro';
    $('.try-on-retry').hidden = !['paused', 'permission-denied', 'camera-busy', 'model-failure', 'unsupported-device', 'no-camera'].includes(next);
    $('.try-on-retry').textContent = next === 'paused' ? 'Resume camera' : 'Retry';
    $('.try-on-controls').hidden = ['intro', 'loading', 'permission'].includes(next);
  }
  function resetControls() {
    user = emptyUser();
    for (const side of ['left', 'right']) for (const axis of ['x', 'y']) $(`.try-on-${side}-${axis}`).value = '0';
    $('.try-on-size').value = '1';
    preview.setUser(user);
  }
  function choose(item) {
    selected = item;
    select.value = item.id;
    $('.try-on-name').textContent = item.name;
    $('.try-on-price').textContent = `₱${Number(item.price).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
    resetControls();
    preview.setProduct(configs.get(item.id));
  }
  function close() {
    preview.stop();
    root.remove();
    document.body.style.overflow = priorOverflow;
    document.removeEventListener('keydown', keydown, true);
    window.removeEventListener('pagehide', close);
    if (sourceDialog) { sourceDialog.inert = priorInert; if (priorHidden === null) sourceDialog.removeAttribute('aria-hidden'); else sourceDialog.setAttribute('aria-hidden', priorHidden); }
    returnFocus?.focus();
  }
  function keydown(event) {
    if (!root.isConnected) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...root.querySelectorAll('button:not([hidden]):not(:disabled),select:not([hidden]),input:not([hidden])')].filter(el => el.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  $('.try-on-close').addEventListener('click', close);
  root.addEventListener('click', event => { if (event.target === root) close(); });
  $('.try-on-start').addEventListener('click', () => preview.start());
  $('.try-on-retry').addEventListener('click', () => preview.start());
  select.addEventListener('change', () => choose(available.find(item => item.id === select.value)));
  for (const side of ['left', 'right']) for (const axis of ['x', 'y']) {
    $(`.try-on-${side}-${axis}`).addEventListener('input', event => { user.offset[side][axis] = Number(event.target.value); preview.setUser(user); });
  }
  $('.try-on-size').addEventListener('input', event => { user.scale = Number(event.target.value); preview.setUser(user); });
  $('.try-on-reset').addEventListener('click', resetControls);
  $('.try-on-bag').addEventListener('click', () => { if (onAddToBag(selected)) close(); });
  document.addEventListener('keydown', keydown, true);
  window.addEventListener('pagehide', close, { once: true });
  choose(selected);
  setState('intro');
  $('.try-on-close').focus();
}
