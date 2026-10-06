/* ============================================================
   Engine adapter: WebAR.rocks.face dedicated ear model (candidate, lab only).
   Pinned + self-hosted: public/try-on/webar/819cdbad4e87 (see MANIFEST.json).
   Reference: demos/earrings2D/main.js at that commit.

   Boundary (shared with the MediaPipe path via renderer.renderEars):
     startWebarEngine({ video, signal, onEars, onError }) → { stop() }
     onEars(ears | null, ts)   ears = { left, right, faceWidth, rollDeg, yawDeg }
       in UNMIRRORED VIDEO PIXELS, left/right = the wearer's ears, same shape
       as placement.earAnchors(). null = no face / stale.
   The camera stays owned by camera.js: the library only reads our <video>
   (videoSettings.videoElement), so there is exactly one getUserMedia stream.

   Fields that are ESTIMATES, not documented outputs:
     - ear point: mix(<side>EarBottom, <side>EarEarring, 0.7) — the demo's choice
     - faceWidth: distance between the two EarBottom points (not cheek width, so
       scaleRatio is not exactly comparable to MediaPipe's) × FACE_WIDTH_FACTOR
     - yaw: the library's `ry`; its sign is taken from the demo's hide logic
     - roll: from the line between the two EarBottom points (not the library's rz)
   ============================================================ */

export const WEBAR_BASE = '/try-on/webar/819cdbad4e87';
// Pose gates for this engine. The demo hides the far ear past 5° (it has
// hysteresis of 0.5° which we skip — placement smoothing absorbs the flicker).
export const WEBAR_LIMITS = { hideFarEarYaw: 5, maxYaw: 35, maxRoll: 45 };
export const EAR_K = 0.7;
export const FACE_WIDTH_FACTOR = 1; // calibration knob: ear span → MediaPipe-style face width

const RAD2DEG = 180 / Math.PI;
const INIT_TIMEOUT_MS = 20000;
const STALE_MS = 1000;
const abortError = () => new DOMException('Aborted', 'AbortError');
const mix = (a, b, k) => ({ x: a.x * (1 - k) + b.x * k, y: a.y * (1 - k) + b.y * k });

/**
 * Library detect state (viewport coords: x → right, y → up, both -1..1) →
 * ears in unmirrored video pixels, or null. Pure.
 * `landmarks` may be the stabilised array; `ry` is radians.
 */
export function normalizeDetectState({ isDetected, ry, landmarks }, labels, videoW, videoH) {
  if (!isDetected || !landmarks || !labels) return null;
  const pt = (name) => {
    const p = landmarks[labels.indexOf(name)];
    return p ? { x: (0.5 + 0.5 * p[0]) * videoW, y: (0.5 - 0.5 * p[1]) * videoH } : null;
  };
  const bottoms = { left: pt('leftEarBottom'), right: pt('rightEarBottom') };
  const earrings = { left: pt('leftEarEarring'), right: pt('rightEarEarring') };
  if (!bottoms.left || !bottoms.right || !earrings.left || !earrings.right) return null;
  // The model labels 'left' as the wearer's left (image-right in the unmirrored
  // video), but decide from geometry so a label mix-up can't swap the ears.
  const labelled = bottoms.right.x < bottoms.left.x;
  const [right, left] = labelled ? ['right', 'left'] : ['left', 'right'];
  const dx = bottoms[left].x - bottoms[right].x, dy = bottoms[left].y - bottoms[right].y;
  const span = Math.hypot(dx, dy);
  if (!Number.isFinite(span) || span < 1) return null;
  return {
    right: mix(bottoms[right], earrings[right], EAR_K),
    left: mix(bottoms[left], earrings[left], EAR_K),
    faceWidth: span * FACE_WIDTH_FACTOR,
    rollDeg: Math.atan2(dy, dx) * RAD2DEG,
    yawDeg: (labelled ? 1 : -1) * ry * RAD2DEG, // + = turned toward the wearer's left (hides the left ear)
  };
}

const codeOf = (err) => (err === 'GL_INCOMPATIBLE' ? 'unsupported-device' : err === 'WEBCAM_UNAVAILABLE' ? 'no-camera' : 'model-failure');

// destroy() is async; initialising before it finishes returns ALREADY_INITIALIZED.
let teardown = Promise.resolve();

