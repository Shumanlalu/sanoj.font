'use strict';

document.documentElement.classList.add('js');

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const state = {
  fonts: [],
  store: null,
  cart: [],
  filter: 'All',
  lab: {
    fontId: null,
    color: '#d8ff3e',
    depth: 18,
    rotationX: -8,
    rotationY: 14,
    rotationZ: -2,
  },
};

const CART_KEY = 'sanoj_bag_v1';
const CUSTOMER_KEY = 'sanoj_customer_v1';
const LAST_ORDER_KEY = 'sanoj_last_order_v1';

const fontStyleMap = {
  'type-orbit': { family: "'Unbounded', sans-serif", weight: 600, lineHeight: 0.86 },
  'type-grotesk': { family: "'Space Grotesk', sans-serif", weight: 600, lineHeight: 0.9 },
  'type-atelier': { family: "'DM Serif Display', Georgia, serif", weight: 400, lineHeight: 0.95 },
  'type-monolith': { family: "'Bebas Neue', Impact, sans-serif", weight: 400, lineHeight: 0.8 },
  'type-signal': { family: "'Space Mono', monospace", weight: 700, lineHeight: 0.9 },
  'type-future': { family: "'Syne', sans-serif", weight: 700, lineHeight: 0.9 },
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

const shortName = (font) => font.name.replace(/^Sanoj\s+/i, '');

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
    throw new Error(payload?.error || 'Something went wrong. Please try again.');
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
  }, 3800);
}

function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 10);
  } catch {
    return [];
  }
}

function saveCart() {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
  } catch {
    // Private browsing can make localStorage unavailable.
  }
}

function getCartFonts() {
  return state.cart
    .map((id) => state.fonts.find((font) => font.id === id))
    .filter(Boolean);
}

function cartTotal() {
  return getCartFonts().reduce((sum, font) => sum + font.price, 0);
}

/* ------------------------------------------------------------------ */
/* Store content                                                      */
/* ------------------------------------------------------------------ */

function applyStoreSettings(store) {
  if (!store) return;

  state.store = store;

  if (store.announcement) {
    const eyebrow = $('#heroEyebrow');
    if (eyebrow) {
      eyebrow.innerHTML = `${escapeHtml(store.announcement)} <span>·</span> Edition 01`;
    }
  }

  if (store.support_email) {
    const mail = `mailto:${store.support_email}`;
    const emailLink = $('#supportEmailLink');
    if (emailLink) {
      emailLink.href = mail;
      emailLink.innerHTML = `${escapeHtml(store.support_email)} <span>↗</span>`;
    }
    const footerEmail = $('#footerEmail');
    if (footerEmail) {
      footerEmail.href = mail;
      footerEmail.textContent = 'Email ↗';
    }
  }

  if (store.instagram) {
    const handle = store.instagram.replace(/^@/, '').trim();
    const url = `https://instagram.com/${encodeURIComponent(handle)}`;
    const instagram = $('#instagramLink');
    if (instagram) {
      instagram.href = url;
      instagram.textContent = `@${handle}`;
    }
    const footerInstagram = $('#footerInstagram');
    if (footerInstagram) footerInstagram.href = url;
  }
}

function renderFilterCounts() {
  $$('.filter-pill').forEach((button) => {
    const filter = button.dataset.filter;
    const count = filter === 'All'
      ? state.fonts.length
      : state.fonts.filter((font) => font.category === filter).length;

    const existing = $('span', button);
    if (existing) existing.textContent = String(count).padStart(2, '0');
    else if (filter === 'All') {
      const span = document.createElement('span');
      span.textContent = String(count).padStart(2, '0');
      button.append(span);
    }
  });
}

