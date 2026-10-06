/* ============================================================
   NGL Admin — Inventory Management
   ============================================================ */
import { supabase, getAllProducts, upsertProduct, updateStock, deleteProduct, uploadProductImage, cfImg } from '../src/supabase.js';
import { requireAuth, renderSidebar, showToast, formatPrice, openModal, closeModal } from '../src/admin.js';

let allProducts = [];
let editingId   = null;
let parsedRows  = [];
const selectedIds  = new Set();      // survives re-render (filtering)
const pendingStock = new Map();      // product id -> unsaved stock value

(async () => {
  const admin = await requireAuth();
  renderSidebar('Inventory', admin);
  await loadProducts();
  setupFilters();
  setupModal();
})();

async function loadProducts() {
  const tbody = document.getElementById('inventory-body');
  tbody.innerHTML = '<tr><td colspan="9" class="table-loading">Loading…</td></tr>';
  allProducts = await getAllProducts();
  // drop queued edits for products that no longer exist
  pendingStock.forEach((_, id) => { if (!allProducts.some(p => p.id === id)) pendingStock.delete(id); });
  applyFilters();
}

function stockBadge(stock, threshold) {
  if (stock === 0)          return '<span class="stock-badge stock--out">Out of Stock</span>';
  if (stock <= threshold)   return `<span class="stock-badge stock--low">Low (${stock})</span>`;
  return `<span class="stock-badge stock--ok">${stock} in stock</span>`;
}

