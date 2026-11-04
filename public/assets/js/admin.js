'use strict';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const STATUS_LABELS = {
  pending: 'Pending payment',
  review: 'In review',
  paid: 'Paid',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

const ORDER_FILTERS = [
  ['all', 'All'],
  ['review', 'In review'],
  ['pending', 'Pending'],
  ['paid', 'Paid'],
  ['rejected', 'Rejected'],
  ['cancelled', 'Cancelled'],
];

const VIEW_LABELS = {
  overview: 'Overview',
  fonts: 'Type library',
  orders: 'Orders',
  settings: 'Settings',
};

const TYPE_CLASSES = new Set([
  'type-orbit',
  'type-grotesk',
  'type-atelier',
  'type-monolith',
  'type-signal',
  'type-future',
]);

const TYPE_PALETTES = {
  'type-orbit': ['#20280d', '#e4ff54'],
  'type-grotesk': ['#f2eee4', '#171712'],
  'type-atelier': ['#ead6c1', '#4b2417'],
  'type-monolith': ['#ff6847', '#1b100c'],
  'type-signal': ['#151613', '#f1eee4'],
  'type-future': ['#cdc2ff', '#1a1420'],
};

const FILE_HINT = 'Choose WOFF2, WOFF, TTF, OTF or ZIP · max 10 MB';

const state = {
  session: null,
  view: 'overview',
  overview: null,
  fonts: [],
  orders: [],
  orderFilter: 'all',
  orderQuery: '',
  ordersRequest: 0,
  settings: null,
  editingFontId: null,
  slugEdited: false,
  currentOrderId: null,
  currentOrder: null,
  confirmResolver: null,
  searchTimer: null,
  badgeRequest: null,
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const formatMoney = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value, withTime = false) {
  const date = parseDate(value);
  if (!date) return '—';
  const options = withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' };
  return new Intl.DateTimeFormat('en-IN', options).format(date);
}

function formatDayLabel(day, options = { day: '2-digit' }) {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return new Intl.DateTimeFormat('en-IN', { ...options, timeZone: 'UTC' }).format(date);
}

const shortName = (name) => String(name || '').replace(/^Sanoj\s+/i, '').trim();
const shortOrderId = (id) => String(id || '').split('-')[0].toUpperCase();
const firstLetter = (name) => shortName(name).charAt(0).toUpperCase() || 'S';

function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!parts.length) return 'S';
  return parts.map((part) => part.charAt(0).toUpperCase()).join('');
}

function safeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
}

function safeTypeClass(value) {
  return TYPE_CLASSES.has(value) ? value : 'type-grotesk';
}

function paletteFor(typeClass) {
  return TYPE_PALETTES[safeTypeClass(typeClass)] || TYPE_PALETTES['type-grotesk'];
}

function statusPill(status) {
  const safeStatus = STATUS_LABELS[status] ? status : 'pending';
  return `<span class="status-pill status-pill--${safeStatus}">${escapeHtml(
    STATUS_LABELS[safeStatus]
  )}</span>`;
}

function loadingMarkup(label, minHeight = '22rem') {
  return `<div class="admin-loading" style="min-height:${minHeight}">${escapeHtml(label)}</div>`;
}

function emptyMarkup({ mark = '∅', title = 'Nothing here yet.', text = '', action = '' } = {}) {
  return `
    <div class="section-empty">
      <span class="section-empty-mark" aria-hidden="true">${escapeHtml(mark)}</span>
      <strong>${escapeHtml(title)}</strong>
      ${text ? `<p>${escapeHtml(text)}</p>` : ''}
      ${action}
    </div>
  `;
}

function errorMarkup(message, retryAttribute) {
  return `
    <div class="admin-card">
      ${emptyMarkup({
        mark: '!',
        title: 'We could not load this view.',
        text: message,
        action: `<button class="admin-btn admin-btn--ghost admin-btn--small" type="button" ${retryAttribute}>Try again</button>`,
      })}
    </div>
  `;
}

function showToast(message, type = 'success') {
  const stack = $('#adminToasts');
  if (!stack) return;

  const toast = document.createElement('div');
  toast.className = `admin-toast${type === 'error' ? ' admin-toast--error' : ''}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.textContent = message;
  stack.append(toast);

  requestAnimationFrame(() => toast.classList.add('is-visible'));
  window.setTimeout(() => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => toast.remove(), 300);
  }, 4200);
}

function setButtonBusy(button, busy, busyLabel = 'Working…') {
  if (!button) return;
  if (busy) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.textContent = busyLabel;
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  }
}

/* -------------------------------------------------------------------------- */
/* API                                                                        */
/* -------------------------------------------------------------------------- */

async function api(url, options = {}) {
  const headers = {
    Accept: 'application/json',
    'X-Sanoj-Admin': '1',
    ...(options.headers || {}),
  };

  let body = options.body;
  if (body instanceof FormData) {
    body = options.body;
  } else if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers,
      body,
    });
  } catch {
    throw new Error('Could not reach the studio server. Check your connection and try again.');
  }

  const contentType = response.headers.get('content-type') || '';
  let payload = null;
  if (contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  } else {
    const text = await response.text().catch(() => '');
    payload = text ? { error: text } : null;
  }

  if (!response.ok) {
    if (
      response.status === 401 &&
      !options.allow401 &&
      !url.startsWith('/api/admin/login')
    ) {
      handleSessionExpired();
    }

    const error = new Error(payload?.error || 'Something went wrong. Please try again.');
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function refreshReviewBadge() {
  if (state.badgeRequest) return state.badgeRequest;

  state.badgeRequest = (async () => {
    try {
      const data = await api('/api/admin/overview');
      setNavCount(data.stats?.reviewCount || 0);
      if (!state.overview) state.overview = data;
    } catch {
      // A background badge refresh should never interrupt the current view.
    } finally {
      state.badgeRequest = null;
    }
  })();

  return state.badgeRequest;
}

/* -------------------------------------------------------------------------- */
/* Session & navigation                                                       */
/* -------------------------------------------------------------------------- */

function setNavCount(count) {
  const badge = $('#navReviewCount');
  if (!badge) return;
  const value = Number(count) || 0;
  badge.textContent = String(value);
  badge.hidden = value === 0;
}

function handleSessionExpired() {
  if (!state.session) return;
  showLogin('Your studio session has expired. Please sign in again.');
}

function resetWorkspaceData() {
  state.overview = null;
  state.fonts = [];
  state.orders = [];
  state.settings = null;
  state.orderFilter = 'all';
  state.orderQuery = '';
  state.ordersRequest += 1;
  state.editingFontId = null;
  state.currentOrderId = null;
  state.currentOrder = null;
  setNavCount(0);

  for (const panel of ['overviewPanel', 'fontsPanel', 'ordersPanel', 'settingsPanel']) {
    const element = document.getElementById(panel);
    if (element) element.innerHTML = '';
  }

  const search = $('#orderSearch');
  if (search) search.value = '';
}

function closeAllDialogs() {
  for (const id of ['fontDialog', 'orderDialog', 'confirmDialog']) {
    const dialog = document.getElementById(id);
    if (dialog?.open) dialog.close();
  }
}

function showLogin(message = '') {
  state.session = null;
  closeAllDialogs();
  resetWorkspaceData();

  $('#appView').hidden = true;
  $('#loginView').hidden = false;
  $('#loginError').textContent = message;
  $('#adminPassword').value = '';
  document.title = 'Studio — Sanoj Type Foundry';
  document.body.classList.remove('is-locked');
}

function setTopbarDate() {
  const target = $('#topbarDate');
  if (!target) return;
  target.textContent = new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date());
}

function viewFromHash() {
  const candidate = window.location.hash.replace('#', '').trim();
  return VIEW_LABELS[candidate] ? candidate : 'overview';
}

function showApp(me) {
  state.session = me;
  $('#loginView').hidden = true;
  $('#appView').hidden = false;
  $('#sidebarUsername').textContent = me.username || 'admin';
  $('#sidebarAvatar').textContent = String(me.username || 'A').charAt(0).toUpperCase();
  $('#loginError').textContent = '';
  $('#adminPassword').value = '';
  setTopbarDate();

  const initial = viewFromHash();
  switchView(initial);

  if (initial !== 'overview') refreshReviewBadge();
}

function closeSidebar() {
  $('#adminSidebar')?.classList.remove('is-open');
  $('#sidebarScrim')?.classList.remove('is-visible');
  $('#mobileNavToggle')?.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('is-locked');
}

function openSidebar() {
  $('#adminSidebar')?.classList.add('is-open');
  $('#sidebarScrim')?.classList.add('is-visible');
  $('#mobileNavToggle')?.setAttribute('aria-expanded', 'true');
  document.body.classList.add('is-locked');
}

function switchView(view) {
  if (!VIEW_LABELS[view]) view = 'overview';
  state.view = view;

  $$('.admin-nav-item').forEach((item) => {
    const active = item.dataset.view === view;
    item.classList.toggle('is-active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });

  $$('.admin-view').forEach((panel) => {
    const active = panel.dataset.panel === view;
    panel.hidden = !active;
    panel.classList.toggle('is-active', active);
  });

  $('#topbarSection').textContent = VIEW_LABELS[view];
  document.title = `${VIEW_LABELS[view]} — Sanoj Studio`;
  window.history.replaceState(null, '', `#${view}`);
  closeSidebar();

  if (view === 'overview') loadOverview();
  else if (view === 'fonts') loadFonts();
  else if (view === 'orders') {
    ensureOrdersShell();
    refreshReviewBadge();
  } else if (view === 'settings') loadSettings();
}

