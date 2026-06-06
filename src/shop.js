import './style.css';

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

/* ── PRODUCTS ── */
const PRODUCTS = [
  {
    id: 'natural-1',
    name: 'Dainty Chain Bracelet',
    category: 'natural',
    categoryLabel: 'Natural',
    price: '₱380',
    desc: 'Delicate sterling-silver chain with a hand-polished finish. Light and stackable — perfect for everyday wear.',
    tags: ['#minimalist', '#stackable', '#sterling'],
    emoji: 'link',
    image: '/images/natural_chain_bracelet.png',
  },
  {
    id: 'natural-2',
    name: 'Pearl Stud Earrings',
    category: 'natural',
    categoryLabel: 'Natural',
    price: '₱290',
    desc: 'Freshwater pearls set in brushed silver. Timeless studs that complement any outfit effortlessly.',
    tags: ['#freshwater', '#classic', '#everyday'],
    emoji: 'circle',
    image: '/images/natural_pearl_studs.png',
  },
  {
    id: 'natural-3',
    name: 'Slim Band Ring',
    category: 'natural',
    categoryLabel: 'Natural',
    price: '₱250',
    desc: 'Smooth slim band crafted from recycled silver. Minimalist design that stacks beautifully.',
    tags: ['#ring', '#minimalist', '#recycled'],
    emoji: 'radio_button_unchecked',
    image: '/images/natural_slim_ring.png',
  },
  {
    id: 'grace-1',
    name: 'Crystal Drop Earrings',
    category: 'grace',
    categoryLabel: 'Grace',
    price: '₱650',
    desc: 'Hand-set Swarovski-grade crystals cascade gracefully from 18K gold-plated hooks. Pure refined elegance.',
    tags: ['#crystal', '#goldplated', '#luxury'],
    emoji: 'diamond',
    image: '/images/grace_crystal_earrings.png',
  },
  {
    id: 'grace-2',
    name: 'Statement Choker',
    category: 'grace',
    categoryLabel: 'Grace',
    price: '₱780',
    desc: 'Layered gold-tone chain choker with a vintage clasp. Makes a bold statement at any occasion.',
    tags: ['#choker', '#statement', '#vintage'],
    emoji: 'blur_circular',
    image: '/images/grace_statement_choker.png',
  },
  {
    id: 'grace-3',
    name: 'Layered Bracelet Set',
    category: 'grace',
    categoryLabel: 'Grace',
    price: '₱590',
    desc: 'Curated set of three gold-plated bracelets — chain, beaded, and twisted rope — designed to layer together.',
    tags: ['#set', '#layered', '#goldplated'],
    emoji: 'layers',
    image: '/images/grace_layered_bracelet_set.png',
  },
  {
    id: 'lush-1',
    name: 'Shell Drop Earrings',
    category: 'lush',
    categoryLabel: 'Lush',
    price: '₱420',
    desc: 'Natural white shells with coral-tinted trim, wire-wrapped on brass hooks. Effortless tropical charm.',
    tags: ['#shell', '#boho', '#tropical'],
    emoji: 'sunny',
    image: '/images/lush_shell_earrings.png',
  },
  {
    id: 'lush-2',
    name: 'Turquoise Beaded Bracelet',
    category: 'lush',
    categoryLabel: 'Lush',
    price: '₱360',
    desc: 'Genuine turquoise beads hand-knotted on stretch elastic. Bold colour that catches the light.',
    tags: ['#turquoise', '#beaded', '#bold'],
    emoji: 'blur_on',
    image: '/images/lush_turquoise_bracelet.png',
  },
  {
    id: 'lush-3',
    name: 'Floral Charm Anklet',
    category: 'lush',
    categoryLabel: 'Lush',
    price: '₱310',
    desc: 'Dainty brass chain with hand-painted enamel flower charms. Playful, colourful, and adjustable.',
    tags: ['#anklet', '#floral', '#enamel'],
    emoji: 'local_florist',
    image: '/images/lush_floral_anklet.png',
  },
];

/* ── CART ── */
let cartCount = 0;

function addToCart(product) {
  cartCount++;
  const el = document.querySelector('.cart-count');
  if (el) {
    el.textContent = cartCount;
    el.setAttribute('aria-label', `${cartCount} item${cartCount !== 1 ? 's' : ''}`);
    el.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.45)' }, { transform: 'scale(1)' }],
      { duration: 280, easing: 'cubic-bezier(0.34,1.56,0.64,1)' }
    );
  }
  showToast(`${product.name} added to cart`);
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
  modalPrice.textContent = product.price;
  modalDesc.textContent  = product.desc;
  modalTags.innerHTML    = product.tags.map(t => `<span class="modal-tag">${t}</span>`).join('');
  modalCartBtn.innerHTML = `<span class="material-symbols-outlined">add_shopping_cart</span> Add to Cart`;
  modalCartBtn.disabled  = false;
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
  addToCart(modalProduct);
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
  card.setAttribute('aria-label', `${product.name} — ${product.price}`);

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
    ${product.image ? `<div class="card-image"><img src="${product.image}" alt="${product.name}" loading="lazy" /></div>` : ''}
    <div class="card-body">
      <span class="card-category-badge">
        <span class="material-symbols-outlined">${product.emoji}</span>
        ${product.categoryLabel}
      </span>
      <h3 class="card-name">${product.name}</h3>
      <p class="card-desc">${product.desc}</p>
      <div class="card-tags">${product.tags.map(t => `<span class="card-tag">${t}</span>`).join('')}</div>
      <div class="card-price-row">
        <span class="card-price">${product.price}</span>
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
      const card = buildSwipeCard(this.products[this.index++]);
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

    if (direction === 'right' && product) addToCart(product);

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
}

/* ── GRID RENDERER ── */
function buildProductCard(product) {
  const card = document.createElement('div');
  card.className = 'product-card';
  card.innerHTML = `
    <div class="product-card-image">
      <img src="${product.image}" alt="${product.name}" loading="lazy" />
    </div>
    <div class="product-card-body">
      <span class="product-card-badge badge--${product.category}">${product.categoryLabel}</span>
      <h3 class="product-card-name">${product.name}</h3>
      <p class="product-card-desc">${product.desc}</p>
      <div class="product-card-footer">
        <span class="product-card-price">${product.price}</span>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="card-view-btn grid-view-btn" aria-label="View full details">
            <span class="material-symbols-outlined">open_in_full</span>
          </button>
          <button class="btn-add-cart" aria-label="Add ${product.name} to cart">
            <span class="material-symbols-outlined">add_shopping_cart</span>
            Add
          </button>
        </div>
      </div>
    </div>
  `;
  card.querySelector('.btn-add-cart').addEventListener('click', function () {
    addToCart(product);
    this.classList.add('added');
    this.innerHTML = `<span class="material-symbols-outlined">check</span> Added`;
    setTimeout(() => {
      this.classList.remove('added');
      this.innerHTML = `<span class="material-symbols-outlined">add_shopping_cart</span> Add`;
    }, 2000);
  });
  card.querySelector('.grid-view-btn').addEventListener('click', () => openModal(product));
  return card;
}

function renderGrid() {
  const grid = document.getElementById('products-grid');
  if (!grid || grid.children.length) return;
  PRODUCTS.forEach(p => grid.appendChild(buildProductCard(p)));
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

showSwipeView();

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

