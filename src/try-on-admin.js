import { requireAdmin, renderSidebar, showToast } from './admin.js';
import { getAllProducts, getTryOnConfigAdmin, upsertTryOnConfig, uploadTryOnAsset, cfImg } from './supabase.js';
import { validateConfig, loadAsset, cropRect, cropAdjust, trimFromAlpha } from './try-on/assets.js';
import { createPreviewSession } from './try-on/controller.js';

const $ = id => document.getElementById(id);
const productId = new URLSearchParams(location.search).get('product');
const preview = createPreviewSession({ view: $('preview'), canvas: $('preview-canvas'), onState: state => { $('preview-status').textContent = state; } });
let config, original, product;
const pending = { left: null, right: null };
const localUrls = { left: null, right: null };
let refreshTimer;

function defaultConfig(id) {
  return { productId: id, version: 1, enabled: false,
    assets: { left: null, right: null }, mirrorLeftForRight: true,
    anchor: { left: { x: 0.5, y: 0.1 }, right: { x: 0.5, y: 0.1 } },
    offset: { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } },
    rotationDeg: { left: 0, right: 0 }, scaleRatio: 0.18, lengthMm: null };
}
function clearErrors() { document.querySelectorAll('[data-error]').forEach(el => { el.textContent = ''; }); }
function showErrors(errors) {
  clearErrors();
  for (const [field, message] of Object.entries(errors || {})) {
    const el = document.querySelector(`[data-error="${field}"]`);
    if (el) el.textContent = message;
  }
}
function updateAnchors() {
  for (const side of ['left', 'right']) {
    const button = $(`${side}-anchor`);
    const image = button.querySelector('img');
    const scale = image.naturalWidth ? Math.min(button.clientWidth / image.naturalWidth, button.clientHeight / image.naturalHeight) : 0;
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    const x = (button.clientWidth - width) / 2 + config.anchor[side].x * width;
    const y = (button.clientHeight - height) / 2 + config.anchor[side].y * height;
    button.style.setProperty('--ax', `${x || button.clientWidth / 2}px`);
    button.style.setProperty('--ay', `${y || button.clientHeight / 2}px`);
    button.title = `Attachment point: ${config.anchor[side].x.toFixed(2)}, ${config.anchor[side].y.toFixed(2)}`;
  }
}
function refreshPreview() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const candidate = { ...config, assets: { left: localUrls.left || config.assets.left, right: localUrls.right || config.assets.right } };
    if (candidate.assets.left && (candidate.mirrorLeftForRight || candidate.assets.right)) preview.setProduct(candidate);
  }, 80);
}
function fill() {
  $('mirror').checked = config.mirrorLeftForRight;
  $('right-file-wrap').hidden = config.mirrorLeftForRight;
  $('right-anchor').hidden = config.mirrorLeftForRight;
  document.querySelector('[data-crop="right"]').hidden = config.mirrorLeftForRight;
  for (const [id, value] of [
    ['scale', config.scaleRatio], ['length', config.lengthMm ?? ''],
    ['left-x', config.offset.left.x], ['left-y', config.offset.left.y],
    ['right-x', config.offset.right.x], ['right-y', config.offset.right.y],
    ['left-rot', config.rotationDeg.left], ['right-rot', config.rotationDeg.right],
  ]) { $(id).value = value; const output = $(`${id}-value`); if (output) output.value = value; }
  updateAnchors();
  for (const side of ['left', 'right']) {
    const img = $(`${side}-anchor`).querySelector('img');
    const src = localUrls[side] || cfImg(config.assets[side]);
    if (src) img.src = cfImg(src); else img.removeAttribute('src');
    img.onload = updateAnchors;
  }
  refreshPreview();
}
async function transparent(file) {
  if (!['image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG or WebP image.');
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height) throw new Error('Image could not be decoded.');
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
    throw new Error('Image needs transparent pixels around one earring.');
  } finally { bitmap.close(); }
}
// `trusted`: the file came from cropping an already-validated image, so skip the transparency check.
async function chooseFile(side, file, trusted = false) {
  if (!file) return false;
  const error = document.querySelector(`[data-error="assets.${side}"]`);
  const previous = pending[side];
  try {
    if (!trusted) await transparent(file);
    if (localUrls[side]) URL.revokeObjectURL(localUrls[side]);
    localUrls[side] = URL.createObjectURL(file);
    pending[side] = file;
    $(`${side}-anchor`).querySelector('img').src = cfImg(localUrls[side]); // blob: URLs pass through cfImg unchanged
    error.textContent = '';
    refreshPreview();
    return true;
  } catch (cause) { pending[side] = previous; error.textContent = cause.message; return false; }
}

