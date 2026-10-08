/* ═══════════════════════════════════════
   GRATEFUL & GROUNDED KIDS — Main JS
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
    nav.querySelectorAll('a').forEach(link => {
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
    const showTab = (tab) => {
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      categories.forEach(cat => {
        cat.classList.toggle('active', cat.id === tab.dataset.category);
      });
      document.querySelectorAll('.dropdown-link').forEach(link => {
        link.classList.toggle('active', link.hash === '#' + tab.dataset.slug);
      });
    };
    // /resources#finances opens the Finances tab (the header dropdown links here)
    const showTabFromHash = () => {
      const tab = [...tabs].find(t => '#' + t.dataset.slug === window.location.hash);
      if (tab) showTab(tab);
      return tab;
    };
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        showTab(tab);
        history.replaceState(null, '', '#' + tab.dataset.slug);
      });
    });
    const tabBar = document.querySelector('.resource-tabs');
    window.addEventListener('hashchange', () => {
      if (showTabFromHash()) tabBar.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    if (showTabFromHash()) {
      tabBar.scrollIntoView({ behavior: 'instant', block: 'start' });
    } else {
      showTab(document.querySelector('.resource-tab.active') || tabs[0]);
    }
  }

  // ── HERO BACKGROUND VIDEO ──
  // Muted, looping YouTube player behind the home page banner. It stays invisible until
  // it is actually playing, so a blocked or failed autoplay just leaves the plain banner.
  const heroVideo = document.getElementById('hero-video');
  if (heroVideo && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const videoBg = heroVideo.closest('.hero-video-bg');
    window.onYouTubeIframeAPIReady = () => {
      new YT.Player(heroVideo, {
        videoId: heroVideo.dataset.videoId,
        playerVars: { autoplay: 1, mute: 1, controls: 0, playsinline: 1, rel: 0, disablekb: 1, iv_load_policy: 3 },
        events: {
          onReady: (e) => {
            const frame = e.target.getIframe();
            frame.setAttribute('tabindex', '-1');
            frame.setAttribute('aria-hidden', 'true');
            e.target.mute();
            e.target.playVideo();
            // Browsers hold back autoplay in a background tab; start it when the tab is shown
            document.addEventListener('visibilitychange', () => {
              if (!document.hidden) e.target.playVideo();
            });
            // Loop by jumping back just before the end, so YouTube's end screen never shows
            setInterval(() => {
              const duration = e.target.getDuration();
              if (duration && e.target.getCurrentTime() > duration - 1.5) e.target.seekTo(0);
            }, 500);
          },
          onStateChange: (e) => {
            // YouTube flashes its controls when playback starts; fade the video in after they clear
            if (e.data === YT.PlayerState.PLAYING) setTimeout(() => videoBg.classList.add('is-playing'), 3500);
          },
        },
      });
    };
    const api = document.createElement('script');
    api.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(api);
  }

  // ── SMOOTH SCROLL for anchor links ──
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      // "#" marks a link with no address yet: do nothing instead of jumping to the top
      if (anchor.getAttribute('href') === '#') { e.preventDefault(); return; }
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
});
