/* ============================================================
   NGL Admin — Inventory Management
   ============================================================ */
import { supabase, getAllProducts, upsertProduct, updateStock, deleteProduct, uploadProductImage } from '../src/supabase.js';
import { requireAuth, renderSidebar, showToast, formatPrice, openModal, closeModal } from '../src/admin.js';

let allProducts = [];
let editingId   = null;
let parsedRows  = [];

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
    tbody.innerHTML = '<tr><td colspan="9" class="table-empty">No products found</td></tr>';
    return;
  }
  tbody.innerHTML = products.map(p => {
    const inv = p.inventory || { stock: 0, low_stock_threshold: 5 };
    return `
      <tr data-id="${p.id}">
        <td style="text-align: center;">
          <input type="checkbox" class="row-checkbox" value="${p.id}" style="cursor: pointer;" />
        </td>
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

  // Row selection
  document.querySelectorAll('.row-checkbox').forEach(c => {
    c.addEventListener('change', updateBulkActions);
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

/* ── Bulk Actions ────────────────────────────────────────── */
function updateBulkActions() {
  const checkboxes = document.querySelectorAll('.row-checkbox');
  const selected = Array.from(checkboxes).filter(c => c.checked);
  const bulkBar = document.getElementById('bulk-actions-bar');
  const countSpan = document.getElementById('bulk-selected-count');
  const selectAll = document.getElementById('select-all-checkbox');
  
  if (selected.length > 0) {
    bulkBar.style.display = 'flex';
    countSpan.textContent = selected.length;
  } else {
    bulkBar.style.display = 'none';
  }
  
  if (selectAll) {
    selectAll.checked = checkboxes.length > 0 && selected.length === checkboxes.length;
  }
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
    document.querySelectorAll('.row-checkbox').forEach(c => c.checked = e.target.checked);
    updateBulkActions();
  });

  document.getElementById('btn-bulk-delete')?.addEventListener('click', () => {
    const selected = Array.from(document.querySelectorAll('.row-checkbox:checked'));
    if (selected.length === 0) return;
    
    const ids = selected.map(c => c.value);
    document.getElementById('delete-product-id').value = ids.join(',');
    document.getElementById('delete-product-name').textContent = `${selected.length} selected products`;
    openModal('delete-product-modal');
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
    const selectAll = document.getElementById('select-all-checkbox');
    if (selectAll) selectAll.checked = false;
    document.getElementById('bulk-actions-bar').style.display = 'none';
    
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
