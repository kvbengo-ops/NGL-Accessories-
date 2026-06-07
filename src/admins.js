/* ============================================================
   NGL Admin — Admin User Management (Superadmin only)
   ============================================================ */
import { supabase, getAdmins } from '../src/supabase.js';
import { requireSuperadmin, renderSidebar, showToast, formatDate, openModal, closeModal } from '../src/admin.js';

let currentAdmin = null;

(async () => {
  currentAdmin = await requireSuperadmin();
  renderSidebar('Admins', currentAdmin);
  await loadAdmins();
  setupModal();
})();

async function loadAdmins() {
  const tbody = document.getElementById('admins-body');
  tbody.innerHTML = '<tr><td colspan="6" class="table-loading">Loading…</td></tr>';

  const admins = await getAdmins();
  if (admins.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No admins found</td></tr>';
    return;
  }

  tbody.innerHTML = admins.map(a => `
    <tr>
      <td>
        <div class="admin-user-cell">
          <div class="sidebar-avatar" style="width:32px;height:32px;font-size:13px">${a.name[0].toUpperCase()}</div>
          <span>${a.name}</span>
        </div>
      </td>
      <td class="date-cell">${a.email || '—'}</td>
      <td>
        <span class="role-badge role-badge--${a.role}">${a.role}</span>
      </td>
      <td>
        <span class="status-badge ${a.is_active ? 'badge--success' : 'badge--error'}">
          ${a.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td class="date-cell">${a.last_login ? formatDate(a.last_login) : 'Never'}</td>
      <td>
        <div class="action-btns">
          ${a.id !== currentAdmin.id ? `
            <button class="action-btn ${a.is_active ? 'action-btn--archive' : 'action-btn--edit'}"
              data-toggle-id="${a.id}" data-active="${a.is_active}"
              title="${a.is_active ? 'Deactivate' : 'Reactivate'}">
              <span class="material-symbols-outlined">${a.is_active ? 'person_off' : 'person'}</span>
            </button>
          ` : '<span class="date-cell">(you)</span>'}
        </div>
      </td>
    </tr>
  `).join('');

  document.querySelectorAll('[data-toggle-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id     = btn.dataset.toggleId;
      const active = btn.dataset.active === 'true';
      await supabase.from('admins').update({ is_active: !active }).eq('id', id);
      showToast(active ? 'Admin deactivated' : 'Admin reactivated');
      await loadAdmins();
    });
  });
}

function setupModal() {
  document.getElementById('btn-add-admin')?.addEventListener('click', () => openModal('add-admin-modal'));
  document.getElementById('close-add-admin-modal')?.addEventListener('click', () => closeModal('add-admin-modal'));
  document.getElementById('cancel-add-admin')?.addEventListener('click', () => closeModal('add-admin-modal'));
  document.getElementById('add-admin-form')?.addEventListener('submit', handleAddAdmin);
}

async function handleAddAdmin(e) {
  e.preventDefault();
  const btn     = document.getElementById('save-admin-btn');
  const errorEl = document.getElementById('add-admin-error');
  errorEl.classList.add('hidden');
  btn.disabled  = true;
  btn.textContent = 'Creating…';

  const name     = document.getElementById('admin-name').value.trim();
  const email    = document.getElementById('admin-email').value.trim();
  const password = document.getElementById('admin-password').value;
  const role     = document.getElementById('admin-role').value;

  try {
    const { data, error } = await supabase.rpc('create_admin_user', {
      p_email:      email,
      p_password:   password,
      p_name:       name,
      p_role:       role,
      p_creator_id: currentAdmin.id
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    showToast(`Admin ${name} created!`);
    closeModal('add-admin-modal');
    document.getElementById('add-admin-form').reset();
    await loadAdmins();
  } catch (err) {
    errorEl.textContent = err.message || 'Failed to create admin.';
    errorEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Admin';
  }
}
