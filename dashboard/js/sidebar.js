// XActions Shared Sidebar — Comprehensive Multi-Platform Navigation
// by nichxbt

(function () {
  const sidebar = document.querySelector('.sidebar-left');
  if (!sidebar) return;

  const path = window.location.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';

  const icons = {
    home: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    admin: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    analytics: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    monitor: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    
    // Social
    facebook: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>',
    twitter: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l16 16M4 20L20 4"/></svg>',
    threads: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/></svg>',
    bluesky: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4c2.5 0 6 3 6 7.5S14.5 19 12 21c-2.5-2-6-5-6-9.5S9.5 4 12 4z"/><circle cx="12" cy="11.5" r="2.5"/></svg>',
    mastodon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="4"/><path d="M7 15V9l5 4 5-4v6"/></svg>',
    
    // E-Commerce
    shopee: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>',
    tiktokshop: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
    
    // Real Estate
    chotot: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>',
    batdongsan: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="9" y1="22" x2="9" y2="2"/><line x1="8" y1="6" x2="10" y2="6"/><line x1="14" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="10" y2="14"/><line x1="14" y1="14" x2="16" y2="14"/></svg>',
    
    // Recruitment
    topcv: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>',
    vietnamworks: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>',
    
    // Tools
    ai: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    run: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    docs: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
    github: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>'
  };

  const navSections = [
    {
      title: 'Overview',
      items: [
        { href: '/', label: 'Dashboard', icon: icons.home },
        { href: '/admin', label: 'Admin Ops', icon: icons.admin },
        { href: '/analytics-dashboard', label: 'Analytics', icon: icons.analytics },
        { href: '/monitor', label: 'Monitor', icon: icons.monitor },
      ]
    },
    {
      title: 'Social Crawlers',
      items: [
        { href: '/platforms/facebook', label: 'Facebook', icon: icons.facebook },
        { href: '/platforms/x', label: 'X / Twitter', icon: icons.twitter },
        { href: '/platforms/threads', label: 'Threads', icon: icons.threads },
        { href: '/platforms/tiktok', label: 'TikTok', icon: icons.tiktok },
        { href: '/platforms/bluesky', label: 'Bluesky', icon: icons.bluesky },
        { href: '/platforms/mastodon', label: 'Mastodon', icon: icons.mastodon },
      ]
    },
    {
      title: 'E-Commerce',
      items: [
        { href: '/platforms/shopee', label: 'Shopee', icon: icons.shopee },
        { href: '/platforms/tiktokshop', label: 'TikTok Shop', icon: icons.tiktokshop },
      ]
    },
    {
      title: 'Real Estate',
      items: [
        { href: '/platforms/chotot', label: 'Chợ Tốt', icon: icons.chotot },
        { href: '/platforms/batdongsan', label: 'Batdongsan', icon: icons.batdongsan },
      ]
    },
    {
      title: 'Recruitment & B2B',
      items: [
        { href: '/platforms/topcv', label: 'TopCV', icon: icons.topcv },
        { href: '/platforms/vietnamworks', label: 'VietnamWorks', icon: icons.vietnamworks },
        { href: '/platforms/linkedin', label: 'LinkedIn', icon: icons.linkedin },
      ]
    },
    {
      title: 'Tools & Docs',
      items: [
        { href: '/mcp', label: 'AI Tools / MCP', icon: icons.ai },
        { href: '/tweet-schedule', label: 'Schedule', icon: icons.calendar },
        { href: '/run', label: 'One-Click Scripts', icon: icons.run },
        { href: '/docs', label: 'Docs', icon: icons.docs },
        { href: 'https://github.com/nirholas/XActions', label: 'GitHub', icon: icons.github, external: true },
      ]
    }
  ];

  function isActive(href) {
    if (href === '/') return path === '/' || path === '' || path === '/index';
    const normalized = href.replace(/\.html$/, '').replace(/\/+$/, '');
    return path === normalized || path.startsWith(normalized + '/');
  }

  const navHtml = navSections.map(section => {
    const itemsHtml = section.items.map(item => {
      const active = isActive(item.href) ? ' active' : '';
      const ext = item.external ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${item.href}" class="nav-item${active}" aria-label="${item.label}"${ext}>
        <span class="nav-icon" aria-hidden="true">${item.icon}</span>
        <span>${item.label}</span>
      </a>`;
    }).join('\n        ');

    return `
      <div class="nav-section-title">${section.title}</div>
      ${itemsHtml}
    `;
  }).join('');

  sidebar.innerHTML = `
      <div class="logo">
        <a href="/" aria-label="XActions Home">
          <span class="logo-icon">⚡</span>
        </a>
      </div>
      <nav>
        ${navHtml}
      </nav>
      <a href="/run" class="action-btn">Run Script</a>
      <a href="/" class="user-menu" id="user-menu-link">
        <div class="user-avatar" id="user-avatar">⚡</div>
        <div class="user-info">
          <div class="user-name" id="user-display-name">XActions</div>
          <div class="user-handle" id="user-handle">@xactions</div>
        </div>
        <span class="user-menu-dots">···</span>
      </a>`;

  // Mobile Bottom Navigation Bar (rendered on narrow screens)
  const mobileNav = document.createElement('nav');
  mobileNav.className = 'xa-mobile-bottom-nav';
  mobileNav.setAttribute('aria-label', 'Mobile navigation');
  const bottomItems = [
    { href: '/', label: 'Home', icon: icons.home },
    { href: '/platforms/x', label: 'Platforms', icon: icons.twitter },
    { href: '/run', label: 'Run', icon: icons.run },
    { href: '/analytics-dashboard', label: 'Analytics', icon: icons.analytics },
    { href: '/docs', label: 'Docs', icon: icons.docs }
  ];
  mobileNav.innerHTML = bottomItems.map(item => {
    const active = isActive(item.href) ? ' active' : '';
    return `<a href="${item.href}" class="xa-mobile-nav-item${active}" aria-label="${item.label}">
      <span class="xa-mobile-nav-icon" aria-hidden="true">${item.icon}</span>
      <span class="xa-mobile-nav-label">${item.label}</span>
    </a>`;
  }).join('');
  document.body.appendChild(mobileNav);

  // Populate user info from stored auth token
  (function loadUserInfo() {
    const token = localStorage.getItem('authToken');
    if (!token) {
      // Not logged in — show GitHub link
      const link = document.getElementById('user-menu-link');
      if (link) {
        link.href = 'https://github.com/nirholas/XActions';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
      const uDisplay = document.getElementById('user-display-name');
      if (uDisplay) uDisplay.textContent = 'Star on GitHub';
      const uHandle = document.getElementById('user-handle');
      if (uHandle) uHandle.textContent = '100% open source';
      return;
    }

    // Decode JWT payload (base64) for immediate display — no network needed
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const username = payload.username || 'User';
      const uDisplay = document.getElementById('user-display-name');
      if (uDisplay) uDisplay.textContent = username;
      const uHandle = document.getElementById('user-handle');
      if (uHandle) uHandle.textContent = `@${username}`;
      const uAvatar = document.getElementById('user-avatar');
      if (uAvatar) uAvatar.textContent = username[0].toUpperCase();

      const link = document.getElementById('user-menu-link');
      if (link) {
        link.href = '/dashboard';
        link.removeAttribute('target');
        link.removeAttribute('rel');
      }
    } catch {
      // Malformed JWT — clear it and show logged-out state
      localStorage.removeItem('authToken');
      const uDisplay = document.getElementById('user-display-name');
      if (uDisplay) uDisplay.textContent = 'Sign in';
      const uHandle = document.getElementById('user-handle');
      if (uHandle) uHandle.textContent = '';
      const link = document.getElementById('user-menu-link');
      if (link) link.href = '/login';
    }

    // Fetch full user info from API for Twitter handle + avatar
    const apiBase = `${window.location.origin}/api`;

    fetch(`${apiBase}/user/me`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        const displayName = data.twitterUsername || data.username || 'User';
        const handle = data.twitterUsername ? `@${data.twitterUsername}` : `@${data.username}`;
        const uDisplay = document.getElementById('user-display-name');
        if (uDisplay) uDisplay.textContent = displayName;
        const uHandle = document.getElementById('user-handle');
        if (uHandle) uHandle.textContent = handle;
        if (data.twitterUsername) {
          const uAvatar = document.getElementById('user-avatar');
          if (uAvatar) uAvatar.textContent = data.twitterUsername[0].toUpperCase();
        }
      })
      .catch(() => { /* non-critical, keep JWT-decoded display */ });
  }());

  // Inject sidebar CSS overrides (wins cascade over inline <style> blocks)
  const style = document.createElement('style');
  style.textContent = `
    .logo { padding: 8px 12px; margin-bottom: 2px; }
    .logo a { display: inline-flex !important; align-items: center; justify-content: center; text-decoration: none; color: var(--text-primary); font-size: 1.8rem; padding: 10px; border-radius: 9999px; transition: background 0.2s; line-height: 1; gap: 0 !important; font-weight: normal !important; }
    .logo a:hover { background: var(--accent-light); }
    .logo-icon { font-size: 1.75rem; line-height: 1; }
    .nav-section-title {
      font-size: 0.6875rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-secondary, #71767b);
      padding: 12px 14px 4px;
      user-select: none;
    }
    .nav-item { display: flex; align-items: center; gap: 14px; padding: 8px 14px; border-radius: 9999px; font-size: 0.9375rem; font-weight: 500; color: var(--text-primary, #e7e9ea); text-decoration: none; transition: background 0.18s cubic-bezier(.22,1,.36,1), transform 0.14s cubic-bezier(.22,1,.36,1); margin-bottom: 2px; }
    .nav-item:hover { background: var(--bg-tertiary, #202327); transform: translateX(2px); color: #fff; }
    .nav-item.active { font-weight: 700; background: linear-gradient(135deg, rgba(29,155,240,0.18), rgba(34,211,238,0.10)); box-shadow: inset 0 0 0 1px rgba(29,155,240,0.4); color: var(--accent); }
    .nav-item.active .nav-icon { filter: drop-shadow(0 0 6px rgba(29,155,240,0.5)); }
    .nav-icon { width: 22px !important; height: 22px; display: flex !important; align-items: center; justify-content: center; flex-shrink: 0; font-size: unset !important; text-align: unset !important; }
    .nav-icon svg { width: 20px; height: 20px; }
    .nav-item.active .nav-icon svg { stroke-width: 2.5; stroke: var(--accent); }
    .action-btn { display: block; width: 90%; padding: 12px; background: linear-gradient(135deg, #1d9bf0, #22d3ee); color: white; text-decoration: none; border: none; border-radius: 9999px; font-size: 0.9375rem; font-weight: 700; text-align: center; cursor: pointer; box-shadow: 0 8px 24px -8px rgba(29,155,240,0.65); transition: transform 0.16s cubic-bezier(.22,1,.36,1), box-shadow 0.25s, filter 0.2s; margin: 12px 0; }
    .action-btn:hover { filter: brightness(1.06); transform: translateY(-2px); box-shadow: 0 14px 34px -8px rgba(29,155,240,0.75); }
    .sidebar-left nav { overflow-y: auto; flex: 1; padding-right: 4px; }
    .sidebar-left nav::-webkit-scrollbar { width: 4px; }
    .sidebar-left nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
    .user-menu { padding: 10px 12px; border-radius: 9999px; display: flex; align-items: center; gap: 10px; cursor: pointer; transition: background 0.2s; margin-bottom: 8px; text-decoration: none; color: var(--text-primary); }
    .user-menu:hover { background: var(--bg-tertiary, #202327); }
    .user-avatar { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, var(--accent) 0%, #7856ff 100%); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1rem; flex-shrink: 0; }
    .user-info { flex: 1; min-width: 0; }
    .user-name { font-weight: 700; font-size: 0.875rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .user-handle { color: var(--text-secondary); font-size: 0.8125rem; }
    .user-menu-dots { color: var(--text-primary); font-size: 1.1rem; }
    @media (max-width: 768px) {
      .nav-section-title { display: none; }
      .nav-item span:last-child, .user-info, .user-menu-dots { display: none; }
      .logo a { padding: 8px; }
      .nav-item { justify-content: center; padding: 10px; }
      .action-btn { width: 44px; height: 44px; padding: 0; font-size: 0; border-radius: 50%; }
      .action-btn::before { content: '⚡'; font-size: 1.3rem; }
      .user-menu { justify-content: center; }
    }
    .xa-mobile-bottom-nav { display: none; }
    @media (max-width: 640px) {
      .sidebar-left { display: none !important; }
      .main-content { padding-bottom: 72px; }
      .xa-mobile-bottom-nav {
        display: flex;
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        height: 60px;
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(16px) saturate(180%);
        border-top: 1px solid var(--border);
        z-index: 9999;
        justify-content: space-around;
        align-items: center;
        padding: 0 8px;
      }
      .xa-mobile-nav-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-decoration: none;
        color: var(--text-secondary);
        font-size: 0.6875rem;
        font-weight: 500;
        gap: 3px;
        flex: 1;
        height: 100%;
        transition: color 0.18s;
      }
      .xa-mobile-nav-item.active {
        color: var(--accent);
        font-weight: 700;
      }
      .xa-mobile-nav-icon svg {
        width: 22px;
        height: 22px;
      }
      .xa-mobile-nav-item.active .xa-mobile-nav-icon svg {
        stroke-width: 2.5;
        filter: drop-shadow(0 0 6px rgba(29, 155, 240, 0.5));
      }
    }`;
  document.head.appendChild(style);
})();
