import { computePlacement, createSmoother, earAnchors, mapToView } from './placement.js';

export function createRenderer({ canvas, video }) {
  const context = canvas.getContext('2d');
  const smoother = createSmoother({ alpha: 0.38 });
  let images = null;
  let config = null;
  let user = null;
  let mirrored = true;
  let debug = false;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width: rect.width, height: rect.height };
  }
  function clear() {
    const view = resize();
    context.clearRect(0, 0, view.width, view.height);
    smoother.reset();
  }
  function setProduct(nextConfig, nextImages) {
    config = nextConfig;
    images = nextImages;
    clear();
  }
  function setUser(nextUser) { user = nextUser; smoother.reset(); }
  function drawSide(side, placement) {
    const image = images?.[placement?.asset];
    if (!image || !placement) return;
    context.save();
    context.translate(placement.x, placement.y);
    context.rotate((placement.rotationDeg || 0) * Math.PI / 180);
    if (placement.flipX) context.scale(-1, 1);
    const anchor = placement.imgAnchor || { x: 0.5, y: 0 };
    context.drawImage(image, -(placement.flipX ? 1 - anchor.x : anchor.x) * placement.w, -anchor.y * placement.h, placement.w, placement.h);
    context.restore();
  }
  // Lab aid: draw the tracked ear points (and pose numbers) even with no artwork, so
  // "nothing shows" can be told apart as "no face found" vs "found but not drawn".
  function drawDebug(ears, view) {
    context.save();
    context.font = '13px sans-serif';
    context.fillStyle = '#fff';
    context.strokeStyle = '#000';
    context.lineWidth = 3;
    const text = ears
      ? `ears found · yaw ${ears.yawDeg.toFixed(1)}° · roll ${ears.rollDeg.toFixed(1)}° · face ${Math.round(ears.faceWidth)}px`
      : 'no face / ears found';
    context.strokeText(text, 10, 20); context.fillText(text, 10, 20);
    if (ears && video.videoWidth) {
      const v = { videoW: video.videoWidth, videoH: video.videoHeight, viewW: view.width, viewH: view.height, mirrored };
      for (const [side, color] of [['left', '#00e676'], ['right', '#ff4081']]) {
        const p = mapToView(ears[side], v);
        context.fillStyle = color;
        context.beginPath(); context.arc(p.x, p.y, 7, 0, 2 * Math.PI); context.fill();
        context.strokeText(side[0].toUpperCase(), p.x + 10, p.y + 4); context.fillStyle = '#fff'; context.fillText(side[0].toUpperCase(), p.x + 10, p.y + 4);
      }
    }
    context.restore();
  }
  // MediaPipe path: face-mesh landmarks → ears.
  function render(landmarks) {
    const ears = landmarks && video.videoWidth && video.videoHeight ? earAnchors(landmarks, video.videoWidth, video.videoHeight) : null;
    return renderEars(ears);
  }
  // Any engine: ears in unmirrored video px (see engine-webar.js). `limits` = per-engine pose gates.
  function renderEars(ears, limits) {
    const viewSize = resize();
    context.clearRect(0, 0, viewSize.width, viewSize.height);
    if (debug) drawDebug(ears, viewSize);
    if (!ears || !config || !images || !video.videoWidth || !video.videoHeight) { smoother.reset(); return 'no-face'; }
    const placement = computePlacement({
      limits,
      ears,
      view: { videoW: video.videoWidth, videoH: video.videoHeight, viewW: viewSize.width, viewH: viewSize.height, mirrored },
      config,
      user: user || { offset: { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } }, scale: 1 },
      aspect: {
        left: images.left ? images.left.naturalWidth / images.left.naturalHeight : 1,
        right: images.right ? images.right.naturalWidth / images.right.naturalHeight : 1,
      },
    });
    if (placement.state !== 'tracking') { smoother.reset(); return placement.state; }
    const smooth = smoother.next(placement);
    drawSide('left', smooth.left);
    drawSide('right', smooth.right);
    return 'tracking';
  }
  return { render, renderEars, clear, resize, setProduct, setUser, setMirrored: value => { mirrored = value; clear(); }, setDebug: value => { debug = !!value; } };
}
