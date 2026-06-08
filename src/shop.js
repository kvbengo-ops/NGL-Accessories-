import './style.css';
import { getProducts, trackEngagement } from './supabase.js';

const isFinePointer = window.matchMedia('(pointer: fine)').matches;

/* ── NAVBAR ── */
const navbar    = document.getElementById('navbar');
const navToggle = document.getElementById('nav-toggle');
const navDrawer = document.getElementById('nav-drawer');

window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 50);
}, { passive: true });

navToggle?.addEventListener('click', () => {
  const open = navToggle.getAttribute('aria-expanded') === 'true';
  navToggle.setAttribute('aria-expanded', String(!open));
  navDrawer.classList.toggle('open', !open);
  navDrawer.setAttribute('aria-hidden', String(open));
});

navDrawer?.querySelectorAll('.drawer-link').forEach((link) => {
  link.addEventListener('click', () => {
    navToggle.setAttribute('aria-expanded', 'false');
    navDrawer.classList.remove('open');
    navDrawer.setAttribute('aria-hidden', 'true');
  });
});

/* ── BANNER ── */
const banner      = document.getElementById('banner');
const bannerClose = document.getElementById('banner-close');

if (sessionStorage.getItem('ngl-banner-closed') === '1') {
  banner?.classList.add('hidden');
}
bannerClose?.addEventListener('click', () => {
  banner.classList.add('hidden');
  sessionStorage.setItem('ngl-banner-closed', '1');
});

window.addEventListener('load', () => {
  document.body.classList.add('hero-loaded');
});

/* ── SCROLL REVEALS ── */
const revealSelectors = [
  '.reveal-up-el', '.reveal-left-el', '.reveal-right-el',
  '.reveal-fade-el', '.reveal-line', '.reveal-line-fast',
];

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    });
  },
  { threshold: 0.1, rootMargin: '0px 0px -48px 0px' }
);

document.querySelectorAll(revealSelectors.join(', ')).forEach((el) => {
  revealObserver.observe(el);
});

/* ── MAGNETIC BUTTONS ── */
if (isFinePointer) {
  document.querySelectorAll('.mag-btn').forEach((btn) => {
    const strength = 0.28;
    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const x = (e.clientX - rect.left - rect.width  / 2) * strength;
      const y = (e.clientY - rect.top  - rect.height / 2) * strength;
      btn.style.transform = `translate(${x}px, ${y}px)`;
      if (btn.classList.contains('btn--solid')) {
        btn.style.transform = `translate(${x}px, ${y}px) translateY(-2px)`;
      }
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = '';
    });
  });
}

/* ── FORMAT PRICE ── */
function formatPrice(n) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

/* ── PRODUCTS ── */
const emojiMap = {
  'Earrings': 'circle',
  'Rings': 'radio_button_unchecked',
  'Bracelets': 'link',
  'Necklaces': 'blur_circular',
  'Anklets': 'local_florist'
};

let PRODUCTS = [];

/* ── CART ── */
let cart = [];

function loadCart() {
  try {
    cart = JSON.parse(localStorage.getItem('ngl_cart') || '[]');
  } catch {
    cart = [];
  }
  updateCartCount();
}

function saveCart() {
  localStorage.setItem('ngl_cart', JSON.stringify(cart));
  updateCartCount();
}

function updateCartCount() {
  const totalQty = cart.reduce((sum, item) => sum + item.quantity, 0);
  const el = document.querySelector('.cart-count');
  if (el) {
    el.textContent = totalQty;
    el.setAttribute('aria-label', `${totalQty} item${totalQty !== 1 ? 's' : ''}`);
  }
}

function addToCart(product) {
  if (product.stock <= 0) {
    showToast(`Sorry, ${product.name} is out of stock.`);
    return false;
  }
  const existing = cart.find(item => item.id === product.id);
  if (existing) {
    if (existing.quantity >= product.stock) {
      showToast(`Cannot add more. Only ${product.stock} in stock.`);
      return false;
    }
    existing.quantity = Math.min(existing.quantity + 1, product.stock, 99);
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      collection: product.categoryLabel,
      price: product.price, // Number
      image_url: product.image,
      stock: product.stock,
      quantity: 1
    });
  }
  saveCart();

  // Animate cart badge
  const el = document.querySelector('.cart-count');
  if (el) {
    el.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.45)' }, { transform: 'scale(1)' }],
      { duration: 280, easing: 'cubic-bezier(0.34,1.56,0.64,1)' }
    );
  }
  showToast(`${product.name} added to cart`);
  return true;
}

