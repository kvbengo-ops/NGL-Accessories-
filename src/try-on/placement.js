/* ============================================================
   Earring try-on — placement math (pure: no DOM, no MediaPipe).
   Camera pixels → displayed (object-fit: cover, mirrored) pixels,
   ear anchors from face landmarks, earring rects, smoothing.

   Conventions
   - Landmarks are MediaPipe's normalised 0..1 face-mesh points of the
     UNMIRRORED video. Mirroring happens exactly once, in mapToView().
   - 'left' / 'right' are the WEARER's ears. In the raw video the wearer's
     left ear is on the image's right (landmark 454), the right ear on the
     image's left (234). In a mirrored preview they land on the matching
     screen side, like a bathroom mirror.
   - Offsets are in face-width units, along the face's own axes as seen on
     screen (x = across the ears, y = down the face), so they follow head tilt.
   - rotationDeg is screen rotation, positive = clockwise.
   ============================================================ */

// Face-oval extremes near the ears. Tune in Phase 1 (behind this API).
const LM_RIGHT = 234;
const LM_LEFT = 454;
// These land at mid-ear height; the lobe sits a little lower (face widths).
// ponytail: one constant for everyone — per-face lobe detection is Phase-1 tuning.
export const EAR_DROP = 0.1;

// Pose gating (degrees), from the z-spread between the two ear landmarks.
export const HIDE_FAR_EAR_YAW = 20; // beyond this the far ear is occluded → hide it
export const MAX_YAW = 35;          // beyond this, ask the customer to face forward
export const MAX_ROLL = 45;

const RAD = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const coverScale = ({ videoW, videoH, viewW, viewH }) => Math.max(viewW / videoW, viewH / videoH);

/** Video-pixel point → view-pixel point (object-fit: cover, centred; mirrored once). */
export function mapToView(pt, view) {
  const s = coverScale(view);
  const x = pt.x * s + (view.viewW - view.videoW * s) / 2;
  const y = pt.y * s + (view.viewH - view.videoH * s) / 2;
  return { x: view.mirrored ? view.viewW - x : x, y };
}

/**
 * Face landmarks → ear anchor points in VIDEO pixels, or null when unusable.
 * yawDeg > 0 = head turned toward the wearer's left (hides the left ear).
 */
export function earAnchors(landmarks, videoW, videoH) {
  const a = landmarks?.[LM_RIGHT], b = landmarks?.[LM_LEFT];
  if (!a || !b) return null;
  const ax = a.x * videoW, ay = a.y * videoH, bx = b.x * videoW, by = b.y * videoH;
  const dx = bx - ax, dy = by - ay;
  const faceWidth = Math.hypot(dx, dy);
  if (!Number.isFinite(faceWidth) || faceWidth < 1) return null;
  const roll = Math.atan2(dy, dx);
  const drop = EAR_DROP * faceWidth;
  const down = { x: -Math.sin(roll) * drop, y: Math.cos(roll) * drop }; // face "down", in video px
  return {
    right: { x: ax + down.x, y: ay + down.y },
    left: { x: bx + down.x, y: by + down.y },
    faceWidth,
    rollDeg: roll / RAD,
    yawDeg: Math.atan2(((b.z || 0) - (a.z || 0)) * videoW, dx) / RAD,
  };
}

/**
 * Where to draw each earring. A side is null when it must be hidden.
 * `aspect` = {left,right} image width ÷ height (default 1); needed because
 * configs don't carry image dimensions. `limits` overrides the pose gates per
 * tracking engine: { hideFarEarYaw, maxYaw, maxRoll } (degrees).
 * Each side: { x, y, w, h, rotationDeg, imgAnchor, asset, flipX }
 *   x,y     view px of the ear point; draw so imgAnchor lands there
 *   imgAnchor  0..1 point in the image AS DRAWN (after flipX)
 *   asset   'left' | 'right' — which image to draw
 *   flipX   draw the image mirrored (symmetric pair using the left asset)
 */
export function computePlacement({ ears, view, config, user, aspect = {}, limits = {} }) {
  const { hideFarEarYaw = HIDE_FAR_EAR_YAW, maxYaw = MAX_YAW, maxRoll = MAX_ROLL } = limits;
  if (!ears) return { left: null, right: null, state: 'no-face' };
  if (Math.abs(ears.yawDeg) > maxYaw || Math.abs(ears.rollDeg) > maxRoll) {
    return { left: null, right: null, state: 'unsupported-pose' };
  }
  const fw = ears.faceWidth * coverScale(view); // face width in view px
  const roll = (view.mirrored ? -ears.rollDeg : ears.rollDeg) * RAD;
  const cos = Math.cos(roll), sin = Math.sin(roll);
  const scale = clamp(user?.scale ?? 1, 0.5, 2);

  const side = (name) => {
    const mirrorRight = name === 'right' && config.mirrorLeftForRight;
    const asset = mirrorRight || name === 'left' ? 'left' : 'right';
    const a = mirrorRight ? { x: 1 - config.anchor.left.x, y: config.anchor.left.y } : config.anchor[name];
    const ox = clamp(config.offset[name].x + (user?.offset?.[name]?.x ?? 0), -1, 1) * fw;
    const oy = clamp(config.offset[name].y + (user?.offset?.[name]?.y ?? 0), -1, 1) * fw;
    const p = mapToView(ears[name], view);
    const h = config.scaleRatio * fw * scale;
    return {
      x: p.x + ox * cos - oy * sin,
      y: p.y + ox * sin + oy * cos,
      w: h * (aspect[asset] || 1),
      h,
      rotationDeg: roll / RAD + config.rotationDeg[name],
      imgAnchor: { x: a.x, y: a.y },
      asset,
      flipX: mirrorRight,
    };
  };

  const left = ears.yawDeg > hideFarEarYaw ? null : side('left');
  const right = ears.yawDeg < -hideFarEarYaw ? null : side('right');
  return { left, right, state: 'tracking' };
}

/**
 * Exponential smoothing of x, y, w, h, rotation per side. A hidden side (or a
 * face-less frame) clears its history so nothing drifts in from an old spot;
 * call reset() on face loss / product switch.
 * ponytail: plain EMA lags at speed; swap for a One-Euro filter if Phase 1 shows it.
 */
export function createSmoother({ alpha = 0.5 } = {}) {
  let prev = { left: null, right: null };
  const KEYS = ['x', 'y', 'w', 'h', 'rotationDeg'];
  const mix = (cur, old) => {
    if (!cur) return null;
    if (!old) return cur;
    const out = { ...cur };
    for (const k of KEYS) out[k] = old[k] + (cur[k] - old[k]) * alpha;
    return out;
  };
  return {
    next(placement) {
      const out = { ...placement, left: mix(placement.left, prev.left), right: mix(placement.right, prev.right) };
      prev = { left: out.left, right: out.right };
      return out;
    },
    reset() { prev = { left: null, right: null }; },
  };
}
