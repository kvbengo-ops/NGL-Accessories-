# Earring Try-On — Codex's Tasks (Camera · Tracking · Rendering · UI)

You are building the **browser side** of an earring virtual try-on. Shoppers open their camera
from a product modal and see the selected earring overlaid on their face. **Claude** owns the
data layer, placement math, security and CI. You build against the **Shared Contract** at the
bottom of this file.

**Full design:** `plan.md` (read §3–§4, §6 and §8 before starting).

## Project context (you won't have prior chat history)
- **App:** NGL Accessories, a Philippines jewelry shop. Plain **HTML + CSS + vanilla JS**, built
  with **Vite** (multi-page; see `vite.config.js`). **No frameworks.** Backend is **Supabase**.
  The site runs as a **Cloudflare Worker** (`worker.js`) serving `dist/`; pushing to `main`
  deploys it.
- **Brand:** editorial luxury, ivory/gold, Cormorant Garamond + DM Sans. Use the tokens in
  `src/style.css` (`var(--gold-500)`, `var(--font-serif)`, `var(--r-full)`, …) and match
  `shop.html`'s product modal.
- **Shop hooks:** `src/shop.js` has `openModal(product)`, `closeModal()` and `addToCart(product)`.
  Products there have `itemCategory` (e.g. `'Earrings'`) and `categoryLabel` (the collection).
  The modal is `#product-modal-backdrop` in `shop.html`.
- **Images:** always go through `cfImg(url)` from `src/supabase.js`. Raw Supabase Storage URLs
  burned through the Free-plan egress quota in Sep 2026, and CI fails on them.
- **Admin pages** live under `admin/` and use `requireAdmin` / `renderSidebar` / `showToast`
  from `src/admin.js`.
