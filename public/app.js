/* ======================================================
   Domain Monitor - Frontend Application
   Features: WebSocket, Charts, Auth, Groups, Tags, Health
====================================================== */

/* ======================================================
   Theme Management
====================================================== */
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
}

function getThemeColors() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    textPrimary: isDark ? '#fafafa' : '#0f172a',
    textSecondary: isDark ? '#a1a1aa' : '#475569',
    textMuted: isDark ? '#71717a' : '#64748b',
    gridColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)',
    success: isDark ? '#30D158' : '#107C10',    // Apple/Microsoft green
    warning: isDark ? '#FF9F0A' : '#FFB900',    // Apple/Microsoft amber
    mildWarning: isDark ? '#FFD60A' : '#FFC107', // Apple yellow / Material amber
    danger: isDark ? '#FF453A' : '#D65532',      // Apple red / Fluent error
    safe: isDark ? '#0A84FF' : '#0078D4',        // Apple/Microsoft blue
    primary: isDark ? '#5E5CE6' : '#5856D6',     // Apple indigo
    // Chart colors - Enterprise palette inspired by Microsoft Fluent, Google Material, Apple HIG
    // Expiration chart: Expired, <30d, <90d, <180d, >180d
    chartColors: isDark
      ? ['#FF453A', '#FF9F0A', '#FFD60A', '#30D158', '#0A84FF']  // Apple dark mode
      : ['#D65532', '#FF9800', '#FFC107', '#107C10', '#0078D4'], // Fluent/Material light
    // Health chart: DNS OK, DNS Fail, HTTP OK, HTTP Fail, SSL Valid, SSL Invalid
    healthColors: isDark
      ? ['#30D158', '#FF453A', '#64D2FF', '#FF9F0A', '#BF5AF2', '#8E8E93']  // Apple dark
      : ['#107C10', '#D65532', '#0078D4', '#FF9800', '#9C27B0', '#607D8B']  // Fluent/Material
  };
}

function updateChartColors() {
  const colors = getThemeColors();

  // Update timeline chart
  if (state.charts.timeline) {
    state.charts.timeline.data.datasets[0].backgroundColor = colors.primary;
    state.charts.timeline.options.scales.x.grid.color = colors.gridColor;
    state.charts.timeline.options.scales.y.grid.color = colors.gridColor;
    state.charts.timeline.options.scales.x.ticks.color = colors.textMuted;
    state.charts.timeline.options.scales.y.ticks.color = colors.textMuted;
    state.charts.timeline.update('none');
  }

  // Update health chart
  if (state.charts.health) {
    state.charts.health.data.datasets[0].backgroundColor = colors.healthColors;
    state.charts.health.options.plugins.legend.labels.color = colors.textSecondary;
    state.charts.health.update('none');
  }
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);

  // Update charts colors
  updateChartColors();
}

// Initialize theme on load (before DOM ready to prevent flash)
initTheme();

/* ======================================================
   Error Boundary
====================================================== */
window.onerror = function(message, source, lineno, colno, error) {
  // Ignore ResizeObserver errors - these are non-critical browser warnings
  if (message && message.toString().includes('ResizeObserver')) {
    return true;
  }
  console.error('Global error:', { message, source, lineno, colno, error });
  showErrorBoundary(message);
  return true;
};

window.onunhandledrejection = function(event) {
  // Ignore ResizeObserver errors
  const reason = event.reason?.message || event.reason || '';
  if (reason.toString().includes('ResizeObserver')) {
    return;
  }
  console.error('Unhandled promise rejection:', event.reason);
  showNotification('An error occurred: ' + (reason || 'Unknown error'), 'error');
};

function showErrorBoundary(message) {
  const boundary = document.getElementById('error-boundary');
  const messageEl = document.getElementById('error-boundary-message');
  if (boundary && messageEl) {
    messageEl.textContent = message || 'An unexpected error occurred.';
    boundary.style.display = 'flex';
  }
}

/* ======================================================
   API Fetch Wrapper (handles 401 globally)
====================================================== */
async function apiFetch(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...options });

  if (res.status === 401) {
    state.authRequired = true;
    state.isAuthenticated = false;
    openModal('loginModal');
    throw new Error('Authentication required');
  }

  return res;
}

/* ======================================================
   Utilities
====================================================== */
const DAY_MS = 86400000;

// Active display timezone (IANA string). Updated when settings load.
let appTimezone = "UTC";

// All timestamps from SQLite come as either:
//   '2026-02-20 03:50:11'  (datetime('now') — UTC, no suffix, space separator)
//   '2026-02-20T03:41:20.115Z' (JS Date.toISOString() — already UTC with Z)
//   '2027-06-17T04:00:00'  (WHOIS date — UTC, no Z suffix)
// new Date() treats strings without a timezone as LOCAL time, which is wrong.
// parseUTC() normalises all formats to a proper UTC Date object.
function parseUTC(v) {
  if (!v) return null;
  let s = String(v).trim();
  // Already has timezone info — parse as-is
  if (s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  // Replace space separator with T, then append Z to mark as UTC
  s = s.replace(' ', 'T');
  if (!s.includes('T')) s += 'T00:00:00'; // date-only: treat as midnight UTC
  return new Date(s + 'Z');
}

const formatDate = v => {
  if (!v) return "-";
  try {
    const d = parseUTC(v);
    if (!d || isNaN(d)) return "-";
    return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: appTimezone }).format(d);
  } catch { return String(v); }
};
const formatDateTime = v => {
  if (!v) return "-";
  try {
    const d = parseUTC(v);
    if (!d || isNaN(d)) return "-";
    return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: appTimezone }).format(d);
  } catch { return String(v); }
};

const getDomainAge = created => {
  if (!created) return "—";
  const c = parseUTC(created), n = new Date();
  if (!c || isNaN(c)) return "—";
  let years = n.getFullYear() - c.getFullYear(), months = n.getMonth() - c.getMonth();
  if (months < 0) { years--; months += 12; }
  const parts = [];
  if (years) parts.push(`${years} yr${years > 1 ? "s" : ""}`);
  if (months) parts.push(`${months} month${months > 1 ? "s" : ""}`);
  return parts.join(" ") || "—";
};

const getExpiryDays = expiry => expiry ? Math.ceil((parseUTC(expiry) - new Date()) / DAY_MS) : null;

const getStatusClass = days => days === null ? "" : days <= 0 ? "status-bad" : days <= 14 ? "status-warn" : "status-ok";

const formatNS = (prev = [], now = []) => {
  const changed = prev.length && JSON.stringify([...prev].sort()) !== JSON.stringify([...now].sort());
  const html = now.length ? now.map(ns => {
    const [first, ...rest] = ns.split(".");
    return `<span class="ns-prefix">${escapeHTML(first)}</span>${rest.length ? "." + escapeHTML(rest.join(".")) : ""}`;
  }).join("<br>") : "-";
  return { html, changed };
};

// XSS Protection
const escapeHTML = (str) => {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
};

// CSS Color Sanitization - prevents CSS injection via color values
const sanitizeColor = (color) => {
  if (!color) return '#6b7280'; // Default gray
  // Only allow valid hex colors, rgb(), rgba(), hsl(), hsla(), or named colors
  const hexPattern = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
  const rgbPattern = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+))?\s*\)$/;
  const hslPattern = /^hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(,\s*(0|1|0?\.\d+))?\s*\)$/;
  const namedColors = /^(transparent|currentcolor|inherit|initial|unset|aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen)$/i;

  const trimmed = color.trim();
  if (hexPattern.test(trimmed) || rgbPattern.test(trimmed) || hslPattern.test(trimmed) || namedColors.test(trimmed)) {
    return trimmed;
  }
  return '#6b7280'; // Default gray for invalid colors
};

// URL Sanitization for safe navigation
const sanitizeUrl = (url) => {
  if (!url) return '#';
  try {
    const parsed = new URL(url, window.location.origin);
    // Only allow http, https protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '#';
    }
    return parsed.href;
  } catch {
    return '#';
  }
};

/* ======================================================
   UI Notifications
====================================================== */
function showNotification(message, type = 'info') {
  const container = document.getElementById('notification-container') || createNotificationContainer();

  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.innerHTML = `
    <i class="fa-solid fa-${type === 'error' ? 'circle-exclamation' : type === 'success' ? 'circle-check' : 'circle-info'}"></i>
    <span>${escapeHTML(message)}</span>
  `;

  container.appendChild(notification);

  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => notification.remove(), 300);
  }, CONFIG.NOTIFICATION_DURATION_MS);
}

function createNotificationContainer() {
  const container = document.createElement('div');
  container.id = 'notification-container';
  document.body.appendChild(container);
  return container;
}

function showLoading(show = true) {
  let loader = document.getElementById('global-loader');
  if (show) {
    if (!loader) {
      loader = document.createElement('div');
      loader.id = 'global-loader';
      loader.innerHTML = '<div class="spinner"></div><span>Loading...</span>';
      document.body.appendChild(loader);
    }
    loader.style.display = 'flex';
  } else {
    if (loader) loader.style.display = 'none';
  }
}

/* ======================================================
   State & Filters
====================================================== */
// Immutable configuration constants
const CONFIG = Object.freeze({
  WS_MAX_RECONNECT_DELAY: 30000,
  WS_BASE_DELAY: 1000,
  SEARCH_DEBOUNCE_MS: 300,
  NOTIFICATION_DURATION_MS: 5000,
  DEFAULT_PAGE_SIZE: 50,
  MAX_ACTIVITY_LOG_ITEMS: 15,
  MAX_HEALTH_HISTORY_ITEMS: 10
});

// Mutable application state
let state = {
  isRefreshing: false,
  refreshTotal: 0,
  refreshCompleted: 0,
  selectedDomains: new Set(),
  groups: [],
  tags: [],
  allDomains: [],
  currentDomainId: null,
  ws: null,
  wsReconnectAttempts: 0,
  isAuthenticated: false,
  authRequired: false,
  charts: {
    expiration: null,
    timeline: null,
    health: null,
    tags: null
  },
  chartsInitialized: false,
  importFile: null,
  pagination: {
    enabled: true,
    page: 1,
    limit: CONFIG.DEFAULT_PAGE_SIZE,
    total: 0,
    totalPages: 0
  }
};

const FILTERS = {
  search: '',
  status: 'all',
  registrar: 'all',
  group: 'all',
  sortBy: 'expiry',
  sortOrder: 'asc'
};

/* ======================================================
   Page Router (SPA)
====================================================== */
const PAGES = ['dashboard', 'domains', 'uptime', 'notifications', 'audit', 'settings', 'users'];

function navigateTo(page) {
  if (!PAGES.includes(page)) page = 'dashboard';
  PAGES.forEach(p => {
    const el = document.getElementById(`page-${p}`);
    if (el) el.classList.toggle('active', p === page);
  });
  document.querySelectorAll('.sidebar-nav-item[data-page]').forEach(a =>
    a.classList.toggle('active', a.dataset.page === page)
  );
  try { localStorage.setItem('currentPage', page); } catch {}
  history.replaceState(null, '', `#${page}`);
  onPageEnter(page);
}

function onPageEnter(page) {
  switch (page) {
    case 'dashboard':
      if (!state.chartsInitialized) { initCharts(); state.chartsInitialized = true; }
      load();
      loadActivityLog();
      break;
    case 'domains':
      load();
      break;
    case 'audit':
      loadAuditLog();
      break;
    case 'settings':
      loadSettings();
      break;
    case 'notifications':
      loadSettings();
      break;
    case 'users':
      loadUsers();
      break;
    case 'uptime':
      loadUptimePage();
      break;
  }
}

function initRouter() {
  const hash = window.location.hash.replace('#', '');
  const saved = (() => { try { return localStorage.getItem('currentPage'); } catch { return null; } })();
  navigateTo(PAGES.includes(hash) ? hash : (PAGES.includes(saved) ? saved : 'dashboard'));
  window.addEventListener('hashchange', () => {
    const h = window.location.hash.replace('#', '');
    if (PAGES.includes(h)) navigateTo(h);
  });
}

function toggleSidebar() {
  const sidebar = document.getElementById('app-sidebar');
  if (!sidebar) return;
  const collapsed = sidebar.classList.toggle('collapsed');
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  try { localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0'); } catch {}
}

function toggleMobileSidebar() {
  const sidebar = document.getElementById('app-sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (sidebar) sidebar.classList.toggle('mobile-open');
  if (overlay) overlay.classList.toggle('active');
}

function initSidebar() {
  try {
    if (localStorage.getItem('sidebarCollapsed') === '1') {
      document.getElementById('app-sidebar')?.classList.add('collapsed');
      document.body.classList.add('sidebar-collapsed');
    }
  } catch {}
  document.getElementById('app-sidebar')?.addEventListener('click', e => {
    const item = e.target.closest('.sidebar-nav-item[data-page]');
    if (item) { e.preventDefault(); navigateTo(item.dataset.page); }
  });
  // Mobile overlay click closes sidebar
  document.getElementById('sidebarOverlay')?.addEventListener('click', toggleMobileSidebar);
}

function loadUptimePage() {
  // Placeholder — uptime page loads its own data
  // Full implementation: load uptime summary stats here
}

/* ======================================================
   Filter Persistence (localStorage)
====================================================== */
function saveFiltersToStorage() {
  const filters = {
    search: FILTERS.search || '',
    status: FILTERS.status || 'all',
    group: FILTERS.group || 'all',
    registrar: FILTERS.registrar || 'all',
    sortBy: FILTERS.sortBy || 'expiry',
    sortOrder: FILTERS.sortOrder || 'asc',
  };
  try {
    localStorage.setItem('domainFilters', JSON.stringify(filters));
  } catch {}
}

function loadFiltersFromStorage() {
  try {
    const saved = localStorage.getItem('domainFilters');
    if (!saved) return;
    const filters = JSON.parse(saved);
    if (filters.search) FILTERS.search = filters.search;
    if (filters.status) FILTERS.status = filters.status;
    if (filters.group) FILTERS.group = filters.group;
    if (filters.registrar) FILTERS.registrar = filters.registrar;
    if (filters.sortBy) FILTERS.sortBy = filters.sortBy;
    if (filters.sortOrder) FILTERS.sortOrder = filters.sortOrder;
  } catch {}
}

function restoreFilterUI() {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = FILTERS.search || '';
  const filterStatus = document.getElementById('filterStatus');
  if (filterStatus) filterStatus.value = FILTERS.status || 'all';
  const filterRegistrar = document.getElementById('filterRegistrar');
  if (filterRegistrar) filterRegistrar.value = FILTERS.registrar || 'all';
  const filterGroup = document.getElementById('filterGroup');
  if (filterGroup) filterGroup.value = FILTERS.group || 'all';
  const sortBy = document.getElementById('sortBy');
  if (sortBy) sortBy.value = FILTERS.sortBy || 'expiry';
  const sortOrder = document.getElementById('sortOrder');
  if (sortOrder) sortOrder.value = FILTERS.sortOrder || 'asc';
}

/* ======================================================
   WebSocket Connection
====================================================== */
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  try {
    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = () => {
      console.log('WebSocket connected');
      state.wsReconnectAttempts = 0;
      updateConnectionStatus(true);
    };

    state.ws.onclose = () => {
      console.log('WebSocket disconnected');
      updateConnectionStatus(false);
      // Reconnect with exponential backoff (capped at max delay)
      const delay = Math.min(
        CONFIG.WS_BASE_DELAY * Math.pow(2, state.wsReconnectAttempts),
        CONFIG.WS_MAX_RECONNECT_DELAY
      );
      state.wsReconnectAttempts++;
      setTimeout(initWebSocket, delay);
    };

    state.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    state.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
      } catch (e) {
        console.error('Error parsing WebSocket message:', e);
      }
    };
  } catch (e) {
    console.error('Failed to initialize WebSocket:', e);
    updateConnectionStatus(false);
  }
}

function handleWebSocketMessage(message) {
  // Server sends data in 'payload' field
  const payload = message.payload || {};

  switch (message.type) {
    case 'refresh_progress':
      showRefreshProgress(true, payload.completed, payload.total);
      if (payload.completed === payload.total) {
        showRefreshProgress(false);
        state.isRefreshing = false;
        setRefreshButtonsDisabled(false);
        showNotification('Refresh complete!', 'success');
        load();
      }
      break;

    case 'refresh_complete':
      showRefreshProgress(false);
      state.isRefreshing = false;
      setRefreshButtonsDisabled(false);
      showNotification(`Refresh complete! ${payload.total} domains processed.`, 'success');
      load();
      break;

    case 'domain_updated':
      // Update single domain in table without full reload
      updateDomainInTable(payload);
      break;

    case 'health_update':
      // Update health indicator for domain
      updateHealthIndicator(payload.domainId, payload.health);
      break;

    case 'uptime_update':
      // Update uptime heartbeat for domain dynamically
      console.log('Received uptime update:', payload);
      updateUptimeHeartbeat(payload.domain_id, payload);
      break;

    case 'domain_added':
      // Reload table when a new domain is added (to show it with initial checks)
      showNotification(`Domain ${payload.domain} added, running initial checks...`, 'info');
      // Delay reload slightly to let initial checks complete
      setTimeout(() => load(), 1000);
      break;

    case 'error':
      showNotification(payload.message || 'An error occurred', 'error');
      break;

    case 'connected':
      // Connection confirmed
      break;

    default:
      console.log('Unknown WebSocket message type:', message.type);
  }
}

function updateConnectionStatus(connected) {
  const statusEl = document.getElementById('connectionStatus');
  if (!statusEl) return;
  // Preserve sidebar-specific classes so the element keeps its nav item styling
  const sidebarClasses = ['sidebar-nav-item', 'sidebar-connection'].filter(c => statusEl.classList.contains(c));
  statusEl.className = ['connection-status', ...sidebarClasses, connected ? 'connected' : 'disconnected'].join(' ');
  statusEl.title = connected ? 'Connected' : 'Disconnected';
  // Update the label text inside the element
  const label = statusEl.querySelector('.sidebar-nav-label');
  if (label) label.textContent = connected ? 'Connected' : 'Disconnected';
}

function updateDomainInTable(domain) {
  console.log('Received domain_updated:', domain);
  // Reload the table to show updated domain data
  // This is triggered when WHOIS refresh completes for a newly added domain
  load();
}

function updateHealthIndicator(domainId, health) {
  const row = document.querySelector(`tr[data-domain-id="${domainId}"]`);
  if (row) {
    const healthCell = row.querySelector('.health-indicator');
    if (healthCell) {
      healthCell.innerHTML = renderHealthIndicator(health);
    }
  }
}

