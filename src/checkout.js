/* ============================================================
   NGL — Checkout Flow Logic
   ============================================================ */
import { supabase, createOrder, generateOrderNumber, getProducts } from './supabase.js';

const FREE_SHIPPING_THRESHOLD = 1500;

let cart     = [];
let step     = 1;
let details  = {};

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

function getSubtotal() {
  return cart.reduce((s, c) => s + (c.price * c.quantity), 0);
}

function getShipping(subtotal) {
  return subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : 150;
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
        <button class="qty-btn" data-idx="${i}" data-action="plus">+</button>
      </div>
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
      if (act === 'plus')  cart[i].quantity = Math.min(cart[i].quantity + 1, 99);
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
  const subtotal  = getSubtotal();
  const shipping  = getShipping(subtotal);
  const total     = subtotal + shipping;

  document.getElementById('summary-subtotal').textContent = formatPrice(subtotal);
  document.getElementById('summary-shipping').textContent =
    shipping === 0 ? '🎉 Free!' : formatPrice(shipping);
  document.getElementById('summary-total').textContent    = formatPrice(total);

  // Shipping note
  const noteEl = document.getElementById('checkout-shipping-note');
  if (noteEl) {
    if (subtotal < FREE_SHIPPING_THRESHOLD && subtotal > 0) {
      const remaining = FREE_SHIPPING_THRESHOLD - subtotal;
      noteEl.innerHTML = `<span class="material-symbols-outlined">local_shipping</span>Add <strong>${formatPrice(remaining)}</strong> more for free shipping!`;
      noteEl.style.display = '';
    } else if (subtotal >= FREE_SHIPPING_THRESHOLD) {
      noteEl.innerHTML = `<span class="material-symbols-outlined">check_circle</span>You qualify for <strong>free shipping</strong>!`;
      noteEl.style.display = '';
    } else {
      noteEl.style.display = 'none';
    }
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
    name:    document.getElementById('c-name').value.trim(),
    email:   document.getElementById('c-email').value.trim(),
    phone:   document.getElementById('c-phone').value.trim(),
    address: document.getElementById('c-address').value.trim(),
    notes:   document.getElementById('c-notes').value.trim(),
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
    const shipping = getShipping(subtotal);
    const total    = subtotal + shipping;

    // --- STUB: Payment Gateway Integration (PayMongo/GCash) ---
    if (['gcash', 'card', 'bank_transfer'].includes(payMethod)) {
      console.log(`[STUB] Initiating ${payMethod.toUpperCase()} payment via PayMongo API...`);
      await new Promise(r => setTimeout(r, 600)); // Simulate API delay
      console.log(`[STUB] Payment intent successful for ${formatPrice(total)}`);
    }
    // ----------------------------------------------------------

    const order = await createOrder({
      order_number:     generateOrderNumber(),
      type:             'online',
      status:           'pending',
      customer_name:    details.name,
      customer_email:   details.email,
      customer_phone:   details.phone,
      delivery_address: details.address,
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

    // --- STUB: Transactional Emails (Resend API) ---
    console.log(`[STUB] Sending order confirmation email to ${details.email} via Resend API...`);
    // await fetch('https://api.resend.com/emails', { method: 'POST', body: JSON.stringify(...) });
    // -----------------------------------------------

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
