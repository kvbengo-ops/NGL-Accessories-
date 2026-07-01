/* ============================================================
   NGL — Customer Reviews (submit + public wall)
   ============================================================ */
import { supabase } from './supabase.js';

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const form      = document.getElementById('rv-form');
const formCard  = document.getElementById('rv-form-card');
const thanks    = document.getElementById('rv-thanks');
const errorEl   = document.getElementById('rv-error');
const errorText = document.getElementById('rv-error-text');
const submitBtn = document.getElementById('rv-submit');

function showError(msg) { errorText.textContent = msg; errorEl.style.display = 'flex'; }
function clearError()   { errorEl.style.display = 'none'; }

/* ── Deep link from the delivered email: prefill order + email ── */
const params = new URLSearchParams(window.location.search);
if (params.get('order')) document.getElementById('rv-order').value = params.get('order');
if (params.get('email')) document.getElementById('rv-email').value = params.get('email');

/* ── Submit ── */
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const rating = Number(document.querySelector('input[name="rating"]:checked')?.value || 0);
  const body   = document.getElementById('rv-body').value.trim();
  const order  = document.getElementById('rv-order').value.trim();
  const email  = document.getElementById('rv-email').value.trim();

  if (!rating)        return showError('Please tap a star to rate your order.');
  if (!order || !email) return showError('Please enter your order number and email.');

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span> Submitting…';

  try {
    const { error } = await supabase.rpc('submit_review', {
      p_order_number: order,
      p_email:        email,
      p_rating:       rating,
      p_body:         body || null,
    });
    if (error) { showError(error.message || 'Could not submit your review. Please try again.'); return; }

    formCard.style.display = 'none';
    thanks.style.display   = '';
    loadReviews(); // refresh the wall to include the new one
  } catch (err) {
    console.error('submit_review error:', err);
    showError(`Something went wrong: ${err?.message || err}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span class="material-symbols-outlined">send</span> Submit Review';
  }
});

/* ── Public review wall ── */
async function loadReviews() {
  const list = document.getElementById('rv-wall-list');
  const { data, error } = await supabase
    .from('reviews')
    .select('customer_name, rating, body, created_at')
    .eq('is_published', true)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) { list.innerHTML = '<p class="rv-empty">Couldn\'t load reviews right now.</p>'; return; }
  if (!data?.length) { list.innerHTML = '<p class="rv-empty">No reviews yet — be the first!</p>'; return; }

  list.innerHTML = data.map(r => {
    const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
    const date  = r.created_at ? new Date(r.created_at).toLocaleDateString('en-PH', { dateStyle: 'medium' }) : '';
    return `
      <div class="rv-item">
        <div class="rv-item-top">
          <span class="rv-item-name">${escapeHtml(r.customer_name || 'Verified buyer')}</span>
          <span class="rv-item-date">${date}</span>
        </div>
        <div class="rv-item-stars" aria-label="${r.rating} out of 5">${stars}</div>
        ${r.body ? `<p class="rv-item-body">${escapeHtml(r.body)}</p>` : ''}
      </div>`;
  }).join('');
}

loadReviews();
