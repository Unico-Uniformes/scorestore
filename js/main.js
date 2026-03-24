/* =========================================================
   SCORE STORE — main.js (Vercel Master Ultimate) — v2026-03-23
   - Integración Total: Carrito, Checkout (Stripe), Cotización (Envía.com)
   - UX Avanzada: Asistente IA, Neuromarketing, Swipe Hints
   - Blindaje Vercel: Assets absolutos y Fallbacks API/Static
========================================================= */

(() => {
  "use strict";

  const APP_VERSION = window.__APP_VERSION__ || "2026.03.23.SCORESTORE-MASTER";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  
  const debounce = (fn, wait = 160) => {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  };

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  const money = (cents) => {
    const v = Number.isFinite(Number(cents)) ? Math.round(cents) : 0;
    return new Intl.NumberFormat("es-MX", {
      style: "currency", currency: "MXN", maximumFractionDigits: 2,
    }).format(v / 100);
  };

  const escapeHtml = (s) =>
    String(s || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  // ✅ Blindaje de Assets para Vercel
  const safeUrl = (u) => {
    const s0 = String(u || "").trim();
    if (!s0 || s0.startsWith("http") || s0.startsWith("data:")) return s0;
    const s1 = s0
      .replaceAll("assets/BAJA_500/", "assets/BAJA500/")
      .replaceAll("assets/BAJA_400/", "assets/BAJA400/")
      .replaceAll("assets/SF_250/", "assets/SF250/")
      .replaceAll("assets/BAJA_1000/", "assets/EDICION_2025/");
    return s1.startsWith("/") ? s1 : `/${s1}`;
  };

  const normCode = (s) => String(s || "").trim().toUpperCase().replace(/\s+/g, "");

  // =========================================================
  // Elementos del DOM (Mapeo Completo)
  // =========================================================
  const els = {
    splash: $("#splash"),
    overlay: $("#overlay"),
    sideMenu: $("#sideMenu"),
    cartDrawer: $("#cartDrawer"),
    assistantModal: $("#assistantModal"),
    productModal: $("#productModal"),
    sizeGuideModal: $("#sizeGuideModal"),
    productGrid: $("#productGrid"),
    categoryGrid: $("#categoryGrid"),
    searchInput: $("#searchInput"),
    mobileSearchInput: $("#mobileSearchInput"),
    menuSearchInput: $("#menuSearchInput"),
    cartCount: $("#cartCount"),
    cartItems: $("#cartItems"),
    cartTotal: $("#cartTotal"),
    cartSubtotal: $("#cartSubtotal"),
    shippingLine: $("#shippingLine"),
    discountLine: $("#discountLine"),
    discountLineWrap: $("#discountLineWrap"),
    shippingNote: $("#shippingNote"),
    postalCode: $("#postalCode"),
    promoCode: $("#promoCode"),
    checkoutBtn: $("#checkoutBtn"),
    toast: $("#toast"),
    promoBar: $("#promoBar"),
    promoBarText: $("#promoBarText"),
    pmQtyDisplay: $("#pmQtyDisplay"),
    pmSizePills: $("#pmSizePills"),
    pmCarousel: $("#pmCarousel"),
    salesNotification: $("#salesNotification"),
    salesName: $("#salesName"),
    salesAction: $("#salesAction")
  };

  const STORAGE_KEYS = {
    cart: "score_cart_v3_master",
    ship: "score_ship_v3_master",
    consent: "score_consent_v3",
    promoDismiss: "score_promo_dismissed",
    seenSwipe: "score_seen_swipe"
  };

  const CATEGORY_CONFIG = [
    { uiId: "BAJA1000", name: "BAJA 1000", logo: "assets/logo-baja1000.webp", mapFrom: ["BAJA1000", "BAJA_1000", "EDICION_2025", "OTRAS_EDICIONES"] },
    { uiId: "BAJA500", name: "BAJA 500", logo: "assets/logo-baja500.webp", mapFrom: ["BAJA500", "BAJA_500"] },
    { uiId: "BAJA400", name: "BAJA 400", logo: "assets/logo-baja400.webp", mapFrom: ["BAJA400", "BAJA_400"] },
    { uiId: "SF250",  name: "SAN FELIPE 250", logo: "assets/logo-sf250.webp", mapFrom: ["SF250", "SF_250"] },
  ];

  // =========================================================
  // State
  // =========================================================
  let products = [], promosData = { rules: [] }, activePromo = null;
  let cart = [], shipping = { mode: "pickup", postal_code: "", quote: null };
  let activeCategory = null, searchQuery = "", sortMode = "featured";
  let currentProduct = null, selectedSize = "", selectedQty = 1;

  // =========================================================
  // Core: UI & Capas
  // =========================================================
  const showToast = (msg, type = "ok") => {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.dataset.type = type;
    els.toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => els.toast.hidden = true, 3000);
  };

  const openLayer = (el) => {
    if (!el) return;
    el.hidden = false;
    els.overlay.hidden = false;
    document.documentElement.classList.add("no-scroll");
    if (el.classList.contains("modal")) requestAnimationFrame(() => el.classList.add("modal--open"));
  };

  const closeLayer = (el) => {
    if (!el || el.hidden) return;
    if (el.classList.contains("modal")) {
      el.classList.remove("modal--open");
      setTimeout(() => { el.hidden = true; finalizeClose(); }, 500);
    } else {
      el.hidden = true;
      finalizeClose();
    }
  };

  const finalizeClose = () => {
    const anyOpen = [els.sideMenu, els.cartDrawer, els.productModal, els.assistantModal, els.sizeGuideModal].some(el => el && !el.hidden);
    if (!anyOpen) {
      els.overlay.hidden = true;
      document.documentElement.classList.remove("no-scroll");
    }
  };

  // =========================================================
  // Fetchers Robustos (API First + Static Fallback)
  // =========================================================
  const apiFetch = async (endpoint, options = {}) => {
    const cv = encodeURIComponent(APP_VERSION);
    const urls = [`/api${endpoint}?cv=${cv}`, `/data${endpoint}.json?cv=${cv}`];
    for (const url of urls) {
      try {
        const res = await fetch(url, options);
        if (res.ok) return await res.json();
      } catch (e) { console.warn(`Fallback en ${url}`); }
    }
    throw new Error("API Offline");
  };

  const normalizeProduct = (p) => {
    const rawSection = String(p?.sectionId || p?.section || "").trim();
    const config = CATEGORY_CONFIG.find(c => c.mapFrom.includes(rawSection)) || CATEGORY_CONFIG[0];
    const imgs = (Array.isArray(p?.images) ? p.images : [p?.img]).map(safeUrl).filter(Boolean);
    return {
      sku: String(p?.sku || p?.id),
      title: String(p?.title || p?.name),
      priceCents: Number(p?.price_cents || 0),
      images: imgs,
      img: imgs[0] || "",
      uiSection: config.uiId,
      stock: Number.isFinite(p?.stock) ? p.stock : null,
      description: p?.description || "Producto Oficial Score Store.",
      sizes: Array.isArray(p?.sizes) ? p.sizes : ["S", "M", "L", "XL", "XXL"]
    };
  };

  // =========================================================
  // Carrito y Totales
  // =========================================================
  const refreshTotals = () => {
    const subtotal = cart.reduce((a, b) => a + (b.priceCents * b.qty), 0);
    let discount = 0;
    if (activePromo) {
      discount = activePromo.type === "percent" ? subtotal * (activePromo.value/100) : activePromo.value * 100;
    }
    const ship = shipping.quote?.amount_cents || 0;
    const total = Math.max(0, subtotal - discount + ship);

    if (els.cartSubtotal) els.cartSubtotal.textContent = money(subtotal);
    if (els.cartTotal) els.cartTotal.textContent = money(total);
    if (els.shippingLine) els.shippingLine.textContent = money(ship);
    if (els.discountLineWrap) {
      els.discountLineWrap.hidden = discount <= 0;
      if (els.discountLine) els.discountLine.textContent = `-${money(discount)}`;
    }
    if (els.cartCount) els.cartCount.textContent = cart.reduce((a, b) => a + b.qty, 0);
    localStorage.setItem(STORAGE_KEYS.cart, JSON.stringify(cart));
  };

  const renderCart = () => {
    if (!els.cartItems) return;
    els.cartItems.innerHTML = cart.length ? "" : '<p class="hint">Carrito vacío</p>';
    cart.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "cartitem";
      row.innerHTML = `
        <div class="cartitem__meta">
          <div class="cartitem__title">${escapeHtml(item.title)}</div>
          <div class="cartitem__sub">Talla: ${item.size}</div>
        </div>
        <div class="cartitem__right">
          <div class="cartitem__price">${money(item.priceCents)}</div>
          <div class="cartitem__qty">
            <button onclick="window._modQty(${idx},-1)">-</button>
            <span>${item.qty}</span>
            <button onclick="window._modQty(${idx},1)">+</button>
          </div>
        </div>
      `;
      els.cartItems.appendChild(row);
    });
    refreshTotals();
  };

  window._modQty = (idx, delta) => {
    cart[idx].qty = clamp(cart[idx].qty + delta, 1, 99);
    if (delta === -1 && cart[idx].qty === 1 && confirm("¿Quitar producto?")) cart.splice(idx, 1);
    renderCart();
  };

  // =========================================================
  // Galería y Productos
  // =========================================================
  const mountCardCarousel = (cardEl, imgs, title) => {
    const track = cardEl.querySelector(".card__track");
    if (!track || imgs.length <= 1) return;
    const settle = debounce(() => {
      const idx = Math.round(track.scrollLeft / track.clientWidth);
      track.scrollTo({ left: idx * track.clientWidth, behavior: "smooth" });
    }, 100);
    track.addEventListener("scroll", settle, { passive: true });
  };

  const renderProducts = () => {
    if (!els.productGrid) return;
    let list = products.filter(p => !activeCategory || p.uiSection === activeCategory);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p => p.title.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
    }

    els.productGrid.innerHTML = list.map(p => `
      <div class="card hover-fx" onclick="window._openP('${p.sku}')">
        <div class="card__media">
          <div class="card__track">${p.images.map(img => `<img src="${img}" loading="lazy">`).join("")}</div>
          ${p.images.length > 1 ? '<div class="card__swipe-hint">DESLIZA</div>' : ''}
        </div>
        <div class="card__body">
          <div class="card__title tech-text">${escapeHtml(p.title)}</div>
          <div class="card__row">
            <span class="pill pill--red">${p.sku}</span>
            <div class="price">${money(p.priceCents)}</div>
          </div>
          <button class="btn btn--black btn--block" style="margin-top:10px;">Ver Detalles</button>
        </div>
      </div>
    `).join("");

    $$(".card", els.productGrid).forEach((card, i) => {
      const p = list[i];
      mountCardCarousel(card, p.images, p.title);
    });
  };

  window._openP = (sku) => {
    const p = products.find(x => x.sku === sku);
    if (!p) return;
    currentProduct = p; selectedSize = ""; selectedQty = 1;

    $("#pmTitle").textContent = p.title;
    $("#pmPrice").textContent = money(p.priceCents);
    $("#pmDesc").textContent = p.description;
    if (els.pmQtyDisplay) els.pmQtyDisplay.textContent = "1";

    if (els.pmSizePills) {
      els.pmSizePills.innerHTML = p.sizes.map(s => `
        <button class="size-pill" onclick="window._setSz(this, '${s}')">${s}</button>
      `).join("");
    }

    if (els.pmCarousel) {
      els.pmCarousel.innerHTML = `<div class="pm__track">${p.images.map(img => `<img src="${img}">`).join("")}</div>`;
    }

    openLayer(els.productModal);
  };

  window._setSz = (btn, sz) => {
    $$(".size-pill").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    selectedSize = sz;
  };

  // =========================================================
  // Cotización y Checkout
  // =========================================================
  const doQuote = async () => {
    const zip = els.postalCode?.value.trim();
    if (!zip || cart.length === 0) return showToast("Faltan datos", "error");
    try {
      const res = await apiFetch("/quote_shipping", {
        method: "POST",
        body: JSON.stringify({ postal_code: zip, items: cart })
      });
      shipping.quote = res;
      shipping.postal_code = zip;
      if (els.shippingNote) els.shippingNote.textContent = `Envío: ${money(res.amount_cents)}`;
      refreshTotals();
    } catch (e) { showToast("Error en cotización", "error"); }
  };

  const doCheckout = async () => {
    if (cart.length === 0) return;
    showToast("Conectando con Stripe...", "ok");
    try {
      const res = await apiFetch("/create_checkout", {
        method: "POST",
        body: JSON.stringify({ items: cart, shipping: shipping })
      });
      if (res.url) window.location.href = res.url;
    } catch (e) { showToast("Error al iniciar pago", "error"); }
  };

  // =========================================================
  // Neuromarketing & IA
  // =========================================================
  const initNeuromarketing = () => {
    if (!els.salesNotification) return;
    const names = ["Alex", "María", "Chris", "Fernanda", "Luis"];
    setInterval(() => {
      if (document.hidden) return;
      els.salesName.textContent = names[Math.floor(Math.random()*names.length)];
      els.salesNotification.hidden = false;
      setTimeout(() => els.salesNotification.hidden = true, 4000);
    }, 20000);
  };

  // =========================================================
  // Boot
  // =========================================================
  const boot = async () => {
    try {
      // 1. Listeners básicos
      $("#openCartBtn")?.addEventListener("click", () => openLayer(els.cartDrawer));
      $("#closeCartBtn")?.addEventListener("click", () => closeLayer(els.cartDrawer));
      $("#pmAdd")?.addEventListener("click", () => {
        if (!selectedSize) return showToast("Elige talla", "error");
        cart.push({ ...currentProduct, size: selectedSize, qty: selectedQty });
        closeLayer(els.productModal);
        openLayer(els.cartDrawer);
        renderCart();
      });
      $("#quoteBtn")?.addEventListener("click", doQuote);
      els.checkoutBtn?.addEventListener("click", doCheckout);
      els.searchInput?.addEventListener("input", debounce(e => { searchQuery = e.target.value; renderProducts(); }, 200));

      // 2. Cargar datos
      const rawCart = localStorage.getItem(STORAGE_KEYS.cart);
      if (rawCart) cart = JSON.parse(rawCart);

      const data = await apiFetch("/catalog");
      products = (data.products || []).map(normalizeProduct);

      renderProducts();
      renderCart();
      initNeuromarketing();

      // Deep linking
      const sku = new URLSearchParams(window.location.search).get("sku");
      if (sku) window._openP(sku);

    } catch (e) {
      showToast("Error de conexión", "error");
    } finally {
      setTimeout(() => {
        if (els.splash) {
          els.splash.classList.add("fade-out");
          setTimeout(() => els.splash.hidden = true, 800);
        }
      }, 1500);
    }
  };

  boot();
})();
