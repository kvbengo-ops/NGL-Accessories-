/* ============================================================
   NGL Admin — Tasks Logic
   ============================================================ */
import { getTasks, createTask, updateTask, deleteTask, getAdmins } from './supabase.js';
import { requireAuth, renderSidebar, showToast, formatDate, openModal, closeModal } from './admin.js';

let allTasks = [];
let allAdmins = [];
let currentUser = null;

(async () => {
  currentUser = await requireAuth();
  renderSidebar('Tasks', currentUser);

  // Initial loads
  await loadAdmins();
  await refreshTasks();

  // Filter bindings
  document.getElementById('tasks-search').addEventListener('input', renderTasks);
  document.getElementById('tasks-filter-status').addEventListener('change', renderTasks);
  document.getElementById('tasks-filter-assignee').addEventListener('change', renderTasks);

  // Modal bindings
  document.getElementById('btn-create-task').addEventListener('click', () => openTaskModal());
  document.getElementById('btn-cancel-task').addEventListener('click', () => closeModal('task-modal'));
  document.getElementById('close-task-modal').addEventListener('click', () => closeModal('task-modal'));
  
  // Form submission
  document.getElementById('task-form').addEventListener('submit', handleSaveTask);
  
  // Quick status update from table or delete
  document.getElementById('tasks-body').addEventListener('click', handleTableAction);
})();

async function loadAdmins() {
  try {
    allAdmins = await getAdmins();
    const filterSelect = document.getElementById('tasks-filter-assignee');
    const formSelect = document.getElementById('task-assignee');
    
    const optionsHtml = allAdmins.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
    
    // Add "Me" option for current user in filter
    filterSelect.innerHTML = `
      <option value="">All Assignees</option>
      <option value="${currentUser.id}">Me (${currentUser.name})</option>
      ${optionsHtml}
    `;
    
    formSelect.innerHTML = `
      <option value="">Unassigned</option>
      <option value="${currentUser.id}">Me (${currentUser.name})</option>
      ${optionsHtml}
    `;
  } catch (err) {
    showToast('Failed to load admins', 'error');
  }
}

async function refreshTasks() {
  const tbody = document.getElementById('tasks-body');
  tbody.innerHTML = '<tr><td colspan="6" class="table-loading">Loading tasks…</td></tr>';
  try {
    allTasks = await getTasks();
    renderTasks();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty" style="color:var(--error);">Failed to load tasks</td></tr>';
    showToast('Failed to load tasks', 'error');
  }
}

function renderTasks() {
  const search = document.getElementById('tasks-search').value.toLowerCase();
  const status = document.getElementById('tasks-filter-status').value;
  const assignee = document.getElementById('tasks-filter-assignee').value;

  const filtered = allTasks.filter(t => {
    if (search && !t.title.toLowerCase().includes(search) && !(t.description && t.description.toLowerCase().includes(search))) return false;
    if (status && t.status !== status) return false;
    if (assignee && t.assigned_to !== assignee) return false;
    return true;
  });

  const tbody = document.getElementById('tasks-body');
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No tasks found.</td></tr>';
    return;
  }

  const pColor = { low: '#888', medium: '#b8860b', high: '#ef4444' };
  const sColor = { pending: 'var(--warning)', in_progress: 'var(--info)', completed: 'var(--success)' };

  tbody.innerHTML = filtered.map(t => {
    // Look up assignee name from allAdmins array (avoids needing a complex join query)
    const assignedAdmin = allAdmins.find(a => a.id === t.assigned_to);
    const assignedName = assignedAdmin ? assignedAdmin.name : '<em style="color:#999;">Unassigned</em>';

    return `
      <tr>
        <td>
          <div style="font-weight:500;">${t.title}</div>
          ${t.description ? `<div style="font-size:0.85rem; color:#666; margin-top:4px;">${t.description.substring(0,60)}${t.description.length > 60 ? '...' : ''}</div>` : ''}
        </td>
        <td>
          <select class="admin-select task-inline-status" data-id="${t.id}" style="padding:4px 8px; font-size:0.85rem; height:auto; color:${sColor[t.status]}; border-color:${sColor[t.status]}">
            <option value="pending" ${t.status === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
            <option value="completed" ${t.status === 'completed' ? 'selected' : ''}>Completed</option>
          </select>
        </td>
        <td><span style="color:${pColor[t.priority] || '#888'}; font-size:0.85rem; font-weight:600; text-transform:uppercase;">${t.priority}</span></td>
        <td>${assignedName}</td>
        <td>${t.due_date ? formatDate(t.due_date).split(',')[0] : '—'}</td>
        <td class="actions-cell">
          <button class="action-btn edit-task" data-id="${t.id}" title="Edit"><span class="material-symbols-outlined">edit</span></button>
          <button class="action-btn delete-task" data-id="${t.id}" title="Delete" style="color:var(--error);"><span class="material-symbols-outlined">delete</span></button>
        </td>
      </tr>
    `;
  }).join('');
}