/* ── TOAST ── */
let toastTimer = null;

function showToast(msg) {
  let toast = document.getElementById('shop-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'shop-toast';
    toast.className = 'shop-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<span class="material-symbols-outlined" style="color:var(--gold-300)">check_circle</span>${msg}`;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}

/* ── PRODUCT MODAL ── */
const modalBackdrop = document.getElementById('product-modal-backdrop');
const modalImg      = document.getElementById('modal-img');
const modalBadge    = document.getElementById('modal-badge');
const modalName     = document.getElementById('modal-name');
const modalPrice    = document.getElementById('modal-price');
const modalDesc     = document.getElementById('modal-desc');
const modalTags     = document.getElementById('modal-tags');
const modalCartBtn  = document.getElementById('modal-btn-cart');
const modalClose    = document.getElementById('modal-close');

let modalProduct = null;

function openModal(product) {
  modalProduct = product;
  modalImg.src        = product.image || '';
  modalImg.alt        = product.name;
  modalBadge.className = `modal-category-badge modal-badge--${product.category}`;
  modalBadge.innerHTML = `<span class="material-symbols-outlined" style="font-size:10px">${product.emoji}</span>${product.categoryLabel}`;
  modalName.textContent  = product.name;
  modalPrice.className   = `modal-price modal-price--${product.category}`;
  modalPrice.textContent = formatPrice(product.price);
  modalDesc.textContent  = product.desc;
  modalTags.innerHTML    = product.tags.map(t => `<span class="modal-tag">${t}</span>`).join('');
  if (product.stock <= 0) {
    modalCartBtn.innerHTML = `<span class="material-symbols-outlined">block</span> Out of Stock`;
    modalCartBtn.disabled  = true;
  } else {
    modalCartBtn.innerHTML = `<span class="material-symbols-outlined">add_shopping_cart</span> Add to Cart`;
    modalCartBtn.disabled  = false;
  }
  modalCartBtn.classList.remove('added');

  modalBackdrop.removeAttribute('aria-hidden');
  modalBackdrop.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  modalBackdrop.classList.remove('open');
  modalBackdrop.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  modalProduct = null;
}

// Close on backdrop click, close button, or Escape
modalClose?.addEventListener('click', closeModal);
modalBackdrop?.addEventListener('click', (e) => {
  if (e.target === modalBackdrop) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalBackdrop?.classList.contains('open')) closeModal();
});

// Add to cart from modal
modalCartBtn?.addEventListener('click', () => {
  if (!modalProduct) return;
  const success = addToCart(modalProduct);
  if (!success) return;
  trackEngagement(modalProduct.id, 'like');
  modalCartBtn.innerHTML = `<span class="material-symbols-outlined">check</span> Added!`;
  modalCartBtn.classList.add('added');
  modalCartBtn.disabled = true;
  setTimeout(closeModal, 1200);
});

/* ── SWIPE CARD BUILDER ── */
function buildSwipeCard(product) {
  const card = document.createElement('div');
  card.className = `swipe-card swipe-card--${product.category}`;
  card.dataset.id = product.id;
  card.setAttribute('role', 'article');
  card.setAttribute('aria-label', `${product.name} — ${formatPrice(product.price)}`);

  card.innerHTML = `
    <div class="card-overlay card-overlay--like" aria-hidden="true">
      <div class="overlay-stamp">
        <span class="material-symbols-outlined">favorite</span> Add
      </div>
    </div>
    <div class="card-overlay card-overlay--skip" aria-hidden="true">
      <div class="overlay-stamp">
        <span class="material-symbols-outlined">close</span> Skip
      </div>
    </div>
    ${product.image ? `<div class="card-image" style="position:relative;">
      <img src="${product.image}" alt="${product.name}" loading="lazy" />
      <span class="material-symbols-outlined like-heart-burst">favorite</span>
    </div>` : ''}
    <div class="card-body">
      <span class="card-category-badge">
        <span class="material-symbols-outlined">${product.emoji}</span>
        ${product.categoryLabel}
      </span>
      <h3 class="card-name">${product.name}</h3>
      <p class="card-desc">${product.desc}</p>
      <div class="card-tags">${product.tags.map(t => `<span class="card-tag">${t}</span>`).join('')}</div>
      <div class="card-price-row">
        <span class="card-price">${formatPrice(product.price)}</span>
        <button class="card-view-btn" data-id="${product.id}" aria-label="View full details">
          <span class="material-symbols-outlined">open_in_full</span> View
        </button>
      </div>
    </div>
  `;

  // View button opens modal
  card.querySelector('.card-view-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openModal(product);
  });

  // Double tap to like
  let lastTap = 0;
  card.querySelector('.card-image')?.addEventListener('click', function(e) {
    const now = new Date().getTime();
    const timesince = now - lastTap;
    if (timesince < 400 && timesince > 0) {
      // Double tap!
      trackEngagement(product.id, 'like');
      const heart = this.querySelector('.like-heart-burst');
      heart.classList.remove('animate');
      void heart.offsetWidth; // trigger reflow
      heart.classList.add('animate');
    }
    lastTap = new Date().getTime();
  });

  return card;
}