function updateUptimeHeartbeat(domainId, uptimeCheck) {
  const row = document.querySelector(`tr[data-domain-id="${domainId}"]`);
  if (!row) return;

  // Find the uptime cell (it's the third cell after checkbox and domain)
  const uptimeCellTd = row.querySelector('td:nth-child(3)');
  if (!uptimeCellTd) return;

  let uptimeCell = uptimeCellTd.querySelector('.uptime-cell-content');

  // If no uptime cell content exists or it just shows "-", create proper structure
  if (!uptimeCell || uptimeCell.querySelector('.uptime-na')) {
    // Initialize the uptime display
    const domain = state.allDomains.find(d => d.id === domainId);
    if (domain) {
      // Initialize uptime data in memory
      if (!domain.uptime) {
        domain.uptime = {
          current_status: uptimeCheck.status,
          uptime_percentage: uptimeCheck.status === 'up' ? 100 : 0,
          avg_response_time: uptimeCheck.response_time_ms || 0,
          total_checks: 1,
          heartbeats: []
        };
        // Fill with 'none' beats and add the new one at the end
        for (let i = 0; i < 23; i++) {
          domain.uptime.heartbeats.push({ status: 'none' });
        }
        domain.uptime.heartbeats.push({ status: uptimeCheck.status });
      }

      // Re-render the cell
      uptimeCellTd.innerHTML = renderUptimeCell(domain.uptime);
      return;
    }
  }

  if (!uptimeCell) return;

  // Update the status indicator (class is uptime-status-indicator)
  const statusIndicator = uptimeCell.querySelector('.uptime-status-indicator');
  if (statusIndicator) {
    // Remove old status classes and add new one
    statusIndicator.classList.remove('up', 'down', 'unknown');
    statusIndicator.classList.add(uptimeCheck.status);
    statusIndicator.title = uptimeCheck.status.toUpperCase();
  }

  // Update the mini heartbeat bar - shift left and add new beat
  const heartbeatBar = uptimeCell.querySelector('.mini-heartbeat-bar');
  if (heartbeatBar) {
    // Remove the oldest beat (first child)
    const beats = heartbeatBar.querySelectorAll('.mini-beat');
    if (beats.length > 0) {
      beats[0].remove();
    }

    // Add new beat at the end
    const newBeat = document.createElement('div');
    newBeat.className = `mini-beat ${uptimeCheck.status}`;
    heartbeatBar.appendChild(newBeat);

    // Update domain data in memory for future reference
    const domain = state.allDomains.find(d => d.id === domainId);
    if (domain && domain.uptime) {
      // Shift heartbeats left
      domain.uptime.heartbeats.shift();
      domain.uptime.heartbeats.push({ status: uptimeCheck.status });
      domain.uptime.current_status = uptimeCheck.status;
      domain.uptime.total_checks++;

      // Recalculate percentage based on heartbeats
      const upCount = domain.uptime.heartbeats.filter(h => h.status === 'up').length;
      const totalCount = domain.uptime.heartbeats.filter(h => h.status !== 'none').length;
      if (totalCount > 0) {
        domain.uptime.uptime_percentage = Math.round((upCount / totalCount) * 10000) / 100;
        // Update percentage display (class is uptime-pct)
        const percentageEl = uptimeCell.querySelector('.uptime-pct');
        if (percentageEl) {
          percentageEl.textContent = `${domain.uptime.uptime_percentage.toFixed(1)}%`;
        }
      }
    }
  }
}

/* ======================================================
   Charts
====================================================== */
function initCharts() {
  try {
    const timelineCtx = document.getElementById('timelineChart')?.getContext('2d');
    const healthCtx = document.getElementById('healthChart')?.getContext('2d');

    const colors = getThemeColors();

  // Common chart options for compact display
  const compactLegendOptions = {
    position: 'right',
    labels: {
      color: colors.textSecondary,
      font: { size: 10 },
      boxWidth: 12,
      padding: 6
    }
  };

  if (timelineCtx) {
    state.charts.timeline = new Chart(timelineCtx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{
          label: 'Domains Expiring',
          data: [],
          backgroundColor: colors.primary,
          borderRadius: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            grid: { color: colors.gridColor },
            ticks: { color: colors.textMuted, font: { size: 9 } }
          },
          y: {
            grid: { color: colors.gridColor },
            ticks: { color: colors.textMuted, stepSize: 1, font: { size: 9 } }
          }
        },
        plugins: { legend: { display: false } }
      }
    });
  }

  // Health Status Chart
  if (healthCtx) {
    state.charts.health = new Chart(healthCtx, {
      type: 'doughnut',
      data: {
        labels: ['DNS OK', 'DNS Fail', 'HTTP OK', 'HTTP Fail', 'SSL Valid', 'SSL Invalid'],
        datasets: [{
          data: [0, 0, 0, 0, 0, 0],
          backgroundColor: colors.healthColors,
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: compactLegendOptions }
      }
    });
  }

  } catch (err) {
    console.error('Error initializing charts:', err);
    // Charts will gracefully degrade - app continues to function
  }
}

function updateCharts(domains) {
  // Update activity log regardless of domains
  loadActivityLog();

  if (!domains || !domains.length) {
    return;
  }

  // Timeline chart - group by month (next 6 months for better fit)
  const monthCounts = {};
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: appTimezone }).format(date);
    monthCounts[key] = 0;
  }

  domains.forEach(d => {
    if (!d.expiry_date) return;
    const expiry = parseUTC(d.expiry_date);
    if (!expiry || isNaN(expiry)) return;
    const key = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: appTimezone }).format(expiry);
    if (monthCounts.hasOwnProperty(key)) {
      monthCounts[key]++;
    }
  });

  if (state.charts.timeline) {
    state.charts.timeline.data.labels = Object.keys(monthCounts);
    state.charts.timeline.data.datasets[0].data = Object.values(monthCounts);
    state.charts.timeline.update();
  }

  // Health Status Chart
  const healthStats = { dnsOk: 0, dnsFail: 0, httpOk: 0, httpFail: 0, sslValid: 0, sslInvalid: 0 };
  domains.forEach(d => {
    if (d.health) {
      if (d.health.dns_resolved === true) healthStats.dnsOk++;
      else if (d.health.dns_resolved === false) healthStats.dnsFail++;

      if (d.health.http_status && d.health.http_status < 400) healthStats.httpOk++;
      else if (d.health.http_status && d.health.http_status >= 400) healthStats.httpFail++;

      if (d.health.ssl_valid === true) healthStats.sslValid++;
      else if (d.health.ssl_valid === false) healthStats.sslInvalid++;
    }
  });

  if (state.charts.health) {
    state.charts.health.data.datasets[0].data = [
      healthStats.dnsOk, healthStats.dnsFail,
      healthStats.httpOk, healthStats.httpFail,
      healthStats.sslValid, healthStats.sslInvalid
    ];
    state.charts.health.update();
  }
}

// Load activity log from audit API
async function loadActivityLog() {
  const logEl = document.getElementById('activityLog');
  if (!logEl) return;

  try {
    const res = await apiFetch(`/api/audit?limit=${CONFIG.MAX_ACTIVITY_LOG_ITEMS}`);
    if (!res.ok) {
      logEl.innerHTML = '<div class="no-activity">Could not load activity</div>';
      return;
    }

    const data = await res.json();
    // API returns { entries: [...], total, page, ... }
    const logs = data.entries || [];

    if (logs.length === 0) {
      logEl.innerHTML = '<div class="no-activity">No activity yet</div>';
      return;
    }

    logEl.innerHTML = logs.map(log => {
      const { icon, className, message, details } = formatAuditLog(log);
      const timeAgo = getTimeAgo(log.created_at);

      return `<div class="log-item ${className}">
        <div class="log-icon"><i class="fa-solid ${icon}"></i></div>
        <div class="log-content">
          <div class="log-message">${message}</div>
          ${details ? `<div class="log-details">${escapeHTML(details)}</div>` : ''}
        </div>
        <span class="log-time">${timeAgo}</span>
      </div>`;
    }).join('');

  } catch (err) {
    console.error('Error loading activity log:', err);
    logEl.innerHTML = '<div class="no-activity">Error loading activity</div>';
  }
}

// Format audit log entry for display
function formatAuditLog(log) {
  let icon = 'fa-circle-info';
  let className = 'log-system';
  let message = '';
  let details = '';

  const entity = log.entity_type;
  const action = log.action;
  const entityId = log.entity_id;

  switch (action) {
    case 'create':
      icon = 'fa-plus';
      className = 'log-create';
      if (entity === 'domain') {
        message = `Added domain <strong>${escapeHTML(entityId)}</strong>`;
      } else if (entity === 'group') {
        message = `Created group <strong>${escapeHTML(entityId)}</strong>`;
      } else if (entity === 'tag') {
        message = `Created tag <strong>${escapeHTML(entityId)}</strong>`;
      } else {
        message = `Created ${entity}: ${escapeHTML(entityId)}`;
      }
      break;

    case 'update':
      icon = 'fa-pen';
      className = 'log-update';
      if (entity === 'domain') {
        // Check if it's a WHOIS refresh or tag/group update
        if (log.new_value && log.new_value.includes('expiry_date')) {
          icon = 'fa-arrows-rotate';
          className = 'log-refresh';
          message = `Refreshed WHOIS for <strong>${escapeHTML(entityId)}</strong>`;
        } else if (log.new_value && log.new_value.includes('tag')) {
          message = `Updated tags on <strong>${escapeHTML(entityId)}</strong>`;
        } else if (log.new_value && log.new_value.includes('group')) {
          message = `Changed group for <strong>${escapeHTML(entityId)}</strong>`;
        } else {
          message = `Updated domain <strong>${escapeHTML(entityId)}</strong>`;
        }
      } else if (entity === 'settings') {
        message = `Updated settings`;
        details = entityId;
      } else if (entity === 'health') {
        icon = 'fa-heart-pulse';
        className = 'log-health';
        message = `Health check on <strong>${escapeHTML(entityId)}</strong>`;
      } else {
        message = `Updated ${entity}: ${escapeHTML(entityId)}`;
      }
      break;

    case 'delete':
      icon = 'fa-trash';
      className = 'log-delete';
      if (entity === 'domain') {
        message = `Deleted domain <strong>${escapeHTML(entityId)}</strong>`;
      } else if (entity === 'group') {
        message = `Deleted group <strong>${escapeHTML(entityId)}</strong>`;
      } else if (entity === 'tag') {
        message = `Deleted tag <strong>${escapeHTML(entityId)}</strong>`;
      } else {
        message = `Deleted ${entity}: ${escapeHTML(entityId)}`;
      }
      break;

    case 'refresh':
      icon = 'fa-arrows-rotate';
      className = 'log-refresh';
      if (entity === 'bulk') {
        message = `Bulk refresh completed`;
        details = entityId;
      } else {
        message = `Refreshed <strong>${escapeHTML(entityId)}</strong>`;
      }
      break;

    case 'health_check':
      icon = 'fa-heart-pulse';
      className = 'log-health';
      if (entity === 'bulk') {
        message = `Bulk health check completed`;
        details = entityId;
      } else {
        message = `Health check on <strong>${escapeHTML(entityId)}</strong>`;
      }
      break;

    case 'bulk_refresh':
      icon = 'fa-arrows-rotate';
      className = 'log-refresh';
      message = `Bulk WHOIS refresh completed`;
      details = entityId;
      break;

    case 'bulk_health':
      icon = 'fa-heart-pulse';
      className = 'log-health';
      message = `Bulk health check completed`;
      details = entityId;
      break;

    case 'import':
      icon = 'fa-file-import';
      className = 'log-create';
      message = `Imported domains`;
      details = entityId;
      break;

    case 'scheduled':
      icon = 'fa-clock';
      className = 'log-system';
      message = `Scheduled task: ${escapeHTML(entityId)}`;
      break;

    default:
      message = `${action} ${entity}: ${escapeHTML(entityId)}`;
  }

  return { icon, className, message, details };
}

// Helper function for relative time
function getTimeAgo(dateStr) {
  const date = parseUTC(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: appTimezone }).format(date);
}

/* ======================================================
   Selection Management
====================================================== */
function toggleDomainSelection(domain, checked) {
  if (checked) {
    state.selectedDomains.add(domain);
  } else {
    state.selectedDomains.delete(domain);
  }
  updateSelectionUI();
}

function toggleAllSelection(checked) {
  const checkboxes = document.querySelectorAll('.row-checkbox');
  checkboxes.forEach(cb => {
    const domain = cb.dataset.domain;
    cb.checked = checked;
    if (checked) {
      state.selectedDomains.add(domain);
    } else {
      state.selectedDomains.delete(domain);
    }
  });
  updateSelectionUI();
}

function clearSelection() {
  state.selectedDomains.clear();
  document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = false);
  document.getElementById('selectAll').checked = false;
  updateSelectionUI();
}

function updateSelectionUI() {
  const count = state.selectedDomains.size;
  const bar = document.getElementById('bulkActionsBar');
  const countEl = document.getElementById('selectedCount');

  if (count > 0) {
    bar.style.display = 'flex';
    countEl.textContent = `${count} selected`;
  } else {
    bar.style.display = 'none';
  }

  // Update select all checkbox state
  const allCheckboxes = document.querySelectorAll('.row-checkbox');
  const selectAll = document.getElementById('selectAll');
  if (allCheckboxes.length > 0) {
    selectAll.checked = count === allCheckboxes.length;
    selectAll.indeterminate = count > 0 && count < allCheckboxes.length;
  }

  // Update row highlighting
  document.querySelectorAll('#table tr').forEach(row => {
    const domain = row.dataset.domain;
    if (state.selectedDomains.has(domain)) {
      row.classList.add('selected');
    } else {
      row.classList.remove('selected');
    }
  });
}

/* ======================================================
   Copy to Clipboard
====================================================== */
async function copyToClipboard(text, buttonEl) {
  try {
    await navigator.clipboard.writeText(text);
    buttonEl.classList.add('copied');
    buttonEl.innerHTML = '<i class="fa-solid fa-check"></i>';
    setTimeout(() => {
      buttonEl.classList.remove('copied');
      buttonEl.innerHTML = '<i class="fa-regular fa-copy"></i>';
    }, 1500);
  } catch (err) {
    showNotification('Failed to copy to clipboard', 'error');
  }
}

/* ======================================================
   Filter Functions
====================================================== */
function getUniqueRegistrars(domains) {
  const registrars = [...new Set(domains.map(d => d.registrar).filter(Boolean))];
  return registrars.sort();
}

function matchesFilters(domain, filters) {
  const days = getExpiryDays(domain.expiry_date);

  // Search filter
  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    const domainName = domain.domain.toLowerCase();
    const registrar = (domain.registrar || '').toLowerCase();
    const nameServers = (domain.name_servers || []).join(' ').toLowerCase();

    if (!domainName.includes(searchLower) &&
        !registrar.includes(searchLower) &&
        !nameServers.includes(searchLower)) {
      return false;
    }
  }

  // Status filter
  if (filters.status !== 'all') {
    switch (filters.status) {
      case 'expired':
        if (days === null || days > 0) return false;
        break;
      case 'expiring30':
        if (days === null || days <= 0 || days > 30) return false;
        break;
      case 'expiring90':
        if (days === null || days <= 0 || days > 90) return false;
        break;
      case 'expiring180':
        if (days === null || days <= 0 || days > 180) return false;
        break;
      case 'safe':
        if (days === null || days <= 180) return false;
        break;
      case 'error':
        if (!domain.error) return false;
        break;
      case 'unchecked':
        if (domain.last_checked) return false;
        break;
    }
  }

  // Registrar filter
  if (filters.registrar !== 'all') {
    if (domain.registrar !== filters.registrar) return false;
  }

  // Group filter
  if (filters.group !== 'all') {
    if (filters.group === 'none') {
      if (domain.group_id) return false;
    } else {
      if (domain.group_id !== parseInt(filters.group)) return false;
    }
  }

  return true;
}

function sortDomains(domains, sortBy, sortOrder) {
  const sorted = [...domains];

  sorted.sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case 'domain':
        comparison = a.domain.localeCompare(b.domain);
        break;
      case 'registrar':
        comparison = (a.registrar || '').localeCompare(b.registrar || '');
        break;
      case 'expiry':
        const aExpiry = a.expiry_date ? parseUTC(a.expiry_date) : new Date(8640000000000000);
        const bExpiry = b.expiry_date ? parseUTC(b.expiry_date) : new Date(8640000000000000);
        comparison = aExpiry - bExpiry;
        break;
      case 'age':
        const aCreated = a.created_date ? parseUTC(a.created_date) : new Date();
        const bCreated = b.created_date ? parseUTC(b.created_date) : new Date();
        comparison = aCreated - bCreated;
        break;
      case 'lastChecked':
        const aChecked = a.last_checked ? parseUTC(a.last_checked) : new Date(0);
        const bChecked = b.last_checked ? parseUTC(b.last_checked) : new Date(0);
        comparison = aChecked - bChecked;
        break;
    }

    return sortOrder === 'asc' ? comparison : -comparison;
  });

  return sorted;
}

function updateResultCount(filtered, total) {
  let countEl = document.getElementById('result-count');
  if (!countEl) {
    countEl = document.createElement('div');
    countEl.id = 'result-count';
    countEl.className = 'result-count';
    document.querySelector('.table-wrapper').insertBefore(
      countEl,
      document.querySelector('table')
    );
  }

  if (filtered === total) {
    countEl.textContent = `Showing all ${total} domains`;
  } else {
    countEl.textContent = `Showing ${filtered} of ${total} domains`;
  }
}

function updateRegistrarFilter(domains) {
  const select = document.getElementById('filterRegistrar');
  if (!select) return;

  const registrars = getUniqueRegistrars(domains);
  const currentValue = select.value;

  select.innerHTML = '<option value="all">All Registrars</option>' +
    registrars.map(r => `<option value="${escapeHTML(r)}">${escapeHTML(r)}</option>`).join('');

  if (registrars.includes(currentValue)) {
    select.value = currentValue;
  }
}

function updateGroupFilter() {
  const select = document.getElementById('filterGroup');
  if (!select) return;

  const currentValue = select.value;

  select.innerHTML = '<option value="all">All Groups</option>' +
    '<option value="none">No Group</option>' +
    state.groups.map(g => `<option value="${g.id}">${escapeHTML(g.name)}</option>`).join('');

  if (currentValue) {
    select.value = currentValue;
  }
}

/* ======================================================
   Add Domain Dropdowns (Group & Tag)
====================================================== */
function updateAddDomainDropdowns() {
  const groupSelect = document.getElementById('addDomainGroup');
  const tagSelect = document.getElementById('addDomainTag');

  if (groupSelect) {
    groupSelect.innerHTML = '<option value="">No Group</option>' +
      state.groups.map(g => `<option value="${g.id}">${escapeHTML(g.name)}</option>`).join('');
  }

  if (tagSelect) {
    tagSelect.innerHTML = '<option value="">No Tag</option>' +
      state.tags.map(t => `<option value="${t.id}">${escapeHTML(t.name)}</option>`).join('');
  }
}

/* ======================================================
   Critical Alerts Widget
====================================================== */
function updateCriticalAlerts(alerts) {
  const container = document.getElementById('criticalAlerts');
  if (!container) return;

  if (!alerts || alerts.length === 0) {
    container.innerHTML = '<div class="no-alerts"><i class="fa-solid fa-check-circle"></i> No critical alerts</div>';
    return;
  }

  // Sort by severity (critical first) and limit to 10
  const sortedAlerts = alerts
    .sort((a, b) => (a.severity === 'critical' ? -1 : 1) - (b.severity === 'critical' ? -1 : 1))
    .slice(0, 10);

  container.innerHTML = sortedAlerts.map(alert => `
    <div class="alert-item ${alert.severity}">
      <i class="fa-solid ${alert.icon}"></i>
      <span class="alert-domain">${escapeHTML(alert.domain)}</span>
      <span class="alert-message">${escapeHTML(alert.message)}</span>
    </div>
  `).join('');
}

