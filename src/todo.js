import { supabase } from './supabase.js';
import { requireAuth, renderSidebar, showToast, formatDate, openModal, closeModal } from './admin.js';
import flatpickr from 'flatpickr';
import 'flatpickr/dist/flatpickr.min.css';
import 'flatpickr/dist/themes/dark.css';

let currentUser = null;
let allTasks = [];

document.addEventListener('DOMContentLoaded', async () => {
  try {
    currentUser = await requireAuth();
    renderSidebar('My To-Do', currentUser);
    
    // Display current date
    const dateDisplay = document.getElementById('todo-date-display');
    const todayStr = new Date().toISOString().split('T')[0];
    if (dateDisplay) {
      dateDisplay.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    }

    // Initialize flatpickr for quick add
    const dateInput = document.getElementById('todo-quick-date');
    if (dateInput) {
      flatpickr(dateInput, {
        defaultDate: todayStr,
        dateFormat: "Y-m-d",
        altInput: true,
        altFormat: "M j, Y",
      });
    }

    // Setup motivation quote
    const quotes = [
      { title: "Focus on the Small Wins", body: "Checking off a tiny task builds the momentum you need for the big ones." },
      { title: "One Step at a Time", body: "Don't look at the whole mountain. Just focus on the next step." },
      { title: "Progress, Not Perfection", body: "A small step forward is still a step in the right direction." },
      { title: "Consistency is Key", body: "Small daily habits eventually lead to massive success." },
      { title: "Celebrate Little Victories", body: "Every ticked box is a victory. Keep the momentum going!" }
    ];
    const q = quotes[Math.floor(Math.random() * quotes.length)];
    const qTitle = document.getElementById('todo-quote-title');
    const qBody = document.getElementById('todo-quote-body');
    if (qTitle && qBody) {
      qTitle.textContent = q.title;
      qBody.textContent = q.body;
    }

    const navToggle = document.getElementById('todo-nav-toggle');
    if (navToggle) {
      navToggle.addEventListener('click', () => {
        document.body.classList.toggle('todo-focus-mode');
      });
    }

    setupEventListeners();
    await fetchTasks();
  } catch (err) {
    console.error('To-Do initialization error:', err);
  }
});

let pendingConfirmCallback = null;

function showConfirmModal(title, desc, onConfirm) {
  document.getElementById('confirm-modal-title').textContent = title;
  document.getElementById('confirm-modal-desc').textContent = desc;
  pendingConfirmCallback = onConfirm;
  openModal('confirm-modal');
}