/* ── SWIPE STACK ── */
class SwipeStack {
  constructor(stackEl, products) {
    this.stack    = stackEl;
    this.products = [...products];
    this.index    = 0;
    this.cards    = [];
    this.dragging = false;
    this.startX   = 0;
    this.startY   = 0;
    this.currentX = 0;
    this.activeCard = null;

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp   = this._onMouseUp.bind(this);
    this._onTouchMove = this._onTouchMove.bind(this);
    this._onTouchEnd  = this._onTouchEnd.bind(this);

    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup',   this._onMouseUp);
    document.addEventListener('touchmove', this._onTouchMove, { passive: false });
    document.addEventListener('touchend',  this._onTouchEnd);

    this._fillStack();
    this._updateCounter();
  }

  _fillStack() {
    while (this.cards.length < 3 && this.index < this.products.length) {
      const product = this.products[this.index++];
      const card = buildSwipeCard(product);
      this._attachDrag(card);
      this.stack.appendChild(card);
      this.cards.push(card);
    }
    this._layoutCards();
  }

  _layoutCards() {
    const depth = [
      { scale: 1,    y: 0,   z: 10 },
      { scale: 0.96, y: 16,  z: 5  },
      { scale: 0.92, y: 32,  z: 1  },
    ];
    this.cards.forEach((card, i) => {
      const d = depth[i] || { scale: 0.88, y: 48, z: 0 };
      card.style.transition = 'transform 0.35s cubic-bezier(0.16,1,0.3,1)';
      card.style.transform  = `translateY(${d.y}px) scale(${d.scale})`;
      card.style.zIndex     = d.z;
      card.style.pointerEvents = i === 0 ? 'auto' : 'none';
    });
  }

