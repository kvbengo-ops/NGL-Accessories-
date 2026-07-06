/* ============================================================
   NGL — Checkout Flow Logic
   ============================================================ */
import { supabase, createOrder, generateOrderNumber, getProducts, getStoreSettings, DEFAULT_SETTINGS, uploadPaymentProof, attachPaymentProof, cfImg } from './supabase.js';

let settings = { ...DEFAULT_SETTINGS };

let cart     = [];
let step     = 1;
let details  = {};

// Local delivery — we only serve the Metro Cebu corridor (Cebu City → Consolacion).
// The customer picks an AREA (stored in orders.province) and a DELIVERY METHOD.
// Both methods are ₱0 at checkout: meetup is free and any Maxim/Movit fare is
// paid directly to the rider on arrival.
const DELIVERY_AREAS = ['Cebu City', 'Mandaue City', 'Consolacion', 'Liloan', 'Compostela'];
const DELIVERY_METHODS = {
  meetup: {
    label:   'Meetup',
    summary: '🎉 Free',
    note:    "Free meetup — we'll message you to agree on a spot & time.",
    addrLabel: 'Preferred meetup point *',
    addrPlaceholder: 'Area, landmark, and a time that works for you',
  },
  courier: {
    label:   'Maxim / Movit',
    summary: 'Paid to rider',
    note:    'Maxim/Movit fare is paid directly to the rider on arrival.',
    addrLabel: 'Delivery Address *',
    addrPlaceholder: 'House/Unit, Street, Barangay, landmark',
  },
};

