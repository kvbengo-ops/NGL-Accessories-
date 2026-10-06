/* ============================================================
   Earring try-on — config validation + asset loading.
   validateConfig has NO DOM / Supabase imports so `node --test` can run it.
   Bounds MUST match the CHECK constraints in
   supabase/migrations/20260914001100_try-on.sql.
   ============================================================ */

export const BOUNDS = {
  anchor: [0, 1],        // normalised position inside the image
  offset: [-0.5, 0.5],   // face-width units
  rotationDeg: [-45, 45],
  scaleRatio: [0.02, 1], // image height ÷ face width
  lengthMm: [0, 500],    // exclusive of 0
};

const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

/**
 * raw (contract-shaped config) → { ok, config, errors }.
 * errors is keyed by dotted field path ('anchor.left.x', 'assets.right', …)
 * so the admin editor can show each message next to its field.
 */
export function validateConfig(raw) {
  const errors = {};
  const r = raw && typeof raw === 'object' ? raw : {};
  const inRange = (path, v, [lo, hi], label) => {
    const n = num(v);
    if (!Number.isFinite(n) || n < lo || n > hi) { errors[path] = `${label} must be between ${lo} and ${hi}.`; return 0; }
    return n;
  };
  const xy = (path, v, range, label) => ({
    x: inRange(`${path}.x`, v?.x, range, `${label} x`),
    y: inRange(`${path}.y`, v?.y, range, `${label} y`),
  });

  if (typeof r.productId !== 'string' || !r.productId) errors.productId = 'Missing product.';
  const mirror = r.mirrorLeftForRight === true;
  const asset = (path, v, required) => {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (required) errors[path] = 'Upload an image.';
    return null;
  };
  const left = asset('assets.left', r.assets?.left, true);
  const right = mirror ? null : asset('assets.right', r.assets?.right, true);

  const version = num(r.version ?? 1);
  if (!Number.isInteger(version) || version < 1) errors.version = 'Version must be a whole number ≥ 1.';

  let lengthMm = null;
  if (r.lengthMm !== null && r.lengthMm !== undefined && r.lengthMm !== '') {
    const n = num(r.lengthMm);
    if (!(n > BOUNDS.lengthMm[0] && n <= BOUNDS.lengthMm[1])) errors.lengthMm = `Length must be above 0 and at most ${BOUNDS.lengthMm[1]} mm.`;
    else lengthMm = n;
  }

  const anchor = {
    left: xy('anchor.left', r.anchor?.left, BOUNDS.anchor, 'Left anchor'),
    // a mirrored pair derives the right anchor from the left one
    right: mirror ? null : xy('anchor.right', r.anchor?.right, BOUNDS.anchor, 'Right anchor'),
  };
  if (mirror) anchor.right = { x: 1 - anchor.left.x, y: anchor.left.y };

  const config = {
    productId: r.productId,
    version,
    enabled: r.enabled === true,
    assets: { left, right },
    mirrorLeftForRight: mirror,
    anchor,
    offset: {
      left: xy('offset.left', r.offset?.left, BOUNDS.offset, 'Left offset'),
      right: xy('offset.right', r.offset?.right, BOUNDS.offset, 'Right offset'),
    },
    rotationDeg: {
      left: inRange('rotationDeg.left', r.rotationDeg?.left, BOUNDS.rotationDeg, 'Left rotation'),
      right: inRange('rotationDeg.right', r.rotationDeg?.right, BOUNDS.rotationDeg, 'Right rotation'),
    },
    scaleRatio: inRange('scaleRatio', r.scaleRatio, BOUNDS.scaleRatio, 'Scale'),
    lengthMm,
  };
  const ok = Object.keys(errors).length === 0;
  return { ok, config: ok ? config : null, errors };
}

const abortError = () => new DOMException('Aborted', 'AbortError');

/**
 * Load + decode one jewelry image. Rejects on abort, 404, or a non-image body
 * (the SPA fallback answers missing files with HTML — decode() fails on that).
 * All try-on image URLs go through cfImg (the /img/ edge cache) with NO size:
 * Supabase transforms aren't on the Free plan and would drop the alpha anyway.
 */
export async function loadAsset(url, signal) {
  const { cfImg } = await import('../supabase.js'); // keeps validateConfig node-testable
  if (signal?.aborted) throw abortError();
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = cfImg(url);
  const aborted = new Promise((_, reject) => signal?.addEventListener('abort', () => reject(abortError()), { once: true }));
  try {
    await Promise.race([img.decode(), aborted]);
  } catch (e) {
    img.src = '';
    throw e;
  }
  return img;
}

/* ---- Crop helpers (pure; used by the admin editor's crop dialog) ----------- */

/** Pixel rect for trimming l/t/r/b percent off each edge of a W×H image. */
export function cropRect(W, H, { l, t, r, b }) {
  return {
    x0: Math.round(W * l / 100),
    y0: Math.round(H * t / 100),
    w: Math.max(1, Math.round(W * (100 - l - r) / 100)),
    h: Math.max(1, Math.round(H * (100 - t - b) / 100)),
  };
}

/**
 * Re-express the attachment anchor in the cropped image, and scale `scaleRatio`
 * (image height ÷ face width) so the earring keeps its size on the face.
 */
export function cropAdjust({ W, H, rect, anchor, scaleRatio }) {
  const unit = (v) => Math.min(1, Math.max(0, v));
  return {
    anchor: { x: unit((anchor.x * W - rect.x0) / rect.w), y: unit((anchor.y * H - rect.y0) / rect.h) },
    scaleRatio: Math.min(BOUNDS.scaleRatio[1], Math.max(BOUNDS.scaleRatio[0], scaleRatio * rect.h / H)),
  };
}

/**
 * Edge trims (percent, 0.5 steps, rounded outward so nothing visible is cut) that
 * hug the pixels with alpha > threshold in RGBA `data`; null if nothing is visible.
 */
export function trimFromAlpha(data, W, H, threshold = 8) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const pct = (px, total) => Math.min(95, Math.floor(px / total * 200) / 2);
  return { l: pct(x0, W), t: pct(y0, H), r: pct(W - 1 - x1, W), b: pct(H - 1 - y1, H) };
}
