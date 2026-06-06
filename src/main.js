/* ============================================================
   NGL ACCESSORIES — main.js v2
   Senior UX: Custom cursor · Clip-path reveals · Magnetic buttons
   Parallax · Marquee · Counter animation · All interactions
   ============================================================ */
import './style.css';

/* ──────────────────────────────────────────────────────────
   1. LERP CUSTOM CURSOR
────────────────────────────────────────────────────────── */
const cursorDot  = document.getElementById('cursor-dot');
const cursorRing = document.getElementById('cursor-ring');

let mouseX = window.innerWidth  / 2;
let mouseY = window.innerHeight / 2;
let dotX = mouseX, dotY = mouseY;
let ringX = mouseX, ringY = mouseY;
let rafId;
const isFinePointer = window.matchMedia('(pointer: fine)').matches;

const lerp = (a, b, t) => a + (b - a) * t;

function animateCursor() {
  dotX  = lerp(dotX,  mouseX, 0.85);
  dotY  = lerp(dotY,  mouseY, 0.85);
  ringX = lerp(ringX, mouseX, 0.1);
  ringY = lerp(ringY, mouseY, 0.1);

  cursorDot.style.transform  = `translate3d(${dotX - 3.5}px, ${dotY - 3.5}px, 0)`;
  cursorRing.style.transform = `translate3d(${ringX - 18}px, ${ringY - 18}px, 0)`;

  rafId = requestAnimationFrame(animateCursor);
}

if (isFinePointer) {
  animateCursor();

  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  document.addEventListener('mouseleave', () => document.body.classList.add('cursor-hidden'));
  document.addEventListener('mouseenter', () => document.body.classList.remove('cursor-hidden'));

  // Grow cursor on interactive elements
  const hoverTargets = 'a, button, .collection-card, .testimonial-card, .pillar, input';
  document.querySelectorAll(hoverTargets).forEach((el) => {
    el.addEventListener('mouseenter', () => document.body.classList.add('cursor-hover'));
    el.addEventListener('mouseleave', () => document.body.classList.remove('cursor-hover'));
  });
}

/* ──────────────────────────────────────────────────────────
   2. NAVBAR — scroll state + mobile drawer
────────────────────────────────────────────────────────── */
const navbar    = document.getElementById('navbar');
const navToggle = document.getElementById('nav-toggle');
const navDrawer = document.getElementById('nav-drawer');

window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 50);
}, { passive: true });

navToggle?.addEventListener('click', () => {
  const open = navToggle.getAttribute('aria-expanded') === 'true';
  navToggle.setAttribute('aria-expanded', String(!open));
  navDrawer.classList.toggle('open', !open);
  navDrawer.setAttribute('aria-hidden', String(open));
});

navDrawer?.querySelectorAll('.drawer-link').forEach((link) => {
  link.addEventListener('click', () => {
    navToggle.setAttribute('aria-expanded', 'false');
    navDrawer.classList.remove('open');
    navDrawer.setAttribute('aria-hidden', 'true');
  });
});

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

newsletterForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const email = newsletterEmail.value.trim();

  if (!isValidEmail(email)) {
    shake(newsletterEmail);
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
          Check your inbox for a warm welcome from NGL.
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
   12. COLLECTION CARD — cursor hover effect
────────────────────────────────────────────────────────── */
if (isFinePointer) {
  document.querySelectorAll('.collection-card').forEach((card) => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width  - 0.5;
      const y = (e.clientY - rect.top)  / rect.height - 0.5;
      card.style.transform = `perspective(800px) rotateY(${x * 4}deg) rotateX(${-y * 4}deg)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
      card.style.transition = 'transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)';
      setTimeout(() => { card.style.transition = ''; }, 600);
    });
  });
}