function selectedProvince() {
  return document.getElementById('c-province')?.value || details.province || '';
}
function selectedMethod() {
  const v = document.querySelector('.delivery-radio:checked')?.value || details.delivery_method_key || 'meetup';
  return DELIVERY_METHODS[v] ? v : 'meetup';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Fill the payment panels + free-shipping trust line from store settings
function renderSettings() {
  const gcashNum  = document.getElementById('gcash-number-display');
  const gcashName = document.getElementById('gcash-name-display');
  const bankInfo  = document.getElementById('bank-accounts-display');
  const trustShip = document.getElementById('trust-free-shipping');

  if (gcashNum)  gcashNum.textContent  = settings.gcash_number;
  if (gcashName) gcashName.textContent = settings.gcash_name;
  if (bankInfo) {
    bankInfo.innerHTML = settings.bank_accounts
      .split('\n').filter(Boolean)
      .map(line => `<p>${escapeHtml(line)}</p>`).join('');
  }
  if (trustShip) trustShip.textContent = 'Free meetup or Maxim/Movit delivery — Metro Cebu';
}

async function loadSettings() {
  try {
    settings = await getStoreSettings();
  } catch (err) {
    console.error('Could not load store settings, using defaults:', err);
  }
  renderSettings();
  updateSummary();
}

// Fill the delivery-area dropdown with our covered Metro Cebu areas.
function loadAreas() {
  const select = document.getElementById('c-province');
  if (select) {
    const opts = DELIVERY_AREAS
      .map(area => `<option value="${escapeHtml(area)}">${escapeHtml(area)}</option>`)
      .join('');
    select.insertAdjacentHTML('beforeend', opts);
  }
  syncDeliveryMethod();
  updateSummary();
}

// Reflect the chosen delivery method in the address field's label/placeholder.
function syncDeliveryMethod() {
  const m   = DELIVERY_METHODS[selectedMethod()];
  const lbl = document.getElementById('c-address-label');
  const ta  = document.getElementById('c-address');
  if (lbl) lbl.textContent = m.addrLabel;
  if (ta)  ta.placeholder  = m.addrPlaceholder;
}

document.getElementById('c-province')?.addEventListener('change', () => {
  clearFieldError('c-province');
  updateSummary();
});

document.querySelectorAll('.delivery-radio').forEach(radio => {
  radio.addEventListener('change', () => {
    syncDeliveryMethod();
    updateSummary();
  });
});

// Load cart from localStorage
function loadCart() {
  try {
    cart = JSON.parse(localStorage.getItem('ngl_cart') || '[]');
  } catch {
    cart = [];
  }
}

function saveCart() {
  localStorage.setItem('ngl_cart', JSON.stringify(cart));
}

function formatPrice(n) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

function showStockWarning(maxStock) {
  let toast = document.getElementById('checkout-stock-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'checkout-stock-toast';
    toast.style.cssText = [
      'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
      'background:var(--charcoal-2)', 'color:var(--coral-light)',
      'font-family:var(--font-sans)', 'font-size:12px', 'letter-spacing:0.05em',
      'padding:10px 20px', 'border-radius:4px',
      'border:1px solid rgba(232,112,90,0.3)',
      'box-shadow:0 4px 24px rgba(0,0,0,0.18)',
      'display:flex', 'align-items:center', 'gap:8px',
      'z-index:9999', 'opacity:0', 'transition:opacity 0.25s',
    ].join(';');
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px">warning</span>Only ${maxStock} in stock — that's the maximum you can order.`;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

function getSubtotal() {
  return cart.reduce((s, c) => s + (c.price * c.quantity), 0);
}

// Local delivery never adds a charge at checkout: meetup is free and any
// Maxim/Movit fare is settled directly with the rider. Always ₱0.
function getShipping() {
  return 0;
}

/* ── Step Navigation ─────────────────────────────────────── */
function goToStep(n) {
  step = n;
  document.querySelectorAll('.checkout-step-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`checkout-step-${n}`)?.classList.add('active');

  document.querySelectorAll('.checkout-step').forEach((el, i) => {
    el.classList.toggle('active', i + 1 === n);
    el.classList.toggle('done', i + 1 < n);
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ── Step 1: Cart Review ─────────────────────────────────── */
function renderCartReview() {
  const container = document.getElementById('cart-review-items');
  const goBtn     = document.getElementById('go-step-2');

  if (cart.length === 0) {
    container.innerHTML = `
      <div class="empty-cart">
        <span class="material-symbols-outlined">shopping_bag</span>
        <p>Your cart is empty.</p>
        <a href="/shop.html" class="btn-checkout-primary">Shop Now</a>
      </div>
    `;
    goBtn.disabled = true;
    return;
  }

  container.innerHTML = cart.map((item, i) => `
    <div class="cart-review-item">
      ${item.image_url ? `<img src="${cfImg(item.image_url)}" alt="${item.name}" class="cart-review-img" />` : `<div class="cart-review-img-empty"><span class="material-symbols-outlined">diamond</span></div>`}
      <div class="cart-review-info">
        <span class="cart-review-name">${item.name}</span>
        <span class="cart-review-coll">${item.collection || ''}</span>
        <span class="cart-review-price">${formatPrice(item.price)}</span>
      </div>
      <div class="cart-review-qty">
        <button class="qty-btn" data-idx="${i}" data-action="minus">−</button>
        <span class="qty-val">${item.quantity}</span>
        <button class="qty-btn" data-idx="${i}" data-action="plus" ${item.quantity >= (item.stock || 99) ? 'disabled title="Max stock reached"' : ''}>+</button>
      </div>
      ${item.stock && item.quantity >= item.stock ? `<span class="cart-stock-warn"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:middle">warning</span> Only ${item.stock} in stock</span>` : ''}
      <div class="cart-review-subtotal">${formatPrice(item.price * item.quantity)}</div>
      <button class="cart-review-remove" data-idx="${i}" title="Remove">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
  `).join('');

  // Qty controls
  container.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const i   = parseInt(btn.dataset.idx);
      const act = btn.dataset.action;
      if (act === 'plus') {
        const maxStock = cart[i].stock || 99;
        if (cart[i].quantity >= maxStock) {
          // Already at stock limit — show a brief warning toast
          showStockWarning(maxStock);
          return;
        }
        cart[i].quantity = Math.min(cart[i].quantity + 1, maxStock);
      }
      if (act === 'minus' && cart[i].quantity > 1) cart[i].quantity--;
      else if (act === 'minus' && cart[i].quantity === 1) cart.splice(i, 1);
      saveCart();
      renderCartReview();
      updateSummary();
    });
  });

  container.querySelectorAll('.cart-review-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      cart.splice(parseInt(btn.dataset.idx), 1);
      saveCart();
      renderCartReview();
      updateSummary();
    });
  });

  goBtn.disabled = cart.length === 0;
}

function updateSummary() {
  const subtotal = getSubtotal();
  const method   = DELIVERY_METHODS[selectedMethod()];
  const total    = subtotal + getShipping();       // shipping is always 0

  document.getElementById('summary-subtotal').textContent = formatPrice(subtotal);

  const shipEl = document.getElementById('summary-shipping');
  if (shipEl) shipEl.textContent = method.summary;   // "🎉 Free" or "Paid to rider"

  document.getElementById('summary-total').textContent = formatPrice(total);

  // Mirror the total into the "amount to send" callout on the payment step.
  const payAmt = document.getElementById('pay-amount-value');
  if (payAmt) payAmt.textContent = formatPrice(total);

  // Shipping note — reflects the chosen delivery method.
  const noteEl = document.getElementById('checkout-shipping-note');
  if (noteEl) {
    noteEl.innerHTML = `<span class="material-symbols-outlined">local_shipping</span>${escapeHtml(method.note)}`;
    noteEl.style.display = subtotal > 0 ? '' : 'none';
  }

  // Inline hint under the area dropdown — keep the coverage reminder.
  const hintEl = document.getElementById('province-ship-hint');
  if (hintEl) hintEl.textContent = 'We cover Metro Cebu — Cebu City up to Consolacion.';

  // Sidebar items
  const sumItems = document.getElementById('checkout-summary-items');
  if (sumItems) {
    sumItems.innerHTML = cart.map(item => `
      <div class="checkout-summary-item">
        <span>${item.name} ×${item.quantity}</span>
        <span>${formatPrice(item.price * item.quantity)}</span>
      </div>
    `).join('');
  }
}

/* ── Step 2: Details form ────────────────────────────────── */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// PH mobile: 09XXXXXXXXX, +639XXXXXXXXX, or 639XXXXXXXXX
const PH_PHONE_RE = /^(09\d{9}|(\+?63)9\d{9})$/;

function setFieldError(id, msg) {
  const input = document.getElementById(id);
  if (!input) return;
  input.classList.add('invalid');
  let err = input.parentElement.querySelector('.form-error');
  if (!err) {
    err = document.createElement('span');
    err.className = 'form-error';
    input.parentElement.appendChild(err);
  }
  err.textContent = msg;
}

function clearFieldError(id) {
  const input = document.getElementById(id);
  if (!input) return;
  input.classList.remove('invalid');
  input.parentElement.querySelector('.form-error')?.remove();
}

// Clear a field's error as soon as the user edits it
['c-name', 'c-email', 'c-phone', 'c-address'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => clearFieldError(id));
});

document.getElementById('details-form')?.addEventListener('submit', (e) => {
  e.preventDefault();

  const methodKey = selectedMethod();
  const values = {
    name:     document.getElementById('c-name').value.trim(),
    email:    document.getElementById('c-email').value.trim(),
    phone:    document.getElementById('c-phone').value.trim(),
    province: document.getElementById('c-province').value,
    address:  document.getElementById('c-address').value.trim(),
    notes:    document.getElementById('c-notes').value.trim(),
    delivery_method_key: methodKey,
    delivery_method:     DELIVERY_METHODS[methodKey].label,
  };

  // Validate
  let firstInvalid = null;
  const fail = (id, msg) => {
    setFieldError(id, msg);
    if (!firstInvalid) firstInvalid = id;
  };

  if (!values.name)  fail('c-name', 'Please enter your full name.');

  if (!values.email)                  fail('c-email', 'Please enter your email address.');
  else if (!EMAIL_RE.test(values.email)) fail('c-email', 'Please enter a valid email address.');

  const phoneDigits = values.phone.replace(/[\s-]/g, '');
  if (!values.phone)                       fail('c-phone', 'Please enter your phone number.');
  else if (!PH_PHONE_RE.test(phoneDigits)) fail('c-phone', 'Enter a valid PH mobile number (e.g. 0917 123 4567).');

  if (!values.province) fail('c-province', 'Please select your delivery area.');

  if (!values.address) {
    fail('c-address', methodKey === 'meetup'
      ? 'Please enter your preferred meetup point.'
      : 'Please enter your delivery address.');
  }

  if (firstInvalid) {
    document.getElementById(firstInvalid)?.focus();
    return;
  }

  details = values;
  goToStep(3);
});

/* ── Step 3: Payment ─────────────────────────────────────── */
const proofSection = document.getElementById('payment-proof-section');

// The "amount to send" + receipt upload only make sense for GCash/bank.
function syncProofVisibility() {
  const method = document.querySelector('.payment-radio:checked')?.value || 'gcash';
  if (proofSection) proofSection.style.display = method === 'cod' ? 'none' : '';
}

document.querySelectorAll('.payment-radio').forEach(radio => {
  radio.addEventListener('change', () => {
    document.querySelectorAll('.payment-detail-panel').forEach(p => p.classList.add('hidden'));
    const panel = document.getElementById(`${radio.value.replace('_transfer','')}-detail`);
    panel?.classList.remove('hidden');
    syncProofVisibility();
    clearPayError();
  });
});
syncProofVisibility();

/* Proof-of-payment upload (screenshot of the GCash/bank receipt) */
const proofZone    = document.getElementById('proof-upload-zone');
const proofInput   = document.getElementById('proof-file');
const proofPreview = document.getElementById('proof-preview');
const proofCta     = document.getElementById('proof-upload-cta');
const proofClear   = document.getElementById('proof-clear');

proofZone?.addEventListener('click', (e) => {
  if (e.target.closest('.proof-clear')) return;
  proofInput.click();
});
proofZone?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); proofInput.click(); }
});
proofInput?.addEventListener('change', () => {
  const file = proofInput.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    showPayError('Receipt image must be under 5 MB.');
    proofInput.value = '';
    return;
  }
  clearPayError();
  proofPreview.src = URL.createObjectURL(file);
  proofZone.classList.add('has-image');
  proofCta.style.display = 'none';
  proofClear.hidden = false;
});
proofClear?.addEventListener('click', (e) => {
  e.stopPropagation();
  proofInput.value = '';
  proofPreview.src = '';
  proofZone.classList.remove('has-image');
  proofCta.style.display = '';
  proofClear.hidden = true;
});

/* Copy the GCash number to the clipboard */
document.getElementById('copy-gcash')?.addEventListener('click', async () => {
  const num = document.getElementById('gcash-number-display')?.textContent?.trim();
  if (!num) return;
  try {
    await navigator.clipboard.writeText(num);
    const btn  = document.getElementById('copy-gcash');
    const icon = btn.querySelector('.material-symbols-outlined');
    const prev = icon.textContent;
    icon.textContent = 'check';
    btn.classList.add('copied');
    setTimeout(() => { icon.textContent = prev; btn.classList.remove('copied'); }, 1500);
  } catch { /* clipboard unavailable — ignore */ }
});

/* Inline payment error (replaces the old alert()) */
function showPayError(msg) {
  const el = document.getElementById('pay-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function clearPayError() {
  const el = document.getElementById('pay-error');
  if (el) { el.style.display = 'none'; el.textContent = ''; }
}

document.getElementById('place-order-btn')?.addEventListener('click', placeOrder);

async function placeOrder() {
  const btn        = document.getElementById('place-order-btn');
  const payMethod  = document.querySelector('.payment-radio:checked')?.value || 'gcash';
  let   paymentRef = '';

  if (payMethod === 'gcash')         paymentRef = document.getElementById('gcash-ref')?.value.trim();
  if (payMethod === 'bank_transfer') paymentRef = document.getElementById('bank-ref')?.value.trim();

  const proofFile = document.getElementById('proof-file')?.files[0] || null;

  // GCash / bank: require EITHER a receipt screenshot OR a reference number.
  if (['gcash','bank_transfer'].includes(payMethod) && !proofFile && !paymentRef) {
    showPayError('Please upload your payment receipt or enter the reference number.');
    return;
  }
  clearPayError();

  btn.disabled  = true;
  btn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span>Placing Order…';

  try {
    const subtotal = getSubtotal();
    const shipping = getShipping();                // 0 — server re-computes authoritatively
    const total    = subtotal + shipping;

    // Upload the receipt first — a failed upload shouldn't create an order.
    let proofUrl = null;
    if (proofFile) {
      btn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span>Uploading receipt…';
      proofUrl = await uploadPaymentProof(proofFile);
      btn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span>Placing Order…';
    }

    // Payment is verified manually by an admin (receipt screenshot + reference).
    // The order is created `pending`; the admin approves (→ processing) or
    // rejects (→ cancelled) it from the Orders dashboard.
    const order = await createOrder({
      order_number:     generateOrderNumber(),
      type:             'online',
      status:           'pending',
      customer_name:    details.name,
      customer_email:   details.email,
      customer_phone:   details.phone,
      delivery_address: details.address,
      province:         details.province || null,
      delivery_method:  details.delivery_method || null,
      order_notes:      details.notes || null,
      payment_method:   payMethod + (paymentRef ? ` (${paymentRef})` : ''),
      subtotal,
      discount:         0,
      total,
    }, cart.map(item => ({
      product_id:   item.id,
      product_name: item.name,
      price:        item.price,
      quantity:     item.quantity,
    })));

    // Attach the receipt to the new order (best-effort: the order is already
    // placed and the reference number is on file as a fallback).
    if (proofUrl) {
      try { await attachPaymentProof(order.id, proofUrl); }
      catch (e) { console.error('Could not attach payment proof:', e); }
    }

    localStorage.removeItem('ngl_cart');

    // Stash the email (same tab) so the confirmation page can prove ownership to
    // get_order_public() without exposing the email/PII in a shareable URL.
    try {
      sessionStorage.setItem('ngl_confirm', JSON.stringify({
        id: order.id, order_number: order.order_number, email: details.email,
      }));
    } catch { /* sessionStorage unavailable — confirm page falls back to the tracker */ }

    // Confirmation + admin-alert emails are sent server-side (Resend Edge Function).
    window.location.href = `/order-confirm.html?id=${order.id}`;
  } catch (err) {
    showPayError('Something went wrong placing your order: ' + err.message);
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined">shopping_bag</span>Place Order';
  }
}

/* ── Navigation buttons ──────────────────────────────────── */
document.getElementById('go-step-2')?.addEventListener('click', () => goToStep(2));
document.getElementById('back-step-1')?.addEventListener('click', () => goToStep(1));
document.getElementById('back-step-2')?.addEventListener('click', () => goToStep(2));

/* ── Init ────────────────────────────────────────────────── */
loadCart();
renderCartReview();
updateSummary();
goToStep(1);
loadSettings();
loadAreas();