/* -------------------------------------------------------------------------- */
/* Overview                                                                   */
/* -------------------------------------------------------------------------- */

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function trendFor(current, previous) {
  if (previous <= 0) {
    return current > 0
      ? { label: 'New', direction: 1 }
      : { label: 'No change', direction: 0 };
  }

  const difference = current - previous;
  const percentage = Math.abs((difference / previous) * 100);
  const formatted = percentage >= 10 ? percentage.toFixed(0) : percentage.toFixed(1);

  if (difference > 0) return { label: `↑ ${formatted}%`, direction: 1 };
  if (difference < 0) return { label: `↓ ${formatted}%`, direction: -1 };
  return { label: 'No change', direction: 0 };
}

function chartMarkup(daily) {
  const rows = Array.isArray(daily) ? daily : [];
  const maxRevenue = Math.max(1, ...rows.map((row) => Number(row.revenue) || 0));
  const totalRevenue = rows.reduce((sum, row) => sum + (Number(row.revenue) || 0), 0);
  const totalOrders = rows.reduce((sum, row) => sum + (Number(row.orders) || 0), 0);
  const hasRevenue = totalRevenue > 0;

  const bars = rows
    .map((row) => {
      const revenue = Number(row.revenue) || 0;
      const orders = Number(row.orders) || 0;
      const height = revenue > 0 ? Math.max(6, Math.round((revenue / maxRevenue) * 100)) : 0;
      const tip = `${formatMoney(revenue)} · ${orders} ${orders === 1 ? 'order' : 'orders'} · ${formatDayLabel(
        row.day,
        { day: '2-digit', month: 'short', year: 'numeric' }
      )}`;
      return `
        <div class="chart-bar-col" title="${escapeHtml(tip)}">
          <div class="chart-bar-area">
            <div class="chart-bar${revenue > 0 ? ' has-value' : ''}" style="height:${height}%">
              <span class="chart-tip">${escapeHtml(tip)}</span>
            </div>
          </div>
          <span class="chart-day">${escapeHtml(formatDayLabel(row.day))}</span>
        </div>
      `;
    })
    .join('');

  return `
    <section class="admin-card chart-card">
      <div class="card-head">
        <div>
          <span class="card-kicker">Revenue pulse</span>
          <h2>Last fourteen days</h2>
        </div>
        <span class="card-range">14 days</span>
      </div>
      <div class="chart-top">
        <strong>${formatMoney(totalRevenue)}</strong>
        <span>${totalOrders} paid ${totalOrders === 1 ? 'order' : 'orders'}</span>
      </div>
      <div class="chart-wrap">
        <div class="chart-gridlines" aria-hidden="true">
          <span></span><span></span><span></span><span></span>
        </div>
        <div class="chart-bars" role="img" aria-label="Revenue for the last fourteen days">${bars}</div>
        ${hasRevenue ? '' : '<div class="chart-empty"><span>No verified payments yet</span></div>'}
      </div>
    </section>
  `;
}

function topFontsMarkup(topFonts) {
  const fonts = Array.isArray(topFonts) ? topFonts : [];
  const maxSold = Math.max(1, ...fonts.map((font) => Number(font.sold) || 0));

  const content = fonts.length
    ? `
      <div class="top-fonts-list">
        ${fonts
          .map((font) => {
            const typeClass = safeTypeClass(font.type_class);
            const [background, ink] = paletteFor(typeClass);
            const sold = Number(font.sold) || 0;
            return `
              <div class="top-font-row">
                <span class="top-font-thumb ${typeClass}" style="--sample-bg:${background};--sample-ink:${ink}">${escapeHtml(
                  firstLetter(font.name)
                )}</span>
                <div class="top-font-info">
                  <strong>${escapeHtml(font.name)}</strong>
                  <span>${sold} ${sold === 1 ? 'sale' : 'sales'}</span>
                  <div class="mini-bar"><i style="width:${Math.max(4, Math.round((sold / maxSold) * 100))}%"></i></div>
                </div>
                <span class="top-font-revenue">${formatMoney(font.revenue)}</span>
              </div>
            `;
          })
          .join('')}
      </div>
    `
    : emptyMarkup({
        mark: 'A',
        title: 'No sales yet.',
        text: 'Verified orders will reveal the typefaces people reach for first.',
      });

  return `
    <section class="admin-card top-fonts-card">
      <div class="card-head">
        <div>
          <span class="card-kicker">Bestsellers</span>
          <h2>Top typefaces</h2>
        </div>
        <button class="card-link" type="button" data-view="fonts">Library ↗</button>
      </div>
      ${content}
    </section>
  `;
}

