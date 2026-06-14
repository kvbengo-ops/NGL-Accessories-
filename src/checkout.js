/* ============================================================
   NGL — Checkout Flow Logic
   ============================================================ */
import { supabase, createOrder, generateOrderNumber, getProducts, getStoreSettings, DEFAULT_SETTINGS, getShippingConfig } from './supabase.js';

let settings = { ...DEFAULT_SETTINGS };

let cart     = [];
let step     = 1;
let details  = {};

// Zone-based shipping (Cebu origin → nationwide). Populated from the DB.
let zoneById     = {};   // zone_id → { id, label, fee, free_shipping_threshold }
let provinceZone = {};   // province name → zone_id

function selectedProvince() {
  return document.getElementById('c-province')?.value || details.province || '';
}
function zoneForProvince(prov) {
  const zid = provinceZone[prov];
  return zid ? zoneById[zid] : null;
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
  if (trustShip) trustShip.textContent = 'Nationwide delivery — free shipping on qualifying orders';
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

// Load the zone rate card + province map and fill the province dropdown.
async function loadShipping() {
  const select = document.getElementById('c-province');
  try {
    const { zones, provinces } = await getShippingConfig();
    zoneById     = Object.fromEntries(zones.map(z => [z.id, z]));
    provinceZone = Object.fromEntries(provinces.map(p => [p.province, p.zone_id]));

    if (select) {
      // Keep the disabled placeholder, append every province alphabetically.
      const opts = provinces
        .map(p => `<option value="${escapeHtml(p.province)}">${escapeHtml(p.province)}</option>`)
        .join('');
      select.insertAdjacentHTML('beforeend', opts);
    }
  } catch (err) {
    console.error('Could not load shipping zones:', err);
  }
  updateSummary();
}

document.getElementById('c-province')?.addEventListener('change', () => {
  clearFieldError('c-province');
  updateSummary();
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

// Shipping for the chosen province's zone. Returns null when no province
// is selected yet (so the summary can show "select province" instead of ₱0).
function getShipping(subtotal) {
  const zone = zoneForProvince(selectedProvince());
  if (!zone) return null;
  const freeAt = Number(zone.free_shipping_threshold) || 0;
  if (freeAt > 0 && subtotal >= freeAt) return 0;
  return Number(zone.fee) || 0;
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
      ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}" class="cart-review-img" />` : `<div class="cart-review-img-empty"><span class="material-symbols-outlined">diamond</span></div>`}
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
  const zone     = zoneForProvince(selectedProvince());
  const shipping = getShipping(subtotal);          // number, or null if no province yet
  const total    = subtotal + (shipping || 0);

  document.getElementById('summary-subtotal').textContent = formatPrice(subtotal);

  const shipEl = document.getElementById('summary-shipping');
  if (shipEl) {
    if (shipping === null)      shipEl.textContent = 'Select province';
    else if (shipping === 0)    shipEl.textContent = '🎉 Free!';
    else                        shipEl.textContent = formatPrice(shipping);
  }
  document.getElementById('summary-total').textContent = formatPrice(total);

  // Shipping note — reflects the selected zone's own free-shipping threshold.
  const noteEl = document.getElementById('checkout-shipping-note');
  if (noteEl) {
    const freeAt = zone ? (Number(zone.free_shipping_threshold) || 0) : 0;
    if (!zone) {
      noteEl.innerHTML = `<span class="material-symbols-outlined">local_shipping</span>Select your province at checkout to see shipping.`;
      noteEl.style.display = subtotal > 0 ? '' : 'none';
    } else if (freeAt > 0 && subtotal > 0 && subtotal < freeAt) {
      const remaining = freeAt - subtotal;
      noteEl.innerHTML = `<span class="material-symbols-outlined">local_shipping</span>Add <strong>${formatPrice(remaining)}</strong> more for free shipping to ${escapeHtml(zone.label)}!`;
      noteEl.style.display = '';
    } else if (freeAt > 0 && subtotal >= freeAt) {
      noteEl.innerHTML = `<span class="material-symbols-outlined">check_circle</span>You qualify for <strong>free shipping</strong> to ${escapeHtml(zone.label)}!`;
      noteEl.style.display = '';
    } else {
      noteEl.innerHTML = `<span class="material-symbols-outlined">local_shipping</span>Shipping to <strong>${escapeHtml(zone.label)}</strong>: ${formatPrice(Number(zone.fee) || 0)}`;
      noteEl.style.display = '';
    }
  }

  // Inline hint under the province dropdown
  const hintEl = document.getElementById('province-ship-hint');
  if (hintEl) {
    if (!zone) hintEl.textContent = '';
    else if (shipping === 0) hintEl.textContent = `Free shipping to ${zone.label}.`;
    else hintEl.textContent = `Shipping to ${zone.label}: ${formatPrice(shipping)}.`;
  }

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

  const values = {
    name:     document.getElementById('c-name').value.trim(),
    email:    document.getElementById('c-email').value.trim(),
    phone:    document.getElementById('c-phone').value.trim(),
    province: document.getElementById('c-province').value,
    address:  document.getElementById('c-address').value.trim(),
    notes:    document.getElementById('c-notes').value.trim(),
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

  if (!values.province) fail('c-province', 'Please select your province.');

  if (!values.address) fail('c-address', 'Please enter your delivery address.');

  if (firstInvalid) {
    document.getElementById(firstInvalid)?.focus();
    return;
  }

  details = values;
  goToStep(3);
});

/* ── Step 3: Payment ─────────────────────────────────────── */
document.querySelectorAll('.payment-radio').forEach(radio => {
  radio.addEventListener('change', () => {
    document.querySelectorAll('.payment-detail-panel').forEach(p => p.classList.add('hidden'));
    const panel = document.getElementById(`${radio.value.replace('_transfer','')}-detail`);
    panel?.classList.remove('hidden');
  });
});

document.getElementById('place-order-btn')?.addEventListener('click', placeOrder);

async function placeOrder() {
  const btn          = document.getElementById('place-order-btn');
  const payMethod    = document.querySelector('.payment-radio:checked')?.value || 'gcash';
  let   paymentRef   = '';

  if (payMethod === 'gcash')         paymentRef = document.getElementById('gcash-ref')?.value.trim();
  if (payMethod === 'bank_transfer') paymentRef = document.getElementById('bank-ref')?.value.trim();

  if (['gcash','bank_transfer'].includes(payMethod) && !paymentRef) {
    alert('Please enter the reference number for your payment.');
    return;
  }

  btn.disabled   = true;
  btn.innerHTML  = '<span class="material-symbols-outlined">hourglass_empty</span>Placing Order…';

  try {
    const subtotal = getSubtotal();
    const shipping = getShipping(subtotal) || 0;   // server re-computes authoritatively
    const total    = subtotal + shipping;

    // Payment is confirmed manually via the reference number the customer
    // enters (GCash / bank transfer). The order is created as `pending` and an
    // admin verifies the payment before fulfilment. There is no automated
    // gateway yet — see README ("Going further") to wire up PayMongo.

    const order = await createOrder({
      order_number:     generateOrderNumber(),
      type:             'online',
      status:           'pending',
      customer_name:    details.name,
      customer_email:   details.email,
      customer_phone:   details.phone,
      delivery_address: details.address,
      province:         details.province || null,
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

    // Clear cart
    localStorage.removeItem('ngl_cart');

    // Confirmation + admin-alert emails are sent server-side: a Postgres trigger
    // on `orders` INSERT calls the `order-notification` Edge Function (Resend).
    // See setup/order-emails.sql — nothing to send from the client.

    // Redirect to confirmation
    window.location.href = `/order-confirm.html?id=${order.id}`;
  } catch (err) {
    alert('Error placing order: ' + err.message);
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
loadShipping();
