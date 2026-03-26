/* =========================================================
   SCORE STORE — main.js (Vercel fused) — v2026-03-26
   - Fuses useful behavior from both branches
   - Removes Netlify endpoints entirely
   - Aligns with current index.html and legal.html IDs
   - Keeps footer/contact/promo/site settings dynamic
========================================================= */
(() => {
  "use strict";

  const APP_VERSION = window.APP_VERSION || window.__APP_VERSION__ || "2026.03.26.SCORESTORE";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const debounce = (fn, wait = 160) => {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  };
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const money = (cents) => {
    const n = Number(cents);
    const value = Number.isFinite(n) ? n : 0;
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 2,
    }).format(value / 100);
  };

  const escapeHtml = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const normCode = (s) => String(s ?? "").trim().toUpperCase().replace(/\s+/g, "");

  const safeUrl = (u) => {
    const s0 = String(u ?? "").trim();
    if (!s0) return "";
    if (/^(https?:|data:|blob:)/i.test(s0)) return s0;

    const s1 = s0
      .replaceAll("assets/BAJA_500/", "assets/BAJA500/")
      .replaceAll("assets/BAJA_400/", "assets/BAJA400/")
      .replaceAll("assets/SF_250/", "assets/SF250/")
      .replaceAll("assets/BAJA_1000/", "assets/EDICION_2025/");

    if (s1.startsWith("/")) return s1;
    if (s1.startsWith("assets/") || s1.startsWith("css/") || s1.startsWith("js/") || s1.startsWith("data/")) {
      return `/${s1}`;
    }
    return s1;
  };

  const APP_ENDPOINTS = {
    catalog: "/api/catalog",
    promos: "/api/promos",
    siteSettings: "/api/site_settings",
    shipping: "/api/quote_shipping",
    checkout: "/api/create_checkout",
    chat: "/api/chat",
  };

  const STORAGE_KEYS = {
    cart: "scorestore_cart_v3",
    consent: "scorestore_consent_v3",
    shipMode: "scorestore_ship_mode_v3",
    promoDismissed: "scorestore_promo_dismissed_v3",
    seenSwipe: "scorestore_seen_swipe_v3",
    introSeen: "scorestore_intro_seen_v3",
  };

  const CATEGORY_CONFIG = [
    {
      uiId: "BAJA1000",
      name: "BAJA 1000",
      logo: "/assets/logo-baja1000.webp",
      mapFrom: ["BAJA1000", "BAJA_1000", "EDICION_2025", "OTRAS_EDICIONES", "BAJA_1000_2025"],
    },
    {
      uiId: "BAJA500",
      name: "BAJA 500",
      logo: "/assets/logo-baja500.webp",
      mapFrom: ["BAJA500", "BAJA_500"],
    },
    {
      uiId: "BAJA400",
      name: "BAJA 400",
      logo: "/assets/logo-baja400.webp",
      mapFrom: ["BAJA400", "BAJA_400"],
    },
    {
      uiId: "SF250",
      name: "SAN FELIPE 250",
      logo: "/assets/logo-sf250.webp",
      mapFrom: ["SF250", "SF_250"],
    },
  ];

  const CATEGORY_MAP = new Map(CATEGORY_CONFIG.map((c) => [c.uiId, c]));
  const normalizeSectionToUi = (sectionId) => {
    const sid = String(sectionId ?? "").trim();
    const found = CATEGORY_CONFIG.find((c) => c.mapFrom.includes(sid));
    return found ? found.uiId : "BAJA1000";
  };

  const inferCollection = (p) => {
    const sid = String(p?.sectionId || p?.section_id || p?.section || p?.categoryId || "").trim();
    if (sid === "EDICION_2025") return "Edición 2025";
    if (sid === "OTRAS_EDICIONES") return "Ediciones Clásicas";
    return String(p?.collection || p?.sub_section || "").trim();
  };

  const normalizeProduct = (row) => {
    const images = Array.isArray(row?.images)
      ? row.images
      : row?.image_url || row?.img || row?.image
        ? [row.image_url || row.img || row.image]
        : [];

    const sizes = Array.isArray(row?.sizes) && row.sizes.length ? row.sizes : ["S", "M", "L", "XL", "XXL"];

    const priceFrom =
      Number.isFinite(Number(row?.price_cents)) ? Math.round(Number(row.price_cents)) :
      Number.isFinite(Number(row?.price_mxn)) ? Math.round(Number(row.price_mxn) * 100) :
      Number.isFinite(Number(row?.base_mxn)) ? Math.round(Number(row.base_mxn) * 100) :
      Number.isFinite(Number(row?.price)) ? Math.round(Number(row.price) * 100) :
      0;

    const sectionRaw = String(row?.sectionId || row?.section_id || row?.section || row?.categoryId || "").trim();

    return {
      ...row,
      sku: String(row?.sku || row?.id || "").trim(),
      name: String(row?.name || row?.title || "Producto SCORE").trim(),
      title: String(row?.title || row?.name || "Producto SCORE").trim(),
      description: String(row?.description || "").trim(),
      sectionId: sectionRaw,
      section_id: sectionRaw,
      uiSection: normalizeSectionToUi(sectionRaw),
      collection: inferCollection(row),
      image_url: safeUrl(row?.image_url || row?.img || row?.image || ""),
      img: safeUrl(row?.img || row?.image || row?.image_url || ""),
      images: images.map(safeUrl).filter(Boolean),
      sizes: sizes.map((x) => String(x || "").trim()).filter(Boolean),
      price_cents: priceFrom,
      rank: Number.isFinite(Number(row?.rank)) ? Math.round(Number(row.rank)) : 999,
      stock: Number.isFinite(Number(row?.stock)) ? Math.round(Number(row.stock)) : null,
    };
  };

  const normalizeCategory = (row) => ({
    id: String(row?.id || row?.slug || row?.section_id || row?.sectionId || "").trim(),
    name: String(row?.name || row?.title || row?.section_id || row?.sectionId || "Colección").trim(),
    logo: safeUrl(row?.logo || row?.image || row?.cover_image || row?.coverImage || ""),
    section_id: String(row?.section_id || row?.sectionId || row?.id || "").trim(),
  });

  const els = {
    splash: $("#splash"),
    overlay: $("#overlay"),
    sideMenu: $("#sideMenu"),
    openMenuBtn: $("#openMenuBtn"),
    closeMenuBtn: $("#closeMenuBtn"),
    cartDrawer: $("#cartDrawer"),
    openCartBtn: $("#openCartBtn"),
    closeCartBtn: $("#closeCartBtn"),
    navOpenCart: $("#navOpenCart"),
    navOpenAssistant: $("#navOpenAssistant"),
    assistantModal: $("#assistantModal"),
    openAssistantBtn: $("#openAssistantBtn"),
    floatingAssistantBtn: $("#floatingAssistantBtn"),
    assistantClose: $("#assistantClose"),
    assistantOutput: $("#assistantOutput"),
    assistantInput: $("#assistantInput"),
    assistantSendBtn: $("#assistantSendBtn"),
    searchInput: $("#searchInput"),
    mobileSearchBtn: $("#mobileSearchBtn"),
    mobileSearchWrap: $("#mobileSearchWrap"),
    mobileSearchInput: $("#mobileSearchInput"),
    closeMobileSearchBtn: $("#closeMobileSearchBtn"),
    menuSearchInput: $("#menuSearchInput"),
    scrollToCategoriesBtn: $("#scrollToCategoriesBtn"),
    categoryGrid: $("#categoryGrid"),
    categoryHint: $("#categoryHint"),
    catalogCarouselSection: $("#catalogCarouselSection"),
    carouselTitle: $("#carouselTitle"),
    scrollLeftBtn: $("#scrollLeftBtn"),
    scrollRightBtn: $("#scrollRightBtn"),
    productGrid: $("#productGrid"),
    statusRow: $("#statusRow"),
    sortSelect: $("#sortSelect"),
    activeFilterRow: $("#activeFilterRow"),
    activeFilterLabel: $("#activeFilterLabel"),
    clearFilterBtn: $("#clearFilterBtn"),
    promoBar: $("#promoBar"),
    promoBarText: $("#promoBarText"),
    promoBarClose: $("#promoBarClose"),
    cartCount: $("#cartCount"),
    cartItemsEl: $("#cartItems"),
    cartSubtotalEl: $("#cartSubtotal"),
    shippingLineEl: $("#shippingLine"),
    discountLineWrap: $("#discountLineWrap"),
    discountLineEl: $("#discountLine"),
    cartTotalEl: $("#cartTotal"),
    shipHint: $("#shipHint"),
    shippingNote: $("#shippingNote"),
    postalWrap: $("#postalWrap"),
    shipModePickup: $("#shipModePickup"),
    shipModeDelivery: $("#shipModeDelivery"),
    shipPostal: $("#shipPostal"),
    shipQuoteBtn: $("#shipQuoteBtn"),
    shipQuoteStatus: $("#shipQuoteStatus"),
    shipQuoteEl: $("#shipQuoteEl"),
    checkoutForm: $("#checkoutForm"),
    checkoutName: $("#checkoutName"),
    checkoutEmail: $("#checkoutEmail"),
    checkoutPhone: $("#checkoutPhone"),
    checkoutAddress: $("#checkoutAddress"),
    checkoutPostal: $("#checkoutPostal"),
    checkoutNotes: $("#checkoutNotes"),
    checkoutPaySelect: $("#checkoutPaySelect"),
    checkoutMsg: $("#checkoutMsg"),
    checkoutLoader: $("#checkoutLoader"),
    checkoutSubmitBtn: $("#checkoutSubmitBtn") || $("#checkoutBtn"),
    continueShoppingBtn: $("#continueShoppingBtn"),
    productModal: $("#productModal"),
    pmBackBtn: $("#pmBackBtn"),
    pmClose: $("#pmClose"),
    pmCarousel: $("#pmCarousel"),
    pmTitle: $("#pmTitle"),
    pmChips: $("#pmChips"),
    pmPrice: $("#pmPrice"),
    pmDesc: $("#pmDesc"),
    pmStockBadge: $("#pmStockBadge"),
    openSizeGuideBtn: $("#openSizeGuideBtn"),
    pmSizePills: $("#pmSizePills"),
    pmQtyDec: $("#pmQtyDec"),
    pmQtyInc: $("#pmQtyInc"),
    pmQtyDisplay: $("#pmQtyDisplay"),
    pmShareBtn: $("#pmShareBtn"),
    pmAdd: $("#pmAdd"),
    sizeGuideModal: $("#sizeGuideModal"),
    closeSizeGuideBtn: $("#closeSizeGuideBtn"),
    understandSizeBtn: $("#understandSizeBtn"),
    cookieBanner: $("#cookieBanner"),
    cookieAccept: $("#cookieAccept"),
    cookieReject: $("#cookieReject"),
    scrollTopBtn: $("#scrollTopBtn"),
    toast: $("#toast"),
    appVersionLabel: $("#appVersionLabel"),
    salesNotification: $("#salesNotification"),
    salesName: $("#salesName"),
    salesAction: $("#salesAction"),
    footerNote: $("#footerNote"),
    footerEmailLink: $("#footerEmailLink"),
    footerEmailText: $("#footerEmailText"),
    footerWhatsappLink: $("#footerWhatsappLink"),
    footerWhatsappText: $("#footerWhatsappText"),
    footerFacebookLink: $("#footerFacebookLink"),
    footerInstagramLink: $("#footerInstagramLink"),
    footerYoutubeLink: $("#footerYoutubeLink"),
  };

  let catalog = { categories: [], products: [] };
  let categories = [];
  let products = [];
  let filteredProducts = [];
  let activeCategory = null;
  let searchQuery = "";
  let cart = [];
  let shipMode = "pickup";
  let shippingQuoted = 0;
  let shippingMeta = null;
  let activePromo = null;
  let promosData = { rules: [] };
  let siteSettings = {
    hero_title: null,
    hero_image: null,
    promo_active: false,
    promo_text: "",
    pixel_id: "",
    maintenance_mode: false,
    season_key: "default",
    theme: { accent: "#e10600", accent2: "#111111", particles: true },
    home: { footer_note: "", shipping_note: "", returns_note: "", support_hours: "" },
    socials: { facebook: "", instagram: "", youtube: "", tiktok: "" },
    contact: {
      email: "ventas.unicotextil@gmail.com",
      phone: "",
      whatsapp_e164: "5216642368701",
      whatsapp_display: "664 236 8701",
    },
  };
  let currentProduct = null;
  let selectedQty = 1;
  let selectedSize = "";
  let loadingCatalog = false;
  let loadingCheckout = false;

  const anyLayerOpen = () => [els.sideMenu, els.cartDrawer, els.assistantModal, els.productModal, els.sizeGuideModal].some((el) => el && !el.hidden);
  const isModal = (el) => [els.assistantModal, els.productModal, els.sizeGuideModal].includes(el);

  const openOverlay = () => {
    if (!els.overlay) return;
    els.overlay.hidden = false;
    document.documentElement.classList.add("no-scroll");
  };

  const closeOverlayIfNeeded = () => {
    if (!anyLayerOpen()) {
      if (els.overlay) els.overlay.hidden = true;
      document.documentElement.classList.remove("no-scroll");
    }
  };

  const openLayer = (el) => {
    if (!el) return;
    openOverlay();
    el.hidden = false;
    requestAnimationFrame(() => {
      if (isModal(el)) el.classList.add("modal--open");
    });
  };

  const closeLayer = (el) => {
    if (!el) return;
    if (isModal(el)) {
      el.classList.remove("modal--open");
      setTimeout(() => {
        el.hidden = true;
        closeOverlayIfNeeded();
      }, 260);
      return;
    }
    el.hidden = true;
    closeOverlayIfNeeded();
  };

  const setToastState = (text, type = "ok") => {
    if (!els.toast) return;
    els.toast.textContent = String(text || "");
    els.toast.className = `toast glass-panel show ${type === "error" ? "toast--error" : type === "success" ? "toast--success" : ""}`;
    clearTimeout(setToastState._t);
    setToastState._t = setTimeout(() => {
      if (els.toast) els.toast.className = "toast glass-panel";
    }, 2200);
  };

  const setCheckoutLoading = (on) => {
    loadingCheckout = !!on;
    if (els.checkoutLoader) els.checkoutLoader.hidden = !on;
    if (els.checkoutSubmitBtn) els.checkoutSubmitBtn.disabled = !!on || !!siteSettings.maintenance_mode || !cart.length;
  };

  const persistCart = () => {
    try { localStorage.setItem(STORAGE_KEYS.cart, JSON.stringify(cart)); } catch {}
  };

  const restoreCart = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.cart);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) cart = arr;
    } catch {}
  };

  const setCookieConsent = (value) => {
    try { localStorage.setItem(STORAGE_KEYS.consent, value); } catch {}
    if (els.cookieBanner) els.cookieBanner.hidden = true;
  };

  const initCookieBanner = () => {
    if (!els.cookieBanner) return;
    const consent = localStorage.getItem(STORAGE_KEYS.consent);
    if (consent === "accepted" || consent === "rejected" || consent === "accept" || consent === "reject") {
      els.cookieBanner.hidden = true;
      return;
    }
    els.cookieBanner.hidden = false;
  };

  const loadMetaPixel = (pixelId) => {
    const id = String(pixelId || "").trim();
    if (!id) return;
    if (document.getElementById("metaPixelScript")) return;

    const script = document.createElement("script");
    script.id = "metaPixelScript";
    script.text = `
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
      n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
      (window, document,'script','https://connect.facebook.net/en_US/fbevents.js');
      fbq('init', '${id.replace(/'/g, "")}');
      fbq('track', 'PageView');
    `;
    document.head.appendChild(script);

    const ns = document.createElement("noscript");
    ns.innerHTML = `<img height="1" width="1" style="display:none" alt="" src="https://www.facebook.com/tr?id=${encodeURIComponent(id)}&ev=PageView&noscript=1"/>`;
    document.body.appendChild(ns);
  };

  const fetchJsonFirstOk = async (urls, timeoutMs = 12000) => {
    const list = Array.isArray(urls) ? urls : [];
    let lastErr = null;
    for (const u of list) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(u, {
          headers: { "cache-control": "no-store" },
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));
        if (!res.ok) {
          lastErr = new Error(`HTTP ${res.status}`);
          continue;
        }
        const j = await res.json().catch(() => null);
        if (j) return j;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("No se pudo cargar JSON");
  };

  const fetchCatalog = async () => {
    const cv = encodeURIComponent(APP_VERSION);
    return await fetchJsonFirstOk([
      `${APP_ENDPOINTS.catalog}?cv=${cv}`,
      `/data/catalog.json?cv=${cv}`,
    ]);
  };

  const fetchPromos = async () => {
    const cv = encodeURIComponent(APP_VERSION);
    try {
      const data = await fetchJsonFirstOk([
        `${APP_ENDPOINTS.promos}?cv=${cv}`,
        `/data/promos.json?cv=${cv}`,
      ]);
      if (data && typeof data === "object") {
        if (Array.isArray(data.rules)) {
          promosData = data;
          return data;
        }
        if (Array.isArray(data.promos)) {
          promosData = { rules: data.promos };
          return promosData;
        }
      }
      promosData = { rules: [] };
    } catch {
      promosData = { rules: [] };
    }
    return promosData;
  };

  const applyFooterAndPromo = () => {
    if (els.footerNote) {
      els.footerNote.textContent = siteSettings.home?.footer_note || "Pago cifrado vía Stripe. Aceptamos OXXO Pay. Logística inteligente internacional con Envía.com.";
    }

    if (els.footerEmailLink && els.footerEmailText) {
      const email = String(siteSettings.contact?.email || "").trim();
      if (email) {
        els.footerEmailLink.href = `mailto:${email}`;
        els.footerEmailText.textContent = email;
      }
    }

    if (els.footerWhatsappLink && els.footerWhatsappText) {
      const waE164 = String(siteSettings.contact?.whatsapp_e164 || "").trim();
      const waDisplay = String(siteSettings.contact?.whatsapp_display || "").trim();
      if (waE164) els.footerWhatsappLink.href = `https://wa.me/${encodeURIComponent(waE164)}`;
      if (waDisplay) els.footerWhatsappText.textContent = waDisplay;
    }

    if (els.footerFacebookLink && siteSettings.socials?.facebook) els.footerFacebookLink.href = siteSettings.socials.facebook;
    if (els.footerInstagramLink && siteSettings.socials?.instagram) els.footerInstagramLink.href = siteSettings.socials.instagram;
    if (els.footerYoutubeLink && siteSettings.socials?.youtube) els.footerYoutubeLink.href = siteSettings.socials.youtube;

    const promoEnabled = !!siteSettings.promo_active && String(siteSettings.promo_text || "").trim();
    const dismissed = localStorage.getItem(STORAGE_KEYS.promoDismissed) === "1";
    if (els.promoBar && els.promoBarText) {
      els.promoBar.hidden = !promoEnabled || dismissed;
      els.promoBarText.textContent = promoEnabled && !dismissed ? String(siteSettings.promo_text || "") : "";
    }

    if (els.shippingNote) {
      els.shippingNote.textContent = String(siteSettings.home?.shipping_note || "");
    }

    if (els.checkoutSubmitBtn) {
      els.checkoutSubmitBtn.disabled = !!siteSettings.maintenance_mode || !cart.length || loadingCheckout;
    }
  };

  const applySiteSettings = (data) => {
    if (!data || typeof data !== "object") return;
    Object.assign(siteSettings, data);
    if (!siteSettings.contact) siteSettings.contact = {};
    if (!siteSettings.home) siteSettings.home = {};
    if (!siteSettings.socials) siteSettings.socials = {};
    applyFooterAndPromo();

    const consent = localStorage.getItem(STORAGE_KEYS.consent);
    if (siteSettings.pixel_id && (consent === "accepted" || consent === "accept")) {
      loadMetaPixel(siteSettings.pixel_id);
    }
  };

  const fetchSiteSettings = async () => {
    try {
      const cv = encodeURIComponent(APP_VERSION);
      const data = await fetchJsonFirstOk([`${APP_ENDPOINTS.siteSettings}?cv=${cv}`]);
      applySiteSettings(data);
    } catch {
      applyFooterAndPromo();
    }
  };

  const getProductName = (p) => String(p?.name || p?.title || "Producto SCORE");
  const getProductSku = (p) => String(p?.sku || p?.id || "").trim();
  const getProductImage = (p) => safeUrl(p?.image_url || p?.img || p?.image || (Array.isArray(p?.images) ? p.images[0] : ""));
  const getProductImages = (p) => {
    const arr = Array.isArray(p?.images) ? p.images.filter(Boolean) : [];
    const fallback = getProductImage(p);
    return arr.length ? arr.map(safeUrl).filter(Boolean) : fallback ? [fallback] : [];
  };
  const getProductSizes = (p) => {
    const arr = Array.isArray(p?.sizes) ? p.sizes.filter(Boolean) : [];
    return arr.length ? arr.map((x) => String(x)) : ["Única"];
  };
  const getProductPriceCents = (p) => {
    const price = Number(p?.price_cents);
    if (Number.isFinite(price) && price > 0) return Math.round(price);
    const mxn = Number(p?.price_mxn);
    if (Number.isFinite(mxn) && mxn > 0) return Math.round(mxn * 100);
    const base = Number(p?.base_mxn);
    if (Number.isFinite(base) && base > 0) return Math.round(base * 100);
    const priceAlt = Number(p?.price);
    if (Number.isFinite(priceAlt) && priceAlt > 0) return Math.round(priceAlt * 100);
    return 0;
  };
  const getProductSectionUi = (p) => p?.uiSection || normalizeSectionToUi(p?.sectionId || p?.section_id || p?.section || p?.categoryId || "");
  const getStockLabel = (p) => {
    const stock = Number(p?.stock);
    if (!Number.isFinite(stock)) return "";
    if (stock <= 0) return "Agotado";
    if (stock <= 3) return "Últimas piezas";
    return `Stock ${stock}`;
  };
  const getScarcityText = (p) => {
    const stock = Number(p?.stock);
    if (!Number.isFinite(stock)) return "";
    if (stock <= 0) return "⏳ Sin stock por ahora. Confirma por WhatsApp si quieres apartar.";
    if (stock <= 3) return "🔥 Últimas piezas disponibles.";
    return "";
  };

  const matchesSearch = (p, q) => {
    if (!q) return true;
    const hay = [
      getProductName(p),
      p?.description,
      p?.sku,
      p?.sectionId,
      p?.section,
      p?.categoryId,
      inferCollection(p),
    ].map((x) => normCode(x)).join("|");
    return hay.includes(normCode(q));
  };

  const matchesCategory = (p) => {
    if (!activeCategory) return true;
    return getProductSectionUi(p) === activeCategory;
  };

  const buildSort = (arr) => {
    const list = [...arr];
    switch (String(els.sortSelect?.value || "featured")) {
      case "price_asc":
        return list.sort((a, b) => getProductPriceCents(a) - getProductPriceCents(b));
      case "price_desc":
        return list.sort((a, b) => getProductPriceCents(b) - getProductPriceCents(a));
      case "name_asc":
        return list.sort((a, b) => getProductName(a).localeCompare(getProductName(b), "es"));
      case "featured":
      default:
        return list.sort((a, b) => Number(a.rank || 999) - Number(b.rank || 999) || getProductName(a).localeCompare(getProductName(b), "es"));
    }
  };

  const filteredList = () => buildSort(products.filter((p) => matchesCategory(p) && matchesSearch(p, searchQuery)));

  const updateStatus = (count) => {
    if (!els.statusRow) return;
    els.statusRow.innerHTML = `<span class="status">${count} producto${count === 1 ? "" : "s"} encontrado${count === 1 ? "" : "s"}</span>`;
  };

  const getCardBadge = (p) => {
    const stockLabel = getStockLabel(p);
    const collection = inferCollection(p);
    const bits = [];
    if (stockLabel) bits.push(`<span class="pill pill--red">${escapeHtml(stockLabel)}</span>`);
    if (collection) bits.push(`<span class="pill">${escapeHtml(collection)}</span>`);
    return bits.join("");
  };

  const productCardHTML = (p) => {
    const imgs = getProductImages(p);
    const title = escapeHtml(getProductName(p));
    const sku = escapeHtml(getProductSku(p));
    const price = money(getProductPriceCents(p));
    const badge = getCardBadge(p);

    return `
      <article class="card" data-sku="${sku}">
        <div class="card__media">
          <div class="card__track" data-track>
            ${imgs.length
              ? imgs.map((src) => `<img src="${escapeHtml(src)}" alt="${title}" loading="lazy" decoding="async">`).join("")
              : `<img src="${escapeHtml(getProductImage(p))}" alt="${title}" loading="lazy" decoding="async">`}
          </div>
          ${imgs.length > 1 ? `
            <button class="card__nav card__nav--prev" type="button" aria-label="Anterior">‹</button>
            <button class="card__nav card__nav--next" type="button" aria-label="Siguiente">›</button>
            <div class="card__dots">${imgs.map((_, i) => `<span class="card__dot ${i === 0 ? "active" : ""}"></span>`).join("")}</div>
            <div class="card__swipe-hint" aria-hidden="true">Desliza</div>
          ` : ""}
        </div>
        <div class="card__body">
          <div>
            <div class="card__title">${title}</div>
            <div class="card__chips">${badge}</div>
          </div>
          <div class="card__row">
            <div class="price">${price}</div>
            <button class="btn btn--primary btn--tiny" type="button" data-open-product="${sku}">Ver</button>
          </div>
        </div>
      </article>
    `;
  };

  const attachCardEvents = (cardEl, p) => {
    const track = cardEl.querySelector("[data-track]");
    const prev = cardEl.querySelector(".card__nav--prev");
    const next = cardEl.querySelector(".card__nav--next");
    const dots = Array.from(cardEl.querySelectorAll(".card__dot"));
    const page = () => Math.round((track.scrollLeft || 0) / (track.clientWidth || 1));
    const setDot = (idx) => dots.forEach((d, i) => d.classList.toggle("active", i === idx));

    const settle = debounce(() => {
      if (!track || !dots.length) return;
      const idx = clamp(page(), 0, Math.max(0, dots.length - 1));
      track.scrollTo({ left: idx * (track.clientWidth || 1), behavior: "smooth" });
      setDot(idx);
    }, 70);

    prev?.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = clamp(page() - 1, 0, Math.max(0, dots.length - 1));
      track.scrollTo({ left: idx * (track.clientWidth || 1), behavior: "smooth" });
      setDot(idx);
    });
    next?.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = clamp(page() + 1, 0, Math.max(0, dots.length - 1));
      track.scrollTo({ left: idx * (track.clientWidth || 1), behavior: "smooth" });
      setDot(idx);
    });
    track?.addEventListener("scroll", settle, { passive: true });
    dots.forEach((d, i) => d.addEventListener("click", (e) => {
      e.stopPropagation();
      track.scrollTo({ left: i * (track.clientWidth || 1), behavior: "smooth" });
      setDot(i);
    }));
  };

  const renderCategories = () => {
    if (!els.categoryGrid) return;
    els.categoryGrid.innerHTML = "";
    const counts = new Map();
    products.forEach((p) => counts.set(p.uiSection, (counts.get(p.uiSection) || 0) + 1));
    const frag = document.createDocumentFragment();

    for (const cat of CATEGORY_CONFIG) {
      const count = counts.get(cat.uiId) || 0;
      const card = document.createElement("button");
      card.type = "button";
      card.className = "catcard hover-fx";
      card.setAttribute("data-cat", cat.uiId);
      card.innerHTML = `
        <div class="catcard__bg" aria-hidden="true"></div>
        <div class="catcard__inner">
          <img class="catcard__logo" src="${safeUrl(cat.logo)}" alt="${escapeHtml(cat.name)}" loading="lazy" decoding="async">
          <div class="catcard__meta">
            <div class="catcard__title tech-text">${escapeHtml(cat.name)}</div>
            <div class="catcard__sub">${count} productos</div>
          </div>
          <div class="catcard__btn">Explorar</div>
        </div>
      `;
      card.addEventListener("click", () => {
        $$(".catcard").forEach((x) => x.classList.remove("active"));
        card.classList.add("active");
        activeCategory = cat.uiId;
        searchQuery = "";
        if (els.searchInput) els.searchInput.value = "";
        if (els.mobileSearchInput) els.mobileSearchInput.value = "";
        if (els.menuSearchInput) els.menuSearchInput.value = "";
        updateResults();
        if (els.catalogCarouselSection) els.catalogCarouselSection.hidden = false;
        if (els.carouselTitle) els.carouselTitle.textContent = cat.name;
        els.catalogCarouselSection?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      frag.appendChild(card);
    }

    els.categoryGrid.appendChild(frag);
    if (els.categoryHint) els.categoryHint.hidden = false;
  };

  const renderProducts = () => {
    if (!els.productGrid) return;
    const list = filteredList();
    filteredProducts = list;
    els.productGrid.innerHTML = list.map(productCardHTML).join("");
    updateStatus(list.length);

    $$(".card", els.productGrid).forEach((cardEl) => {
      const sku = cardEl.getAttribute("data-sku") || "";
      const p = products.find((x) => getProductSku(x) === sku);
      if (!p) return;
      attachCardEvents(cardEl, p);
      cardEl.addEventListener("click", () => openProduct(sku));
      cardEl.querySelectorAll("button[data-open-product]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          openProduct(sku);
        });
      });
    });
  };

  const maybeShowSwipeHint = () => {
    try {
      if (localStorage.getItem(STORAGE_KEYS.seenSwipe) === "1") return;
    } catch {}
    if (document.getElementById("productSwipeHint")) return;
    const el = document.createElement("div");
    el.id = "productSwipeHint";
    el.className = "product-swipe-hint";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<span class="product-swipe-hint__txt">Desliza para ver más</span><span class="product-swipe-hint__arr">→</span>`;
    document.body.appendChild(el);
    const dismiss = () => {
      try { localStorage.setItem(STORAGE_KEYS.seenSwipe, "1"); } catch {}
      el.classList.add("is-hide");
      setTimeout(() => el.remove(), 350);
      els.productGrid?.removeEventListener?.("scroll", dismiss);
    };
    els.productGrid?.addEventListener?.("scroll", dismiss, { passive: true });
    setTimeout(() => { if (document.body.contains(el)) el.classList.add("is-pulse"); }, 900);
  };

  const getCartSubtotal = () => cart.reduce((acc, item) => acc + Number(item.price_cents || 0) * Number(item.qty || 0), 0);
  const getDiscountAmount = () => {
    if (!activePromo) return 0;
    const subtotal = getCartSubtotal();
    if (activePromo.type === "percentage") return Math.round(subtotal * (Number(activePromo.value || 0) / 100));
    if (activePromo.type === "fixed") return Math.min(subtotal, Math.round(Number(activePromo.value || 0)));
    return 0;
  };
  const getShippingAmount = () => (shipMode === "pickup" ? 0 : Number(shippingQuoted || 0));
  const getCartTotal = () => Math.max(0, getCartSubtotal() - getDiscountAmount() + getShippingAmount());

  const updateCartBadge = () => {
    if (!els.cartCount) return;
    const n = cart.reduce((a, i) => a + Number(i.qty || 0), 0);
    els.cartCount.textContent = String(n);
    els.cartCount.hidden = n <= 0;
  };

  const refreshTotals = () => {
    if (els.cartSubtotalEl) els.cartSubtotalEl.textContent = money(getCartSubtotal());
    if (els.shippingLineEl) els.shippingLineEl.textContent = money(getShippingAmount());
    if (els.discountLineEl) els.discountLineEl.textContent = `-${money(getDiscountAmount())}`;
    if (els.discountLineWrap) els.discountLineWrap.hidden = getDiscountAmount() <= 0;
    if (els.cartTotalEl) els.cartTotalEl.textContent = money(getCartTotal());
    updateCartBadge();
    applyFooterAndPromo();
  };

  const renderCart = () => {
    if (!els.cartItemsEl) return;
    els.cartItemsEl.innerHTML = "";

    if (!cart.length) {
      els.cartItemsEl.innerHTML = `<div class="status">Tu carrito está vacío.</div>`;
      refreshTotals();
      return;
    }

    cart.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "cartitem";
      row.innerHTML = `
        <div class="cartitem__img">
          <img src="${escapeHtml(safeUrl(item.image || ""))}" alt="${escapeHtml(item.name || "Producto")}" loading="lazy">
        </div>
        <div class="cartitem__content" style="flex:1;">
          <h4 class="cartitem__title">${escapeHtml(item.name || "Producto")}</h4>
          <div class="cartitem__meta">${item.size ? `Talla: ${escapeHtml(item.size)} · ` : ""}${money(item.price_cents || 0)}</div>
          <div class="cartitem__controls">
            <div class="qty" data-qty="${idx}">
              <button type="button" data-dec>-</button>
              <span>${Number(item.qty || 1)}</span>
              <button type="button" data-inc>+</button>
            </div>
            <button class="trash" type="button" data-remove="${idx}">✕</button>
          </div>
        </div>
      `;
      els.cartItemsEl.appendChild(row);
    });

    els.cartItemsEl.querySelectorAll("[data-dec]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.closest("[data-qty]")?.getAttribute("data-qty") || 0);
        cart[idx].qty = Math.max(1, Number(cart[idx].qty || 1) - 1);
        persistCart();
        renderCart();
      });
    });
    els.cartItemsEl.querySelectorAll("[data-inc]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.closest("[data-qty]")?.getAttribute("data-qty") || 0);
        cart[idx].qty = Math.min(99, Number(cart[idx].qty || 1) + 1);
        persistCart();
        renderCart();
      });
    });
    els.cartItemsEl.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-remove") || 0);
        cart.splice(idx, 1);
        persistCart();
        renderCart();
        setToastState("Producto eliminado.", "ok");
      });
    });

    refreshTotals();
  };

  const addToCart = (p, qty = 1, size = "") => {
    const sku = getProductSku(p);
    const existing = cart.find((x) => x.sku === sku && String(x.size || "") === String(size || ""));
    if (existing) {
      existing.qty = Math.min(99, Number(existing.qty || 0) + Number(qty || 1));
    } else {
      cart.push({
        sku,
        name: getProductName(p),
        price_cents: getProductPriceCents(p),
        image: getProductImages(p)[0] || getProductImage(p),
        size: size || "",
        qty: clamp(Number(qty || 1), 1, 99),
      });
    }
    persistCart();
    renderCart();
    setToastState("Agregado al carrito.", "ok");
  };

  const findPromo = (code) => {
    const c = normCode(code);
    const rules = Array.isArray(promosData?.rules) ? promosData.rules : [];
    return rules.find((r) => normCode(r?.code) === c) || null;
  };

  const applyPromoCode = async (code) => {
    const c = normCode(code);
    if (!c) return null;
    try {
      const res = await fetch(`${APP_ENDPOINTS.promos}?code=${encodeURIComponent(code)}`, { headers: { "cache-control": "no-store" } });
      if (res.ok) {
        const j = await res.json().catch(() => null);
        if (j?.valid && j?.promo) {
          activePromo = j.promo;
          refreshTotals();
          setToastState("Cupón aplicado.", "ok");
          return j.promo;
        }
      }
    } catch {}

    const local = findPromo(c);
    if (local) {
      activePromo = local;
      refreshTotals();
      setToastState("Cupón aplicado.", "ok");
      return local;
    }

    activePromo = null;
    refreshTotals();
    setToastState("Cupón no válido.", "error");
    return null;
  };

  const quoteShipping = async () => {
    const postal = String(els.checkoutPostal?.value || els.shipPostal?.value || "").trim();
    const subtotal = getCartSubtotal();

    if (shipMode === "pickup") {
      shippingQuoted = 0;
      shippingMeta = { mode: "pickup", amount_cents: 0, label: "Pickup" };
      refreshTotals();
      if (els.shipQuoteStatus) els.shipQuoteStatus.textContent = "Recojo en tienda / pickup";
      if (els.shipQuoteEl) els.shipQuoteEl.textContent = money(0);
      return shippingMeta;
    }

    if (postal.length < 5) {
      setToastState("Captura un código postal válido.", "error");
      return null;
    }

    if (!cart.length) {
      setToastState("Agrega productos al carrito antes de cotizar.", "error");
      return null;
    }

    try {
      const res = await fetch(APP_ENDPOINTS.shipping, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ postal, subtotal_cents: subtotal, items: cart, ship_mode: shipMode }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j) throw new Error(j?.error || `HTTP ${res.status}`);
      shippingQuoted = Number(j.amount_cents || j.amount || 0) || 0;
      shippingMeta = j;
      refreshTotals();
      if (els.shipQuoteStatus) els.shipQuoteStatus.textContent = j.service || j.carrier || "Cotización lista";
      if (els.shipQuoteEl) els.shipQuoteEl.textContent = money(shippingQuoted);
      setToastState("Cotización actualizada.", "ok");
      return j;
    } catch (err) {
      shippingQuoted = 0;
      shippingMeta = null;
      refreshTotals();
      if (els.shipQuoteStatus) els.shipQuoteStatus.textContent = "No fue posible cotizar";
      if (els.shipQuoteEl) els.shipQuoteEl.textContent = money(0);
      setToastState(err?.message || "Error al cotizar envío.", "error");
      return null;
    }
  };

  const openProduct = (sku) => {
    const p = products.find((x) => getProductSku(x) === sku);
    if (!p) return;

    currentProduct = p;
    selectedQty = 1;
    selectedSize = "";
    if (els.pmQtyDisplay) els.pmQtyDisplay.textContent = String(selectedQty);
    if (els.pmTitle) els.pmTitle.textContent = getProductName(p);
    if (els.pmPrice) els.pmPrice.textContent = money(getProductPriceCents(p));

    if (els.pmStockBadge) {
      const stock = Number(p.stock);
      if (Number.isFinite(stock)) {
        els.pmStockBadge.hidden = false;
        els.pmStockBadge.textContent = stock > 0 ? `Stock: ${stock}` : "AGOTADO";
        els.pmStockBadge.style.borderColor = stock > 0 ? "rgba(0,0,0,0.1)" : "var(--red)";
      } else {
        els.pmStockBadge.hidden = true;
      }
    }

    if (els.pmDesc) {
      const scarcity = getScarcityText(p);
      els.pmDesc.innerHTML =
        `<p>${escapeHtml(p.description || "Merch oficial Score Store.")}</p>` +
        (scarcity ? `<p style="color:var(--red); font-weight:bold; margin-top:10px;">${escapeHtml(scarcity)}</p>` : "");
    }

    if (els.pmChips) {
      const logo = CATEGORY_MAP.get(getProductSectionUi(p))?.logo || "/assets/logo-baja1000.webp";
      els.pmChips.innerHTML = `<span class="pill pill--logo"><img src="${safeUrl(logo)}" width="30" height="16" alt="Logo"></span>`;
      if (inferCollection(p)) els.pmChips.innerHTML += `<span class="pill pill--red">${escapeHtml(inferCollection(p))}</span>`;
    }

    if (els.pmSizePills) {
      els.pmSizePills.innerHTML = "";
      const sizes = getProductSizes(p);
      const canSell = Number.isFinite(Number(p.stock)) ? Number(p.stock) > 0 : true;
      sizes.forEach((s) => {
        const size = String(s || "").trim();
        if (!size) return;
        const btn = document.createElement("button");
        btn.className = "size-pill";
        btn.textContent = size;
        if (!canSell) {
          btn.classList.add("out-of-stock");
          btn.setAttribute("aria-disabled", "true");
          btn.title = "Sin stock";
          btn.onclick = () => setToastState("Por ahora no hay stock registrado.", "error");
        } else {
          btn.onclick = () => {
            $$(".size-pill").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            selectedSize = size;
          };
        }
        els.pmSizePills.appendChild(btn);
      });
    }

    if (els.pmCarousel) {
      const imgs = getProductImages(p);
      els.pmCarousel.innerHTML = `
        <div class="pm__track" id="pmTrack">
          ${imgs.length
            ? imgs.map((src) => `<img src="${escapeHtml(src)}" width="400" height="500" loading="lazy" alt="${escapeHtml(getProductName(p))}">`).join("")
            : `<img src="${escapeHtml(getProductImage(p))}" width="400" height="500" loading="lazy" alt="${escapeHtml(getProductName(p))}">`}
        </div>
        ${imgs.length > 1 ? `<div class="pm__dots">${imgs.map((_, i) => `<span class="pm__dot ${i === 0 ? "active" : ""}"></span>`).join("")}</div>` : ""}
      `;
      const track = els.pmCarousel.querySelector("#pmTrack");
      const dots = Array.from(els.pmCarousel.querySelectorAll(".pm__dot"));
      const setDot = (idx) => dots.forEach((d, i) => d.classList.toggle("active", i === idx));
      if (track && dots.length) {
        track.addEventListener("scroll", debounce(() => {
          const idx = clamp(Math.round((track.scrollLeft || 0) / (track.clientWidth || 1)), 0, Math.max(0, dots.length - 1));
          setDot(idx);
        }, 80), { passive: true });
        dots.forEach((d, i) => d.addEventListener("click", () => {
          track.scrollTo({ left: i * (track.clientWidth || 1), behavior: "smooth" });
          setDot(i);
        }));
      }
    }

    openLayer(els.productModal);
  };

  const closeProduct = () => closeLayer(els.productModal);

  const appendAssistantBubble = (role, text) => {
    if (!els.assistantOutput) return;
    const item = document.createElement("div");
    item.className = `chat__bubble chat__bubble--${role}`;
    item.textContent = String(text || "");
    els.assistantOutput.appendChild(item);
    els.assistantOutput.scrollTop = els.assistantOutput.scrollHeight;
  };

  const sendAssistant = async () => {
    const message = String(els.assistantInput?.value || "").trim();
    if (!message) return;

    appendAssistantBubble("user", message);
    if (els.assistantInput) els.assistantInput.value = "";

    try {
      const res = await fetch(APP_ENDPOINTS.chat, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          context: {
            app: "Score Store",
            version: APP_VERSION,
            cart,
            activeCategory,
            shippingMode: shipMode,
          },
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j) throw new Error(j?.error || `HTTP ${res.status}`);
      appendAssistantBubble("assistant", j.reply || j.message || "Listo.");
    } catch (err) {
      appendAssistantBubble("assistant", err?.message || "No fue posible responder.");
    }
  };

  const updateCheckoutState = () => {
    if (!els.checkoutSubmitBtn) return;
    els.checkoutSubmitBtn.disabled = !!siteSettings.maintenance_mode || !cart.length || loadingCheckout;
  };

  const syncShipUI = () => {
    if (els.postalWrap) els.postalWrap.hidden = shipMode !== "delivery";
    if (els.shipHint) els.shipHint.textContent = shipMode === "pickup" ? "Sin costo" : "Selecciona ▼";
    if (shipMode === "pickup") {
      shippingQuoted = 0;
      shippingMeta = { mode: "pickup", amount_cents: 0, label: "Pickup" };
    }
    refreshTotals();
  };

  const quoteFromCurrentPostal = async () => quoteShipping();

  const submitCheckout = async (ev) => {
    ev?.preventDefault();
    if (!cart.length) {
      setToastState("Tu carrito está vacío.", "error");
      return;
    }
    if (siteSettings.maintenance_mode) {
      setToastState("La tienda está en mantenimiento.", "error");
      return;
    }

    const name = String(els.checkoutName?.value || "").trim();
    const email = String(els.checkoutEmail?.value || "").trim();
    const phone = String(els.checkoutPhone?.value || "").trim();
    const address = String(els.checkoutAddress?.value || "").trim();
    const postal = String(els.checkoutPostal?.value || els.shipPostal?.value || "").trim();
    const notes = String(els.checkoutNotes?.value || "").trim();
    const payment_method = String(els.checkoutPaySelect?.value || "card").trim();

    if (!name || !email || !phone) {
      setToastState("Completa nombre, correo y teléfono.", "error");
      return;
    }
    if (shipMode === "delivery" && (!address || postal.length < 5)) {
      setToastState("Completa dirección y CP para envío.", "error");
      return;
    }
    if (shipMode === "delivery" && !shippingQuoted) {
      await quoteShipping();
      if (!shippingQuoted) return;
    }

    const payload = {
      customer: { name, email, phone, address, postal, notes },
      shipping: {
        mode: shipMode,
        amount_cents: getShippingAmount(),
        quote: shippingMeta,
      },
      promo: activePromo,
      payment_method,
      items: cart,
      totals: {
        subtotal_cents: getCartSubtotal(),
        discount_cents: getDiscountAmount(),
        shipping_cents: getShippingAmount(),
        total_cents: getCartTotal(),
      },
      source: {
        app_version: APP_VERSION,
        location: location.href,
      },
    };

    try {
      setCheckoutLoading(true);
      if (els.checkoutMsg) {
        els.checkoutMsg.hidden = true;
        els.checkoutMsg.textContent = "";
      }
      const res = await fetch(APP_ENDPOINTS.checkout, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j) throw new Error(j?.error || `HTTP ${res.status}`);
      if (j.url) {
        location.href = j.url;
        return;
      }
      if (j.checkout_url) {
        location.href = j.checkout_url;
        return;
      }
      if (j.message) setToastState(j.message, "ok");
      else setToastState("Checkout creado.", "ok");
    } catch (err) {
      const msg = err?.message || "No fue posible crear el checkout.";
      if (els.checkoutMsg) {
        els.checkoutMsg.hidden = false;
        els.checkoutMsg.textContent = msg;
      }
      setToastState(msg, "error");
    } finally {
      setCheckoutLoading(false);
    }
  };

  const bindEvents = () => {
    els.openMenuBtn?.addEventListener("click", () => openLayer(els.sideMenu));
    els.closeMenuBtn?.addEventListener("click", () => closeLayer(els.sideMenu));
    els.openCartBtn?.addEventListener("click", () => openLayer(els.cartDrawer));
    els.closeCartBtn?.addEventListener("click", () => closeLayer(els.cartDrawer));
    els.navOpenCart?.addEventListener("click", () => openLayer(els.cartDrawer));
    els.openAssistantBtn?.addEventListener("click", () => openLayer(els.assistantModal));
    els.floatingAssistantBtn?.addEventListener("click", () => openLayer(els.assistantModal));
    els.navOpenAssistant?.addEventListener("click", () => openLayer(els.assistantModal));
    els.assistantClose?.addEventListener("click", () => closeLayer(els.assistantModal));
    els.pmBackBtn?.addEventListener("click", closeProduct);
    els.pmClose?.addEventListener("click", closeProduct);
    els.openSizeGuideBtn?.addEventListener("click", () => openLayer(els.sizeGuideModal));
    els.closeSizeGuideBtn?.addEventListener("click", () => closeLayer(els.sizeGuideModal));
    els.understandSizeBtn?.addEventListener("click", () => closeLayer(els.sizeGuideModal));
    els.scrollToCategoriesBtn?.addEventListener("click", () => els.categoryGrid?.scrollIntoView({ behavior: "smooth", block: "start" }));
    els.scrollTopBtn?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    els.promoBarClose?.addEventListener("click", () => {
      try { localStorage.setItem(STORAGE_KEYS.promoDismissed, "1"); } catch {}
      if (els.promoBar) els.promoBar.hidden = true;
    });

    els.shipModePickup?.addEventListener("change", () => {
      if (els.shipModePickup.checked) {
        shipMode = "pickup";
        try { localStorage.setItem(STORAGE_KEYS.shipMode, shipMode); } catch {}
        syncShipUI();
      }
    });
    els.shipModeDelivery?.addEventListener("change", () => {
      if (els.shipModeDelivery.checked) {
        shipMode = "delivery";
        try { localStorage.setItem(STORAGE_KEYS.shipMode, shipMode); } catch {}
        syncShipUI();
      }
    });
    els.shipQuoteBtn?.addEventListener("click", quoteFromCurrentPostal);

    els.checkoutForm?.addEventListener("submit", submitCheckout);
    els.continueShoppingBtn?.addEventListener("click", () => closeLayer(els.cartDrawer));

    els.assistantSendBtn?.addEventListener("click", sendAssistant);
    els.assistantInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendAssistant();
      }
    });

    els.pmQtyDec?.addEventListener("click", () => {
      selectedQty = clamp(selectedQty - 1, 1, 99);
      if (els.pmQtyDisplay) els.pmQtyDisplay.textContent = String(selectedQty);
    });
    els.pmQtyInc?.addEventListener("click", () => {
      selectedQty = clamp(selectedQty + 1, 1, 99);
      if (els.pmQtyDisplay) els.pmQtyDisplay.textContent = String(selectedQty);
    });
    els.pmAdd?.addEventListener("click", () => {
      if (!currentProduct) return;
      addToCart(currentProduct, selectedQty, selectedSize);
      closeProduct();
    });
    els.pmShareBtn?.addEventListener("click", async () => {
      if (!currentProduct) return;
      const url = `${location.origin}${location.pathname}#sku=${encodeURIComponent(getProductSku(currentProduct))}`;
      try {
        if (navigator.share) {
          await navigator.share({ title: getProductName(currentProduct), url });
        } else if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
          setToastState("Link copiado.", "ok");
        }
      } catch {}
    });

    const syncSearch = (value) => {
      searchQuery = String(value || "");
      if (els.searchInput && els.searchInput.value !== searchQuery) els.searchInput.value = searchQuery;
      if (els.mobileSearchInput && els.mobileSearchInput.value !== searchQuery) els.mobileSearchInput.value = searchQuery;
      if (els.menuSearchInput && els.menuSearchInput.value !== searchQuery) els.menuSearchInput.value = searchQuery;
      updateResults();
    };

    els.searchInput?.addEventListener("input", debounce((e) => syncSearch(e.target.value), 120));
    els.mobileSearchInput?.addEventListener("input", debounce((e) => syncSearch(e.target.value), 120));
    els.menuSearchInput?.addEventListener("input", debounce((e) => syncSearch(e.target.value), 120));
    els.closeMobileSearchBtn?.addEventListener("click", () => { if (els.mobileSearchWrap) els.mobileSearchWrap.hidden = true; });
    els.mobileSearchBtn?.addEventListener("click", () => {
      if (els.mobileSearchWrap) els.mobileSearchWrap.hidden = !els.mobileSearchWrap.hidden;
      els.mobileSearchInput?.focus();
    });
    els.sortSelect?.addEventListener("change", updateResults);
    els.clearFilterBtn?.addEventListener("click", () => {
      activeCategory = null;
      syncSearch("");
      $$(".catcard").forEach((x) => x.classList.remove("active"));
      updateResults();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeLayer(els.sideMenu);
        closeLayer(els.cartDrawer);
        closeLayer(els.assistantModal);
        closeProduct();
        closeLayer(els.sizeGuideModal);
        if (els.mobileSearchWrap) els.mobileSearchWrap.hidden = true;
      }
    });

    els.overlay?.addEventListener("click", () => {
      closeLayer(els.sideMenu);
      closeLayer(els.cartDrawer);
      closeLayer(els.assistantModal);
      closeProduct();
      closeLayer(els.sizeGuideModal);
      if (els.mobileSearchWrap) els.mobileSearchWrap.hidden = true;
    });

    window.addEventListener("scroll", () => {
      if (els.scrollTopBtn) els.scrollTopBtn.hidden = window.scrollY < 500;
    }, { passive: true });
  };

  const applyHashSku = () => {
    const m = String(location.hash || "").match(/sku=([^&]+)/i);
    if (!m) return;
    const sku = decodeURIComponent(m[1] || "");
    if (sku) setTimeout(() => openProduct(sku), 250);
  };

  const updateResults = () => {
    renderProducts();
    maybeShowSwipeHint();
    const cat = CATEGORY_CONFIG.find((c) => c.uiId === activeCategory);
    if (els.activeFilterLabel) {
      els.activeFilterLabel.textContent = activeCategory ? (cat?.name || activeCategory) : "Todos los productos";
    }
    if (els.activeFilterRow) els.activeFilterRow.hidden = !activeCategory && !searchQuery;
    if (els.carouselTitle) els.carouselTitle.textContent = activeCategory ? (cat?.name || "Productos") : "Productos destacados";
    if (els.catalogCarouselSection) els.catalogCarouselSection.hidden = products.length === 0 && !searchQuery && !activeCategory;
  };

  const loadCatalog = async () => {
    if (loadingCatalog) return;
    loadingCatalog = true;
    try {
      const data = await fetchCatalog();
      catalog = data || { categories: [], products: [] };
      const rawProducts = Array.isArray(catalog?.products) ? catalog.products : Array.isArray(catalog?.items) ? catalog.items : [];
      const rawCategories = Array.isArray(catalog?.categories) ? catalog.categories : Array.isArray(catalog?.sections) ? catalog.sections : [];
      categories = rawCategories.map(normalizeCategory);
      products = rawProducts.map(normalizeProduct).filter((p) => p.sku || p.title || p.name);
      filteredProducts = [...products];
      renderCategories();
      updateResults();
      if (els.statusRow) els.statusRow.hidden = false;
      if (els.catalogCarouselSection && products.length) els.catalogCarouselSection.hidden = false;
    } catch (err) {
      categories = [];
      products = [];
      filteredProducts = [];
      renderCategories();
      updateResults();
      setToastState(err?.message || "No fue posible cargar el catálogo.", "error");
    } finally {
      loadingCatalog = false;
    }
  };

  const initSalesNotification = () => {
    if (!els.salesNotification || !els.salesName || !els.salesAction) return;
    const names = ["S. López", "C. Ramírez", "M. Torres", "A. García", "J. Morales"];
    const actions = ["compró una gorra", "agregó una playera", "finalizó un pedido", "aplicó un cupón", "cotizó envío"];
    let idx = 0;
    setInterval(() => {
      els.salesName.textContent = names[idx % names.length];
      els.salesAction.textContent = actions[idx % actions.length];
      els.salesNotification.classList.add("show");
      clearTimeout(initSalesNotification._t);
      initSalesNotification._t = setTimeout(() => els.salesNotification.classList.remove("show"), 3800);
      idx += 1;
    }, 18000);
  };

  const hideSplash = (() => {
    let done = false;
    return (force = false) => {
      if (done || !els.splash) return;
      done = true;
      if (force) {
        els.splash.hidden = true;
        return;
      }
      els.splash.classList.add("fade-out");
      setTimeout(() => { if (els.splash) els.splash.hidden = true; }, 250);
    };
  })();

  const syncAppVersion = () => {
    if (els.appVersionLabel) els.appVersionLabel.textContent = APP_VERSION;
  };

  const boot = async () => {
    syncAppVersion();
    restoreCart();

    try {
      const savedShip = localStorage.getItem(STORAGE_KEYS.shipMode);
      if (savedShip === "pickup" || savedShip === "delivery") shipMode = savedShip;
    } catch {}

    if (els.shipModePickup) els.shipModePickup.checked = shipMode === "pickup";
    if (els.shipModeDelivery) els.shipModeDelivery.checked = shipMode === "delivery";

    bindEvents();
    initCookieBanner();
    refreshTotals();
    renderCart();
    syncShipUI();
    updateCheckoutState();

    const splashFailSafe = setTimeout(() => hideSplash(true), 4500);

    try {
      await Promise.race([
        Promise.allSettled([fetchPromos(), fetchSiteSettings(), loadCatalog()]),
        delay(3500),
      ]);
    } finally {
      clearTimeout(splashFailSafe);
    }

    renderCart();
    refreshTotals();
    updateResults();
    applyHashSku();
    hideSplash();
    initSalesNotification();
  };

  document.addEventListener("DOMContentLoaded", boot);

  window.SCORESTORE = {
    version: APP_VERSION,
    get catalog() { return catalog; },
    get categories() { return categories; },
    get products() { return products; },
    get cart() { return cart; },
    get shipMode() { return shipMode; },
    get activeCategory() { return activeCategory; },
    get activePromo() { return activePromo; },
    applyPromoCode,
    quoteShipping,
    openProduct,
    addToCart,
    refreshTotals,
  };
})();