function createFontCard(font, index) {
  const word = shortName(font);
  const watermark = font.name.charAt(0).toUpperCase();
  const badge = font.badge
    ? `<span class="font-badge">${escapeHtml(font.badge)}</span>`
    : '<span></span>';

  return `
    <article class="font-card ${escapeHtml(font.typeClass)}" data-font-card="${font.id}" style="--card-bg:${escapeHtml(font.background)};--card-ink:${escapeHtml(font.accent)}">
      <div class="font-card-tilt">
        <div class="font-card-top">
          <span class="font-index">${String(index + 1).padStart(2, '0')} / ${escapeHtml(font.category)}</span>
          ${badge}
          <button class="font-open" type="button" data-open-font="${font.id}">Specimen ↗</button>
        </div>
        <div class="font-visual" data-open-font="${font.id}">
          <span class="font-watermark" aria-hidden="true">${escapeHtml(watermark)}</span>
          <span class="font-sample">${escapeHtml(word)}</span>
          <span class="font-alphabet">Aa Bb Cc · ${escapeHtml(font.styles)}</span>
        </div>
        <div class="font-card-bottom">
          <div class="font-title">
            <h3>${escapeHtml(word)} <span>${escapeHtml(font.category)}</span></h3>
            <p>${escapeHtml(font.styles)} · ${font.glyphs} glyphs</p>
          </div>
          <div class="font-buy">
            <span class="font-price">${formatMoney(font.price)}</span>
            <button class="add-font-button" type="button" data-add-font="${font.id}" aria-label="Add ${escapeHtml(font.name)} to bag">+</button>
          </div>
        </div>
      </div>
    </article>
  `;
}

function fitFontSamples() {
  $$('.font-card .font-visual').forEach((visual) => {
    const sample = $('.font-sample', visual);
    if (!sample) return;

    sample.style.fontSize = '';
    const available = visual.clientWidth - 34;
    if (available <= 0) return;

    const rect = sample.getBoundingClientRect();
    if (!rect.width) return;

    if (sample.scrollWidth > available) {
      const current = Number.parseFloat(getComputedStyle(sample).fontSize);
      const next = Math.max(30, current * (available / sample.scrollWidth));
      sample.style.fontSize = `${next}px`;
    }
  });
}

function attachCardTilt(card) {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  const tilt = $('.font-card-tilt', card);
  if (!tilt) return;

  card.addEventListener('pointermove', (event) => {
    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    card.style.setProperty('--card-ry', `${(x * 7).toFixed(2)}deg`);
    card.style.setProperty('--card-rx', `${(-y * 6).toFixed(2)}deg`);
  });

  card.addEventListener('pointerleave', () => {
    card.style.setProperty('--card-ry', '0deg');
    card.style.setProperty('--card-rx', '0deg');
  });
}

