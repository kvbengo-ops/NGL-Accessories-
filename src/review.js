/* ============================================================
   NGL Circle — community feed + reviews (review.html)
   Anyone can post from the composer. An email / mobile number that
   matches a delivered order publishes instantly as "Verified buyer";
   everything else waits for an admin (Admin → NGL Circle).
   Backend: setup/community.sql
   ============================================================ */
import { supabase, cfImg } from './supabase.js';

const PHOTO_BUCKET   = 'community-photos';
const MAX_PHOTO_EDGE = 1600;
// ponytail: newest 30 only; add "Load more" (range on created_at) once the feed outgrows it.
const FEED_LIMIT     = 30;
const REACTIONS = [
  { key: 'love',    emoji: '❤️', label: 'Send love' },
  { key: 'sparkle', emoji: '✨', label: 'Stunning' },
  { key: 'clap',    emoji: '👏', label: 'Love this' },
  { key: 'hug',     emoji: '🤗', label: 'Sending a hug' },
];
const REACTED_KEY = 'ngl-circle-reacted';  // { [postId]: ['love', …] } — this visitor's taps
const CONTACT_KEY = 'ngl-circle-contact';  // email / number remembered after a post

const $ = (id) => document.getElementById(id);
const feed         = $('circle-feed');
const dialog       = $('circle-dialog');
const form         = $('circle-form');
const promptBtn    = $('circle-prompt');
const caption      = $('circle-caption');
const counter      = $('circle-count');
const nameInput    = $('circle-name');
const contactInput = $('circle-contact');
const ratingSet    = $('circle-rating');
const ratingText   = $('circle-rating-text');
const photoInput   = $('circle-photo-input');
const photoPreview = $('circle-photo-preview');
const photoImg     = $('circle-photo-img');
const errorEl      = $('circle-error');
const statusEl     = $('circle-status');
const submitBtn    = $('circle-submit');

let photoBlob = null;
let rating    = 0;

/* ── Helpers ── */
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function readStore(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: just not remembered */ }
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
function timeAgo(iso) {
  const secs = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(secs) >= size) return relative.format(Math.round(secs / size), unit);
  }
  return 'just now';
}

function photoUrl(path) {
  return cfImg(supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl);
}

function starsHtml(n) {
  if (!n) return '';
  const stars = [1, 2, 3, 4, 5]
    .map(i => `<span class="material-symbols-outlined${i <= n ? ' is-on' : ''}" aria-hidden="true">star</span>`)
    .join('');
  return `<div class="circle-post-stars" role="img" aria-label="Rated ${n} out of 5">${stars}</div>`;
}

/* ── Feed ── */
function postHtml(post) {
  const name    = (post.author_name || '').trim() || 'An NGL friend';
  const reacted = readStore(REACTED_KEY, {})[post.id] || [];
  const counts  = post.reactions || {};
  return `
    <article class="circle-post" data-id="${escapeHtml(post.id)}">
      <span class="circle-avatar" aria-hidden="true">${escapeHtml(Array.from(name)[0].toUpperCase())}</span>
      <div class="circle-post-main">
        <header class="circle-post-head">
          <span class="circle-post-name">${escapeHtml(name)}</span>
          ${post.is_verified ? '<span class="circle-verified"><span class="material-symbols-outlined" aria-hidden="true">verified</span>Verified buyer</span>' : ''}
          <time class="circle-post-time" datetime="${escapeHtml(post.created_at)}">${timeAgo(post.created_at)}</time>
        </header>
        ${starsHtml(Number(post.rating) || 0)}
        <p class="circle-post-caption">${escapeHtml(post.caption)}</p>
        ${post.photo_path ? `<img class="circle-post-photo" src="${escapeHtml(photoUrl(post.photo_path))}" alt="Photo shared by ${escapeHtml(name)}" loading="lazy" />` : ''}
        <div class="circle-reactions" role="group" aria-label="React to this post">
          ${REACTIONS.map(r => {
            const n = Number(counts[r.key]) || 0;
            return `<button type="button" class="circle-reaction" data-key="${r.key}" aria-pressed="${reacted.includes(r.key)}" aria-label="${r.label}, ${n}">
              <span class="circle-reaction-emoji" aria-hidden="true">${r.emoji}</span><span class="circle-reaction-n" aria-hidden="true">${n}</span>
            </button>`;
          }).join('')}
        </div>
      </div>
    </article>`;
}