  _attachDrag(card) {
    card.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this._dragStart(card, e.clientX, e.clientY);
    });
    card.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      this._dragStart(card, t.clientX, t.clientY);
    }, { passive: true });
  }

  _dragStart(card, x, y) {
    if (this.cards[0] !== card) return;
    this.dragging   = true;
    this.activeCard = card;
    this.startX     = x;
    this.startY     = y;
    this.currentX   = 0;
    card.style.transition = 'none';
  }

  _onMouseMove(e) { if (this.dragging) this._dragMove(e.clientX, e.clientY); }
  _onTouchMove(e) {
    if (!this.dragging) return;
    e.preventDefault();
    const t = e.touches[0];
    this._dragMove(t.clientX, t.clientY);
  }

  _dragMove(x, y) {
    if (!this.activeCard) return;
    this.currentX = x - this.startX;
    const dy      = y - this.startY;
    const rot     = this.currentX * 0.07;
    this.activeCard.style.transform = `translate(${this.currentX}px, ${dy}px) rotate(${rot}deg) scale(1)`;

    const threshold = 60;
    const ratio     = Math.min(Math.abs(this.currentX) / threshold, 1);
    const likeOverlay = this.activeCard.querySelector('.card-overlay--like');
    const skipOverlay = this.activeCard.querySelector('.card-overlay--skip');
    if (this.currentX > 0) {
      if (likeOverlay) likeOverlay.style.opacity = ratio;
      if (skipOverlay) skipOverlay.style.opacity = 0;
    } else {
      if (skipOverlay) skipOverlay.style.opacity = ratio;
      if (likeOverlay) likeOverlay.style.opacity = 0;
    }
  }

  _onMouseUp()  { if (this.dragging) this._dragEnd(); }
  _onTouchEnd() { if (this.dragging) this._dragEnd(); }

  _dragEnd() {
    this.dragging = false;
    if (!this.activeCard) return;
    const THRESHOLD = 100;
    if (this.currentX > THRESHOLD) {
      this._swipeOut('right');
    } else if (this.currentX < -THRESHOLD) {
      this._swipeOut('left');
    } else {
      this.activeCard.style.transition = 'transform 0.5s cubic-bezier(0.16,1,0.3,1)';
      this.activeCard.style.transform  = 'translateY(0) scale(1)';
      const lo = this.activeCard.querySelector('.card-overlay--like');
      const so = this.activeCard.querySelector('.card-overlay--skip');
      if (lo) lo.style.opacity = 0;
      if (so) so.style.opacity = 0;
    }
    this.activeCard = null;
  }

  _swipeOut(direction) {
    const card    = this.cards[0];
    const product = this.products.find(p => p.id === card.dataset.id);
    const offX    = direction === 'right' ? '140%' : '-140%';

    card.style.transition = 'transform 0.4s cubic-bezier(0.4,0,0.6,1), opacity 0.4s';
    card.style.transform  = `translateX(${offX}) rotate(${direction === 'right' ? 24 : -24}deg)`;
    card.style.opacity    = '0';

    if (direction === 'right' && product) {
      addToCart(product);
      trackEngagement(product.id, 'like');
    }

    setTimeout(() => {
      card.remove();
      this.cards.shift();
      this._fillStack();

      this._updateCounter();
      this._checkEmpty();
    }, 420);
  }

  skip() { if (this.cards.length) this._swipeOut('left');  }
  like() { if (this.cards.length) this._swipeOut('right'); }

  _updateCounter() {
    const el    = document.getElementById('swipe-counter');
    const total = this.products.length;
    const seen  = this.index - this.cards.length;
    if (el) el.textContent = `${Math.min(seen + 1, total)} / ${total}`;
  }

  _checkEmpty() {
    if (this.cards.length === 0 && this.index >= this.products.length) {
      document.getElementById('card-stack')?.classList.add('hidden');
      document.getElementById('swipe-actions')?.classList.add('hidden');
      document.querySelector('.swipe-hint')?.classList.add('hidden');
      document.getElementById('swipe-empty')?.classList.remove('hidden');
    }
  }

  reset() {
    this.cards.forEach(c => c.remove());
    this.cards = [];
    this.index = 0;
    document.getElementById('card-stack')?.classList.remove('hidden');
    document.getElementById('swipe-actions')?.classList.remove('hidden');
    document.querySelector('.swipe-hint')?.classList.remove('hidden');
    document.getElementById('swipe-empty')?.classList.add('hidden');
    this._fillStack();
    this._updateCounter();
  }

  destroy() {
    this.cards.forEach(c => c.remove());
    this.cards = [];
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup',   this._onMouseUp);
    document.removeEventListener('touchmove', this._onTouchMove);
    document.removeEventListener('touchend',  this._onTouchEnd);
  }
}

/* ── GRID RENDERER ── */
let activeFilter = 'all';