function renderFontGrid() {
  const grid = $('#fontGrid');
  const status = $('#gridStatus');
  if (!grid) return;

  const filtered = state.filter === 'All'
    ? state.fonts
    : state.fonts.filter((font) => font.category === state.filter);

  if (!filtered.length) {
    grid.innerHTML = `
      <div class="grid-empty">
        <div><strong>No faces in this corner.</strong><span>Try another filter or check back for the next drop.</span></div>
      </div>
    `;
    status.textContent = '';
    return;
  }

  grid.innerHTML = filtered.map(createFontCard).join('');
  $$('.font-card', grid).forEach(attachCardTilt);
  status.textContent = `${String(filtered.length).padStart(2, '0')} ${filtered.length === 1 ? 'typeface' : 'typefaces'} · Prices include a personal desktop license`;

  requestAnimationFrame(() => {
    fitFontSamples();
    if (document.fonts?.ready) {
      document.fonts.ready.then(fitFontSamples);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Cart                                                               */
/* ------------------------------------------------------------------ */

function syncCartUI() {
  const count = state.cart.length;
  const countEl = $('#cartCount');
  const drawerCount = $('#cartDrawerCount');
  const items = getCartFonts();
  const total = items.reduce((sum, font) => sum + font.price, 0);

  if (countEl) countEl.textContent = String(count);
  if (drawerCount) drawerCount.textContent = `(${count})`;

  const cartItems = $('#cartItems');
  const cartEmpty = $('#cartEmpty');
  const cartFooter = $('#cartFooter');

  if (cartItems) {
    cartItems.innerHTML = items.map((font) => `
      <article class="cart-item">
        <div class="cart-item-swatch ${escapeHtml(font.typeClass)}" style="--sample-bg:${escapeHtml(font.background)};--sample-ink:${escapeHtml(font.accent)}">
          <span>${escapeHtml(shortName(font).charAt(0))}</span>
        </div>
        <div class="cart-item-info">
          <h3>${escapeHtml(shortName(font))}</h3>
          <p>Personal desktop license</p>
          <strong>${formatMoney(font.price)}</strong>
        </div>
        <button class="cart-remove" type="button" data-remove-font="${font.id}" aria-label="Remove ${escapeHtml(font.name)} from bag">×</button>
      </article>
    `).join('');
  }

  if (cartEmpty) cartEmpty.hidden = items.length > 0;
  if (cartFooter) cartFooter.classList.toggle('is-hidden', items.length === 0);
  if ($('#cartSubtotal')) $('#cartSubtotal').textContent = formatMoney(total);
}

function bumpBag() {
  const count = $('#cartCount');
  if (!count) return;
  count.classList.remove('is-bumping');
  void count.offsetWidth;
  count.classList.add('is-bumping');
}

function addToCart(fontId, { openDrawer = false } = {}) {
  const font = state.fonts.find((entry) => entry.id === Number(fontId));
  if (!font) return;

  if (state.cart.includes(font.id)) {
    showToast(`${shortName(font)} is already in your bag.`);
    if (openDrawer) openCart();
    return;
  }

  if (state.cart.length >= 10) {
    showToast('Your bag can hold up to 10 typefaces at once.', 'error');
    return;
  }

  state.cart.push(font.id);
  saveCart();
  syncCartUI();
  bumpBag();
  showToast(`${shortName(font)} added to your bag.`);

  if (openDrawer) {
    window.setTimeout(openCart, 180);
  }
}

function removeFromCart(fontId) {
  const font = state.fonts.find((entry) => entry.id === Number(fontId));
  state.cart = state.cart.filter((id) => id !== Number(fontId));
  saveCart();
  syncCartUI();
  if (font) showToast(`${shortName(font)} removed from your bag.`);
}

function openCart() {
  closeMobileMenu();
  const drawer = $('#cartDrawer');
  const backdrop = $('#cartBackdrop');
  if (!drawer || !backdrop) return;

  syncCartUI();
  backdrop.hidden = false;
  requestAnimationFrame(() => {
    backdrop.classList.add('is-visible');
    drawer.classList.add('is-open');
  });
  drawer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('is-locked');
  $('#cartClose')?.focus({ preventScroll: true });
}

function closeCart() {
  const drawer = $('#cartDrawer');
  const backdrop = $('#cartBackdrop');
  if (!drawer || !backdrop) return;

  drawer.classList.remove('is-open');
  backdrop.classList.remove('is-visible');
  drawer.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('is-locked');

  window.setTimeout(() => {
    if (!drawer.classList.contains('is-open')) backdrop.hidden = true;
  }, 420);
}

function openCheckoutDialog() {
  if (!state.cart.length) {
    showToast('Add a typeface before checking out.', 'error');
    return;
  }

  closeCart();

  const list = $('#checkoutMiniList');
  const items = getCartFonts();
  if (list) {
    list.innerHTML = items.map((font) => `
      <div class="checkout-mini-item">
        <span>${escapeHtml(shortName(font))}</span>
        <strong>${formatMoney(font.price)}</strong>
      </div>
    `).join('');
  }
  if ($('#checkoutTotal')) $('#checkoutTotal').textContent = formatMoney(cartTotal());

  try {
    const saved = JSON.parse(localStorage.getItem(CUSTOMER_KEY) || '{}');
    if (saved.name) $('#customerName').value = saved.name;
    if (saved.email) $('#customerEmail').value = saved.email;
    if (saved.phone) $('#customerPhone').value = saved.phone;
  } catch {
    // Ignore unavailable saved customer details.
  }

  if ($('#checkoutError')) $('#checkoutError').textContent = '';
  const dialog = $('#checkoutDialog');
  if (dialog && !dialog.open) {
    dialog.showModal();
    document.body.classList.add('is-locked');
    window.setTimeout(() => $('#customerName')?.focus(), 120);
  }
}

/* ------------------------------------------------------------------ */
/* Specimen dialog                                                    */
/* ------------------------------------------------------------------ */

function applyTypeStyle(element, font) {
  const style = fontStyleMap[font.typeClass] || fontStyleMap['type-grotesk'];
  element.style.fontFamily = style.family;
  element.style.fontWeight = String(style.weight);
  element.style.lineHeight = String(style.lineHeight);
}

function fitSpecimenInput() {
  const input = $('#specimenEdit');
  if (!input) return;

  const container = input.parentElement;
  if (!container) return;

  const style = getComputedStyle(input);
  const canvas = fitSpecimenInput.canvas || (fitSpecimenInput.canvas = document.createElement('canvas'));
  const context = canvas.getContext('2d');
  context.font = `${style.fontWeight} 100px ${style.fontFamily}`;

  const text = input.value || 'Aa';
  const measured = Math.max(context.measureText(text).width, 60);
  const available = container.clientWidth - 8;
  const ideal = Math.max(32, Math.min(190, (available / measured) * 100 * 0.98));
  input.style.fontSize = `${ideal}px`;
}

function openSpecimen(fontId) {
  const font = state.fonts.find((entry) => entry.id === Number(fontId));
  const dialog = $('#specimenDialog');
  const content = $('#specimenContent');
  if (!font || !dialog || !content) return;

  dialog.style.setProperty('--spec-bg', font.background);
  dialog.style.setProperty('--spec-ink', font.accent);

  content.innerHTML = `
    <div class="specimen-shell">
      <button class="close-button specimen-close" id="specimenClose" type="button" aria-label="Close specimen">
        <span></span><span></span>
      </button>
      <div class="specimen-top">
        <span>${escapeHtml(font.category)} / ${escapeHtml(font.styles)}</span>
        <span>${String(font.glyphs)} glyphs · Personal license</span>
      </div>
      <div class="specimen-type-wrap">
        <input class="specimen-edit" id="specimenEdit" value="${escapeHtml(shortName(font))}" maxlength="18" aria-label="Preview your own text" spellcheck="false">
      </div>
      <div class="specimen-divider"></div>
      <div class="specimen-content-grid">
        <div>
          <div class="specimen-glyphs" id="specimenGlyphs">
            <span class="specimen-glyphs-label">Full character set preview</span>
            AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz 0123456789 &amp; @ # % ( ) [ ] { } — “ ”
          </div>
          <p class="specimen-tip">Click the type above and make it yours. 18 characters max.</p>
        </div>
        <div class="specimen-info">
          <h3>${escapeHtml(font.name)}</h3>
          <p>${escapeHtml(font.tagline)}</p>
          <p>${escapeHtml(font.description)}</p>
          <div class="specimen-meta">
            <span><span>Category</span><span>${escapeHtml(font.category)}</span></span>
            <span><span>Styles</span><span>${escapeHtml(font.styles)}</span></span>
            <span><span>Glyph count</span><span>${font.glyphs}</span></span>
            <span><span>Delivery</span><span>After verification</span></span>
          </div>
          <div class="specimen-buy">
            <span class="specimen-price">${formatMoney(font.price)}</span>
            <button class="specimen-add" id="specimenAdd" type="button" data-specimen-add="${font.id}">Add to bag <span>+</span></button>
          </div>
        </div>
      </div>
    </div>
  `;

  const input = $('#specimenEdit');
  applyTypeStyle(input, font);
  const glyphs = $('#specimenGlyphs');
  glyphs.style.fontFamily = (fontStyleMap[font.typeClass] || fontStyleMap['type-grotesk']).family;

  $('#specimenClose')?.addEventListener('click', () => dialog.close());
  input?.addEventListener('input', fitSpecimenInput);
  $('#specimenAdd')?.addEventListener('click', () => {
    dialog.close();
    addToCart(font.id, { openDrawer: true });
  });

  if (!dialog.open) {
    dialog.showModal();
    document.body.classList.add('is-locked');
  }

  requestAnimationFrame(() => {
    fitSpecimenInput();
    if (document.fonts?.ready) document.fonts.ready.then(fitSpecimenInput);
  });
}

/* ------------------------------------------------------------------ */
/* Type lab                                                           */
/* ------------------------------------------------------------------ */

function shadeColor(hex, amount) {
  let normalized = hex.replace('#', '');
  if (normalized.length === 3) normalized = normalized.split('').map((char) => char + char).join('');
  const number = Number.parseInt(normalized, 16);
  const factor = Math.max(0, 1 - amount);

  const red = Math.round(((number >> 16) & 0xff) * factor);
  const green = Math.round(((number >> 8) & 0xff) * factor);
  const blue = Math.round((number & 0xff) * factor);
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function buildExtrusion(color, depth) {
  const layers = [];
  const total = Math.max(4, Math.min(42, Number(depth) || 18));
  for (let step = 1; step <= total; step += 1) {
    const amount = 0.12 + (step / total) * 0.62;
    const offset = Math.max(1, Math.round(step * 0.72));
    layers.push(`${offset}px ${offset}px 0 ${shadeColor(color, amount)}`);
  }
  layers.push('0.05em 0.1em 0.2em rgba(0, 0, 0, 0.38)');
  return layers.join(', ');
}

function selectedLabFont() {
  return state.fonts.find((font) => font.id === state.lab.fontId) || state.fonts[0] || null;
}

function fitLabOutput() {
  const wrap = $('.lab-output-wrap');
  const output = $('#labOutput');
  if (!wrap || !output) return;

  output.style.fontSize = '100px';
  const textWidth = output.scrollWidth || 100;
  const available = Math.max(160, wrap.clientWidth - 36);
  const ideal = Math.max(34, Math.min(250, (available / textWidth) * 100));
  output.style.fontSize = `${ideal}px`;
}

function updateLabTransform() {
  const output = $('#labOutput');
  if (!output) return;

  output.style.setProperty('--lab-rx', `${state.lab.rotationX}deg`);
  output.style.setProperty('--lab-ry', `${state.lab.rotationY}deg`);
  output.style.setProperty('--lab-rz', `${state.lab.rotationZ}deg`);

  const coords = $('#labCoordinates');
  if (coords) {
    const format = (value) => `${value < 0 ? '−' : ''}${String(Math.abs(Math.round(value))).padStart(2, '0')}°`;
    coords.textContent = `X ${format(state.lab.rotationY)} / Y ${format(state.lab.rotationX)}`;
  }
}

function renderLab() {
  const font = selectedLabFont();
  const output = $('#labOutput');
  const input = $('#labInput');
  const stage = $('#labStage');
  if (!font || !output || !input || !stage) return;

  const word = input.value.trim() || 'ORBIT';
  output.textContent = word;
  applyTypeStyle(output, font);
  output.style.color = state.lab.color;
  output.style.textShadow = buildExtrusion(state.lab.color, state.lab.depth);
  stage.style.setProperty('--lab-color', state.lab.color);
  stage.style.background = `radial-gradient(circle at 63% 30%, ${state.lab.color}1f, transparent 52%), #151711`;

  if ($('#labProductName')) $('#labProductName').textContent = shortName(font);
  if ($('#labProductPrice')) $('#labProductPrice').textContent = formatMoney(font.price);

  updateLabTransform();
  requestAnimationFrame(() => {
    fitLabOutput();
    if (document.fonts?.ready) document.fonts.ready.then(fitLabOutput);
  });
}

function initLab() {
  const select = $('#labFont');
  if (!select || !state.fonts.length) return;

  select.innerHTML = state.fonts.map((font) => `
    <option value="${font.id}">${escapeHtml(shortName(font))} — ${escapeHtml(font.styles)}</option>
  `).join('');

  state.lab.fontId = state.fonts[0].id;
  select.value = String(state.lab.fontId);

  select.addEventListener('change', () => {
    state.lab.fontId = Number(select.value);
    renderLab();
  });

  $('#labInput')?.addEventListener('input', renderLab);
  $('#labDepth')?.addEventListener('input', (event) => {
    state.lab.depth = Number(event.target.value);
    if ($('#labDepthValue')) $('#labDepthValue').textContent = String(state.lab.depth);
    renderLab();
  });

  $$('#labColors .color-swatch').forEach((swatch) => {
    swatch.addEventListener('click', () => {
      state.lab.color = swatch.dataset.color;
      $$('#labColors .color-swatch').forEach((entry) => {
        entry.classList.toggle('is-active', entry === swatch);
        entry.setAttribute('aria-pressed', entry === swatch ? 'true' : 'false');
      });
      renderLab();
    });
  });

  $('#labAdd')?.addEventListener('click', () => {
    const font = selectedLabFont();
    if (font) addToCart(font.id);
  });

  const stage = $('#labStage');
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let baseX = 0;
  let baseY = 0;

  stage?.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    baseX = state.lab.rotationX;
    baseY = state.lab.rotationY;
    stage.classList.add('is-dragging');
    stage.setPointerCapture?.(event.pointerId);
  });

  stage?.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    state.lab.rotationX = Math.max(-46, Math.min(46, baseX - (event.clientY - startY) * 0.28));
    state.lab.rotationY = Math.max(-60, Math.min(60, baseY + (event.clientX - startX) * 0.32));
    updateLabTransform();
  });

  const finishDrag = (event) => {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('is-dragging');
    if (event?.pointerId !== undefined) stage.releasePointerCapture?.(event.pointerId);
  };

  stage?.addEventListener('pointerup', finishDrag);
  stage?.addEventListener('pointercancel', finishDrag);
  stage?.addEventListener('pointerleave', (event) => {
    if (event.buttons === 0) finishDrag(event);
  });

  $('#labReset')?.addEventListener('click', () => {
    state.lab.rotationX = -8;
    state.lab.rotationY = 14;
    state.lab.rotationZ = -2;
    updateLabTransform();
  });

  renderLab();

  const resizeObserver = new ResizeObserver(() => fitLabOutput());
  const wrap = $('.lab-output-wrap');
  if (wrap) resizeObserver.observe(wrap);
}

/* ------------------------------------------------------------------ */
/* Hero, navigation & reveal                                          */
/* ------------------------------------------------------------------ */

function initHeroTilt() {
  const stage = $('#heroStage');
  const word = $('#heroTitle');
  if (!stage || !word || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  stage.addEventListener('pointermove', (event) => {
    const rect = stage.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    word.style.setProperty('--hero-ry', `${(8 + x * 15).toFixed(2)}deg`);
    word.style.setProperty('--hero-rx', `${(-5 - y * 10).toFixed(2)}deg`);
    word.style.setProperty('--hero-rz', `${(-1.5 + x * 3).toFixed(2)}deg`);
  });

  stage.addEventListener('pointerleave', () => {
    word.style.setProperty('--hero-ry', '8deg');
    word.style.setProperty('--hero-rx', '-5deg');
    word.style.setProperty('--hero-rz', '-1.5deg');
  });
}

function initHeader() {
  const header = $('#siteHeader');
  const menuToggle = $('#menuToggle');
  const mobileMenu = $('#mobileMenu');

  const updateHeader = () => {
    header?.classList.toggle('is-scrolled', window.scrollY > 42 && !mobileMenu?.classList.contains('is-open'));
  };

  window.addEventListener('scroll', updateHeader, { passive: true });
  updateHeader();

  menuToggle?.addEventListener('click', () => {
    const isOpen = mobileMenu?.classList.toggle('is-open');
    menuToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    mobileMenu?.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    document.body.classList.toggle('is-locked', Boolean(isOpen));
    header?.classList.toggle('is-scrolled', !isOpen && window.scrollY > 42);
  });

  $$('#mobileMenu a').forEach((link) => link.addEventListener('click', closeMobileMenu));

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeMobileMenu();
    if ($('#cartDrawer')?.classList.contains('is-open')) closeCart();
  });
}

