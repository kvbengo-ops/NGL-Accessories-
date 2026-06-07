/* ============================================================
   NGL Admin — Inventory Management
   ============================================================ */
import { supabase, getAllProducts, upsertProduct, updateStock, deleteProduct, uploadProductImage } from '../src/supabase.js';
import { requireAuth, renderSidebar, showToast, formatPrice, openModal, closeModal } from '../src/admin.js';

let allProducts = [];
let editingId   = null;

(async () => {
  const admin = await requireAuth();
  renderSidebar('Inventory', admin);
  await loadProducts();
  setupFilters();
  setupModal();
})();

async function loadProducts() {
  const tbody = document.getElementById('inventory-body');
  tbody.innerHTML = '<tr><td colspan="7" class="table-loading">Loading…</td></tr>';
  allProducts = await getAllProducts();
  renderTable(allProducts);
}

function stockBadge(stock, threshold) {
  if (stock === 0)          return '<span class="stock-badge stock--out">Out of Stock</span>';
  if (stock <= threshold)   return `<span class="stock-badge stock--low">Low (${stock})</span>`;
  return `<span class="stock-badge stock--ok">${stock} in stock</span>`;
}

function renderTable(products) {
  const tbody = document.getElementById('inventory-body');
  if (products.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No products found</td></tr>';
    return;
  }
  tbody.innerHTML = products.map(p => {
    const inv = p.inventory || { stock: 0, low_stock_threshold: 5 };
    return `
      <tr data-id="${p.id}">
        <td>
          <div class="product-cell">
            ${p.image_url ? `<img src="${p.image_url}" alt="${p.name}" class="product-thumb" />` : '<div class="product-thumb-empty"><span class="material-symbols-outlined">diamond</span></div>'}
            <div>
              <span class="product-cell-name">${p.name}</span>
              ${!p.is_active ? '<span class="badge-archived">Archived</span>' : ''}
            </div>
          </div>
        </td>
        <td><span class="collection-badge collection--${p.collection.toLowerCase()}">${p.collection}</span></td>
        <td>${p.category}</td>
        <td>${formatPrice(p.price)}</td>
        <td>
          <div class="stock-edit-wrap">
            <input type="number" class="stock-input" value="${inv.stock}" min="0"
              data-product-id="${p.id}" data-threshold="${inv.low_stock_threshold}" />
            <button class="stock-save-btn" data-product-id="${p.id}" title="Save stock">
              <span class="material-symbols-outlined">check</span>
            </button>
          </div>
        </td>
        <td><span style="font-weight: 500; color: var(--coral);"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;margin-right:4px;">favorite</span>${p.likes_count || 0}</span></td>
        <td>${stockBadge(inv.stock, inv.low_stock_threshold)}</td>
        <td>
          <div class="action-btns">
            <button class="action-btn action-btn--edit" data-id="${p.id}" title="Edit">
              <span class="material-symbols-outlined">edit</span>
            </button>
            <button class="action-btn action-btn--archive" data-id="${p.id}" title="${p.is_active ? 'Archive' : 'Restore'}" data-active="${p.is_active}">
              <span class="material-symbols-outlined">${p.is_active ? 'archive' : 'unarchive'}</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Stock save
  document.querySelectorAll('.stock-save-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pid    = btn.dataset.productId;
      const input  = document.querySelector(`.stock-input[data-product-id="${pid}"]`);
      const stock  = parseInt(input.value);
      const thresh = parseInt(input.dataset.threshold);
      if (isNaN(stock) || stock < 0) return;
      await updateStock(pid, stock, thresh);
      showToast('Stock updated');
      await loadProducts();
    });
  });

  // Edit
  document.querySelectorAll('.action-btn--edit').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.id));
  });

  // Archive/Restore
  document.querySelectorAll('.action-btn--archive').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id     = btn.dataset.id;
      const active = btn.dataset.active === 'true';
      await supabase.from('products').update({ is_active: !active }).eq('id', id);
      showToast(active ? 'Product archived' : 'Product restored');
      await loadProducts();
    });
  });
}

/* ── Filters ─────────────────────────────────────────────── */
function setupFilters() {
  const search       = document.getElementById('inv-search');
  const filterColl   = document.getElementById('inv-filter-collection');
  const filterCat    = document.getElementById('inv-filter-category');
  const filterStock  = document.getElementById('inv-filter-stock');

  function applyFilters() {
    const q    = search.value.toLowerCase();
    const coll = filterColl.value;
    const cat  = filterCat.value;
    const st   = filterStock.value;

    const filtered = allProducts.filter(p => {
      const inv       = p.inventory || { stock: 0, low_stock_threshold: 5 };
      const matchQ    = !q || p.name.toLowerCase().includes(q);
      const matchColl = !coll || p.collection === coll;
      const matchCat  = !cat  || p.category  === cat;
      const matchSt   = !st
        || (st === 'low' && inv.stock > 0 && inv.stock <= inv.low_stock_threshold)
        || (st === 'out' && inv.stock === 0);
      return matchQ && matchColl && matchCat && matchSt;
    });
    renderTable(filtered);
  }

  [search, filterColl, filterCat, filterStock].forEach(el => {
    el?.addEventListener('input', applyFilters);
  });
}

/* ── Modal ───────────────────────────────────────────────── */
function setupModal() {
  document.getElementById('btn-add-product')?.addEventListener('click', () => openAddModal());
  document.getElementById('close-product-modal')?.addEventListener('click', () => closeProductModal());
  document.getElementById('cancel-product-modal')?.addEventListener('click', () => closeProductModal());
  document.getElementById('product-form')?.addEventListener('submit', handleSaveProduct);
  setupImageUpload();
}

function setupImageUpload() {
  const zone     = document.getElementById('img-upload-zone');
  const input    = document.getElementById('p-image-file');
  const preview  = document.getElementById('img-upload-preview');
  const clearBtn = document.getElementById('img-upload-clear');

  // fix #8 — swap copy on touch devices where drag-and-drop isn't available
  if (window.matchMedia('(pointer: coarse)').matches) {
    const cta = document.getElementById('img-upload-cta');
    if (cta) cta.textContent = 'Tap to choose a photo';
  }

  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('Image must be under 5 MB', 'error');
      input.value = '';
      return;
    }
    preview.src = URL.createObjectURL(file);
    zone.classList.add('has-image');
    document.getElementById('p-image-existing').value = '';
  });

  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    preview.src = '';
    input.value = '';
    document.getElementById('p-image-existing').value = '';
    zone.classList.remove('has-image');
  });

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) { showToast('Image must be under 5 MB', 'error'); return; }
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    preview.src = URL.createObjectURL(file);
    zone.classList.add('has-image');
    document.getElementById('p-image-existing').value = '';
  });
}

function resetImageUpload() {
  const zone    = document.getElementById('img-upload-zone');
  const preview = document.getElementById('img-upload-preview');
  zone.classList.remove('has-image');
  preview.src = '';
  document.getElementById('p-image-file').value = '';
  document.getElementById('p-image-existing').value = '';
}

function setImagePreview(url) {
  if (!url) { resetImageUpload(); return; }
  const zone    = document.getElementById('img-upload-zone');
  const preview = document.getElementById('img-upload-preview');
  preview.src = url;
  zone.classList.add('has-image');
  document.getElementById('p-image-existing').value = url;
}

function openAddModal() {
  editingId = null;
  document.getElementById('product-modal-title').textContent = 'Add Product';
  document.getElementById('product-form').reset();
  document.getElementById('product-id').value = '';
  resetImageUpload();
  openModal('product-modal');
}

function openEditModal(id) {
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  editingId = id;
  document.getElementById('product-modal-title').textContent = 'Edit Product';
  document.getElementById('product-id').value     = p.id;
  document.getElementById('p-name').value         = p.name;
  document.getElementById('p-cost').value         = p.cost_price || 0;
  document.getElementById('p-price').value        = p.price;
  document.getElementById('p-collection').value   = p.collection;
  document.getElementById('p-category').value     = p.category;
  document.getElementById('p-desc').value         = p.description || '';
  document.getElementById('p-tags').value         = (p.tags || []).join(', ');
  document.getElementById('p-stock').value        = p.inventory?.stock || 0;
  document.getElementById('p-threshold').value    = p.inventory?.low_stock_threshold || 5;
  setImagePreview(p.image_url || null);
  openModal('product-modal');
}

function closeProductModal() {
  closeModal('product-modal');
  editingId = null;
}

async function handleSaveProduct(e) {
  e.preventDefault();
  const btn = document.getElementById('save-product-btn');
  btn.disabled = true;

  try {
    let imageUrl = document.getElementById('p-image-existing').value.trim() || null;
    const file   = document.getElementById('p-image-file').files[0];
    if (file) {
      btn.textContent = 'Saving…';
      const zone = document.getElementById('img-upload-zone');
      zone.classList.add('uploading');
      try {
        imageUrl = await uploadProductImage(file);
      } finally {
        zone.classList.remove('uploading');
      }
    } else {
      btn.textContent = 'Saving…';
    }

    const tags = document.getElementById('p-tags').value
      .split(',').map(t => t.trim()).filter(Boolean);

    const productData = {
      name:        document.getElementById('p-name').value.trim(),
      cost_price:  parseFloat(document.getElementById('p-cost').value) || 0,
      price:       parseFloat(document.getElementById('p-price').value),
      collection:  document.getElementById('p-collection').value,
      category:    document.getElementById('p-category').value,
      image_url:   imageUrl,
      description: document.getElementById('p-desc').value.trim() || null,
      tags,
      is_active:   true,
    };

    if (editingId) productData.id = editingId;

    const saved     = await upsertProduct(productData);
    const stock     = parseInt(document.getElementById('p-stock').value);
    const threshold = parseInt(document.getElementById('p-threshold').value);
    await updateStock(saved.id, stock, threshold);
    showToast(editingId ? 'Product updated!' : 'Product added!');
    closeProductModal();
    await loadProducts();
  } catch (err) {
    showToast('Error saving product: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Product';
  }
}
