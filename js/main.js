(() => {
  "use strict";

  const APP_VERSION = "scorestore-main-v4.0.1";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const els = {
    splash: $("#splash"),
    cartToggleBtn: $("#cartToggleBtn"),
    cartCountBadge: $("#cartCountBadge"),
    heroTitle: $("#heroTitle"),
    heroText: $("#heroText"),
    catalogGrid: $("#catalogGrid"),
    searchInput: $("#searchInput"),
    categoryFilter: $("#categoryFilter"),
    shipCountry: $("#shipCountry"),
    shipZip: $("#shipZip"),
    quoteShipBtn: $("#quoteShipBtn"),
    shipQuoteResult: $("#shipQuoteResult"),
    cartSummaryCount: $("#cartSummaryCount"),
    subtotalText: $("#subtotalText"),
    shippingText: $("#shippingText"),
    totalText: $("#totalText"),
    customerEmail: $("#customerEmail"),
    customerPhone: $("#customerPhone"),
    orderNotes: $("#orderNotes"),
    checkoutBtn: $("#checkoutBtn"),
    checkoutStatus: $("#checkoutStatus"),
    cartItems: $("#cartItems"),
    drawerSubtotal: $("#drawerSubtotal"),
    drawerShipping: $("#drawerShipping"),
    drawerTotal: $("#drawerTotal"),
    promoCodeInput: $("#promoCodeInput"),
    applyPromoBtn: $("#applyPromoBtn"),
    promoFeedback: $("#promoFeedback"),
    footerNote: $("#footerNote"),
    footerEmailLink: $("#footerEmailLink"),
    footerWhatsappLink: $("#footerWhatsappLink"),
    footerFacebookLink: $("#footerFacebookLink"),
    footerInstagramLink: $("#footerInstagramLink"),
    footerYoutubeLink: $("#footerYoutubeLink"),
    footerEmailText: $("#footerEmailText"),
    footerWhatsappText: $("#footerWhatsappText"),
  };

  const STORAGE_KEYS = {
    cart: "scorestore_cart_v3",
    ship: "scorestore_ship_v3",
    promo: "scorestore_promo_v3",
    customer: "scorestore_customer_v3",
    ui: "scorestore_ui_v3",
  };

  const DEFAULTS = {
    currency: "MXN",
    shippingCountry: "MX",
    shippingZip: "",
    shipLabel: "Envío pendiente de cotización",
    footerEmail: "ventas.unicotextil@gmail.com",
    footerWhatsappE164: "5216642368701",
    footerWhatsappDisplay: "664 236 8701",
  };

  const state = {
    settings: null,
    catalog: [],
    products: [],
    categories: [],
    promos: [],
    cart: [],
    activeCategory: "",
    query: "",
    shipping: {
      country: DEFAULTS.shippingCountry,
      zip: DEFAULTS.shippingZip,
      label: DEFAULTS.shipLabel,
      amount_cents: 0,
      amount_mxn: 0,
      provider: "",
      eta: "",
      currency: DEFAULTS.currency,
    },
    promo: null,
    ready: false,
    loadingCatalog: true,
  };

  function safeStr(v, d = "") {
    return typeof v === "string" ? v : v == null ? d : String(v);
  }

  function safeNum(v, d = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  }

  function clampInt(v, min, max, fallback = min) {
    const n = Math.floor(safeNum(v, fallback));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function money(cents, currency = DEFAULTS.currency) {
    const n = Number(cents || 0) / 100;
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(n) ? n : 0);
  }

  function normalizeText(v) {
    return safeStr(v).trim();
  }

  function safeJsonParse(raw, fallback = null) {
    try {
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function readStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? safeJsonParse(raw, fallback) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  function setText(idOrEl, value) {
    const el = typeof idOrEl === "string" ? document.getElementById(idOrEl) : idOrEl;
    if (!el) return;
    el.textContent = value == null ? "" : String(value);
  }

  function setHref(idOrEl, href) {
    const el = typeof idOrEl === "string" ? document.getElementById(idOrEl) : idOrEl;
    if (!el) return;
    el.setAttribute("href", href);
  }

  function getApiBase() {
    return "";
  }

  async function apiFetch(path, options = {}) {
    const res = await fetch(`${getApiBase()}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(payload?.error || `HTTP ${res.status}`);
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function normalizeProduct(row) {
    if (!row) return null;

    const images = Array.isArray(row.images) ? row.images : safeJsonParse(row.images, []);
    const sizes = Array.isArray(row.sizes) ? row.sizes : safeJsonParse(row.sizes, []);

    const sectionRaw = normalizeText(row.section_id || row.sectionId || row.category || row.collection || "");
    const priceFrom =
      Number.isFinite(Number(row.price_cents))
        ? Math.max(0, Math.round(Number(row.price_cents)))
        : Math.max(0, Math.round(safeNum(row.price_mxn, safeNum(row.base_mxn, 0)) * 100));

    return {
      id: String(row.id || row.sku || row.slug || cryptoRandomId()).trim(),
      sku: String(row.sku || row.id || row.slug || "").trim(),
      name: String(row.name || row.title || "Producto SCORE").trim(),
      title: String(row.title || row.name || "Producto SCORE").trim(),
      description: String(row.description || "").trim(),
      sectionId: sectionRaw,
      section_id: sectionRaw,
      uiSection: normalizeSectionToUi(sectionRaw),
      collection: inferCollection(row),
      image_url: safeUrl(row.image_url || row.img || row.image || ""),
      img: safeUrl(row.img || row.image || row.image_url || ""),
      images: images.map(safeUrl).filter(Boolean),
      sizes: sizes.map((x) => String(x || "").trim()).filter(Boolean),
      price_cents: priceFrom,
      rank: Number.isFinite(Number(row.rank)) ? Math.round(Number(row.rank)) : 999,
      stock: Number.isFinite(Number(row.stock)) ? Math.round(Number(row.stock)) : null,
      active: row.active !== false && row.is_active !== false,
      metadata: row.metadata || {},
      slug: safeSlug(row.slug || row.sku || row.name || row.title || ""),
    };
  }

  function normalizeCategory(row) {
    return {
      id: String(row?.id || row?.slug || row?.section_id || row?.sectionId || "").trim(),
      name: String(row?.name || row?.title || row?.section_id || row?.sectionId || "Colección").trim(),
      logo: safeUrl(row?.logo || row?.image || row?.cover_image || row?.coverImage || ""),
      section_id: String(row?.section_id || row?.sectionId || row?.id || "").trim(),
    };
  }

  function inferCollection(row) {
    const s = String(row?.section_id || row?.sectionId || row?.category || "").toUpperCase();
    if (s.includes("1000")) return "BAJA_1000";
    if (s.includes("500")) return "BAJA_500";
    if (s.includes("400")) return "BAJA_400";
    if (s.includes("250") || s.includes("SF")) return "SF_250";
    return s || "SCORE";
  }

  function normalizeSectionToUi(section) {
    const s = String(section || "").toUpperCase();
    if (s.includes("1000")) return "Baja 1000";
    if (s.includes("500")) return "Baja 500";
    if (s.includes("400")) return "Baja 400";
    if (s.includes("250") || s.includes("SF")) return "San Felipe 250";
    if (s) return s.replace(/_/g, " ");
    return "Colección";
  }

  function safeUrl(url) {
    const s = String(url || "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s) || s.startsWith("/")) return s;
    return "";
  }

  function safeSlug(v) {
    return String(v || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\-._]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function cryptoRandomId() {
    try {
      return crypto.randomUUID();
    } catch {
      return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }
  }

  function getCatalogSource() {
    return Array.isArray(state.products) && state.products.length ? state.products : [];
  }

  function loadPersistedState() {
    state.cart = Array.isArray(readStorage(STORAGE_KEYS.cart, []))
      ? readStorage(STORAGE_KEYS.cart, [])
          .map((item) => ({
            id: String(item.id || item.sku || "").trim(),
            sku: String(item.sku || item.id || "").trim(),
            title: String(item.title || item.name || "Producto SCORE").trim(),
            price_cents: clampInt(item.price_cents, 0, 9999999, 0),
            qty: clampInt(item.qty, 1, 99, 1),
            size: String(item.size || "").trim(),
            image_url: safeUrl(item.image_url || item.img || ""),
          }))
          .filter((item) => item.id)
      : [];

    const ship = readStorage(STORAGE_KEYS.ship, null);
    if (ship) {
      state.shipping = {
        ...state.shipping,
        ...ship,
      };
    }

    const promo = readStorage(STORAGE_KEYS.promo, null);
    if (promo) {
      state.promo = promo;
    }

    const customer = readStorage(STORAGE_KEYS.customer, null);
    if (customer) {
      if (els.customerEmail && customer.email) els.customerEmail.value = customer.email;
      if (els.customerPhone && customer.phone) els.customerPhone.value = customer.phone;
    }
  }

  function persistCart() {
    writeStorage(STORAGE_KEYS.cart, state.cart);
  }

  function persistShip() {
    writeStorage(STORAGE_KEYS.ship, state.shipping);
  }

  function persistPromo() {
    writeStorage(STORAGE_KEYS.promo, state.promo);
  }

  function persistCustomer() {
    writeStorage(STORAGE_KEYS.customer, {
      email: els.customerEmail ? els.customerEmail.value.trim() : "",
      phone: els.customerPhone ? els.customerPhone.value.trim() : "",
    });
  }

  function normalizeFromAnyCatalog(raw) {
    const arr = Array.isArray(raw) ? raw : [];
    return arr.map(normalizeProduct).filter(Boolean);
  }

  async function fetchSiteSettings() {
    try {
      const payload = await apiFetch("/api/site_settings");
      const data = payload?.site_settings || payload?.data || payload || {};
      state.settings = data;

      const contact = data.contact || data.contact_data || {};
      const home = data.home || {};
      const socials = data.socials || {};

      const email = normalizeText(contact.email || DEFAULTS.footerEmail);
      const waE164 = normalizeText(contact.whatsapp_e164 || DEFAULTS.footerWhatsappE164);
      const waDisplay = normalizeText(contact.whatsapp_display || DEFAULTS.footerWhatsappDisplay);

      if (els.heroTitle && data.hero_title) els.heroTitle.textContent = data.hero_title;
      if (els.heroText && home.hero_text) els.heroText.textContent = home.hero_text;

      if (els.footerEmailLink) setHref(els.footerEmailLink, `mailto:${email}`);
      if (els.footerWhatsappLink) setHref(els.footerWhatsappLink, `https://wa.me/${waE164}`);
      if (els.footerFacebookLink && socials.facebook) setHref(els.footerFacebookLink, socials.facebook);
      if (els.footerInstagramLink && socials.instagram) setHref(els.footerInstagramLink, socials.instagram);
      if (els.footerYoutubeLink && socials.youtube) setHref(els.footerYoutubeLink, socials.youtube);

      if (els.footerEmailText) setText(els.footerEmailText, email);
      if (els.footerWhatsappText) setText(els.footerWhatsappText, waDisplay);
      if (els.footerNote) {
        els.footerNote.textContent =
          home.footer_note ||
          "Pago cifrado vía Stripe. Aceptamos OXXO Pay. Logística inteligente internacional con Envía.com.";
      }

      return data;
    } catch {
      return null;
    }
  }

  async function fetchPromos() {
    try {
      const payload = await apiFetch("/api/promos");
      const rows = Array.isArray(payload?.promos) ? payload.promos : Array.isArray(payload?.data) ? payload.data : [];
      state.promos = rows;
      return rows;
    } catch {
      try {
        const res = await fetch("/data/promos.json", { cache: "no-store" });
        const data = await res.json();
        state.promos = Array.isArray(data) ? data : [];
        return state.promos;
      } catch {
        state.promos = [];
        return [];
      }
    }
  }

  async function loadCatalog() {
    state.loadingCatalog = true;
    renderCatalogSkeleton();

    try {
      const payload = await apiFetch("/api/catalog");
      const rows = Array.isArray(payload?.products)
        ? payload.products
        : Array.isArray(payload?.catalog)
          ? payload.catalog
          : Array.isArray(payload?.data)
            ? payload.data
            : [];
      state.catalog = normalizeFromAnyCatalog(rows);
      state.products = state.catalog.slice();
      buildCategories();
      state.loadingCatalog = false;
      renderCatalog();
      return state.products;
    } catch {
      try {
        const res = await fetch("/data/catalog.json", { cache: "no-store" });
        const data = await res.json();
        state.catalog = normalizeFromAnyCatalog(Array.isArray(data) ? data : data?.products || []);
        state.products = state.catalog.slice();
      } catch {
        state.catalog = demoCatalog();
        state.products = state.catalog.slice();
      }
      buildCategories();
      state.loadingCatalog = false;
      renderCatalog();
      return state.products;
    }
  }

  function demoCatalog() {
    return [
      {
        id: "demo-cap",
        sku: "SCORE-DEMO-CAP",
        name: "Gorra SCORE — Demo",
        title: "Gorra SCORE — Demo",
        description: "Producto demo para validar catálogo, checkout y panel.",
        section_id: "EDICION_2026",
        img: "/icon-512.png",
        image_url: "/icon-512.png",
        images: ["/icon-512.png"],
        sizes: [],
        price_cents: 55000,
        stock: 25,
        rank: 1,
        active: true,
        is_active: true,
        metadata: {},
      },
    ].map(normalizeProduct);
  }

  function buildCategories() {
    const map = new Map();
    for (const p of state.products) {
      const key = p.sectionId || p.collection || "SCORE";
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          name: normalizeSectionToUi(key),
          section_id: key,
        });
      }
    }
    state.categories = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "es"));
    if (els.categoryFilter) {
      const current = els.categoryFilter.value;
      const opts = [`<option value="">Todas</option>`]
        .concat(
          state.categories.map((cat) => {
            const selected = current === cat.section_id ? " selected" : "";
            return `<option value="${escapeHtml(cat.section_id)}"${selected}>${escapeHtml(cat.name)}</option>`;
          })
        )
        .join("");
      els.categoryFilter.innerHTML = opts;
    }
  }

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function renderCatalogSkeleton() {
    if (!els.catalogGrid) return;
    els.catalogGrid.innerHTML = Array.from({ length: 6 })
      .map(
        () => `
        <article class="product-card product-card--skeleton">
          <div class="product-card__media"></div>
          <div class="product-card__body">
            <div class="skeleton-line w-40"></div>
            <div class="skeleton-line w-72"></div>
            <div class="skeleton-line w-24"></div>
          </div>
        </article>`
      )
      .join("");
  }

  function getVisibleProducts() {
    const q = normalizeText(state.query).toLowerCase();
    const cat = normalizeText(state.activeCategory);

    return state.products
      .filter((p) => p.active !== false)
      .filter((p) => (cat ? (p.sectionId === cat || p.collection === cat) : true))
      .filter((p) => {
        if (!q) return true;
        const hay = [
          p.name,
          p.title,
          p.description,
          p.sku,
          p.collection,
          p.sectionId,
          ...(Array.isArray(p.sizes) ? p.sizes : []),
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => (a.rank || 999) - (b.rank || 999) || a.name.localeCompare(b.name, "es"));
  }

  function renderCatalog() {
    if (!els.catalogGrid) return;
    const items = getVisibleProducts();

    if (!items.length) {
      els.catalogGrid.innerHTML = `
        <div class="empty-state">
          <h3>Sin resultados</h3>
          <p>No hay productos que coincidan con tu búsqueda o filtro.</p>
        </div>`;
      return;
    }

    els.catalogGrid.innerHTML = items
      .map((product) => {
        const img = product.image_url || product.img || "/icon-512.png";
        const hasStock = product.stock == null || product.stock > 0;
        return `
          <article class="product-card" data-product-id="${escapeHtml(product.id)}">
            <button type="button" class="product-card__media-btn" data-action="open-product" data-product-id="${escapeHtml(product.id)}" aria-label="Ver ${escapeHtml(product.title)}">
              <img class="product-card__media" src="${escapeHtml(img)}" alt="${escapeHtml(product.title)}" loading="lazy" />
            </button>
            <div class="product-card__body">
              <div class="product-card__meta">
                <span class="chip">${escapeHtml(product.uiSection || "Colección")}</span>
                <span class="chip chip--subtle">${hasStock ? "Disponible" : "Agotado"}</span>
              </div>
              <h3 class="product-card__title">${escapeHtml(product.title)}</h3>
              <p class="product-card__desc">${escapeHtml(product.description || "Mercancía oficial SCORE.")}</p>
              <div class="product-card__footer">
                <strong class="product-card__price">${money(product.price_cents)}</strong>
                <button type="button" class="btn btn--secondary btn--small" data-action="add-to-cart" data-product-id="${escapeHtml(product.id)}">Agregar</button>
              </div>
            </div>
          </article>`;
      })
      .join("");

    $$('[data-action="open-product"]', els.catalogGrid).forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-product-id");
        openProduct(id);
      });
    });

    $$('[data-action="add-to-cart"]', els.catalogGrid).forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-product-id");
        addToCart(id, 1);
      });
    });
  }

  function findProduct(id) {
    const sid = String(id || "").trim();
    return state.products.find((p) => p.id === sid || p.sku === sid || p.slug === sid) || null;
  }

  function getCartQty() {
    return state.cart.reduce((acc, item) => acc + clampInt(item.qty, 1, 99, 1), 0);
  }

  function getSubtotalCents() {
    return state.cart.reduce((acc, item) => {
      const price = clampInt(item.price_cents, 0, 9999999, 0);
      const qty = clampInt(item.qty, 1, 99, 1);
      return acc + price * qty;
    }, 0);
  }

  function getPromoDiscountCents(subtotalCents) {
    const promo = state.promo;
    if (!promo || !promo.active) return 0;

    const code = normalizeText(promo.code || promo.slug || "").toUpperCase();
    if (!code) return 0;

    const kind = String(promo.kind || promo.type || "").toLowerCase();
    const value = safeNum(promo.value ?? promo.amount ?? promo.discount, 0);

    if (kind.includes("percent")) {
      return Math.max(0, Math.round(subtotalCents * (value / 100)));
    }

    if (kind.includes("fixed") || kind.includes("amount")) {
      return Math.max(0, Math.round(value * 100));
    }

    return 0;
  }

  function getTotalCents() {
    const subtotal = getSubtotalCents();
    const discount = getPromoDiscountCents(subtotal);
    const shipping = clampInt(state.shipping.amount_cents, 0, 9999999, 0);
    return Math.max(0, subtotal - discount + shipping);
  }

  function syncPromoStateFromCode(code, extra = null) {
    const normalized = normalizeText(code).toUpperCase();
    const promo = state.promos.find((p) => {
      const pCode = normalizeText(p.code || p.slug || "").toUpperCase();
      return pCode && pCode === normalized;
    }) || null;

    if (!promo && extra) {
      const fallback = {
        code: normalized,
        active: true,
        kind: extra.kind || "fixed",
        value: extra.value || 0,
        label: extra.label || normalized,
      };
      state.promo = fallback;
      persistPromo();
      renderTotals();
      return fallback;
    }

    state.promo = promo
      ? {
          code: promo.code || promo.slug || normalized,
          active: promo.active !== false,
          kind: promo.kind || promo.type || "fixed",
          value: safeNum(promo.value ?? promo.amount ?? promo.discount, 0),
          label: promo.label || promo.name || normalized,
        }
      : null;

    persistPromo();
    renderTotals();
    return state.promo;
  }

  function applyPromoCode(code) {
    const entered = normalizeText(code);
    if (!entered) {
      if (els.promoFeedback) els.promoFeedback.textContent = "Escribe un código para aplicarlo.";
      return null;
    }

    const promo = syncPromoStateFromCode(entered);
    if (!promo) {
      if (els.promoFeedback) els.promoFeedback.textContent = `El código "${entered}" no es válido o ya no está activo.`;
      return null;
    }

    if (els.promoFeedback) {
      const subtotal = getSubtotalCents();
      const discount = getPromoDiscountCents(subtotal);
      els.promoFeedback.textContent = `Promo aplicada: ${promo.label || promo.code} · Descuento ${money(discount)}`;
    }

    renderTotals();
    renderCart();
    return promo;
  }

  function addToCart(productId, qty = 1, size = "") {
    const product = findProduct(productId);
    if (!product) return false;

    const normalizedQty = clampInt(qty, 1, 99, 1);
    const sid = normalizeText(size);

    const existing = state.cart.find(
      (item) => item.id === product.id && normalizeText(item.size) === sid
    );

    if (existing) {
      existing.qty = clampInt(existing.qty + normalizedQty, 1, 99, existing.qty);
    } else {
      state.cart.push({
        id: product.id,
        sku: product.sku || product.id,
        title: product.title || product.name,
        price_cents: product.price_cents,
        qty: normalizedQty,
        size: sid,
        image_url: product.image_url || product.img || "",
      });
    }

    persistCart();
    renderCart();
    flashCartBadge();
    return true;
  }

  function removeFromCart(index) {
    if (index < 0 || index >= state.cart.length) return;
    state.cart.splice(index, 1);
    persistCart();
    renderCart();
  }

  function updateCartQty(index, qty) {
    const item = state.cart[index];
    if (!item) return;
    item.qty = clampInt(qty, 1, 99, 1);
    persistCart();
    renderCart();
  }

  function clearCart() {
    state.cart = [];
    persistCart();
    renderCart();
  }

  function flashCartBadge() {
    if (!els.cartCountBadge) return;
    els.cartCountBadge.classList.add("pulse");
    setTimeout(() => els.cartCountBadge?.classList.remove("pulse"), 250);
  }

  function renderCart() {
    const qty = getCartQty();
    const subtotal = getSubtotalCents();
    const discount = getPromoDiscountCents(subtotal);
    const shipping = clampInt(state.shipping.amount_cents, 0, 9999999, 0);
    const total = Math.max(0, subtotal - discount + shipping);

    if (els.cartCountBadge) els.cartCountBadge.textContent = String(qty);
    if (els.cartSummaryCount) els.cartSummaryCount.textContent = `${qty} artículo${qty === 1 ? "" : "s"}`;
    if (els.subtotalText) els.subtotalText.textContent = money(subtotal);
    if (els.shippingText) els.shippingText.textContent = shipping > 0 ? money(shipping) : "Pendiente";
    if (els.totalText) els.totalText.textContent = money(total);
    if (els.drawerSubtotal) els.drawerSubtotal.textContent = money(subtotal);
    if (els.drawerShipping) els.drawerShipping.textContent = shipping > 0 ? money(shipping) : "Pendiente";
    if (els.drawerTotal) els.drawerTotal.textContent = money(total);

    if (!els.cartItems) return;

    if (!state.cart.length) {
      els.cartItems.innerHTML = `
        <div class="empty-state">
          <h3>Carrito vacío</h3>
          <p>Agrega productos para continuar con el checkout.</p>
        </div>`;
      return;
    }

    els.cartItems.innerHTML = state.cart
      .map((item, index) => {
        const line = item.price_cents * item.qty;
        return `
          <article class="cart-item">
            <img class="cart-item__img" src="${escapeHtml(item.image_url || "/icon-192.png")}" alt="${escapeHtml(item.title)}" loading="lazy" />
            <div class="cart-item__info">
              <h4>${escapeHtml(item.title)}</h4>
              <p>${item.size ? `Talla: ${escapeHtml(item.size)}` : "Talla libre"}</p>
              <strong>${money(line)}</strong>
              <div class="cart-item__controls">
                <button type="button" data-cart-dec="${index}">−</button>
                <input type="number" min="1" max="99" value="${escapeHtml(item.qty)}" data-cart-qty="${index}" />
                <button type="button" data-cart-inc="${index}">+</button>
                <button type="button" class="cart-item__remove" data-cart-remove="${index}">Eliminar</button>
              </div>
            </div>
          </article>`;
      })
      .join("");

    $$("[data-cart-remove]", els.cartItems).forEach((btn) => {
      btn.addEventListener("click", () => removeFromCart(Number(btn.getAttribute("data-cart-remove"))));
    });

    $$("[data-cart-dec]", els.cartItems).forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-cart-dec"));
        updateCartQty(idx, (state.cart[idx]?.qty || 1) - 1);
      });
    });

    $$("[data-cart-inc]", els.cartItems).forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-cart-inc"));
        updateCartQty(idx, (state.cart[idx]?.qty || 1) + 1);
      });
    });

    $$("[data-cart-qty]", els.cartItems).forEach((input) => {
      input.addEventListener("change", () => {
        const idx = Number(input.getAttribute("data-cart-qty"));
        updateCartQty(idx, input.value);
      });
    });

    renderTotals();
  }

  function renderTotals() {
    const subtotal = getSubtotalCents();
    const discount = getPromoDiscountCents(subtotal);
    const shipping = clampInt(state.shipping.amount_cents, 0, 9999999, 0);
    const total = Math.max(0, subtotal - discount + shipping);

    if (els.subtotalText) els.subtotalText.textContent = money(subtotal);
    if (els.shippingText) els.shippingText.textContent = shipping > 0 ? money(shipping) : "Pendiente";
    if (els.totalText) els.totalText.textContent = money(total);

    if (els.drawerSubtotal) els.drawerSubtotal.textContent = money(subtotal);
    if (els.drawerShipping) els.drawerShipping.textContent = shipping > 0 ? money(shipping) : "Pendiente";
    if (els.drawerTotal) els.drawerTotal.textContent = money(total);

    if (els.promoFeedback) {
      if (state.promo) {
        els.promoFeedback.textContent = `Promo activa: ${state.promo.label || state.promo.code} · Descuento ${money(discount)}`;
      } else {
        els.promoFeedback.textContent = discount > 0 ? `Descuento aplicado: ${money(discount)}` : "Las promociones válidas se reflejan en el total.";
      }
    }
  }

  async function quoteShipping() {
    const country = normalizeText(els.shipCountry?.value || state.shipping.country || DEFAULTS.shippingCountry).toUpperCase();
    const zip = normalizeText(els.shipZip?.value || state.shipping.zip || "");

    if (!zip) {
      if (els.shipQuoteResult) els.shipQuoteResult.textContent = "Ingresa un código postal.";
      return null;
    }

    if (els.shipQuoteResult) els.shipQuoteResult.textContent = "Cotizando...";

    try {
      const payload = await apiFetch("/api/envia/summary", {
        method: "POST",
        body: JSON.stringify({
          country,
          zip,
          items_qty: getCartQty() || 1,
        }),
      });

      const data = payload?.quote || payload?.data || payload;
      const amount_cents = clampInt(data.amount_cents, 0, 9999999, 0);

      state.shipping = {
        country,
        zip,
        label: data.label || DEFAULTS.shipLabel,
        amount_cents,
        amount_mxn: safeNum(data.amount_mxn, amount_cents / 100),
        provider: data.provider || "envia",
        eta: data.eta || "",
        currency: data.currency || DEFAULTS.currency,
      };
      persistShip();
      renderTotals();

      if (els.shipQuoteResult) {
        els.shipQuoteResult.textContent = `${state.shipping.label} · ${money(state.shipping.amount_cents)}${state.shipping.eta ? ` · ETA ${state.shipping.eta}` : ""}`;
      }

      return state.shipping;
    } catch (error) {
      state.shipping = {
        ...state.shipping,
        country,
        zip,
        label: "Envío estimado",
        amount_cents: Math.max(0, Math.round((country === "US" ? 850 : 250) * 100)),
        amount_mxn: country === "US" ? 850 : 250,
        provider: "fallback",
      };
      persistShip();
      renderTotals();

      if (els.shipQuoteResult) {
        els.shipQuoteResult.textContent = `No fue posible cotizar en tiempo real. Se usó una tarifa estimada (${money(state.shipping.amount_cents)}).`;
      }

      return state.shipping;
    }
  }

  function openProduct(productId) {
    const p = findProduct(productId);
    if (!p) return;

    const title = p.title || p.name || "Producto SCORE";
    const desc = p.description || "Mercancía oficial SCORE.";
    const price = money(p.price_cents);
    const section = p.uiSection || "Colección";

    if (els.checkoutStatus) {
      els.checkoutStatus.textContent = `${title} · ${section} · ${price}`;
    }

    addToCart(p.id, 1);
    document.getElementById("checkout")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function updateCheckoutState() {
    const ready = Boolean(state.cart.length && (els.customerEmail?.value || "").trim());
    if (els.checkoutBtn) els.checkoutBtn.disabled = !ready;
    if (els.checkoutStatus) {
      els.checkoutStatus.textContent = ready
        ? "Listo para crear una sesión de pago."
        : "Agrega productos y un email válido para continuar.";
    }
  }

  async function createCheckout() {
    const email = normalizeText(els.customerEmail?.value || "");
    const phone = normalizeText(els.customerPhone?.value || "");
    const notes = normalizeText(els.orderNotes?.value || "");

    if (!state.cart.length) {
      if (els.checkoutStatus) els.checkoutStatus.textContent = "Tu carrito está vacío.";
      return null;
    }

    if (!email || !/@/.test(email)) {
      if (els.checkoutStatus) els.checkoutStatus.textContent = "Escribe un email válido.";
      return null;
    }

    if (els.checkoutBtn) els.checkoutBtn.disabled = true;
    if (els.checkoutStatus) els.checkoutStatus.textContent = "Creando checkout seguro...";

    persistCustomer();

    try {
      const payload = await apiFetch("/api/create_checkout", {
        method: "POST",
        body: JSON.stringify({
          customer_email: email,
          customer_phone: phone,
          notes,
          shipping_country: state.shipping.country || DEFAULTS.shippingCountry,
          shipping_zip: state.shipping.zip || "",
          shipping_amount_cents: clampInt(state.shipping.amount_cents, 0, 9999999, 0),
          promo_code: state.promo?.code || "",
          items: state.cart.map((item) => ({
            id: item.id,
            sku: item.sku,
            title: item.title,
            qty: item.qty,
            size: item.size,
            price_cents: item.price_cents,
          })),
        }),
      });

      const url = payload?.url || payload?.checkout_url || payload?.session_url || "";
      if (url) {
        if (els.checkoutStatus) els.checkoutStatus.textContent = "Redirigiendo a Stripe...";
        window.location.href = url;
        return payload;
      }

      if (payload?.checkout_session_id) {
        if (els.checkoutStatus) els.checkoutStatus.textContent = "Checkout creado. Verificando estado...";
        return payload;
      }

      throw new Error("La respuesta del checkout no incluyó URL de pago.");
    } catch (error) {
      if (els.checkoutStatus) {
        els.checkoutStatus.textContent = String(error?.message || "No se pudo crear el checkout.");
      }
      return null;
    } finally {
      updateCheckoutState();
    }
  }

  function applyHashSku() {
    const hash = String(window.location.hash || "").replace(/^#/, "").trim();
    if (!hash) return;
    const p = findProduct(hash);
    if (p) {
      openProduct(p.id);
      window.location.hash = "";
    }
  }

  function hideSplash(force = false) {
    if (!els.splash) return;
    els.splash.classList.add("splash--hide");
    if (force) {
      setTimeout(() => {
        els.splash?.remove();
      }, 350);
    }
  }

  function bindEvents() {
    els.searchInput?.addEventListener("input", (e) => {
      state.query = e.target.value;
      renderCatalog();
    });

    els.categoryFilter?.addEventListener("change", (e) => {
      state.activeCategory = e.target.value;
      renderCatalog();
    });

    els.shipCountry?.addEventListener("change", (e) => {
      state.shipping.country = e.target.value;
      persistShip();
      renderTotals();
    });

    els.shipZip?.addEventListener("input", (e) => {
      state.shipping.zip = e.target.value;
      persistShip();
    });

    els.quoteShipBtn?.addEventListener("click", quoteShipping);

    els.cartToggleBtn?.addEventListener("click", () => {
      document.getElementById("cartDrawer")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    els.promoCodeInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyPromoCode(els.promoCodeInput.value);
      }
    });

    els.applyPromoBtn?.addEventListener("click", () => {
      applyPromoCode(els.promoCodeInput?.value || "");
    });

    els.checkoutBtn?.addEventListener("click", createCheckout);

    els.customerEmail?.addEventListener("input", () => {
      persistCustomer();
      updateCheckoutState();
    });

    els.customerPhone?.addEventListener("input", () => {
      persistCustomer();
    });

    els.orderNotes?.addEventListener("input", () => {
      persistCustomer();
    });

    window.addEventListener("hashchange", applyHashSku);

    document.addEventListener("click", (event) => {
      const btn = event.target.closest?.("[data-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      const productId = btn.getAttribute("data-product-id");

      if (action === "add-to-cart" && productId) {
        addToCart(productId, 1);
      }

      if (action === "open-product" && productId) {
        openProduct(productId);
      }
    });
  }

  function initCookieBanner() {
    const existing = document.getElementById("cookieBanner");
    if (existing) return;

    const accepted = readStorage("scorestore_cookie_accept_v1", false);
    if (accepted) return;

    const banner = document.createElement("div");
    banner.id = "cookieBanner";
    banner.className = "cookie-banner";
    banner.innerHTML = `
      <div class="cookie-banner__inner">
        <p>Usamos cookies y almacenamiento local para mantener el carrito, las preferencias y el checkout.</p>
        <div class="cookie-banner__actions">
          <button type="button" class="btn btn--secondary btn--small" id="cookieBannerAccept">Aceptar</button>
        </div>
      </div>
    `;
    document.body.appendChild(banner);

    $("#cookieBannerAccept", banner)?.addEventListener("click", () => {
      writeStorage("scorestore_cookie_accept_v1", true);
      banner.remove();
    });
  }

  function initSalesNotification() {
    const existing = document.getElementById("salesToast");
    if (existing) return;

    const toast = document.createElement("div");
    toast.id = "salesToast";
    toast.className = "sales-toast";
    toast.textContent = "Checkout listo para producción.";
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("sales-toast--show");
    }, 1200);

    setTimeout(() => {
      toast.classList.remove("sales-toast--show");
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }

  async function boot() {
    loadPersistedState();
    bindEvents();
    initCookieBanner();
    updateCheckoutState();
    renderCart();
    renderTotals();

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
    renderTotals();
    renderCatalog();
    applyHashSku();
    hideSplash();
    initSalesNotification();
    state.ready = true;
    updateCheckoutState();
  }

  document.addEventListener("DOMContentLoaded", boot);

  window.SCORESTORE = {
    version: APP_VERSION,
    get catalog() {
      return state.catalog;
    },
    get categories() {
      return state.categories;
    },
    get products() {
      return state.products;
    },
    get cart() {
      return state.cart;
    },
    get shipMode() {
      return state.shipping;
    },
    get activeCategory() {
      return state.activeCategory;
    },
    get activePromo() {
      return state.promo;
    },
    applyPromoCode,
    quoteShipping,
    openProduct,
    addToCart,
    refreshTotals: renderTotals,
    clearCart,
    loadCatalog,
  };
})();