function showFeedMessage(title, body, actionHtml = '') {
  feed.innerHTML = `<div class="circle-empty"><h3>${title}</h3><p>${body}</p>${actionHtml}</div>`;
}

async function loadFeed() {
  feed.setAttribute('aria-busy', 'true');
  const { data, error } = await supabase
    .from('community_posts')
    .select('id, author_name, caption, rating, photo_path, reactions, is_verified, created_at')
    .order('created_at', { ascending: false })
    .limit(FEED_LIMIT);
  feed.setAttribute('aria-busy', 'false');

  if (error) {
    console.error('NGL Circle: feed failed to load', error);
    showFeedMessage('The circle is taking a breather', 'We couldn’t load posts just now.',
      '<button type="button" class="circle-btn-ghost" data-retry>Try again</button>');
    return;
  }
  if (!data.length) {
    showFeedMessage('Be the first to share', 'Loving your NGL piece? Tell the circle how it makes you feel.',
      '<button type="button" class="circle-btn" data-open-composer>Share your moment</button>');
    return;
  }
  feed.innerHTML = data.map(postHtml).join('');
}

/* ── Reactions (one of each per visitor, remembered on this device) ── */
function setCount(btn, n) {
  btn.querySelector('.circle-reaction-n').textContent = n;
  btn.setAttribute('aria-label', `${REACTIONS.find(r => r.key === btn.dataset.key).label}, ${n}`);
}

function rememberReaction(postId, key, on) {
  const reacted = readStore(REACTED_KEY, {});
  const keys = new Set(reacted[postId] || []);
  on ? keys.add(key) : keys.delete(key);
  reacted[postId] = [...keys];
  writeStore(REACTED_KEY, reacted);
}

async function react(btn) {
  if (btn.getAttribute('aria-pressed') === 'true') return;
  const post = btn.closest('.circle-post');
  const key  = btn.dataset.key;
  const n    = Number(btn.querySelector('.circle-reaction-n').textContent) || 0;

  // Optimistic: feels instant; rolled back if the server says no.
  btn.setAttribute('aria-pressed', 'true');
  setCount(btn, n + 1);
  rememberReaction(post.dataset.id, key, true);

  const { data, error } = await supabase.rpc('react_to_post', { p_post_id: post.dataset.id, p_reaction: key });
  if (error || !data) {
    console.error('NGL Circle: reaction failed', error);
    btn.setAttribute('aria-pressed', 'false');
    setCount(btn, n);
    rememberReaction(post.dataset.id, key, false);
    return;
  }
  post.querySelectorAll('.circle-reaction').forEach(b => setCount(b, Number(data[b.dataset.key]) || 0));
}

feed.addEventListener('click', (e) => {
  const reaction = e.target.closest('.circle-reaction');
  if (reaction) { react(reaction); return; }
  if (e.target.closest('[data-retry]')) { loadFeed(); return; }
  if (e.target.closest('[data-open-composer]')) openComposer();
});

/* ── Composer dialog ── */
function openComposer() {
  if (!dialog.open) dialog.showModal();
  caption.focus();
}
function closeComposer() {
  clearError();
  if (dialog.open) dialog.close();   // the draft is kept for next time
}

function showError(message, field) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  field?.focus();
}
function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = '';
}

function updateCount() {
  counter.textContent = `${caption.value.length} / 500`;
}

function setRating(n) {
  rating = n;
  ratingSet.dataset.rating = String(n);
  ratingText.textContent = n ? `${n} out of 5` : '';
  ratingSet.querySelectorAll('input').forEach(input => { input.checked = Number(input.value) === n; });
}

// Blank is fine; otherwise it must look like an email or a full mobile number.
function contactProblem(value) {
  if (!value) return '';
  if (value.includes('@')) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? '' : 'Please check your email address, or leave it blank.';
  }
  return value.replace(/\D/g, '').length >= 10 ? '' : 'Please enter a full mobile number, or leave it blank.';
}

function clearPhoto() {
  photoBlob = null;
  photoInput.value = '';
  photoPreview.hidden = true;
  if (photoImg.src.startsWith('blob:')) URL.revokeObjectURL(photoImg.src);
  photoImg.removeAttribute('src');
}

