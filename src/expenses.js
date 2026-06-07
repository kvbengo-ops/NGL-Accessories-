import { getExpenses, upsertExpense, deleteExpense, getAdmins } from './supabase.js';
import { requireAuth, renderSidebar, showToast, formatDate, formatPrice, openModal, closeModal } from './admin.js';

let allExpenses = [];
let allAdmins = [];
let currentUser = null;

(async () => {
  currentUser = await requireAuth();
  renderSidebar('Expenses', currentUser);

  await loadAdmins();
  await refreshExpenses();

  // Filter bindings
  document.getElementById('expenses-search').addEventListener('input', renderExpenses);
  document.getElementById('expenses-filter-category').addEventListener('change', renderExpenses);
  document.getElementById('expenses-filter-month').addEventListener('change', renderExpenses);

  // Modal bindings
  document.getElementById('btn-create-expense').addEventListener('click', () => openExpenseModal());
  document.getElementById('btn-cancel-expense').addEventListener('click', () => closeModal('expense-modal'));
  document.getElementById('close-expense-modal').addEventListener('click', () => closeModal('expense-modal'));
  
  // Form submission
  document.getElementById('expense-form').addEventListener('submit', handleSaveExpense);
  
  // Table actions
  document.getElementById('expenses-body').addEventListener('click', handleTableAction);
})();

async function loadAdmins() {
  try {
    allAdmins = await getAdmins();
  } catch (err) {
    console.error('Failed to load admins', err);
  }
}

function populateMonthFilter() {
  const select = document.getElementById('expenses-filter-month');
  const months = new Set();
  
  allExpenses.forEach(exp => {
    if (exp.expense_date) {
      const monthStr = exp.expense_date.substring(0, 7); // YYYY-MM
      months.add(monthStr);
    }
  });

  const sortedMonths = Array.from(months).sort().reverse();
  
  let optionsHtml = '<option value="">All Time</option>';
  sortedMonths.forEach(m => {
    const d = new Date(m + '-01');
    const label = d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long' });
    optionsHtml += `<option value="${m}">${label}</option>`;
  });
  
  const currentVal = select.value;
  select.innerHTML = optionsHtml;
  if (months.has(currentVal)) select.value = currentVal;
}

async function refreshExpenses() {
  const tbody = document.getElementById('expenses-body');
  tbody.innerHTML = '<tr><td colspan="6" class="table-loading">Loading expenses…</td></tr>';
  try {
    allExpenses = await getExpenses();
    populateMonthFilter();
    renderExpenses();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty" style="color:var(--error);">Failed to load expenses</td></tr>';
    showToast('Failed to load expenses', 'error');
  }
}

function renderExpenses() {
  const search = document.getElementById('expenses-search').value.toLowerCase();
  const category = document.getElementById('expenses-filter-category').value;
  const month = document.getElementById('expenses-filter-month').value;

  const filtered = allExpenses.filter(e => {
    if (search && !e.title.toLowerCase().includes(search)) return false;
    if (category && e.category !== category) return false;
    if (month && !e.expense_date?.startsWith(month)) return false;
    return true;
  });

  const tbody = document.getElementById('expenses-body');
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No expenses found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(e => {
    const admin = allAdmins.find(a => a.id === e.created_by);
    const adminName = admin ? admin.name : 'Unknown';

    return `
      <tr>
        <td class="date-cell">${e.expense_date ? formatDate(e.expense_date).split(',')[0] : '—'}</td>
        <td style="font-weight:500;">${e.title}</td>
        <td><span class="type-badge" style="background:rgba(201,168,76,0.1); color:var(--gold-300); border-color:rgba(201,168,76,0.3)">${e.category}</span></td>
        <td style="font-family:monospace; color:#f87171;">-${formatPrice(e.amount)}</td>
        <td style="font-size:12px; color:#888;">${adminName}</td>
        <td class="actions-cell" style="text-align:right;">
          <button class="action-btn edit-expense" data-id="${e.id}" title="Edit"><span class="material-symbols-outlined">edit</span></button>
          <button class="action-btn delete-expense" data-id="${e.id}" title="Delete" style="color:var(--error);"><span class="material-symbols-outlined">delete</span></button>
        </td>
      </tr>
    `;
  }).join('');
}

function openExpenseModal(expense = null) {
  const title = document.getElementById('expense-modal-title');
  const form = document.getElementById('expense-form');
  
  if (expense) {
    title.textContent = 'Edit Expense';
    form['expense-id'].value = expense.id;
    form['expense-title'].value = expense.title;
    form['expense-category'].value = expense.category;
    form['expense-amount'].value = expense.amount;
    form['expense-date'].value = expense.expense_date || '';
  } else {
    title.textContent = 'Log Expense';
    form.reset();
    form['expense-id'].value = '';
    form['expense-date'].value = new Date().toISOString().slice(0, 10);
  }
  openModal('expense-modal');
}

async function handleSaveExpense(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-save-expense');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  const id = document.getElementById('expense-id').value;
  const payload = {
    title: document.getElementById('expense-title').value.trim(),
    category: document.getElementById('expense-category').value,
    amount: parseFloat(document.getElementById('expense-amount').value),
    expense_date: document.getElementById('expense-date').value,
  };

  try {
    if (id) {
      payload.id = id;
      await upsertExpense(payload);
      showToast('Expense updated');
    } else {
      payload.created_by = currentUser.id;
      await upsertExpense(payload);
      showToast('Expense logged successfully');
    }
    closeModal('expense-modal');
    refreshExpenses();
  } catch (err) {
    showToast(err.message || 'Failed to save expense', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Expense';
  }
}

async function handleTableAction(e) {
  const target = e.target.closest('button');
  if (!target) return;

  const id = target.getAttribute('data-id');
  if (!id) return;

  if (target.classList.contains('edit-expense')) {
    const expense = allExpenses.find(x => x.id === id);
    if (expense) openExpenseModal(expense);
    return;
  }

  if (target.classList.contains('delete-expense')) {
    if (confirm('Are you sure you want to delete this expense record? This will affect your Net Profit calculations.')) {
      try {
        await deleteExpense(id);
        showToast('Expense deleted');
        refreshExpenses();
      } catch (err) {
        showToast('Failed to delete expense', 'error');
      }
    }
    return;
  }
}
