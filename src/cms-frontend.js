import { getStoreSettings } from './supabase.js';

export async function applyCMS() {
  try {
    const settings = await getStoreSettings();
    document.querySelectorAll('[data-cms]').forEach(el => {
      const key = el.dataset.cms;
      const value = settings[key];

      if (!value) {
        // Optionally hide an ancestor container (e.g. a whole card) when empty
        const hideSel = el.getAttribute('data-cms-empty-hide');
        if (hideSel) {
          const container = el.closest(hideSel);
          if (container) container.style.display = 'none';
          return;
        }
        // Otherwise hide social links and the phone row when no value is set
        if ((key.startsWith('social_') && el.classList.contains('social-link')) || key === 'contact_phone') {
          el.style.display = 'none';
        }
        return;
      }

      if (el.tagName === 'A') {
        if (key === 'contact_email') {
          el.href = `mailto:${value}`;
          el.textContent = value;
        } else if (key === 'contact_phone') {
          el.href = `tel:${value.replace(/[^+\d]/g, '')}`;
          el.textContent = value;
          el.style.display = ''; // Ensure it's visible
        } else if (key.startsWith('social_')) {
          el.href = value;
          el.style.display = ''; // Ensure it's visible
        }
      } else {
        el.textContent = value;
      }
    });
  } catch (err) {
    console.error('Failed to apply CMS settings:', err);
  }
}

// Auto-run on load
applyCMS();