/* ======================================================
   Health Indicator
====================================================== */
function renderHealthIndicator(health) {
  if (!health) {
    return `<div class="health-indicator">
      <div class="health-dot-wrapper">
        <span class="health-dot-label">DNS</span>
        <span class="health-dot dns" title="DNS: Unknown"></span>
      </div>
      <div class="health-dot-wrapper">
        <span class="health-dot-label">HTTP</span>
        <span class="health-dot http" title="HTTP: Unknown"></span>
      </div>
      <div class="health-dot-wrapper">
        <span class="health-dot-label">SSL</span>
        <span class="health-dot ssl" title="SSL: Unknown"></span>
      </div>
    </div>`;
  }

  const dnsClass = health.dns_resolved ? 'ok' : 'error';
  const httpClass = health.http_status ? (health.http_status < 400 ? 'ok' : 'error') : '';
  const sslClass = health.ssl_valid === true ? 'ok' : (health.ssl_valid === false ? 'error' : '');

  return `<div class="health-indicator">
    <div class="health-dot-wrapper">
      <span class="health-dot-label">DNS</span>
      <span class="health-dot dns ${dnsClass}" title="DNS: ${health.dns_resolved ? 'OK' : 'Failed'}"></span>
    </div>
    <div class="health-dot-wrapper">
      <span class="health-dot-label">HTTP</span>
      <span class="health-dot http ${httpClass}" title="HTTP: ${health.http_status || 'N/A'}"></span>
    </div>
    <div class="health-dot-wrapper">
      <span class="health-dot-label">SSL</span>
      <span class="health-dot ssl ${sslClass}" title="SSL: ${health.ssl_valid ? 'Valid' : (health.ssl_valid === false ? 'Invalid' : 'N/A')}"></span>
    </div>
  </div>`;
}

/* ======================================================
   Uptime Cell Renderer
====================================================== */
function renderUptimeCell(uptime) {
  if (!uptime || uptime.total_checks === 0) {
    return `<div class="uptime-cell-content">
      <span class="uptime-na">-</span>
    </div>`;
  }

  const statusClass = uptime.current_status;
  const uptimeClass = uptime.uptime_percentage >= 99 ? 'good' : uptime.uptime_percentage >= 95 ? 'warning' : 'bad';

  // Generate mini heartbeat bar
  const heartbeatHtml = uptime.heartbeats.map(h =>
    `<div class="mini-beat ${h.status}"></div>`
  ).join('');

  return `<div class="uptime-cell-content">
    <div class="uptime-cell-header">
      <span class="uptime-status-indicator ${statusClass}" title="${statusClass.toUpperCase()}"></span>
      <span class="uptime-pct ${uptimeClass}">${uptime.uptime_percentage.toFixed(1)}%</span>
      ${uptime.avg_response_time ? `<span class="uptime-ms">${uptime.avg_response_time}ms</span>` : ''}
    </div>
    <div class="mini-heartbeat-bar">${heartbeatHtml}</div>
  </div>`;
}

/* ======================================================
   Tags Renderer
====================================================== */
function renderTags(tags) {
  if (!tags || tags.length === 0) return '-';
  return tags.map(tag => `<span class="tag-badge" style="background: ${sanitizeColor(tag.color)}">${escapeHTML(tag.name)}</span>`).join(' ');
}

/* ======================================================
   Nameserver Status Renderer
====================================================== */
function renderNsStatus(domainId, currentNs, prevNs, updatedAt, createdAt) {
  // Normalize arrays for comparison
  const current = (currentNs || []).map(ns => ns.toLowerCase()).sort();
  const prev = (prevNs || []).map(ns => ns.toLowerCase()).sort();

  // Format date for tooltip
  const formatStatusDate = (dateStr) => {
    if (!dateStr) return 'Unknown';
    const date = parseUTC(dateStr);
    if (!date || isNaN(date)) return 'Unknown';
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: appTimezone
    }).format(date);
  };

  // If no current nameservers, show pending status
  if (current.length === 0) {
    const sinceDate = createdAt ? `\nPending since: ${formatStatusDate(createdAt)}` : '';
    return `
      <div class="ns-status pending" title="Waiting for WHOIS data${sinceDate}">
        <i class="fa-solid fa-clock"></i>
        <span>Pending</span>
      </div>`;
  }

  // Check if nameservers have changed (only if we have previous NS to compare)
  const hasChanged = prev.length > 0 && JSON.stringify(current) !== JSON.stringify(prev);

  if (!hasChanged) {
    // No changes detected - stable status
    const currentNsFormatted = (currentNs || []).join('\n');
    const stableSince = updatedAt || createdAt;
    const sinceText = stableSince ? `\nStable since: ${formatStatusDate(stableSince)}` : '';

    // If no previous NS, this is initial data
    if (prev.length === 0) {
      return `
        <div class="ns-status stable" title="Initial nameserver data${sinceText}\n\nCurrent NS:\n${escapeHTML(currentNsFormatted)}">
          <i class="fa-solid fa-check-circle"></i>
          <span>Stable</span>
        </div>`;
    }

    // We have both current and previous NS, and they match
    return `
      <div class="ns-status stable" title="Nameservers unchanged${sinceText}\n\nCurrent NS:\n${escapeHTML(currentNsFormatted)}">
        <i class="fa-solid fa-check-circle"></i>
        <span>Stable</span>
      </div>`;
  }

  // Nameservers have changed - show warning with validate button
  const prevNsFormatted = (prevNs || []).join('\n');
  const currentNsFormatted = (currentNs || []).join('\n');
  const changedSince = updatedAt ? `Changed since: ${formatStatusDate(updatedAt)}\n\n` : '';
  const tooltip = `${changedSince}Previous NS:\n${prevNsFormatted}\n\nCurrent NS:\n${currentNsFormatted}`;

  return `
    <div class="ns-status-wrapper">
      <div class="ns-status changed" title="${escapeHTML(tooltip)}">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span>Changed</span>
      </div>
      <button class="ns-validate-btn" onclick="validateNsChange(${domainId})" title="Acknowledge change and mark as stable">
        <i class="fa-solid fa-check"></i>
      </button>
    </div>`;
}

/* ======================================================
   Load table & dashboard with filters
====================================================== */
async function load() {
  try {
    showLoading(true);

    // Build API URL with pagination and filters
    const params = new URLSearchParams();
    params.set('include', 'all');

    if (state.pagination.enabled) {
      params.set('page', String(state.pagination.page));
      params.set('limit', String(state.pagination.limit));
      params.set('sortBy', FILTERS.sortBy);
      params.set('sortOrder', FILTERS.sortOrder);

      if (FILTERS.search) {
        params.set('search', FILTERS.search);
      }
      if (FILTERS.status && FILTERS.status !== 'all') {
        params.set('status', FILTERS.status);
      }
      if (FILTERS.group && FILTERS.group !== 'all') {
        params.set('group', FILTERS.group);
      }
      if (FILTERS.registrar && FILTERS.registrar !== 'all') {
        params.set('registrar', FILTERS.registrar);
      }
    }

    // Load domains, groups, and tags in parallel
    const [domainsRes, groupsRes, tagsRes] = await Promise.all([
      fetch(`/api/domains?${params.toString()}`, { credentials: 'same-origin' }),
      fetch("/api/groups", { credentials: 'same-origin' }),
      fetch("/api/tags", { credentials: 'same-origin' })
    ]);

    if (!domainsRes.ok) {
      const error = await domainsRes.json().catch(() => ({ message: 'Failed to load domains' }));
      throw new Error(error.message);
    }

    const domainsData = await domainsRes.json();

    // Handle paginated vs non-paginated response
    let displayDomains;
    let totalDomains;

    if (state.pagination.enabled && domainsData.data) {
      // Paginated response
      displayDomains = domainsData.data;
      state.allDomains = displayDomains;
      state.pagination.total = domainsData.total;
      state.pagination.totalPages = domainsData.totalPages;
      state.pagination.page = domainsData.page;
      totalDomains = domainsData.total;
    } else {
      // Non-paginated response (backward compatibility)
      displayDomains = domainsData;
      state.allDomains = domainsData;
      totalDomains = domainsData.length;
    }

    if (groupsRes.ok) {
      state.groups = await groupsRes.json();
    }

    if (tagsRes.ok) {
      state.tags = await tagsRes.json();
    }

    // Update group filter dropdown
    updateGroupFilter();

    // Update add-domain dropdowns
    updateAddDomainDropdowns();

    // For paginated mode, server already filtered/sorted
    // For non-paginated mode, apply client-side filters
    let filteredDomains = displayDomains;
    if (!state.pagination.enabled) {
      filteredDomains = displayDomains.filter(d => matchesFilters(d, FILTERS));
      filteredDomains = sortDomains(filteredDomains, FILTERS.sortBy, FILTERS.sortOrder);
    }

    // Calculate stats - for paginated mode, we need to fetch stats separately or use total
    // For now, calculate from what we have (in paginated mode, this will be per-page stats)
    const statsSource = state.pagination.enabled ? filteredDomains : displayDomains;
    const stats = { expired: 0, exp15: 0, exp30: 0, exp90: 0, exp180: 0, unchecked: 0 };
    const uptimeStats = { up: 0, down: 0, unknown: 0 };
    const criticalAlerts = [];

    statsSource.forEach(d => {
      if (!d.last_checked) {
        stats.unchecked++;
      }
      const days = getExpiryDays(d.expiry_date);
      if (days !== null) {
        if (days <= 0) {
          stats.expired++;
          criticalAlerts.push({ type: 'expired', domain: d.domain, message: 'Domain expired', icon: 'fa-calendar-xmark', severity: 'critical' });
        } else {
          if (days <= 15) {
            stats.exp15++;
            criticalAlerts.push({ type: 'expiring', domain: d.domain, message: `Expires in ${days} days`, icon: 'fa-calendar-exclamation', severity: 'warning' });
          }
          if (days <= 30) stats.exp30++;
          if (days <= 90) stats.exp90++;
          if (days <= 180) stats.exp180++;
        }
      }

      // Uptime status
      if (d.uptime && d.uptime.current_status) {
        if (d.uptime.current_status === 'up') {
          uptimeStats.up++;
        } else if (d.uptime.current_status === 'down') {
          uptimeStats.down++;
          criticalAlerts.push({ type: 'down', domain: d.domain, message: 'Site is down', icon: 'fa-server', severity: 'critical' });
        } else {
          uptimeStats.unknown++;
        }
      } else {
        uptimeStats.unknown++;
      }

      // NS change alerts
      const currentNs = (d.name_servers || []).map(ns => ns.toLowerCase()).sort();
      const prevNs = (d.name_servers_prev || []).map(ns => ns.toLowerCase()).sort();
      if (prevNs.length > 0 && JSON.stringify(currentNs) !== JSON.stringify(prevNs)) {
        criticalAlerts.push({ type: 'ns-changed', domain: d.domain, message: 'Nameservers changed', icon: 'fa-server', severity: 'warning' });
      }

      // Health alerts
      if (d.health) {
        if (!d.health.dns_resolved) {
          criticalAlerts.push({ type: 'dns-fail', domain: d.domain, message: 'DNS resolution failed', icon: 'fa-globe', severity: 'critical' });
        }
        if (d.health.ssl_valid === false) {
          criticalAlerts.push({ type: 'ssl-invalid', domain: d.domain, message: 'SSL certificate invalid', icon: 'fa-lock-open', severity: 'warning' });
        }
      }
    });

    const tbody = document.getElementById("table");
    tbody.innerHTML = filteredDomains.map(d => {
      const days = getExpiryDays(d.expiry_date);
      const statusClass = getStatusClass(days);
      const { html: nsHTML, changed: nsChanged } = formatNS(d.name_servers_prev, d.name_servers);
      const hasError = d.error ? 'has-error' : '';
      const isSelected = state.selectedDomains.has(d.domain);
      const group = d.group_id ? state.groups.find(g => g.id === d.group_id) : null;

      return `
        <tr class="${days !== null && days <= 0 ? "expired" : ""} ${hasError} ${isSelected ? 'selected' : ''}" data-domain="${escapeHTML(d.domain)}" data-domain-id="${d.id}">
          <td class="checkbox-cell">
            <input type="checkbox" class="row-checkbox" data-domain="${escapeHTML(d.domain)}" ${isSelected ? 'checked' : ''}>
          </td>
          <td>
            <div class="domain-cell">
              <span class="domain-name" onclick="openDomainDetails(${d.id})" style="cursor: pointer;">${escapeHTML(d.domain)}</span>
              <button class="copy-btn" data-action="copy" title="Copy domain"><i class="fa-regular fa-copy"></i></button>
              ${d.error ? '<i class="fa-solid fa-triangle-exclamation error-icon" title="' + escapeHTML(d.error) + '"></i>' : ''}
            </div>
          </td>
          <td class="uptime-cell">${renderUptimeCell(d.uptime)}</td>
          <td>${renderHealthIndicator(d.health)}</td>
          <td>${escapeHTML(d.registrar) || "-"}</td>
          <td>${formatDate(d.expiry_date)}</td>
          <td class="${statusClass}">${days ?? "-"}${days !== null ? " days" : ""}</td>
          <td class="ns-servers">${nsHTML}</td>
          <td class="ns-status-cell">${renderNsStatus(d.id, d.name_servers, d.name_servers_prev, d.updated_at, d.created_at)}</td>
          <td>${formatDateTime(d.last_checked)}</td>
          <td class="actions-cell">
            <button class="refresh-btn" data-action="refresh" title="Refresh WHOIS"><i class="fa-solid fa-arrows-rotate"></i></button>
            <button class="health-btn" data-action="health" title="Check Health"><i class="fa-solid fa-heart-pulse"></i></button>
            <button class="delete-btn" data-action="delete" title="Delete domain"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>`;
    }).join("");

    // Update selection UI after render
    updateSelectionUI();

    // Update result count and pagination
    if (state.pagination.enabled) {
      updateResultCount(filteredDomains.length, totalDomains);
      updatePaginationControls();
    } else {
      updateResultCount(filteredDomains.length, totalDomains);
    }

    // Update dashboard
    document.getElementById("totalDomains").innerText = totalDomains;
    document.getElementById("expired").innerText = stats.expired;
    document.getElementById("exp15").innerText = stats.exp15;
    document.getElementById("exp30").innerText = stats.exp30;
    document.getElementById("exp90").innerText = stats.exp90;
    document.getElementById("exp180").innerText = stats.exp180;

    // Update uptime status widget
    const sitesUpEl = document.getElementById("sitesUpCount");
    const sitesDownEl = document.getElementById("sitesDownCount");
    const sitesUnknownEl = document.getElementById("sitesUnknownCount");
    if (sitesUpEl) sitesUpEl.textContent = uptimeStats.up;
    if (sitesDownEl) sitesDownEl.textContent = uptimeStats.down;
    if (sitesUnknownEl) sitesUnknownEl.textContent = uptimeStats.unknown;

    // Update critical alerts widget
    updateCriticalAlerts(criticalAlerts);

    // Highlight critical stat card if there are expired domains
    const expiredCard = document.getElementById("expiredCard");
    if (expiredCard) {
      if (stats.expired > 0) {
        expiredCard.classList.add("has-items");
      } else {
        expiredCard.classList.remove("has-items");
      }
    }

    // Update sort header indicators
    updateSortHeaders();

    // Update registrar dropdown - for paginated mode, this only shows current page registrars
    updateRegistrarFilter(filteredDomains);

    // Update charts
    updateCharts(filteredDomains);

    showLoading(false);

  } catch (err) {
    console.error("Error loading domains:", err);
    showNotification(err.message || "Failed to load domains", 'error');
    showLoading(false);
  }
}

/* ======================================================
   Filter Event Handlers
====================================================== */
function applyFilters() {
  FILTERS.search = document.getElementById('searchInput')?.value.trim().toLowerCase() || '';
  FILTERS.status = document.getElementById('filterStatus')?.value || 'all';
  FILTERS.registrar = document.getElementById('filterRegistrar')?.value || 'all';
  FILTERS.group = document.getElementById('filterGroup')?.value || 'all';
  FILTERS.sortBy = document.getElementById('sortBy')?.value || 'expiry';
  FILTERS.sortOrder = document.getElementById('sortOrder')?.value || 'asc';

  // Reset to first page when filters change
  state.pagination.page = 1;

  saveFiltersToStorage();
  load();
}

function clearFilters() {
  FILTERS.search = '';
  FILTERS.status = 'all';
  FILTERS.registrar = 'all';
  FILTERS.group = 'all';
  FILTERS.sortBy = 'expiry';
  FILTERS.sortOrder = 'asc';

  document.getElementById('searchInput').value = '';
  document.getElementById('filterStatus').value = 'all';
  document.getElementById('filterRegistrar').value = 'all';
  document.getElementById('filterGroup').value = 'all';
  document.getElementById('sortBy').value = 'expiry';
  document.getElementById('sortOrder').value = 'asc';

  // Reset to first page
  state.pagination.page = 1;

  try { localStorage.removeItem('domainFilters'); } catch {}
  load();
}

function updateSortHeaders() {
  document.querySelectorAll('.sortable-header').forEach(th => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (th.dataset.sort === FILTERS.sortBy) {
      th.classList.add(FILTERS.sortOrder === 'asc' ? 'sorted-asc' : 'sorted-desc');
    }
  });
}

function handleHeaderSort(sortKey) {
  if (FILTERS.sortBy === sortKey) {
    FILTERS.sortOrder = FILTERS.sortOrder === 'asc' ? 'desc' : 'asc';
  } else {
    FILTERS.sortBy = sortKey;
    FILTERS.sortOrder = 'asc';
  }

  // Sync with dropdown
  document.getElementById('sortBy').value = FILTERS.sortBy;
  document.getElementById('sortOrder').value = FILTERS.sortOrder;

  // Reset to first page when sorting changes
  state.pagination.page = 1;

  load();
}

/* ======================================================
   Pagination Controls
====================================================== */
function updatePaginationControls() {
  const controls = document.getElementById('paginationControls');
  if (!controls) return;

  const { page, limit, total, totalPages } = state.pagination;

  // Show/hide pagination controls based on total items
  if (total <= limit && page === 1) {
    controls.style.display = 'none';
    return;
  }
  controls.style.display = 'flex';

  // Update info text
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);
  const infoEl = document.getElementById('paginationInfo');
  if (infoEl) {
    infoEl.textContent = `Showing ${start}-${end} of ${total} domains`;
  }

  // Update page size selector
  const pageSizeEl = document.getElementById('pageSize');
  if (pageSizeEl) {
    pageSizeEl.value = String(limit);
  }

  // Enable/disable navigation buttons
  document.getElementById('paginationFirst').disabled = page <= 1;
  document.getElementById('paginationPrev').disabled = page <= 1;
  document.getElementById('paginationNext').disabled = page >= totalPages;
  document.getElementById('paginationLast').disabled = page >= totalPages;

  // Generate page numbers
  const pagesContainer = document.getElementById('paginationPages');
  if (pagesContainer) {
    pagesContainer.innerHTML = generatePageNumbers(page, totalPages);
  }
}

