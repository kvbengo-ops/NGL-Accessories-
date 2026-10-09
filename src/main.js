/* ============================================================
   NGL ACCESSORIES — main.js v2
   Senior UX: Custom cursor · Clip-path reveals · Magnetic buttons
   Parallax · Marquee · Counter animation · All interactions
   ============================================================ */
import './style.css';
import { supabase } from './supabase.js';
import { initSearch } from './search.js';
import './cms-frontend.js';

const isFinePointer = window.matchMedia('(pointer: fine)').matches;

/* ──────────────────────────────────────────────────────────
   2. NAVBAR — scroll state + mobile drawer
────────────────────────────────────────────────────────── */
const navbar    = document.getElementById('navbar');
const navToggle = document.getElementById('nav-toggle');
const navDrawer = document.getElementById('nav-drawer');

window.addEventListener('scroll', () => {
  navbar?.classList.toggle('scrolled', window.scrollY > 50);
}, { passive: true });

function setNavOpen(open) {
  if (!navToggle || !navDrawer) return;
  navToggle.setAttribute('aria-expanded', String(open));
  navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  navToggle.setAttribute('aria-controls', navDrawer.id);
  navDrawer.classList.toggle('open', open);
  navDrawer.setAttribute('aria-hidden', String(!open));
  navDrawer.inert = !open;
}
setNavOpen(false);

navToggle?.addEventListener('click', () => {
  const open = navToggle.getAttribute('aria-expanded') === 'true';
  setNavOpen(!open);
});

navDrawer?.querySelectorAll('.drawer-link').forEach((link) => {
  link.addEventListener('click', () => {
    setNavOpen(false);
  });
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && navToggle?.getAttribute('aria-expanded') === 'true') {
    setNavOpen(false);
    navToggle.focus();
  }
});
document.addEventListener('click', (event) => {
  if (navbar && !navbar.contains(event.target)) setNavOpen(false);
});
window.matchMedia('(max-width: 1200px)').addEventListener('change', () => setNavOpen(false));

/* ──────────────────────────────────────────────────────────
   3. BANNER — auto-dismiss + session persist
────────────────────────────────────────────────────────── */
const banner      = document.getElementById('banner');
const bannerClose = document.getElementById('banner-close');

if (sessionStorage.getItem('ngl-banner-closed') === '1') {
  banner?.classList.add('hidden');
}
bannerClose?.addEventListener('click', () => {
  banner.classList.add('hidden');
  sessionStorage.setItem('ngl-banner-closed', '1');
});

/* ──────────────────────────────────────────────────────────
   4. HERO — clip-path reveal on load
────────────────────────────────────────────────────────── */
window.addEventListener('load', () => {
  document.body.classList.add('hero-loaded');
});

/* ──────────────────────────────────────────────────────────
   5. SCROLL REVEAL — IntersectionObserver (all reveal elements)
────────────────────────────────────────────────────────── */
const revealSelectors = [
  '.reveal-up-el',
  '.reveal-left-el',
  '.reveal-right-el',
  '.reveal-fade-el',
  '.reveal-line',
  '.reveal-line-fast',
];

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    });
  },
  { threshold: 0.1, rootMargin: '0px 0px -48px 0px' }
);

document.querySelectorAll(revealSelectors.join(', ')).forEach((el) => {
  revealObserver.observe(el);
});

/* ──────────────────────────────────────────────────────────
   6. PARALLAX — hero + story images
────────────────────────────────────────────────────────── */
const heroImg  = document.getElementById('hero-img');
const storyImg = document.getElementById('story-img');

function onScroll() {
  const y = window.scrollY;
  if (heroImg) {
    // Subtle zoom stays via CSS animation; just translateY for parallax
    const rate = y * 0.28;
    heroImg.style.transform = `translateY(${rate}px) scale(1.06)`;
  }
}

window.addEventListener('scroll', onScroll, { passive: true });

/* ──────────────────────────────────────────────────────────
   7. MAGNETIC BUTTONS
────────────────────────────────────────────────────────── */
function setupMagneticButtons() {
  if (!isFinePointer) return;

  document.querySelectorAll('.mag-btn').forEach((btn) => {
    const strength = 0.28;

    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const x = (e.clientX - rect.left - rect.width  / 2) * strength;
      const y = (e.clientY - rect.top  - rect.height / 2) * strength;
      btn.style.transform = `translate(${x}px, ${y}px)`;
      if (btn.classList.contains('btn--solid')) {
        btn.style.transform = `translate(${x}px, ${y}px) translateY(-2px)`;
      }
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.transform = '';
    });
  });
}
setupMagneticButtons();

