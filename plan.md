# NGL Earring Virtual Try-On — Implementation Plan

Status: Planned; no feature code implemented by this document.
Created: 2026-10-06

Tracking research update (2026-10-06): section 12 revises the engine-selection decision. Evaluate WebAR.rocks' dedicated ear model against the existing MediaPipe implementation before treating MediaPipe as the production choice. Existing implementation notes below remain a record of work completed.

## 1. Goal and scope

Let shoppers open their camera from an earring's product modal, preview the design on their face, compare supported earrings, and add a chosen product to their bag.

The first release is a style preview using transparent 2D product assets and face tracking. It supports one person, a mostly front-facing pose, and small head movements. Display: “Style preview — size and placement are approximate.”

Start with 3–5 real products. Accurate physical sizing, realistic hair occlusion, 3D jewelry, dangling physics, snapshots, recording, and sharing are later work. Do not generate or substitute jewelry designs: each overlay must depict the selected product.

## 2. Existing project integration

| Existing file | Planned use |
| --- | --- |
| `shop.html` | Add a Try it on action to the existing product modal. |
| `src/shop.js` | Pass the selected product to the try-on module and reuse cart behavior. Product type is `itemCategory`; `category` currently identifies the collection. |
| `src/cart-store.js` | Preserve stock limits, duplicate handling, and cart events. |
| `src/supabase.js` | Fetch public try-on configurations and upload admin assets. Keep existing explicit product field selection. Reuse `shrinkImage()` (give it a max-edge parameter, 1024 for try-on) instead of a second uploader, and load every asset through `cfImg(url)` with no size. |
| `admin/inventory.html`, `src/inventory.js` | Manage assets, placement settings, and publication status. |
| `worker.js` | Reuse the `/img/` Storage proxy for published assets. |
| `wrangler.jsonc` | Preserve `/img/*` Worker routing and verify model/WASM static asset delivery. |
| `supabase/migrations/` | Add the configuration table and Storage policies through a new migration. |
| `.github/workflows/ci.yml` | Add a `node --test test-try-on.mjs` step next to the stylist tests. |

Keep the current Vite, vanilla JavaScript, Supabase, and Cloudflare architecture. A separate framework or camera backend is unnecessary for the proposed MVP.

## 3. Customer experience

1. Show Try it on only for an active earring with a published, valid configuration and the global feature enabled.
2. Open a full-screen mobile dialog, or a contained desktop dialog. Transfer focus from the product modal; avoid two active modal focus traps.
3. Explain: “Preview these earrings using your camera. Camera images stay on your device.” Provide an explicit Start camera button.
4. After that action, load tracking resources and request the front camera with audio disabled. Show distinct progress for model loading and camera permission.
5. Guide the customer to face forward, improve lighting, and move hair away from their ears. Render only after tracking and product assets are ready.
6. Offer left/right placement adjustment, overall size adjustment, and Reset. Store these adjustments only for the current session.
7. Offer a compact selector of available try-on earrings. Switching products preserves the camera session, updates name/price, and resets product-specific user adjustments.
8. Reuse the existing Add to bag behavior, including stock and already-in-bag handling. Checkout remains responsible for authoritative stock validation.
9. Closing returns focus to the original product action and releases all camera and tracking resources.

Required states: introduction, loading, requesting permission, tracking, no face, unsupported pose, paused, permission denied, missing camera, camera busy, missing asset, and model failure. Every error leaves a usable Close action and access to normal shopping. Provide Retry where recovery is possible.

Accessibility: named dialog, focus containment/restoration, Escape to close, keyboard-operable adjustments, visible focus, readable status text, and restrained screen-reader announcements. Do not rely solely on camera gestures or dragging.

## 4. Tracking and rendering approach

The existing baseline uses a pinned version of `@mediapipe/tasks-vision` with a compatible Face Landmarker model, video mode, one face, and facial transformation matrices. Disable outputs the feature does not use. Browser face landmarks and transformations are documented by [Google](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js). Section 12 adds a dedicated ear-tracking candidate; benchmark it before selecting the release engine.

