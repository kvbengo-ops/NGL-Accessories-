import { getStoreSettings } from './supabase.js';

export async function applyCMS() {
  try {
    const settings = await getStoreSettings();
    document.querySelectorAll('[data-cms]').forEach(el => {
      const key = el.dataset.cms;
      const value = settings[key];
      
      if (!value) {
        // Hide social links if the URL is empty
        if (key.startsWith('social_') && el.classList.contains('social-link')) {
          el.style.display = 'none';
        }
        return;
      }

      if (el.tagName === 'A') {
        if (key === 'contact_email') {
          el.href = `mailto:${value}`;
          el.textContent = value;
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