function generatePageNumbers(currentPage, totalPages) {
  if (totalPages <= 1) return '';

  const pages = [];
  const maxVisible = 5;

  let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);

  // Adjust if we're near the end
  if (endPage - startPage < maxVisible - 1) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }

  // First page
  if (startPage > 1) {
    pages.push(`<button class="btn btn-page" onclick="goToPage(1)">1</button>`);
    if (startPage > 2) {
      pages.push('<span class="pagination-ellipsis">...</span>');
    }
  }

  // Page numbers
  for (let i = startPage; i <= endPage; i++) {
    if (i === currentPage) {
      pages.push(`<button class="btn btn-page active">${i}</button>`);
    } else {
      pages.push(`<button class="btn btn-page" onclick="goToPage(${i})">${i}</button>`);
    }
  }

  // Last page
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      pages.push('<span class="pagination-ellipsis">...</span>');
    }
    pages.push(`<button class="btn btn-page" onclick="goToPage(${totalPages})">${totalPages}</button>`);
  }

  return pages.join('');
}

function goToPage(page) {
  const { totalPages } = state.pagination;

  if (page < 1 || page > totalPages) return;
  if (page === state.pagination.page) return;

  state.pagination.page = page;
  load();
}

function changePageSize(size) {
  const newLimit = parseInt(size, 10);
  if (isNaN(newLimit) || newLimit < 1) return;

  state.pagination.limit = newLimit;
  state.pagination.page = 1; // Reset to first page
  load();
}

function jumpToPage(value) {
  const page = parseInt(value, 10);
  if (isNaN(page)) return;
  const clamped = Math.min(Math.max(1, page), state.pagination.totalPages || 1);
  const input = document.getElementById('pageJumpInput');
  if (input) input.value = '';
  goToPage(clamped);
}

/* ======================================================
   CRUD Actions
====================================================== */
async function addDomain() {
  const input = document.getElementById("domainInput");
  const groupSelect = document.getElementById("addDomainGroup");
  const tagSelect = document.getElementById("addDomainTag");

  const domain = input.value.trim();
  const groupId = groupSelect?.value ? parseInt(groupSelect.value, 10) : null;
  const tagId = tagSelect?.value ? parseInt(tagSelect.value, 10) : null;

  if (!domain) {
    showNotification("Please enter a domain", 'error');
    return;
  }

  try {
    showLoading(true);
    const res = await fetch("/api/domains", {
      method: "POST",
      credentials: 'same-origin',
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ domain, group_id: groupId })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.message || "Failed to add domain");
    }

    // If a tag was selected, add it to the domain
    if (tagId && data.id) {
      try {
        await apiFetch(`/api/domains/${data.id}/tags/${tagId}`, { method: 'POST' });
      } catch (tagErr) {
        console.error('Failed to add tag:', tagErr);
      }
    }

    input.value = "";
    if (groupSelect) groupSelect.value = "";
    if (tagSelect) tagSelect.value = "";
    showNotification(`Domain ${domain} added successfully`, 'success');
    await load();
  } catch (err) {
    console.error("Error adding domain:", err);
    showNotification(err.message, 'error');
    showLoading(false);
  }
}

async function deleteDomain(domain) {
  if (!confirm(`Delete ${domain}?`)) return;

  try {
    showLoading(true);
    const res = await apiFetch(`/api/domains/${encodeURIComponent(domain)}`, { method: "DELETE" });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || "Failed to delete domain");
    }

    // Remove from selection if it was selected
    state.selectedDomains.delete(domain);

    showNotification(`Domain ${domain} deleted`, 'success');
    await load();
  } catch (err) {
    console.error("Error deleting domain:", err);
    showNotification(err.message, 'error');
    showLoading(false);
  }
}

/* ======================================================
   Validate NS Change (acknowledge and reset to stable)
====================================================== */
async function validateNsChange(domainId) {
  try {
    const res = await apiFetch(`/api/domains/${domainId}/validate-ns`, { method: 'POST' });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to validate NS change');
    }

    showNotification('Nameserver change validated', 'success');
    await load();
  } catch (err) {
    console.error('Error validating NS change:', err);
    showNotification(err.message, 'error');
  }
}

/* ======================================================
   Bulk Delete & Refresh Selected
====================================================== */
async function deleteSelected() {
  const domains = Array.from(state.selectedDomains);

  if (domains.length === 0) {
    showNotification("No domains selected", 'info');
    return;
  }

  const confirmMsg = `Delete ${domains.length} domain(s)?\n\nThis action cannot be undone.`;
  if (!confirm(confirmMsg)) return;

  showLoading(true);
  let deleted = 0, failed = 0;

  for (const domain of domains) {
    try {
      const res = await apiFetch(`/api/domains/${encodeURIComponent(domain)}`, { method: "DELETE" });
      if (res.ok) {
        deleted++;
        state.selectedDomains.delete(domain);
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  let message = `Deleted ${deleted} domain(s)`;
  if (failed) message += `, ${failed} failed`;

  showNotification(message, deleted > 0 ? 'success' : 'error');
  await load();
}

async function refreshSelected() {
  const domains = Array.from(state.selectedDomains);

  if (domains.length === 0) {
    showNotification("No domains selected", 'info');
    return;
  }

  if (!confirm(`Refresh ${domains.length} domain(s) with health checks?`)) return;

  showLoading(true);
  let refreshed = 0, failed = 0;

  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i];
    try {
      // Refresh with health check enabled
      const res = await apiFetch(`/api/refresh/${encodeURIComponent(domain)}?withHealth=true`, { method: "POST" });
      if (res.ok) {
        refreshed++;
      } else {
        failed++;
      }

      // Update progress notification
      if ((i + 1) % 5 === 0 || i === domains.length - 1) {
        await load(); // Refresh table periodically
      }
    } catch {
      failed++;
    }
  }

  let message = `Refreshed ${refreshed} domain(s)`;
  if (failed) message += `, ${failed} failed`;

  showNotification(message, refreshed > 0 ? 'success' : 'error');
  clearSelection();
  await load();
}

async function assignGroupToSelected() {
  const domains = Array.from(state.selectedDomains);

  if (domains.length === 0) {
    showNotification("No domains selected", 'info');
    return;
  }

  // Create a simple group selection prompt
  const groupOptions = state.groups.map(g => `${g.id}: ${g.name}`).join('\n');
  const groupId = prompt(`Enter group ID to assign (or leave empty to remove group):\n\n${groupOptions || 'No groups available'}`);

  if (groupId === null) return; // Cancelled

  const parsedGroupId = groupId === '' ? null : parseInt(groupId);

  if (groupId !== '' && (isNaN(parsedGroupId) || !state.groups.find(g => g.id === parsedGroupId))) {
    showNotification('Invalid group ID', 'error');
    return;
  }

  showLoading(true);
  let updated = 0, failed = 0;

  for (const domainName of domains) {
    const domain = state.allDomains.find(d => d.domain === domainName);
    if (!domain) continue;

    try {
      const res = await apiFetch(`/api/domains/${domain.id}/group`, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ group_id: parsedGroupId })
      });
      if (res.ok) {
        updated++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  let message = `Updated ${updated} domain(s)`;
  if (failed) message += `, ${failed} failed`;

  showNotification(message, updated > 0 ? 'success' : 'error');
  clearSelection();
  await load();
}

/* ======================================================
   Bulk Upload
====================================================== */
function toggleBulkUpload() {
  const el = document.getElementById("bulkContainer");
  el.style.display = el.style.display === "none" ? "block" : "none";
}

async function addBulkDomains() {
  // Support both commas and newlines as separators
  const input = document.getElementById("bulkInput").value;
  const domains = input
    .split(/[,\n\r]+/)
    .map(d => d.trim())
    .filter(Boolean);

  if (!domains.length) {
    showNotification("No domains provided", 'error');
    return;
  }

  showLoading(true);
  let added = 0, failed = 0, duplicates = 0;
  const errors = [];

  for (const domain of domains) {
    try {
      const res = await fetch("/api/domains", {
        method: "POST",
        credentials: 'same-origin',
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({domain})
      });

      if (res.ok) {
        added++;
      } else {
        const data = await res.json().catch(() => ({}));
        if (data.message?.includes('already exists')) {
          duplicates++;
        } else {
          failed++;
          if (data.message) errors.push(`${domain}: ${data.message}`);
        }
      }
    } catch {
      failed++;
    }
  }

  document.getElementById("bulkInput").value = "";

  let message = `Added ${added} domain(s)`;
  if (duplicates) message += `, ${duplicates} already existed`;
  if (failed) message += `, ${failed} failed`;

  showNotification(message, added > 0 ? 'success' : (duplicates > 0 ? 'info' : 'error'));
  await load();
}

/* ======================================================
   Refresh Progress UI
====================================================== */
function showRefreshProgress(show = true, completed = 0, total = 0) {
  let progressEl = document.getElementById('refresh-progress');

  if (show) {
    if (!progressEl) {
      progressEl = document.createElement('div');
      progressEl.id = 'refresh-progress';
      progressEl.className = 'refresh-progress';
      progressEl.innerHTML = `
        <div class="refresh-progress-bar" style="width: 0%"></div>
      `;
      document.body.appendChild(progressEl);
    }

    let textEl = document.getElementById('refresh-progress-text');
    if (!textEl) {
      textEl = document.createElement('div');
      textEl.id = 'refresh-progress-text';
      textEl.className = 'refresh-progress-text';
      document.body.appendChild(textEl);
    }

    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    progressEl.querySelector('.refresh-progress-bar').style.width = `${percent}%`;
    textEl.textContent = `Refreshing ${completed} of ${total} domains...`;

    progressEl.style.display = 'block';
    textEl.style.display = 'block';
  } else {
    if (progressEl) progressEl.style.display = 'none';
    const textEl = document.getElementById('refresh-progress-text');
    if (textEl) textEl.style.display = 'none';
  }
}

/* ======================================================
   Refresh & Export
====================================================== */
async function refreshAll() {
  if (state.isRefreshing) {
    showNotification("Refresh already in progress", 'info');
    return;
  }

  // Get domain count for confirmation
  try {
    const domainsRes = await apiFetch('/api/domains');
    const domains = await domainsRes.json();

    if (domains.length === 0) {
      showNotification("No domains to refresh", 'info');
      return;
    }

    if (!confirm(`Refresh ${domains.length} domain(s)?\n\nThis will query WHOIS data and run health checks for all domains.`)) return;

    state.isRefreshing = true;
    setRefreshButtonsDisabled(true);
    showLoading(true);
    showRefreshProgress(true, 0, domains.length);

    // Refresh with health checks enabled by default
    const res = await fetch("/api/refresh?withHealth=true", { method: "POST", credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.message || "Failed to refresh");
    }

    showNotification(data.message || "Refresh started", 'info');

    // WebSocket will handle progress updates; re-enable buttons on complete event

  } catch (err) {
    console.error("Error refreshing:", err);
    showNotification(err.message, 'error');
    state.isRefreshing = false;
    setRefreshButtonsDisabled(false);
    showRefreshProgress(false);
    showLoading(false);
  }
}

function setRefreshButtonsDisabled(disabled) {
  const selectors = ['#refreshAllBtn', '#refreshSelectedBtn', '.refresh-btn', '[data-action="refresh"]'];
  selectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(btn => {
      btn.disabled = disabled;
      if (disabled) btn.classList.add('loading');
      else btn.classList.remove('loading');
    });
  });
}

async function refreshOne(domain) {
  try {
    showLoading(true);
    // Refresh with health check enabled
    const res = await apiFetch(`/api/refresh/${encodeURIComponent(domain)}?withHealth=true`, { method: "POST" });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || "Failed to refresh");
    }

    showNotification(`Domain ${domain} refreshed with health check`, 'success');
    await load();
  } catch (err) {
    console.error("Error refreshing domain:", err);
    showNotification(err.message, 'error');
    showLoading(false);
  }
}

async function checkDomainHealth(domain) {
  const domainObj = state.allDomains.find(d => d.domain === domain);
  if (!domainObj) return;

  try {
    showLoading(true);
    const res = await apiFetch(`/api/health/domain/${domainObj.id}`, { method: "POST" });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || "Failed to check health");
    }

    showNotification(`Health check completed for ${domain}`, 'success');
    await load();
  } catch (err) {
    console.error("Error checking health:", err);
    showNotification(err.message, 'error');
    showLoading(false);
  }
}

const exportCSV = () => window.location.href = "/api/export/csv";

async function runHealthChecks() {
  if (!confirm('Run health checks for all domains?\n\nThis will check DNS, HTTP, and SSL status.')) return;

  try {
    showLoading(true);
    const res = await apiFetch('/api/health/check-all', { method: 'POST' });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to run health checks');
    }

    showNotification('Health checks started', 'info');
    showLoading(false);
  } catch (err) {
    console.error('Error running health checks:', err);
    showNotification(err.message, 'error');
    showLoading(false);
  }
}

/* ======================================================
   Modal Management
====================================================== */
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'flex';
    // Load data for specific modals
    if (modalId === 'groupsModal') loadGroups();
    if (modalId === 'tagsModal') loadTags();
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'none';
  }
}

// Close modal when clicking outside
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal')) {
    e.target.style.display = 'none';
  }
});

// Close topmost visible modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const visibleModals = Array.from(document.querySelectorAll('.modal'))
      .filter(m => m.style.display !== 'none' && m.style.display !== '');
    if (visibleModals.length > 0) {
      visibleModals[visibleModals.length - 1].style.display = 'none';
      e.preventDefault();
    }
  }
});

/* ======================================================
   Dropdown Management
====================================================== */
function toggleDropdown(id) {
  const menu = document.getElementById(id);
  if (menu) {
    menu.classList.toggle('show');
  }
}

function closeDropdown() {
  document.querySelectorAll('.dropdown-menu').forEach(menu => {
    menu.classList.remove('show');
  });
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown')) {
    closeDropdown();
  }
});

/* ======================================================
   Settings Tabs
====================================================== */
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('tab-btn')) {
    const tabId = e.target.dataset.tab;
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    e.target.classList.add('active');
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`tab-${tabId}`)?.classList.add('active');
  }
});

/* ======================================================
   Settings Management
====================================================== */
async function loadSettings() {
  try {
    const res = await apiFetch('/api/settings');
    if (!res.ok) return;

    const settings = await res.json();

    // General settings
    document.getElementById('settingAlertDays').value = settings.alert_days?.[0] || 30;
    document.getElementById('settingCron').value = settings.refresh_schedule || '0 0 * * *';

    // Timezone setting
    const tz = settings.timezone || 'UTC';
    appTimezone = tz;
    populateTimezoneSelect(tz);

    // Email settings
    document.getElementById('settingEmailEnabled').checked = settings.email_enabled || false;
    document.getElementById('settingEmailRecipients').value = (settings.email_recipients || []).join(', ');
    document.getElementById('settingAlertDaysEmail').value = (settings.alert_days || [7, 14, 30]).join(', ');
    document.getElementById('settingEmailAlertCron').value = settings.email_alert_cron || '0 9 * * *';

    // SMTP settings (leave password blank — never pre-fill)
    document.getElementById('settingSmtpHost').value = settings.smtp_host || '';
    document.getElementById('settingSmtpPort').value = settings.smtp_port || '';
    document.getElementById('settingSmtpSecure').checked = settings.smtp_secure || false;
    document.getElementById('settingSmtpUser').value = settings.smtp_user || '';
    document.getElementById('settingSmtpPass').value = ''; // never pre-fill password
    document.getElementById('settingSmtpFrom').value = settings.smtp_from || '';

    // Show SMTP status banner
    updateSmtpStatusBanner(settings);

    // Uptime settings
    document.getElementById('settingUptimeEnabled').checked = settings.uptime_monitoring_enabled || false;
    document.getElementById('settingUptimeInterval').value = settings.uptime_check_interval_minutes || 5;
    document.getElementById('settingUptimeThreshold').value = settings.uptime_alert_threshold || 3;

    // Health check settings
    document.getElementById('settingHealthCheckEnabled').checked = settings.health_check_enabled !== false;
    document.getElementById('settingHealthCheckInterval').value = settings.health_check_interval_hours || 24;

    // Retention settings
    document.getElementById('settingAutoCleanup').checked = settings.auto_cleanup_enabled !== false;
    document.getElementById('settingAuditRetention').value = settings.audit_log_retention_days || 90;
    document.getElementById('settingHealthRetention').value = settings.health_log_retention_days || 30;

    // Slack settings
    populateEventsCheckboxes('slackEventsCheckboxes', settings.slack_events || []);
    document.getElementById('settingSlackEnabled').checked = settings.slack_enabled || false;
    document.getElementById('settingSlackWebhookUrl').value = settings.slack_webhook_url || '';

    // Signal settings
    populateEventsCheckboxes('signalEventsCheckboxes', settings.signal_events || []);
    document.getElementById('settingSignalEnabled').checked = settings.signal_enabled || false;
    document.getElementById('settingSignalApiUrl').value = settings.signal_api_url || '';
    document.getElementById('settingSignalSender').value = settings.signal_sender || '';
    document.getElementById('settingSignalRecipients').value = (settings.signal_recipients || []).join(', ');

    // Security settings
    document.getElementById('settingSessionMaxAge').value = settings.session_max_age_days || 7;
    document.getElementById('settingRateLimitMax').value = settings.rate_limit_max || 2000;

    // Advanced settings
    document.getElementById('settingWhoisTimeout').value = settings.whois_timeout_seconds || 30;
    document.getElementById('settingWhoisDelay').value = settings.whois_delay_ms || 2000;
    document.getElementById('settingWhoisRetries').value = settings.whois_max_retries || 3;
    document.getElementById('settingUptimeTimeout').value = settings.uptime_check_timeout_seconds || 10;

    // Load sub-data only for the relevant page to avoid unnecessary API calls
    const currentPage = (() => { try { return localStorage.getItem('currentPage') || 'dashboard'; } catch { return 'dashboard'; } })();
    if (currentPage === 'notifications') {
      loadWebhooks();
      loadApiKeys();
    }
    if (currentPage === 'settings') {
      loadRetentionStats();
    }
    if (currentPage === 'users') {
      loadUsers();
    }

  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

async function saveSettings() {
  try {
    // Parse alert days from comma-separated string
    const alertDaysStr = document.getElementById('settingAlertDaysEmail').value;
    const alertDays = alertDaysStr.split(',').map(d => parseInt(d.trim(), 10)).filter(d => !isNaN(d));

    // Parse email recipients from comma-separated string
    const recipientsStr = document.getElementById('settingEmailRecipients').value;
    const emailRecipients = recipientsStr.split(',').map(e => e.trim()).filter(Boolean);

    // SMTP fields — only include password if user typed something
    const smtpPass = document.getElementById('settingSmtpPass').value;
    const smtpHost = document.getElementById('settingSmtpHost').value.trim();
    const smtpPort = parseInt(document.getElementById('settingSmtpPort').value, 10);
    const smtpUser = document.getElementById('settingSmtpUser').value.trim();
    const smtpFrom = document.getElementById('settingSmtpFrom').value.trim();

    const settings = {
      // Timezone
      timezone: document.getElementById('settingTimezone').value || 'UTC',
      // Schedule
      refresh_schedule: document.getElementById('settingCron').value,
      // Email
      email_enabled: document.getElementById('settingEmailEnabled').checked,
      email_recipients: emailRecipients,
      alert_days: alertDays.length > 0 ? alertDays : [7, 14, 30],
      email_alert_cron: document.getElementById('settingEmailAlertCron').value.trim() || '0 9 * * *',
      // SMTP (only send password if user typed one)
      smtp_host: smtpHost || undefined,
      smtp_port: smtpPort > 0 ? smtpPort : undefined,
      smtp_secure: document.getElementById('settingSmtpSecure').checked,
      smtp_user: smtpUser || undefined,
      smtp_from: smtpFrom || undefined,
      ...(smtpPass ? { smtp_pass: smtpPass } : {}),
      // Uptime
      uptime_monitoring_enabled: document.getElementById('settingUptimeEnabled').checked,
      uptime_check_interval_minutes: parseInt(document.getElementById('settingUptimeInterval').value, 10) || 5,
      uptime_alert_threshold: parseInt(document.getElementById('settingUptimeThreshold').value, 10) || 3,
      uptime_check_timeout_seconds: parseInt(document.getElementById('settingUptimeTimeout').value, 10) || 10,
      // Health checks
      health_check_enabled: document.getElementById('settingHealthCheckEnabled').checked,
      health_check_interval_hours: parseInt(document.getElementById('settingHealthCheckInterval').value, 10) || 24,
      // Retention
      auto_cleanup_enabled: document.getElementById('settingAutoCleanup').checked,
      audit_log_retention_days: parseInt(document.getElementById('settingAuditRetention').value, 10) || 90,
      health_log_retention_days: parseInt(document.getElementById('settingHealthRetention').value, 10) || 30,
      // Slack
      slack_enabled: document.getElementById('settingSlackEnabled').checked,
      slack_webhook_url: document.getElementById('settingSlackWebhookUrl').value.trim(),
      slack_events: getCheckedEvents('slackEventsCheckboxes'),
      // Signal
      signal_enabled: document.getElementById('settingSignalEnabled').checked,
      signal_api_url: document.getElementById('settingSignalApiUrl').value.trim(),
      signal_sender: document.getElementById('settingSignalSender').value.trim(),
      signal_recipients: document.getElementById('settingSignalRecipients').value.split(',').map(s => s.trim()).filter(Boolean),
      signal_events: getCheckedEvents('signalEventsCheckboxes'),
      // Security
      session_max_age_days: parseInt(document.getElementById('settingSessionMaxAge').value, 10) || 7,
      rate_limit_max: parseInt(document.getElementById('settingRateLimitMax').value, 10) || 2000,
      // Advanced / WHOIS
      whois_timeout_seconds: parseInt(document.getElementById('settingWhoisTimeout').value, 10) || 30,
      whois_delay_ms: parseInt(document.getElementById('settingWhoisDelay').value, 10) || 2000,
      whois_max_retries: parseInt(document.getElementById('settingWhoisRetries').value, 10) || 3,
    };

    const res = await apiFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to save settings');
    }

    showNotification('Settings saved successfully', 'success');

    // Track if timezone changed before reloading settings
    const prevTimezone = appTimezone;

    // Reload settings to reflect saved values (don't close modal)
    await loadSettings();

    // If the timezone changed, re-render all date-bearing UI so changes are visible immediately
    if (appTimezone !== prevTimezone) {
      load();           // re-renders domain table (expiry dates, last-checked)
      loadActivityLog();// re-renders activity feed timestamps
    }

    // Restart uptime monitoring if settings changed
    if (settings.uptime_monitoring_enabled) {
      restartUptimeService();
    }

  } catch (err) {
    console.error('Error saving settings:', err);
    showNotification(err.message, 'error');
  }
}

function setCronPreset(cron) {
  document.getElementById('settingCron').value = cron;
}

/* ======================================================
   SMTP helpers
====================================================== */
function updateSmtpStatusBanner(settings) {
  const banner = document.getElementById('smtpStatusBanner');
  if (!banner) return;
  const hasHost = !!(settings.smtp_host || '').trim() || true; // env fallback may have host
  const emailEnabled = settings.email_enabled;
  if (!emailEnabled) {
    banner.style.display = 'none';
    return;
  }
  // Request live SMTP status from backend
  apiFetch('/api/settings/email/status').then(async r => {
    if (!r.ok) { banner.style.display = 'none'; return; }
    const d = await r.json();
    banner.style.display = '';
    if (d.initialized) {
      banner.className = 'smtp-status-ok';
      banner.textContent = `✓ SMTP connected — ${d.host}:${d.port} (${d.user || 'anonymous'})`;
    } else if (d.configured) {
      banner.className = 'smtp-status-warn';
      banner.textContent = `⚠ SMTP configured but not verified — ${d.reason || 'unknown error'}`;
    } else {
      banner.className = 'smtp-status-err';
      banner.textContent = `✗ SMTP not configured — ${d.reason || 'missing host or username'}`;
    }
  }).catch(() => { banner.style.display = 'none'; });
}

async function reinitSmtp() {
  const btn = document.getElementById('btnReinitSmtp');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Reinitializing…'; }
  try {
    const res = await apiFetch('/api/settings/email/reinit', { method: 'POST' });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.success) {
      showNotification('SMTP reinitialized successfully', 'success');
    } else {
      showNotification(d.message || 'SMTP reinit failed', 'error');
    }
    // Refresh the status banner
    const settings = await apiFetch('/api/settings').then(r => r.json()).catch(() => ({}));
    updateSmtpStatusBanner(settings);
  } catch (err) {
    showNotification('SMTP reinit error: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Re-initialize SMTP'; }
  }
}