function closeMobileMenu() {
  const mobileMenu = $('#mobileMenu');
  const menuToggle = $('#menuToggle');
  if (!mobileMenu?.classList.contains('is-open')) return;

  mobileMenu.classList.remove('is-open');
  mobileMenu.setAttribute('aria-hidden', 'true');
  menuToggle?.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('is-locked');
  $('#siteHeader')?.classList.toggle('is-scrolled', window.scrollY > 42);
}

function initReveals() {
  const elements = $$('[data-reveal]');
  if (!('IntersectionObserver' in window)) {
    elements.forEach((element) => element.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -4% 0px' });

  elements.forEach((element) => observer.observe(element));
}

/* ------------------------------------------------------------------ */
/* Checkout form & events                                             */
/* ------------------------------------------------------------------ */

function initCheckoutForm() {
  const form = $('#checkoutForm');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const name = $('#customerName').value.trim();
    const email = $('#customerEmail').value.trim();
    const phone = $('#customerPhone').value.trim();
    const terms = $('#terms').checked;
    const errorEl = $('#checkoutError');
    const submit = $('#checkoutSubmit');

    if (!name || name.length < 2) {
      errorEl.textContent = 'Please enter your full name.';
      $('#customerName').focus();
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      errorEl.textContent = 'Please enter a valid email address.';
      $('#customerEmail').focus();
      return;
    }
    if (!phone || phone.replace(/\D/g, '').length < 8) {
      errorEl.textContent = 'Please enter a valid phone number.';
      $('#customerPhone').focus();
      return;
    }
    if (!terms) {
      errorEl.textContent = 'Please confirm that you understand the UPI verification step.';
      $('#terms').focus();
      return;
    }
    if (!state.cart.length) {
      errorEl.textContent = 'Your bag is empty.';
      return;
    }

    errorEl.textContent = '';
    submit.disabled = true;
    const initialLabel = submit.innerHTML;
    submit.textContent = 'Creating your order…';

    try {
      const result = await fetchJson('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          name,
          email,
          phone,
          items: state.cart,
        }),
      });

      localStorage.setItem(CUSTOMER_KEY, JSON.stringify({ name, email, phone }));
      localStorage.setItem(LAST_ORDER_KEY, result.orderId);
      state.cart = [];
      saveCart();
      syncCartUI();
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      errorEl.textContent = error.message;
      showToast(error.message, 'error');
      submit.disabled = false;
      submit.innerHTML = initialLabel;
    }
  });
}