function ordersTableMarkup(orders) {
  if (!orders.length) {
    return emptyMarkup({
      mark: '◎',
      title: 'No orders yet.',
      text: 'The first UPI checkout will appear here for verification.',
    });
  }

  return `
    <div class="table-scroll">
      <table class="admin-table">
        <thead>
          <tr>
            <th scope="col">Order</th>
            <th scope="col">Customer</th>
            <th scope="col">Status</th>
            <th scope="col">Amount</th>
            <th scope="col">Placed</th>
            <th scope="col"><span class="visually-hidden">Open</span></th>
          </tr>
        </thead>
        <tbody>
          ${orders
            .map(
              (order) => `
                <tr class="order-row" data-order-open="${escapeHtml(order.id)}" title="Open order #${escapeHtml(
                  shortOrderId(order.id)
                )}">
                  <td class="cell-order-id">#${escapeHtml(shortOrderId(order.id))}</td>
                  <td>
                    <div class="customer-cell">
                      <span class="customer-avatar">${escapeHtml(initials(order.customerName))}</span>
                      <div>
                        <strong>${escapeHtml(order.customerName)}</strong>
                        <span>${escapeHtml(order.email)}</span>
                      </div>
                    </div>
                  </td>
                  <td>${statusPill(order.status)}</td>
                  <td class="cell-amount">${formatMoney(order.amount)}</td>
                  <td class="cell-date">${escapeHtml(formatDate(order.createdAt, true))}</td>
                  <td>
                    <button class="row-open" type="button" data-order-open="${escapeHtml(order.id)}" aria-label="Open order #${escapeHtml(
                      shortOrderId(order.id)
                    )}">↗</button>
                  </td>
                </tr>
              `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function recentOrdersMarkup(orders) {
  const content = orders.length
    ? ordersTableMarkup(orders)
    : emptyMarkup({
        mark: '◎',
        title: 'No orders yet.',
        text: 'Orders will land here as soon as the first checkout is started.',
      });

  return `
    <section class="admin-card recent-orders-card">
      <div class="card-head">
        <div>
          <span class="card-kicker">Latest activity</span>
          <h2>Recent orders</h2>
        </div>
        <button class="card-link" type="button" data-view="orders">All orders ↗</button>
      </div>
      ${content}
    </section>
  `;
}

function renderOverview(data) {
  const panel = $('#overviewPanel');
  if (!panel) return;

  const stats = data.stats || {};
  const last7 = stats.last7 || { value: 0, previous: 0 };
  const trend = trendFor(Number(last7.value) || 0, Number(last7.previous) || 0);
  const recentOrders = Array.isArray(data.recentOrders) ? data.recentOrders : [];
  const todayLabel = new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  panel.innerHTML = `
    <div class="page-heading">
      <div>
        <span class="admin-eyebrow page-kicker">Overview / ${escapeHtml(todayLabel)}</span>
        <h1>${greeting()}, <em>studio.</em></h1>
        <p>A living view of the foundry: revenue, the verification queue, and the typefaces doing the talking.</p>
      </div>
      <div class="page-actions">
        <button class="admin-btn admin-btn--ghost admin-btn--small" type="button" data-refresh="overview">Refresh ↻</button>
        <button class="admin-btn admin-btn--dark admin-btn--small" type="button" data-new-font>Add typeface <span>↗</span></button>
      </div>
    </div>

    <div class="stats-grid">
      <article class="stat-card stat-card--volume">
        <div class="stat-label"><span>Total revenue</span><i>₹</i></div>
        <strong class="stat-value">${formatMoney(stats.revenue)}</strong>
        <div class="stat-meta">
          <span>Last 7 days</span>
          <span class="stat-delta${trend.direction < 0 ? ' stat-delta--down' : ''}">${escapeHtml(trend.label)}</span>
        </div>
      </article>

      <article class="stat-card stat-card--acid">
        <div class="stat-label"><span>Orders</span><i>↗</i></div>
        <strong class="stat-value">${Number(stats.orderCount) || 0}</strong>
        <div class="stat-meta">
          <span>Lifetime</span>
          <span>${Number(stats.reviewCount) || 0} in review</span>
        </div>
      </article>

      <article class="stat-card stat-card--violet">
        <div class="stat-label"><span>Review queue</span><i>⌁</i></div>
        <strong class="stat-value">${Number(stats.reviewCount) || 0}</strong>
        <div class="stat-meta">
          <span>Awaiting UPI checks</span>
          <button class="card-link" type="button" data-view="orders" data-review-queue>Open queue ↗</button>
        </div>
      </article>

      <article class="stat-card">
        <div class="stat-label"><span>Published fonts</span><i>Aa</i></div>
        <strong class="stat-value">${Number(stats.publishedFonts) || 0}</strong>
        <div class="stat-meta">
          <span>Live on the storefront</span>
          <button class="card-link" type="button" data-view="fonts">Library ↗</button>
        </div>
      </article>
    </div>

    <div class="overview-grid">
      ${chartMarkup(data.daily)}
      ${topFontsMarkup(data.topFonts)}
    </div>

    ${recentOrdersMarkup(recentOrders)}
  `;

  setNavCount(stats.reviewCount || 0);
}

async function loadOverview() {
  const panel = $('#overviewPanel');
  if (!panel) return;

  if (!state.overview) panel.innerHTML = loadingMarkup('Reading the studio…');
  else panel.setAttribute('aria-busy', 'true');

  try {
    const data = await api('/api/admin/overview');
    state.overview = data;
    renderOverview(data);
  } catch (error) {
    if (!state.overview) panel.innerHTML = errorMarkup(error.message, 'data-refresh="overview"');
    else showToast(error.message, 'error');
  } finally {
    panel.removeAttribute('aria-busy');
  }
}

/* -------------------------------------------------------------------------- */
/* Type library                                                               */
/* -------------------------------------------------------------------------- */

function renderFonts() {
  const panel = $('#fontsPanel');
  if (!panel) return;

  const fonts = state.fonts;
  const published = fonts.filter((font) => font.published).length;

  const rows = fonts
    .map((font) => {
      const typeClass = safeTypeClass(font.typeClass);
      const [background, ink] = paletteFor(typeClass);
      const accent = safeColor(font.background, background);
      const fontColor = safeColor(font.accent, ink);
      return `
        <tr>
          <td>
            <div class="font-cell">
              <span class="font-thumb ${typeClass}" style="--sample-bg:${accent};--sample-ink:${fontColor}">${escapeHtml(
                firstLetter(font.name)
              )}</span>
              <div class="font-cell-copy">
                <strong>${escapeHtml(font.name)}</strong>
                <span>${escapeHtml(font.tagline)}</span>
              </div>
            </div>
          </td>
          <td>
            <span class="category-tag">${escapeHtml(font.category)}</span>
            <div class="table-cell-muted">${Number(font.glyphs) || 0} glyphs</div>
          </td>
          <td class="table-cell-muted">${escapeHtml(font.styles || 'Variable')}</td>
          <td class="cell-amount">${formatMoney(font.price)}</td>
          <td>
            <div class="table-cell-muted">${Number(font.downloads) || 0} downloads</div>
            <div class="table-cell-muted">${font.hasFile ? 'Package ready' : 'No file attached'}</div>
          </td>
          <td>
            <button
              class="publish-toggle"
              type="button"
              data-font-publish="${font.id}"
              aria-pressed="${font.published ? 'true' : 'false'}"
              aria-label="${font.published ? 'Unpublish' : 'Publish'} ${escapeHtml(font.name)}"
            >
              <span class="toggle-track"><i></i></span>
              <span>${font.published ? 'Live' : 'Draft'}</span>
            </button>
          </td>
          <td>
            <div class="table-actions">
              <button class="icon-action" type="button" data-font-edit="${font.id}" title="Edit ${escapeHtml(
                font.name
              )}" aria-label="Edit ${escapeHtml(font.name)}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13 7l4 4"/></svg>
              </button>
              <button class="icon-action icon-action--danger" type="button" data-font-delete="${font.id}" title="Delete ${escapeHtml(
                font.name
              )}" aria-label="Delete ${escapeHtml(font.name)}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/><path d="M10 11v5M14 11v5"/></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  const content = fonts.length
    ? `
      <section class="admin-card library-table-card">
        <div class="table-scroll">
          <table class="admin-table">
            <thead>
              <tr>
                <th scope="col">Typeface</th>
                <th scope="col">Category</th>
                <th scope="col">Styles</th>
                <th scope="col">Price</th>
                <th scope="col">Files</th>
                <th scope="col">Status</th>
                <th scope="col"><span class="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>
    `
    : `
      <section class="admin-card library-table-card">
        ${emptyMarkup({
          mark: 'Aa',
          title: 'The library is empty.',
          text: 'Add the first typeface to open the shop.',
          action:
            '<button class="admin-btn admin-btn--dark admin-btn--small" type="button" data-new-font>Add a typeface ↗</button>',
        })}
      </section>
    `;

  panel.innerHTML = `
    <div class="page-heading">
      <div>
        <span class="admin-eyebrow page-kicker">Type library / ${fonts.length} ${
          fonts.length === 1 ? 'family' : 'families'
        }</span>
        <h1>The type <em>library.</em> <span class="count-chip">${fonts.length}</span></h1>
        <p>Shape the collection, control what is live, and attach the files customers receive after payment.</p>
      </div>
      <div class="page-actions">
        <button class="admin-btn admin-btn--ghost admin-btn--small" type="button" data-refresh="fonts">Refresh ↻</button>
        <button class="admin-btn admin-btn--dark admin-btn--small" type="button" data-new-font>Add typeface <span>↗</span></button>
      </div>
    </div>

    <div class="library-toolbar">
      <div class="library-toolbar-info"><i></i> ${published} live · ${fonts.length - published} draft</div>
      <button class="admin-btn admin-btn--ghost admin-btn--small" type="button" data-refresh="fonts">Reload library ↻</button>
    </div>
    ${content}
  `;
}

