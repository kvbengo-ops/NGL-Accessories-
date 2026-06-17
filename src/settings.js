/* ============================================================
   NGL Admin — Store Settings (superadmin only)
   ============================================================ */
import { getStoreSettings, updateStoreSettings } from './supabase.js';
import { requireSuperadmin, renderSidebar, showToast } from './admin.js';

const fields = {
  gcash_number:            'set-gcash-number',
  gcash_name:              'set-gcash-name',
  bank_accounts:           'set-bank-accounts',
};

(async () => {
  const admin = await requireSuperadmin();
  renderSidebar('Store Settings', admin);
  await loadSettings();
  document.getElementById('settings-form')?.addEventListener('submit', saveSettings);
})();

async function loadSettings() {
  try {
    const settings = await getStoreSettings();
    for (const [key, id] of Object.entries(fields)) {
      const el = document.getElementById(id);
      if (el) el.value = settings[key] ?? '';
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
    showToast('Failed to load settings', 'error');
  }
}

async function saveSettings(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-save-settings');

  const values = {};
  for (const [key, id] of Object.entries(fields)) {
    values[key] = document.getElementById(id)?.value.trim() ?? '';
  }

  btn.disabled = true;
  try {
    await updateStoreSettings(values);
    showToast('Settings saved — checkout now uses these values');
  } catch (err) {
    console.error('Failed to save settings:', err);
    showToast('Failed to save: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}
