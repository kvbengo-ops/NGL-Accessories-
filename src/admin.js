/* ============================================================
   NGL Accessories — Admin Shared Utilities
   Auth guard · Sidebar · Toasts · Helpers
   ============================================================ */
import { supabase, getCurrentAdmin } from './supabase.js';

/* ── Auth Guard ──────────────────────────────────────────── */
export async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = '/admin/login.html';
    throw new Error('Not authenticated');
  }
  const admin = await getCurrentAdmin();
  if (!admin || !admin.is_active) {
    await supabase.auth.signOut();
    window.location.href = '/admin/login.html';
    throw new Error('Not an active admin');
  }
  // Update last login
  await supabase.from('admins').update({ last_login: new Date().toISOString() }).eq('id', admin.id);
  return admin;
}

// Any active admin may use the support console (see SUPPORT_BOT_PLAN.md).
export const requireAdmin = requireAuth;

export async function requireSuperadmin() {
  const admin = await requireAuth();
  if (admin.role !== 'superadmin') {
    showToast('Access denied — superadmin only', 'error');
    setTimeout(() => window.location.href = '/admin/dashboard.html', 1500);
    throw new Error('Not a superadmin');
  }
  return admin;
}

export async function logout() {
  await supabase.auth.signOut();
  window.location.href = '/admin/login.html';
}

/* ── Sidebar ─────────────────────────────────────────────── */
export function renderSidebar(activePage, admin) {
  const nav = [
    { section: 'Overview' },
    { href: '/admin/dashboard.html', icon: 'dashboard',       label: 'Dashboard' },
    { href: '/admin/tasks.html',     icon: 'task_alt',        label: 'Tasks'     },
    { href: '/admin/todo.html',      icon: 'checklist',       label: 'My To-Do'  },
    { section: 'Operations' },
    { href: '/admin/inventory.html', icon: 'inventory_2',     label: 'Inventory' },
    { href: '/admin/orders.html',    icon: 'receipt_long',    label: 'Orders'    },
    { href: '/admin/pos.html',       icon: 'point_of_sale',   label: 'POS'       },
    { href: '/admin/expenses.html',  icon: 'receipt',         label: 'Expenses'  },
    { href: '/admin/support.html',   icon: 'forum',           label: 'Live Chat' },
    { section: 'Settings', superadminOnly: true },
    { href: '/admin/admins.html',    icon: 'manage_accounts', label: 'Admins', superadminOnly: true },
    { href: '/admin/settings.html',  icon: 'settings',        label: 'Store Settings', superadminOnly: true },
    { href: '/admin/cms.html',       icon: 'web',             label: 'Content & Socials', superadminOnly: true },
  ];

  const isSuperadmin = admin?.role === 'superadmin';
  const navHtml = nav
    .filter(n => !n.superadminOnly || isSuperadmin)
    .map(n => n.section
      ? `<span class="sidebar-nav-section">${n.section}</span>`
      : `<a href="${n.href}" class="sidebar-link ${activePage === n.label ? 'active' : ''}">
           <span class="material-symbols-outlined">${n.icon}</span>
           <span>${n.label}</span>
         </a>`)
    .join('');

  const html = `
    <aside class="admin-sidebar" id="admin-sidebar">
      <div class="sidebar-brand">
        <div class="sidebar-brand-mark">
          <span class="material-symbols-outlined">diamond</span>
        </div>
        <div class="sidebar-brand-text">
          <span class="sidebar-logo">NGL</span>
          <span class="sidebar-subbrand">Admin Portal</span>
        </div>
      </div>
      <nav class="sidebar-nav">${navHtml}</nav>
      <div class="sidebar-footer">
        <div class="sidebar-user">
          <div class="sidebar-avatar">${admin?.name ? admin.name[0].toUpperCase() : 'A'}</div>
          <div class="sidebar-user-info">
            <span class="sidebar-user-name">${admin?.name || 'Admin'}</span>
            <span class="sidebar-user-role">${admin?.role || 'admin'}</span>
          </div>
        </div>
        <button class="sidebar-logout sidebar-theme" id="sidebar-theme" type="button" aria-pressed="false">
          <span class="material-symbols-outlined">dark_mode</span>
          <span class="sidebar-theme-label">Dark mode</span>
        </button>
        <button class="sidebar-logout" id="sidebar-logout">
          <span class="material-symbols-outlined">logout</span>
          Sign out
        </button>
      </div>
    </aside>
    <button class="sidebar-toggle" id="sidebar-toggle" aria-label="Toggle sidebar">
      <span class="material-symbols-outlined">menu</span>
    </button>
  `;

  const container = document.getElementById('sidebar-container');
  if (container) {
    container.innerHTML = html;
    document.getElementById('sidebar-logout')?.addEventListener('click', logout);
    initThemeToggle();
    document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
      document.getElementById('admin-sidebar')?.classList.toggle('open');
    });
  }
}

/* ── Theme ───────────────────────────────────────────────
   Admin-only light/dark. The storefront has a single fixed palette, so this
   deliberately does not touch it. The attribute is set on <html> by an inline
   snippet in each admin page's <head> — doing it here instead would flash dark
   before this deferred module runs. */
const THEME_KEY = 'ngl_admin_theme';

function applyTheme(theme) {
  const light = theme === 'light';
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  document.dispatchEvent(new CustomEvent('ngl:admin-theme-change'));
  const btn = document.getElementById('sidebar-theme');
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(light));
  btn.querySelector('.material-symbols-outlined').textContent = light ? 'light_mode' : 'dark_mode';
  btn.querySelector('.sidebar-theme-label').textContent = light ? 'Light mode' : 'Dark mode';
}

function initThemeToggle() {
  let saved = 'dark';
  try { saved = localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch (_) { /* ignore */ }
  applyTheme(saved);
  document.getElementById('sidebar-theme')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, next); } catch (_) { /* ignore */ }
    applyTheme(next);
  });
}

/* ── Toast Notifications ─────────────────────────────────── */
let toastTimer = null;
export function showToast(msg, type = 'success') {
  let toast = document.getElementById('admin-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'admin-toast';
    toast.className = 'admin-toast';
    document.body.appendChild(toast);
  }
  const icons = { success: 'check_circle', error: 'error', info: 'info', warning: 'warning' };
  toast.innerHTML = `<span class="material-symbols-outlined">${icons[type] || 'check_circle'}</span>${msg}`;
  toast.className = `admin-toast admin-toast--${type} visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3500);
}

/* ── Format helpers ──────────────────────────────────────── */
export function formatPrice(n) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

export function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

export function statusBadge(status) {
  const map = {
    pending:    'badge--warning',
    processing: 'badge--info',
    shipped:    'badge--purple',
    delivered:  'badge--success',
    completed:  'badge--success',
    cancelled:  'badge--error',
    voided:     'badge--error',
  };
  return `<span class="status-badge ${map[status] || ''}">${status}</span>`;
}

/* ── Modal helpers ───────────────────────────────────────── */
export function openModal(id) {
  document.getElementById(id)?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
  document.body.style.overflow = '';
}

export function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