let stabilizerLoad = null;
function loadStabilizer() {
  stabilizerLoad ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${WEBAR_BASE}/WebARRocksLMStabilizer.js`;
    script.onload = resolve;
    script.onerror = () => { stabilizerLoad = null; reject(new Error('stabilizer failed to load')); };
    document.head.append(script);
  });
  return stabilizerLoad;
}

const realDeps = () => ({
  async loadLib() {
    // Static file, not bundled: a variable URL keeps Vite out of it.
    // The .json/.js requests happen only when this engine is chosen.
    const head = await fetch(`${WEBAR_BASE}/NN_EARS_4.json`, { method: 'HEAD' });
    if (!head.ok || /text\/html/i.test(head.headers.get('content-type') || '')) throw new Error('ear model missing');
    return (await import(/* @vite-ignore */ `${WEBAR_BASE}/WebARRocksFace.module.js`)).default;
  },
  async createStabilizer() {
    await loadStabilizer();
    // eslint-disable-next-line no-undef -- classic-script global lexical binding
    return WebARRocksLMStabilizer.instance({});
  },
  createCanvas: () => Object.assign(document.createElement('canvas'), { hidden: true }),
  now: () => performance.now(),
});

export async function startWebarEngine({ video, signal, onEars, onError = () => {}, deps, retried = false }) {
  const d = { ...realDeps(), ...deps };
  await teardown;
  if (signal?.aborted) throw abortError();
  const lib = await d.loadLib();
  const stabilizer = await d.createStabilizer();
  if (signal?.aborted) throw abortError();

  // Engine canvas = video aspect so the viewport maps 1:1 onto the video (no crop).
  const k = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = d.createCanvas();
  canvas.width = Math.max(1, Math.round(video.videoWidth * k));
  canvas.height = Math.max(1, Math.round(video.videoHeight * k));
  globalThis.document?.body?.append(canvas);

  let stopped = false, labels = null, lastTrack = d.now(), stale = false, watchdog = null, destroyed = null;
  const stop = () => {
    if (destroyed) return destroyed;
    stopped = true;
    clearInterval(watchdog);
    destroyed = teardown = Promise.resolve()
      .then(() => lib.destroy())
      .catch(() => {})
      .then(() => canvas.remove());
    return destroyed;
  };

  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => reject(Object.assign(new Error('init timed out'), { code: 'model-failure' })), INIT_TIMEOUT_MS);
      const finish = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value); } };
      signal?.addEventListener('abort', () => finish(reject, abortError()), { once: true });
      lib.init({
        canvas,
        NNCPath: `${WEBAR_BASE}/NN_EARS_4.json`,
        videoSettings: { videoElement: video },
        stabilizationSettings: { translationFactorRange: [0.002, 0.005], rotationFactorRange: [0.03, 0.05], qualityFactorRange: [0.8, 0.9], alphaRange: [0.05, 0.92] },
        callbackReady(err, spec) {
          if (err) {
            const code = codeOf(err);
            if (settled) { if (!stopped) onError(code); } // e.g. GLCONTEXT_LOST after start
            else finish(reject, Object.assign(new Error(String(err)), { code }));
            return;
          }
          labels = spec.landmarksLabels;
          finish(resolve);
        },
        callbackTrack(state) {
          if (stopped || signal?.aborted) return;
          lastTrack = d.now(); stale = false;
          const landmarks = state.isDetected ? stabilizer.update(state.landmarks, canvas.width, canvas.height, state.s) : null;
          onEars(normalizeDetectState({ isDetected: state.isDetected, ry: state.ry, landmarks }, labels, video.videoWidth, video.videoHeight), lastTrack);
        },
      });
    });
  } catch (error) {
    await stop();
    // Seen once on a cancelled start: the library kept its "initialised" flag. destroy() has run
    // above, so one retry is enough; anything else is a real failure.
    if (error.message === 'ALREADY_INITIALIZED' && !retried && !signal?.aborted) {
      return startWebarEngine({ video, signal, onEars, onError, deps, retried: true });
    }
    throw error;
  }
  if (signal?.aborted) { await stop(); throw abortError(); }
  // The render loop can stall (throttled tab, lost context): don't leave the last overlay frozen.
  watchdog = setInterval(() => {
    if (!stopped && !stale && d.now() - lastTrack > STALE_MS) { stale = true; onEars(null, d.now()); }
  }, STALE_MS / 2);
  return { stop };
}