function renderTable(products) {
  const tbody = document.getElementById('inventory-body');
  if (products.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="table-empty">No products match these filters. Try another name or clear the filters above.</td></tr>';
    updateBulkActions();
    updateStockBar();
    return;
  }
  tbody.innerHTML = products.map(p => {
    const inv = p.inventory || { stock: 0, low_stock_threshold: 5 };
    return `
      <tr data-id="${p.id}">
        <td style="text-align: center;">
          <input type="checkbox" class="row-checkbox" value="${p.id}" style="cursor: pointer;" ${selectedIds.has(p.id) ? 'checked' : ''} />
        </td>
        <td>
          <div class="product-cell">
            ${p.image_url ? `<img src="${cfImg(p.image_url, 120)}" loading="lazy" alt="${p.name}" class="product-thumb" />` : '<div class="product-thumb-empty"><span class="material-symbols-outlined">diamond</span></div>'}
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
            <input type="number" class="stock-input" value="${pendingStock.has(p.id) ? pendingStock.get(p.id) : inv.stock}" min="0"
              data-product-id="${p.id}" data-threshold="${inv.low_stock_threshold}"
              style="${pendingStock.has(p.id) ? 'border-color:#eab308;background:rgba(234,179,8,0.08);' : ''}" />
          </div>
        </td>
        <td><span style="font-weight: 500; color: rgb(var(--adm-red));"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;margin-right:4px;">favorite</span>${p.likes_count || 0}</span></td>
        <td>${stockBadge(inv.stock, inv.low_stock_threshold)}</td>
        <td>
          <div class="action-btns">
            <button class="action-btn action-btn--edit" data-id="${p.id}" title="Edit">
              <span class="material-symbols-outlined">edit</span>
            </button>
            <button class="action-btn action-btn--archive" data-id="${p.id}" title="${p.is_active ? 'Archive' : 'Restore'}" data-active="${p.is_active}">
              <span class="material-symbols-outlined">${p.is_active ? 'archive' : 'unarchive'}</span>
            </button>
            <button class="action-btn action-btn--delete" data-delete-id="${p.id}" data-delete-name="${p.name}" title="Delete Product">
              <span class="material-symbols-outlined" style="color:rgb(var(--adm-red));">delete</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  const columnLabels = ['Select', 'Product', 'Collection', 'Category', 'Price', 'Stock', 'Likes', 'Status', 'Actions'];
  tbody.querySelectorAll('tr').forEach(row => {
    const product = products.find(p => p.id === row.dataset.id);
    [...row.cells].forEach((cell, index) => { cell.dataset.label = columnLabels[index]; });
    row.querySelector('.row-checkbox').setAttribute('aria-label', `Select ${product.name}`);
    row.querySelector('.stock-input').setAttribute('aria-label', `Stock quantity for ${product.name}`);
    row.querySelectorAll('.action-btn').forEach(button => {
      const label = document.createElement('span');
      label.textContent = button.title;
      button.appendChild(label);
      button.setAttribute('aria-label', `${button.title}: ${product.name}`);
    });
  });

  // Stock edits are queued, then saved together via "Save All Stock"
  document.querySelectorAll('.stock-input').forEach(input => {
    input.addEventListener('input', () => {
      const pid      = input.dataset.productId;
      const original = allProducts.find(p => p.id === pid)?.inventory?.stock ?? 0;
      const stock    = parseInt(input.value);
      if (isNaN(stock) || stock < 0 || stock === original) pendingStock.delete(pid);
      else pendingStock.set(pid, stock);
      input.style.borderColor = pendingStock.has(pid) ? '#eab308' : '';
      input.style.background  = pendingStock.has(pid) ? 'rgba(234,179,8,0.08)' : '';
      updateStockBar();
    });
  });

  // Edit
  document.querySelectorAll('.action-btn--edit').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.id));
  });

  // Row selection
  document.querySelectorAll('.row-checkbox').forEach(c => {
    c.addEventListener('change', () => {
      c.checked ? selectedIds.add(c.value) : selectedIds.delete(c.value);
      updateBulkActions();
    });
  });

  // Delete
  document.querySelectorAll('.action-btn--delete').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('delete-product-id').value = btn.dataset.deleteId;
      document.getElementById('delete-product-name').textContent = btn.dataset.deleteName;
      openModal('delete-product-modal');
    });
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

  updateBulkActions();
  updateStockBar();
}

/* ── Filters ─────────────────────────────────────────────── */
function applyFilters() {
  const q    = document.getElementById('inv-search').value.trim().toLowerCase();
  const coll = document.getElementById('inv-filter-collection').value;
  const cat  = document.getElementById('inv-filter-category').value;
  const st   = document.getElementById('inv-filter-stock').value;
  const status = document.getElementById('inv-filter-status').value;
  const sort = document.getElementById('inv-sort').value;
  document.getElementById('inv-total').textContent = allProducts.length;
  document.getElementById('inv-low').textContent = allProducts.filter(p => (p.inventory?.stock ?? 0) > 0 && p.inventory.stock <= (p.inventory.low_stock_threshold ?? 5)).length;
  document.getElementById('inv-out').textContent = allProducts.filter(p => (p.inventory?.stock ?? 0) === 0).length;
  document.querySelectorAll('[data-stock-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.stockView === st)));

  const filtered = allProducts.filter(p => {
    const inv       = p.inventory || { stock: 0, low_stock_threshold: 5 };
    const matchQ    = !q || p.name.toLowerCase().includes(q);
    const matchColl = !coll || p.collection === coll;
    const matchCat  = !cat  || p.category  === cat;
    const matchSt   = !st
      || (st === 'low' && inv.stock > 0 && inv.stock <= inv.low_stock_threshold)
      || (st === 'out' && inv.stock === 0);
    const matchStatus = !status || (status === 'active' ? p.is_active : !p.is_active);
    return matchQ && matchColl && matchCat && matchSt && matchStatus;
  });
  filtered.sort((a, b) => {
    if (sort === 'stock') return (a.inventory?.stock ?? 0) - (b.inventory?.stock ?? 0) || a.name.localeCompare(b.name);
    if (sort === 'price-asc') return a.price - b.price;
    if (sort === 'price-desc') return b.price - a.price;
    return a.name.localeCompare(b.name);
  });
  document.getElementById('inv-result-count').textContent = `${filtered.length} of ${allProducts.length}`;
  renderTable(filtered);
}

function setupFilters() {
  ['inv-search', 'inv-filter-collection', 'inv-filter-category', 'inv-filter-stock', 'inv-filter-status', 'inv-sort']
    .forEach(id => document.getElementById(id)?.addEventListener('input', applyFilters));
  document.getElementById('inv-reset').addEventListener('click', () => {
    ['inv-search', 'inv-filter-collection', 'inv-filter-category', 'inv-filter-stock', 'inv-filter-status'].forEach(id => { document.getElementById(id).value = ''; });
    applyFilters();
  });
  document.querySelectorAll('[data-stock-view]').forEach(button => button.addEventListener('click', () => {
    document.getElementById('inv-filter-stock').value = button.dataset.stockView;
    applyFilters();
  }));
}

/* ── Bulk Actions ────────────────────────────────────────── */
function updateBulkActions() {
  const checkboxes = document.querySelectorAll('.row-checkbox');
  const bulkBar    = document.getElementById('bulk-actions-bar');
  const selectAll  = document.getElementById('select-all-checkbox');

  bulkBar.style.display = selectedIds.size > 0 ? 'flex' : 'none';
  document.getElementById('bulk-selected-count').textContent = selectedIds.size;

  if (selectAll) {
    selectAll.indeterminate = Array.from(checkboxes).some(c => selectedIds.has(c.value)) && !Array.from(checkboxes).every(c => selectedIds.has(c.value));
    selectAll.checked = checkboxes.length > 0 &&
      Array.from(checkboxes).every(c => selectedIds.has(c.value));
  }
}

function updateStockBar() {
  document.getElementById('stock-save-bar').style.display = pendingStock.size > 0 ? 'flex' : 'none';
  document.getElementById('stock-pending-count').textContent = pendingStock.size;
}

/* Save every queued stock edit in one upsert, then patch local state — no reload. */
async function handleSaveAllStock() {
  const btn = document.getElementById('btn-save-stock');
  if (pendingStock.size === 0) return;
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const rows = Array.from(pendingStock, ([id, stock]) => ({
    product_id: id,
    stock,
    low_stock_threshold: allProducts.find(p => p.id === id)?.inventory?.low_stock_threshold ?? 5,
  }));

  try {
    const { error } = await supabase.from('inventory').upsert(rows, { onConflict: 'product_id' });
    if (error) throw error;
    rows.forEach(r => {
      const p = allProducts.find(x => x.id === r.product_id);
      if (p) p.inventory = { ...(p.inventory || {}), ...r };
    });
    showToast(`Stock updated for ${rows.length} product(s)`);
    pendingStock.clear();
    applyFilters();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save All Stock';
  }
}

async function handleBulkArchive(archive) {
  if (selectedIds.size === 0) return;
  const ids = Array.from(selectedIds);
  const { error } = await supabase.from('products').update({ is_active: !archive }).in('id', ids);
  if (error) return showToast(error.message, 'error');
  showToast(`${ids.length} product(s) ${archive ? 'archived' : 'restored'}`);
  selectedIds.clear();
  await loadProducts();
}

/* ── Modal ───────────────────────────────────────────────── */
function setupModal() {
  document.getElementById('btn-add-product')?.addEventListener('click', () => openAddModal());
  document.getElementById('close-product-modal')?.addEventListener('click', () => closeProductModal());
  document.getElementById('cancel-product-modal')?.addEventListener('click', () => closeProductModal());
  document.getElementById('product-form')?.addEventListener('submit', handleSaveProduct);

  document.getElementById('cancel-delete-product')?.addEventListener('click', () => closeModal('delete-product-modal'));
  document.getElementById('confirm-delete-product')?.addEventListener('click', handleConfirmDeleteProduct);

  document.getElementById('select-all-checkbox')?.addEventListener('change', (e) => {
    document.querySelectorAll('.row-checkbox').forEach(c => {
      c.checked = e.target.checked;
      e.target.checked ? selectedIds.add(c.value) : selectedIds.delete(c.value);
    });
    updateBulkActions();
  });

  document.getElementById('btn-bulk-delete')?.addEventListener('click', () => {
    if (selectedIds.size === 0) return;
    document.getElementById('delete-product-id').value = Array.from(selectedIds).join(',');
    document.getElementById('delete-product-name').textContent = `${selectedIds.size} selected products`;
    openModal('delete-product-modal');
  });

  document.getElementById('btn-bulk-archive')?.addEventListener('click', () => handleBulkArchive(true));
  document.getElementById('btn-bulk-restore')?.addEventListener('click', () => handleBulkArchive(false));

  document.getElementById('btn-save-stock')?.addEventListener('click', handleSaveAllStock);
  document.getElementById('btn-discard-stock')?.addEventListener('click', () => {
    pendingStock.clear();
    applyFilters();
  });

  // Batch Import/Export
  document.getElementById('btn-export-csv')?.addEventListener('click', exportCSV);
  document.getElementById('btn-open-import')?.addEventListener('click', () => {
    resetBatchImport();
    openModal('batch-import-modal');
  });
  document.getElementById('close-batch-modal')?.addEventListener('click', () => closeModal('batch-import-modal'));
  document.getElementById('cancel-batch-import')?.addEventListener('click', () => closeModal('batch-import-modal'));
  document.getElementById('btn-download-template')?.addEventListener('click', downloadTemplate);
  document.getElementById('import-csv-file')?.addEventListener('change', handleCSVUpload);
  document.getElementById('confirm-batch-import')?.addEventListener('click', handleBatchImport);

  setupImageUpload();
}

async function handleConfirmDeleteProduct() {
  const btn = document.getElementById('confirm-delete-product');
  const idsStr = document.getElementById('delete-product-id').value;
  if (!idsStr) return;
  
  const ids = idsStr.split(',');
  btn.disabled = true;
  btn.textContent = 'Deleting…';

  try {
    const { error } = await supabase.from('products').delete().in('id', ids);
    if (error) {
      if (error.code === '23503') throw new Error('Cannot delete: One or more selected products are part of existing orders. Please Archive them instead.');
      throw error;
    }
    showToast(`${ids.length} product(s) deleted permanently`, 'success');
    closeModal('delete-product-modal');
    
    // Reset bulk state
    selectedIds.clear();
    const selectAll = document.getElementById('select-all-checkbox');
    if (selectAll) selectAll.checked = false;
    
    await loadProducts();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Yes, Delete';
  }
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
  preview.src = cfImg(url, 600);
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

    const costPrice = parseFloat(document.getElementById('p-cost').value) || 0;
    const newStock  = parseInt(document.getElementById('p-stock').value);
    const threshold = parseInt(document.getElementById('p-threshold').value);
    const productName = document.getElementById('p-name').value.trim();

    // Capture old stock before saving (for restock expense calc)
    const oldProduct = editingId ? allProducts.find(x => x.id === editingId) : null;
    const oldStock   = oldProduct?.inventory?.stock ?? 0;
    const oldCost    = oldProduct?.cost_price ?? 0;

    const productData = {
      name:        productName,
      cost_price:  costPrice,
      price:       parseFloat(document.getElementById('p-price').value),
      collection:  document.getElementById('p-collection').value,
      category:    document.getElementById('p-category').value,
      image_url:   imageUrl,
      description: document.getElementById('p-desc').value.trim() || null,
      tags,
      is_active:   true,
    };

    if (editingId) productData.id = editingId;

    const saved = await upsertProduct(productData);
    await updateStock(saved.id, newStock, threshold);

    // —— Auto-log expense ——
    const { data: { user } } = await supabase.auth.getUser();
    const { data: adminRow } = await supabase.from('admins').select('id').eq('id', user.id).maybeSingle();

    if (!editingId) {
      // NEW product: log full inventory cost
      if (costPrice > 0 && newStock > 0) {
        const totalCost = costPrice * newStock;
        await supabase.from('expenses').insert({
          title:        `Inventory purchase: ${productName} (×${newStock})`,
          category:     'Packaging Supplies',
          amount:       totalCost,
          expense_date: new Date().toISOString().slice(0, 10),
          created_by:   adminRow?.id ?? null,
        });
      }
    } else {
      // EDIT: log only the ADDED stock as a restock expense
      const addedStock = newStock - oldStock;
      const effectiveCost = costPrice || oldCost;
      if (addedStock > 0 && effectiveCost > 0) {
        const restockCost = effectiveCost * addedStock;
        await supabase.from('expenses').insert({
          title:        `Restock: ${productName} (+${addedStock} units)`,
          category:     'Packaging Supplies',
          amount:       restockCost,
          expense_date: new Date().toISOString().slice(0, 10),
          created_by:   adminRow?.id ?? null,
        });
      }
    }

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

/* ── CSV Helpers ───────────────────────────────────────────── */
const CSV_HEADERS = ['name','collection','category','cost_price','price','description','tags','stock','low_stock_threshold','image_filename'];
const VALID_COLLECTIONS = ['Natural','Grace','Lush'];
const VALID_CATEGORIES  = ['Earrings','Rings','Bracelets','Necklaces','Anklets'];

function escapeCSV(val) {
  const s = String(val ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { result.push(current.trim()); current = ''; }
      else current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function downloadTemplate() {
  const collection = document.getElementById('tpl-collection')?.value || '';
  const category   = document.getElementById('tpl-category')?.value || '';
  const rowCount   = parseInt(document.getElementById('tpl-rows')?.value) || 10;

  const rows = [];
  for (let i = 0; i < rowCount; i++) {
    rows.push([
      '',              // name — user fills this
      collection,      // pre-filled or blank
      category,        // pre-filled or blank
      '',              // cost_price
      '',              // price
      '',              // description
      '',              // tags
      '',              // stock
      '5',             // default low_stock_threshold
      ''               // image_filename
    ]);
  }

  const csv = CSV_HEADERS.join(',') + '\n' + rows.map(r => r.map(escapeCSV).join(',')).join('\n') + '\n';

  const parts = ['ngl_template'];
  if (collection) parts.push(collection.toLowerCase());
  if (category)   parts.push(category.toLowerCase());
  const filename = parts.join('_') + '.csv';

  downloadBlob(csv, filename);
  const desc = (collection || 'All') + ' · ' + (category || 'All Categories') + ' · ' + rowCount + ' rows';
  showToast(`Template downloaded: ${desc}`, 'success');
}

function exportCSV() {
  if (allProducts.length === 0) { showToast('No products to export', 'error'); return; }
  const rows = allProducts.map(p => [
    p.name, p.collection, p.category,
    p.cost_price || 0, p.price,
    p.description || '', (p.tags || []).join(', '),
    p.inventory?.stock || 0, p.inventory?.low_stock_threshold || 5,
    p.image_url || ''
  ]);
  const csv = CSV_HEADERS.join(',') + '\n' + rows.map(r => r.map(escapeCSV).join(',')).join('\n') + '\n';
  downloadBlob(csv, `ngl_inventory_${new Date().toISOString().slice(0,10)}.csv`);
  showToast(`Exported ${allProducts.length} products!`, 'success');
}

function downloadBlob(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function resetBatchImport() {
  parsedRows = [];
  const fileInput = document.getElementById('import-csv-file');
  if (fileInput) fileInput.value = '';
  document.getElementById('import-file-label').textContent = '1. Choose .csv file…';
  
  const imgInput = document.getElementById('import-images-file');
  if (imgInput) imgInput.value = '';
  document.getElementById('import-images-label').textContent = '2. Choose Image files (optional)…';

  document.getElementById('import-preview').style.display = 'none';
  document.getElementById('import-error').classList.add('hidden');
  const btn = document.getElementById('confirm-batch-import');
  btn.disabled = true;
  btn.style.opacity = '0.5';
}

document.getElementById('import-images-file')?.addEventListener('change', (e) => {
  const files = e.target.files;
  const label = document.getElementById('import-images-label');
  if (files && files.length > 0) {
    label.textContent = `2. Selected ${files.length} image(s)`;
  } else {
    label.textContent = '2. Choose Image files (optional)…';
  }
});

function handleCSVUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('import-file-label').textContent = file.name;
  const errorEl = document.getElementById('import-error');
  errorEl.classList.add('hidden');

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const text = ev.target.result;
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row.');

      const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
      const required = ['name','collection','category','price','stock'];
      for (const r of required) {
        if (!headers.includes(r)) throw new Error(`Missing required column: "${r}"`);
      }

      parsedRows = [];
      const errors = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = parseCSVLine(lines[i]);
        const row = {};
        headers.forEach((h, idx) => row[h] = vals[idx] || '');

        if (!row.name) { errors.push(`Row ${i + 1}: Missing product name`); continue; }
        if (!VALID_COLLECTIONS.includes(row.collection)) { errors.push(`Row ${i + 1}: Invalid collection "${row.collection}" (use Natural, Grace, or Lush)`); continue; }
        if (!VALID_CATEGORIES.includes(row.category)) { errors.push(`Row ${i + 1}: Invalid category "${row.category}"`); continue; }
        if (!row.price || isNaN(row.price)) { errors.push(`Row ${i + 1}: Invalid price`); continue; }

        parsedRows.push({
          name: row.name,
          collection: row.collection,
          category: row.category,
          cost_price: parseFloat(row.cost_price) || 0,
          price: parseFloat(row.price),
          description: row.description || null,
          tags: row.tags ? row.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
          stock: parseInt(row.stock) || 0,
          low_stock_threshold: parseInt(row.low_stock_threshold) || 5,
          image_filename: row.image_filename || null,
        });
      }

      if (errors.length > 0) {
        errorEl.textContent = errors.slice(0, 3).join(' \u2022 ') + (errors.length > 3 ? ` \u2022 +${errors.length - 3} more errors` : '');
        errorEl.classList.remove('hidden');
      }

      if (parsedRows.length > 0) {
        document.getElementById('import-count').textContent = parsedRows.length;
        document.getElementById('import-preview-body').innerHTML = parsedRows.slice(0, 10).map(r => `
          <tr>
            <td>${r.name}</td>
            <td>${r.collection}</td>
            <td>\u20B1${r.price.toFixed(2)}</td>
            <td>${r.stock}</td>
          </tr>
        `).join('') + (parsedRows.length > 10 ? `<tr><td colspan="4" style="text-align:center; color: rgb(var(--adm-fg) / max(var(--adm-text-min-alpha, 0), 0.5));">+${parsedRows.length - 10} more…</td></tr>` : '');
        document.getElementById('import-preview').style.display = 'block';
        const btn = document.getElementById('confirm-batch-import');
        btn.disabled = false;
        btn.style.opacity = '1';
      }
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
    }
  };
  reader.readAsText(file);
}

async function handleBatchImport() {
  if (parsedRows.length === 0) return;
  const btn = document.getElementById('confirm-batch-import');
  const errorEl = document.getElementById('import-error');
  errorEl.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Importing…';

  try {
    let successCount = 0;
    const { data: { user } } = await supabase.auth.getUser();
    const { data: adminRow } = await supabase.from('admins').select('id').eq('id', user.id).maybeSingle();

    const imgInput = document.getElementById('import-images-file');
    const imageFiles = imgInput?.files || [];

    for (const row of parsedRows) {
      let finalImageUrl = null;
      if (row.image_filename && imageFiles.length > 0) {
        // Find matching file
        const matchingFile = Array.from(imageFiles).find(f => f.name === row.image_filename);
        if (matchingFile) {
          finalImageUrl = await uploadProductImage(matchingFile);
        }
      }

      const productData = {
        name: row.name,
        collection: row.collection,
        category: row.category,
        cost_price: row.cost_price,
        price: row.price,
        description: row.description,
        tags: row.tags,
        image_url: finalImageUrl,
        is_active: true,
      };

      const { data: saved, error: pErr } = await supabase.from('products').insert(productData).select().single();
      if (pErr) { console.error(`Failed to import "${row.name}":`, pErr); continue; }

      await supabase.from('inventory').upsert({
        product_id: saved.id,
        stock: row.stock,
        low_stock_threshold: row.low_stock_threshold,
      }, { onConflict: 'product_id' });

      // Auto-log expense
      if (row.cost_price > 0 && row.stock > 0) {
        await supabase.from('expenses').insert({
          title: `Inventory purchase: ${row.name} (\u00d7${row.stock})`,
          category: 'Packaging Supplies',
          amount: row.cost_price * row.stock,
          expense_date: new Date().toISOString().slice(0, 10),
          created_by: adminRow?.id ?? null,
        });
      }
      successCount++;
    }

    showToast(`Successfully imported ${successCount} product(s)!`, 'success');
    closeModal('batch-import-modal');
    await loadProducts();
  } catch (err) {
    errorEl.textContent = 'Import failed: ' + err.message;
    errorEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import All';
  }
}
