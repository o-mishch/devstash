'use strict';

/* ============================================================
   FOOTER YEAR
   ============================================================ */
document.getElementById('footer-year').textContent = new Date().getFullYear();

/* ============================================================
   NAVBAR: opacity on scroll + mobile menu
   ============================================================ */
const navbar = document.getElementById('navbar');
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobile-menu');

window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 20);
}, { passive: true });

hamburger.addEventListener('click', () => {
  mobileMenu.classList.toggle('open');
});

// Close mobile menu when a link inside it is clicked
mobileMenu.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => mobileMenu.classList.remove('open'));
});

/* ============================================================
   SCROLL FADE-IN (IntersectionObserver)
   ============================================================ */
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
);

// Observe all fade-in elements but stagger children inside grids
document.querySelectorAll('.fade-in').forEach((el, i) => {
  el.style.transitionDelay = `${(i % 6) * 80}ms`;
  observer.observe(el);
});

/* ============================================================
   CHAOS CANVAS ANIMATION
   ============================================================ */
(function initChaos() {
  const canvas = document.getElementById('chaos-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  // Symbols representing dev tools
  const symbols = [
    { label: 'N',  color: '#000000', bg: '#ffffff', font: 'bold' },  // Notion
    { label: '⌥',  color: '#24292f', bg: '#f6f8fa', font: 'bold' },  // GitHub
    { label: '#',  color: '#4a154b', bg: '#e01e5a', font: 'bold' },  // Slack
    { label: '⟩',  color: '#007acc', bg: '#1e1e1e', font: 'bold' },  // VS Code
    { label: '⊞',  color: '#ffffff', bg: '#3b82f6', font: 'normal' },// Tabs
    { label: '$',  color: '#22c55e', bg: '#0d1117', font: 'bold' },  // Terminal
    { label: '≡',  color: '#f59e0b', bg: '#1c1c1c', font: 'bold' },  // Text file
    { label: '⊕',  color: '#6366f1', bg: '#0f0f1a', font: 'bold' },  // Bookmark
  ];

  const ICON_R = 22;
  const SPEED = 0.6;
  let mouse = { x: -9999, y: -9999 };
  let icons = [];
  let raf;

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width  = rect.width;
    canvas.height = canvas.offsetHeight || 240;
    // Re-clamp positions after resize
    icons.forEach(ic => {
      ic.x = Math.min(Math.max(ic.x, ICON_R), canvas.width  - ICON_R);
      ic.y = Math.min(Math.max(ic.y, ICON_R), canvas.height - ICON_R);
    });
  }

  function spawn() {
    const W = canvas.width  || 400;
    const H = canvas.height || 240;
    icons = symbols.map((s, i) => {
      const angle = (i / symbols.length) * Math.PI * 2 + Math.random() * 0.5;
      const r = Math.min(W, H) * 0.3 * Math.random() + ICON_R * 2;
      return {
        ...s,
        x: W / 2 + Math.cos(angle) * r,
        y: H / 2 + Math.sin(angle) * r,
        vx: (Math.random() - 0.5) * SPEED * 2,
        vy: (Math.random() - 0.5) * SPEED * 2,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.015,
        scale: 1,
        scaleDir: Math.random() > 0.5 ? 1 : -1,
        scaleT: Math.random() * Math.PI * 2,
      };
    });
  }

  function tick() {
    raf = requestAnimationFrame(tick);
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    icons.forEach(ic => {
      // Mouse repulsion
      const dx = ic.x - mouse.x;
      const dy = ic.y - mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const repelRadius = 100;
      if (dist < repelRadius && dist > 0) {
        const force = ((repelRadius - dist) / repelRadius) * 3;
        ic.vx += (dx / dist) * force * 0.12;
        ic.vy += (dy / dist) * force * 0.12;
      }

      // Dampen velocity
      ic.vx *= 0.985;
      ic.vy *= 0.985;

      // Nudge toward center when too slow / too far
      const cx = W / 2, cy = H / 2;
      const fromCenter = Math.sqrt((ic.x - cx) ** 2 + (ic.y - cy) ** 2);
      const maxRadius = Math.min(W, H) * 0.44;
      if (fromCenter > maxRadius) {
        ic.vx += (cx - ic.x) * 0.002;
        ic.vy += (cy - ic.y) * 0.002;
      }

      // Random drift nudge
      if (Math.abs(ic.vx) < 0.1 && Math.abs(ic.vy) < 0.1) {
        ic.vx += (Math.random() - 0.5) * 0.3;
        ic.vy += (Math.random() - 0.5) * 0.3;
      }

      // Clamp speed
      const speed = Math.sqrt(ic.vx * ic.vx + ic.vy * ic.vy);
      const maxSpeed = 3;
      if (speed > maxSpeed) {
        ic.vx = (ic.vx / speed) * maxSpeed;
        ic.vy = (ic.vy / speed) * maxSpeed;
      }

      // Move
      ic.x += ic.vx;
      ic.y += ic.vy;

      // Bounce off walls
      if (ic.x < ICON_R) { ic.x = ICON_R; ic.vx = Math.abs(ic.vx); }
      if (ic.x > W - ICON_R) { ic.x = W - ICON_R; ic.vx = -Math.abs(ic.vx); }
      if (ic.y < ICON_R) { ic.y = ICON_R; ic.vy = Math.abs(ic.vy); }
      if (ic.y > H - ICON_R) { ic.y = H - ICON_R; ic.vy = -Math.abs(ic.vy); }

      // Rotation
      ic.rot += ic.rotV;

      // Scale pulse
      ic.scaleT += 0.025;
      ic.scale = 1 + Math.sin(ic.scaleT) * 0.06;

      // Draw
      ctx.save();
      ctx.translate(ic.x, ic.y);
      ctx.rotate(ic.rot);
      ctx.scale(ic.scale, ic.scale);

      // Circle bg
      ctx.beginPath();
      ctx.arc(0, 0, ICON_R, 0, Math.PI * 2);
      ctx.fillStyle = ic.bg;
      ctx.fill();

      // Label
      ctx.font = `${ic.font} 15px system-ui, sans-serif`;
      ctx.fillStyle = ic.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ic.label, 0, 0);

      ctx.restore();
    });
  }

  // Track mouse over the canvas element's bounding box
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
    mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
  });
  canvas.addEventListener('mouseleave', () => {
    mouse.x = -9999;
    mouse.y = -9999;
  });

  // Also track touch
  canvas.addEventListener('touchmove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches[0];
    mouse.x = (t.clientX - rect.left) * (canvas.width / rect.width);
    mouse.y = (t.clientY - rect.top) * (canvas.height / rect.height);
  }, { passive: true });

  window.addEventListener('resize', () => {
    resize();
  });

  resize();
  spawn();
  tick();
})();

/* ============================================================
   PRICING TOGGLE
   ============================================================ */
(function initPricing() {
  const btnMonthly = document.getElementById('btn-monthly');
  const btnYearly  = document.getElementById('btn-yearly');
  const proPrice   = document.getElementById('pro-price');
  const proPeriod  = document.getElementById('pro-period');
  const yearlyNote = document.getElementById('yearly-note');

  function setMonthly() {
    btnMonthly.classList.add('active');
    btnYearly.classList.remove('active');
    proPrice.textContent  = '$8';
    proPeriod.textContent = '/month';
    yearlyNote.style.display = 'none';
  }

  function setYearly() {
    btnYearly.classList.add('active');
    btnMonthly.classList.remove('active');
    proPrice.textContent  = '$6';
    proPeriod.textContent = '/month';
    yearlyNote.style.display = 'block';
  }

  btnMonthly.addEventListener('click', setMonthly);
  btnYearly.addEventListener('click', setYearly);
})();