async function loadFonts() {
  const panel = $('#fontsPanel');
  if (!panel) return;

  if (!state.fonts.length) panel.innerHTML = loadingMarkup('Setting the specimen table…');
  else panel.setAttribute('aria-busy', 'true');

  try {
    const data = await api('/api/admin/fonts');
    state.fonts = Array.isArray(data.fonts) ? data.fonts : [];
    renderFonts();
  } catch (error) {
    if (!state.fonts.length) panel.innerHTML = errorMarkup(error.message, 'data-refresh="fonts"');
    else showToast(error.message, 'error');
  } finally {
    panel.removeAttribute('aria-busy');
  }
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

function defaultFontFileLabel() {
  return FILE_HINT;
}

function updateFontPreview() {
  const nameInput = $('#fontName');
  if (!nameInput) return;

  const name = nameInput.value.trim() || 'Untitled';
  const category = $('#fontCategory')?.value || 'Display';
  const price = Number($('#fontPrice')?.value) || 0;
  const accent = $('#fontAccent')?.value || '#10110d';
  const background = $('#fontBackground')?.value || '#f2efe6';
  const typeClass = safeTypeClass($('#fontTypeClass')?.value);
  const card = $('#fontPreviewCard');
  const sample = $('#fontPreviewSample');

  $('#fontPreviewName').textContent = name;
  $('#fontPreviewCategory').textContent = category;
  $('#fontPreviewPrice').textContent = formatMoney(price);
  $('#fontAccentValue').textContent = accent.toLowerCase();
  $('#fontBackgroundValue').textContent = background.toLowerCase();

  if (card) {
    card.style.background = background;
    card.style.color = accent;
  }
  if (sample) {
    sample.className = `font-preview-sample ${typeClass}`;
  }
}

function openFontDialog(font = null) {
  const form = $('#fontForm');
  if (!form) return;

  state.editingFontId = font?.id ?? null;
  state.slugEdited = false;
  form.reset();
  $('#fontFormError').textContent = '';
  $('#fontFile').value = '';
  $('#fontFileLabel').textContent = defaultFontFileLabel();

  if (font) {
    $('#fontDialogKicker').textContent = 'Type library / Edit family';
    $('#fontDialogTitle').textContent = `Edit ${shortName(font.name)}.`;
    $('#fontFormSubmit').innerHTML = 'Save changes <span>↗</span>';

    $('#fontName').value = font.name || '';
    $('#fontSlug').value = font.slug || '';
    $('#fontCategory').value = font.category || 'Display';
    $('#fontPrice').value = font.price || '';
    $('#fontSort').value = font.sortOrder ?? 0;
    $('#fontStyles').value = font.styles || '';
    $('#fontGlyphs').value = font.glyphs || 480;
    $('#fontTagline').value = font.tagline || '';
    $('#fontDescription').value = font.description || '';
    $('#fontBadge').value = font.badge || '';
    $('#fontTypeClass').value = safeTypeClass(font.typeClass);
    $('#fontAccent').value = safeColor(font.accent, '#10110d');
    $('#fontBackground').value = safeColor(font.background, '#f2efe6');
    $('#fontPublished').checked = Boolean(font.published);

    if (font.hasFile) {
      $('#fontFileLabel').textContent = 'Package attached · choose a new file to replace it';
    }
  } else {
    $('#fontDialogKicker').textContent = 'Type library / New family';
    $('#fontDialogTitle').textContent = 'Add a typeface.';
    $('#fontFormSubmit').innerHTML = 'Save typeface <span>↗</span>';
    $('#fontSort').value =
      state.fonts.reduce((maximum, item) => Math.max(maximum, Number(item.sortOrder) || 0), 0) + 1;
  }

  updateFontPreview();
  $('#fontDialog').showModal();
  window.setTimeout(() => $('#fontName')?.focus(), 60);
}

async function submitFontForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorNode = $('#fontFormError');
  const submitButton = $('#fontFormSubmit');
  errorNode.textContent = '';

  if (!form.reportValidity()) return;

  const formData = new FormData(form);
  const editingId = state.editingFontId;
  const url = editingId ? `/api/admin/fonts/${editingId}` : '/api/admin/fonts';

  setButtonBusy(submitButton, true, editingId ? 'Saving changes…' : 'Saving typeface…');
  try {
    const data = await api(url, { method: 'POST', body: formData });
    $('#fontDialog').close();
    showToast(editingId ? 'Typeface updated.' : `${data.font?.name || 'Typeface'} added to the library.`);
    await loadFonts();
  } catch (error) {
    errorNode.textContent = error.message;
  } finally {
    setButtonBusy(submitButton, false);
  }
}

async function toggleFontPublished(button) {
  const fontId = Number(button.dataset.fontPublish);
  const font = state.fonts.find((item) => item.id === fontId);
  if (!font) return;

  button.disabled = true;
  try {
    const data = await api(`/api/admin/fonts/${fontId}/publish`, {
      method: 'PATCH',
      body: { published: !font.published },
    });
    const nextFont = data.font;
    state.fonts = state.fonts.map((item) => (item.id === fontId ? { ...item, ...nextFont } : item));
    renderFonts();
    showToast(nextFont.published ? `${nextFont.name} is live.` : `${nextFont.name} moved to drafts.`);
  } catch (error) {
    showToast(error.message, 'error');
    button.disabled = false;
  }
}

async function deleteFont(button) {
  const fontId = Number(button.dataset.fontDelete);
  const font = state.fonts.find((item) => item.id === fontId);
  if (!font) return;

  const accepted = await askConfirm({
    kicker: 'Type library / Delete',
    symbol: '×',
    title: `Delete ${shortName(font.name)}?`,
    message:
      'The typeface leaves the storefront immediately. Past orders keep their record, but this font file will no longer be downloadable. This cannot be undone.',
    acceptLabel: 'Delete typeface',
    danger: true,
  });
  if (!accepted) return;

  button.disabled = true;
  try {
    await api(`/api/admin/fonts/${fontId}`, { method: 'DELETE' });
    showToast(`${shortName(font.name)} deleted.`);
    await loadFonts();
  } catch (error) {
    showToast(error.message, 'error');
    button.disabled = false;
  }
}

/* -------------------------------------------------------------------------- */
/* Orders                                                                     */
/* -------------------------------------------------------------------------- */

function ensureOrdersShell() {
  const panel = $('#ordersPanel');
  if (!panel) return;
  if ($('#ordersResults')) {
    loadOrders();
    return;
  }

  panel.innerHTML = `
    <div class="page-heading">
      <div>
        <span class="admin-eyebrow page-kicker">Orders / Verification desk</span>
        <h1>Order <em>desk.</em> <span class="count-chip" id="ordersCount">—</span></h1>
        <p>Every order lands here with its UPI reference. Verify carefully — approval unlocks downloads instantly.</p>
      </div>
      <div class="page-actions">
        <button class="admin-btn admin-btn--ghost admin-btn--small" type="button" data-refresh="orders">Refresh ↻</button>
      </div>
    </div>

    <div class="orders-controls">
      <div class="orders-filters" role="group" aria-label="Filter orders by status">
        ${ORDER_FILTERS.map(
          ([value, label]) => `
            <button
              class="order-filter${state.orderFilter === value ? ' is-active' : ''}"
              type="button"
              data-order-filter="${value}"
              aria-pressed="${state.orderFilter === value ? 'true' : 'false'}"
            >${escapeHtml(label)}</button>
          `
        ).join('')}
      </div>
      <div class="order-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/></svg>
        <label class="visually-hidden" for="orderSearch">Search orders</label>
        <input
          id="orderSearch"
          type="search"
          placeholder="Search name, email, order ID or UTR…"
          autocomplete="off"
          spellcheck="false"
          value="${escapeHtml(state.orderQuery)}"
        >
      </div>
    </div>

    <div id="ordersResults">${loadingMarkup('Opening the order desk…', '20rem')}</div>
  `;

  loadOrders();
}

function renderOrdersResults() {
  const results = $('#ordersResults');
  if (!results) return;

  const orders = state.orders;
  const content = orders.length
    ? `
      <section class="admin-card orders-table-card">
        <div class="table-scroll">
          <table class="admin-table">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Customer</th>
                <th scope="col">Items</th>
                <th scope="col">Amount</th>
                <th scope="col">Status</th>
                <th scope="col">Placed</th>
                <th scope="col"><span class="visually-hidden">Open</span></th>
              </tr>
            </thead>
            <tbody>
              ${orders
                .map(
                  (order) => `
                    <tr class="order-row" data-order-open="${escapeHtml(order.id)}" title="Open order #${escapeHtml(
                      shortOrderId(order.id)
                    )}">
                      <td class="cell-order-id" title="${escapeHtml(order.id)}">#${escapeHtml(
                        shortOrderId(order.id)
                      )}</td>
                      <td>
                        <div class="customer-cell">
                          <span class="customer-avatar">${escapeHtml(initials(order.customerName))}</span>
                          <div>
                            <strong>${escapeHtml(order.customerName)}</strong>
                            <span>${escapeHtml(order.email)}</span>
                          </div>
                        </div>
                      </td>
                      <td class="table-cell-muted">${Number(order.itemCount) || 0}</td>
                      <td class="cell-amount">${formatMoney(order.amount)}</td>
                      <td>${statusPill(order.status)}</td>
                      <td class="cell-date">${escapeHtml(formatDate(order.createdAt, true))}</td>
                      <td>
                        <button class="row-open" type="button" data-order-open="${escapeHtml(
                          order.id
                        )}" aria-label="Open order #${escapeHtml(shortOrderId(order.id))}">↗</button>
                      </td>
                    </tr>
                  `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </section>
    `
    : `
      <section class="admin-card">
        ${emptyMarkup({
          mark: '◎',
          title: state.orderQuery || state.orderFilter !== 'all' ? 'No matching orders.' : 'No orders yet.',
          text:
            state.orderQuery || state.orderFilter !== 'all'
              ? 'Try another status or search term.'
              : 'Share the storefront and the first order will land here.',
          action:
            state.orderQuery || state.orderFilter !== 'all'
              ? '<button class="admin-btn admin-btn--ghost admin-btn--small" type="button" data-clear-order-filters>Clear filters</button>'
              : '',
        })}
      </section>
    `;

  results.innerHTML = content;
  results.dataset.loaded = 'true';

  const count = $('#ordersCount');
  if (count) count.textContent = String(orders.length);
}