/* ======================================================
   User Management
====================================================== */
async function loadUsers() {
  const container = document.getElementById('usersList');
  if (!container) return;
  try {
    const res = await apiFetch('/api/users');
    if (!res.ok) {
      if (res.status === 403) {
        container.innerHTML = '<p class="info-text">User management requires admin role.</p>';
      }
      return;
    }
    const data = await res.json();
    const users = data.data || data || [];
    if (users.length === 0) {
      container.innerHTML = '<p class="info-text">No users found.</p>';
      return;
    }
    container.innerHTML = users.map(u => {
      const roleBadge = `<span class="user-badge user-badge-${u.role}">${u.role}</span>`;
      const disabledBadge = u.enabled === false ? '<span class="user-badge user-badge-disabled">Disabled</span>' : '';
      const lastLogin = u.last_login ? `Last login: ${formatDateTime(u.last_login)}` : 'Never logged in';
      const toggleLabel = u.enabled === false ? 'Enable' : 'Disable';
      const toggleIcon = u.enabled === false ? 'fa-toggle-off' : 'fa-toggle-on';
      return `
        <div class="user-item" id="user-item-${u.id}">
          <div class="user-item-info">
            <span class="user-item-name">${escapeHtml(u.username)}</span>
            ${roleBadge}
            ${disabledBadge}
            <span class="user-item-meta">${lastLogin}</span>
          </div>
          <div class="user-item-actions">
            <select class="btn btn-sm" onchange="changeUserRole(${u.id}, this.value)" title="Change role">
              ${['admin','manager','viewer'].map(r => `<option value="${r}"${u.role===r?' selected':''}>${r}</option>`).join('')}
            </select>
            <button class="btn btn-sm" onclick="toggleUser(${u.id}, ${u.enabled !== false})" title="${toggleLabel}">
              <i class="fa-solid ${toggleIcon}"></i>
            </button>
            <button class="btn btn-sm" onclick="resetUserPassword(${u.id}, '${escapeHtml(u.username)}')" title="Reset password">
              <i class="fa-solid fa-key"></i>
            </button>
            <button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id}, '${escapeHtml(u.username)}')" title="Delete user">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading users:', err);
    container.innerHTML = '<p class="info-text">Error loading users.</p>';
  }
}

async function createUser() {
  const username = document.getElementById('newUserUsername').value.trim();
  const role = document.getElementById('newUserRole').value;
  const password = document.getElementById('newUserPassword').value;
  const confirm = document.getElementById('newUserPasswordConfirm').value;

  if (!username) { showNotification('Username is required', 'error'); return; }
  if (!password) { showNotification('Password is required', 'error'); return; }
  if (password !== confirm) { showNotification('Passwords do not match', 'error'); return; }

  try {
    const res = await apiFetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || 'Failed to create user');
    showNotification(`User "${username}" created`, 'success');
    document.getElementById('newUserUsername').value = '';
    document.getElementById('newUserPassword').value = '';
    document.getElementById('newUserPasswordConfirm').value = '';
    loadUsers();
  } catch (err) {
    showNotification(err.message, 'error');
  }
}

async function changeUserRole(id, role) {
  try {
    const res = await apiFetch(`/api/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || 'Failed to update role');
    showNotification('Role updated', 'success');
    loadUsers();
  } catch (err) {
    showNotification(err.message, 'error');
  }
}

async function toggleUser(id, currentlyEnabled) {
  try {
    const res = await apiFetch(`/api/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !currentlyEnabled }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || 'Failed to update user');
    showNotification(currentlyEnabled ? 'User disabled' : 'User enabled', 'success');
    loadUsers();
  } catch (err) {
    showNotification(err.message, 'error');
  }
}

async function resetUserPassword(id, username) {
  const newPass = prompt(`Enter new password for "${username}":`);
  if (!newPass) return;
  if (newPass.length < 6) { showNotification('Password must be at least 6 characters', 'error'); return; }
  try {
    const res = await apiFetch(`/api/users/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPass }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || 'Failed to reset password');
    showNotification(`Password updated for "${username}"`, 'success');
  } catch (err) {
    showNotification(err.message, 'error');
  }
}

async function deleteUser(id, username) {
  if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
  try {
    const res = await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || 'Failed to delete user');
    showNotification(`User "${username}" deleted`, 'success');
    loadUsers();
  } catch (err) {
    showNotification(err.message, 'error');
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ======================================================
   Slack / Signal / Webhook helpers
====================================================== */
const WEBHOOK_EVENTS = [
  { value: 'domain.expiring',    label: 'Domain Expiring Soon' },
  { value: 'domain.expired',     label: 'Domain Expired' },
  { value: 'domain.created',     label: 'Domain Added' },
  { value: 'domain.deleted',     label: 'Domain Removed' },
  { value: 'health.failed',      label: 'Health Check Failed' },
  { value: 'uptime.down',        label: 'Domain Down' },
  { value: 'uptime.recovered',   label: 'Domain Recovered' },
  { value: 'refresh.complete',   label: 'Refresh Complete' },
];

function populateEventsCheckboxes(containerId, selectedEvents) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = WEBHOOK_EVENTS.map(e => `
    <label class="event-checkbox-label">
      <input type="checkbox" value="${e.value}" ${selectedEvents.includes(e.value) ? 'checked' : ''}>
      ${e.label}
    </label>
  `).join('');
}

function getCheckedEvents(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return [];
  return Array.from(container.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
}

async function testSlackNotification() {
  const url = document.getElementById('settingSlackWebhookUrl').value.trim();
  if (!url) { showNotification('Enter a Slack Webhook URL first', 'error'); return; }
  try {
    // Save current settings first so the test uses the current webhook URL
    const res = await apiFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slack_enabled: true,
        slack_webhook_url: url,
        slack_events: getCheckedEvents('slackEventsCheckboxes'),
      })
    });
    if (!res.ok) throw new Error('Failed to save Slack settings before test');
    // Fire a test via the webhook test endpoint — use a dummy webhook or the refresh event
    const testRes = await apiFetch('/api/settings/slack/test', { method: 'POST' });
    const data = await testRes.json().catch(() => ({}));
    if (testRes.ok) {
      showNotification('Slack test message sent!', 'success');
    } else {
      showNotification(data.message || 'Slack test failed', 'error');
    }
  } catch (err) {
    showNotification(err.message || 'Slack test failed', 'error');
  }
}

async function testSignalNotification() {
  const apiUrl = document.getElementById('settingSignalApiUrl').value.trim();
  const sender = document.getElementById('settingSignalSender').value.trim();
  const recipientsRaw = document.getElementById('settingSignalRecipients').value.trim();
  if (!apiUrl || !sender || !recipientsRaw) {
    showNotification('Fill in API URL, sender, and at least one recipient first', 'error');
    return;
  }
  const recipients = recipientsRaw.split(',').map(s => s.trim()).filter(Boolean);
  try {
    const res = await apiFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signal_enabled: true,
        signal_api_url: apiUrl,
        signal_sender: sender,
        signal_recipients: recipients,
        signal_events: getCheckedEvents('signalEventsCheckboxes'),
      })
    });
    if (!res.ok) throw new Error('Failed to save Signal settings before test');
    const testRes = await apiFetch('/api/settings/signal/test', { method: 'POST' });
    const data = await testRes.json().catch(() => ({}));
    if (testRes.ok) {
      showNotification('Signal test message sent!', 'success');
    } else {
      showNotification(data.message || 'Signal test failed', 'error');
    }
  } catch (err) {
    showNotification(err.message || 'Signal test failed', 'error');
  }
}

/* ======================================================
   Webhooks CRUD
====================================================== */
async function loadWebhooks() {
  try {
    const res = await apiFetch('/api/webhooks');
    if (!res.ok) return;
    const webhooks = await res.json();

    // Populate new-webhook event checkboxes
    populateEventsCheckboxes('newWebhookEventsCheckboxes', []);

    const container = document.getElementById('webhooksList');
    if (!container) return;

    if (!webhooks.length) {
      container.innerHTML = '<p class="info-text">No webhooks configured yet.</p>';
      return;
    }

    container.innerHTML = webhooks.map(wh => `
      <div class="webhook-item" id="webhook-${wh.id}">
        <div class="webhook-item-header">
          <div class="webhook-item-info">
            <span class="webhook-name">${escapeHTML(wh.name)}</span>
            <span class="webhook-url" title="${escapeHTML(wh.url)}">${escapeHTML(wh.url.length > 50 ? wh.url.slice(0, 47) + '...' : wh.url)}</span>
          </div>
          <div class="webhook-item-actions">
            <div class="api-key-toggle ${wh.enabled ? 'enabled' : ''}" onclick="toggleWebhook(${wh.id}, ${!wh.enabled})" title="${wh.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}"></div>
            <button class="btn btn-sm" onclick="testWebhook(${wh.id})" title="Send test event"><i class="fa-solid fa-paper-plane"></i></button>
            <button class="btn btn-sm" onclick="deleteWebhook(${wh.id})" title="Delete"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
        <div class="webhook-events-list">
          ${wh.events.map(e => `<span class="tag-badge" style="background:#6366f1">${e}</span>`).join(' ')}
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error loading webhooks:', err);
  }
}

async function addWebhook() {
  const name = document.getElementById('newWebhookName').value.trim();
  const url = document.getElementById('newWebhookUrl').value.trim();
  const secret = document.getElementById('newWebhookSecret').value.trim();
  const events = getCheckedEvents('newWebhookEventsCheckboxes');

  if (!name) { showNotification('Webhook name is required', 'error'); return; }
  if (!url) { showNotification('Webhook URL is required', 'error'); return; }
  if (!events.length) { showNotification('Select at least one event', 'error'); return; }

  try {
    const body = { name, url, events, enabled: true };
    if (secret) body.secret = secret;

    const res = await apiFetch('/api/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to add webhook');
    }

    const data = await res.json();
    if (data.secret && data.secret !== '***') {
      showNotification(`Webhook created! Secret: ${data.secret} — save this, it won't be shown again.`, 'info');
    } else {
      showNotification('Webhook added', 'success');
    }

    document.getElementById('newWebhookName').value = '';
    document.getElementById('newWebhookUrl').value = '';
    document.getElementById('newWebhookSecret').value = '';
    populateEventsCheckboxes('newWebhookEventsCheckboxes', []);
    loadWebhooks();
  } catch (err) {
    showNotification(err.message, 'error');
  }
}