/* ──────────────────────────────────────────────────────────
   8. MARQUEE — duplicate content for seamless loop
────────────────────────────────────────────────────────── */
const marqueeContent = document.getElementById('marquee-content');
if (marqueeContent) {
  // Duplicate for seamless scroll
  const clone = marqueeContent.cloneNode(true);
  clone.setAttribute('aria-hidden', 'true');
  clone.removeAttribute('id');
  marqueeContent.parentElement.appendChild(clone);
}

/* ──────────────────────────────────────────────────────────
   9. STATS COUNTER ANIMATION
────────────────────────────────────────────────────────── */
function animateCounter(el, target, duration = 1800) {
  const start = performance.now();
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  function step(now) {
    const elapsed  = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const current  = Math.round(easeOut(progress) * target);

    el.textContent = current >= 1000
      ? (current / 1000).toFixed(current % 1000 === 0 ? 0 : 1) + 'K'
      : current;

    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = target >= 1000
      ? (target / 1000).toFixed(0) + 'K'
      : target;
  }

  requestAnimationFrame(step);
}

const statsObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = parseInt(el.dataset.target, 10);
      if (isNaN(target)) return;
      animateCounter(el, target);
      statsObserver.unobserve(el);
    });
  },
  { threshold: 0.5 }
);

document.querySelectorAll('.stat-num[data-target]').forEach((el) => {
  statsObserver.observe(el);
});

/* ──────────────────────────────────────────────────────────
   10. NEWSLETTER FORM
────────────────────────────────────────────────────────── */
const newsletterForm  = document.getElementById('newsletter-form');
const newsletterEmail = document.getElementById('newsletter-email');

newsletterForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = newsletterEmail.value.trim();

  // Clear any previous error
  document.getElementById('nl-error-msg')?.remove();

  if (!isValidEmail(email)) {
    shake(newsletterEmail);
    return;
  }

  // Loading state
  const submitBtn = newsletterForm.querySelector('[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.style.opacity = '0.65';

  // Supabase returns errors in the response object, NOT as thrown exceptions —
  // we must inspect `error` rather than rely on try/catch.
  const { error } = await supabase
    .from('newsletter_subscribers')
    .insert([{ email }]);

  // 23505 = unique_violation → already subscribed, treat as success.
  if (error && error.code !== '23505') {
    console.error('Newsletter signup failed:', error);
    submitBtn.disabled = false;
    submitBtn.style.opacity = '';
    setNlError(
      error.code === '42P01'
        ? 'Subscriptions aren’t set up yet — please try again later.'
        : 'Sorry, something went wrong. Please try again.'
    );
    return;
  }

  // Animate form out, success in
  newsletterForm.style.transition = 'opacity 0.4s, transform 0.4s';
  newsletterForm.style.opacity = '0';
  newsletterForm.style.transform = 'translateY(12px)';

  setTimeout(() => {
    newsletterForm.innerHTML = `
      <div style="
        display:flex;flex-direction:column;align-items:center;
        gap:16px;padding:32px;text-align:center;
        animation:fadeInSuccess 0.7s cubic-bezier(0.16,1,0.3,1) forwards;
      ">
        <span class="material-symbols-outlined" style="font-size:36px;color:var(--gold-300);font-variation-settings:'FILL' 1">check_circle</span>
        <p style="font-family:var(--font-serif);font-size:24px;font-style:italic;color:rgba(245,241,235,0.9)">
          Welcome to the circle.
        </p>
        <p style="font-family:var(--font-sans);font-size:12px;font-weight:300;color:rgba(245,241,235,0.4);letter-spacing:0.08em">
          You'll be first to know about new drops &amp; private offers.
        </p>
      </div>
    `;
    newsletterForm.style.opacity = '1';
    newsletterForm.style.transform = 'none';
  }, 450);
});

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function setNlError(msg) {
  let errorEl = document.getElementById('nl-error-msg');
  if (!errorEl) {
    errorEl = document.createElement('p');
    errorEl.id = 'nl-error-msg';
    errorEl.setAttribute('role', 'alert');
    errorEl.style.cssText = [
      'font-family:var(--font-sans)',
      'font-size:11px',
      'color:var(--coral)',
      'letter-spacing:0.05em',
      'margin-top:-4px',
    ].join(';');
    newsletterEmail.closest('.nl-input-row').insertAdjacentElement('afterend', errorEl);
  }
  errorEl.textContent = msg;
}

