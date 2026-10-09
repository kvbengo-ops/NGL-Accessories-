import './try-on.css';
import { mirrorFrame } from './mirror-frame.js';
import { runCountdown } from './countdown.js';
import { startCamera } from './camera.js';
import { createRenderer } from './renderer.js';
import { loadAsset } from './assets.js';
import { cfImg } from '../supabase.js';
// The WebAR.rocks engine is loaded on demand (lab only) — see ./engine-webar.js.

const MODEL_URL = '/try-on/v1/face_landmarker.task';
const WASM_BASE = '/try-on/v1/wasm';
const MESSAGES = {
  intro: 'Preview these earrings using your camera. Camera images stay on your device.',
  loading: 'Loading face tracking…', permission: 'Waiting for camera permission…',
  tracking: 'Face forward. Move hair away from your ears for a clearer preview.',
  'no-face': 'Your mirror is ready. Face forward in good light to see your earrings.',
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
const codeOf = error => error?.code || (error?.name === 'AbortError' ? 'paused' : 'model-failure');

// Shared by the customer dialog, the admin editor and the isolated lab.
export function createPreviewSession({ view, canvas, onState = () => {}, onMetrics: emitMetrics = () => {}, engine = 'webar', countdownSeconds = 0 }) {
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
      if (!await runCountdown(countdownSeconds, abort.signal, remaining => {
        if (current(id)) onState('countdown', { remaining });
      }) || !current(id)) return;
      onState('no-face');
      schedule(id);
    } catch (error) {
      if (current(id)) { const code = codeOf(error); stop(); onState(code, error); }
    }
  }
  // Candidate engine: camera first (the library reads our <video>), then its model.
  async function startWebar(id) {
    let latestEars = null, drawQueued = false;
    let previewReady = false;
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
          if (!current(id) || !previewReady) return;
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
      if (!await runCountdown(countdownSeconds, abort.signal, remaining => {
        if (current(id)) onState('countdown', { remaining });
      }) || !current(id)) return;
      previewReady = true;
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

export function openTryOn({ product, products, configs, onAddToBag, returnFocus, autoStart = false, onClose, embed }) {
  const available = products.filter(p => p.itemCategory === 'Earrings' && configs.has(p.id));
  if (!available.length) return;
  let selected = product;
  let state = null;
  const priorOverflow = document.body.style.overflow;
  const sourceDialog = returnFocus?.closest?.('[role="dialog"]');
  const priorHidden = sourceDialog?.getAttribute('aria-hidden');
  const priorInert = sourceDialog?.inert;
  if (sourceDialog) { sourceDialog.inert = true; sourceDialog.setAttribute('aria-hidden', 'true'); }
  const root = document.createElement('div');
  root.className = embed ? 'try-on-backdrop try-on-embed' : 'try-on-backdrop';
  root.innerHTML = `<section class="try-on-dialog" role="dialog" aria-modal="true" aria-labelledby="try-on-title" tabindex="-1">
    <header class="try-on-header"><div class="try-on-heading"><svg class="try-on-brand-flower" viewBox="0 0 32 40" fill="none" aria-hidden="true"><path d="M16 24v13M16 34C6 32 6 27 5 25c8 0 11 5 11 9M16 31c8-2 9-6 10-9-6 1-9 5-10 9" stroke="#819176" stroke-width="1.3" stroke-linecap="round"/><path d="M16 24C6 22 6 12 8 5l8 6 8-6c3 10 1 17-8 19Z" fill="#ead0d3" stroke="currentColor" stroke-width="1.2"/><path d="M16 24c-5-8-3-15 0-21 4 7 6 14 0 21Z" stroke="currentColor" stroke-width="1"/></svg><div><span class="try-on-eyebrow">NGL ACCESSORIES · VIRTUAL TRY-ON</span><h2 id="try-on-title">The tulip mirror</h2></div></div><button type="button" class="try-on-close" aria-label="Close try-on">×</button></header>
    <div class="try-on-main"><div class="try-on-mirror-stage"><p class="try-on-mirror-label">A moment, just for you.</p><div class="try-on-view try-on-mirror"><div class="try-on-mirror-glass" aria-hidden="true"></div><canvas class="try-on-canvas" aria-hidden="true"></canvas><div class="try-on-mirror-welcome" aria-hidden="true"><svg class="try-on-welcome-icon" viewBox="0 0 32 32" fill="none" stroke="currentColor"><path d="M6 10h5l2-3h6l2 3h5v15H6Z"/><circle cx="16" cy="17" r="5"/><path d="M22 13h1"/></svg><p>Meet your next<br><em>favourite pair.</em></p><span>Turn on your camera<br>and let the mirror work its magic.</span></div><div class="try-on-countdown" hidden aria-hidden="true"><span class="try-on-countdown-label">A little sparkle in</span><span class="try-on-countdown-number"></span><span class="try-on-countdown-hint">Face the mirror &amp; get ready</span></div><div class="try-on-view-message" aria-hidden="true"></div>${mirrorFrame}</div><p class="try-on-mirror-caption"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true"><path d="M5 8V6a5 5 0 0 1 10 0v2M4 8h12v10H4Z"/><circle cx="10" cy="12" r="1"/><path d="M10 13v2"/></svg>Your camera stays private. Always.</p></div>
      <div class="try-on-panel"><div class="try-on-panel-intro"><span class="try-on-eyebrow">YOUR LITTLE DRESSING ROOM</span><p class="try-on-panel-title">A little <br><em>mirror magic.</em></p><p class="try-on-panel-description">Find the pair that feels like you. Try a little sparkle, right where you are.</p></div><div><span class="try-on-product-label">In your reflection</span><h3 class="try-on-name"></h3><p class="try-on-price"></p></div>
        <p class="try-on-status" role="status" aria-live="polite"></p>
        <button type="button" class="try-on-start"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M3 7h5l2-3h4l2 3h5v13H3Z"/><circle cx="12" cy="13" r="4"/></svg>Start camera</button><button type="button" class="try-on-retry" hidden>Retry</button>
        <div class="try-on-controls"><span class="try-on-product-label" id="try-on-collection-title">Explore the collection</span><ul class="try-on-list" aria-labelledby="try-on-collection-title"></ul></div>
        <button type="button" class="try-on-bag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M5 7h14l1 14H4ZM8 8V6a4 4 0 0 1 8 0v2"/></svg>Add to bag</button><p class="try-on-note">A little preview of your look.<br>Size and placement are approximate.</p>
      </div></div></section>`;
  (embed || document.body).append(root);
  if (!embed) document.body.style.overflow = 'hidden';
  const $ = selector => root.querySelector(selector);
  const view = $('.try-on-view');
  const preview = createPreviewSession({ view, canvas: $('.try-on-canvas'), onState: setState, countdownSeconds: 3 });
  const list = $('.try-on-list');
  const price = item => `₱${Number(item.price).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
  for (const item of available) {
    const li = document.createElement('li'), button = document.createElement('button');
    button.type = 'button';
    button.className = 'try-on-catalog-item';
    button.dataset.id = item.id;
    button.innerHTML = '<span class="try-on-thumb" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M11 5v5M21 5v5"/><ellipse cx="11" cy="18" rx="5" ry="8"/><ellipse cx="21" cy="18" rx="5" ry="8"/></svg></span><span class="try-on-row-copy"><span class="try-on-row-name"></span><span class="try-on-row-price"></span></span><svg class="try-on-row-check" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor"/><path d="m5.5 10 3 3 6-6" stroke="#fffdf5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    if (item.image) {
      const image = document.createElement('img');
      image.src = cfImg(item.image, 160);
      image.alt = '';
      image.loading = 'lazy';
      image.width = image.height = 56;
      image.addEventListener('error', () => image.remove(), { once: true });
      button.querySelector('.try-on-thumb').append(image);
    }
    button.querySelector('.try-on-row-name').textContent = item.name;
    button.querySelector('.try-on-row-price').textContent = price(item);
    button.addEventListener('click', () => choose(item));
    li.append(button);
    list.append(li);
  }
  function setState(next, detail) {
    if (!root.isConnected) return;
    if (state === next && next !== 'countdown') return;
    state = next;
    root.dataset.state = next;
    $('.try-on-mirror-welcome').hidden = next !== 'intro';
    const countdown = next === 'countdown';
    $('.try-on-status').textContent = countdown ? `Get ready — your earrings appear in ${detail.remaining}.` : MESSAGES[next] || MESSAGES['model-failure'];
    $('.try-on-countdown').hidden = !countdown;
    if (countdown) $('.try-on-countdown-number').textContent = detail.remaining;
    $('.try-on-view-message').textContent = ['tracking', 'intro', 'countdown'].includes(next) ? '' : $('.try-on-status').textContent;
    $('.try-on-start').hidden = next !== 'intro';
    $('.try-on-retry').hidden = !['paused', 'permission-denied', 'camera-busy', 'model-failure', 'unsupported-device', 'no-camera'].includes(next);
    $('.try-on-retry').textContent = next === 'paused' ? 'Resume camera' : 'Retry';
  }
  // Shoppers get no placement controls: the tracking engine and the product's saved settings place the earring.
  function choose(item) {
    selected = item;
    for (const button of list.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.id === item.id));
    $('.try-on-name').textContent = item.name;
    $('.try-on-price').textContent = price(item);
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
    onClose?.();
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
  root.addEventListener('click', event => { if (!embed && event.target === root) close(); });
  $('.try-on-start').addEventListener('click', () => preview.start());
  $('.try-on-retry').addEventListener('click', () => preview.start());
  $('.try-on-bag').addEventListener('click', () => {
    if (!onAddToBag(selected)) return;
    if (embed) $('.try-on-status').textContent = `${selected.name} was added to your bag.`; else close();
  });
  if (!embed) document.addEventListener('keydown', keydown, true);
  window.addEventListener('pagehide', close, { once: true });
  choose(selected);
  setState('intro');
  if (!embed) $('.try-on-close').focus();
  if (autoStart) preview.start();
}