function buildProductCard(product) {
  const card = document.createElement('div');
  card.className = `product-card product-card--${product.category}`;
  card.dataset.id = product.id;
  card.innerHTML = `
    <div class="product-card-image" style="position:relative;">
      <img src="${product.image}" alt="${product.name}" loading="lazy" width="400" height="400" />
      <span class="material-symbols-outlined like-heart-burst">favorite</span>
      <div class="product-card-overlay" aria-hidden="true">
        <button class="overlay-quick-add" aria-label="Add ${product.name} to cart" ${product.stock <= 0 ? 'disabled style="opacity:0.5;cursor:not-allowed"' : ''}>
          <span class="material-symbols-outlined">${product.stock <= 0 ? 'block' : 'add_shopping_cart'}</span>
          ${product.stock <= 0 ? 'Out of Stock' : 'Add to Cart'}
        </button>
      </div>
    </div>
    <div class="product-card-body">
      <span class="product-card-badge badge--${product.category}">${product.categoryLabel}</span>
      <h3 class="product-card-name">${product.name}</h3>
      <div class="product-card-footer">
        <span class="product-card-price">${formatPrice(product.price)}</span>
        <div class="product-card-actions">
          <button class="card-view-btn grid-view-btn" aria-label="View ${product.name} details">
            <span class="material-symbols-outlined">open_in_full</span>
          </button>
          <button class="card-view-btn grid-like-btn" aria-label="Like ${product.name}" style="transition: color 0.3s">
            <span class="material-symbols-outlined">favorite</span>
          </button>
          <button class="btn-add-cart" aria-label="Add ${product.name} to cart" ${product.stock <= 0 ? 'disabled style="opacity:0.5;cursor:not-allowed"' : ''}>
            <span class="material-symbols-outlined">${product.stock <= 0 ? 'block' : 'add_shopping_cart'}</span>
            ${product.stock <= 0 ? 'Out of Stock' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  `;

  function handleAdd(btn, isOverlay) {
    const success = addToCart(product);
    if (!success) return;
    trackEngagement(product.id, 'like');
    btn.classList.add('added');
    btn.innerHTML = isOverlay
      ? `<span class="material-symbols-outlined">check</span> Added!`
      : `<span class="material-symbols-outlined">check</span> Added`;
    setTimeout(() => {
      btn.classList.remove('added');
      btn.innerHTML = isOverlay
        ? `<span class="material-symbols-outlined">add_shopping_cart</span> Add to Cart`
        : `<span class="material-symbols-outlined">add_shopping_cart</span> Add`;
    }, 2000);
  }

  card.querySelector('.overlay-quick-add')?.addEventListener('click', function (e) {
    e.stopPropagation();
    handleAdd(this, true);
  });
  card.querySelector('.btn-add-cart')?.addEventListener('click', function (e) {
    e.stopPropagation();
    handleAdd(this, false);
  });
  card.querySelector('.grid-view-btn')?.addEventListener('click', function (e) {
    e.stopPropagation();
    openModal(product);
  });
  card.querySelector('.grid-like-btn')?.addEventListener('click', function (e) {
    e.stopPropagation();
    trackEngagement(product.id, 'like');
    this.style.color = 'var(--coral)';
    this.querySelector('span').style.fontVariationSettings = '"FILL" 1, "wght" 400';
    const heart = card.querySelector('.like-heart-burst');
    if (heart) {
      heart.classList.remove('animate');
      void heart.offsetWidth; // trigger reflow
      heart.classList.add('animate');
    }
  });

  // Double tap to like
  let lastTap = 0;
  card.querySelector('.product-card-image')?.addEventListener('click', function(e) {
    const now = new Date().getTime();
    const timesince = now - lastTap;
    if (timesince < 400 && timesince > 0) {
      // Double tap!
      trackEngagement(product.id, 'like');
      const heart = this.querySelector('.like-heart-burst');
      heart.classList.remove('animate');
      void heart.offsetWidth; // trigger reflow
      heart.classList.add('animate');
    }
    lastTap = new Date().getTime();
  });

  return card;
}

function renderGrid() {
  const grid = document.getElementById('products-grid');
  if (!grid) return;
  const filtered = activeFilter === 'all'
    ? PRODUCTS
    : PRODUCTS.filter(p => p.category === activeFilter);
  grid.innerHTML = '';
  filtered.forEach((p, i) => {
    const card = buildProductCard(p);
    card.style.setProperty('--stagger-i', String(Math.min(i, 8)));
    grid.appendChild(card);
  });
}