async function loadOrders() {
  const results = $('#ordersResults');
  if (!results) return;

  const requestId = ++state.ordersRequest;
  const params = new URLSearchParams();
  if (state.orderFilter !== 'all') params.set('status', state.orderFilter);
  if (state.orderQuery) params.set('q', state.orderQuery);

  results.setAttribute('aria-busy', 'true');
  if (!results.dataset.loaded) {
    results.innerHTML = loadingMarkup('Opening the order desk…', '20rem');
  }

  try {
    const data = await api(`/api/admin/orders${params.size ? `?${params}` : ''}`);
    if (requestId !== state.ordersRequest) return;
    state.orders = Array.isArray(data.orders) ? data.orders : [];
    renderOrdersResults();
  } catch (error) {
    if (requestId !== state.ordersRequest) return;
    if (!results.dataset.loaded) {
      results.innerHTML = errorMarkup(error.message, 'data-refresh="orders"');
    } else {
      showToast(error.message, 'error');
    }
  } finally {
    if (requestId === state.ordersRequest) results.removeAttribute('aria-busy');
  }
}

function orderMetaRow(label, value) {
  return `<div class="order-meta-row"><span>${escapeHtml(label)}</span>${value}</div>`;
}

function orderActionsMarkup(order) {
  const actions = [];

  if (order.status === 'review') {
    actions.push(
      '<button class="admin-btn admin-btn--dark order-action-btn" type="button" data-order-status="paid">Approve payment</button>',
      '<button class="admin-btn admin-btn--danger order-action-btn" type="button" data-order-status="rejected">Reject reference</button>',
      '<button class="admin-btn admin-btn--ghost order-action-btn" type="button" data-order-status="cancelled">Cancel order</button>'
    );
  } else if (order.status === 'pending') {
    actions.push(
      '<button class="admin-btn admin-btn--dark order-action-btn" type="button" data-order-status="paid">Mark as paid</button>',
      '<button class="admin-btn admin-btn--ghost order-action-btn" type="button" data-order-status="cancelled">Cancel order</button>'
    );
  } else if (order.status === 'rejected') {
    actions.push(
      '<button class="admin-btn admin-btn--dark order-action-btn" type="button" data-order-status="review">Reopen as review</button>',
      '<button class="admin-btn admin-btn--ghost order-action-btn" type="button" data-order-status="cancelled">Cancel order</button>'
    );
  } else if (order.status === 'cancelled') {
    actions.push(
      '<button class="admin-btn admin-btn--dark order-action-btn" type="button" data-order-status="pending">Reopen order</button>'
    );
  } else if (order.status === 'paid') {
    actions.push(
      '<button class="admin-btn admin-btn--ghost order-action-btn" type="button" data-order-status="review">Reopen as review</button>'
    );
  }

  return `<div class="order-actions">${actions.join('')}</div>`;
}

function timelineMarkup(order) {
  const isReview = order.status === 'review' || order.status === 'paid';
  const hasReference = Boolean(order.utr);
  const isPaid = order.status === 'paid';
  const isClosed = order.status === 'rejected' || order.status === 'cancelled';
  const verificationLabel = isPaid
    ? 'Payment verified'
    : isClosed
      ? order.status === 'rejected'
        ? 'Reference rejected'
        : 'Order cancelled'
      : 'Payment verified';

  return `
    <div class="order-timeline">
      <div class="timeline-step is-done">
        <span class="timeline-dot"></span>
        <div>
          <strong>Order created</strong>
          <span>${escapeHtml(formatDate(order.created_at, true))}</span>
        </div>
      </div>
      <div class="timeline-step${hasReference ? ' is-done' : ''}">
        <span class="timeline-dot"></span>
        <div>
          <strong>UPI reference submitted</strong>
          <span>${hasReference ? escapeHtml(order.utr) : 'Waiting for the customer'}</span>
        </div>
      </div>
      <div class="timeline-step${isPaid ? ' is-done' : ''}">
        <span class="timeline-dot"></span>
        <div>
          <strong>${escapeHtml(verificationLabel)}</strong>
          <span>${isPaid ? escapeHtml(formatDate(order.paid_at, true)) : isReview ? 'Check the reference in your bank app' : '—'}</span>
        </div>
      </div>
      <div class="timeline-step${isPaid ? ' is-done' : ''}">
        <span class="timeline-dot"></span>
        <div>
          <strong>Downloads unlocked</strong>
          <span>${isPaid ? 'Customer can download the files now' : 'Available after approval'}</span>
        </div>
      </div>
    </div>
  `;
}