function shake(el) {
  const kf = [
    { transform: 'translateX(0)' },
    { transform: 'translateX(-8px)' },
    { transform: 'translateX(8px)' },
    { transform: 'translateX(-5px)' },
    { transform: 'translateX(5px)' },
    { transform: 'translateX(0)' },
  ];
  el.animate(kf, { duration: 480, easing: 'ease-in-out' });
  el.focus();
  setNlError('Please enter a valid email address.');
}

/* Inject success animation keyframe */
const style = document.createElement('style');
style.textContent = `
  @keyframes fadeInSuccess {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
`;
document.head.appendChild(style);

/* ──────────────────────────────────────────────────────────
   11. SMOOTH ANCHOR SCROLL
────────────────────────────────────────────────────────── */
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener('click', (e) => {
    const id = anchor.getAttribute('href').slice(1);
    if (!id) return;
    const target = document.getElementById(id);
    if (target) {
      e.preventDefault();
      const navH = navbar?.offsetHeight ?? 68;
      const top  = target.getBoundingClientRect().top + window.scrollY - navH;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  });
});

/* ──────────────────────────────────────────────────────────
   12. FLIP CARD — click reveal + keyboard + ARIA + hover tilt
────────────────────────────────────────────────────────── */
const collectionNames = { 'flip-natural': 'Natural', 'flip-grace': 'Grace', 'flip-lush': 'Lush' };

document.querySelectorAll('.flip-card-inner').forEach((inner) => {
  const name = collectionNames[inner.id] || 'Collection';
  inner.setAttribute('tabindex', '0');
  inner.setAttribute('role', 'button');
  inner.setAttribute('aria-pressed', 'false');
  inner.setAttribute('aria-label', `${name} Collection — press to reveal details`);

  function setFlipped(flipped) {
    inner.classList.toggle('is-flipped', flipped);
    inner.setAttribute('aria-pressed', String(flipped));
    inner.setAttribute('aria-label',
      flipped
        ? `${name} Collection — press to close`
        : `${name} Collection — press to reveal details`
    );
  }

  inner.addEventListener('click', (e) => {
    if (e.target.closest('.flip-close') || e.target.closest('.flip-back-cta')) return;
    setFlipped(!inner.classList.contains('is-flipped'));
  });

  inner.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setFlipped(!inner.classList.contains('is-flipped'));
    }
    if (e.key === 'Escape') setFlipped(false);
  });

  inner.querySelector('.flip-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setFlipped(false);
  });

  inner.querySelector('.flip-back-cta')?.addEventListener('click', (e) => {
    e.stopPropagation();
  });
});

// Subtle 3D tilt on hover (only when not flipped)
if (isFinePointer) {
  document.querySelectorAll('.flip-card-inner').forEach((inner) => {
    inner.addEventListener('mousemove', (e) => {
      if (inner.classList.contains('is-flipped')) {
        inner.style.transform = 'rotateY(180deg)';
        return;
      }
      const rect = inner.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width  - 0.5;
      const y = (e.clientY - rect.top)  / rect.height - 0.5;
      inner.style.transform = `perspective(1000px) rotateY(${x * 6}deg) rotateX(${-y * 6}deg)`;
    });

    inner.addEventListener('mouseleave', () => {
      inner.style.transition = 'transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
      if (inner.classList.contains('is-flipped')) {
        inner.style.transform = 'rotateY(180deg)';
      } else {
        inner.style.transform = 'rotateY(0deg)';
      }
      setTimeout(() => { inner.style.transition = ''; }, 600);
    });
  });
}
/* ──────────────────────────────────────────────────────────
   13. CART STATE (HOMEPAGE)
────────────────────────────────────────────────────────── */
let cart = [];
function loadCart() {
  try {
    cart = JSON.parse(localStorage.getItem('ngl_cart') || '[]');
  } catch {
    cart = [];
  }
  const totalQty = cart.reduce((sum, item) => sum + item.quantity, 0);
  const el = document.querySelector('.cart-count');
  if (el) {
    el.textContent = totalQty;
    el.setAttribute('aria-label', `${totalQty} item${totalQty !== 1 ? 's' : ''}`);
  }
}
loadCart();

document.querySelector('.cart-btn')?.addEventListener('click', () => {
  window.location.href = '/checkout.html';
});

/* ──────────────────────────────────────────────────────────
   14. GLOBAL PRODUCT SEARCH (nav search icon)
────────────────────────────────────────────────────────── */
initSearch();
