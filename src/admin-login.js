/* ============================================================
   NGL Admin — Login Page Logic
   ============================================================ */
import { supabase } from '../src/supabase.js';

const form       = document.getElementById('login-form');
const emailEl    = document.getElementById('login-email');
const passEl     = document.getElementById('login-password');
const errorEl    = document.getElementById('login-error');
const errorMsg   = document.getElementById('login-error-msg');
const btnEl      = document.getElementById('login-btn');
const btnText    = document.getElementById('login-btn-text');
const spinner    = document.getElementById('login-spinner');
const arrowEl    = document.getElementById('login-arrow');
const eyeBtn     = document.getElementById('login-eye');
const eyeIcon    = document.getElementById('eye-icon');

// If already logged in, redirect to dashboard
supabase.auth.getSession().then(({ data: { session } }) => {
  if (session) window.location.href = '/admin/dashboard.html';
});

// Toggle password visibility
eyeBtn?.addEventListener('click', () => {
  const show = passEl.type === 'password';
  passEl.type = show ? 'text' : 'password';
  eyeIcon.textContent = show ? 'visibility_off' : 'visibility';
});

function setLoading(loading) {
  btnEl.disabled = loading;
  btnText.textContent = loading ? 'Signing in…' : 'Sign In';
  spinner.classList.toggle('hidden', !loading);
  arrowEl.classList.toggle('hidden', loading);
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorEl.classList.remove('hidden');
  emailEl.closest('.login-field').classList.add('field--error');
  passEl.closest('.login-field').classList.add('field--error');
}

function clearError() {
  errorEl.classList.add('hidden');
  document.querySelectorAll('.field--error').forEach(el => el.classList.remove('field--error'));
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const email    = emailEl.value.trim();
  const password = passEl.value;

  if (!email || !password) {
    showError('Please enter your email and password.');
    return;
  }

  setLoading(true);

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    setLoading(false);
    showError('Invalid email or password. Please try again.');
    passEl.value = '';
    return;
  }

  // Check admin record exists and is active
  const { data: adminRecord } = await supabase
    .from('admins')
    .select('is_active, role')
    .eq('id', data.user.id)
    .single();

  if (!adminRecord || !adminRecord.is_active) {
    await supabase.auth.signOut();
    setLoading(false);
    showError('Your admin account is inactive. Contact a superadmin.');
    return;
  }

  // Update last login
  await supabase.from('admins')
    .update({ last_login: new Date().toISOString() })
    .eq('id', data.user.id);

  window.location.href = '/admin/dashboard.html';
});

// Clear error on input
[emailEl, passEl].forEach(el => {
  el?.addEventListener('input', clearError);
});
