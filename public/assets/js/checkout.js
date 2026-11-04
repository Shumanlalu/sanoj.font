'use strict';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const LAST_ORDER_KEY = 'sanoj_last_order_v1';
let currentOrder = null;
let pollTimer = null;
let loading = false;

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

const formatDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '—';
  }
};

const shortName = (name) => String(name || '').replace(/^Sanoj\s+/i, '');
const shortOrderId = (id) => String(id || '').split('-')[0].toUpperCase();
const firstLetter = (name) => shortName(name).charAt(0) || 'A';

const statusLabels = {
  pending: 'Awaiting payment',
  review: 'Verification in progress',
  paid: 'Payment verified',
  rejected: 'Reference rejected',
  cancelled: 'Order cancelled',
};

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(payload?.error || 'Something went wrong. Please try again.');
    error.status = response.status;
    throw error;
  }

  return payload;
}

function showToast(message, type = 'success') {
  const stack = $('#toastStack');
  if (!stack) return;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.textContent = message;
  stack.append(toast);

  requestAnimationFrame(() => toast.classList.add('is-visible'));
  window.setTimeout(() => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => toast.remove(), 350);
  }, 4200);
}

function statusChip(status) {
  const label = statusLabels[status] || status;
  return `<span class="status-chip status-chip--${escapeHtml(status)}">${escapeHtml(label)}</span>`;
}

function updateProgress(status) {
  const bag = $('[data-progress="bag"]');
  const payment = $('[data-progress="payment"]');
  const files = $('[data-progress="files"]');
  if (!bag || !payment || !files) return;

  $$('.progress-step').forEach((step) => step.classList.remove('is-active', 'is-complete'));
  bag.classList.add('is-complete');

  if (status === 'paid') {
    payment.classList.add('is-complete');
    files.classList.add('is-active');
  } else if (status === 'pending' || status === 'review' || status === 'rejected') {
    payment.classList.add('is-active');
  } else {
    payment.classList.add('is-active');
  }
}

function renderSummary(order) {
  const items = order.items.map((item) => `
    <div class="summary-item">
      <div class="summary-swatch ${escapeHtml(item.typeClass)}" style="--sample-bg:#e9e4d7;--sample-ink:#10110d">
        <span>${escapeHtml(firstLetter(item.name))}</span>
      </div>
      <div>
        <h3>${escapeHtml(shortName(item.name))}</h3>
        <p>${escapeHtml(item.license)} license</p>
      </div>
      <strong>${formatMoney(item.price)}</strong>
    </div>
  `).join('');

  return `
    <aside class="order-aside">
      <div class="aside-inner">
        <div class="aside-top">
          <span class="mini-label">Order summary</span>
          <span class="aside-order-id">#${escapeHtml(shortOrderId(order.id))}</span>
        </div>
        <div class="summary-items">${items}</div>
        <div class="summary-total">
          <span>${order.status === 'paid' ? 'Total paid' : 'Order total'}</span>
          <strong>${formatMoney(order.amount)}</strong>
        </div>
        <div class="summary-meta">
          <div class="summary-meta-row"><span>Name</span><strong>${escapeHtml(order.customerName)}</strong></div>
          <div class="summary-meta-row"><span>Email</span><strong>${escapeHtml(order.email)}</strong></div>
          <div class="summary-meta-row"><span>Phone</span><strong>${escapeHtml(order.phone)}</strong></div>
          <div class="summary-meta-row"><span>Placed</span><strong>${escapeHtml(formatDate(order.createdAt))}</strong></div>
          ${order.utr ? `<div class="summary-meta-row"><span>UPI ref.</span><strong>${escapeHtml(order.utr)}</strong></div>` : ''}
        </div>
        <div class="aside-support">
          <span>Studio support</span>
          <p>Questions about your order? Reply with <strong>#${escapeHtml(shortOrderId(order.id))}</strong> and we'll help.</p>
          <a href="mailto:${escapeHtml(order.support.email)}">${escapeHtml(order.support.email)}</a>
          ${order.support.phone ? `<a href="tel:${escapeHtml(order.support.phone.replace(/\s+/g, ''))}">${escapeHtml(order.support.phone)}</a>` : ''}
        </div>
      </div>
    </aside>
  `;
}