/* ── SKELETON LOADER ── */
function showSkeleton() {
  const stack = document.getElementById('card-stack');
  if (!stack) return;
  stack.innerHTML = `
    <div class="swipe-skeleton" aria-hidden="true">
      <div class="skeleton-slab"></div>
      <div class="skeleton-body-area">
        <div class="skeleton-bar skeleton-bar--badge"></div>
        <div class="skeleton-bar skeleton-bar--name"></div>
        <div class="skeleton-bar skeleton-bar--price"></div>
      </div>
    </div>`;
}

/* ── SHOP INIT ── */
const swipeViewEl = document.getElementById('swipe-view');
const gridViewEl  = document.getElementById('grid-view');
const btnSwipe    = document.getElementById('btn-swipe-view');
const btnGrid     = document.getElementById('btn-grid-view');
const cardStackEl = document.getElementById('card-stack');

let swipeStack = null;

function initSwipeStack() {
  if (!swipeStack && cardStackEl) {
    cardStackEl.innerHTML = '';
    swipeStack = new SwipeStack(cardStackEl, PRODUCTS);
  }
}

function showSwipeView() {
  swipeViewEl?.classList.remove('hidden');
  gridViewEl?.classList.add('hidden');
  btnSwipe?.classList.add('active');
  btnGrid?.classList.remove('active');
  btnSwipe?.setAttribute('aria-pressed', 'true');
  btnGrid?.setAttribute('aria-pressed', 'false');
  initSwipeStack();
}

function showGridView() {
  gridViewEl?.classList.remove('hidden');
  swipeViewEl?.classList.add('hidden');
  btnGrid?.classList.add('active');
  btnSwipe?.classList.remove('active');
  btnGrid?.setAttribute('aria-pressed', 'true');
  btnSwipe?.setAttribute('aria-pressed', 'false');
  renderGrid();
}

btnSwipe?.addEventListener('click', showSwipeView);
btnGrid?.addEventListener('click', showGridView);

document.getElementById('btn-action-skip')?.addEventListener('click', () => swipeStack?.skip());
document.getElementById('btn-action-like')?.addEventListener('click', () => swipeStack?.like());
document.getElementById('btn-reset-swipe')?.addEventListener('click', () => swipeStack?.reset());

document.querySelectorAll('.filter-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    
    // Change body theme based on filter
    document.body.classList.remove('theme-natural', 'theme-grace', 'theme-lush');
    if (activeFilter !== 'all') {
      document.body.classList.add(`theme-${activeFilter}`);
    }
    
    // Update description
    const descMap = {
      'all': `
        <span class="desc-subtitle"><span style="opacity:0.5">✦</span> The Full Collection <span style="opacity:0.5">✦</span></span>
        <span class="desc-body">Browse our complete range of premium, waterproof jewelry.</span>
      `,
      'natural': `
        <span class="desc-subtitle"><span style="opacity:0.5">✽</span> Everyday Essentials <span style="opacity:0.5">✽</span></span>
        <span class="desc-body">Minimalist and versatile pieces that effortlessly complement casual outfits.</span>
      `,
      'grace': `
        <span class="desc-subtitle"><span style="opacity:0.5; font-size:14px">⟡</span> Formal & Glamorous <span style="opacity:0.5; font-size:14px">⟡</span></span>
        <span class="desc-body">Bold, refined statement pieces created for special occasions.</span>
      `,
      'lush': `
        <span class="desc-subtitle"><span style="opacity:0.5; font-size:14px">☼</span> Resort & Vacation <span style="opacity:0.5; font-size:14px">☼</span></span>
        <span class="desc-body">Refreshing, vibrant pieces inspired by tropical destinations.</span>
      `
    };
    const descEl = document.getElementById('collection-desc');
    if (descEl) {
      descEl.style.opacity = '0';
      descEl.style.transform = 'translateY(10px)';
      setTimeout(() => {
        descEl.innerHTML = descMap[activeFilter] || descMap['all'];
        descEl.style.opacity = '1';
        descEl.style.transform = 'translateY(0)';
      }, 200); // Wait for fade out
    }
    
    renderGrid();
  });
});

// Cart button click listener
document.querySelector('.cart-btn')?.addEventListener('click', () => {
  window.location.href = '/checkout.html';
});

