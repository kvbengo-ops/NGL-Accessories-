# 3D Earring Try-On Implementation Plan

## Objective

Render hoops with convincing depth during head turns and animate drop earrings so their hanging sections respond naturally to movement and gravity.

## Scope and assumptions

This plan assumes a browser-based camera try-on. Repository inspection was unavailable when this plan was written, so component names, existing tracking capabilities, and dependencies must be confirmed before implementation.

The first release will support one rigid hoop and one single-piece hanging drop. Multi-link chains, detailed hair occlusion, and automatic reconstruction from product photos are later work. Camera-based scale is approximate until calibrated; the preview must not imply measurement accuracy.

## Phase 1: Inspect the existing preview

- Identify the camera component, tracking pipeline, current earring placement logic, product metadata, and rendering loop.
- Confirm how video cropping, resizing, front-camera mirroring, and device orientation are handled.
- Record the current behavior and performance on representative phones.
- Reuse existing tracking where it provides suitable head pose; evaluate MediaPipe Face Landmarker if additional tracking is needed.

Deliverable: a confirmed integration map and a baseline for placement stability and performance.

## Phase 2: Add the 3D overlay and attachment calibration

- Add a transparent Three.js canvas over the camera feed, with synchronized crop, dimensions, and mirroring.
- Define one coordinate convention for tracking, rendering, model units, and physics. Convert model dimensions from millimeters to those units consistently.
- Map head pose into the renderer's camera space and calibrate approximate left and right piercing positions using head-local offsets.
- Provide a small placement adjustment when necessary. Face landmarks do not directly identify piercing locations.
- Smooth attachment position and rotation while preserving responsive movement.
- Hide earrings when tracking becomes unreliable; reset state before showing them again after reacquisition.

Deliverable: stable 3D attachment markers on both ears during front-facing views, head tilts, and moderate turns.

## Phase 3: Implement a hoop prototype

- Generate a simple hoop from procedural geometry with configurable diameter, thickness, opening, and attachment orientation.
- Attach each hoop to its ear anchor and apply head pose so its depth and side profile change during turns.
- Configure left and right orientations explicitly; do not mirror the model with a negative scale without checking geometry and materials.
- Use a basic metallic material and environment lighting to make shape readable.
- Calibrate visual size against known product dimensions and the chosen face-scale estimate.

Deliverable: one hoop that stays aligned and displays a convincing opening and side profile.

## Phase 4: Implement drop movement

- Separate the fixed attachment mesh from the hanging mesh. Place the hanging mesh pivot at its joint.
- Implement a constrained pendulum in 3D with a fixed length and configurable damping. Use two angular degrees of freedom or an equivalent constrained-point simulation.
- Drive the attachment with smoothed ear tracking and derive bounded attachment acceleration from that smoothed motion.
- Apply gravity in the selected camera/world space, independently of head rotation. For the initial upright-camera experience, screen-down gravity is an approximation; handle device rotation explicitly and assess device orientation sensing if needed.
- Keep the pendant's position constrained to its length from the joint and derive its orientation from the resulting direction.
- Use a fixed timestep with bounded substeps. Reset velocity and previous-anchor state after tracking loss, tab suspension, product changes, or large position discontinuities.
- Tune damping and swing limits for plausible movement; do not feed raw tracking noise into the simulation.

Deliverable: one drop that hangs downward, swings with movement, and settles without jitter or explosive motion.

## Phase 5: Product assets and configuration

Add optional try-on metadata to products using the project's existing schema conventions:

| Field | Purpose |
| --- | --- |
| Earring type | Select stud, hoop, or drop behavior |
| Model URL | Load a GLB asset for detailed geometry |
| Dimensions in millimeters | Configure approximate visual scale |
| Attachment point | Locate the piercing or joint in model-local coordinates |
| Left/right orientation | Align each asset with its ear |
| Hanging mesh or node | Identify the animated section for drops |
| Pendulum length and damping | Configure motion per product |

- Author GLB models with consistent units, origins, and named attachment/hanging nodes.
- Use procedural geometry for simple hoops; model detailed shapes from dimensions and multiple references.
- Validate assets before enabling 3D try-on. A single photograph is insufficient for reliable hidden-side geometry.
- Cache loaded assets and release geometry, textures, and materials when no longer needed.
- Preserve a supported fallback for products without valid 3D assets or devices where the renderer cannot run.

Deliverable: product selection loads the correct asset, dimensions, attachment, and motion settings without stale state.

## Phase 6: Occlusion and performance

- Add a calibrated invisible head occluder that writes depth before the earrings, hiding geometry behind the head.
- Verify that the occluder does not incorrectly hide visible pendants. Face-only geometry may need an approximate head extension.
- Treat hair and precise ear overlap as separate improvements; basic head occlusion does not solve them.
- Run rendering independently from tracking frequency where practical and avoid repeated per-frame allocations.
- Choose model complexity and tracking frequency using measured performance on target phones.

Deliverable: believable head overlap and acceptable mobile responsiveness.

## Validation and release criteria

- Hoops retain recognizable depth during moderate side turns and stay attached through head tilts.
- Drops remain gravity-driven when the head tilts, swing after movement, and settle while the user is still.
- Tracking jitter does not produce persistent shaking.
- Tracking loss, reacquisition, resize, device rotation, tab resume, and product switching produce no sudden simulation jumps.
- Left/right placement remains correct under mirrored front-camera display.
- Head occlusion hides the far-side geometry without clipping the visible earring excessively.
- Product dimensions produce consistent approximate sizing after calibration.
- Test the browser/device combinations supported by the project, including representative iOS and Android phones.
- Measure frame time, tracking latency, and resource usage against the Phase 1 baseline; agree on release thresholds from those measurements.
- Add focused automated checks for coordinate conversion, pendulum constraints and settling, and simulation reset behavior where the existing test setup supports them. Use live-camera visual checks for alignment and occlusion.

## Recommended implementation order

1. Inspect the current preview and establish coordinate conventions.
2. Add stable 3D ear attachment markers.
3. Render one procedural hoop.
4. Animate one simple drop.
5. Add product metadata and GLB asset loading.
6. Add head occlusion and tune mobile performance.
7. Validate on supported devices and expand the catalog.

## Technical references

- [MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker): facial landmarks and head transformation output; piercing placement still requires estimation or calibration.
- [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html): loading GLB/glTF assets into the 3D scene.
