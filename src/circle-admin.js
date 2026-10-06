/* ============================================================
   NGL Admin — NGL Circle moderation
   Unverified community posts wait here as "pending" until an admin
   publishes them. Verified-buyer posts are already live and can be hidden.
   Backend: setup/community.sql (admin_* functions check is_admin()).
   ============================================================ */
import { requireAdmin, renderSidebar, showToast, escapeHtml } from './admin.js';
import { supabase, cfImg } from './supabase.js';

const REACTION_EMOJI = { love: '❤️', sparkle: '✨', clap: '👏', hug: '🤗' };
const EMPTY = {
  pending:   'Nothing waiting. New posts that aren’t from a verified buyer will show up here.',
  published: 'Nothing published yet.',
  rejected:  'No rejected or hidden posts.',
};
// [new status, button label, button class, icon]
const ACTIONS = {
  pending:   [['published', 'Approve', 'btn-admin-primary', 'check'], ['rejected', 'Reject', 'btn-admin-danger', 'close']],
  published: [['rejected', 'Hide', 'btn-admin-ghost', 'visibility_off']],
  rejected:  [['published', 'Publish', 'btn-admin-ghost', 'visibility']],
};

const list     = document.getElementById('cadm-list');
const subtitle = document.getElementById('cadm-subtitle');

let posts = [];
let activeStatus = 'pending';

function photoUrl(path) {
  return cfImg(supabase.storage.from('community-photos').getPublicUrl(path).data.publicUrl);
}

function formatDate(iso) {
  return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

// Stored as the last 10 digits (9171234567) → 0917 123 4567
function formatPhone(digits) {
  return digits.length === 10 ? `0${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}` : digits;
}

function postHtml(p) {
  const name      = (p.author_name || '').trim() || 'An NGL friend';
  const contact   = [p.contact_email, p.contact_phone && formatPhone(p.contact_phone)].filter(Boolean).join(' · ') || 'Not given';
  const reactions = Object.entries(p.reactions || {})
    .filter(([, n]) => Number(n) > 0)
    .map(([key, n]) => `${REACTION_EMOJI[key] || escapeHtml(key)} ${Number(n)}`)
    .join(' · ') || 'None yet';
  const stars = p.rating
    ? `<div class="cadm-stars" role="img" aria-label="Rated ${p.rating} out of 5">${[1, 2, 3, 4, 5]
        .map(i => `<span class="material-symbols-outlined${i <= p.rating ? ' is-on' : ''}" aria-hidden="true">star</span>`).join('')}</div>`
    : '';
  const media = p.photo_path
    ? `<a href="${escapeHtml(photoUrl(p.photo_path))}" target="_blank" rel="noopener" aria-label="Open photo from ${escapeHtml(name)} in a new tab">
         <img src="${escapeHtml(photoUrl(p.photo_path))}" alt="" loading="lazy" />
       </a>`
    : '<span class="material-symbols-outlined" aria-hidden="true">chat_bubble</span>';

  return `
    <article class="cadm-post" data-id="${escapeHtml(p.id)}">
      <div class="cadm-media">${media}</div>
      <div class="cadm-main">
        <header class="cadm-head">
          <strong>${escapeHtml(name)}</strong>
          <span class="cadm-badge cadm-badge--${p.is_verified ? 'verified' : 'unverified'}">${p.is_verified ? 'Verified buyer' : 'Not verified'}</span>
          <time class="cadm-time" datetime="${escapeHtml(p.created_at)}">${formatDate(p.created_at)}</time>
        </header>
        ${stars}
        <p class="cadm-caption">${escapeHtml(p.caption)}</p>
        <dl class="cadm-meta">
          <div><dt>Contact</dt><dd>${escapeHtml(contact)}</dd></div>
          <div><dt>Reactions</dt><dd>${reactions}</dd></div>
        </dl>
      </div>
      <div class="cadm-actions">
        ${ACTIONS[p.status].map(([to, label, cls, icon]) => `
          <button type="button" class="${cls}" data-to="${to}">
            <span class="material-symbols-outlined" aria-hidden="true">${icon}</span>${label}
          </button>`).join('')}
      </div>
    </article>`;
}

function render() {
  const counts = { pending: 0, published: 0, rejected: 0 };
  posts.forEach(p => { counts[p.status] += 1; });

  document.querySelectorAll('[data-count]').forEach(el => { el.textContent = counts[el.dataset.count]; });
  document.querySelectorAll('.cadm-filter').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.status === activeStatus));
  });
  subtitle.textContent = counts.pending
    ? `${counts.pending} post${counts.pending === 1 ? '' : 's'} waiting for your review.`
    : 'All caught up — nothing waiting for review.';

  const shown = posts.filter(p => p.status === activeStatus);
  list.innerHTML = shown.length
    ? shown.map(postHtml).join('')
    : `<div class="cadm-empty">${EMPTY[activeStatus]}</div>`;
}

async function load() {
  const { data, error } = await supabase.rpc('admin_list_community_posts', { p_status: null });
  if (error) {
    console.error('NGL Circle admin: load failed', error);
    const missing = /could not find the function|PGRST202/i.test(`${error.message} ${error.code}`);
    list.innerHTML = `<div class="cadm-empty">${missing
      ? 'The NGL Circle database isn’t set up yet. Run setup/community.sql in the Supabase SQL Editor.'
      : `Couldn’t load posts: ${escapeHtml(error.message)}`}</div>`;
    return;
  }
  posts = data || [];
  render();
}

async function setStatus(card, to) {
  const post = posts.find(p => p.id === card.dataset.id);
  if (!post) return;
  card.querySelectorAll('button').forEach(b => { b.disabled = true; });

  const { data, error } = await supabase.rpc('admin_set_community_post_status', { p_post_id: post.id, p_status: to });
  if (error) {
    console.error('NGL Circle admin: update failed', error);
    showToast(`Couldn’t update the post: ${error.message}`, 'error');
    card.querySelectorAll('button').forEach(b => { b.disabled = false; });
    return;
  }

  Object.assign(post, data);
  showToast(to === 'published' ? 'Post published to the NGL Circle' : 'Post removed from the NGL Circle');
  render();
  list.focus({ preventScroll: true });
}

async function init() {
  const admin = await requireAdmin();
  renderSidebar('NGL Circle', admin);

  document.querySelector('.cadm-filters').addEventListener('click', (e) => {
    const btn = e.target.closest('.cadm-filter');
    if (!btn) return;
    activeStatus = btn.dataset.status;
    render();
  });
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-to]');
    if (btn) setStatus(btn.closest('.cadm-post'), btn.dataset.to);
  });
  document.getElementById('cadm-refresh').addEventListener('click', load);

  await load();
}

init();
