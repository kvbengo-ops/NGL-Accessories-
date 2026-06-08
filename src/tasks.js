/* ============================================================
   NGL Admin — Tasks Logic
   ============================================================ */
import { getTasks, createTask, updateTask, deleteTask, getAdmins } from './supabase.js';
import { requireAuth, renderSidebar, showToast, formatDate, openModal, closeModal } from './admin.js';
import { startTour, maybeAutoStartTour } from './tour.js';

/* Walkthrough steps for the Tasks board. */
const TOUR_STEPS = [
  {
    title: 'Welcome to your Tasks board 👋',
    body: 'This is a Kanban board for tracking team work. Tasks move left to right through three stages: <b>Pending → In Progress → Completed</b>. This quick tour shows you how to use it — you can reopen it anytime with the <b>Guide</b> button.',
  },
  {
    target: '#btn-create-task',
    title: 'Create a task',
    body: 'Click <b>New Task</b> to add work. Give it a title, an optional description, a priority, an assignee, and a due date. New tasks land in <b>Pending</b> by default.',
  },
  {
    target: '.filter-bar',
    title: 'Search & filter',
    body: 'Quickly narrow the board: <b>search</b> by title or description, filter by <b>status</b>, or filter by <b>assignee</b> (pick “Me” to see only your tasks).',
  },
  {
    target: '.kanban-board',
    title: 'The three stages',
    body: 'Each column is a stage and shows a live count. <b>Drag a card</b> from one column to another to update its status instantly — no need to open it.',
  },
  {
    target: '.kanban-card',
    title: 'Anatomy of a task card',
    body: 'Each card shows its <b>priority</b> (top-left), <b>assignee</b> and <b>due date</b> (bottom — overdue dates turn red). Hover a card to reveal the <b>edit</b> ✏️ and <b>delete</b> 🗑️ buttons, or change the assignee right from the dropdown.',
  },
  {
    title: "You're all set ✦",
    body: 'That\'s the whole board. Reopen this walkthrough anytime from the <b>Guide</b> button up top. Happy organizing!',
  },
];

const TOUR_KEY = 'ngl_tasks_tour_seen';

let allTasks = [];
let allAdmins = [];
let currentUser = null;