async function toggleWebhook(id, enabled) {
  try {
    await apiFetch(`/api/webhooks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
    loadWebhooks();
  } catch (err) {
    showNotification('Failed to update webhook', 'error');
  }
}

async function testWebhook(id) {
  try {
    const res = await apiFetch(`/api/webhooks/${id}/test`, { method: 'POST' });
    if (res.ok) {
      showNotification('Test event sent to webhook', 'success');
    } else {
      const data = await res.json().catch(() => ({}));
      showNotification(data.message || 'Test failed', 'error');
    }
  } catch (err) {
    showNotification('Test failed', 'error');
  }
}

async function deleteWebhook(id) {
  if (!confirm('Delete this webhook?')) return;
  try {
    await apiFetch(`/api/webhooks/${id}`, { method: 'DELETE' });
    showNotification('Webhook deleted', 'success');
    loadWebhooks();
  } catch (err) {
    showNotification('Failed to delete webhook', 'error');
  }
}

async function testEmailSettings() {
  const btn = document.querySelector('#tab-email .input-group .btn');
  const originalContent = btn.innerHTML;

  try {
    const email = document.getElementById('settingTestEmail').value;
    if (!email) {
      showNotification('Please enter a test email address', 'error');
      return;
    }

    // Show loading state on button
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';
    showNotification('Sending test email...', 'info');

    const res = await apiFetch('/api/settings/email/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.message || 'Failed to send test email');
    }

    showNotification(data.message || 'Test email sent successfully!', 'success');

  } catch (err) {
    showNotification(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalContent;
  }
}

/* ======================================================
   API Keys Management
====================================================== */
async function loadApiKeys() {
  try {
    const res = await apiFetch('/api/apikeys');
    if (!res.ok) return;

    const keys = await res.json();
    const container = document.getElementById('apiKeysList');

    if (keys.length === 0) {
      container.innerHTML = '<p class="info-text">No API keys configured. Using environment variable.</p>';
      return;
    }

    container.innerHTML = keys.map(key => `
      <div class="api-key-item">
        <div class="api-key-info">
          <span class="api-key-name">${escapeHTML(key.name)}</span>
          <span class="api-key-stats">${key.request_count} requests</span>
        </div>
        <div class="api-key-actions">
          <div class="api-key-toggle ${key.enabled ? 'enabled' : ''}" onclick="toggleApiKey(${key.id})" title="${key.enabled ? 'Enabled' : 'Disabled'}"></div>
          <button class="btn" onclick="deleteApiKey(${key.id})"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    `).join('');

  } catch (err) {
    console.error('Error loading API keys:', err);
  }
}

async function addApiKey() {
  const name = document.getElementById('newApiKeyName').value.trim();
  const key = document.getElementById('newApiKeyValue').value.trim();

  if (!name || !key) {
    showNotification('Please enter both name and key', 'error');
    return;
  }

  try {
    const res = await apiFetch('/api/apikeys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, key })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to add API key');
    }

    document.getElementById('newApiKeyName').value = '';
    document.getElementById('newApiKeyValue').value = '';

    showNotification('API key added', 'success');
    loadApiKeys();

  } catch (err) {
    showNotification(err.message, 'error');
  }
}

async function toggleApiKey(id) {
  try {
    const res = await apiFetch(`/api/apikeys/${id}/toggle`, { method: 'PUT' });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to toggle API key');
    }

    loadApiKeys();

  } catch (err) {
    showNotification(err.message, 'error');
  }
}

async function deleteApiKey(id) {
  if (!confirm('Delete this API key?')) return;

  try {
    const res = await apiFetch(`/api/apikeys/${id}`, { method: 'DELETE' });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to delete API key');
    }

    showNotification('API key deleted', 'success');
    loadApiKeys();

  } catch (err) {
    showNotification(err.message, 'error');
  }
}

/* ======================================================
   Groups Management
====================================================== */
async function loadGroups() {
  try {
    const res = await apiFetch('/api/groups');
    if (!res.ok) return;

    const groups = await res.json();
    state.groups = groups;
    const container = document.getElementById('groupsList');

    if (groups.length === 0) {
      container.innerHTML = '<p class="info-text">No groups created yet.</p>';
      return;
    }

    container.innerHTML = groups.map(group => `
      <div class="group-item">
        <div class="group-info">
          <span class="group-color" style="background: ${sanitizeColor(group.color)}"></span>
          <span class="group-name">${escapeHTML(group.name)}</span>
          <span class="group-count">${group.domain_count || 0} domains</span>
        </div>
        <div class="group-actions">
          <button class="btn" onclick="deleteGroup(${group.id})"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    `).join('');

  } catch (err) {
    console.error('Error loading groups:', err);
  }
}

async function addGroup() {
  const name = document.getElementById('newGroupName').value.trim();
  const color = document.getElementById('newGroupColor').value;

  if (!name) {
    showNotification('Please enter a group name', 'error');
    return;
  }

  try {
    const res = await apiFetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to add group');
    }

    document.getElementById('newGroupName').value = '';

    showNotification('Group created', 'success');
    loadGroups();
    load(); // Refresh main view

  } catch (err) {
    showNotification(err.message, 'error');
  }
}

async function deleteGroup(id) {
  if (!confirm('Delete this group? Domains in this group will be unassigned.')) return;

  try {
    const res = await apiFetch(`/api/groups/${id}`, { method: 'DELETE' });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to delete group');
    }

    showNotification('Group deleted', 'success');
    loadGroups();
    load(); // Refresh main view

  } catch (err) {
    showNotification(err.message, 'error');
  }
}

/* ======================================================
   Tags Management
====================================================== */
async function loadTags() {
  try {
    const res = await apiFetch('/api/tags');
    if (!res.ok) return;

    const tags = await res.json();
    state.tags = tags;
    const container = document.getElementById('tagsList');

    if (tags.length === 0) {
      container.innerHTML = '<p class="info-text">No tags created yet.</p>';
      return;
    }

    container.innerHTML = tags.map(tag => `
      <div class="tag-item">
        <div class="tag-info">
          <span class="tag-color" style="background: ${sanitizeColor(tag.color)}"></span>
          <span class="tag-name">${escapeHTML(tag.name)}</span>
        </div>
        <div class="tag-actions">
          <button class="btn" onclick="deleteTag(${tag.id})"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    `).join('');

  } catch (err) {
    console.error('Error loading tags:', err);
  }
}

async function addTag() {
  const name = document.getElementById('newTagName').value.trim();
  const color = document.getElementById('newTagColor').value;

  if (!name) {
    showNotification('Please enter a tag name', 'error');
    return;
  }

  try {
    const res = await apiFetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to add tag');
    }

    document.getElementById('newTagName').value = '';

    showNotification('Tag created', 'success');
    loadTags();

  } catch (err) {
    showNotification(err.message, 'error');
  }
}

async function deleteTag(id) {
  if (!confirm('Delete this tag?')) return;

  try {
    const res = await apiFetch(`/api/tags/${id}`, { method: 'DELETE' });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to delete tag');
    }

    showNotification('Tag deleted', 'success');
    loadTags();

  } catch (err) {
    showNotification(err.message, 'error');
  }
}

/* ======================================================
   Domain Details Modal
====================================================== */
async function openDomainDetails(domainId) {
  state.currentDomainId = domainId;
  const domain = state.allDomains.find(d => d.id === domainId);

  if (!domain) return;

  document.getElementById('domainModalTitle').textContent = domain.domain;

  // Populate WHOIS info
  document.getElementById('domainWhoisInfo').innerHTML = `
    <p><strong>Registrar:</strong> ${escapeHTML(domain.registrar) || 'N/A'}</p>
    <p><strong>Created:</strong> ${formatDate(domain.created_date)}</p>
    <p><strong>Age:</strong> ${getDomainAge(domain.created_date)}</p>
    <p><strong>Expires:</strong> ${formatDate(domain.expiry_date)}</p>
    <p><strong>Last Checked:</strong> ${formatDateTime(domain.last_checked)}</p>
    <p><strong>Name Servers:</strong> ${(domain.name_servers || []).join(', ') || 'N/A'}</p>
  `;

  // Populate health info
  document.getElementById('domainHealthInfo').innerHTML = domain.health ? `
    <p><strong>DNS:</strong> ${domain.health.dns_resolved ? 'OK' : 'Failed'}</p>
    <p><strong>HTTP:</strong> ${domain.health.http_status || 'N/A'}</p>
    <p><strong>SSL:</strong> ${domain.health.ssl_valid ? 'Valid' : (domain.health.ssl_valid === false ? 'Invalid' : 'N/A')}</p>
    <p><strong>SSL Expires:</strong> ${domain.health.ssl_expires ? formatDate(domain.health.ssl_expires) : 'N/A'}</p>
  ` : '<p>No health check data available.</p>';

  // Populate group select
  const groupSelect = document.getElementById('domainGroupSelect');
  groupSelect.innerHTML = '<option value="">No Group</option>' +
    state.groups.map(g => `<option value="${g.id}" ${domain.group_id === g.id ? 'selected' : ''}>${escapeHTML(g.name)}</option>`).join('');

  // Populate tags checkboxes
  const tagsContainer = document.getElementById('domainTagsSelect');
  const domainTagIds = (domain.tags || []).map(t => t.id);
  tagsContainer.innerHTML = state.tags.map(tag => `
    <label class="tag-checkbox ${domainTagIds.includes(tag.id) ? 'selected' : ''}">
      <input type="checkbox" value="${tag.id}" ${domainTagIds.includes(tag.id) ? 'checked' : ''}>
      <span style="background: ${sanitizeColor(tag.color)}; width: 10px; height: 10px; border-radius: 50%; display: inline-block;"></span>
      ${escapeHTML(tag.name)}
    </label>
  `).join('') || '<p class="info-text">No tags available.</p>';

  // Load health history
  try {
    const res = await apiFetch(`/api/health/domain/${domainId}`);
    if (res.ok) {
      const history = await res.json();
      document.getElementById('domainHealthHistory').innerHTML = history.length ? history.slice(0, 10).map(h => `
        <div class="health-history-item">
          <span>${formatDateTime(h.checked_at)}</span>
          <span class="health-status-badge ${h.dns_resolved ? 'healthy' : 'unhealthy'}">
            DNS: ${h.dns_resolved ? 'OK' : 'Failed'}
          </span>
        </div>
      `).join('') : '<p class="info-text">No health check history.</p>';
    }
  } catch (err) {
    console.error('Error loading health history:', err);
  }

  // Reset history panel
  document.getElementById('domainChangeHistory').innerHTML =
    '<p style="color:var(--text-muted);font-size:13px;">Click "Load History" to view audit log for this domain.</p>';

  openModal('domainModal');

  // Load response time chart
  loadResponseTimeChart(domainId);
}

async function loadDomainHistory() {
  const domainId = state.currentDomainId;
  if (!domainId) return;

  const domain = state.allDomains.find(d => d.id === domainId);
  if (!domain) return;

  const container = document.getElementById('domainChangeHistory');
  container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Loading...</p>';

  try {
    const res = await apiFetch(`/api/audit?entity_type=domain&entity_id=${encodeURIComponent(domain.domain)}&limit=25`);
    if (!res.ok) throw new Error('Failed to load history');
    const data = await res.json();
    const entries = data.entries || [];

    if (entries.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">No history found for this domain.</p>';
      return;
    }

    container.innerHTML = entries.map(e => {
      const actionBadge = {
        create: '<span style="color:#22c55e;">created</span>',
        delete: '<span style="color:#ef4444;">deleted</span>',
        refresh: '<span style="color:#6366f1;">refreshed</span>',
        update: '<span style="color:#f59e0b;">updated</span>',
        health_check: '<span style="color:#3b82f6;">health check</span>',
      }[e.action] || `<span>${escapeHTML(e.action)}</span>`;

      let detail = '';
      if (e.action === 'refresh' && e.new_value) {
        const nv = e.new_value;
        const parts = [];
        if (nv.registrar) parts.push(`Registrar: ${escapeHTML(nv.registrar)}`);
        if (nv.expiry_date) parts.push(`Expires: ${escapeHTML(nv.expiry_date)}`);
        if (parts.length) detail = `<span style="color:var(--text-muted);font-size:11px;"> — ${parts.join(', ')}</span>`;
      }

      return `
        <div class="health-history-item" style="font-size:13px;">
          <span style="color:var(--text-muted);">${formatDateTime(e.created_at)}</span>
          <span>${actionBadge}${detail}</span>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = '<p style="color:var(--danger);font-size:13px;">Failed to load history.</p>';
  }
}

async function saveDomainDetails() {
  if (!state.currentDomainId) return;

  try {
    const groupId = document.getElementById('domainGroupSelect').value || null;

    // Save group
    await fetch(`/api/domains/${state.currentDomainId}/group`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: groupId ? parseInt(groupId) : null })
    });

    // Save tags
    const selectedTagIds = Array.from(document.querySelectorAll('#domainTagsSelect input:checked')).map(cb => parseInt(cb.value));

    // Get current tag IDs for domain
    const domain = state.allDomains.find(d => d.id === state.currentDomainId);
    const currentTagIds = (domain?.tags || []).map(t => t.id);

    // Add new tags
    for (const tagId of selectedTagIds) {
      if (!currentTagIds.includes(tagId)) {
        await fetch(`/api/domains/${state.currentDomainId}/tags/${tagId}`, { method: 'POST', credentials: 'same-origin' });
      }
    }

    // Remove unselected tags
    for (const tagId of currentTagIds) {
      if (!selectedTagIds.includes(tagId)) {
        await fetch(`/api/domains/${state.currentDomainId}/tags/${tagId}`, { method: 'DELETE', credentials: 'same-origin' });
      }
    }

    showNotification('Domain updated', 'success');
    closeModal('domainModal');
    await load();

  } catch (err) {
    console.error('Error saving domain details:', err);
    showNotification('Failed to save changes', 'error');
  }
}

/* ======================================================
   CSV Import
====================================================== */
function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  state.importFile = file;
  document.getElementById('importBtn').disabled = false;

  // Show preview
  const reader = new FileReader();
  reader.onload = (e) => {
    const content = e.target.result;
    const lines = content.split('\n').slice(0, 6); // First 5 lines + header

    const preview = document.getElementById('importPreview');
    preview.style.display = 'block';
    preview.innerHTML = `
      <h4>Preview (first ${lines.length - 1} rows)</h4>
      <table class="import-preview-table">
        ${lines.map((line, i) => `<tr>${line.split(',').map(cell =>
          `<${i === 0 ? 'th' : 'td'}>${escapeHTML(cell.trim())}</${i === 0 ? 'th' : 'td'}>`
        ).join('')}</tr>`).join('')}
      </table>
    `;
  };
  reader.readAsText(file);
}

// Drag and drop support
document.addEventListener('DOMContentLoaded', () => {
  const dropzone = document.getElementById('importDropzone');
  if (dropzone) {
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');

      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith('.csv')) {
        document.getElementById('importFile').files = e.dataTransfer.files;
        handleFileSelect({ target: { files: [file] } });
      } else {
        showNotification('Please drop a CSV file', 'error');
      }
    });
  }
});

async function processImport() {
  if (!state.importFile) return;

  try {
    showLoading(true);

    const formData = new FormData();
    formData.append('file', state.importFile);

    const res = await apiFetch('/api/import/csv', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || 'Import failed');
    }

    showNotification(`Imported ${data.added} domains, ${data.skipped} skipped`, 'success');
    closeModal('importModal');

    // Reset
    state.importFile = null;
    document.getElementById('importFile').value = '';
    document.getElementById('importPreview').style.display = 'none';
    document.getElementById('importBtn').disabled = true;

    await load();

  } catch (err) {
    console.error('Error importing:', err);
    showNotification(err.message, 'error');
  } finally {
    showLoading(false);
  }
}

/* ======================================================
   Audit Log
====================================================== */
async function loadAuditLog() {
  try {
    const entityType = document.getElementById('auditEntityFilter').value;
    const action = document.getElementById('auditActionFilter').value;

    let url = '/api/audit?limit=100';
    if (entityType) url += `&entity_type=${entityType}`;
    if (action) url += `&action=${action}`;

    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) return;

    const data = await res.json();
    const logs = Array.isArray(data.entries) ? data.entries : (Array.isArray(data) ? data : []);
    const container = document.getElementById('auditLogList');

    if (logs.length === 0) {
      container.innerHTML = '<p class="info-text">No audit log entries found.</p>';
      return;
    }

    const actionIcon = a => a === 'create' ? 'plus' : a === 'update' ? 'pen' : a === 'delete' ? 'trash' : a === 'login' ? 'right-to-bracket' : a === 'logout' ? 'right-from-bracket' : a === 'refresh' ? 'rotate' : a === 'health_check' ? 'heart-pulse' : 'circle-info';

    container.innerHTML = logs.map(log => `
      <div class="audit-log-item">
        <div class="audit-log-icon ${log.action}">
          <i class="fa-solid fa-${actionIcon(log.action)}"></i>
        </div>
        <div class="audit-log-content">
          <div class="audit-log-title">${escapeHTML(log.entity_type)}: ${escapeHTML(String(log.entity_id || ''))}</div>
          <div class="audit-log-meta">${formatDateTime(log.created_at)} &mdash; ${escapeHTML(log.action)}</div>
        </div>
      </div>
    `).join('');

  } catch (err) {
    console.error('Error loading audit log:', err);
  }
}

/* ======================================================
   Authentication
====================================================== */
async function handleLogin(event) {
  event.preventDefault();

  const username = document.getElementById('loginUsername').value;
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('loginError');

  try {
    // Use regular fetch for login - don't trigger the 401 handler
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.message || 'Login failed';
      errorEl.style.display = 'block';
      return;
    }

    state.isAuthenticated = true;
    state.authRequired = false;
    errorEl.style.display = 'none';
    closeModal('loginModal');
    document.getElementById('logoutBtn').style.display = 'flex';
    showNotification('Logged in successfully', 'success');
    load();

  } catch (err) {
    errorEl.textContent = err.message || 'Login failed';
    errorEl.style.display = 'block';
  }
}

async function handleLogout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    state.isAuthenticated = false;
    document.getElementById('logoutBtn').style.display = 'none';
    showNotification('Logged out', 'info');

    if (state.authRequired) {
      openModal('loginModal');
    }

  } catch (err) {
    console.error('Error logging out:', err);
  }
}

async function checkAuthStatus() {
  try {
    // Use regular fetch - we handle auth status ourselves here
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    const data = await res.json();

    if (res.ok) {
      state.isAuthenticated = data.authenticated;
      state.authRequired = data.authEnabled;

      if (state.isAuthenticated) {
        document.getElementById('logoutBtn').style.display = 'flex';
      }
    } else {
      // 401 means auth is enabled but not authenticated
      state.isAuthenticated = false;
      state.authRequired = true;
    }

    if (state.authRequired && !state.isAuthenticated) {
      openModal('loginModal');
    }
  } catch (err) {
    console.error('Error checking auth status:', err);
  }
}

/* ======================================================
   Initialize
====================================================== */
document.addEventListener('DOMContentLoaded', () => {
  // Initialize WebSocket
  initWebSocket();

  // Charts are deferred — initCharts() is called by onPageEnter('dashboard') on first visit

  // Initialize sidebar state (collapse, click delegation) and page router
  initSidebar();
  initRouter();

  // Check auth status
  checkAuthStatus();

  // Table event delegation
  const table = document.getElementById("table");
  if (table) {
    table.addEventListener('click', (e) => {
      // Handle checkbox clicks
      if (e.target.classList.contains('row-checkbox')) {
        const domain = e.target.dataset.domain;
        toggleDomainSelection(domain, e.target.checked);
        return;
      }

      const button = e.target.closest('button[data-action]');
      if (!button) return;

      const row = button.closest('tr');
      const domain = row?.dataset.domain;
      if (!domain) return;

      const action = button.dataset.action;
      if (action === 'delete') {
        deleteDomain(domain);
      } else if (action === 'refresh') {
        refreshOne(domain);
      } else if (action === 'copy') {
        copyToClipboard(domain, button);
      } else if (action === 'health') {
        checkDomainHealth(domain);
      }
    });
  }

  // Select all checkbox
  const selectAllCheckbox = document.getElementById('selectAll');
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', (e) => {
      toggleAllSelection(e.target.checked);
    });
  }

  // Sortable header clicks
  document.querySelectorAll('.sortable-header').forEach(th => {
    th.addEventListener('click', () => {
      const sortKey = th.dataset.sort;
      if (sortKey) handleHeaderSort(sortKey);
    });
  });

  // Search input - debounced
  let searchTimeout;
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(applyFilters, CONFIG.SEARCH_DEBOUNCE_MS);
    });
  }

  // Filter dropdowns
  const filterStatus = document.getElementById('filterStatus');
  if (filterStatus) filterStatus.addEventListener('change', applyFilters);

  const filterRegistrar = document.getElementById('filterRegistrar');
  if (filterRegistrar) filterRegistrar.addEventListener('change', applyFilters);

  const filterGroup = document.getElementById('filterGroup');
  if (filterGroup) filterGroup.addEventListener('change', applyFilters);

  // Sort controls
  const sortBy = document.getElementById('sortBy');
  if (sortBy) sortBy.addEventListener('change', applyFilters);

  const sortOrder = document.getElementById('sortOrder');
  if (sortOrder) sortOrder.addEventListener('change', applyFilters);

  // Domain input - Enter key
  const domainInput = document.getElementById("domainInput");
  if (domainInput) {
    domainInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") addDomain();
    });
  }

  // Bulk operations tabs
  document.querySelectorAll('.bulk-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.bulkTab;
      document.querySelectorAll('.bulk-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.bulk-tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`bulk-tab-${tabId}`)?.classList.add('active');
    });
  });

  // Restore saved filters and update UI inputs
  loadFiltersFromStorage();
  restoreFilterUI();

  // Initial data load is handled by initRouter() → onPageEnter() for the active page
});

/* ======================================================
   Bulk Operations Modal
====================================================== */
function openBulkOpsModal() {
  if (state.selectedDomains.size === 0) {
    showNotification('No domains selected', 'info');
    return;
  }

  // Update count
  document.getElementById('bulkOpsCount').textContent = state.selectedDomains.size;

  // Populate groups dropdown
  const groupSelect = document.getElementById('bulkGroupSelect');
  groupSelect.innerHTML = '<option value="">No Group (Remove from group)</option>' +
    state.groups.map(g => `<option value="${g.id}">${escapeHTML(g.name)}</option>`).join('');

  // Populate tags grid
  const tagsGrid = document.getElementById('bulkTagsSelect');
  tagsGrid.innerHTML = state.tags.map(tag => `
    <label class="bulk-tag-checkbox" data-tag-id="${tag.id}">
      <input type="checkbox" value="${tag.id}">
      <span class="bulk-tag-color" style="background: ${sanitizeColor(tag.color)}"></span>
      <span class="bulk-tag-name">${escapeHTML(tag.name)}</span>
    </label>
  `).join('') || '<p class="info-text">No tags available</p>';

  // Add click handlers for tag checkboxes
  tagsGrid.querySelectorAll('.bulk-tag-checkbox').forEach(label => {
    label.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') {
        const checkbox = label.querySelector('input');
        checkbox.checked = !checkbox.checked;
      }
      label.classList.toggle('selected', label.querySelector('input').checked);
    });
  });

  openModal('bulkOpsModal');
}