/* ── Crop ── (the maths lives in try-on/assets.js so it is unit-tested) */
const crop = { side: null, img: null, l: 0, t: 0, r: 0, b: 0 };
const cropKeys = ['l', 't', 'r', 'b'];
const cropPair = { l: 'r', r: 'l', t: 'b', b: 't' };
function drawCrop() {
  for (const k of cropKeys) { $(`crop-${k}`).value = crop[k]; $(`crop-${k}-value`).value = `${crop[k]}%`; }
  $('crop-box').style.inset = `${crop.t}% ${crop.r}% ${crop.b}% ${crop.l}%`;
}
async function openCrop(side) {
  const sideError = document.querySelector(`[data-error="assets.${side}"]`);
  const src = localUrls[side] || config.assets[side];
  if (!src) { sideError.textContent = 'Upload an image first.'; return; }
  try { crop.img = await loadAsset(src); } catch { sideError.textContent = 'Could not load this image to crop.'; return; }
  sideError.textContent = '';
  Object.assign(crop, { side, l: 0, t: 0, r: 0, b: 0 });
  crop.img.alt = 'Image to crop';
  $('crop-stage').querySelector('img')?.remove();
  $('crop-stage').prepend(crop.img);
  $('crop-error').textContent = '';
  drawCrop();
  $('crop-dialog').showModal();
}
for (const k of cropKeys) {
  $(`crop-${k}`).addEventListener('input', event => {
    crop[k] = Math.min(Number(event.target.value), 95 - crop[cropPair[k]]); // always leave a sliver of image
    drawCrop();
  });
}
$('crop-auto').addEventListener('click', () => {
  const { img } = crop, W = img.naturalWidth, H = img.naturalHeight;
  try {
    const ctx = Object.assign(document.createElement('canvas'), { width: W, height: H }).getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const trims = trimFromAlpha(ctx.getImageData(0, 0, W, H).data, W, H);
    if (!trims) { $('crop-error').textContent = 'No visible pixels found in this image.'; return; }
    Object.assign(crop, trims);
    $('crop-error').textContent = '';
    drawCrop();
  } catch { $('crop-error').textContent = 'Could not read this image to auto-trim.'; }
});
$('crop-apply').addEventListener('click', async () => {
  const { img, side } = crop, W = img.naturalWidth, H = img.naturalHeight;
  const rect = cropRect(W, H, crop);
  const canvas = Object.assign(document.createElement('canvas'), { width: rect.w, height: rect.h });
  canvas.getContext('2d').drawImage(img, rect.x0, rect.y0, rect.w, rect.h, 0, 0, rect.w, rect.h);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) { $('crop-error').textContent = 'Could not crop this image.'; return; }
  const before = { anchor: config.anchor[side], scaleRatio: config.scaleRatio };
  if (!await chooseFile(side, new File([blob], `${side}-cropped.png`, { type: 'image/png' }), true)) { $('crop-dialog').close(); return; }
  const next = cropAdjust({ W, H, rect, anchor: before.anchor, scaleRatio: before.scaleRatio });
  config.anchor[side] = next.anchor;
  if (config.mirrorLeftForRight) { // one image drives both ears, so its height drives the shared scale
    config.anchor.right = { x: 1 - config.anchor.left.x, y: config.anchor.left.y };
    config.scaleRatio = next.scaleRatio;
  }
  fill();
  $('crop-dialog').close();
  $('save-status').textContent = config.mirrorLeftForRight
    ? 'Cropped. Scale was adjusted so the earring keeps its size.'
    : 'Cropped. Recheck Scale: it is relative to the image height.';
});
$('crop-cancel').addEventListener('click', () => $('crop-dialog').close());
document.querySelectorAll('[data-crop]').forEach(button => button.addEventListener('click', () => openCrop(button.dataset.crop)));
function anchorClick(side, event) {
  const img = $(`${side}-anchor`).querySelector('img');
  if (!img.naturalWidth) return;
  const box = img.getBoundingClientRect();
  const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
  const width = img.naturalWidth * scale, height = img.naturalHeight * scale;
  const x = (event.clientX - box.left - (box.width - width) / 2) / width;
  const y = (event.clientY - box.top - (box.height - height) / 2) / height;
  config.anchor[side] = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  if (side === 'left' && config.mirrorLeftForRight) config.anchor.right = { x: 1 - config.anchor.left.x, y: config.anchor.left.y };
  updateAnchors(); refreshPreview();
}
async function save(enabled) {
  $('save-status').textContent = 'Saving…';
  clearErrors();
  try {
    const candidate = structuredClone(config);
    candidate.enabled = enabled;
    for (const side of ['left', 'right']) if (pending[side] && (side === 'left' || !candidate.mirrorLeftForRight)) candidate.assets[side] = localUrls[side];
    if (candidate.mirrorLeftForRight) { candidate.assets.right = null; candidate.anchor.right = { x: 1 - candidate.anchor.left.x, y: candidate.anchor.left.y }; }
    if (enabled) {
      const { errors } = validateConfig(candidate);
      if (Object.keys(errors).length) { showErrors(errors); throw new Error('Fix the marked fields before publishing.'); }
    }
    // Upload only after local validation. The DB row changes after every upload succeeds.
    for (const side of ['left', 'right']) {
      if (pending[side] && (side === 'left' || !candidate.mirrorLeftForRight)) candidate.assets[side] = await uploadTryOnAsset(pending[side], productId, side);
    }
    await upsertTryOnConfig(candidate);
    config = candidate;
    original = structuredClone(candidate);
    for (const side of ['left', 'right']) {
      pending[side] = null;
      if (localUrls[side]) { URL.revokeObjectURL(localUrls[side]); localUrls[side] = null; }
    }
    fill();
    $('save-status').textContent = enabled ? 'Published.' : 'Saved as disabled draft.';
    showToast(enabled ? 'Try-on published' : 'Try-on saved');
  } catch (error) {
    if (error.errors) showErrors(error.errors);
    $('save-status').textContent = error.message || 'Save failed.';
    showToast($('save-status').textContent, 'error');
  }
}
async function disable() {
  $('save-status').textContent = 'Disabling…';
  try {
    await upsertTryOnConfig({ ...original, enabled: false });
    original.enabled = false;
    config.enabled = false;
    $('save-status').textContent = 'Try-on disabled.';
    showToast('Try-on disabled');
  } catch (error) {
    $('save-status').textContent = error.message || 'Could not disable try-on.';
    showToast($('save-status').textContent, 'error');
  }
}
async function init() {
  const admin = await requireAdmin();
  renderSidebar('Inventory', admin);
  const products = await getAllProducts();
  product = products.find(item => item.id === productId);
  if (!product || product.category !== 'Earrings') { $('product-name').textContent = 'Select an earring from Inventory.'; document.querySelectorAll('button').forEach(button => button.disabled = true); return; }
  $('product-name').textContent = product.name;
  config = await getTryOnConfigAdmin(productId) || defaultConfig(productId);
  original = structuredClone(config);
  fill();
  for (const side of ['left', 'right']) {
    for (const axis of ['x', 'y']) {
      const error = document.createElement('span');
      error.className = 'try-editor-error';
      error.dataset.error = `anchor.${side}.${axis}`;
      $(`${side}-anchor`).after(error);
    }
    $(`${side}-file`).addEventListener('change', event => chooseFile(side, event.target.files[0]));
    $(`${side}-anchor`).addEventListener('click', event => anchorClick(side, event));
  }
  $('mirror').addEventListener('change', event => { config.mirrorLeftForRight = event.target.checked; if (event.target.checked) config.anchor.right = { x: 1 - config.anchor.left.x, y: config.anchor.left.y }; fill(); });
  for (const [id, update] of [
    ['scale', value => { config.scaleRatio = value; }], ['length', value => { config.lengthMm = value || null; }],
    ['left-x', value => { config.offset.left.x = value; }], ['left-y', value => { config.offset.left.y = value; }],
    ['right-x', value => { config.offset.right.x = value; }], ['right-y', value => { config.offset.right.y = value; }],
    ['left-rot', value => { config.rotationDeg.left = value; }], ['right-rot', value => { config.rotationDeg.right = value; }],
  ]) $(id).addEventListener('input', event => { update(Number(event.target.value)); const output = $(`${id}-value`); if (output) output.value = event.target.value; refreshPreview(); });
  $('save-draft').addEventListener('click', () => save(false));
  $('publish').addEventListener('click', () => save(true));
  $('disable').addEventListener('click', disable);
  $('preview-start').addEventListener('click', () => preview.start());
  $('preview-stop').addEventListener('click', () => { preview.stop(); $('preview-status').textContent = 'Camera off'; });
}
window.addEventListener('pagehide', () => { preview.stop(); for (const url of Object.values(localUrls)) if (url) URL.revokeObjectURL(url); });
init().catch(error => { $('product-name').textContent = error.message || 'Editor could not load.'; });