function orderHead(order) {
  return `
    <div class="order-head">
      <div class="order-head-left">
        <span class="order-number">Order <strong>#${escapeHtml(shortOrderId(order.id))}</strong></span>
        ${statusChip(order.status)}
      </div>
      <span class="order-number">${escapeHtml(formatDate(order.createdAt))}</span>
    </div>
  `;
}

function utrForm(order, { error = '', compact = false } = {}) {
  return `
    <form class="utr-form" data-utr-form novalidate>
      <div class="utr-field">
        <label for="${compact ? 'utrUpdate' : 'utrInput'}">UPI reference / UTR number</label>
        <input
          id="${compact ? 'utrUpdate' : 'utrInput'}"
          name="utr"
          type="text"
          inputmode="text"
          autocomplete="off"
          spellcheck="false"
          maxlength="30"
          pattern="[A-Za-z0-9-]{6,30}"
          placeholder="e.g. 425839112045"
          value="${escapeHtml(order.utr || '')}"
          required
        >
      </div>
      <button class="button" type="submit">${compact ? 'Update reference' : 'Verify payment'} <span>↗</span></button>
    </form>
    <p class="utr-help">Find this in your UPI app under <strong>Payment history → transaction details</strong>. It is usually 12 digits.</p>
    <p class="verify-error" data-utr-error role="alert" ${error ? '' : 'hidden'}>${escapeHtml(error)}</p>
  `;
}

function paymentShell(order) {
  const payment = order.payment;
  if (!payment) return '';

  return `
    <div class="payment-shell">
      <div class="qr-card">
        <div class="qr-frame">
          <img src="${payment.qrDataUrl}" alt="UPI payment QR code for ${formatMoney(order.amount)}">
        </div>
        <span class="qr-label"><i></i> Scan with any UPI app</span>
      </div>
      <div class="payment-details">
        <span class="amount-label">Amount to pay</span>
        <strong class="payment-amount">${formatMoney(order.amount)}</strong>
        <div class="upi-copy">
          <div>
            <span>UPI ID · ${escapeHtml(payment.upiName)}</span>
            <code>${escapeHtml(payment.upiId)}</code>
          </div>
          <button class="copy-button" type="button" data-copy="${escapeHtml(payment.upiId)}">Copy</button>
        </div>
        <a class="button button--ink upi-open" href="${escapeHtml(payment.link)}">Open UPI app <span>↗</span></a>
        <div class="upi-apps" aria-label="Works with major UPI apps">
          <span><i>G</i> GPay</span>
          <span><i>P</i> PhonePe</span>
          <span><i>P</i> Paytm</span>
          <span><i>B</i> BHIM</span>
        </div>
        <p class="upi-note">Paying from a desktop? Scan the code with your phone. Include the note <strong>${escapeHtml(payment.note)}</strong> if your app asks for one.</p>
      </div>
    </div>
  `;
}

function paymentDisclaimer() {
  return `
    <p class="payment-disclaimer">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-2.9 8.3-7 10-4.1-1.7-7-5.5-7-10V6l7-3z"/><path d="M9.5 12l1.7 1.7 3.5-3.7"/></svg>
      <span>Direct UPI payment — no card details needed. Your download links unlock after the studio verifies the reference number, usually within a few hours. Keep this page bookmarked.</span>
    </p>
  `;
}