(async () => {
  currentUser = await requireAuth();
  renderSidebar('Tasks', currentUser);

  // Initial loads
  await loadAdmins();
  await refreshTasks();

  // Check for deep link
  const params = new URLSearchParams(window.location.search);
  const taskId = params.get('id');
  if (taskId) {
    const task = allTasks.find(t => t.id === taskId);
    if (task) {
      openTaskModal(task);
    }
    // Clean up URL without refreshing
    window.history.replaceState({}, '', '/admin/tasks.html');
  }

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
  document.getElementById('kanban-board').addEventListener('click', handleBoardAction);
  document.getElementById('kanban-board').addEventListener('change', handleBoardChange);

  // Kanban Drag and Drop setup
  setupDragAndDrop();

  // Walkthrough: manual replay + first-visit auto-start
  document.getElementById('btn-tour').addEventListener('click', () => startTour(TOUR_STEPS, { finishKey: TOUR_KEY }));
  maybeAutoStartTour(TOUR_STEPS, TOUR_KEY);
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
  ['pending', 'in_progress', 'completed'].forEach(s => {
    document.getElementById(`col-${s}`).innerHTML = '<div class="kanban-empty">Loading...</div>';
  });
  try {
    allTasks = await getTasks();
    renderTasks();
  } catch (err) {
    showToast('Failed to load tasks', 'error');
  }
}

function renderTasks() {
  const search = document.getElementById('tasks-search').value.toLowerCase();
  const statusFilter = document.getElementById('tasks-filter-status').value;
  const assignee = document.getElementById('tasks-filter-assignee').value;

  const filtered = allTasks.filter(t => {
    if (search && !t.title.toLowerCase().includes(search) && !(t.description && t.description.toLowerCase().includes(search))) return false;
    if (statusFilter && t.status !== statusFilter) return false;
    if (assignee && t.assigned_to !== assignee) return false;
    return true;
  });

  const columns = { pending: [], in_progress: [], completed: [] };
  
  filtered.forEach(t => {
    if (columns[t.status]) {
      columns[t.status].push(t);
    } else {
      columns.pending.push(t); // fallback
    }
  });

  const pColor = { low: '#888', medium: '#b8860b', high: '#ef4444' };
  
  const adminsOptions = allAdmins.map(a => `<option value="${a.id}">${a.name}</option>`).join('');

  ['pending', 'in_progress', 'completed'].forEach(s => {
    const colEl = document.getElementById(`col-${s}`);
    const countEl = document.getElementById(`count-${s}`);
    const tasks = columns[s];
    
    countEl.textContent = tasks.length;
    
    if (tasks.length === 0) {
      colEl.innerHTML = '<div class="kanban-empty">No tasks</div>';
    } else {
      colEl.innerHTML = tasks.map(t => {
        const isOverdue = t.due_date && new Date(t.due_date) < new Date() && t.status !== 'completed';
        return `
          <div class="kanban-card" draggable="true" data-id="${t.id}">
            <div class="kanban-card-header">
              <span class="kanban-priority" style="color:${pColor[t.priority] || '#888'}">${t.priority}</span>
              <div class="kanban-actions">
                <button class="action-btn edit-task" data-id="${t.id}" title="Edit"><span class="material-symbols-outlined">edit</span></button>
                <button class="action-btn delete-task" data-id="${t.id}" title="Delete"><span class="material-symbols-outlined">delete</span></button>
              </div>
            </div>
            <h4 class="kanban-card-title">${t.title}</h4>
            ${t.description ? `<p class="kanban-card-desc">${t.description}</p>` : ''}
            
            <div class="kanban-card-footer">
              <div class="kanban-assignee-wrap">
                <span class="material-symbols-outlined" style="font-size:16px; color:#888;">person</span>
                <select class="admin-select kanban-assignee-select" data-id="${t.id}" style="border:none; padding:0; background:transparent; font-size:12px; font-weight:500;">
                  <option value="">Unassigned</option>
                  ${allAdmins.map(a => `<option value="${a.id}" ${t.assigned_to === a.id ? 'selected' : ''}>${a.name}</option>`).join('')}
                </select>
              </div>
              ${t.due_date ? `<span class="kanban-due ${isOverdue ? 'overdue' : ''}"><span class="material-symbols-outlined">calendar_today</span> ${formatDate(t.due_date).split(',')[0]}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');
    }
  });
}

function setupDragAndDrop() {
  const board = document.getElementById('kanban-board');
  let draggedCard = null;

  board.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.kanban-card');
    if (!card) return;
    draggedCard = card;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.id);
  });

  board.addEventListener('dragend', (e) => {
    const card = e.target.closest('.kanban-card');
    if (!card) return;
    card.classList.remove('dragging');
    draggedCard = null;
    document.querySelectorAll('.kanban-column-body').forEach(col => col.classList.remove('drag-over'));
  });

  board.addEventListener('dragover', (e) => {
    e.preventDefault(); // Necessary to allow dropping
    const colBody = e.target.closest('.kanban-column-body');
    if (colBody && draggedCard) {
      colBody.classList.add('drag-over');
      e.dataTransfer.dropEffect = 'move';
    }
  });

  board.addEventListener('dragleave', (e) => {
    const colBody = e.target.closest('.kanban-column-body');
    if (colBody && e.relatedTarget && !colBody.contains(e.relatedTarget)) {
      colBody.classList.remove('drag-over');
    }
  });

  board.addEventListener('drop', async (e) => {
    e.preventDefault();
    const colBody = e.target.closest('.kanban-column-body');
    if (!colBody) return;
    
    colBody.classList.remove('drag-over');
    const taskId = e.dataTransfer.getData('text/plain');
    const newStatus = colBody.parentElement.dataset.status;
    
    if (taskId && newStatus) {
      const task = allTasks.find(t => t.id === taskId);
      if (task && task.status !== newStatus) {
        // Optimistic UI update
        task.status = newStatus;
        renderTasks();
        
        try {
          await updateTask(taskId, { status: newStatus });
          showToast('Task moved successfully');
        } catch (err) {
          showToast('Failed to move task', 'error');
          refreshTasks(); // Revert on failure
        }
      }
    }
  });
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
    task_type: 'kanban'
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

async function handleBoardAction(e) {
  const target = e.target.closest('button');
  if (!target) return;

  const card = target.closest('.kanban-card');
  const id = card ? card.dataset.id : null;
  if (!id) return;

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

async function handleBoardChange(e) {
  const target = e.target;
  
  // Inline assignee update
  if (target.tagName === 'SELECT' && target.classList.contains('kanban-assignee-select')) {
    const card = target.closest('.kanban-card');
    const id = card ? card.dataset.id : null;
    if (!id) return;
    
    try {
      const newAssignee = target.value || null;
      await updateTask(id, { assigned_to: newAssignee });
      showToast('Assignee updated');
      const task = allTasks.find(t => t.id === id);
      if (task) task.assigned_to = newAssignee;
      // renderTasks(); // Not strictly necessary unless we want to resort or something
    } catch (err) {
      showToast('Failed to update assignee', 'error');
      const task = allTasks.find(t => t.id === id);
      target.value = task ? (task.assigned_to || '') : ''; // Revert
    }
  }
}
