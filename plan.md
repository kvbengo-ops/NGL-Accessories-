# NGL Earring Virtual Try-On — Implementation Plan

Status: Planned; no feature code implemented by this document.
Created: 2026-10-06

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

Use a pinned version of `@mediapipe/tasks-vision` with a compatible Face Landmarker model, video mode, one face, and facial transformation matrices. Disable outputs the feature does not use. Browser face landmarks and transformations are documented by [Google](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js).

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