function renderPending(order) {
  const rejected = order.status === 'rejected';
  return `
    <div class="checkout-layout">
      <section class="payment-panel">
        ${orderHead(order)}
        ${rejected ? `
          <div class="state-banner">
            <div><strong>We couldn't match that payment reference.</strong>Check the UTR in your UPI app and try again, or contact the studio with order #${escapeHtml(shortOrderId(order.id))}.</div>
          </div>
        ` : ''}
        <h1 class="pay-title">Complete your<br><em>payment.</em></h1>
        <p class="pay-sub">Scan the QR or open your UPI app and pay <strong>${formatMoney(order.amount)}</strong>. Then come back and enter the transaction reference below.</p>
        ${paymentShell(order)}
        <div class="verify-box">
          <div class="verify-box-head">
            <div>
              <span class="verify-kicker">Already paid? / Step 02</span>
              <h3>Verify your UPI payment.</h3>
            </div>
          </div>
          <p>After paying, copy the UTR / reference number from your payment app and paste it here. We'll verify it against the studio account.</p>
          ${utrForm(order)}
        </div>
        ${paymentDisclaimer()}
      </section>
      ${renderSummary(order)}
    </div>
  `;
}

function renderReview(order) {
  return `
    <div class="checkout-layout">
      <section class="payment-panel">
        ${orderHead(order)}
        <h1 class="pay-title">Payment sent.<br><em>We're on it.</em></h1>
        <p class="pay-sub">Thanks, ${escapeHtml(order.customerName.split(' ')[0] || order.customerName)}. Your reference is with the studio for a quick manual check. Nothing else is needed from you right now.</p>
        <div class="review-card">
          <div class="review-heading">
            <div class="review-icon" aria-hidden="true">⌁</div>
            <div>
              <h2>Verification in progress.</h2>
              <p>We're matching your reference against the UPI account. This page checks automatically, and your files will appear here as soon as the payment is approved.</p>
            </div>
          </div>
          <div class="review-ref">
            <span>Submitted reference</span>
            <strong>${escapeHtml(order.utr || '—')}</strong>
          </div>
          <div class="review-actions">
            <button class="button" type="button" data-refresh-order>Check status ↻</button>
            <a class="review-help-link" href="mailto:${escapeHtml(order.support.email)}?subject=${encodeURIComponent(`Order #${shortOrderId(order.id)}`)}">Need help? Email the studio</a>
          </div>
          <details class="update-reference">
            <summary>Entered the wrong reference?</summary>
            ${utrForm(order, { compact: true })}
          </details>
        </div>
        ${paymentDisclaimer()}
      </section>
      ${renderSummary(order)}
    </div>
  `;
}

function renderPaid(order) {
  const downloads = order.items.map((item) => {
    const available = Boolean(item.downloadUrl);
    return `
      <a class="download-card ${available ? '' : 'download-disabled'}" href="${available ? escapeHtml(item.downloadUrl) : '#'}" ${available ? 'download' : 'aria-disabled="true"'}>
        <span class="download-swatch ${escapeHtml(item.typeClass)}">
          <span>${escapeHtml(firstLetter(item.name))}</span>
        </span>
        <span class="download-info">
          <strong>${escapeHtml(shortName(item.name))}</strong>
          <span>${available ? 'WOFF2 · Personal desktop license' : 'File being prepared · Contact studio'}</span>
        </span>
        <span class="download-arrow" aria-hidden="true">${available ? '↓' : '—'}</span>
      </a>
    `;
  }).join('');

  return `
    <div class="checkout-layout">
      <section class="success-panel">
        <div class="success-top">
          <div class="success-mark" aria-hidden="true">✓</div>
          ${statusChip('paid')}
        </div>
        <h1 class="success-title">It's yours.<br><em>Take it everywhere.</em></h1>
        <p class="success-sub">Payment verified on ${escapeHtml(formatDate(order.paidAt))}. Your personal desktop license and font files are ready below. A copy of this order stays available at this link.</p>
        <div class="download-heading">
          <h2>Your files</h2>
          <span>${order.items.length} ${order.items.length === 1 ? 'typeface' : 'typefaces'} · #${escapeHtml(shortOrderId(order.id))}</span>
        </div>
        <div class="downloads">${downloads}</div>
        <p class="payment-disclaimer" style="border-color:rgba(242,239,230,.12);color:rgba(242,239,230,.45)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-2.9 8.3-7 10-4.1-1.7-7-5.5-7-10V6l7-3z"/></svg>
          <span>Your license covers one person, up to five workstations. Need a commercial license or TTF files? Email the studio with your order number.</span>
        </p>
      </section>
      ${renderSummary(order)}
    </div>
  `;
}

function renderCancelled(order) {
  return `
    <div class="checkout-layout">
      <section class="payment-panel">
        ${orderHead(order)}
        <h1 class="pay-title">This order was<br><em>cancelled.</em></h1>
        <p class="pay-sub">No payment should be sent for this order. If you think this is a mistake, contact the studio with your order number and we'll sort it out.</p>
        <div class="state-banner">
          <div><strong>Need to start a new order?</strong>Head back to the collection and add your typefaces again.</div>
        </div>
        <div class="review-actions" style="margin-top:1.4rem">
          <a class="button" href="/#fonts">Back to the collection ↗</a>
          <a class="review-help-link" href="mailto:${escapeHtml(order.support.email)}?subject=${encodeURIComponent(`Cancelled order #${shortOrderId(order.id)}`)}">Contact the studio</a>
        </div>
      </section>
      ${renderSummary(order)}
    </div>
  `;
}

function renderOrder(order) {
  currentOrder = order;
  loading = false;
  updateProgress(order.status);
  document.title = `Order #${shortOrderId(order.id)} — Sanoj Type Foundry`;

  const supportEmail = $('#checkoutSupportEmail');
  if (supportEmail && order.support.email) {
    supportEmail.textContent = order.support.email;
    supportEmail.href = `mailto:${order.support.email}`;
  }

  let markup = '';
  if (order.status === 'paid') markup = renderPaid(order);
  else if (order.status === 'review') markup = renderReview(order);
  else if (order.status === 'cancelled') markup = renderCancelled(order);
  else markup = renderPending(order);

  $('#checkoutLoading')?.remove();
  const root = $('#checkoutRoot');
  const existing = $('#checkoutContent');
  if (existing) existing.remove();

  const container = document.createElement('div');
  container.id = 'checkoutContent';
  container.innerHTML = markup;
  root.append(container);

  if (order.status === 'review') schedulePoll(order);
}