Face tracking is the starting point, not a guaranteed earlobe detector. Treat ear attachment points as estimates derived from face geometry, product settings, and user adjustment. Validate this assumption on real people before committing to a full release.

Proposed modules:

| New file | Responsibility |
| --- | --- |
| `src/try-on/controller.js` | Dialog state, lifecycle, product selection, cart callback. |
| `src/try-on/camera.js` | Camera acquisition, interruption handling, and cleanup. |
| `src/try-on/tracker.worker.js` | Model initialization and frame inference where supported. |
| `src/try-on/placement.js` | Coordinate transforms, attachment estimates, smoothing, user offsets. |
| `src/try-on/renderer.js` | Draw transparent jewelry assets on a canvas above the video. |
| `src/try-on/assets.js` | Validate configurations, load/decode assets, prevent stale selections. |
| `src/try-on/try-on.css` | Responsive dialog, controls, and tracking guidance. |
| `public/try-on/` | Versioned model and compatible WASM runtime assets. |

Rendering rules:

- Define one coordinate pipeline from camera pixels to the displayed video rectangle, including `object-fit` cropping, canvas scaling, and front-camera mirroring. Apply mirroring exactly once.
- Define left/right as the wearer's anatomical sides and preserve that meaning in the mirrored preview.
- Use a normalized attachment anchor within each image so the earring's hook or stud aligns with the estimated earlobe. Scale relative to face width; this is approximate and must not be presented as measured fit.
- Smooth position, rotation, and scale over time. Reset smoothing after face loss or a subject change; do not leave earrings floating at old positions.
- Use a conservative supported head-angle range established during the prototype. Hide unsupported overlays and ask the customer to face forward. Do not imply that hair visibility can be inferred from face landmarks alone.
- Process only new frames, permit at most one inference in flight, and discard stale results. Close transferred frame resources after use.
- Prefer inference in a Web Worker because detection calls are synchronous. Test the chosen runtime/delegate combination on mobile; use a throttled main-thread fallback only if it meets responsiveness targets. Otherwise show an unsupported-device state.
- Keep the overlay canvas synchronized with video dimensions, orientation changes, and device pixel ratio; cap resolution to manage GPU and memory use.

## 5. Product assets and data

Prepare transparent WebP or PNG cutouts showing one earring per asset. Preserve hooks, thin metal edges, and product colors. Use independent left/right assets for asymmetric designs; explicitly configure mirroring for symmetric pairs. Ordinary product photos containing backgrounds or two earrings are not ready-to-use overlays.

