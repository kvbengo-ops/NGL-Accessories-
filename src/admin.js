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

// Any active admin may use the support console (see docs/SUPPORT_BOT_PLAN.md).
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
    { href: '/admin/circle.html',    icon: 'reviews',         label: 'NGL Circle' },
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
        <details class="sidebar-theme" id="sidebar-theme">
          <summary class="sidebar-logout sidebar-theme-summary">
            <span class="theme-swatch" id="sidebar-theme-swatch"></span>
            <span class="sidebar-theme-label"></span>
            <span class="material-symbols-outlined sidebar-theme-caret">expand_more</span>
          </summary>
          <div class="sidebar-theme-menu">
            ${THEMES.map(t => `
              <button type="button" class="sidebar-theme-option" data-theme-id="${t.id}">
                <span class="theme-swatch">${swatchHtml(t)}</span>
                <span>${t.label}</span>
              </button>`).join('')}
          </div>
        </details>
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

/* ── Theme ──────────────────────────────
   Admin-only. The storefront has a single fixed palette, so this deliberately
   does not touch it. Both attributes are set on <html> by an inline snippet in
   each admin page's <head> — doing it here instead would flash the default
   before this deferred module runs.

   Adding a theme: add a palette block in style.css and one row here. Light
   grounds must say mode 'light' so they pick up the component overrides — the
   mode is mirrored into storage so the inline snippet never has to know the
   list. */
const THEME_KEY = 'ngl_admin_theme';
const MODE_KEY  = 'ngl_admin_mode';

const THEMES = [
  // swatch = [background, sidebar, accent] — the dropdown preview, kept in
  // step by hand with the palette blocks in style.css.
  { id: 'dark',     label: 'Obsidian',        mode: 'dark',   swatch: ['#0a0908', '#0d0c0a', '#d4a853'] },
  { id: 'light',    label: 'Ivory',           mode: 'light',  swatch: ['#f2efe7', '#fffdf8', '#6b4f10'] },
  { id: 'forest',   label: 'Forest & Ivory',  mode: 'light',  swatch: ['#F5F4EF', '#203A32', '#315C4B'] },
  { id: 'ink',      label: 'Ink & Paper',     mode: 'light',  swatch: ['#F4F5F7', '#192536', '#365D91'] },
  { id: 'stone',    label: 'Warm Stone',      mode: 'light',  swatch: ['#F3F0EB', '#37332F', '#79604B'] },
  { id: 'wine',     label: 'Wine & Linen',    mode: 'light',  swatch: ['#F7F2EE', '#422832', '#853E55'] },
  { id: 'plum',     label: 'Plum & Mist',     mode: 'light',  swatch: ['#F4F2F7', '#30283D', '#70518C'] },
  { id: 'ocean',    label: 'Ocean & Salt',    mode: 'light',  swatch: ['#F0F5F5', '#193A40', '#286C76'] },
  { id: 'graphite', label: 'Graphite',        mode: 'dark',   swatch: ['#191B1E', '#131518', '#A8B9CA'] },
  { id: 'brass',    label: 'Midnight Brass',  mode: 'dark',   swatch: ['#1C1B18', '#141310', '#C4A66A'] },
];

const swatchHtml = (t) => t.swatch.map(c => `<i style="background:${c}"></i>`).join('');

function applyTheme(id) {
  const theme = THEMES.find(t => t.id === id) || THEMES[0];
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.dataset.mode  = theme.mode;
  document.dispatchEvent(new CustomEvent('ngl:admin-theme-change'));
  try {
    localStorage.setItem(THEME_KEY, theme.id);
    localStorage.setItem(MODE_KEY, theme.mode);
  } catch (_) { /* ignore */ }
  const picker = document.getElementById('sidebar-theme');
  if (!picker) return;
  picker.querySelector('#sidebar-theme-swatch').innerHTML = swatchHtml(theme);
  picker.querySelector('.sidebar-theme-label').textContent = theme.label;
  picker.querySelectorAll('.sidebar-theme-option').forEach(b =>
    b.classList.toggle('active', b.dataset.themeId === theme.id));
}

function initThemeToggle() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (_) { /* ignore */ }
  applyTheme(saved);
  const picker = document.getElementById('sidebar-theme');
  picker?.addEventListener('click', (e) => {
    const btn = e.target.closest('.sidebar-theme-option');
    if (!btn) return;
    applyTheme(btn.dataset.themeId);
    picker.open = false;
  });
  document.addEventListener('click', (e) => {
    if (picker && !picker.contains(e.target)) picker.open = false;
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

export { escapeHtml } from './supabase.js';