function renderMissing(message = 'This order link may be incomplete, expired, or from a different session.') {
  loading = false;
  currentOrder = null;
  clearTimeout(pollTimer);
  $('#checkoutProgress')?.setAttribute('hidden', '');
  $('#checkoutLoading')?.remove();
  $('#checkoutContent')?.remove();

  const root = $('#checkoutRoot');
  const container = document.createElement('div');
  container.id = 'checkoutContent';
  container.innerHTML = `
    <div class="missing-state">
      <div>
        <span class="missing-state-mark" aria-hidden="true">?</span>
        <h1>We can't find<br>that order.</h1>
        <p>${escapeHtml(message)}</p>
        <a class="button button--ink" href="/#fonts">Back to the collection <span>↗</span></a>
      </div>
    </div>
  `;
  root.append(container);
}

function renderLoadError(message) {
  loading = false;
  $('#checkoutLoading')?.remove();
  const root = $('#checkoutRoot');
  const container = document.createElement('div');
  container.id = 'checkoutContent';
  container.innerHTML = `
    <div class="missing-state">
      <div>
        <span class="missing-state-mark" aria-hidden="true">!</span>
        <h1>A small<br>hiccup.</h1>
        <p>${escapeHtml(message)}</p>
        <button class="button button--ink" type="button" data-retry-order>Try again ↻</button>
      </div>
    </div>
  `;
  root.append(container);
}