// Dynamic Loader Function
async function initShop() {
  loadCart();
  showSkeleton();
  try {
    const rawProducts = await getProducts();
    PRODUCTS = rawProducts.map(p => ({
      id: p.id,
      name: p.name,
      category: p.collection.toLowerCase(),
      categoryLabel: p.collection,
      price: Number(p.price),
      desc: p.description || '',
      tags: p.tags || [],
      emoji: emojiMap[p.category] || 'diamond',
      image: p.image_url || '',
      stock: p.inventory?.stock || 0
    }));

    const params = new URLSearchParams(window.location.search);
    const collectionParam = params.get('collection');

    if (collectionParam) {
      showGridView();
      const pill = document.querySelector(`.filter-pill[data-filter="${collectionParam}"]`);
      if (pill) pill.click();
    } else {
      showSwipeView();
    }
  } catch (err) {
    console.error('Failed to load products:', err);
    // Show empty state or message
    showSwipeView();
  }
}

initShop();

/* ── FULLSCREEN SWIPE MODE ── */
(function () {
  const btnFullscreen = document.getElementById('btn-fullscreen');
  if (!btnFullscreen) return;

  // Build the overlay once
  const overlay = document.createElement('div');
  overlay.className = 'swipe-fs-overlay';
  overlay.id = 'swipe-fs-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Fullscreen swipe mode');
  overlay.innerHTML = `
    <button class="swipe-fs-close" id="btn-fs-close" aria-label="Exit fullscreen">
      <span class="material-symbols-outlined">fullscreen_exit</span>
      Exit
    </button>
    <div class="swipe-hint" aria-hidden="true">
      <div class="hint-chip hint-chip--skip">
        <span class="material-symbols-outlined">close</span> Skip
      </div>
      <div class="hint-chip hint-chip--like">
        Add to Cart <span class="material-symbols-outlined">favorite</span>
      </div>
    </div>
    <div class="card-stack" id="fs-card-stack" role="region" aria-label="Swipeable product cards"></div>
    <div class="swipe-actions" id="fs-swipe-actions">
      <button class="swipe-btn swipe-btn--skip" id="fs-btn-skip" aria-label="Skip this product">
        <span class="material-symbols-outlined">close</span>
      </button>
      <span class="swipe-counter" id="fs-swipe-counter" aria-live="polite"></span>
      <button class="swipe-btn swipe-btn--like" id="fs-btn-like" aria-label="Add product to cart">
        <span class="material-symbols-outlined">favorite</span>
      </button>
    </div>
  `;
  document.body.appendChild(overlay);

  let fsSwipeStack = null;

  function openFullscreen() {
    // Build a fresh swipe stack inside the overlay
    const fsStack = document.getElementById('fs-card-stack');
    const fsCounter = document.getElementById('fs-swipe-counter');

    if (fsSwipeStack) {
      fsSwipeStack.destroy();
      fsStack.innerHTML = '';
    }

    // Sync counter display with main counter text
    const mainCounter = document.getElementById('swipe-counter');
    if (mainCounter && fsCounter) fsCounter.textContent = mainCounter.textContent;

    // Create a new SwipeStack using all products from the current position
    fsSwipeStack = new SwipeStack(fsStack, PRODUCTS);

    // Override counter to also update fs counter
    const origUpdate = fsSwipeStack._updateCounter.bind(fsSwipeStack);
    fsSwipeStack._updateCounter = function () {
      origUpdate();
      const el = document.getElementById('fs-swipe-counter');
      const total = this.products.length;
      const seen  = this.index - this.cards.length;
      if (el) el.textContent = `${Math.min(seen + 1, total)} / ${total}`;
    };
    fsSwipeStack._updateCounter();

    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    btnFullscreen.innerHTML = `<span class="material-symbols-outlined">fullscreen_exit</span> Exit`;
  }

  function closeFullscreen() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    btnFullscreen.innerHTML = `<span class="material-symbols-outlined">fullscreen</span> Full Screen`;
  }

  btnFullscreen.addEventListener('click', openFullscreen);
  document.getElementById('btn-fs-close')?.addEventListener('click', closeFullscreen);
  document.getElementById('fs-btn-skip')?.addEventListener('click', () => fsSwipeStack?.skip());
  document.getElementById('fs-btn-like')?.addEventListener('click', () => fsSwipeStack?.like());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeFullscreen();
  });
})();

