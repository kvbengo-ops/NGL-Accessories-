/* ============================================================
   NGL Admin — Content & Socials CMS (superadmin only)
   ============================================================ */
import { getStoreSettings, updateStoreSettings } from './supabase.js';
import { requireSuperadmin, renderSidebar, showToast } from './admin.js';

const fields = {
  social_instagram: 'set-social-instagram',
  social_tiktok:    'set-social-tiktok',
  social_facebook:  'set-social-facebook',
  contact_email:    'set-contact-email',
  contact_phone:    'set-contact-phone',
  support_enabled:  'set-support-enabled',
  support_greeting: 'set-support-greeting',
  support_kb:       'set-support-kb',
};

(async () => {
  const admin = await requireSuperadmin();
  renderSidebar('Content & Socials', admin);
  await loadCMS();
  document.getElementById('cms-form')?.addEventListener('submit', saveCMS);
})();

async function loadCMS() {
  try {
    const settings = await getStoreSettings();
    for (const [key, id] of Object.entries(fields)) {
      const el = document.getElementById(id);
      if (el) el.value = settings[key] ?? '';
    }
  } catch (err) {
    console.error('Failed to load CMS settings:', err);
    showToast('Failed to load settings', 'error');
  }
}

async function saveCMS(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-save-cms');

  const values = {};
  for (const [key, id] of Object.entries(fields)) {
    values[key] = document.getElementById(id)?.value.trim() ?? '';
  }

  btn.disabled = true;
  try {
    await updateStoreSettings(values);
    showToast('Content settings saved successfully!');
  } catch (err) {
    console.error('Failed to save CMS settings:', err);
    showToast('Failed to save: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}
