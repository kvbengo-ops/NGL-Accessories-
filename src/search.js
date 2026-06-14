/* ============================================================
   NGL Accessories — Global Product Search Overlay
   ------------------------------------------------------------
   Opens from the nav search icon (🔍) on any page. Live-filters
   the catalog and routes results into the shop page:
     • click a result → /shop.html?product=<id>  (opens its modal)
     • press Enter     → /shop.html?search=<query> (Browse All grid)
   Products are lazy-loaded on first open and cached.
   ============================================================ */
import { getProducts } from './supabase.js';

const emojiMap = {
  Earrings: 'circle',
  Rings: 'radio_button_unchecked',
  Bracelets: 'link',
  Necklaces: 'blur_circular',
  Anklets: 'local_florist',
};

function formatPrice(n) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

let overlay = null;
let input = null;
let resultsEl = null;
let products = null; // cached catalog (in-stock only)
let loading = false;
let debounceTimer = null;

function buildOverlay() {
  if (overlay) return;

  overlay = document.createElement('div');
  overlay.className = 'search-overlay';
  overlay.id = 'search-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Search products');
  overlay.innerHTML = `
    <div class="search-panel">
      <div class="search-input-row">
        <span class="material-symbols-outlined">search</span>
        <input type="search" id="global-search-input" class="search-input"
               placeholder="Search jewelry by name, collection, or tag…"
               autocomplete="off" aria-label="Search products" />
        <button class="search-close" id="search-close" type="button" aria-label="Close search">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div class="search-results" id="search-results" role="listbox" aria-label="Search results"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  input = overlay.querySelector('#global-search-input');
  resultsEl = overlay.querySelector('#search-results');

  overlay.querySelector('#search-close').addEventListener('click', closeSearch);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeSearch();
  });
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = input.value.trim();
      if (q) window.location.href = `/shop.html?search=${encodeURIComponent(q)}`;
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeSearch();
  });
}

async function ensureProducts() {
  if (products || loading) return;
  loading = true;
  try {
    const raw = await getProducts();
    products = raw
      .filter((p) => (p.inventory?.stock || 0) > 0)
      .map((p) => ({
        id: p.id,
        name: p.name,
        category: p.collection.toLowerCase(),
        categoryLabel: p.collection,
        price: Number(p.price),
        desc: p.description || '',
        tags: p.tags || [],
        emoji: emojiMap[p.category] || 'diamond',
        image: p.image_url || '',
      }));
  } catch (err) {
    console.error('Search: failed to load products', err);
    products = [];
  } finally {
    loading = false;
    // Re-render for whatever the user has typed now that data is in.
    if (overlay?.classList.contains('open')) renderResults(input.value);
  }
}

function onInput() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => renderResults(input.value), 120);
}

function renderResults(query) {
  const q = query.trim().toLowerCase();

  if (!products) {
    resultsEl.innerHTML = `<div class="search-empty">Loading collection…</div>`;
    return;
  }
  if (!q) {
    resultsEl.innerHTML = `<div class="search-hint">Start typing to find a piece — try “gold”, “ring”, or a collection name.</div>`;
    return;
  }

  const matches = products
    .filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.categoryLabel.toLowerCase().includes(q) ||
        p.desc.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
    )
    .slice(0, 8);

  if (matches.length === 0) {
    resultsEl.innerHTML = `
      <div class="search-empty">
        <span class="material-symbols-outlined">search_off</span>
        No pieces match “${query.trim()}”.
      </div>`;
    return;
  }

  resultsEl.innerHTML = matches
    .map(
      (p) => `
      <a class="search-result" role="option" href="/shop.html?product=${encodeURIComponent(p.id)}">
        <span class="search-result-thumb">${
          p.image
            ? `<img src="${p.image}" alt="" loading="lazy" />`
            : `<span class="material-symbols-outlined">diamond</span>`
        }</span>
        <span class="search-result-info">
          <span class="search-result-name">${p.name}</span>
          <span class="search-result-cat">${p.categoryLabel}</span>
        </span>
        <span class="search-result-price">${formatPrice(p.price)}</span>
      </a>`
    )
    .join('');
}

function openSearch() {
  buildOverlay();
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  ensureProducts();
  renderResults(input.value);
  setTimeout(() => input.focus(), 60);
}

function closeSearch() {
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.style.overflow = '';
}

/* Wire every nav search icon on the current page. */
export function initSearch() {
  document
    .querySelectorAll('.nav-icon-btn[aria-label="Search"]')
    .forEach((btn) => btn.addEventListener('click', openSearch));
}
