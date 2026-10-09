/* ============================================================
   NGL Admin — Admin User Management (Superadmin only)
   ============================================================ */
import { supabase, getAdmins } from '../src/supabase.js';
import { requireSuperadmin, renderSidebar, showToast, formatDate, openModal, closeModal, escapeHtml } from '../src/admin.js';

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
          <div class="sidebar-avatar" style="width:32px;height:32px;font-size:13px">${escapeHtml((a.name || 'A')[0].toUpperCase())}</div>
          <span>${escapeHtml(a.name)}</span>
        </div>
      </td>
      <td class="date-cell">${escapeHtml(a.email || '—')}</td>
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
            <button class="action-btn action-btn--edit" data-role-id="${a.id}" data-role-name="${escapeHtml(a.name)}" data-current-role="${a.role}" title="Change Role">
              <span class="material-symbols-outlined">manage_accounts</span>
            </button>
            <button class="action-btn action-btn--edit" data-pwd-id="${a.id}" title="Change Password">
              <span class="material-symbols-outlined">key</span>
            </button>
            <button class="action-btn ${a.is_active ? 'action-btn--archive' : 'action-btn--edit'}"
              data-toggle-id="${a.id}" data-active="${a.is_active}"
              title="${a.is_active ? 'Deactivate' : 'Reactivate'}">
              <span class="material-symbols-outlined">${a.is_active ? 'person_off' : 'person'}</span>
            </button>
            <button class="action-btn action-btn--delete" data-delete-id="${a.id}" data-delete-name="${escapeHtml(a.name)}" title="Delete Admin">
              <span class="material-symbols-outlined" style="color:rgb(var(--adm-red));">delete</span>
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

  document.querySelectorAll('[data-role-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('edit-role-user-id').value = btn.dataset.roleId;
      document.getElementById('edit-role-name').textContent = btn.dataset.roleName;
      document.getElementById('edit-admin-role').value = btn.dataset.currentRole;
      openModal('edit-role-modal');
    });
  });

  document.querySelectorAll('[data-pwd-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('edit-password-user-id').value = btn.dataset.pwdId;
      document.getElementById('new-admin-password').value = '';
      openModal('edit-password-modal');
    });
  });

  document.querySelectorAll('[data-delete-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('delete-admin-user-id').value = btn.dataset.deleteId;
      document.getElementById('delete-admin-name').textContent = btn.dataset.deleteName;
      openModal('delete-admin-modal');
    });
  });
}

function setupModal() {
  document.getElementById('btn-add-admin')?.addEventListener('click', () => openModal('add-admin-modal'));
  document.getElementById('close-add-admin-modal')?.addEventListener('click', () => closeModal('add-admin-modal'));
  document.getElementById('cancel-add-admin')?.addEventListener('click', () => closeModal('add-admin-modal'));
  document.getElementById('add-admin-form')?.addEventListener('submit', handleAddAdmin);

  document.getElementById('close-edit-password-modal')?.addEventListener('click', () => closeModal('edit-password-modal'));
  document.getElementById('cancel-edit-password')?.addEventListener('click', () => closeModal('edit-password-modal'));
  document.getElementById('edit-password-form')?.addEventListener('submit', handleEditPassword);

  document.getElementById('close-delete-admin-modal')?.addEventListener('click', () => closeModal('delete-admin-modal'));
  document.getElementById('cancel-delete-admin')?.addEventListener('click', () => closeModal('delete-admin-modal'));
  document.getElementById('delete-admin-form')?.addEventListener('submit', handleDeleteAdmin);

  document.getElementById('close-edit-role-modal')?.addEventListener('click', () => closeModal('edit-role-modal'));
  document.getElementById('cancel-edit-role')?.addEventListener('click', () => closeModal('edit-role-modal'));
  document.getElementById('edit-role-form')?.addEventListener('submit', handleEditRole);
}

async function handleEditRole(e) {
  e.preventDefault();
  const btn = document.getElementById('save-role-btn');
  const errorEl = document.getElementById('edit-role-error');
  errorEl.classList.add('hidden');

  const userId = document.getElementById('edit-role-user-id').value;
  const newRole = document.getElementById('edit-admin-role').value;
  if (!userId || !newRole) return;

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const { error } = await supabase.rpc('set_admin_role', { 
      p_target_user_id: userId,
      p_role: newRole
    });
    if (error) throw error;

    showToast('Role updated successfully', 'success');
    closeModal('edit-role-modal');
    await loadAdmins();
  } catch (err) {
    errorEl.textContent = err.message || 'Failed to update role.';
    errorEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Role';
  }
}

async function handleDeleteAdmin(e) {
  e.preventDefault();
  const btn = document.getElementById('confirm-delete-btn');
  const errorEl = document.getElementById('delete-admin-error');
  errorEl.classList.add('hidden');

  const userId = document.getElementById('delete-admin-user-id').value;
  if (!userId) return;

  btn.disabled = true;
  btn.textContent = 'Deleting…';

  try {
    const { error } = await supabase.rpc('delete_admin', { p_user_id: userId });
    if (error) throw error;

    showToast('Admin deleted successfully', 'success');
    closeModal('delete-admin-modal');
    await loadAdmins();
  } catch (err) {
    errorEl.textContent = err.message || 'Failed to delete admin.';
    errorEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Delete';
  }
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
    // 1. Get current superadmin session
    const { data: { session: currentSession } } = await supabase.auth.getSession();

    // 2. Use Supabase Auth to properly create the user and hash the password (Argon2/bcrypt aware)
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name }
      }
    });

    if (signUpError) throw signUpError;
    const newUserId = signUpData.user?.id;
    if (!newUserId) throw new Error("Failed to retrieve new user ID.");

    // 3. Immediately restore the Superadmin session (so you don't get logged out)
    if (currentSession) {
      await supabase.auth.setSession({
        access_token: currentSession.access_token,
        refresh_token: currentSession.refresh_token
      });
    }

    // 4. Set their specific role using a secure RPC
    const { error: rpcError } = await supabase.rpc('set_admin_role', {
      p_target_user_id: newUserId,
      p_role: role
    });

    if (rpcError) throw rpcError;

    // 5. New sign-ups start inactive (handle_new_user); only a superadmin can switch them on.
    const { error: activateError } = await supabase.from('admins').update({ is_active: true }).eq('id', newUserId);
    if (activateError) throw activateError;

    showToast(`Admin ${name} created successfully!`);
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

async function handleEditPassword(e) {
  e.preventDefault();
  const btn = document.getElementById('save-password-btn');
  const errorEl = document.getElementById('edit-password-error');
  errorEl.classList.add('hidden');

  const userId      = document.getElementById('edit-password-user-id').value;
  const newPassword = document.getElementById('new-admin-password').value;

  if (!userId) {
    errorEl.textContent = 'Could not determine which admin to update.';
    errorEl.classList.remove('hidden');
    return;
  }
  if (!newPassword || newPassword.length < 8) {
    errorEl.textContent = 'Password must be at least 8 characters long.';
    errorEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const { error } = await supabase.rpc('update_admin_password', {
      p_user_id: userId,
      p_new_password: newPassword,
    });
    if (error) throw error;

    showToast('Password updated successfully', 'success');
    closeModal('edit-password-modal');
    document.getElementById('edit-password-form').reset();
  } catch (err) {
    errorEl.textContent = err.message || 'Failed to update password.';
    errorEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Password';
  }
}
