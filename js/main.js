/* ═══════════════════════════════════════
   GRATEFUL GROUNDED KIDS — Main JS
   Nav, scroll effects, mobile menu
   ═══════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  // ── STICKY HEADER ──
  const header = document.getElementById('site-header');
  if (header) {
    const onScroll = () => {
      header.classList.toggle('scrolled', window.scrollY > 40);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ── MOBILE MENU ──
  const toggle = document.getElementById('menu-toggle');
  const nav = document.getElementById('main-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('open');
      nav.classList.toggle('open');
    });
    // Close on link click
    nav.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        toggle.classList.remove('open');
        nav.classList.remove('open');
      });
    });
    // Close on outside click
    document.addEventListener('click', (e) => {
      if (nav.classList.contains('open') && !nav.contains(e.target) && !toggle.contains(e.target)) {
        toggle.classList.remove('open');
        nav.classList.remove('open');
      }
    });
  }

  // ── ACTIVE NAV LINK ──
  const currentPath = window.location.pathname.replace(/\/$/, '').replace(/\.html$/, '') || '/';
  document.querySelectorAll('.nav-link').forEach(link => {
    const href = link.getAttribute('href').replace(/\/$/, '').replace(/\.html$/, '') || '/';
    if (href === currentPath || (currentPath === '' && href === '/')) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // ── RESOURCE TABS ──
  const tabs = document.querySelectorAll('.resource-tab');
  const categories = document.querySelectorAll('.resource-category');
  if (tabs.length && categories.length) {
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.category;
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        categories.forEach(cat => {
          cat.classList.toggle('active', cat.id === target);
        });
      });
    });
  }

  // ── SMOOTH SCROLL for anchor links ──
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
});
