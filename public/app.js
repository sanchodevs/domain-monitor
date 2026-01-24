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
  pollInterval: null,
  selectedDomains: new Set()
};

const FILTERS = {
  search: '',
  status: 'all',
  registrar: 'all',
  sortBy: 'expiry',
  sortOrder: 'asc'
};

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

/* ======================================================
   Load table & dashboard with filters
====================================================== */
async function load() {
  try {
    showLoading(true);
    const response = await fetch("/api/domains");
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to load domains' }));
      throw new Error(error.message);
    }
    
    const allDomains = await response.json();
    
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

      return `
        <tr class="${days !== null && days <= 0 ? "expired" : ""} ${hasError} ${isSelected ? 'selected' : ''}" data-domain="${escapeHTML(d.domain)}">
          <td class="checkbox-cell">
            <input type="checkbox" class="row-checkbox" data-domain="${escapeHTML(d.domain)}" ${isSelected ? 'checked' : ''}>
          </td>
          <td>
            <div class="domain-cell">
              <span>${escapeHTML(d.domain)}</span>
              <button class="copy-btn" data-action="copy" title="Copy domain"><i class="fa-regular fa-copy"></i></button>
              ${d.error ? '<i class="fa-solid fa-triangle-exclamation error-icon" title="' + escapeHTML(d.error) + '"></i>' : ''}
            </div>
          </td>
          <td>${escapeHTML(d.registrar) || "-"}</td>
          <td>${formatDate(d.expiry_date)}</td>
          <td class="${statusClass}">${days ?? "-"}${days !== null ? " days" : ""}</td>
          <td class="ns-servers" style="color:${nsChanged ? "var(--danger)" : "inherit"}">${nsHTML}</td>
          <td>${formatDate(d.created_date)}</td>
          <td>${getDomainAge(d.created_date)}</td>
          <td>${formatDateTime(d.last_checked)}</td>
          <td class="less"><button class="refresh-btn" data-action="refresh" title="Refresh WHOIS"><i class="fa-solid fa-arrows-rotate"></i></button></td>
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
  FILTERS.sortBy = document.getElementById('sortBy')?.value || 'expiry';
  FILTERS.sortOrder = document.getElementById('sortOrder')?.value || 'asc';
  
  load();
}

function clearFilters() {
  FILTERS.search = '';
  FILTERS.status = 'all';
  FILTERS.registrar = 'all';
  FILTERS.sortBy = 'expiry';
  FILTERS.sortOrder = 'asc';
  
  document.getElementById('searchInput').value = '';
  document.getElementById('filterStatus').value = 'all';
  document.getElementById('filterRegistrar').value = 'all';
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
  
  const estimatedTime = Math.ceil((domains.length * 2.5) / 60);
  const confirmMsg = `Refresh ${domains.length} domain(s)?\n\nEstimated time: ~${estimatedTime} minute(s)`;
  if (!confirm(confirmMsg)) return;
  
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

async function pollRefreshStatus() {
  try {
    const res = await fetch('/api/refresh/status');
    const status = await res.json();
    
    if (status.isRefreshing) {
      showRefreshProgress(true, status.completed, status.total);
      await load();
    } else {
      // Refresh completed
      showRefreshProgress(false);
      clearInterval(state.pollInterval);
      state.pollInterval = null;
      state.isRefreshing = false;
      showLoading(false);
      showNotification('Refresh complete!', 'success');
      await load();
    }
  } catch (err) {
    console.error('Error polling refresh status:', err);
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
    
    const estimatedTime = Math.ceil((domains.length * 2.5) / 60); // ~2.5 seconds per domain
    const confirmMsg = `Refresh ${domains.length} domain(s)?\n\nEstimated time: ~${estimatedTime} minute(s)\n\nThis will query WHOIS data for all domains.`;
    
    if (!confirm(confirmMsg)) return;
    
    state.isRefreshing = true;
    showLoading(true);
    showRefreshProgress(true, 0, domains.length);
    
    const res = await fetch("/api/refresh", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    
    if (!res.ok) {
      throw new Error(data.message || "Failed to refresh");
    }
    
    showNotification(data.message || "Refresh started", 'info');
    
    // Poll for status updates
    state.pollInterval = setInterval(pollRefreshStatus, 2000);
    
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

const exportCSV = () => window.location.href = "/api/export/csv";

/* ======================================================
   Initialize
====================================================== */
document.addEventListener('DOMContentLoaded', () => {
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