Initial asset targets: at most 1024 pixels on the longest side and preferably under 200 KB per side, subject to visual inspection. Make cutouts from the full-quality originals in `Desktop\NGL-image-backup\products\`, not from the bucket copies, which were re-encoded to ≤1600px WebP on 2026-10-06. `shrinkImage()` currently encodes lossy WebP at 0.82; check that thin hooks and metal edges don't fringe, and raise quality for try-on uploads if they do. Record measured product length for reference, but do not use it to promise exact camera sizing without calibration.

Create `public.product_try_on_configs` with one row per product:

| Field | Purpose |
| --- | --- |
| `product_id` | Primary key and foreign key to products, cascading on deletion. |
| `enabled` | Default false; publish only after preview and validation. |
| `asset_left_path`, `asset_right_path` | Relative paths in a dedicated `try-on-assets` bucket; right may be absent only with an explicit mirror rule. |
| `mirror_left_for_right` | Explicit symmetric-pair behavior. |
| `anchor_left`, `anchor_right` | Validated normalized image coordinates, each with x/y in [0, 1]. |
| `scale_ratio` | Positive bounded image scale relative to tracked face width. |
| `offset_left`, `offset_right` | Bounded placement offsets in face-relative coordinates. |
| `rotation_left_deg`, `rotation_right_deg` | Per-side orientation corrections. |
| `product_length_mm` | Optional positive product measurement for reference. |
| `config_version`, `updated_at` | Compatibility and configuration tracking. |

Migration requirements:

- Enforce field shapes and numeric bounds; validate published rows have usable assets. Reject enabling configurations for non-earring products, meaning `products.category <> 'Earrings'` (116 of 117 active products are earrings today). A CHECK constraint can't read another table, so enforce this with a trigger, and repeat the condition in the public RLS read policy.
- Apply RLS: public reads only enabled configurations for active earrings; writes only where `public.is_admin()` is true (defined in `20260914000100_audit-fixes.sql`).
- Give the public client explicit safe read grants and test anonymous access. Keep unpublished configuration rows restricted to admins.
- Use a public bucket for product artwork with authenticated, authorized admin writes and bounded MIME/file-size rules. Never store customer camera imagery there. Draft artwork in a public bucket is not confidential; use a private staging bucket if draft confidentiality becomes a requirement.
- Fetch supported public configurations separately when needed, avoiding changes to unrelated catalog consumers and avoiding per-frame database calls.
- Use immutable filenames. Publish the new asset path only after a successful upload and preview; do not delete the previous asset until references are checked.

The admin editor needs upload, alpha/background validation, anchor placement, scale/offset controls, a camera preview, and Publish/Disable. Reject corrupt files and incomplete settings with clear field errors. Client validation must be backed by database and Storage authorization.

## 6. Privacy, lifecycle, and bandwidth

- Camera frames, face landmarks, and user adjustments remain in browser memory. Do not upload, log, persist, or send them to analytics. No face identity or recognition feature.
- Request only video after the user's action. Production camera access requires a secure context and permission; follow [getUserMedia guidance](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
- On close, navigation, or page hiding, stop all camera tracks and cancel processing. Returning from the background requires an explicit Resume camera action. Handle permission revocation and interrupted streams.
- Use cancellation/session IDs for async setup. If permission or a model load resolves after the dialog closes, stop any arriving stream and ignore stale results.
- Dynamically import tracking code only when try-on is opened; download model/WASM only when starting it. Pin and self-host these versioned files through Cloudflare static assets after checking distribution licenses and deployed asset limits.
- Serve prepared jewelry images through the existing `/img/` route without Supabase image transformation parameters. Verify alpha preservation, correct MIME types, and repeat-request caching.
- Supabase budget: the project is on the Free plan (5 GB cached egress a month). It went over in Sep 2026, and the grace period ends 2026-10-24; after that, overage returns 402 for the whole shop. Storage Image Transformations aren't in the plan, so assets must be pre-sized at upload, never resized on request. Don't enable the storefront pilot until daily cached egress is confirmed back under budget.
- Load assets as `new Image()` with `img.src = cfImg(url)`. The CI image check only matches `src="${…}"` in templates, so extend it to `.src =` assignments, or keep all asset loading in `assets.js` and review it there. `/img/` is same-origin, so canvases stay untainted, which matters for later snapshots. In dev, `cfImg` returns a cross-origin Supabase URL, so set `crossOrigin = 'anonymous'`.
- `wrangler.jsonc` uses `not_found_handling: "single-page-application"`, so a missing or misnamed `/try-on/*.task` or `.wasm` file returns `index.html` with status 200. The loader must check content type and fail into the model-failure state. Set long-lived immutable caching for versioned `/try-on/*` files, for example with a `_headers` rule, and keep each file under the Workers static-asset per-file limit (25 MiB at the time of writing).
- Cache immutable model/runtime files and product images. Switching styles fetches only missing assets. This reduces future Supabase traffic; existing egress usage will not be erased.
- Inspect browser network traffic during a session to verify that no camera data leaves the device. Any future analytics should contain only minimal product/action/error codes and require a separate decision.

## 7. Phased implementation checklist

### Phase 1 — Prove visual feasibility

- [ ] Select 3–5 real products and prepare transparent assets with known attachment anchors.
- [ ] Build a local, isolated camera/tracking/canvas prototype using fixture configurations.
- [ ] Implement mirroring, position smoothing, manual correction, and face-loss behavior.
- [ ] Test people with different face shapes, skin tones, hair styles, and glasses, including moderate movement and lighting changes.
- [ ] Test at least one representative iPhone and one mid-range Android device; record exact device/browser versions and measured performance.
- [ ] Go/no-go: attachment is visually convincing within the stated pose range, adjustment is understandable, and controls remain responsive. If the estimate is inadequate, evaluate dedicated ear tracking or a try-on SDK before expanding implementation.

### Phase 2 — Add controlled product configuration

- [ ] Add the migration, bucket policies, public configuration fetch, and admin upload/editor.
- [ ] Validate alpha assets, normalized anchors, bounded settings, and category eligibility.
- [ ] Verify public read filtering and rejected anonymous/non-admin writes.
- [ ] Configure the pilot products and keep publication disabled until integration passes.

### Phase 3 — Integrate shopping flow

- [ ] Add the product-modal entry point, lazy-loaded dialog, state handling, and camera consent copy.
- [ ] Implement product switching, Reset, current product name/price, and shared cart integration.
- [ ] Add complete cleanup, async cancellation, accessible focus behavior, and responsive styling.
- [ ] Add `VITE_TRY_ON_ENABLED`, default false. Document that changing this build-time flag requires a rebuild; per-product disable remains available through the database. Production builds run on Cloudflare from GitHub pushes, so set the flag in the Cloudflare build variables, not `.env.local`.

### Phase 4 — Verify and release the pilot

- [ ] Complete the validation and acceptance checks below.
- [ ] Run `npm run build` and confirm the normal storefront avoids eager model downloads.
- [ ] Deploy a preview with HTTPS; test real camera use and production-equivalent `/img/` routing.
- [ ] Enable only the reviewed pilot products, observe performance and customer feedback, and fix placement issues before widening the catalog.
- [ ] Document rollback: disable affected configuration rows immediately, or rebuild with the global flag false. Leave the additive schema in place during rollback.

### Later phases

Evaluate 3D assets, hair/ear segmentation, improved ear localization, movement physics, and optional physical-size calibration only after the pilot demonstrates value. Snapshot/download support needs its own consent, canvas-origin, and device compatibility review.

## 8. Validation and acceptance

Automated checks should cover placement math (mirroring, anchors, crop offsets), stale result rejection, camera cleanup after late permission resolution, rapid product switching, and configuration authorization. Use synthetic frames/mocked streams for lifecycle tests and real devices for visual accuracy.

Keep `placement.js` and the configuration validation in `assets.js` free of DOM and MediaPipe imports, so `test-try-on.mjs` runs under plain `node --test` in the existing CI. This matches how `test-stylist.mjs` tests `stylist-engine.js`. Camera and lifecycle checks that need a browser stay manual until a browser test runner is justified.

Manual matrix: current iOS Safari, Android Chrome on a mid-range device, desktop Chrome/Edge, and desktop Safari where available. Record supported versions at release. Cover permission denied, no camera, camera busy, slow/failed model download, missing artwork, portrait/landscape changes, background/resume, repeated open/close, and face loss.

Release criteria:

- Eligible earrings show the action; unsupported products remain usable through the normal shop.
- Camera starts only following user action; its active indicator clears after exit or backgrounding.
- Overlays follow the reviewed pose range without persistent jitter or stale positions, and disappear promptly when tracking is lost.
- Switching products shows the correct artwork/name/price and adds the correct product to the existing bag.
- A ten-minute session and twenty open/close cycles leave no accumulating streams, inference loops, or continuously growing memory use.
- Initial performance targets: at least 15 tracking updates/second on the chosen mid-range phone, smooth preview and responsive controls, and a warm startup within 3 seconds after permission is granted. Measure cold startup separately with device/network details; these are test targets, not guarantees.
- Customer frames and landmarks never appear in network requests or logs.
- Published asset/model requests have valid content types and expected caching; missing model files never silently return SPA HTML.
- No regressions in product-modal navigation, inventory editing, cart limits, or checkout.

## 9. Decisions to confirm during the prototype

Choose the pilot products and representative test phones; determine whether existing photography can produce clean cutouts; establish the supported head-angle range and acceptable manual adjustment. Revisit the custom tracker approach only if those trials fail the visual or performance criteria.

The next implementation task is Phase 1: build and evaluate the isolated prototype before migrating production data or enabling the storefront feature.

Work is split between agents in `TRY_ON_TASKS_CLAUDE.md` (data, security, placement math, CI) and `TRY_ON_TASKS_CODEX.md` (camera, tracking, rendering, UI), with a shared contract in both.

## 10. Implementation status (updated 2026-10-06)

**Done (data / placement / CI half):** pinned `@mediapipe/tasks-vision` 1.0.1 (Apache-2.0) with model + WASM in `public/try-on/v1/` (largest file 11.7 MB, under the 25 MiB limit; `public/_headers` sets immutable caching for `/try-on/*`); `placement.js`, `assets.js`, `fixtures.js` (placeholder shapes, not product designs); `test-try-on.mjs` (12 tests, in CI); migration `20260914001100_try-on.sql`; `supabase.js` try-on helpers; CI guard for `.src =` assignments.

**Migration verification so far:** run against a local Postgres stand-in (PGlite with stubbed `auth`/`storage`/`is_admin`): CHECK bounds, the earrings-only trigger, enabled-needs-assets, path format, anon/non-admin write rejection, public read of enabled rows only (and none after the product is deactivated or re-categorised), storage upload rules, and a clean second run. **Not yet verified against the live project.** After applying the migration run `node --env-file=.env.local setup/verify-try-on-auth.mjs <earring-uuid> [adminEmail adminPassword]` and paste the output into the PR (C9). A signed-in non-admin check needs a non-admin account (public sign-ups should be off), so it is covered only by the stand-in run.

### Prototype review (C6, static read of Codex's files)
Checked against §4 and §6; passes: mirroring applied once (CSS on `<video>`, `mapToView` for the overlay), wearer-anatomical sides, `flipX`/`asset`/`aspect` consumed correctly, DPR cap 2, one inference in flight, stale results dropped by session/ts, transferred bitmaps closed, tracks stopped on close/hide/`pagehide`/`track.onended`, late-permission stream stopped, explicit Resume after backgrounding, no frame or landmark leaves the device (worker `postMessage` only). Build output: the controller, worker and `vision_bundle` are lazy chunks; `/shop` has no preload of them and fetches no model/WASM until Start camera.

Open items for Codex / device testing:
1. **Frame timestamps.** `processFrame` uses `metadata.mediaTime * 1000` and drops any frame with `ts <= lastSent`. If a browser reports a constant or non-advancing `mediaTime` for camera streams, tracking would stall silently on "no face". Verify on iPhone Safari; if it stalls, use `metadata.presentationTime` (or `performance.now()`).
2. **Worker hang.** If the worker never answers, `inFlight` stays true and the last overlay stays on screen. Add a watchdog (~1 s) that clears the canvas and resets `inFlight`.
3. **Model content type.** The `.task` fetch only checks `ok`; a missing file returns SPA HTML with status 200 and only fails later inside MediaPipe. Reject `text/html` up front, and avoid fetching the model twice (pre-check, then MediaPipe), e.g. a `HEAD`.
4. `renderer.render()` returns `'no-face'` while artwork is still loading; show `loading`/`missing-asset` instead of "move into the frame".
5. `setState` rewrites DOM text every frame; return early when the state is unchanged.
6. The worker reports any per-frame exception as `unsupported-device`; use `model-failure` for a throw during detection if the device is otherwise working.
7. (Resolved) `src/try-on-admin.js` has landed and uses the helpers per the contract; `npm run build` passes. Not yet exercised against a live database.

### Go/no-go evidence (Phase 1) — pending device runs
| Device / OS / browser | FPS | Inference ms | Cold / warm start | Notes |
| --- | --- | --- | --- | --- |
| _iPhone — to fill_ | | | | |
| _Mid-range Android — to fill_ | | | | |
| _Desktop Chrome — to fill_ | | | | |

The lab page uses placeholder shapes; judge visual accuracy with real transparent cutouts of 3–5 pilot products (make them from `Desktop\NGL-image-backup\products\`).

## 11. Rollout and rollback

1. Apply `supabase/migrations/20260914001100_try-on.sql` in the Supabase SQL editor and run `setup/verify-try-on-auth.mjs`.
2. **Egress gate (C13):** confirm Supabase daily cached egress is back under budget (grace period ends 2026-10-24) before enabling any row. After the first published row, request `/img/try-on-assets/<id>/left-….webp` twice and confirm the second response has `CF-Cache-Status: HIT`.
3. Set `VITE_TRY_ON_ENABLED=true` in the **Cloudflare build variables** (Workers & Pages → `ngl-v1` → Settings → Variables, build section) and push/redeploy; it is read at build time. `.env.local` only affects local dev.
4. Publish pilot rows one at a time from the admin editor (Publish sets `enabled`).
5. **Rollback:** disable the rows (editor → Disable, or `update product_try_on_configs set enabled = false;`) — effective immediately for new page loads. To remove the button entirely, set `VITE_TRY_ON_ENABLED` to `false` (or remove it) and redeploy. Leave the additive table and bucket in place.

## 12. Dedicated ear tracking: revised evaluation approach

Research date: 2026-10-06. Findings are based on official documentation and inspected example code. No live camera accuracy comparison has been performed, so the recommendation is a prototype priority, not a claim of measured superiority.

### Preferred next prototype: WebAR.rocks.face

The official [2D earring example source](https://raw.githubusercontent.com/WebAR-rocks/WebAR.rocks.face/master/demos/earrings2D/main.js) uses `NN_EARS_4.json` and directly consumes `leftEarBottom`, `leftEarEarring`, `rightEarBottom`, and `rightEarEarring`. It blends those positions to place artwork, scales relative to face width, and hides sides according to head angle. This is more specific to the task than our current face-geometry attachment estimates, although it still predicts landmarks and cannot guarantee a customer's actual piercing position.

The repository provides browser examples for [2D earrings](https://webar.rocks/demos/face/demos/earrings2D/) and [3D earrings](https://webar.rocks/demos/face/demos/earrings3D/). Its [license](https://github.com/WebAR-rocks/WebAR.rocks.face/blob/master/LICENSE) applies MIT terms to the distributed runtime, helpers, and neural models; preserve notices and review separately supplied assets/dependencies before redistribution. A paid API is not required for this self-hosted candidate.

The [3D example](https://raw.githubusercontent.com/WebAR-rocks/WebAR.rocks.face/master/demos/earrings3D/main.js) loads GLB jewelry and uses geometric ear occluders. These occluders do not establish hair segmentation or physical fit accuracy. Begin with 2D product cutouts, and evaluate 3D only when real product models are available.

### Commercial alternatives

| Candidate | Verified capability | Evaluation role |
| --- | --- | --- |
| [Camweara](https://camweara.com/virtual-jewelry-try-on/) | Jewelry product-image workflows, earrings, and custom website integration through its [JavaScript API](https://camweara.com/integrations/camweara_api.html). | Paid alternative if custom tracking needs too much refinement. Its [pricing page](https://camweara.com/pricing/) currently lists Starter at USD 990/year, 300 products, and video/photo modes for businesses with fewer than 10 people; additional image-editing charges may apply. Verify terms before purchase. |
| [Banuba jewelry try-on](https://www.banuba.com/virtual-try-on-jewelry) | Vendor offers browser jewelry try-on including earrings, 3D rendering, motion simulation, and product digitization. | Evaluate a trial with actual NGL designs if richer rendering and vendor support are priorities. Confirm plan, browser support, data processing, and asset costs directly; marketing claims are not independent benchmarks. |
| [Perfect Corp AI earrings](https://docs.perfectcorp.com/reference/ai_earrings) | Documents an AI earring workflow with guided selfie capture. | Consider separately for a captured-photo experience. A capture-and-generate API does not by itself satisfy the requested continuously moving camera filter. Validate any separate live AR offering explicitly. |

### Implementation changes if the ear-model prototype passes

1. Add an engine adapter alongside the current implementation. Normalize output into wearer-left/right attachment coordinates, head pose, tracking state, and timestamp. Do not assume that both engines expose equivalent per-ear confidence scores.
2. Pin a tested WebAR.rocks commit, self-host its compatible runtime/helper/model files, and retain license notices. Reuse the existing camera consent, UI, assets, cart, and admin work.
3. Integrate the ear model through its documented WebGL/callback flow. Do not force the MediaPipe worker protocol or WASM packaging onto this runtime. Validate pause, resize, context loss, and destroy behavior for the new adapter.
4. Update placement logic to consume predicted ear anchors. Retain product-specific image anchors and a small optional user adjustment. Keep the schema engine-independent wherever possible.
5. Compare the candidates one at a time in the lab; do not run two trackers continuously on shoppers' phones. Compare placement with the same products, framing, people, and lighting.
6. Measure attachment drift relative to visible earlobes, jitter while still, reacquisition after a turn, incorrect drawing over hair, supported pose range, FPS, startup, and memory. Include current iPhone Safari and a mid-range Android Chrome device, plus the existing lifecycle and network privacy checks.
7. Select WebAR.rocks only if it materially improves placement and passes the performance/lifecycle gates. Keep the baseline available during evaluation. If neither meets the visual gate, trial a commercial jewelry SDK before undertaking custom ear-model training.

The recommended immediate task is to adapt the dedicated 2D ear demo into the existing lab and compare it with the current baseline using actual NGL cutouts. No engine replacement or paid integration is implemented by this research update.

## 13. Claude handoff — implement the ear-tracking comparison

Owner for this next task: Claude. This handoff supersedes the earlier Claude/Codex file split only for changes necessary to implement this comparison. Preserve unrelated edits and existing completed work; check the current working tree and coordinate any files actively being edited elsewhere before modifying them. This assignment does not authorize deployment, live database changes, paid service enrollment, or enabling the feature for shoppers.

### Deliverables in order

- [x] **E1 — Baseline audit.** Read this plan, both task files, the current try-on modules, lab, tests, and asset headers. Record the existing behavior and unresolved lifecycle problems relevant to the comparison. Keep the current MediaPipe path operational.
- [x] **E2 — Pin the candidate.** Inspect the official WebAR.rocks 2D demo and matching model/runtime/helpers. Pin an exact commit and record origin URLs, revision, license notices, file hashes, and sizes in a dependency manifest. Copy only needed files into a new versioned `public/try-on/` directory; preserve existing immutable assets.
- [x] **E3 — Engine boundary.** Implement a small adapter interface for start, pause/stop, resize, destroy, and results. Normalize wearer-left/right ear anchors, face-relative scale, head pose, detection state, and timestamps. Derive fields only from documented outputs and clearly identify any estimates. Give one component ownership of the camera stream to prevent duplicate acquisition.
- [x] **E4 — Working lab.** Add a MediaPipe/WebAR.rocks selector to `try-on-lab.html`. Run exactly one engine at a time. Switching must tear down the prior engine before starting another and handle late async results safely. Keep engine selection confined to the lab until the visual gate passes.
- [~] **E5 — (engine wired; still placeholder cutouts, product-accuracy validation incomplete) Artwork and placement.** Load the same pilot product cutouts in both modes. Use predicted ear landmarks for the candidate, retaining per-product anchors, adjustment, mirroring, and smoothing. Preserve the existing database configuration contract. If actual cutouts cannot be prepared from available source images, retain clearly labeled placeholders and mark product-accuracy validation incomplete.
- [~] **E6 — (lifecycle verified with the real library on a synthetic video; no camera, device or WebGL-context-loss run) Lifecycle and performance.** Test close, background/resume, navigation, resize, lost tracking, model failure, WebGL context loss, repeated opening, and engine switching. Stop tracks, release graphics resources, and prevent frozen overlays. Expose lightweight lab measurements for FPS, inference time when available, and cold/warm startup. Load only the selected engine's resources.
- [~] **E7 — (21 automated tests, build, browser load and lazy-load checks; no hardware runs) Verification.** Add targeted automated coverage for the new coordinate mapping and adapter cancellation/cleanup where the existing test setup supports it. Run `node --test test-try-on.mjs` and `npm run build`, plus applicable required project checks. Perform browser checks where available and inspect network requests for camera-data leakage. Do not claim hardware checks that could not be run.
- [~] **E8 — (documented here; device evidence and the engine decision are pending) Evidence and plan update.** Update this checklist, the shared task contracts where changed, and the comparison table below. Report files changed, checks actually run, observed limitations, and exact remaining device checks. Recommend an engine only from measured evidence; if real-device evidence is missing, leave the production decision pending.

### Comparison evidence

Use the same product assets and test conditions for both candidates. Document browser/device versions and network conditions. Assess visible earlobe attachment drift, stationary jitter, head-turn recovery, unwanted drawing over hair, and required manual adjustment alongside timing measurements.

| Engine | Device / browser | Assets / conditions | FPS / startup | Placement observations | Lifecycle / privacy | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| MediaPipe baseline | Pending | Pending | Not measured | Not evaluated | Static review only (§10); code unchanged except the `renderEars` refactor | Superseded as default; kept in the lab selector |
| WebAR.rocks ear model | Chrome (desktop), synthetic canvas video, no camera | Placeholder fixtures only | Init 0.4–0.7 s with a warm cache; ~80–200 tracking callbacks per 1.5 s with no face present; no face-detected FPS measured | Not evaluated (no face was ever tracked) | Verified: 4 start/stop cycles, abort mid-init, engine canvas released, tracks stopped, no requests beyond our own files. One unexplained `ALREADY_INITIALIZED` on a cancelled start, now retried once | **Chosen as the only engine by the owner on 2026-10-06, ahead of a measured comparison** |

Completion means a runnable comparison with reproducible setup and honest verification evidence. Shipping the candidate requires the separate visual/device and rollout gates in this plan. A successful build alone does not establish better ear tracking.

## 14. WebAR.rocks adopted as the engine (2026-10-06)

The owner decided to use the WebAR.rocks ear model everywhere. It is the default in the shop dialog, the admin preview and the lab (`createPreviewSession` defaults to `engine: 'webar'`). §12's evidence gate was not run, so treat this as a decision made ahead of measurement. Still needed before enabling any pilot row:

1. **Placement check on a real face** with the placeholder fixtures, then with real cutouts. Nothing here has tracked a face yet: the engine was exercised only on a synthetic video.
2. **Device runs** (iPhone Safari, mid-range Android Chrome) for FPS, start time and WebGL behaviour. WebAR.rocks needs WebGL2, or WebGL1 with float-texture extensions, or it reports `unsupported-device`.
3. **Scale and anchor calibration:** `FACE_WIDTH_FACTOR` (ear span → face width, currently 1) and the 0.7 ear-point mix are untuned, and `scaleRatio` values are relative to that width.
4. **Dead weight to remove once the decision holds:** MediaPipe still ships in `dist` (`public/try-on/v1`, ~38 MB, the worker and the `@mediapipe/tasks-vision` chunk) and is reachable only from the lab selector. Deleting it is a separate, irreversible step.
5. **Runtime facts to remember:** the library's `destroy()` also stops the tracks of the video it was given (harmless: `camera.js` stops them anyway); the library pauses itself when the window loses focus, so a backgrounded tab stops tracking until focus returns; the 1.9 MB model and 175 KB runtime load only when the customer presses Start camera.

### Device evidence (2026-10-06, owner-reported)

iPhone 11, Safari, via an HTTPS Cloudflare quick tunnel to the local dev server: camera starts, WebAR.rocks tracking works, and the shop dialog functions (the owner reported "every function works well"). Not recorded: iOS version, FPS, start times, face shapes/lighting, hair or glasses cases, and no Android run. Treat this as a passing smoke test, not the §8 acceptance matrix. Remaining before enabling for shoppers: Android Chrome run, real product cutouts for the pilot earrings, the egress gate (§11), and the rollout steps in §11.