function openTaskModal(task = null) {
  const title = document.getElementById('task-modal-title');
  const form = document.getElementById('task-form');
  
  if (task) {
    title.textContent = 'Edit Task';
    form['task-id'].value = task.id;
    form['task-title'].value = task.title;
    form['task-desc'].value = task.description || '';
    form['task-status'].value = task.status;
    form['task-priority'].value = task.priority;
    form['task-assignee'].value = task.assigned_to || '';
    form['task-due'].value = task.due_date ? task.due_date.substring(0, 10) : '';
  } else {
    title.textContent = 'New Task';
    form.reset();
    form['task-id'].value = '';
    // Defaults
    form['task-status'].value = 'pending';
    form['task-priority'].value = 'medium';
    form['task-assignee'].value = currentUser.id; // Assign to self by default
  }
  openModal('task-modal');
}

async function handleSaveTask(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-save-task');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  const id = document.getElementById('task-id').value;
  const payload = {
    title: document.getElementById('task-title').value,
    description: document.getElementById('task-desc').value || null,
    status: document.getElementById('task-status').value,
    priority: document.getElementById('task-priority').value,
    assigned_to: document.getElementById('task-assignee').value || null,
    due_date: document.getElementById('task-due').value ? new Date(document.getElementById('task-due').value).toISOString() : null,
  };

  try {
    if (id) {
      await updateTask(id, payload);
      showToast('Task updated');
    } else {
      payload.created_by = currentUser.id;
      await createTask(payload);
      showToast('Task created');
    }
    closeModal('task-modal');
    refreshTasks();
  } catch (err) {
    showToast(err.message || 'Failed to save task', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Task';
  }
}

async function handleTableAction(e) {
  const target = e.target.closest('button, select');
  if (!target) return;

  const id = target.getAttribute('data-id');
  if (!id) return;

  // Inline status update
  if (target.tagName === 'SELECT' && target.classList.contains('task-inline-status')) {
    try {
      await updateTask(id, { status: target.value });
      showToast('Status updated');
      // Update local array to keep filters in sync
      const task = allTasks.find(t => t.id === id);
      if (task) task.status = target.value;
      renderTasks();
    } catch (err) {
      showToast('Failed to update status', 'error');
      target.value = allTasks.find(t => t.id === id)?.status || 'pending'; // Revert
    }
    return;
  }

  // Edit
  if (target.classList.contains('edit-task')) {
    const task = allTasks.find(t => t.id === id);
    if (task) openTaskModal(task);
    return;
  }

  // Delete
  if (target.classList.contains('delete-task')) {
    if (confirm('Are you sure you want to delete this task?')) {
      try {
        await deleteTask(id);
        showToast('Task deleted');
        refreshTasks();
      } catch (err) {
        showToast('Failed to delete task', 'error');
      }
    }
    return;
  }
}
