/* ======================================================
   Domain Monitor - Frontend Application
   Features: WebSocket, Charts, Auth, Groups, Tags, Health
====================================================== */

/* ======================================================
   Error Boundary
====================================================== */
window.onerror = function(message, source, lineno, colno, error) {
  console.error('Global error:', { message, source, lineno, colno, error });
  showErrorBoundary(message);
  return true;
};

window.onunhandledrejection = function(event) {
  console.error('Unhandled promise rejection:', event.reason);
  showNotification('An error occurred: ' + (event.reason?.message || 'Unknown error'), 'error');
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
   Utilities
====================================================== */
const DAY_MS = 86400000;

const formatDate = v => v ? new Date(v).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "-";
const formatDateTime = v => v ? new Date(v).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "-";

const getDomainAge = created => {
  if (!created) return "—";
  const c = new Date(created), n = new Date();
  let years = n.getFullYear() - c.getFullYear(), months = n.getMonth() - c.getMonth();
  if (months < 0) { years--; months += 12; }
  const parts = [];
  if (years) parts.push(`${years} yr${years > 1 ? "s" : ""}`);
  if (months) parts.push(`${months} month${months > 1 ? "s" : ""}`);
  return parts.join(" ") || "—";
};

const getExpiryDays = expiry => expiry ? Math.ceil((new Date(expiry) - new Date()) / DAY_MS) : null;

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
  }, 5000);
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
    timeline: null
  },
  importFile: null
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
      // Reconnect with exponential backoff
      const delay = Math.min(1000 * Math.pow(2, state.wsReconnectAttempts), 30000);
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
  switch (message.type) {
    case 'refresh_progress':
      showRefreshProgress(true, message.data.completed, message.data.total);
      if (message.data.completed === message.data.total) {
        showRefreshProgress(false);
        state.isRefreshing = false;
        showNotification('Refresh complete!', 'success');
        load();
      }
      break;

    case 'domain_update':
      // Update single domain in table without full reload
      updateDomainInTable(message.data);
      break;

    case 'health_update':
      // Update health indicator for domain
      updateHealthIndicator(message.data.domainId, message.data.health);
      break;

    case 'auth_required':
      state.authRequired = true;
      if (!state.isAuthenticated) {
        openModal('loginModal');
      }
      break;

    default:
      console.log('Unknown WebSocket message type:', message.type);
  }
}

function updateConnectionStatus(connected) {
  const statusEl = document.getElementById('connectionStatus');
  if (statusEl) {
    statusEl.className = `connection-status ${connected ? 'connected' : 'disconnected'}`;
    statusEl.title = connected ? 'Connected' : 'Disconnected';
  }
}

function updateDomainInTable(domain) {
  // Find and update the domain row
  const row = document.querySelector(`tr[data-domain="${escapeHTML(domain.domain)}"]`);
  if (row) {
    // Update just the changed cells instead of full reload
    load();
  }
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

/* ======================================================
   Charts
====================================================== */
function initCharts() {
  const expirationCtx = document.getElementById('expirationChart')?.getContext('2d');
  const timelineCtx = document.getElementById('timelineChart')?.getContext('2d');

  if (expirationCtx) {
    state.charts.expiration = new Chart(expirationCtx, {
      type: 'doughnut',
      data: {
        labels: ['Expired', '< 30 days', '< 90 days', '< 180 days', '> 180 days'],
        datasets: [{
          data: [0, 0, 0, 0, 0],
          backgroundColor: [
            '#851130',
            '#a84803',
            '#a8a503',
            '#00905b',
            '#384b86'
          ],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: '#b5b5b5',
              font: { size: 11 }
            }
          }
        }
      }
    });
  }

  if (timelineCtx) {
    state.charts.timeline = new Chart(timelineCtx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{
          label: 'Domains Expiring',
          data: [],
          backgroundColor: '#6366f1',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#8a8a8a' }
          },
          y: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#8a8a8a', stepSize: 1 }
          }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });
  }
}