async function bulkAssignGroup() {
  const groupId = document.getElementById('bulkGroupSelect').value;
  const domains = Array.from(state.selectedDomains);

  if (domains.length === 0) return;

  showLoading(true);
  let updated = 0, failed = 0;

  for (const domainName of domains) {
    const domain = state.allDomains.find(d => d.domain === domainName);
    if (!domain) continue;

    try {
      const res = await apiFetch(`/api/domains/${domain.id}/group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: groupId ? parseInt(groupId) : null })
      });
      if (res.ok) updated++;
      else failed++;
    } catch {
      failed++;
    }
  }

  showNotification(`Updated ${updated} domain(s)${failed ? `, ${failed} failed` : ''}`, updated > 0 ? 'success' : 'error');
  closeModal('bulkOpsModal');
  clearSelection();
  await load();
}

async function bulkAddTags() {
  const selectedTagIds = Array.from(document.querySelectorAll('#bulkTagsSelect input:checked')).map(cb => parseInt(cb.value));
  const domains = Array.from(state.selectedDomains);

  if (selectedTagIds.length === 0) {
    showNotification('No tags selected', 'info');
    return;
  }

  showLoading(true);
  let updated = 0, failed = 0;

  for (const domainName of domains) {
    const domain = state.allDomains.find(d => d.domain === domainName);
    if (!domain) continue;

    for (const tagId of selectedTagIds) {
      try {
        const res = await fetch(`/api/domains/${domain.id}/tags/${tagId}`, { method: 'POST', credentials: 'same-origin' });
        if (res.ok) updated++;
        else failed++;
      } catch {
        failed++;
      }
    }
  }

  showNotification(`Added tags to ${domains.length} domain(s)`, 'success');
  closeModal('bulkOpsModal');
  clearSelection();
  await load();
}

async function bulkRemoveTags() {
  const selectedTagIds = Array.from(document.querySelectorAll('#bulkTagsSelect input:checked')).map(cb => parseInt(cb.value));
  const domains = Array.from(state.selectedDomains);

  if (selectedTagIds.length === 0) {
    showNotification('No tags selected', 'info');
    return;
  }

  showLoading(true);
  let removed = 0;

  for (const domainName of domains) {
    const domain = state.allDomains.find(d => d.domain === domainName);
    if (!domain) continue;

    for (const tagId of selectedTagIds) {
      try {
        const res = await fetch(`/api/domains/${domain.id}/tags/${tagId}`, { method: 'DELETE', credentials: 'same-origin' });
        if (res.ok) removed++;
      } catch {
        // Ignore errors for removing non-existent tags
      }
    }
  }

  showNotification(`Removed tags from ${domains.length} domain(s)`, 'success');
  closeModal('bulkOpsModal');
  clearSelection();
  await load();
}

async function bulkRefreshWhois() {
  closeModal('bulkOpsModal');
  await refreshSelected();
}

async function bulkCheckHealth() {
  const domains = Array.from(state.selectedDomains);

  if (domains.length === 0) return;

  showLoading(true);
  let checked = 0;

  for (const domainName of domains) {
    const domain = state.allDomains.find(d => d.domain === domainName);
    if (!domain) continue;

    try {
      await apiFetch(`/api/health/domain/${domain.id}`, { method: 'POST' });
      checked++;
    } catch {
      // Continue on error
    }
  }

  showNotification(`Health check completed for ${checked} domain(s)`, 'success');
  closeModal('bulkOpsModal');
  clearSelection();
  await load();
}

async function bulkCheckUptime() {
  const domains = Array.from(state.selectedDomains);

  if (domains.length === 0) return;

  showLoading(true);
  let checked = 0;

  for (const domainName of domains) {
    const domain = state.allDomains.find(d => d.domain === domainName);
    if (!domain) continue;

    try {
      await fetch(`/api/uptime/domain/${domain.id}`, { method: 'POST', credentials: 'same-origin' });
      checked++;
    } catch {
      // Continue on error
    }
  }

  showNotification(`Uptime check completed for ${checked} domain(s)`, 'success');
  closeModal('bulkOpsModal');
  clearSelection();
  showLoading(false);
  loadUptimeStats();
}

async function bulkDeleteDomains() {
  closeModal('bulkOpsModal');
  await deleteSelected();
}

/* ======================================================
   Uptime Monitoring
====================================================== */
async function runUptimeCheckAll() {
  try {
    showNotification('Running uptime check for all domains...', 'info');
    showLoading(true);
    const res = await fetch('/api/uptime/check-all', { method: 'POST', credentials: 'same-origin' });
    const data = await res.json();

    if (res.ok) {
      showNotification(data.message || 'Uptime check completed', 'success');
      // Reload table to show updated uptime data
      await load();
    } else {
      showNotification(data.message || 'Uptime check failed', 'error');
    }
  } catch (err) {
    showNotification('Failed to run uptime check', 'error');
  } finally {
    showLoading(false);
  }
}

async function restartUptimeService() {
  try {
    const res = await fetch('/api/uptime/restart', { method: 'POST', credentials: 'same-origin' });
    if (res.ok) {
      showNotification('Uptime monitoring service restarted', 'success');
    }
  } catch (err) {
    showNotification('Failed to restart uptime service', 'error');
  }
}

/* ======================================================
   Retention Settings
====================================================== */
async function loadRetentionStats() {
  try {
    const res = await fetch('/api/uptime/retention/stats', { credentials: 'same-origin' });
    if (!res.ok) {
      console.error('Failed to fetch retention stats:', res.status);
      return;
    }

    const stats = await res.json();
    console.log('Retention stats:', stats); // Debug

    const auditEl = document.getElementById('auditLogCount');
    const healthEl = document.getElementById('healthLogCount');

    if (auditEl) {
      auditEl.textContent = (stats.auditLog?.totalEntries ?? 0).toLocaleString();
    }
    if (healthEl) {
      healthEl.textContent = (stats.healthLog?.totalEntries ?? 0).toLocaleString();
    }

  } catch (err) {
    console.error('Error loading retention stats:', err);
  }
}

async function runManualCleanup() {
  if (!confirm('Run cleanup now? This will delete old log entries based on your retention settings.')) return;

  try {
    showLoading(true);
    const res = await fetch('/api/uptime/retention/cleanup', { method: 'POST', credentials: 'same-origin' });
    const data = await res.json();

    if (res.ok) {
      showNotification(`Cleanup complete: ${data.auditLogDeleted} audit, ${data.healthLogDeleted} health, ${data.uptimeLogDeleted} uptime records deleted`, 'success');
      loadRetentionStats();
    } else {
      showNotification(data.message || 'Cleanup failed', 'error');
    }
  } catch (err) {
    showNotification('Cleanup failed', 'error');
  } finally {
    showLoading(false);
  }
}

/* ======================================================
   Dashboard Widgets Customization with Drag & Drop
====================================================== */
const DEFAULT_WIDGETS = [
  { id: 'uptime-status', type: 'status', title: 'Site Status', visible: true, position: 0, size: 'sm' },
  { id: 'alerts', type: 'alerts', title: 'Critical Alerts', visible: true, position: 1, size: 'sm' },
  { id: 'health', type: 'chart', title: 'Health Status', visible: true, position: 2, size: 'sm' },
  { id: 'timeline', type: 'chart', title: 'Expiry Timeline', visible: true, position: 3, size: 'md' },
  { id: 'activity', type: 'activity', title: 'Activity Log', visible: true, position: 4, size: 'sm' },
];

let draggedWidget = null;

function getWidgetConfig() {
  const saved = localStorage.getItem('dashboard_widgets_v2');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // Merge with defaults to ensure new widgets are included
      return DEFAULT_WIDGETS.map(def => {
        const saved = parsed.find(p => p.id === def.id);
        return saved ? { ...def, ...saved } : def;
      });
    } catch {
      return [...DEFAULT_WIDGETS];
    }
  }
  return [...DEFAULT_WIDGETS];
}

function saveWidgetConfig(widgets) {
  localStorage.setItem('dashboard_widgets_v2', JSON.stringify(widgets));
}

function toggleWidgetVisibility(widgetId) {
  const widgets = getWidgetConfig();
  const widget = widgets.find(w => w.id === widgetId);
  if (widget) {
    widget.visible = !widget.visible;
    saveWidgetConfig(widgets);
    applyWidgetConfig();
    updateWidgetLayout();
  }
}

function getWidgetElement(widgetId) {
  return document.querySelector(`[data-widget-id="${widgetId}"]`);
}

function applyWidgetConfig() {
  const widgets = getWidgetConfig();
  const chartsArea = document.getElementById('chartsArea');
  if (!chartsArea) return;

  // Sort by position and apply visibility
  const sortedWidgets = [...widgets].sort((a, b) => a.position - b.position);

  sortedWidgets.forEach((widget, index) => {
    const element = getWidgetElement(widget.id);
    if (element) {
      // Special handling for uptime - only show if it has data (controlled by loadUptimeStats)
      if (widget.id === 'uptime') {
        element.style.order = index;
        // Don't change visibility here - let loadUptimeStats control it
      } else {
        element.style.display = widget.visible ? '' : 'none';
        element.style.order = index;
      }

      // Apply size class
      element.classList.remove('widget-sm', 'widget-md', 'widget-lg');
      if (widget.size) {
        element.classList.add(`widget-${widget.size}`);
      }
    }
  });

  // Reorder DOM elements to match config
  sortedWidgets.forEach(widget => {
    const element = getWidgetElement(widget.id);
    if (element && element.parentNode === chartsArea) {
      chartsArea.appendChild(element);
    }
  });

  updateWidgetLayout();
}

function updateWidgetLayout() {
  const chartsArea = document.getElementById('chartsArea');
  if (!chartsArea) return;

  // Count visible widgets
  const visibleWidgets = Array.from(chartsArea.querySelectorAll('.chart-card'))
    .filter(el => el.style.display !== 'none');

  chartsArea.setAttribute('data-widget-count', visibleWidgets.length);
}

// Initialize drag and drop for dashboard widgets
function initWidgetDragDrop() {
  const chartsArea = document.getElementById('chartsArea');
  if (!chartsArea) return;

  const widgets = chartsArea.querySelectorAll('.chart-card[draggable="true"]');

  widgets.forEach(widget => {
    const handle = widget.querySelector('.widget-drag-handle');

    // Prevent drag when not using handle
    widget.addEventListener('dragstart', (e) => {
      // Only allow drag if started from handle
      if (!widget.classList.contains('drag-enabled')) {
        e.preventDefault();
        return;
      }
      draggedWidget = widget;
      widget.classList.add('dragging');
      chartsArea.classList.add('drag-active');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', widget.dataset.widgetId);
    });

    // Enable drag on mousedown on handle
    if (handle) {
      handle.addEventListener('mousedown', () => {
        widget.classList.add('drag-enabled');
      });
    }

    // Drag end
    widget.addEventListener('dragend', () => {
      widget.classList.remove('dragging', 'drag-enabled');
      chartsArea.classList.remove('drag-active');
      chartsArea.querySelectorAll('.chart-card').forEach(w => w.classList.remove('drag-over'));
      draggedWidget = null;

      // Save new order
      saveWidgetOrder();
    });

    // Drag over
    widget.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      if (draggedWidget && draggedWidget !== widget) {
        widget.classList.add('drag-over');
      }
    });

    // Drag leave
    widget.addEventListener('dragleave', () => {
      widget.classList.remove('drag-over');
    });

    // Drop
    widget.addEventListener('drop', (e) => {
      e.preventDefault();
      widget.classList.remove('drag-over');

      if (draggedWidget && draggedWidget !== widget) {
        // Swap positions in DOM
        const allWidgets = Array.from(chartsArea.querySelectorAll('.chart-card'));
        const draggedIndex = allWidgets.indexOf(draggedWidget);
        const dropIndex = allWidgets.indexOf(widget);

        if (draggedIndex < dropIndex) {
          widget.parentNode.insertBefore(draggedWidget, widget.nextSibling);
        } else {
          widget.parentNode.insertBefore(draggedWidget, widget);
        }
      }
    });
  });

  // Reset drag-enabled on mouseup anywhere
  document.addEventListener('mouseup', () => {
    widgets.forEach(w => w.classList.remove('drag-enabled'));
  });
}

function saveWidgetOrder() {
  const chartsArea = document.getElementById('chartsArea');
  if (!chartsArea) return;

  const widgets = getWidgetConfig();
  const orderedElements = Array.from(chartsArea.querySelectorAll('.chart-card[data-widget-id]'));

  orderedElements.forEach((el, index) => {
    const widgetId = el.dataset.widgetId;
    const widget = widgets.find(w => w.id === widgetId);
    if (widget) {
      widget.position = index;
    }
  });

  saveWidgetConfig(widgets);
  showNotification('Dashboard layout saved', 'success');
}

function openWidgetCustomizer() {
  const widgets = getWidgetConfig();

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.id = 'widgetCustomizerModal';
  modal.style.display = 'flex';

  modal.innerHTML = `
    <div class="modal-content modal-sm">
      <div class="modal-header">
        <h2><i class="fa-solid fa-grip"></i> Customize Dashboard</h2>
        <button class="modal-close" onclick="closeWidgetCustomizer()">&times;</button>
      </div>
      <div class="modal-body">
        <p class="info-text">Toggle widgets on/off. Drag widgets on the dashboard to reorder them.</p>
        <div class="widget-list" id="widgetList">
          ${widgets.sort((a, b) => a.position - b.position).map(w => `
            <div class="widget-item" data-widget-id="${w.id}">
              <label class="widget-toggle">
                <input type="checkbox" ${w.visible ? 'checked' : ''} ${w.id === 'uptime' ? 'disabled title="Controlled by uptime data availability"' : ''} onchange="toggleWidgetVisibility('${w.id}')">
                <span class="widget-name">${escapeHTML(w.title)}</span>
              </label>
              <select class="widget-size-select" onchange="setWidgetSize('${w.id}', this.value)" title="Widget size">
                <option value="sm" ${w.size === 'sm' ? 'selected' : ''}>Small</option>
                <option value="md" ${w.size === 'md' ? 'selected' : ''}>Medium</option>
                <option value="lg" ${w.size === 'lg' ? 'selected' : ''}>Large</option>
              </select>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn" onclick="resetWidgetConfig()">Reset to Default</button>
        <button class="btn btn-primary" onclick="closeWidgetCustomizer()">Done</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeWidgetCustomizer();
    }
  });
}

function setWidgetSize(widgetId, size) {
  const widgets = getWidgetConfig();
  const widget = widgets.find(w => w.id === widgetId);
  if (widget) {
    widget.size = size;
    saveWidgetConfig(widgets);
    applyWidgetConfig();
  }
}

function closeWidgetCustomizer() {
  const modal = document.getElementById('widgetCustomizerModal');
  if (modal) {
    modal.remove();
  }
}

function resetWidgetConfig() {
  if (confirm('Reset dashboard to default layout?')) {
    localStorage.removeItem('dashboard_widgets_v2');
    applyWidgetConfig();
    closeWidgetCustomizer();
    openWidgetCustomizer();
    showNotification('Dashboard reset to default', 'success');
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    applyWidgetConfig();
    initWidgetDragDrop();
  }, 100);
});

// Set copyright year dynamically
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('copyrightYear');
  if (el) el.textContent = new Date().getFullYear();
});

/* ======================================================
   Task #13: Expiration Timeline Chart Modal
====================================================== */
let domainTimelineChartInstance = null;

async function openTimelineChart() {
  openModal('timelineModal');
  await renderTimelineChart();
}

async function renderTimelineChart() {
  try {
    const res = await apiFetch('/api/domains?limit=500');
    const json = await res.json();
    const domains = Array.isArray(json.data) ? json.data : [];

    const filter = document.getElementById('timelineFilter')?.value || 'all';
    const now = new Date();
    const day = 24 * 60 * 60 * 1000;

    let filtered = domains.filter(d => {
      if (filter === 'errors') return d.error;
      if (!d.expiry_date) return filter === 'all';
      const expiry = new Date(d.expiry_date);
      const daysLeft = (expiry - now) / day;
      if (filter === 'expiring90') return daysLeft <= 90;
      if (filter === 'expiring365') return daysLeft <= 365;
      return true;
    });

    // Sort by expiry date (soonest first, no-expiry at end)
    filtered.sort((a, b) => {
      if (!a.expiry_date && !b.expiry_date) return 0;
      if (!a.expiry_date) return 1;
      if (!b.expiry_date) return -1;
      return parseUTC(a.expiry_date) - parseUTC(b.expiry_date);
    });

    // Limit to 50 for readability
    if (filtered.length > 50) filtered = filtered.slice(0, 50);

    const countEl = document.getElementById('timelineCount');
    if (countEl) countEl.textContent = 'Showing ' + filtered.length + ' domains';

    const labels = filtered.map(d => d.domain.length > 30 ? d.domain.slice(0, 27) + '...' : d.domain);
    const today = now.getTime();
    const maxDate = new Date(now.getTime() + 365 * day).getTime();

    const barData = filtered.map(d => {
      if (!d.expiry_date) return [today, today + 30 * day];
      const expiry = parseUTC(d.expiry_date).getTime();
      if (expiry < today) return [expiry - 30 * day, expiry];
      return [today, expiry];
    });

    const colors = filtered.map(d => {
      if (d.error) return 'rgba(239, 68, 68, 0.8)';
      if (!d.expiry_date) return 'rgba(100, 116, 139, 0.6)';
      const expiry = parseUTC(d.expiry_date);
      const daysLeft = (expiry - now) / day;
      if (daysLeft < 0) return 'rgba(239, 68, 68, 0.9)';
      if (daysLeft < 7) return 'rgba(239, 68, 68, 0.8)';
      if (daysLeft < 30) return 'rgba(245, 158, 11, 0.8)';
      return 'rgba(34, 197, 94, 0.7)';
    });

    const canvas = document.getElementById('domainTimelineChart');
    if (!canvas) return;

    if (domainTimelineChartInstance) {
      domainTimelineChartInstance.destroy();
      domainTimelineChartInstance = null;
    }

    const barHeight = 28;
    canvas.height = Math.max(300, filtered.length * barHeight + 60);

    const ctx = canvas.getContext('2d');
    domainTimelineChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Expiration Window',
          data: barData,
          backgroundColor: colors,
          borderColor: colors.map(c => c.replace(/0\.[678]9?\)/, '1)')),
          borderWidth: 1,
          borderRadius: 4,
          barThickness: 20,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                const d = filtered[ctx.dataIndex];
                if (!d.expiry_date) return d.error ? 'Error: ' + d.error.slice(0, 60) : 'No expiry date';
                const expiry = parseUTC(d.expiry_date);
                const daysLeft = Math.round((expiry - now) / day);
                if (daysLeft < 0) return 'Expired ' + Math.abs(daysLeft) + ' days ago (' + formatDate(d.expiry_date) + ')';
                return 'Expires in ' + daysLeft + ' days (' + formatDate(d.expiry_date) + ')';
              }
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            min: today - 30 * day,
            max: maxDate,
            ticks: {
              callback: function(val) {
                return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: appTimezone }).format(new Date(val));
              },
              maxTicksLimit: 8,
              color: '#8892a4',
            },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            ticks: { color: '#e2e8f0', font: { size: 11 } },
            grid: { color: 'rgba(255,255,255,0.05)' },
          }
        }
      }
    });
  } catch (err) {
    console.error('Timeline chart error:', err);
  }
}

/* ======================================================
   Task #14: Response Time Trend Chart
====================================================== */
let responseTimeChartInstance = null;

async function loadResponseTimeChart(domainId) {
  try {
    const res = await fetch('/api/uptime/domain/' + domainId + '?limit=100', { credentials: 'same-origin' });
    if (!res.ok) return;
    const checks = await res.json();

    const canvas = document.getElementById('responseTimeChart');
    const emptyMsg = document.getElementById('responseTimeEmpty');
    if (!canvas) return;

    if (responseTimeChartInstance) {
      responseTimeChartInstance.destroy();
      responseTimeChartInstance = null;
    }

    const validChecks = (checks || []).filter(c => c.status === 'up' && c.response_time_ms > 0).slice(0, 100).reverse();

    if (validChecks.length === 0) {
      if (emptyMsg) emptyMsg.style.display = '';
      canvas.style.display = 'none';
      return;
    }

    if (emptyMsg) emptyMsg.style.display = 'none';
    canvas.style.display = '';

    const labels = validChecks.map(c => {
      const d = parseUTC(c.checked_at);
      return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: appTimezone }).format(d);
    });
    const data = validChecks.map(c => c.response_time_ms);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;

    const ctx = canvas.getContext('2d');
    responseTimeChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Response Time (ms)',
          data,
          borderColor: 'rgba(99, 102, 241, 0.8)',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 5,
          fill: true,
          tension: 0.3,
        }, {
          label: 'Avg: ' + Math.round(avg) + 'ms',
          data: data.map(() => Math.round(avg)),
          borderColor: 'rgba(245, 158, 11, 0.6)',
          borderDash: [5, 5],
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#8892a4', font: { size: 11 } } },
          tooltip: { callbacks: { label: function(ctx) { return ctx.dataset.label + ': ' + ctx.parsed.y + 'ms'; } } }
        },
        scales: {
          x: { display: false },
          y: {
            ticks: { color: '#8892a4', font: { size: 11 }, callback: function(v) { return v + 'ms'; } },
            grid: { color: 'rgba(255,255,255,0.05)' },
            beginAtZero: true,
          }
        }
      }
    });
  } catch (err) {
    console.error('Response time chart error:', err);
  }
}

/* ======================================================
   Task #15: Notification History Sidebar
====================================================== */
let notifOpen = false;
let notifLastRead = parseInt(localStorage.getItem('notifLastRead') || '0', 10);

function toggleNotificationSidebar() {
  notifOpen = !notifOpen;
  const sidebar = document.getElementById('notifSidebar');
  const overlay = document.getElementById('notifOverlay');
  if (!sidebar || !overlay) return;

  if (notifOpen) {
    overlay.style.display = '';
    requestAnimationFrame(() => sidebar.classList.add('open'));
    loadNotifications();
    notifLastRead = Date.now();
    localStorage.setItem('notifLastRead', String(notifLastRead));
    updateNotifBadge(0);
  } else {
    sidebar.classList.remove('open');
    overlay.style.display = 'none';
  }
}

function markAllNotifsRead() {
  notifLastRead = Date.now();
  localStorage.setItem('notifLastRead', String(notifLastRead));
  updateNotifBadge(0);
  document.querySelectorAll('.notif-item.unread').forEach(el => el.classList.remove('unread'));
}

function updateNotifBadge(count) {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function notifCapitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

async function loadNotifications() {
  const list = document.getElementById('notifList');
  if (!list) return;

  try {
    const res = await fetch('/api/audit?limit=30', { credentials: 'same-origin' });
    const data = await res.json();
    const events = Array.isArray(data.entries) ? data.entries : (Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []));

    if (events.length === 0) {
      list.innerHTML = '<p class="notif-empty">No notifications yet.</p>';
      return;
    }

    const itemsHtml = events.map(evt => {
      const evtTime = parseUTC(evt.created_at).getTime();
      const isUnread = evtTime > notifLastRead;
      const timeAgo = notifFormatTimeAgo(evtTime);

      let iconClass = 'fa-circle-info';
      let color = 'blue';
      let title = notifCapitalize(evt.action) + ' ' + notifCapitalize(evt.entity_type);

      if (evt.action === 'create') { iconClass = 'fa-plus-circle'; color = 'green'; title = notifCapitalize(evt.entity_type) + ' created'; }
      else if (evt.action === 'delete') { iconClass = 'fa-trash'; color = 'red'; title = notifCapitalize(evt.entity_type) + ' deleted'; }
      else if (evt.action === 'update') { iconClass = 'fa-pen-to-square'; color = 'blue'; title = notifCapitalize(evt.entity_type) + ' updated'; }
      else if (evt.action === 'login') { iconClass = 'fa-right-to-bracket'; color = 'blue'; title = 'User logged in'; }
      else if (evt.action === 'logout') { iconClass = 'fa-right-from-bracket'; color = 'blue'; title = 'User logged out'; }
      else if (evt.action === 'email_sent') { iconClass = 'fa-envelope'; color = 'yellow'; title = 'Alert email sent'; }

      const body = (evt.entity_id && evt.entity_id !== 'auth') ? escapeHTML(String(evt.entity_id)) : '';

      return '<div class="notif-item' + (isUnread ? ' unread' : '') + '">' +
        '<div class="notif-item-header">' +
        '<span class="notif-item-icon ' + color + '"><i class="fa-solid ' + iconClass + '"></i></span>' +
        '<span class="notif-item-title">' + escapeHTML(title) + '</span>' +
        '<span class="notif-item-time">' + timeAgo + '</span>' +
        '</div>' +
        (body ? '<div class="notif-item-body">' + body + '</div>' : '') +
        '</div>';
    }).join('');

    list.innerHTML = itemsHtml;
  } catch (err) {
    console.error('Notification load error:', err);
    list.innerHTML = '<p class="notif-empty">Failed to load notifications.</p>';
  }
}

function notifFormatTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  return days + 'd ago';
}

async function checkNotifications() {
  try {
    const res = await fetch('/api/audit?limit=5', { credentials: 'same-origin' });
    const data = await res.json();
    const events = Array.isArray(data.entries) ? data.entries : (Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []));
    const unread = events.filter(e => parseUTC(e.created_at).getTime() > notifLastRead).length;
    if (!notifOpen) updateNotifBadge(unread);
  } catch (_) { /* silent */ }
}

// Poll for new notifications every 60 seconds
setInterval(checkNotifications, 60000);
// Check on page load after a small delay
setTimeout(checkNotifications, 3000);

/* ======================================================
   Timezone Settings
====================================================== */

// Common IANA timezone values (labels are computed dynamically with the live offset).
const TIMEZONE_LIST = [
  // UTC
  { value: 'UTC',                                city: 'UTC' },
  // Americas — North
  { value: 'America/New_York',                   city: 'Eastern Time — New York' },
  { value: 'America/Detroit',                    city: 'Eastern Time — Detroit' },
  { value: 'America/Indiana/Indianapolis',       city: 'Eastern Time — Indianapolis' },
  { value: 'America/Chicago',                    city: 'Central Time — Chicago' },
  { value: 'America/Winnipeg',                   city: 'Central Time — Winnipeg' },
  { value: 'America/Denver',                     city: 'Mountain Time — Denver' },
  { value: 'America/Boise',                      city: 'Mountain Time — Boise' },
  { value: 'America/Phoenix',                    city: 'Mountain Time — Phoenix (no DST)' },
  { value: 'America/Los_Angeles',                city: 'Pacific Time — Los Angeles' },
  { value: 'America/Anchorage',                  city: 'Alaska — Anchorage' },
  { value: 'Pacific/Honolulu',                   city: 'Hawaii — Honolulu' },
  { value: 'America/Toronto',                    city: 'Canada — Toronto' },
  { value: 'America/Vancouver',                  city: 'Canada — Vancouver' },
  { value: 'America/Edmonton',                   city: 'Canada — Edmonton' },
  { value: 'America/Halifax',                    city: 'Canada — Halifax' },
  { value: 'America/St_Johns',                   city: 'Canada — St. Johns' },
  // Americas — Mexico & Central America
  { value: 'America/Mexico_City',                city: 'Mexico — Mexico City' },
  { value: 'America/Monterrey',                  city: 'Mexico — Monterrey' },
  { value: 'America/Tijuana',                    city: 'Mexico — Tijuana' },
  { value: 'America/Guatemala',                  city: 'Guatemala' },
  { value: 'America/Belize',                     city: 'Belize' },
  { value: 'America/El_Salvador',                city: 'El Salvador' },
  { value: 'America/Tegucigalpa',                city: 'Honduras' },
  { value: 'America/Managua',                    city: 'Nicaragua' },
  { value: 'America/Costa_Rica',                 city: 'Costa Rica' },
  { value: 'America/Panama',                     city: 'Panama' },
  // Americas — Caribbean
  { value: 'America/Havana',                     city: 'Cuba — Havana' },
  { value: 'America/Jamaica',                    city: 'Jamaica' },
  { value: 'America/Puerto_Rico',                city: 'Puerto Rico' },
  { value: 'America/Santo_Domingo',              city: 'Dominican Republic' },
  // Americas — South
  { value: 'America/Bogota',                     city: 'Colombia — Bogotá' },
  { value: 'America/Lima',                       city: 'Peru — Lima' },
  { value: 'America/Caracas',                    city: 'Venezuela — Caracas' },
  { value: 'America/Guayaquil',                  city: 'Ecuador — Guayaquil' },
  { value: 'America/La_Paz',                     city: 'Bolivia — La Paz' },
  { value: 'America/Santiago',                   city: 'Chile — Santiago' },
  { value: 'America/Sao_Paulo',                  city: 'Brazil — São Paulo' },
  { value: 'America/Manaus',                     city: 'Brazil — Manaus' },
  { value: 'America/Argentina/Buenos_Aires',     city: 'Argentina — Buenos Aires' },
  { value: 'America/Montevideo',                 city: 'Uruguay — Montevideo' },
  { value: 'America/Asuncion',                   city: 'Paraguay — Asunción' },
  // Europe
  { value: 'Europe/London',                      city: 'UK — London' },
  { value: 'Europe/Dublin',                      city: 'Ireland — Dublin' },
  { value: 'Europe/Lisbon',                      city: 'Portugal — Lisbon' },
  { value: 'Europe/Madrid',                      city: 'Spain — Madrid' },
  { value: 'Europe/Paris',                       city: 'France — Paris' },
  { value: 'Europe/Berlin',                      city: 'Germany — Berlin' },
  { value: 'Europe/Rome',                        city: 'Italy — Rome' },
  { value: 'Europe/Amsterdam',                   city: 'Netherlands — Amsterdam' },
  { value: 'Europe/Brussels',                    city: 'Belgium — Brussels' },
  { value: 'Europe/Zurich',                      city: 'Switzerland — Zurich' },
  { value: 'Europe/Vienna',                      city: 'Austria — Vienna' },
  { value: 'Europe/Prague',                      city: 'Czech Republic — Prague' },
  { value: 'Europe/Budapest',                    city: 'Hungary — Budapest' },
  { value: 'Europe/Stockholm',                   city: 'Sweden — Stockholm' },
  { value: 'Europe/Oslo',                        city: 'Norway — Oslo' },
  { value: 'Europe/Copenhagen',                  city: 'Denmark — Copenhagen' },
  { value: 'Europe/Warsaw',                      city: 'Poland — Warsaw' },
  { value: 'Europe/Athens',                      city: 'Greece — Athens' },
  { value: 'Europe/Helsinki',                    city: 'Finland — Helsinki' },
  { value: 'Europe/Riga',                        city: 'Latvia — Riga' },
  { value: 'Europe/Tallinn',                     city: 'Estonia — Tallinn' },
  { value: 'Europe/Vilnius',                     city: 'Lithuania — Vilnius' },
  { value: 'Europe/Bucharest',                   city: 'Romania — Bucharest' },
  { value: 'Europe/Sofia',                       city: 'Bulgaria — Sofia' },
  { value: 'Europe/Belgrade',                    city: 'Serbia — Belgrade' },
  { value: 'Europe/Kiev',                        city: 'Ukraine — Kyiv' },
  { value: 'Europe/Minsk',                       city: 'Belarus — Minsk' },
  { value: 'Europe/Istanbul',                    city: 'Turkey — Istanbul' },
  { value: 'Europe/Moscow',                      city: 'Russia — Moscow' },
  // Africa
  { value: 'Africa/Abidjan',                     city: 'Ivory Coast — Abidjan' },
  { value: 'Africa/Accra',                       city: 'Ghana — Accra' },
  { value: 'Africa/Dakar',                       city: 'Senegal — Dakar' },
  { value: 'Africa/Casablanca',                  city: 'Morocco — Casablanca' },
  { value: 'Africa/Lagos',                       city: 'Nigeria — Lagos' },
  { value: 'Africa/Cairo',                       city: 'Egypt — Cairo' },
  { value: 'Africa/Nairobi',                     city: 'Kenya — Nairobi' },
  { value: 'Africa/Addis_Ababa',                 city: 'Ethiopia — Addis Ababa' },
  { value: 'Africa/Johannesburg',                city: 'South Africa — Johannesburg' },
  // Middle East
  { value: 'Asia/Beirut',                        city: 'Lebanon — Beirut' },
  { value: 'Asia/Jerusalem',                     city: 'Israel — Jerusalem' },
  { value: 'Asia/Amman',                         city: 'Jordan — Amman' },
  { value: 'Asia/Riyadh',                        city: 'Saudi Arabia — Riyadh' },
  { value: 'Asia/Kuwait',                        city: 'Kuwait' },
  { value: 'Asia/Qatar',                         city: 'Qatar — Doha' },
  { value: 'Asia/Dubai',                         city: 'UAE — Dubai' },
  { value: 'Asia/Tehran',                        city: 'Iran — Tehran' },
  { value: 'Asia/Baghdad',                       city: 'Iraq — Baghdad' },
  // Asia
  { value: 'Asia/Karachi',                       city: 'Pakistan — Karachi' },
  { value: 'Asia/Kabul',                         city: 'Afghanistan — Kabul' },
  { value: 'Asia/Tashkent',                      city: 'Uzbekistan — Tashkent' },
  { value: 'Asia/Kolkata',                       city: 'India — Kolkata' },
  { value: 'Asia/Colombo',                       city: 'Sri Lanka — Colombo' },
  { value: 'Asia/Kathmandu',                     city: 'Nepal — Kathmandu' },
  { value: 'Asia/Dhaka',                         city: 'Bangladesh — Dhaka' },
  { value: 'Asia/Rangoon',                       city: 'Myanmar — Yangon' },
  { value: 'Asia/Bangkok',                       city: 'Thailand — Bangkok' },
  { value: 'Asia/Ho_Chi_Minh',                   city: 'Vietnam — Ho Chi Minh City' },
  { value: 'Asia/Phnom_Penh',                    city: 'Cambodia — Phnom Penh' },
  { value: 'Asia/Vientiane',                     city: 'Laos — Vientiane' },
  { value: 'Asia/Jakarta',                       city: 'Indonesia — Jakarta' },
  { value: 'Asia/Kuala_Lumpur',                  city: 'Malaysia — Kuala Lumpur' },
  { value: 'Asia/Singapore',                     city: 'Singapore' },
  { value: 'Asia/Manila',                        city: 'Philippines — Manila' },
  { value: 'Asia/Hong_Kong',                     city: 'Hong Kong' },
  { value: 'Asia/Shanghai',                      city: 'China — Shanghai' },
  { value: 'Asia/Taipei',                        city: 'Taiwan — Taipei' },
  { value: 'Asia/Seoul',                         city: 'South Korea — Seoul' },
  { value: 'Asia/Tokyo',                         city: 'Japan — Tokyo' },
  { value: 'Asia/Ulaanbaatar',                   city: 'Mongolia — Ulaanbaatar' },
  // Pacific
  { value: 'Australia/Perth',                    city: 'Australia — Perth' },
  { value: 'Australia/Darwin',                   city: 'Australia — Darwin' },
  { value: 'Australia/Adelaide',                 city: 'Australia — Adelaide' },
  { value: 'Australia/Brisbane',                 city: 'Australia — Brisbane' },
  { value: 'Australia/Sydney',                   city: 'Australia — Sydney' },
  { value: 'Australia/Melbourne',                city: 'Australia — Melbourne' },
  { value: 'Pacific/Auckland',                   city: 'New Zealand — Auckland' },
  { value: 'Pacific/Fiji',                       city: 'Fiji' },
  { value: 'Pacific/Guam',                       city: 'Guam' },
];

// Compute the current UTC offset string for an IANA timezone, e.g. "UTC-6" or "UTC+5:30"
function getLiveOffset(tzValue) {
  try {
    // Use a fixed reference time (now) so the offset reflects the current DST state
    const now = new Date();
    // Intl gives us the offset via timeZoneName:'shortOffset' (e.g. "GMT-6")
    const parts = new Intl.DateTimeFormat('en', { timeZone: tzValue, timeZoneName: 'shortOffset' })
      .formatToParts(now);
    const offsetPart = parts.find(p => p.type === 'timeZoneName');
    if (!offsetPart) return '';
    // Convert "GMT+0" → "UTC+0", "GMT-6" → "UTC-6", etc.
    return offsetPart.value.replace('GMT', 'UTC');
  } catch {
    return '';
  }
}

function populateTimezoneSelect(selected) {
  const sel = document.getElementById('settingTimezone');
  if (!sel) return;
  sel.innerHTML = '';
  TIMEZONE_LIST.forEach(tz => {
    const opt = document.createElement('option');
    opt.value = tz.value;
    const offset = getLiveOffset(tz.value);
    opt.textContent = offset ? `${tz.city} (${offset})` : tz.city;
    if (tz.value === selected) opt.selected = true;
    sel.appendChild(opt);
  });
  // If the saved value isn't in the list, add it as a custom option at the top
  if (selected && !TIMEZONE_LIST.find(t => t.value === selected)) {
    const opt = document.createElement('option');
    opt.value = selected;
    const offset = getLiveOffset(selected);
    opt.textContent = offset ? `${selected} (${offset})` : selected;
    opt.selected = true;
    sel.insertBefore(opt, sel.firstChild);
  }
  // Update appTimezone whenever the user changes the select (live preview)
  sel.onchange = () => {
    appTimezone = sel.value;
    // Live preview: re-render the domain table and activity log so dates update as the user browses
    load();
    loadActivityLog();
  };
}

function detectTimezone() {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected) {
      appTimezone = detected;
      populateTimezoneSelect(detected);
      // Re-render all dates immediately — onchange only fires on user interaction
      load();
      loadActivityLog();
      const offset = getLiveOffset(detected);
      const inList = TIMEZONE_LIST.find(t => t.value === detected);
      const label = inList ? inList.city : detected;
      showNotification(`Timezone set to ${label}${offset ? ' (' + offset + ')' : ''}`, 'info');
    }
  } catch (e) {
    showNotification('Could not detect timezone automatically', 'error');
  }
}