// Resize to ≤1600px JPEG before upload: faster on mobile data, and re-encoding
// drops EXIF, so a phone photo's GPS location never gets published.
async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale  = Math.min(1, MAX_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width  = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Could not encode photo'))), 'image/jpeg', 0.85);
  });
}

// Our own messages from community.sql are safe to show; anything else gets a calm fallback.
function friendlyError(err) {
  if (err?.code === 'P0001' && err.message) return err.message;
  if (/bucket not found|could not find the function|PGRST202/i.test(`${err?.message} ${err?.code}`)) {
    return 'Posting isn’t open just yet. Please try again soon.';
  }
  return 'Something went wrong while posting. Please try again.';
}

promptBtn.addEventListener('click', openComposer);
$('circle-close').addEventListener('click', closeComposer);
$('circle-cancel').addEventListener('click', closeComposer);
dialog.addEventListener('click', (e) => { if (e.target === dialog) closeComposer(); }); // backdrop tap
dialog.addEventListener('cancel', clearError); // Escape; every other close goes through closeComposer()
caption.addEventListener('input', updateCount);

ratingSet.addEventListener('change', (e) => setRating(Number(e.target.value)));
// Stars are optional: tapping the chosen star again clears the rating.
ratingSet.addEventListener('click', (e) => {
  const star = e.target.closest('.circle-star');
  if (star && Number(star.control?.value) === rating) {
    e.preventDefault();
    setRating(0);
  }
});

photoInput.addEventListener('change', async () => {
  const file = photoInput.files?.[0];
  clearError();
  if (!file) return;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    clearPhoto();
    showError('Please choose a JPG, PNG, or WEBP photo.');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    clearPhoto();
    showError('That photo is over 20 MB. Please choose a smaller one.');
    return;
  }
  try {
    photoBlob = await shrinkPhoto(file);
    if (photoImg.src.startsWith('blob:')) URL.revokeObjectURL(photoImg.src);
    photoImg.src = URL.createObjectURL(photoBlob);
    photoPreview.hidden = false;
  } catch (err) {
    console.error('NGL Circle: photo could not be read', err);
    clearPhoto();
    showError('We couldn’t read that photo. Please try another one.');
  }
});

$('circle-photo-remove').addEventListener('click', () => { clearPhoto(); photoInput.focus(); });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  statusEl.textContent = '';

  const text    = caption.value.trim();
  const contact = contactInput.value.trim();
  if (!text) return showError('Please write a few words about your NGL moment.', caption);
  const problem = contactProblem(contact);
  if (problem) return showError(problem, contactInput);

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">hourglass_empty</span>Posting…';
  try {
    let photoPath = null;
    if (photoBlob) {
      photoPath = `posts/${Date.now()}-${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await supabase.storage.from(PHOTO_BUCKET)
        .upload(photoPath, photoBlob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
      if (uploadError) throw uploadError;
    }

    const { data, error } = await supabase.rpc('create_community_post', {
      p_contact:     contact || null,
      p_author_name: nameInput.value.trim() || null,
      p_caption:     text,
      p_rating:      rating || null,
      p_photo_path:  photoPath,
    });
    if (error) throw error;

    if (contact) writeStore(CONTACT_KEY, contact);
    caption.value = '';
    updateCount();
    setRating(0);
    clearPhoto();
    closeComposer();

    if (data.status === 'published') {
      if (feed.querySelector('.circle-post')) feed.insertAdjacentHTML('afterbegin', postHtml(data));
      else feed.innerHTML = postHtml(data);
      statusEl.textContent = 'Posted! Thank you for spreading the love.';
    } else {
      statusEl.textContent = 'Thank you! Our team will take a quick look and publish your post soon.';
    }
    statusEl.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    feed.focus({ preventScroll: true });
  } catch (err) {
    console.error('NGL Circle: post failed', err);
    showError(friendlyError(err));
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">send</span>Post to the Circle';
  }
});

/* ── Boot ── */
// The "your order was delivered" email links here with ?order=&email=.
const params = new URLSearchParams(window.location.search);
contactInput.value = params.get('email') || readStore(CONTACT_KEY, '') || '';
if (params.has('order') || params.has('email')) {
  history.replaceState(null, '', window.location.pathname); // keep the email out of the address bar
  openComposer();
}

loadFeed();
