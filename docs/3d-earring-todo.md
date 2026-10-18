# 3D Earring Try-On TODO — Codex + Claude

Implementation reference: [3D earring implementation plan](3d-earring-implementation-plan.md).

Assignments below are proposed ownership for implementation. A checked item means the work has been completed and verified. Claude must receive this checklist separately; creating it does not start a Claude session.

## 0. Codex: Automatic camera startup on phones — first priority

Complete this before the 3D earring work.

- [x] Request camera access automatically when the mobile try-on view opens; remove the required initial "Open camera" button.
- [x] Request the front-facing camera and configure the preview for inline, muted playback.
- [x] Show a loading state while the camera permission request or initialization is pending.
- [x] Handle permission denial, unavailable cameras, and initialization failures with a clear message and a retry action.
- [x] Avoid duplicate camera requests and stop camera tracks when leaving the view.
- [ ] Verify startup on supported iOS and Android browsers, including first-time permission, previously granted permission, and denied permission.

Completion: entering the phone try-on view starts the camera after any required browser permission prompt, without an initial camera-start button. Browser permission cannot be bypassed; a recovery action may still be necessary after denial or platform restrictions.

## 0.1. Codex: Mobile catalog below the mirror

Complete alongside automatic camera startup, before the 3D earring work.

- [x] Place the camera mirror above the earring catalog in the phone layout.
- [x] Render the catalog as a horizontal, touch-scrollable row of earring cards with visible thumbnails and product names.
- [x] Allow swiping left to browse later earrings and right to browse earlier earrings; swiping browses without changing the active selection.
- [x] Select an earring on tap and update the mirror preview using the existing product-selection behavior.
- [x] Clearly highlight the selected earring and keep selection stable while browsing.
- [x] Keep the mirror visible while choosing products and make touch targets comfortable on narrow phone screens.
- [x] Ensure horizontal catalog scrolling does not cause page-wide horizontal overflow or interfere with normal vertical scrolling.
- [ ] Verify portrait and landscape layouts, long catalogs, and product switching on supported iOS and Android browsers.

Completion: on phones, users see the mirror above a swipeable catalog, browse earrings with a horizontal swipe, and tap a card to try it on.

## 1. Codex: Inspect and define integration contracts

- [ ] Read repository instructions and inspect the existing camera preview, tracking, product data, and tests.
- [ ] Identify the actual files each contributor will own and record them below before parallel edits.
- [ ] Document coordinate axes, units, camera projection, video crop, mirroring, and head-pose conversion.
- [ ] Define the ear-anchor output shared with Claude: timestamp, position, rotation, confidence, and tracking validity for each ear.
- [ ] Agree on product metadata and model conventions: dimensions, attachment origin, left/right orientation, and hanging-node names.
- [ ] Record baseline performance and supported devices/browsers.

Completion: Claude can implement motion against a documented contract without changing camera or tracking code.

## 2. Codex: Rendering, tracking, and hoops

- [ ] Integrate a transparent Three.js overlay with the existing camera preview.
- [ ] Synchronize resize, cropping, mirroring, and orientation changes.
- [ ] Calculate and smooth approximate left/right piercing anchors; support calibration adjustments.
- [ ] Hide earrings on unreliable tracking and expose reset events on reacquisition.
- [ ] Implement one procedural hoop with configurable dimensions and orientation.
- [ ] Verify attachment stability and hoop depth through head turns and tilts.
- [ ] Add GLB loading, caching, cleanup, and a fallback for unsupported products/devices.
- [ ] Wire agreed product metadata into product selection.
- [ ] Add basic head depth occlusion and document hair-occlusion limitations.

## 3. Claude: Drop physics and focused verification

Start after the integration contracts in section 1 are agreed. Keep motion code independent of camera/tracking implementation.

- [ ] Implement a standalone 3D constrained pendulum with configurable length and damping.
- [ ] Use a fixed timestep and bounded substeps.
- [ ] Derive bounded attachment acceleration from smoothed anchor samples.
- [ ] Apply gravity independently of head rotation using the agreed coordinate convention.
- [ ] Calculate pendant position and orientation while preserving distance from its joint.
- [ ] Separate the fixed attachment and hanging mesh in a simple drop prototype.
- [ ] Implement resets for tracking loss/reacquisition, large discontinuities, tab resume, and product changes.
- [ ] Add meaningful checks for length constraints, settling, timestep behavior, and resets using the existing test framework.
- [ ] Document tuning parameters and integration instructions for Codex.

Completion: a stationary anchor produces a settled drop; moving it produces bounded swing; resets produce no sudden launch or invalid values.

## 4. Codex: Integrate Claude's motion module

- [ ] Connect ear-anchor samples and reset events to the pendulum controller.
- [ ] Load the fixed and hanging model nodes and apply the simulated transform in the correct space.
- [ ] Configure motion per product and verify independent state for left/right earrings.
- [ ] Check switching between studs, hoops, and drops without stale assets or motion.
- [ ] Review Claude's changes and run the relevant checks.

## 5. Shared release checklist

- [ ] Verify front-facing views, side turns, head tilts, rapid movement, and stillness.
- [ ] Verify tracking loss/reacquisition, resize, device rotation, and tab suspension/resume.
- [ ] Verify mirrored left/right placement and approximate product scale.
- [ ] Verify head occlusion without excessive clipping of visible earrings.
- [ ] Test representative supported iOS and Android devices.
- [ ] Measure performance against the baseline and resolve regressions.
- [ ] Document known limitations: approximate piercing placement/scale, hair overlap, and upright-camera gravity assumptions if applicable.
- [ ] Mark the first hoop and drop ready before expanding the product catalog.

## File ownership — fill after inspection

| Area | Owner | Actual files |
| --- | --- | --- |
| Camera, tracking, coordinate conversion | Codex | To identify |
| 3D renderer, hoop, assets, product wiring | Codex | To identify |
| Pendulum module and its tests | Claude | To identify |
| Motion integration and final verification | Codex | To identify |

Avoid editing another contributor's assigned files concurrently. If a shared contract changes, update it and coordinate before dependent edits.