- **Run:** `npm run dev` (http://localhost:5173; camera works on localhost). **Tests:**
  `node --test test-try-on.mjs`. **CI:** `.github/workflows/ci.yml` must stay green.

## File ownership (do NOT edit Claude's files)
**You own:**
- `src/try-on/controller.js`, `camera.js`, `tracker.worker.js`, `renderer.js`, `try-on.css` (all new)
- `try-on-lab.html` (new; dev-only prototype, **not** added to `vite.config.js`)
- `admin/try-on.html` + `src/try-on-admin.js` (new)
- `shop.html`: **one** "Try it on" button in the product modal
- `src/shop.js`: **one** hook in `openModal` (show the button) and **one** click handler (dynamic import)
- `src/inventory.js`: **one** "Try-on" link per earring row → `admin/try-on.html?product=<id>`
- `vite.config.js`: add the `admin-try-on` input only

**Do NOT touch (Claude owns):** `src/supabase.js`, `src/try-on/placement.js`,
`src/try-on/assets.js`, `src/try-on/fixtures.js`, migrations, `public/try-on/`, `package.json`,
`worker.js`, `wrangler.jsonc`, `ci.yml`, `tests/test-try-on.mjs`, `plan.md`. Need a contract change?
Write it under "Proposed contract changes" at the end of this file and stop that task.

---

## Phase 1 — Prove visual feasibility (gate: go/no-go)

- [x] **X0 — Worker spike (time-box: half a day).** Prove `FaceLandmarker` (VIDEO mode, 1 face)
  runs inside `tracker.worker.js` with the files in `public/try-on/v1/`. Some
  `tasks-vision` versions break in module workers. If it fails, implement the same message
  protocol on a throttled main-thread fallback, and report which one shipped and why.
  Chrome reported `ModuleFactory not set` in the module worker; the main-thread fallback
  initialized and completed inference on a synthetic frame.
- [x] **X1 — `camera.js`.** `startCamera({ signal }) → { video, stop }`: front camera, no audio,
  explicit errors (`permission-denied`, `no-camera`, `camera-busy`). If the stream arrives
  after `signal` aborts, stop it immediately. Also handle `track.onended` (revoked or
  interrupted) and `visibilitychange` (pause, then require an explicit Resume).
- [x] **X2 — `tracker.worker.js`** per the contract: `createImageBitmap(video)` → transfer →
  detect → `bitmap.close()`. Only process new video frames (`requestVideoFrameCallback`
  where available) and keep at most one in flight.
- [x] **X3 — `renderer.js`.** A canvas over the video, sized to the view and DPR-capped at 2.
  Draw the `computePlacement()` output, rotating around `imgAnchor`, mirroring once (via
  `mapToView`, not CSS). Hide null sides. Clear the canvas immediately on face loss.
- [x] **X4 — `try-on-lab.html`.** Bare page: video + canvas + product switcher over Claude's
  `fixtures.js`, left/right offset + size sliders + Reset, and an FPS / inference-ms readout.
  This is the go/no-go test bench.
- [ ] **X5 — Device run.** On one iPhone and one mid-range Android, record the device, OS,
  browser, FPS, cold/warm start times and screenshots for C6. Test different face shapes,
  hair, glasses and lighting.

## Phase 2 — Admin editor

- [x] **X6 — `admin/try-on.html` + `src/try-on-admin.js`.** For one product: upload left and
  right (or mirror), with a transparency check that rejects an image with no transparent pixels.
  Click on the image to set the anchor, sliders for scale/offset/rotation within the contract
  bounds, a live camera preview using the same modules, and **Publish / Disable**. Use only
  Claude's `supabase.js` helpers, and show `validateConfig()` errors next to their fields.
- [x] **X7 — Inventory link** (one link per earring row) and the `vite.config.js` input.

## Phase 3 — Storefront integration

- [x] **X8 — `controller.js`.** `openTryOn()` per the contract: the full-screen mobile / contained
  desktop dialog, the intro consent copy from `plan.md` §3, an explicit **Start camera** button,
  then lazy-load the tracker. Product switcher (keeps the camera; resets per-product
  adjustments), name and price, and **Add to bag** via `onAddToBag`. Every state code has a
  message and a Close button, plus Retry where recovery is possible.
- [x] **X9 — Accessibility:** a named dialog, focus moved from the product modal (only one
  active focus trap), Escape to close, keyboard-operable sliders, polite status announcements,
  and focus restored to `returnFocus`.
- [ ] **X10 — Cleanup:** closing, navigating away or hiding the page stops all tracks,
  terminates or idles the worker, cancels animation frames, and ignores late async results.
  Twenty open/close cycles must leave no live tracks (the camera indicator turns off).
  Cleanup code is implemented; the twenty-cycle camera-indicator check still needs a device run.
- [x] **X11 — Shop hook.** Show the button only when `VITE_TRY_ON_ENABLED === 'true'`,
  `product.itemCategory === 'Earrings'`, and `configs.has(product.id)`. Import the controller
  on click only, so `/shop` must not download the model or WASM until Start camera.
- [x] **X12 — `try-on.css`:** responsive layout, portrait/landscape, safe-area insets, and
  `prefers-reduced-motion`.

**Acceptance:** the `plan.md` §8 manual matrix passes on the devices from X5. Lighthouse and
the network panel on `/shop` show no try-on bytes before the button is pressed.

---

## SHARED CONTRACT (identical in both files — Claude edits, Codex proposes changes)

### Config object (from `getTryOnConfigs()`, `fixtures.js`, `validateConfig().config`)
```js
{
  productId: 'uuid',
  version: 1,                                   // config_version
  enabled: true,                                // public configs are always true; admin reads show drafts
  assets: { left: '/img/try-on-assets/…webp', right: '/img/…webp' | null },
  mirrorLeftForRight: true,                     // true ⇒ right asset is null and right anchor is derived (1 − left.x, left.y)
  anchor:   { left: { x, y }, right: { x, y } },  // 0..1 inside the image: hook/stud point
  offset:   { left: { x, y }, right: { x, y } },  // face-width units, each |v| ≤ 0.5
  rotationDeg: { left, right },                 // each −45..45
  scaleRatio: 0.18,                             // image height ÷ face width, 0.02..1
  lengthMm: 32 | null,                          // reference only
}
```
`getTryOnConfigs()` returns `Map<productId, config>` with enabled, valid rows only, in one
query per page load (never per frame; memoised). It returns an empty Map when
`VITE_TRY_ON_ENABLED !== 'true'` or the query fails.
The `left` asset is drawn as it looks on the wearer's **left** ear in the mirror preview.

### `src/supabase.js` (admin helpers)
```js
getTryOnConfigAdmin(productId) → config | null   // raw: a draft may be incomplete/invalid
upsertTryOnConfig(config)      → void            // enabled:true validates first and throws Error{ errors }
uploadTryOnAsset(file, productId, 'left'|'right') → url   // store in config.assets[side]
```

### `src/try-on/assets.js` (validation has no DOM / Supabase imports)
```js
validateConfig(raw) → { ok, config, errors }   // errors keyed by dotted path: 'anchor.left.x', 'assets.right', 'scaleRatio', …
loadAsset(url, signal) → Promise<HTMLImageElement>   // cfImg(url), crossOrigin, decode(); rejects on abort
BOUNDS                                          // same numbers as the migration CHECKs
```

### `src/try-on/placement.js` (pure)
```js
mapToView(pt, { videoW, videoH, viewW, viewH, mirrored }) → { x, y }   // pt in video px
earAnchors(landmarks, videoW, videoH) → { left:{x,y}, right:{x,y}, faceWidth, rollDeg, yawDeg } | null
computePlacement({ ears, view, config, user, aspect }) → {
  left:  { x, y, w, h, rotationDeg, imgAnchor, asset, flipX } | null,  // null = hide this side
  right: { … } | null,
  state: 'tracking' | 'no-face' | 'unsupported-pose',
}
createSmoother({ alpha }) → { next(placement) → placement, reset() }
```
`left` and `right` always mean the **wearer's** ears. `user` is
`{ offset:{left:{x,y},right:{x,y}}, scale: 1 }` for the session only (offset clamped ±1, scale 0.5–2).
`aspect` is `{ left, right }` = image naturalWidth ÷ naturalHeight (default 1).
Per side: `x,y` = view px of the ear point; draw so `imgAnchor` (0..1, in the image **as drawn**,
i.e. after `flipX`) lands there; `asset` = which image (`'left'`/`'right'`) to draw; `flipX` = draw it
mirrored (symmetric pair re-using the left asset on the right ear). `rotationDeg` is screen-space,
clockwise-positive. Offsets follow the face's tilt. A far ear is hidden past |yaw| 20°, both sides
past |yaw| 35° or |roll| 45° (`unsupported-pose`). Starting landmarks are 234/454 plus a 0.1
face-width drop toward the lobe; tune both in Phase 1, behind this API.

### Tracking engines (`src/try-on/engine-webar.js`; default engine is `'webar'`)
```js
createPreviewSession({ view, canvas, onState, onMetrics, engine = 'webar' | 'mediapipe' }) → { start, stop, setProduct, setUser, setEngine(name), engine, video }
startWebarEngine({ video, signal, onEars, onError }) → Promise<{ stop() }>   // lib reads OUR <video>; camera.js owns the stream
onEars(ears | null, ts)    // ears = placement.earAnchors() shape, in unmirrored video px; null = no face / stale
renderer.renderEars(ears, limits) → state    // limits = { hideFarEarYaw, maxYaw, maxRoll } per engine
onMetrics({ inferenceMs | null, ts, mode })  // plus one { startMs, mode } after the first result of each start
```
WebAR.rocks.face is pinned and self-hosted at `public/try-on/webar/819cdbad4e87/` (MIT; see its `MANIFEST.json`).
Its model has no confidence or inference-time output (`inferenceMs` is null). The ear point is
`mix(EarBottom, EarEarring, 0.7)`, face width is the ear span, and its far-ear gate is 5° (`WEBAR_LIMITS`).
The MediaPipe worker protocol below is only used when `engine === 'mediapipe'`.

### Tracker worker messages (`tracker.worker.js`, MediaPipe engine only)
```
main → worker  { type:'init',  modelUrl, wasmBase }
main → worker  { type:'frame', bitmap, ts, session }       // bitmap transferred; worker closes it
worker → main  { type:'ready' }
worker → main  { type:'result', ts, session, landmarks | null }
worker → main  { type:'error',  code: 'model-failure' | 'unsupported-device' }
```
Main thread: at most one frame in flight, and drop results whose `session` or `ts` is stale.

### Controller entry (`src/try-on/controller.js`)
```js
openTryOn({ product, products, configs, onAddToBag, returnFocus }) → void
```
`product` and `products` use the `shop.js` product shape. `onAddToBag(product)` is the
existing `addToCart`. `shop.js` loads it with `await import('./try-on/controller.js')` on click.

### State codes
`intro · loading · permission · tracking · no-face · unsupported-pose · paused ·
permission-denied · no-camera · camera-busy · missing-asset · model-failure · unsupported-device`

### Paths
- Storage: `try-on-assets/<productId>/<left|right>-<timestamp>.webp`, served via `cfImg(url)` with no size
- Static: `/try-on/v1/face_landmarker.task`, `/try-on/v1/wasm/`
- Build flag: `import.meta.env.VITE_TRY_ON_ENABLED === 'true'`

---

## Proposed contract changes

The acceptance line "no try-on bytes before the button is pressed" conflicts with
`getTryOnConfigs()` being needed at page load to decide whether to show that button.
The current build preloads the small `assets.js` configuration-validation chunk on
`/shop`. Proposed wording: **no controller, camera, tracker, MediaPipe bundle,
model, or WASM requests before the button is pressed; configuration data and
validation may load to gate button visibility.** No storefront code depends on
this clarification.