function updateCharts(domains) {
  if (!domains || !domains.length) return;

  // Expiration distribution chart
  const stats = { expired: 0, exp30: 0, exp90: 0, exp180: 0, safe: 0 };
  domains.forEach(d => {
    const days = getExpiryDays(d.expiry_date);
    if (days === null) return;
    if (days <= 0) stats.expired++;
    else if (days <= 30) stats.exp30++;
    else if (days <= 90) stats.exp90++;
    else if (days <= 180) stats.exp180++;
    else stats.safe++;
  });

  if (state.charts.expiration) {
    state.charts.expiration.data.datasets[0].data = [
      stats.expired, stats.exp30, stats.exp90, stats.exp180, stats.safe
    ];
    state.charts.expiration.update();
  }

  // Timeline chart - group by month
  const monthCounts = {};
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    monthCounts[key] = 0;
  }

  domains.forEach(d => {
    if (!d.expiry_date) return;
    const expiry = new Date(d.expiry_date);
    const key = expiry.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    if (monthCounts.hasOwnProperty(key)) {
      monthCounts[key]++;
    }
  });

  if (state.charts.timeline) {
    state.charts.timeline.data.labels = Object.keys(monthCounts);
    state.charts.timeline.data.datasets[0].data = Object.values(monthCounts);
    state.charts.timeline.update();
  }
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
        const aExpiry = a.expiry_date ? new Date(a.expiry_date) : new Date(8640000000000000);
        const bExpiry = b.expiry_date ? new Date(b.expiry_date) : new Date(8640000000000000);
        comparison = aExpiry - bExpiry;
        break;
      case 'age':
        const aCreated = a.created_date ? new Date(a.created_date) : new Date();
        const bCreated = b.created_date ? new Date(b.created_date) : new Date();
        comparison = aCreated - bCreated;
        break;
      case 'lastChecked':
        const aChecked = a.last_checked ? new Date(a.last_checked) : new Date(0);
        const bChecked = b.last_checked ? new Date(b.last_checked) : new Date(0);
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
   Health Indicator
====================================================== */
function renderHealthIndicator(health) {
  if (!health) {
    return `<div class="health-indicator">
      <span class="health-dot dns" title="DNS: Unknown"></span>
      <span class="health-dot http" title="HTTP: Unknown"></span>
      <span class="health-dot ssl" title="SSL: Unknown"></span>
    </div>`;
  }

  const dnsClass = health.dns_resolved ? 'ok' : 'error';
  const httpClass = health.http_status ? (health.http_status < 400 ? 'ok' : 'error') : '';
  const sslClass = health.ssl_valid === true ? 'ok' : (health.ssl_valid === false ? 'error' : '');

  return `<div class="health-indicator">
    <span class="health-dot dns ${dnsClass}" title="DNS: ${health.dns_resolved ? 'OK' : 'Failed'}"></span>
    <span class="health-dot http ${httpClass}" title="HTTP: ${health.http_status || 'N/A'}"></span>
    <span class="health-dot ssl ${sslClass}" title="SSL: ${health.ssl_valid ? 'Valid' : (health.ssl_valid === false ? 'Invalid' : 'N/A')}"></span>
  </div>`;
}

/* ======================================================
   Tags Renderer
====================================================== */
function renderTags(tags) {
  if (!tags || tags.length === 0) return '-';
  return tags.map(tag => `<span class="tag-badge" style="background: ${tag.color}">${escapeHTML(tag.name)}</span>`).join(' ');
}