function renderOrderDialog(order) {
  const content = $('#orderDialogContent');
  if (!content) return;

  const items = Array.isArray(order.items) ? order.items : [];
  const customerEmail = String(order.email || '');
  const customerPhone = String(order.phone || '');

  const meta = [
    orderMetaRow('Customer', `<span>${escapeHtml(order.customer_name)}</span>`),
    orderMetaRow(
      'Email',
      `<a href="mailto:${escapeHtml(customerEmail)}">${escapeHtml(customerEmail || '—')}</a>`
    ),
    orderMetaRow(
      'Phone',
      customerPhone
        ? `<a href="tel:${escapeHtml(customerPhone.replace(/\s+/g, ''))}">${escapeHtml(customerPhone)}</a>`
        : '<span>—</span>'
    ),
    orderMetaRow('Placed', `<span>${escapeHtml(formatDate(order.created_at, true))}</span>`),
    orderMetaRow('Items', `<span>${items.length}</span>`),
    orderMetaRow('Payment', `<span>${escapeHtml(formatMoney(order.amount))}</span>`),
  ].join('');

  const itemRows = items.length
    ? items
        .map((item) => {
          const typeClass = safeTypeClass(item.type_class);
          const [background, ink] = paletteFor(typeClass);
          return `
            <div class="order-item">
              <span class="order-item-thumb ${typeClass}" style="background:${background};color:${ink}">${escapeHtml(
                firstLetter(item.name)
              )}</span>
              <div class="order-item-info">
                <strong>${escapeHtml(item.name)}</strong>
                <span>${escapeHtml(item.license || 'Personal')} license${
                  item.fontId ? '' : ' · file unavailable'
                }</span>
              </div>
              <span class="order-item-price">${formatMoney(item.price)}</span>
            </div>
          `;
        })
        .join('')
    : '<p class="table-cell-muted" style="padding:0.6rem 0">No items recorded.</p>';

  content.innerHTML = `
    <div class="order-dialog-inner">
      <div class="order-dialog-head">
        <div>
          <span class="admin-eyebrow">Order / ${escapeHtml(STATUS_LABELS[order.status] || order.status)}</span>
          <h2>#${escapeHtml(shortOrderId(order.id))} <span>${escapeHtml(formatDate(order.created_at))}</span></h2>
        </div>
        <button class="dialog-close" type="button" data-close-dialog="orderDialog" aria-label="Close order">×</button>
      </div>

      <div class="order-dialog-grid">
        <div class="order-detail-card">
          <div class="order-detail-head">
            <h3>Customer & payment</h3>
            ${statusPill(order.status)}
          </div>
          <div class="order-meta-list">${meta}</div>

          <div class="utr-box">
            <div>
              <span>UPI reference / UTR</span>
              <strong>${escapeHtml(order.utr || 'Not submitted')}</strong>
            </div>
            ${
              order.utr
                ? `<button class="icon-action" type="button" data-copy-utr="${escapeHtml(
                    order.utr
                  )}" title="Copy UTR" aria-label="Copy UTR">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/></svg>
                  </button>`
                : ''
            }
          </div>

          ${
            order.status === 'review'
              ? `<div class="verify-warning"><span aria-hidden="true">!</span><p>Match this reference against your UPI or bank statement before approving. Approval unlocks the customer's downloads immediately.</p></div>`
              : ''
          }

          <div class="order-note-field">
            <div class="admin-field">
              <label for="orderNote">Internal note</label>
              <textarea id="orderNote" rows="3" maxlength="500" placeholder="Only the studio sees this…">${escapeHtml(
                order.adminNote || ''
              )}</textarea>
            </div>
            <div class="order-note-actions">
              <button class="admin-btn admin-btn--ghost admin-btn--small" type="button" data-order-save-note>Save note</button>
            </div>
          </div>

          ${orderActionsMarkup(order)}
        </div>

        <div class="settings-stack">
          <div class="order-detail-card">
            <div class="order-detail-head"><h3>Typefaces</h3><span class="table-cell-muted">${items.length}</span></div>
            <div class="order-items">${itemRows}</div>
            <div class="order-total"><span>Order total</span><strong>${formatMoney(order.amount)}</strong></div>
          </div>

          <div class="order-detail-card">
            <div class="order-detail-head"><h3>Progress</h3></div>
            ${timelineMarkup(order)}
          </div>
        </div>
      </div>
    </div>
  `;
}

async function openOrderDialog(orderId) {
  const dialog = $('#orderDialog');
  const content = $('#orderDialogContent');
  if (!dialog || !content) return;

  state.currentOrderId = orderId;
  if (!dialog.open) dialog.showModal();
  content.innerHTML = loadingMarkup('Opening the order…', '18rem');

  try {
    const data = await api(`/api/admin/orders/${encodeURIComponent(orderId)}`);
    if (state.currentOrderId !== orderId) return;
    state.currentOrder = data.order;
    renderOrderDialog(data.order);
  } catch (error) {
    if (state.currentOrderId !== orderId) return;
    content.innerHTML = `
      <div class="order-dialog-inner">
        <div class="order-dialog-head">
          <div>
            <span class="admin-eyebrow">Order desk</span>
            <h2>Order unavailable.</h2>
          </div>
          <button class="dialog-close" type="button" data-close-dialog="orderDialog" aria-label="Close order">×</button>
        </div>
        ${emptyMarkup({
          mark: '!',
          title: 'We could not open this order.',
          text: error.message,
          action: `<button class="admin-btn admin-btn--ghost admin-btn--small" type="button" data-order-open="${escapeHtml(
            orderId
          )}">Try again</button>`,
        })}
      </div>
    `;
  }
}

async function saveOrderNote(button) {
  const order = state.currentOrder;
  const noteField = $('#orderNote');
  if (!order || !noteField) return;

  setButtonBusy(button, true, 'Saving…');
  try {
    await api(`/api/admin/orders/${order.id}`, {
      method: 'PATCH',
      body: { status: order.status, adminNote: noteField.value },
    });
    order.adminNote = noteField.value;
    showToast('Order note saved.');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setButtonBusy(button, false);
  }
}

async function changeOrderStatus(nextStatus, button) {
  const order = state.currentOrder;
  if (!order || !STATUS_LABELS[nextStatus]) return;

  const note = $('#orderNote')?.value || '';
  const customer = shortName(order.customer_name) || 'this customer';
  const amount = formatMoney(order.amount);

  const confirmations = {
    paid:
      order.status === 'review'
        ? {
            kicker: 'Payment verification',
            symbol: '✓',
            title: 'Approve this payment?',
            message: `This marks ${amount} from ${customer} as paid and unlocks their downloads. Make sure the UTR matches your bank statement first.`,
            acceptLabel: 'Approve & unlock',
            danger: false,
          }
        : {
            kicker: 'Manual payment',
            symbol: '✓',
            title: 'Mark this order as paid?',
            message: `No UPI reference has been verified for ${customer}. Marking this paid will unlock downloads for ${amount}.`,
            acceptLabel: 'Mark as paid',
            danger: false,
          },
    rejected: {
      kicker: 'Payment verification',
      symbol: '!',
      title: 'Reject this UPI reference?',
      message: `The customer will see a rejected payment state for ${customer}. You can reopen the order later if needed.`,
      acceptLabel: 'Reject reference',
      danger: true,
    },
    cancelled: {
      kicker: 'Order desk',
      symbol: '×',
      title: 'Cancel this order?',
      message: `Cancelling removes this order from the verification queue. The customer will see a cancelled state and any download access is revoked.`,
      acceptLabel: 'Cancel order',
      danger: true,
    },
    review: {
      kicker: 'Revert order',
      symbol: '↺',
      title: 'Reopen this order for review?',
      message:
        order.status === 'paid'
          ? 'This removes the verified payment state and revokes the customer’s download access. The UTR is kept for re-verification.'
          : 'This moves the order back into the verification queue. The customer can submit another UPI reference.',
      acceptLabel: 'Reopen as review',
      danger: order.status === 'paid',
    },
    pending: {
      kicker: 'Reopen order',
      symbol: '↺',
      title: 'Reopen this order?',
      message: 'The order returns to awaiting payment. The customer will be able to pay and submit a new reference.',
      acceptLabel: 'Reopen order',
      danger: false,
    },
  };

  const config = confirmations[nextStatus];
  const accepted = await askConfirm(config);
  if (!accepted) return;

  const actionButtons = $$('[data-order-status]', $('#orderDialogContent') || document);
  actionButtons.forEach((actionButton) => {
    actionButton.disabled = true;
  });
  setButtonBusy(button, true, 'Updating…');

  try {
    await api(`/api/admin/orders/${order.id}`, {
      method: 'PATCH',
      body: { status: nextStatus, adminNote: note },
    });
    showToast(
      nextStatus === 'paid'
        ? 'Payment approved. Customer downloads unlocked.'
        : `Order moved to ${STATUS_LABELS[nextStatus].toLowerCase()}.`
    );

    await Promise.allSettled([loadOrders(), openOrderDialog(order.id), refreshReviewBadge()]);
  } catch (error) {
    showToast(error.message, 'error');
    actionButtons.forEach((actionButton) => {
      actionButton.disabled = false;
    });
    setButtonBusy(button, false);
  }
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    showToast('UPI reference copied.');
    return;
  } catch {
    // Fall back to a temporary field for non-secure contexts.
  }

  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.select();
  try {
    document.execCommand('copy');
    showToast('UPI reference copied.');
  } catch {
    showToast('Could not copy the reference.', 'error');
  } finally {
    field.remove();
  }
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

function settingsField({ id, name, label, value = '', type = 'text', placeholder = '', required = false, optional = false, maxlength = 160 }) {
  return `
    <div class="admin-field">
      <label for="${id}">${escapeHtml(label)}${
        optional ? ' <span class="field-optional">optional</span>' : ''
      }</label>
      <input
        id="${id}"
        name="${escapeHtml(name)}"
        type="${type}"
        value="${escapeHtml(value)}"
        maxlength="${maxlength}"
        placeholder="${escapeHtml(placeholder)}"
        ${required ? 'required' : ''}
      >
    </div>
  `;
}

function renderSettings() {
  const panel = $('#settingsPanel');
  if (!panel || !state.settings) return;

  const settings = state.settings;

  panel.innerHTML = `
    <div class="page-heading">
      <div>
        <span class="admin-eyebrow page-kicker">Store / Configuration</span>
        <h1>Foundry <em>settings.</em></h1>
        <p>Change the storefront’s voice, the UPI destination, and the credentials that guard this studio.</p>
      </div>
      <div class="page-actions">
        <button class="admin-btn admin-btn--ghost admin-btn--small" type="button" data-refresh="settings">Refresh ↻</button>
      </div>
    </div>

    <div class="settings-layout">
      <div class="settings-stack">
        <section class="admin-card settings-card">
          <div class="settings-card-head">
            <div>
              <span class="admin-eyebrow">Storefront</span>
              <h2>Store profile.</h2>
              <p>The name, contact details, and notes customers see across the store and at checkout.</p>
            </div>
            <span class="settings-icon" aria-hidden="true">✦</span>
          </div>

          <form class="settings-form" data-settings-form="profile" novalidate>
            <div class="form-row">
              ${settingsField({
                id: 'storeName',
                name: 'store_name',
                label: 'Store name',
                value: settings.store_name,
                placeholder: 'Sanoj Type Foundry',
                required: true,
                maxlength: 80,
              })}
              ${settingsField({
                id: 'storeTagline',
                name: 'store_tagline',
                label: 'Store tagline',
                value: settings.store_tagline,
                placeholder: 'Independent type foundry · India',
                maxlength: 120,
              })}
            </div>
            <div class="form-row">
              ${settingsField({
                id: 'supportEmail',
                name: 'support_email',
                label: 'Support email',
                value: settings.support_email,
                type: 'email',
                placeholder: 'hello@sanojtype.in',
                required: true,
                maxlength: 160,
              })}
              ${settingsField({
                id: 'supportPhone',
                name: 'support_phone',
                label: 'Support phone',
                value: settings.support_phone,
                type: 'tel',
                placeholder: '+91 98250 44120',
                optional: true,
                maxlength: 30,
              })}
            </div>
            <div class="form-row">
              ${settingsField({
                id: 'instagram',
                name: 'instagram',
                label: 'Instagram',
                value: settings.instagram,
                placeholder: '@sanojtype',
                optional: true,
                maxlength: 60,
              })}
              ${settingsField({
                id: 'announcement',
                name: 'announcement',
                label: 'Ticker announcement',
                value: settings.announcement,
                placeholder: 'Edition 01 — Orbit is now in orbit.',
                optional: true,
                maxlength: 160,
              })}
            </div>
            <div class="admin-field">
              <label for="licenseNote">License note</label>
              <textarea id="licenseNote" name="license_note" rows="4" maxlength="600" placeholder="What customers should know about the license…">${escapeHtml(
                settings.license_note || ''
              )}</textarea>
            </div>

            <p class="form-error" data-form-error role="alert"></p>
            <div class="settings-actions">
              <button class="admin-btn admin-btn--dark" type="submit">Save profile <span>↗</span></button>
            </div>
          </form>
        </section>

        <section class="admin-card settings-card">
          <div class="settings-card-head">
            <div>
              <span class="admin-eyebrow">Payments</span>
              <h2>UPI destination.</h2>
              <p>Every checkout builds a UPI intent and QR code from this address. Payments are verified manually before files unlock.</p>
            </div>
            <span class="settings-icon" aria-hidden="true">₹</span>
          </div>

          <form class="settings-form" data-settings-form="upi" novalidate>
            <div class="form-row">
              ${settingsField({
                id: 'upiId',
                name: 'upi_id',
                label: 'UPI ID',
                value: settings.upi_id,
                placeholder: 'studio@okhdfcbank',
                required: true,
                maxlength: 120,
              })}
              ${settingsField({
                id: 'upiName',
                name: 'upi_name',
                label: 'UPI payee name',
                value: settings.upi_name,
                placeholder: 'Sanoj Type Foundry',
                required: true,
                maxlength: 80,
              })}
            </div>
            <p class="form-error" data-form-error role="alert"></p>
            <div class="settings-actions">
              <button class="admin-btn admin-btn--dark" type="submit">Save UPI details <span>↗</span></button>
            </div>
          </form>
        </section>
      </div>

      <div class="settings-stack">
        <section class="admin-card settings-card">
          <div class="upi-preview">
            <div class="upi-preview-top">
              <span>UPI / checkout preview</span>
              <i>Direct pay</i>
            </div>
            <strong class="upi-preview-id" id="upiPreviewId">${escapeHtml(settings.upi_id || 'Not configured')}</strong>
            <p>Payments land with <strong id="upiPreviewName">${escapeHtml(
              settings.upi_name || settings.store_name || 'the studio'
            )}</strong>. Customers submit their UTR for manual verification.</p>
          </div>
          <div class="settings-note">
            <span aria-hidden="true">↳</span>
            <p><strong>Manual verification:</strong> approving an order only after matching its UTR protects both you and the customer. There is no automatic gateway callback.</p>
          </div>
        </section>

        <section class="admin-card settings-card security-card">
          <div class="settings-card-head">
            <div>
              <span class="admin-eyebrow">Security</span>
              <h2>Studio password.</h2>
              <p>Use at least 10 characters with one letter and one number. Changing it does not end this session.</p>
            </div>
            <span class="settings-icon" aria-hidden="true">⌁</span>
          </div>

          <form class="settings-form" id="passwordForm" novalidate>
            <div class="admin-field">
              <label for="currentPassword">Current password</label>
              <input id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" required>
            </div>
            <div class="admin-field">
              <label for="newPassword">New password</label>
              <input id="newPassword" name="newPassword" type="password" autocomplete="new-password" minlength="10" required>
            </div>
            <div class="admin-field">
              <label for="confirmPassword">Confirm new password</label>
              <input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" minlength="10" required>
            </div>
            <p class="form-error" data-form-error role="alert"></p>
            <div class="settings-actions">
              <button class="admin-btn admin-btn--dark" type="submit">Update password <span>↗</span></button>
            </div>
          </form>
          <p class="security-foot">Sessions are signed, HttpOnly, and expire after 8 hours. The password is stored as a scrypt hash.</p>
        </section>
      </div>
    </div>
  `;

  bindSettingsPreview();
  updateUpiPreview();
}

function bindSettingsPreview() {
  const upiId = $('#upiId');
  const upiName = $('#upiName');
  upiId?.addEventListener('input', updateUpiPreview);
  upiName?.addEventListener('input', updateUpiPreview);
}

function updateUpiPreview() {
  const id = $('#upiId')?.value.trim();
  const name = $('#upiName')?.value.trim();
  const idTarget = $('#upiPreviewId');
  const nameTarget = $('#upiPreviewName');
  if (idTarget) idTarget.textContent = id || 'Not configured';
  if (nameTarget) nameTarget.textContent = name || 'the studio';
}

async function loadSettings() {
  const panel = $('#settingsPanel');
  if (!panel) return;

  if (state.settings) renderSettings();
  else panel.innerHTML = loadingMarkup('Opening the settings…');

  try {
    const data = await api('/api/admin/settings');
    state.settings = data.settings;
    renderSettings();
  } catch (error) {
    if (!state.settings) panel.innerHTML = errorMarkup(error.message, 'data-refresh="settings"');
    else showToast(error.message, 'error');
  }
}

async function submitSettingsForm(form) {
  if (!state.settings) return;
  const errorNode = $('[data-form-error]', form);
  const submitButton = $('[type="submit"]', form);
  const formData = new FormData(form);
  const values = Object.fromEntries(formData.entries());
  const nextSettings = { ...state.settings, ...values };

  if (errorNode) errorNode.textContent = '';
  setButtonBusy(submitButton, true, 'Saving…');

  try {
    const data = await api('/api/admin/settings', { method: 'PUT', body: nextSettings });
    state.settings = { ...state.settings, ...(data.settings || values) };
    updateUpiPreview();
    showToast('Settings saved.');
  } catch (error) {
    if (errorNode) errorNode.textContent = error.message;
    else showToast(error.message, 'error');
  } finally {
    setButtonBusy(submitButton, false);
  }
}

async function submitPasswordForm(form) {
  const errorNode = $('[data-form-error]', form);
  const submitButton = $('[type="submit"]', form);
  const currentPassword = $('#currentPassword')?.value || '';
  const newPassword = $('#newPassword')?.value || '';
  const confirmPassword = $('#confirmPassword')?.value || '';

  if (errorNode) errorNode.textContent = '';

  if (!currentPassword || !newPassword) {
    if (errorNode) errorNode.textContent = 'Enter your current and new password.';
    return;
  }
  if (newPassword !== confirmPassword) {
    if (errorNode) errorNode.textContent = 'The new passwords do not match.';
    return;
  }
  if (newPassword.length < 10) {
    if (errorNode) errorNode.textContent = 'Use at least 10 characters for the new password.';
    return;
  }
  if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    if (errorNode) errorNode.textContent = 'Include at least one letter and one number.';
    return;
  }

  setButtonBusy(submitButton, true, 'Updating…');
  try {
    await api('/api/admin/password', {
      method: 'POST',
      body: { currentPassword, newPassword },
      allow401: true,
    });
    form.reset();
    showToast('Studio password updated.');
  } catch (error) {
    if (errorNode) errorNode.textContent = error.message;
  } finally {
    setButtonBusy(submitButton, false);
  }
}

/* -------------------------------------------------------------------------- */
/* Confirm dialog                                                             */
/* -------------------------------------------------------------------------- */

function settleConfirm(value) {
  const resolver = state.confirmResolver;
  state.confirmResolver = null;
  if ($('#confirmDialog')?.open) $('#confirmDialog').close();
  if (resolver) resolver(value);
}

function askConfirm({
  kicker = 'Please confirm',
  symbol = '!',
  title = 'Are you sure?',
  message = 'This action cannot be undone.',
  acceptLabel = 'Confirm',
  danger = true,
} = {}) {
  const dialog = $('#confirmDialog');
  if (!dialog) return Promise.resolve(false);
  if (state.confirmResolver) return Promise.resolve(false);

  if (dialog.open) dialog.close();

  $('#confirmKicker').textContent = kicker;
  $('#confirmTitle').textContent = title;
  $('#confirmMessage').textContent = message;
  const symbolNode = $('#confirmSymbol');
  symbolNode.textContent = symbol;
  symbolNode.style.background = danger ? 'var(--coral)' : 'var(--acid)';

  const accept = $('#confirmAccept');
  accept.textContent = acceptLabel;
  accept.className = `admin-btn ${danger ? 'admin-btn--danger' : 'admin-btn--dark'}`;

  dialog.showModal();
  return new Promise((resolve) => {
    state.confirmResolver = resolve;
  });
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

function bindEvents() {
  $('#loginForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = $('#adminUsername').value.trim();
    const password = $('#adminPassword').value;
    const errorNode = $('#loginError');
    const submit = $('#loginSubmit');
    errorNode.textContent = '';

    if (!username || !password) {
      errorNode.textContent = 'Enter your username and password.';
      return;
    }

    setButtonBusy(submit, true, 'Signing in…');
    try {
      const data = await api('/api/admin/login', {
        method: 'POST',
        body: { username, password },
        allow401: true,
      });
      showApp({ username: data.username || username });
      showToast('Welcome back to the studio.');
    } catch (error) {
      errorNode.textContent = error.message;
      $('#adminPassword').value = '';
      $('#adminPassword').focus();
    } finally {
      setButtonBusy(submit, false);
    }
  });

  $('#passwordToggle')?.addEventListener('click', () => {
    const input = $('#adminPassword');
    const button = $('#passwordToggle');
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    button.textContent = reveal ? 'Hide' : 'Show';
    button.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
    button.setAttribute('aria-pressed', String(reveal));
  });

  $('#logoutButton')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    setButtonBusy(button, true, 'Signing out…');
    try {
      await api('/api/admin/logout', { method: 'POST', allow401: true });
    } catch {
      // Even if the server session is gone, clear the local experience.
    } finally {
      setButtonBusy(button, false);
      showLogin('You have been signed out.');
    }
  });

  $('#mobileNavToggle')?.addEventListener('click', () => {
    const sidebar = $('#adminSidebar');
    if (sidebar?.classList.contains('is-open')) closeSidebar();
    else openSidebar();
  });
  $('#sidebarClose')?.addEventListener('click', closeSidebar);
  $('#sidebarScrim')?.addEventListener('click', closeSidebar);

  $('#fontForm')?.addEventListener('submit', submitFontForm);

  $('#confirmCancel')?.addEventListener('click', () => settleConfirm(false));
  $('#confirmAccept')?.addEventListener('click', () => settleConfirm(true));
  $('#confirmDialog')?.addEventListener('close', () => {
    if (state.confirmResolver) settleConfirm(false);
  });

  for (const id of ['fontDialog', 'orderDialog']) {
    const dialog = document.getElementById(id);
    dialog?.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  $('#orderDialog')?.addEventListener('close', () => {
    state.currentOrderId = null;
    state.currentOrder = null;
  });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.matches('[data-settings-form]')) {
      event.preventDefault();
      submitSettingsForm(form);
    } else if (form.id === 'passwordForm') {
      event.preventDefault();
      submitPasswordForm(form);
    }
  });

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const closeButton = target.closest('[data-close-dialog]');
    if (closeButton) {
      document.getElementById(closeButton.dataset.closeDialog)?.close();
      return;
    }

    const viewButton = target.closest('[data-view]');
    if (viewButton) {
      if (viewButton.hasAttribute('data-review-queue')) {
        state.orderFilter = 'review';
        const search = $('#orderSearch');
        if (search) search.value = '';
        state.orderQuery = '';
      }
      switchView(viewButton.dataset.view);
      return;
    }

    const newFontButton = target.closest('[data-new-font]');
    if (newFontButton) {
      if (state.view !== 'fonts') switchView('fonts');
      openFontDialog();
      return;
    }

    const refreshButton = target.closest('[data-refresh]');
    if (refreshButton) {
      const view = refreshButton.dataset.refresh;
      if (view === 'overview') loadOverview();
      else if (view === 'fonts') loadFonts();
      else if (view === 'orders') loadOrders();
      else if (view === 'settings') loadSettings();
      return;
    }

    const filterButton = target.closest('[data-order-filter]');
    if (filterButton) {
      state.orderFilter = filterButton.dataset.orderFilter;
      $$('.order-filter').forEach((button) => {
        const active = button === filterButton;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      loadOrders();
      return;
    }

    const clearFilters = target.closest('[data-clear-order-filters]');
    if (clearFilters) {
      state.orderFilter = 'all';
      state.orderQuery = '';
      const search = $('#orderSearch');
      if (search) search.value = '';
      $$('.order-filter').forEach((button) => {
        const active = button.dataset.orderFilter === 'all';
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      loadOrders();
      return;
    }

    const orderOpen = target.closest('[data-order-open]');
    if (orderOpen) {
      openOrderDialog(orderOpen.dataset.orderOpen);
      return;
    }

    const fontPublish = target.closest('[data-font-publish]');
    if (fontPublish) {
      toggleFontPublished(fontPublish);
      return;
    }

    const fontEdit = target.closest('[data-font-edit]');
    if (fontEdit) {
      const font = state.fonts.find((item) => item.id === Number(fontEdit.dataset.fontEdit));
      if (font) openFontDialog(font);
      return;
    }

    const fontDelete = target.closest('[data-font-delete]');
    if (fontDelete) {
      deleteFont(fontDelete);
      return;
    }

    const orderStatus = target.closest('[data-order-status]');
    if (orderStatus) {
      changeOrderStatus(orderStatus.dataset.orderStatus, orderStatus);
      return;
    }

    const noteButton = target.closest('[data-order-save-note]');
    if (noteButton) {
      saveOrderNote(noteButton);
      return;
    }

    const copyButton = target.closest('[data-copy-utr]');
    if (copyButton) {
      copyText(copyButton.dataset.copyUtr);
    }
  });

  document.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;

    if (target.id === 'orderSearch') {
      state.orderQuery = target.value.trim();
      window.clearTimeout(state.searchTimer);
      state.searchTimer = window.setTimeout(() => loadOrders(), 320);
      return;
    }

    if (target.id === 'fontName') {
      if (state.editingFontId === null && !state.slugEdited) {
        $('#fontSlug').value = slugify(target.value);
      }
      updateFontPreview();
      return;
    }

    if (
      target.matches('#fontSlug, #fontCategory, #fontPrice, #fontAccent, #fontBackground, #fontTypeClass')
    ) {
      if (target.id === 'fontSlug') state.slugEdited = true;
      updateFontPreview();
      return;
    }

    if (target.matches('[data-setting-preview]')) updateUpiPreview();
  });

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    if (target.id === 'fontFile') {
      const file = target.files?.[0];
      $('#fontFileLabel').textContent = file
        ? `${file.name} · ${(file.size / (1024 * 1024)).toFixed(2)} MB`
        : defaultFontFileLabel();
      return;
    }

    if (
      target.matches(
        '#fontCategory, #fontTypeClass, #fontAccent, #fontBackground, #fontPrice'
      )
    ) {
      updateFontPreview();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target instanceof Element ? event.target : null;
    const row = target?.closest('tr[data-order-open]');
    if (!row || target.closest('button, a, input, textarea, select')) return;
    event.preventDefault();
    openOrderDialog(row.dataset.orderOpen);
  });

  window.addEventListener('hashchange', () => {
    if (!state.session) return;
    const view = viewFromHash();
    if (view !== state.view) switchView(view);
  });

  const desktopQuery = window.matchMedia('(min-width: 901px)');
  desktopQuery.addEventListener?.('change', (event) => {
    if (event.matches) closeSidebar();
  });
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                       */
/* -------------------------------------------------------------------------- */

async function init() {
  bindEvents();
  setTopbarDate();

  try {
    const me = await api('/api/admin/me', { allow401: true });
    if (me?.authenticated) showApp(me);
    else showLogin();
  } catch (error) {
    showLogin(error.message);
  }
}

init();
