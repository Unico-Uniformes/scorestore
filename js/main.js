/* =========================================================
   SCORE STORE — main.js (VERSIÓN CORREGIDA Y ROBUSTA)
   Build: 2026-03-23-FIXED
   Integración: Logic + Vercel Path Overrides + UX Fix
========================================================= */

(() => {
  "use strict";

  const APP_VERSION = "2026.03.23.SCORESTORE";

  // --- Utilities ---
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const debounce = (fn, wait = 150) => {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  };

  const money = (cents) => {
    const n = Number(cents);
    const v = Number.isFinite(n) ? n : 0;
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 2,
    }).format(v / 100);
  };

  // CORRECCIÓN DE RUTAS: Asegura que assets y datos carguen en Vercel
  const safeUrl = (u) => {
    const s0 = String(u || "").trim();
    if (!s0) return "";
    if (s0.startsWith("http") || s0.startsWith("data:")) return s0;

    // Normalización de carpetas según tu topología (Evita el 404 en Vercel)
    let s1 = s0
      .replace("assets/BAJA_500/", "assets/BAJA500/")
      .replace("assets/BAJA_400/", "assets/BAJA400/")
      .replace("assets/SF_250/", "assets/SF250/")
      .replace("assets/BAJA_1000/", "assets/EDICION_2025/");

    if (s1.startsWith("/")) return s1;
    return `/${s1}`;
  };

  const escapeHtml = (s) =>
    String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // DOM Refs (Verifica que estos IDs existan en tu index.html)
  const splash = $("#splash");
  const overlay = $("#overlay");
  const sideMenu = $("#sideMenu");
  const openMenuBtn = $("#openMenuBtn");
  const closeMenuBtn = $("#closeMenuBtn");
  const cartDrawer = $("#cartDrawer");
  const openCartBtn = $("#openCartBtn");
  const closeCartBtn = $("#closeCartBtn");
  const categoryGrid = $("#categoryGrid");
  const productGrid = $("#productGrid");
  const searchInput = $("#searchInput");
  const sortSelect = $("#sortSelect");
  const activeFilterRow = $("#activeFilterRow");
  const activeFilterLabel = $("#activeFilterLabel");
  const clearFilterBtn = $("#clearFilterBtn");
  const cartCount = $("#cartCount");
  const cartItemsEl = $("#cartItems");
  const cartSubtotalEl = $("#cartSubtotal");
  const shippingLineEl = $("#shippingLine");
  const cartTotalEl = $("#cartTotal");
  const postalCode = $("#postalCode");
  const quoteBtn = $("#quoteBtn");
  const checkoutBtn = $("#checkoutBtn");
  const productModal = $("#productModal");
  const pmClose = $("#pmClose");
  const pmTitle = $("#pmTitle");
  const pmCarousel = $("#pmCarousel");
  const pmPrice = $("#pmPrice");
  const pmDesc = $("#pmDesc");
  const pmAdd = $("#pmAdd");
  const pmSizePills = $("#pmSizePills");
  const pmQtyDec = $("#pmQtyDec");
  const pmQtyInc = $("#pmQtyInc");
  const pmQtyDisplay = $("#pmQtyDisplay");
  const toast = $("#toast");
  const appVersionLabel = $("#appVersionLabel");

  const STORAGE_KEYS = { cart: "scorestore_cart_v3", seenSwipe: "scorestore_swipe_v3" };

  const CATEGORY_CONFIG = [
    { uiId: "BAJA1000", name: "BAJA 1000", logo: "assets/logo-baja1000.webp", mapFrom: ["BAJA1000", "BAJA_1000", "EDICION_2025"] },
    { uiId: "BAJA500", name: "BAJA 500", logo: "assets/logo-baja500.webp", mapFrom: ["BAJA500", "BAJA_500"] },
    { uiId: "BAJA400", name: "BAJA 400", logo: "assets/logo-baja400.webp", mapFrom: ["BAJA400", "BAJA_400"] },
    { uiId: "SF250",  name: "SAN FELIPE 250", logo: "assets/logo-sf250.webp", mapFrom: ["SF250", "SF_250"] },
  ];

  let products = [];
  let activeCategory = null;
  let searchQuery = "";
  let sortMode = "featured";
  let cart = [];
  let shipping = { mode: "pickup", quote: null };
  let currentProduct = null;
  let selectedSize = "";
  let selectedQty = 1;

  // Lógica de Datos
  const normalizeProduct = (p) => {
    const images = Array.isArray(p?.images) ? p.images : (p?.img ? [p.img] : []);
    const rawSection = String(p?.section_id || p?.sectionId || "").trim();
    const foundCat = CATEGORY_CONFIG.find(c => c.mapFrom.includes(rawSection));

    return {
      sku: String(p?.sku || p?.id || "").trim(),
      title: String(p?.name || p?.title || "Producto SCORE").trim(),
      description: String(p?.description || "Sin descripción").trim(),
      priceCents: Math.round(Number(p?.price_cents || p?.price_mxn * 100 || 0)),
      images: images.map(safeUrl).filter(Boolean),
      img: safeUrl(images[0] || ""),
      sizes: Array.isArray(p?.sizes) ? p.sizes : ["S", "M", "L", "XL"],
      uiSection: foundCat ? foundCat.uiId : "BAJA1000",
      rank: Number(p?.rank || 999)
    };
  };

  const fetchCatalog = async () => {
    try {
      const r = await fetch(`/api/catalog?v=${APP_VERSION}`);
      if (!r.ok) throw new Error("API falló");
      const res = await r.json();
      return res;
    } catch (e) {
      console.warn("Intentando fallback local...");
      const fb = await fetch("/data/catalog.json");
      return await fb.json();
    }
  };

  const showToast = (msg, type = "ok") => {
    if (!toast) return;
    toast.textContent = msg;
    toast.className = `toast show ${type === 'error' ? 'toast--error' : ''}`;
    setTimeout(() => toast.classList.remove("show"), 3000);
  };

  const openLayer = (el) => {
    if (!el) return;
    el.hidden = false;
    if (overlay) overlay.hidden = false;
    document.body.classList.add("no-scroll");
    setTimeout(() => el.classList.add("open"), 10);
  };

  const closeLayer = (el) => {
    if (!el) return;
    el.classList.remove("open");
    setTimeout(() => {
      el.hidden = true;
      if (overlay) overlay.hidden = true;
      document.body.classList.remove("no-scroll");
    }, 400);
  };

  const renderCategories = () => {
    if (!categoryGrid) return;
    categoryGrid.innerHTML = CATEGORY_CONFIG.map(cat => {
      const count = products.filter(p => p.uiSection === cat.uiId).length;
      return `
        <button class="catcard" onclick="window._setCat('${cat.uiId}')">
          <img src="${safeUrl(cat.logo)}" alt="${cat.name}">
          <div class="catcard__title">${cat.name}</div>
          <div class="catcard__count">${count} productos</div>
        </button>
      `;
    }).join("");
  };

  window._setCat = (id) => {
    activeCategory = id;
    updateFilterUI();
    renderProducts();
    $("#catalogCarouselSection")?.scrollIntoView({ behavior: 'smooth' });
  };

  const renderProducts = () => {
    if (!productGrid) return;
    const q = searchQuery.toLowerCase();
    let list = products.filter(p => 
      (!activeCategory || p.uiSection === activeCategory) &&
      (!q || p.title.toLowerCase().includes(q))
    );

    if (sortMode === "price_asc") list.sort((a,b) => a.priceCents - b.priceCents);
    else if (sortMode === "price_desc") list.sort((a,b) => b.priceCents - a.priceCents);
    else list.sort((a,b) => a.rank - b.rank);

    productGrid.innerHTML = list.map(p => `
      <div class="card" onclick="window._openProduct('${p.sku}')">
        <div class="card__media"><img src="${p.img}" loading="lazy"></div>
        <div class="card__body">
          <div class="card__title">${p.title}</div>
          <div class="card__price">${money(p.priceCents)}</div>
          <button class="btn btn--black">Ver Detalles</button>
        </div>
      </div>
    `).join("");
  };

  window._openProduct = (sku) => {
    const p = products.find(x => x.sku === sku);
    if (!p) return;
    currentProduct = p;
    selectedQty = 1;
    selectedSize = "";
    pmTitle.textContent = p.title;
    pmPrice.textContent = money(p.priceCents);
    pmDesc.textContent = p.description;
    pmQtyDisplay.textContent = "1";
    pmSizePills.innerHTML = p.sizes.map(s => `
      <button class="size-pill" onclick="window._setSize(this, '${s}')">${s}</button>
    `).join("");
    pmCarousel.innerHTML = `<img src="${p.img}">`;
    openLayer(productModal);
  };

  window._setSize = (btn, s) => {
    $$(".size-pill").forEach(x => x.classList.remove("active"));
    btn.classList.add("active");
    selectedSize = s;
  };

  const renderCart = () => {
    if (!cartItemsEl) return;
    cartItemsEl.innerHTML = cart.map((it, idx) => `
      <div class="cartitem">
        <div><strong>${it.title}</strong><br><small>${it.size}</small></div>
        <div class="qty">
          <button onclick="window._modQty(${idx}, -1)">−</button>
          <span>${it.qty}</span>
          <button onclick="window._modQty(${idx}, 1)">+</button>
        </div>
      </div>
    `).join("") || '<div class="hint">Carrito vacío</div>';
    refreshTotals();
  };

  window._modQty = (idx, delta) => {
    cart[idx].qty += delta;
    if (cart[idx].qty <= 0) cart.splice(idx, 1);
    localStorage.setItem(STORAGE_KEYS.cart, JSON.stringify(cart));
    renderCart();
  };

  const refreshTotals = () => {
    const sub = cart.reduce((a, b) => a + (b.priceCents * b.qty), 0);
    cartSubtotalEl.textContent = money(sub);
    cartTotalEl.textContent = money(sub + (shipping.quote?.amount_cents || 0));
    cartCount.textContent = cart.reduce((a,b) => a + b.qty, 0);
  };

  const updateFilterUI = () => {
    if (activeCategory || searchQuery) {
      activeFilterRow.hidden = false;
      activeFilterLabel.textContent = activeCategory || searchQuery;
    } else {
      activeFilterRow.hidden = true;
    }
  };

  const init = async () => {
    if (appVersionLabel) appVersionLabel.textContent = APP_VERSION;
    try {
      cart = JSON.parse(localStorage.getItem(STORAGE_KEYS.cart)) || [];
      const catalog = await fetchCatalog();
      products = catalog.products.map(normalizeProduct);
      renderCategories();
      renderProducts();
    } catch (e) {
      showToast("Error de conexión", "error");
    } finally {
      setTimeout(() => {
        if (splash) { splash.classList.add("fade-out"); setTimeout(() => splash.hidden = true, 600); }
      }, 1000);
    }
  };

  // Listeners Globales
  openMenuBtn?.addEventListener("click", () => openLayer(sideMenu));
  closeMenuBtn?.addEventListener("click", () => closeLayer(sideMenu));
  openCartBtn?.addEventListener("click", () => { renderCart(); openLayer(cartDrawer); });
  closeCartBtn?.addEventListener("click", () => closeLayer(cartDrawer));
  pmClose?.addEventListener("click", () => closeLayer(productModal));
  overlay?.addEventListener("click", () => { closeLayer(sideMenu); closeLayer(cartDrawer); closeLayer(productModal); });
  
  pmAdd?.addEventListener("click", () => {
    if (!selectedSize) return showToast("Elige talla", "error");
    cart.push({...currentProduct, size: selectedSize, qty: selectedQty});
    localStorage.setItem(STORAGE_KEYS.cart, JSON.stringify(cart));
    closeLayer(productModal); openLayer(cartDrawer); renderCart();
  });

  init();
})();