/* ======================================================
   Load table & dashboard with filters
====================================================== */
async function load() {
  try {
    showLoading(true);

    // Load domains, groups, and tags in parallel
    const [domainsRes, groupsRes, tagsRes] = await Promise.all([
      fetch("/api/domains?include=tags"),
      fetch("/api/groups"),
      fetch("/api/tags")
    ]);

    if (!domainsRes.ok) {
      const error = await domainsRes.json().catch(() => ({ message: 'Failed to load domains' }));
      throw new Error(error.message);
    }

    const allDomains = await domainsRes.json();
    state.allDomains = allDomains;

    if (groupsRes.ok) {
      state.groups = await groupsRes.json();
    }

    if (tagsRes.ok) {
      state.tags = await tagsRes.json();
    }

    // Update group filter dropdown
    updateGroupFilter();

    // Apply filters
    let filteredDomains = allDomains.filter(d => matchesFilters(d, FILTERS));

    // Apply sorting
    filteredDomains = sortDomains(filteredDomains, FILTERS.sortBy, FILTERS.sortOrder);

    // Calculate stats from ALL domains
    const stats = { expired: 0, exp15: 0, exp30: 0, exp90: 0, exp180: 0, unchecked: 0 };
    allDomains.forEach(d => {
      if (!d.last_checked) {
        stats.unchecked++;
      }
      const days = getExpiryDays(d.expiry_date);
      if (days !== null) {
        if (days <= 0) stats.expired++;
        else {
          if (days <= 15) stats.exp15++;
          if (days <= 30) stats.exp30++;
          if (days <= 90) stats.exp90++;
          if (days <= 180) stats.exp180++;
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
          <td>${group ? `<span class="group-badge"><span class="group-badge-dot" style="background: ${group.color}"></span>${escapeHTML(group.name)}</span>` : '-'}</td>
          <td>${renderTags(d.tags)}</td>
          <td>${escapeHTML(d.registrar) || "-"}</td>
          <td>${formatDate(d.expiry_date)}</td>
          <td class="${statusClass}">${days ?? "-"}${days !== null ? " days" : ""}</td>
          <td class="ns-servers" style="color:${nsChanged ? "var(--danger)" : "inherit"}">${nsHTML}</td>
          <td>${formatDate(d.created_date)}</td>
          <td>${getDomainAge(d.created_date)}</td>
          <td>${formatDateTime(d.last_checked)}</td>
          <td>${renderHealthIndicator(d.health)}</td>
          <td class="less"><button class="refresh-btn" data-action="refresh" title="Refresh WHOIS"><i class="fa-solid fa-arrows-rotate"></i></button></td>
          <td class="less"><button class="health-btn" data-action="health" title="Check Health"><i class="fa-solid fa-heart-pulse"></i></button></td>
          <td class="less"><button class="delete-btn" data-action="delete" title="Delete domain"><i class="fa-solid fa-trash"></i></button></td>
        </tr>`;
    }).join("");

    // Update selection UI after render
    updateSelectionUI();

    // Update result count
    updateResultCount(filteredDomains.length, allDomains.length);

    // Update dashboard
    document.getElementById("totalDomains").innerText = allDomains.length;
    document.getElementById("expired").innerText = stats.expired;
    document.getElementById("exp15").innerText = stats.exp15;
    document.getElementById("exp30").innerText = stats.exp30;
    document.getElementById("exp90").innerText = stats.exp90;
    document.getElementById("exp180").innerText = stats.exp180;
    document.getElementById("unchecked").innerText = stats.unchecked;

    // Update sort header indicators
    updateSortHeaders();

    // Update registrar dropdown
    updateRegistrarFilter(allDomains);

    // Update charts
    updateCharts(allDomains);

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

  load();
}

/* ======================================================
   CRUD Actions
====================================================== */
async function addDomain() {
  const input = document.getElementById("domainInput");
  const domain = input.value.trim();

  if (!domain) {
    showNotification("Please enter a domain", 'error');
    return;
  }

  try {
    showLoading(true);
    const res = await fetch("/api/domains", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({domain})
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.message || "Failed to add domain");
    }

    input.value = "";
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
    const res = await fetch(`/api/domains/${encodeURIComponent(domain)}`, { method: "DELETE" });

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
      const res = await fetch(`/api/domains/${encodeURIComponent(domain)}`, { method: "DELETE" });
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

  if (!confirm(`Refresh ${domains.length} domain(s)?`)) return;

  showLoading(true);
  let refreshed = 0, failed = 0;

  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i];
    try {
      const res = await fetch(`/api/refresh/${encodeURIComponent(domain)}`, { method: "POST" });
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
      const res = await fetch(`/api/domains/${domain.id}/group`, {
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
    const domainsRes = await fetch('/api/domains');
    const domains = await domainsRes.json();

    if (domains.length === 0) {
      showNotification("No domains to refresh", 'info');
      return;
    }

    if (!confirm(`Refresh ${domains.length} domain(s)?\n\nThis will query WHOIS data for all domains.`)) return;

    state.isRefreshing = true;
    showLoading(true);
    showRefreshProgress(true, 0, domains.length);

    const res = await fetch("/api/refresh", { method: "POST" });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.message || "Failed to refresh");
    }

    showNotification(data.message || "Refresh started", 'info');

    // WebSocket will handle progress updates

  } catch (err) {
    console.error("Error refreshing:", err);
    showNotification(err.message, 'error');
    state.isRefreshing = false;
    showRefreshProgress(false);
    showLoading(false);
  }
}

async function refreshOne(domain) {
  try {
    showLoading(true);
    const res = await fetch(`/api/refresh/${encodeURIComponent(domain)}`, { method: "POST" });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || "Failed to refresh");
    }

    showNotification(`Domain ${domain} refreshed`, 'success');
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
    const res = await fetch(`/api/health/domain/${domainObj.id}`, { method: "POST" });

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
    const res = await fetch('/api/health/check-all', { method: 'POST' });

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
    const res = await fetch('/api/settings');
    if (!res.ok) return;

    const settings = await res.json();

    // Populate form fields
    document.getElementById('settingAlertDays').value = settings.alert_days?.[0] || 30;
    document.getElementById('settingCron').value = settings.refresh_schedule || '0 0 * * *';
    document.getElementById('settingEmailEnabled').checked = settings.email_enabled || false;
    document.getElementById('settingEmailRecipients').value = (settings.email_recipients || []).join(', ');
    document.getElementById('settingAlertDaysEmail').value = (settings.alert_days || [7, 14, 30]).join(', ');

    // Load API keys
    loadApiKeys();

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

    const settings = {
      refresh_schedule: document.getElementById('settingCron').value,
      email_enabled: document.getElementById('settingEmailEnabled').checked,
      email_recipients: emailRecipients,
      alert_days: alertDays.length > 0 ? alertDays : [7, 14, 30]
    };

    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to save settings');
    }

    showNotification('Settings saved successfully', 'success');
    closeModal('settingsModal');

  } catch (err) {
    console.error('Error saving settings:', err);
    showNotification(err.message, 'error');
  }
}

function setCronPreset(cron) {
  document.getElementById('settingCron').value = cron;
}

async function testEmailSettings() {
  try {
    const email = document.getElementById('settingTestEmail').value;
    if (!email) {
      showNotification('Please enter a test email address', 'error');
      return;
    }

    showLoading(true);
    const res = await fetch('/api/settings/email/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.message || 'Failed to send test email');
    }

    showNotification(data.message || 'Test email sent successfully', 'success');

  } catch (err) {
    showNotification(err.message, 'error');
  } finally {
    showLoading(false);
  }
}

/* ======================================================
   API Keys Management
====================================================== */
async function loadApiKeys() {
  try {
    const res = await fetch('/api/apikeys');
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
    const res = await fetch('/api/apikeys', {
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
    const res = await fetch(`/api/apikeys/${id}/toggle`, { method: 'PUT' });

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
    const res = await fetch(`/api/apikeys/${id}`, { method: 'DELETE' });

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
    const res = await fetch('/api/groups');
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
          <span class="group-color" style="background: ${group.color}"></span>
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
    const res = await fetch('/api/groups', {
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
    const res = await fetch(`/api/groups/${id}`, { method: 'DELETE' });

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
    const res = await fetch('/api/tags');
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
          <span class="tag-color" style="background: ${tag.color}"></span>
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
    const res = await fetch('/api/tags', {
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
    const res = await fetch(`/api/tags/${id}`, { method: 'DELETE' });

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
      <span style="background: ${tag.color}; width: 10px; height: 10px; border-radius: 50%; display: inline-block;"></span>
      ${escapeHTML(tag.name)}
    </label>
  `).join('') || '<p class="info-text">No tags available.</p>';

  // Load health history
  try {
    const res = await fetch(`/api/health/domain/${domainId}`);
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

  openModal('domainModal');
}

async function saveDomainDetails() {
  if (!state.currentDomainId) return;

  try {
    const groupId = document.getElementById('domainGroupSelect').value || null;

    // Save group
    await fetch(`/api/domains/${state.currentDomainId}/group`, {
      method: 'POST',
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
        await fetch(`/api/domains/${state.currentDomainId}/tags/${tagId}`, { method: 'POST' });
      }
    }

    // Remove unselected tags
    for (const tagId of currentTagIds) {
      if (!selectedTagIds.includes(tagId)) {
        await fetch(`/api/domains/${state.currentDomainId}/tags/${tagId}`, { method: 'DELETE' });
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

    const res = await fetch('/api/import/csv', {
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

    const res = await fetch(url);
    if (!res.ok) return;

    const logs = await res.json();
    const container = document.getElementById('auditLogList');

    if (logs.length === 0) {
      container.innerHTML = '<p class="info-text">No audit log entries found.</p>';
      return;
    }

    container.innerHTML = logs.map(log => `
      <div class="audit-log-item">
        <div class="audit-log-icon ${log.action}">
          <i class="fa-solid fa-${log.action === 'create' ? 'plus' : log.action === 'update' ? 'pen' : 'trash'}"></i>
        </div>
        <div class="audit-log-content">
          <div class="audit-log-title">${escapeHTML(log.entity_type)}: ${escapeHTML(log.entity_id)}</div>
          <div class="audit-log-meta">${formatDateTime(log.created_at)} - ${log.action}</div>
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
    const res = await fetch('/api/auth/login', {
      method: 'POST',
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
    errorEl.style.display = 'none';
    closeModal('loginModal');
    document.getElementById('logoutBtn').style.display = 'flex';
    showNotification('Logged in successfully', 'success');
    load();

  } catch (err) {
    errorEl.textContent = 'Login failed';
    errorEl.style.display = 'block';
  }
}

async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
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
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      state.isAuthenticated = data.authenticated;
      state.authRequired = data.authRequired;

      if (state.isAuthenticated) {
        document.getElementById('logoutBtn').style.display = 'flex';
      }

      if (state.authRequired && !state.isAuthenticated) {
        openModal('loginModal');
      }
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

  // Initialize Charts
  initCharts();

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
      searchTimeout = setTimeout(applyFilters, 300);
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

  // Initial load
  load();
});