function setupEventListeners() {
  document.getElementById('confirm-modal-cancel').addEventListener('click', () => {
    closeModal('confirm-modal');
    pendingConfirmCallback = null;
  });
  
  document.getElementById('confirm-modal-confirm').addEventListener('click', () => {
    closeModal('confirm-modal');
    if (pendingConfirmCallback) {
      pendingConfirmCallback();
      pendingConfirmCallback = null;
    }
  });

  const quickForm = document.getElementById('todo-quick-form');
  if (quickForm) {
    quickForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('todo-quick-input');
      const dateInput = document.getElementById('todo-quick-date');
      const title = input.value.trim();
      if (!title) return;

      let dueStr = dateInput.value;
      if (!dueStr) dueStr = new Date().toISOString().split('T')[0];
      const dueDate = new Date(dueStr + 'T12:00:00Z').toISOString();

      const btn = quickForm.querySelector('.todo-quick-btn');
      btn.disabled = true;

      try {
        const { error } = await supabase.from('admin_tasks').insert([{
          title,
          status: 'pending',
          priority: 'medium',
          assigned_to: currentUser.id,
          due_date: dueDate,
          task_type: 'todo'
        }]);

        if (error) throw error;
        
        input.value = '';
        showToast('Task added successfully', 'success');
        await fetchTasks();
      } catch (err) {
        console.error('Error adding task:', err);
        showToast('Failed to add task', 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }

  // Handle task completion via event delegation
  document.querySelector('.todo-layout').addEventListener('change', async (e) => {
    // Handling Checkbox Toggle
    if (e.target.classList.contains('todo-checkbox')) {
      const taskId = e.target.dataset.id;
      const itemEl = e.target.closest('.todo-item');
      
      if (e.target.checked) {
        itemEl.classList.add('completing');
        setTimeout(async () => {
          try {
            const { error } = await supabase.from('admin_tasks')
              .update({ status: 'completed', updated_at: new Date().toISOString() })
              .eq('id', taskId);
              
            if (error) throw error;
            showToast('Task completed!', 'success');
            await fetchTasks();
          } catch (err) {
            showToast('Failed to update task', 'error');
            e.target.checked = false;
            itemEl.classList.remove('completing');
          }
        }, 500); 
      } else {
        try {
          const { error } = await supabase.from('admin_tasks')
            .update({ status: 'pending' })
            .eq('id', taskId);
            
          if (error) throw error;
          await fetchTasks();
        } catch (err) {
          showToast('Failed to update task', 'error');
          e.target.checked = true;
        }
      }
    }

    // Handling Daily Title Save
    if (e.target.classList.contains('todo-card-title-input')) {
      const input = e.target;
      const newTitle = input.value.trim();
      const dateStr = input.dataset.date;
      const existingId = input.dataset.id;
      
      try {
        if (existingId) {
          if (newTitle) {
            await supabase.from('admin_tasks').update({ title: newTitle }).eq('id', existingId);
          } else {
            await supabase.from('admin_tasks').delete().eq('id', existingId);
            input.dataset.id = '';
          }
        } else if (newTitle) {
          const { data, error } = await supabase.from('admin_tasks').insert([{
            title: newTitle,
            task_type: 'todo_title',
            assigned_to: currentUser.id,
            due_date: new Date(dateStr + 'T12:00:00Z').toISOString()
          }]).select().single();
          if (error) throw error;
          input.dataset.id = data.id;
        }
        showToast('List title saved');
      } catch (err) {
        console.error('Error saving title:', err);
        showToast('Failed to save title', 'error');
      }
    }
  });

  document.querySelector('.todo-layout').addEventListener('click', async (e) => {
    // Tapping anywhere on a task row (except its buttons/checkbox) toggles completion,
    // giving a comfortable touch target instead of the small checkbox alone.
    const row = e.target.closest('.todo-item');
    if (row && !e.target.closest('button') && !e.target.closest('.todo-checkbox-wrap')) {
      const cb = row.querySelector('.todo-checkbox');
      if (cb) {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }

    // Handling Archive Individual Task
    if (e.target.closest('.archive-todo-btn')) {
      const btn = e.target.closest('.archive-todo-btn');
      const taskId = btn.dataset.id;
      try {
        const { error } = await supabase.from('admin_tasks').update({ status: 'archived' }).eq('id', taskId);
        if (error) throw error;
        showToast('Task archived', 'success');
        await fetchTasks();
      } catch (err) {
        console.error('Error archiving task:', err);
        showToast('Failed to archive task', 'error');
      }
    }

    // Handling Delete Individual Task
    if (e.target.closest('.delete-todo-btn')) {
      const btn = e.target.closest('.delete-todo-btn');
      const taskId = btn.dataset.id;
      
      showConfirmModal('Delete Task?', 'Are you sure you want to delete this task? This cannot be undone.', async () => {
        try {
          const { error } = await supabase.from('admin_tasks').delete().eq('id', taskId);
          if (error) throw error;
          showToast('Task deleted', 'success');
          await fetchTasks();
        } catch (err) {
          console.error('Error deleting task:', err);
          showToast('Failed to delete task', 'error');
        }
      });
    }

    // Handling Delete Entire Card
    if (e.target.closest('.todo-card-delete-btn')) {
      const btn = e.target.closest('.todo-card-delete-btn');
      const dateStr = btn.dataset.date;
      
      showConfirmModal('Delete List?', 'Are you sure you want to delete this entire list and all its tasks? This cannot be undone.', async () => {
        try {
          const tasksToDelete = allTasks.filter(t => {
            let dStr = t.due_date ? t.due_date.split('T')[0] : 'Unscheduled';
            return dStr === dateStr;
          });
          const ids = tasksToDelete.map(t => t.id);
          
          if (ids.length > 0) {
            const { error } = await supabase.from('admin_tasks').delete().in('id', ids);
            if (error) throw error;
            showToast('List deleted completely', 'success');
            await fetchTasks();
          }
        } catch (err) {
          console.error('Error deleting list:', err);
          showToast('Failed to delete list', 'error');
        }
      });
    }
  });
}

async function fetchTasks() {
  document.getElementById('todo-loading').style.display = 'flex';
  document.getElementById('todo-cards-container').innerHTML = '';
  document.getElementById('todo-empty').style.display = 'none';
  
  try {
    const { data, error } = await supabase
      .from('admin_tasks')
      .select('*')
      .eq('assigned_to', currentUser.id)
      .in('task_type', ['todo', 'todo_title']);

    if (error) throw error;
    allTasks = data || [];
    
    updateStreak();
    renderCards();
  } catch (err) {
    console.error('Error fetching tasks:', err);
    showToast('Failed to load tasks', 'error');
  } finally {
    document.getElementById('todo-loading').style.display = 'none';
  }
}

function updateStreak() {
  const completedTasks = allTasks.filter(t => t.task_type === 'todo' && t.status === 'completed' && t.updated_at);
  const completedDates = new Set(completedTasks.map(t => new Date(t.updated_at).toISOString().split('T')[0]));
  
  let streak = 0;
  let d = new Date();
  const todayStr = d.toISOString().split('T')[0];
  
  if (completedDates.has(todayStr)) {
    streak = 1;
    d.setDate(d.getDate() - 1);
  } else {
    d.setDate(d.getDate() - 1);
    if (!completedDates.has(d.toISOString().split('T')[0])) {
      streak = 0;
    }
  }

  if (streak > 0 || completedDates.has(d.toISOString().split('T')[0])) {
    while(true) {
      let dateStr = d.toISOString().split('T')[0];
      if (completedDates.has(dateStr)) {
        if (dateStr !== todayStr) streak++; 
        d.setDate(d.getDate() - 1);
      } else {
        break;
      }
    }
  }

  const badge = document.getElementById('streak-badge');
  const count = document.getElementById('streak-count');
  if (badge && count) {
    badge.style.display = 'flex';
    count.textContent = `${streak} Day Streak`;
    if (streak >= 3) {
      badge.classList.add('fire');
    } else {
      badge.classList.remove('fire');
    }
    if (streak === 0) {
      badge.style.background = 'rgb(var(--adm-fg) / 0.05)';
      badge.style.borderColor = 'rgb(var(--adm-fg) / 0.1)';
      badge.style.color = 'var(--adm-text-muted)';
      badge.querySelector('.streak-icon').style.color = 'var(--adm-text-muted)';
    } else {
      badge.style.background = '';
      badge.style.borderColor = '';
      badge.style.color = '';
      badge.querySelector('.streak-icon').style.color = '';
    }
  }
}

function renderCards() {
  const container = document.getElementById('todo-cards-container');
  const todayStr = new Date().toISOString().split('T')[0];
  
  const groups = {};
  const titles = {};
  
  allTasks.forEach(task => {
    if (task.status === 'archived') return;

    let dateStr = task.due_date ? task.due_date.split('T')[0] : 'Unscheduled';
    if (!groups[dateStr]) {
      groups[dateStr] = { pending: [], done: [] };
    }
    
    if (task.task_type === 'todo_title') {
      titles[dateStr] = task;
    } else if (task.status === 'completed') {
      groups[dateStr].done.push(task);
    } else {
      groups[dateStr].pending.push(task);
    }
  });

  const sortedDates = Object.keys(groups).sort((a, b) => {
    if (a === 'Unscheduled') return 1;
    if (b === 'Unscheduled') return -1;
    return a.localeCompare(b);
  });

  // Check if there are any actual tasks, not just titles
  const hasTasks = sortedDates.some(d => groups[d].pending.length > 0 || groups[d].done.length > 0);

  if (!hasTasks) {
    document.getElementById('todo-empty').style.display = 'block';
    return;
  }

  let html = '';

  sortedDates.forEach(dateStr => {
    const group = groups[dateStr];
    // Don't show fully empty cards (e.g. if we filter something later)
    if (group.pending.length === 0 && group.done.length === 0) return;

    let displayDate = dateStr;
    let statusText = '';
    
    if (dateStr !== 'Unscheduled') {
      const d = new Date(dateStr + 'T12:00:00Z');
      const diffDays = Math.round((d - new Date(todayStr + 'T12:00:00Z')) / (1000 * 60 * 60 * 24));
      
      if (diffDays === 0) {
        displayDate = 'Today';
        statusText = 'Focus';
      } else if (diffDays === 1) {
        displayDate = 'Tomorrow';
        statusText = 'Upcoming';
      } else if (diffDays === -1) {
        displayDate = 'Yesterday';
        statusText = 'Overdue';
      } else if (diffDays < -1) {
        displayDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        statusText = 'Overdue';
      } else {
        displayDate = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        statusText = 'Upcoming';
      }
    } else {
      statusText = 'Whenever';
    }

    const titleObj = titles[dateStr];
    const customTitle = titleObj ? titleObj.title : '';
    const titleId = titleObj ? titleObj.id : '';
    const statusStyle = statusText === 'Overdue' ? 'color:rgb(var(--adm-red));' : statusText === 'Focus' ? 'color:var(--adm-gold);' : '';

    // Per-list progress (drives the progress bar + count and motivates completion)
    const doneCount = group.done.length;
    const total = group.pending.length + doneCount;
    const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
    const allDone = total > 0 && doneCount === total;

    // Accent the most important lists so hierarchy reads by more than colour alone
    let cardModifier = '';
    if (statusText === 'Focus') cardModifier = ' is-today';
    else if (statusText === 'Overdue') cardModifier = ' is-overdue';
    if (allDone) cardModifier += ' is-complete';

    let pendingHtml = group.pending.map(t => createTodoHtml(t, false)).join('');
    let doneHtml = group.done.map(t => createTodoHtml(t, true)).join('');

    html += `
      <div class="todo-date-card${cardModifier}">
        <div class="todo-card-header">
          <div class="todo-card-heading">
            <input type="text" class="todo-card-title-input" data-date="${dateStr}" data-id="${titleId}" value="${escapeHtml(customTitle)}" placeholder="Name this list…" aria-label="List name for ${displayDate}" />
            <div class="todo-card-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${doneCount}" aria-label="${doneCount} of ${total} tasks done">
              <span class="todo-card-progress-track"><span class="todo-card-progress-fill" style="width:${pct}%;"></span></span>
              <span class="todo-card-progress-count">${doneCount}/${total}${allDone ? ' <span class="material-symbols-outlined" aria-hidden="true">check_circle</span>' : ''}</span>
            </div>
          </div>
          <div class="todo-card-meta">
            <div class="todo-card-meta-text">
              <span class="todo-card-date">${displayDate}</span>
              <span class="todo-card-status" style="${statusStyle}">${statusText}</span>
            </div>
            <button class="todo-card-delete-btn" type="button" data-date="${dateStr}" title="Delete entire list" aria-label="Delete the ${displayDate} list">
              <span class="material-symbols-outlined" style="font-size:18px;" aria-hidden="true">delete</span>
            </button>
          </div>
        </div>
        <div class="todo-card-body">
          ${pendingHtml ? `<div class="todo-group-pending" role="list">${pendingHtml}</div>` : ''}
          ${doneHtml ? `
            <div class="todo-group-done">
              <span class="todo-group-done-title"><span class="material-symbols-outlined" style="font-size:12px;" aria-hidden="true">done_all</span> Completed</span>
              <div role="list">${doneHtml}</div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function createTodoHtml(task, isCompleted) {
  const priorityMeta = task.priority === 'high'
    ? `<span class="badge badge--error"><span class="material-symbols-outlined" style="font-size:12px;margin-right:4px;" aria-hidden="true">priority_high</span>High Priority</span>`
    : '';

  const safeTitle = escapeHtml(task.title);
  const checkLabel = isCompleted
    ? `Mark “${safeTitle}” as not done`
    : `Mark “${safeTitle}” as done`;

  return `
    <div class="todo-item ${isCompleted ? 'completed' : ''}" role="listitem">
      <div class="todo-checkbox-wrap">
        <input type="checkbox" class="todo-checkbox" data-id="${task.id}" ${isCompleted ? 'checked' : ''} aria-label="${checkLabel}" />
        <span class="material-symbols-outlined todo-checkbox-icon" aria-hidden="true">check</span>
      </div>
      <div class="todo-content">
        <div class="todo-title">${safeTitle}</div>
        ${task.description ? `<div class="todo-desc" title="${escapeHtml(task.description)}">${escapeHtml(task.description)}</div>` : ''}
        ${priorityMeta ? `<div class="todo-meta">${priorityMeta}</div>` : ''}
      </div>
      <div class="todo-item-actions">
        <button class="todo-action-btn archive-todo-btn" type="button" data-id="${task.id}" title="Archive" aria-label="Archive “${safeTitle}”">
          <span class="material-symbols-outlined" style="font-size:16px;" aria-hidden="true">inventory_2</span>
        </button>
        <button class="todo-action-btn delete-todo-btn" type="button" data-id="${task.id}" title="Delete" aria-label="Delete “${safeTitle}”">
          <span class="material-symbols-outlined" style="font-size:16px;" aria-hidden="true">delete</span>
        </button>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
  });
}
