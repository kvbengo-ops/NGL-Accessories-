import { supabase } from './supabase.js';

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('contact-form');
  const submitBtn = document.getElementById('submit-btn');
  const messageDiv = document.getElementById('form-message');

  if (!form) return;

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function supportEmail() {
    // cms-frontend.js renders the configured support address into this link
    const el = document.querySelector('[data-cms="contact_email"]');
    return (el && el.textContent.trim()) || 'support@nglaccessories.com';
  }

  function showMessage(type, text) {
    messageDiv.textContent = text;
    messageDiv.className = `form-message ${type}`;
    messageDiv.style.display = 'flex';
  }

  // Show an error, then move focus to the offending field (focus-management)
  function fail(field, text) {
    showMessage('error', text);
    if (field) field.focus();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    messageDiv.style.display = 'none';

    const nameEl = document.getElementById('name');
    const emailEl = document.getElementById('email');
    const subjectEl = document.getElementById('subject');
    const messageEl = document.getElementById('message');
    const phoneEl = document.getElementById('phone');
    const honeypot = document.getElementById('company');

    const name = nameEl.value.trim();
    const email = emailEl.value.trim();
    const subject = subjectEl.value.trim();
    const message = messageEl.value.trim();
    const phone = phoneEl ? phoneEl.value.trim() : null;

    // Bot trap — a real user never fills this hidden field. Pretend success.
    if (honeypot && honeypot.value) {
      showMessage('success', 'Thank you! Your message has been sent.');
      form.reset();
      return;
    }

    // Validation with clear, recoverable errors; focus the first invalid field
    if (!name) return fail(nameEl, 'Please enter your name.');
    if (!email) return fail(emailEl, 'Please enter your email address.');
    if (!EMAIL_RE.test(email)) return fail(emailEl, 'That email address doesn’t look right — please check it.');
    if (!subject) return fail(subjectEl, 'Please add a subject so we know what it’s about.');
    if (!message) return fail(messageEl, 'Please write a message before sending.');

    submitBtn.classList.add('submitting');
    submitBtn.disabled = true;

    try {
      const { error } = await supabase
        .from('contact_messages')
        .insert([{ name, email, phone: phone || null, subject, message }]);

      if (error) throw error;

      showMessage('success', 'Thank you! Your message has been sent. We usually reply within 1–2 business days.');
      form.reset();
    } catch (err) {
      console.error('Error submitting contact form:', err);
      showMessage('error', `Sorry, something went wrong. Please try again, or email us directly at ${supportEmail()}.`);
    } finally {
      submitBtn.classList.remove('submitting');
      submitBtn.disabled = false;
    }
  });
});