function initEvents() {
  $('#cartOpen')?.addEventListener('click', openCart);
  $('#cartClose')?.addEventListener('click', closeCart);
  $('#cartBackdrop')?.addEventListener('click', closeCart);
  $('#emptyBrowse')?.addEventListener('click', () => {
    closeCart();
    $('#fonts')?.scrollIntoView({ behavior: 'smooth' });
  });
  $('#cartCheckout')?.addEventListener('click', openCheckoutDialog);
  $('#checkoutClose')?.addEventListener('click', () => $('#checkoutDialog')?.close());

  $('#fontFilters')?.addEventListener('click', (event) => {
    const button = event.target.closest('.filter-pill');
    if (!button) return;

    state.filter = button.dataset.filter || 'All';
    $$('.filter-pill').forEach((pill) => pill.classList.toggle('is-active', pill === button));
    renderFontGrid();
  });

  $('#fontGrid')?.addEventListener('click', (event) => {
    const add = event.target.closest('[data-add-font]');
    if (add) {
      addToCart(add.dataset.addFont);
      return;
    }

    const open = event.target.closest('[data-open-font]');
    if (open) openSpecimen(open.dataset.openFont);
  });

  $('#cartItems')?.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-font]');
    if (remove) removeFromCart(remove.dataset.removeFont);
  });

  $$('dialog.modal').forEach((dialog) => {
    dialog.addEventListener('close', () => {
      if (!dialog.open) {
        if (!$('#cartDrawer')?.classList.contains('is-open')) {
          document.body.classList.remove('is-locked');
        }
        if (dialog.id === 'specimenDialog') {
          dialog.removeAttribute('style');
        }
      }
    });

    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      fitFontSamples();
      fitSpecimenInput();
    }, 120);
  });

  $('#footerYear') && ($('#footerYear').textContent = String(new Date().getFullYear()));
}

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */

async function loadContent() {
  const grid = $('#fontGrid');
  try {
    const [fontPayload, storePayload] = await Promise.all([
      fetchJson('/api/fonts'),
      fetchJson('/api/store'),
    ]);

    state.fonts = Array.isArray(fontPayload.fonts) ? fontPayload.fonts : [];
    state.cart = loadCart().filter((id) => state.fonts.some((font) => font.id === id));

    applyStoreSettings(storePayload.store);
    renderFilterCounts();
    renderFontGrid();
    syncCartUI();
    initLab();
  } catch (error) {
    if (grid) {
      grid.innerHTML = `
        <div class="grid-empty">
          <div><strong>The specimen table is taking a moment.</strong><span>${escapeHtml(error.message)}</span></div>
        </div>
      `;
    }
    showToast('Could not load the collection. Refresh to try again.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initHeader();
  initHeroTilt();
  initReveals();
  initEvents();
  initCheckoutForm();
  loadContent();
});
