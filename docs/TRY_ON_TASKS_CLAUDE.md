# Earring Try-On — Claude's Tasks (Data · Security · Placement Math · CI · Review)

**Owner:** Claude. **Pairs with:** `TRY_ON_TASKS_CODEX.md` (camera, tracking, rendering, UI).
**Design:** `plan.md`. Read it first; this file only splits the work.

**Why this half is mine:** the migration, RLS and Storage rules are security-critical; the
placement math is the correctness core that both tracking and rendering depend on; and the
Supabase egress budget (Free plan, grace period ends 2026-10-24) needs one owner. Codex gets
the browser-heavy pieces, which are well specified and parallelize cleanly.

---

## File ownership (avoid collisions)

**I own — Codex must NOT edit:**
- `supabase/migrations/<new>_try-on.sql`
- `src/supabase.js`
- `src/try-on/placement.js`, `src/try-on/assets.js` (validation + loader)
- `test-try-on.mjs`, `.github/workflows/ci.yml`
- `public/try-on/` (pinned model + WASM), `public/_headers`, `package.json` / lockfile, `wrangler.jsonc`, `worker.js`
- `plan.md`, and the Shared Contract in both task files

**Codex owns — I must NOT edit:**
- `src/try-on/controller.js`, `camera.js`, `tracker.worker.js`, `renderer.js`, `try-on.css`
- `try-on-lab.html` (Phase 1 prototype page)
- `admin/try-on.html`, `src/try-on-admin.js`
- One button in `shop.html`, one dynamic-import hook in `src/shop.js`, one link in `src/inventory.js`, the `admin-try-on` input in `vite.config.js`

---

## Phase 1 — Prove visual feasibility (gate: go/no-go)

- [x] **C1 — Pin dependencies.** Add an exact `@mediapipe/tasks-vision` version. Copy its WASM
  files and a matching `face_landmarker.task` into `public/try-on/v1/`. Confirm each file is
  under the Workers static-asset per-file limit, and check the licenses (Apache-2.0 expected).
  Add `public/_headers` with `Cache-Control: public, max-age=31536000, immutable` for `/try-on/*`.
- [x] **C2 — `placement.js`.** Implement the Shared Contract API with no DOM or MediaPipe imports:
  object-fit-cover mapping, mirroring applied once, wearer-anatomical left/right, anchors,
  face-width scaling, user offsets, pose gating, and a smoother with `reset()`.
- [x] **C3 — `test-try-on.mjs`.** Tests with `node --test` for mirroring, crop offsets, anchors,
  left/right meaning in a mirrored view, pose rejection, smoother reset after face loss, and
  config validation (C5). Add the step to `ci.yml`.
- [x] **C4 — Fixture configs.** Write `src/try-on/fixtures.js` with 3–5 pilot configs in the
  contract shape, pointing at local cutouts in `public/try-on/fixtures/`. Codex's lab page uses
  these, so the prototype touches no database.
- [x] **C5 — Config validation** in `assets.js`: `validateConfig(raw) → { ok, config, errors }`,
  using the same bounds as the migration. Also `loadAsset(url, signal)`: `new Image()`,
  `cfImg(url)` with no size, `crossOrigin = 'anonymous'`, `decode()`, and reject on abort.
- [~] **C6 (static review done, device evidence pending — plan.md §10) — Review Codex's prototype** against `plan.md` §4 and §6: one inference in flight,
  stale results dropped, bitmaps closed, tracks stopped on close, hide and late permission.
  Record the go/no-go evidence (devices, FPS, screenshots) in `plan.md`.

## Phase 2 — Controlled product configuration

- [x] **C7 — Migration.** Create `product_try_on_configs` per `plan.md` §5 with CHECK bounds.
  Add a trigger that rejects `enabled = true` unless the product's `category = 'Earrings'`
  and the required assets are present. RLS: anon/auth can SELECT only enabled rows for active
  earrings; INSERT/UPDATE/DELETE require `public.is_admin()`. Create a public `try-on-assets`
  bucket, max 1 MB, `image/webp` and `image/png` only, with admin-only writes.
- [x] **C8 — `supabase.js` helpers.** Give `shrinkImage(file, maxEdge = 1600, quality = 0.82)`
  parameters (product uploads keep today's behaviour). Add the contract helpers
  `getTryOnConfigs()`, `getTryOnConfigAdmin(productId)`, `upsertTryOnConfig(row)` and
  `uploadTryOnAsset(file, productId, side)`, using immutable paths and a 1-year cacheControl.
- [~] **C9 (script + stand-in DB run done; live run pending the migration being applied) — Verify authorization** with real requests: anon cannot read disabled rows or write,
  a non-admin signed-in user cannot write, and an admin can. Paste the results into the PR.
- [x] **C10 — CI guard.** Extend the image check to `.src =` assignments of storage URLs, with
  the try-on loader allowed only through `cfImg`.

## Phase 3–4 — Integrate and release

- [~] **C11 (build-output check done; focus hand-off review pending Codex) — Integration review** of Codex's controller and shop hook: no eager model
  download on `/shop` (check the network panel and the build output), cart reuse through
  `addToCart`, and the focus hand-off from the product modal.
- [ ] **C12 — Privacy check:** run a full session with the network panel open and confirm no
  frame, landmark or adjustment data leaves the device. Confirm that a missing `/try-on/*` file
  shows the model-failure state, not SPA HTML.
- [ ] **C13 — Egress check** before enabling pilot rows: Supabase daily cached egress must be
  confirmed back under budget, and repeat `/img/try-on-assets/...` requests must return
  `CF-Cache-Status: HIT`.
- [x] **C14 — Rollout notes:** set `VITE_TRY_ON_ENABLED` in the Cloudflare build variables, and
  document rollback (disable rows, or rebuild with the flag false) in `plan.md`.

**Acceptance:** the `plan.md` §8 release criteria pass, and CI is green with try-on tests included.

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