function schedulePoll(order) {
  clearTimeout(pollTimer);
  pollTimer = window.setTimeout(async () => {
    if (!currentOrder || currentOrder.id !== order.id || document.hidden) {
      schedulePoll(order);
      return;
    }

    try {
      const payload = await fetchJson(`/api/orders/${encodeURIComponent(order.id)}`);
      if (payload.order.status !== currentOrder.status) {
        renderOrder(payload.order);
        if (payload.order.status === 'paid') showToast('Payment verified. Your files are ready.');
      } else {
        schedulePoll(order);
      }
    } catch {
      schedulePoll(order);
    }
  }, 30_000);
}

async function loadOrder({ quiet = false } = {}) {
  if (loading) return;
  loading = true;
  clearTimeout(pollTimer);

  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('order') || localStorage.getItem(LAST_ORDER_KEY);

  if (!orderId) {
    renderMissing('Open the checkout link from your order confirmation, or start a new order from the collection.');
    return;
  }

  const refreshButton = $('[data-refresh-order]');
  if (refreshButton && quiet) {
    refreshButton.disabled = true;
    refreshButton.textContent = 'Checking…';
  }

  try {
    const payload = await fetchJson(`/api/orders/${encodeURIComponent(orderId)}`);
    const historyUrl = new URL(window.location.href);
    historyUrl.searchParams.set('order', payload.order.id);
    window.history.replaceState({}, '', historyUrl);
    localStorage.setItem(LAST_ORDER_KEY, payload.order.id);
    renderOrder(payload.order);
    if (quiet) showToast('Status checked — nothing new yet.');
  } catch (error) {
    if (error.status === 404) {
      renderMissing('This order link may be incomplete or no longer available. Check the link from your confirmation, or contact the studio.');
    } else if (currentOrder) {
      showToast(error.message, 'error');
      loading = false;
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.textContent = 'Check status ↻';
      }
      if (currentOrder.status === 'review') schedulePoll(currentOrder);
    } else {
      renderLoadError(error.message);
    }
  }
}

async function copyText(value, button) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  if (button) {
    const original = button.textContent;
    button.textContent = 'Copied';
    window.setTimeout(() => {
      button.textContent = original;
    }, 1800);
  }
  showToast('UPI ID copied.');
}

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-utr-form]');
  if (!form) return;
  event.preventDefault();

  const input = $('input[name="utr"]', form);
  const errorEl = $('[data-utr-error]', form.parentElement) || $('[data-utr-error]', form);
  const button = $('button[type="submit"]', form);
  const value = input.value.trim().replace(/\s+/g, '');

  if (!/^[A-Za-z0-9-]{6,30}$/.test(value)) {
    if (errorEl) {
      errorEl.textContent = 'Enter a valid UPI reference (6–30 letters or digits).';
      errorEl.hidden = false;
    }
    input.focus();
    return;
  }

  if (!currentOrder) return;
  if (errorEl) errorEl.hidden = true;
  button.disabled = true;
  const originalLabel = button.innerHTML;
  button.textContent = 'Submitting…';

  try {
    await fetchJson(`/api/orders/${encodeURIComponent(currentOrder.id)}/utr`, {
      method: 'POST',
      body: JSON.stringify({ utr: value }),
    });
    showToast('Payment reference received. We’ll verify it shortly.');
    await loadOrder();
  } catch (error) {
    if (errorEl) {
      errorEl.textContent = error.message;
      errorEl.hidden = false;
    }
    showToast(error.message, 'error');
    button.disabled = false;
    button.innerHTML = originalLabel;
  }
});

document.addEventListener('click', async (event) => {
  const copy = event.target.closest('[data-copy]');
  if (copy) {
    event.preventDefault();
    await copyText(copy.dataset.copy, copy);
    return;
  }

  const refresh = event.target.closest('[data-refresh-order]');
  if (refresh) {
    event.preventDefault();
    await loadOrder({ quiet: true });
    return;
  }

  const retry = event.target.closest('[data-retry-order]');
  if (retry) {
    $("#checkoutContent")?.remove();
    loadOrder();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const year = $('#checkoutYear');
  if (year) year.textContent = String(new Date().getFullYear());
  loadOrder();
});
