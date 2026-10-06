import { FaceLandmarker } from '@mediapipe/tasks-vision';

let landmarker;
let lastTimestamp = -1;

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      const [modelResponse, wasmResponse, loaderResponse] = await Promise.all([
        fetch(data.modelUrl), fetch(`${data.wasmBase}/vision_wasm_internal.wasm`), fetch(`${data.wasmBase}/vision_wasm_internal.js`),
      ]);
      if (!modelResponse.ok || /html/i.test(modelResponse.headers.get('content-type') || '') || !wasmResponse.ok || !loaderResponse.ok || !/wasm|octet-stream/i.test(wasmResponse.headers.get('content-type') || '') || !/javascript/i.test(loaderResponse.headers.get('content-type') || '')) throw new Error('Invalid model assets');
      // Vite refuses JS module imports from public/ during development. Import the
      // checked self-hosted loader as a blob while keeping the binary URL stable.
      const loaderUrl = URL.createObjectURL(new Blob([await loaderResponse.text()], { type: 'text/javascript' }));
      try { landmarker = await FaceLandmarker.createFromOptions({ wasmLoaderPath: loaderUrl, wasmBinaryPath: `${data.wasmBase}/vision_wasm_internal.wasm` }, {
        baseOptions: { modelAssetPath: data.modelUrl, delegate: 'CPU' },
        runningMode: 'VIDEO', numFaces: 1,
        outputFaceBlendshapes: false, outputFacialTransformationMatrixes: true,
      }); } finally { URL.revokeObjectURL(loaderUrl); }
      self.postMessage({ type: 'ready' });
    } catch {
      self.postMessage({ type: 'error', code: 'model-failure' });
    }
    return;
  }
  if (data.type !== 'frame') return;
  const { bitmap, ts, session } = data;
  try {
    if (!landmarker) throw new Error('Tracker unavailable');
    const started = performance.now();
    const result = landmarker.detectForVideo(bitmap, Math.max(ts, lastTimestamp + 1));
    lastTimestamp = Math.max(ts, lastTimestamp + 1);
    self.postMessage({ type: 'result', ts, session, landmarks: result.faceLandmarks?.[0] || null, inferenceMs: performance.now() - started });
  } catch {
    self.postMessage({ type: 'error', code: 'unsupported-device', session });
  } finally {
    bitmap.close();
  }
};
