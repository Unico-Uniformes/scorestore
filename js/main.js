/* =========================================================
   SCORE STORE — MAIN JS (Aligned HTML ↔ JS)
   - Catálogo visible (sections/categories)
   - Productos visibles (images[] / img)
   - Carrito sólido + Stripe/OXXO checkout
   - Cotización envío (optional) via /api/quote
   - Carrusel estilo Facebook (scroll snap + dots + arrows)
   - Cookie gate para pixel (no rompe si no hay pixel id)
   ========================================================= */

(() => {
  const APP_VERSION = (window.__APP_VERSION__ || "dev");
  const STORAGE_KEY = "scorestore_cart_v1";

  const CONFIG = {
    endpoints: {
      catalog: `data/catalog.json?v=${encodeURIComponent(APP_VERSION)}`,
      checkout: "/api/checkout",
      quote: "/api/quote",
      chat: "/api/chat",
    },
    currency: "MXN",
    locale: "es-MX",
    // Si luego quieres pixel: pon tu ID aquí (o injéctalo por env/build)
    metaPixelId: "" // e.g. "1234567890"
  };

  /* ---------------------------
     DOM
  --------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const dom = {
    appVersionLabel: $("#appVersionLabel"),

    // nav
    openMenuBtn: $("#openMenuBtn"),
    sideMenu: $("#sideMenu"),
    closeMenuBtn: $("#closeMenuBtn"),
    overlay: $("#overlay"),

    // search / sort
    searchInput: $("#searchInput"),
    sortSelect: $("#sortSelect"),

    // category
    categoryGrid: $("#categoryGrid"),
    clearCategoryBtn: $("#clearCategoryBtn"),
    categoryHint: $("#categoryHint"),

    // products
    productGrid: $("#productGrid"),
    statusRow: $("#statusRow"),
    activeFilterRow: $("#activeFilterRow"),
    activeFilterLabel: $("#activeFilterLabel"),
    clearFilterBtn: $("#clearFilterBtn"),

    // hero buttons
    scrollToCategoriesBtn: $("#scrollToCategoriesBtn"),
    scrollToCatalogBtn: $("#scrollToCatalogBtn"),

    // cart
    openCartBtn: $("#openCartBtn"),
    navOpenCart: $("#navOpenCart"),
    cartDrawer: $("#cartDrawer"),
    closeCartBtn: $("#closeCartBtn"),
    cartCount: $("#cartCount"),
    cartItems: $("#cartItems"),
    cartSubtotal: $("#cartSubtotal"),
    cartTotal: $("#cartTotal"),
    shippingLine: $("#shippingLine"),
    shipHint: $("#shipHint"),
    postalWrap: $("#postalWrap"),
    postalCode: $("#postalCode"),
    quoteBtn: $("#quoteBtn"),
    promoCode: $("#promoCode"),
    checkoutBtn: $("#checkoutBtn"),
    checkoutMsg: $("#checkoutMsg"),

    // product modal
    productModal: $("#productModal"),
    pmClose: $("#pmClose"),
    pmTitle: $("#pmTitle"),
    pmCarousel: $("#pmCarousel"),
    pmPrice: $("#pmPrice"),
    pmDesc: $("#pmDesc"),
    pmSize: $("#pmSize"),
    pmQty: $("#pmQty"),
    pmAdd: $("#pmAdd"),

    // AI modal
    openAiBtn: $("#openAiBtn"),
    navOpenAi: $("#navOpenAi"),
    aiModal: $("#aiModal"),
    aiClose: $("#aiClose"),
    aiOutput: $("#aiOutput"),
    aiInput: $("#aiInput"),
    aiSendBtn: $("#aiSendBtn"),

    // legal
    openLegalBtn: $("#openLegalBtn"),
    openPrivacyBtn: $("#openPrivacyBtn"),
    legalModal: $("#legalModal"),
    legalClose: $("#legalClose"),
    legalTitle: $("#legalTitle"),
    legalBody: $("#legalBody"),

    // cookies
    cookieBanner: $("#cookieBanner"),
    cookieAccept: $("#cookieAccept"),
    cookieReject: $("#cookieReject"),

    // toast
    toast: $("#toast"),
  };

  /* ---------------------------
     State
  --------------------------- */
  const state = {
    catalog: null,
    sections: [],
    products: [],
    activeSectionId: null,
    search: "",
    sort: "featured",

    cart: loadCart(),
    shippingMode: "pickup", // pickup | delivery
    postalCode: "",
    shippingQuoteCents: 0,
    promoCode: "",
    modalProduct: null,
  };

  /* ---------------------------
     Utils
  --------------------------- */
  const money = (mxn) => {
    try {
      return new Intl.NumberFormat(CONFIG.locale, { style: "currency", currency: CONFIG.currency }).format(mxn);
    } catch {
      return `$${Number(mxn || 0).toFixed(0)}`;
    }
  };

  const centsToMXN = (cents) => Math.max(0, Math.round(Number(cents || 0))) / 100;

  const safeAssetUrl = (path) => {
    if (!path) return "";
    const p = String(path).trim();
    const normalized = p.startsWith("/") ? p : `/${p}`;
    return encodeURI(normalized); // encodes spaces -> %20
  };

  const debounce = (fn, ms = 350) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  const toast = (msg) => {
    if (!dom.toast) return;
    dom.toast.textContent = msg;
    dom.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (dom.toast.hidden = true), 2200);
  };

  const clampQty = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return 1;
    return Math.max(1, Math.min(99, Math.round(v)));
  };

  function loadCart() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveCart() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.cart));
    } catch {}
    updateCartBadge();
  }

  function updateCartBadge() {
    const count = state.cart.reduce((a, it) => a + (it.qty || 0), 0);
    dom.cartCount.textContent = String(count);
  }

  function getSectionForProduct(p) {
    return p.sectionId || p.categoryId || p.section || p.category || null;
  }

  function getProductTitle(p) {
    return p.title || p.name || p.label || "Producto";
  }

  function getProductDesc(p) {
    return p.description || p.desc || "";
  }

  function getProductImages(p) {
    const imgs = []
      .concat(p.images || [])
      .concat(p.img ? [p.img] : [])
      .filter(Boolean);

    // de-dup
    const seen = new Set();
    const unique = [];
    for (const x of imgs) {
      const key = String(x);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(key);
    }
    return unique.length ? unique : [];
  }

  function getProductPriceCents(p) {
    // compatible con create_checkout.js
    if (Number.isFinite(Number(p.price_cents))) return Number(p.price_cents);
    if (Number.isFinite(Number(p.baseMXN))) return Number(p.baseMXN) * 100;
    if (Number.isFinite(Number(p.priceMXN))) return Number(p.priceMXN) * 100;
    return 0;
  }

  function getProductSku(p) {
    return p.sku || p.id || p.ref || getProductTitle(p);
  }

  function getSizes(p) {
    const sizes = p.sizes || p.variants || [];
    const out = Array.isArray(sizes) ? sizes : [];
    // normaliza strings
    return out.map(s => String(s)).filter(Boolean);
  }

  /* ---------------------------
     Overlay / Drawer / Modal
  --------------------------- */
  function showOverlay() {
    dom.overlay.hidden = false;
    dom.overlay.classList.add("is-on");
  }
  function hideOverlay() {
    dom.overlay.hidden = true;
    dom.overlay.classList.remove("is-on");
  }

  function openDrawer(el) {
    showOverlay();
    el.hidden = false;
  }
  function closeDrawer(el) {
    el.hidden = true;
    hideOverlay();
  }

  function openModal(el) {
    showOverlay();
    el.hidden = false;
  }
  function closeModal(el) {
    el.hidden = true;
    hideOverlay();
  }

  /* ---------------------------
     Catalog fetch + render
  --------------------------- */
  async function loadCatalog() {
    dom.statusRow.textContent = "Cargando catálogo…";

    const res = await fetch(CONFIG.endpoints.catalog, { cache: "no-store" }).catch(() => null);
    if (!res || !res.ok) {
      dom.statusRow.textContent = "No se pudo cargar el catálogo. Revisa data/catalog.json.";
      return;
    }

    const data = await res.json().catch(() => null);
    if (!data) {
      dom.statusRow.textContent = "Catálogo inválido (JSON).";
      return;
    }

    state.catalog = data;

    // Soporta: sections[] (07.zip) o categories[] (scorestore-main)
    const rawSections = data.sections || data.categories || [];
    state.sections = Array.isArray(rawSections) ? rawSections : [];

    const rawProducts = data.products || [];
    state.products = Array.isArray(rawProducts) ? rawProducts : [];

    dom.statusRow.textContent = "";
    renderSections();
    renderProducts();
  }

  function renderSections() {
    const list = state.sections || [];
    dom.categoryGrid.innerHTML = "";

    if (!list.length) {
      dom.categoryHint.hidden = false;
      dom.categoryHint.textContent = "No hay ediciones (sections/categories) en el catálogo.";
      return;
    }

    dom.categoryHint.hidden = false;

    for (const s of list) {
      const id = s.id || s.slug || s.key;
      const title = s.name || s.title || "Edición";
      const img = s.cover_image || s.image || s.img || "";

      const card = document.createElement("button");
      card.type = "button";
      card.className = "cat";
      card.setAttribute("data-section", String(id || ""));

      card.innerHTML = `
        <img class="cat__img" src="${safeAssetUrl(img)}" alt="${escapeHtml(title)}" loading="lazy" onerror="this.style.opacity=.25;this.alt='Imagen no disponible'">
        <div class="cat__body">
          <p class="cat__title">${escapeHtml(title)}</p>
          <p class="cat__sub">Toca para filtrar</p>
        </div>
      `;

      card.addEventListener("click", () => {
        state.activeSectionId = String(id || "");
        dom.activeFilterRow.hidden = false;
        dom.activeFilterLabel.textContent = `Filtro: ${title}`;
        renderProducts(true);
        scrollTo("#catalog");
        toast(`Filtrando: ${title}`);
      });

      dom.categoryGrid.appendChild(card);
    }
  }

  function getFilteredProducts() {
    let list = [...(state.products || [])];

    if (state.activeSectionId) {
      list = list.filter(p => String(getSectionForProduct(p) || "") === String(state.activeSectionId));
    }

    if (state.search) {
      const q = state.search.toLowerCase();
      list = list.filter(p => {
        const title = getProductTitle(p).toLowerCase();
        const desc = getProductDesc(p).toLowerCase();
        const section = String(getSectionForProduct(p) || "").toLowerCase();
        return title.includes(q) || desc.includes(q) || section.includes(q);
      });
    }

    switch (state.sort) {
      case "price_asc":
        list.sort((a,b) => getProductPriceCents(a) - getProductPriceCents(b));
        break;
      case "price_desc":
        list.sort((a,b) => getProductPriceCents(b) - getProductPriceCents(a));
        break;
      case "name_asc":
        list.sort((a,b) => getProductTitle(a).localeCompare(getProductTitle(b), "es"));
        break;
      case "featured":
      default:
        // si hay "featured" o "rank", úsalo
        list.sort((a,b) => (Number(a.rank||0) - Number(b.rank||0)));
        break;
    }

    return list;
  }

  function renderProducts(fromUserAction = false) {
    const list = getFilteredProducts();

    dom.productGrid.innerHTML = "";

    if (!state.products.length) {
      dom.statusRow.textContent = "No hay productos en el catálogo.";
      return;
    }

    dom.statusRow.textContent = list.length
      ? `${list.length} producto(s) disponibles.`
      : "Sin resultados con ese filtro.";

    for (const p of list) {
      const title = getProductTitle(p);
      const desc = getProductDesc(p);
      const images = getProductImages(p);
      const priceCents = getProductPriceCents(p);
      const price = money(centsToMXN(priceCents));
      const sizes = getSizes(p);

      const card = document.createElement("article");
      card.className = "card";

      // Carousel
      const carousel = buildCarousel(images, title);

      // Body
      const body = document.createElement("div");
      body.className = "card__body";
      body.innerHTML = `
        <h3 class="card__title">${escapeHtml(title)}</h3>
        <div class="card__meta">
          <div class="price">${price}</div>
          <div class="small">${sizes.length ? `Tallas: ${escapeHtml(sizes.join(", "))}` : "Talla: N/A"}</div>
        </div>
        <div class="card__actions">
          <button class="btn btn--ghost" type="button" data-action="view">Ver</button>
          <button class="btn btn--primary" type="button" data-action="add">Agregar</button>
        </div>
      `;

      body.querySelector('[data-action="view"]').addEventListener("click", () => openProductModal(p));
      body.querySelector('[data-action="add"]').addEventListener("click", () => {
        // Quick add (usa primera talla si existe)
        const size = sizes[0] || "";
        addToCart(p, size, 1);
      });

      card.appendChild(carousel);
      card.appendChild(body);

      dom.productGrid.appendChild(card);
    }

    if (fromUserAction) {
      dom.productGrid.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  /* ---------------------------
     Carousel (FB style)
  --------------------------- */
  function buildCarousel(images, title) {
    const wrap = document.createElement("div");
    wrap.className = "carousel";

    const imgs = (images && images.length) ? images : ["assets/brand/placeholder.png"];
    const track = document.createElement("div");
    track.className = "carousel__track";

    const slides = imgs.map((src) => {
      const slide = document.createElement("div");
      slide.className = "carousel__slide";
      slide.innerHTML = `
        <img class="carousel__img" src="${safeAssetUrl(src)}" alt="${escapeHtml(title)}" loading="lazy"
          onerror="this.style.opacity=.25;this.alt='Imagen no disponible'">
      `;
      return slide;
    });

    slides.forEach(s => track.appendChild(s));

    const dots = document.createElement("div");
    dots.className = "carousel__dots";
    dots.innerHTML = imgs.map((_,i) => `<span class="dot ${i===0?"is-on":""}"></span>`).join("");

    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "carousel__nav carousel__nav--prev";
    prev.setAttribute("aria-label", "Anterior");
    prev.innerHTML = "‹";

    const next = document.createElement("button");
    next.type = "button";
    next.className = "carousel__nav carousel__nav--next";
    next.setAttribute("aria-label", "Siguiente");
    next.innerHTML = "›";

    const setNavState = () => {
      const idx = getActiveIndex(track);
      const dotEls = $$(".dot", dots);
      dotEls.forEach((d,i) => d.classList.toggle("is-on", i === idx));
      prev.disabled = idx <= 0;
      next.disabled = idx >= imgs.length - 1;
    };

    track.addEventListener("scroll", debounce(setNavState, 80), { passive: true });

    prev.addEventListener("click", () => {
      const idx = getActiveIndex(track);
      scrollToIndex(track, Math.max(0, idx - 1));
      setNavState();
    });

    next.addEventListener("click", () => {
      const idx = getActiveIndex(track);
      scrollToIndex(track, Math.min(imgs.length - 1, idx + 1));
      setNavState();
    });

    setNavState();

    wrap.appendChild(track);
    if (imgs.length > 1) {
      wrap.appendChild(dots);
      wrap.appendChild(prev);
      wrap.appendChild(next);
    }

    return wrap;
  }

  function getActiveIndex(track) {
    const w = track.clientWidth || 1;
    return Math.round(track.scrollLeft / w);
  }

  function scrollToIndex(track, idx) {
    const w = track.clientWidth || 1;
    track.scrollTo({ left: idx * w, behavior: "smooth" });
  }

  /* ---------------------------
     Product modal + cart
  --------------------------- */
  function openProductModal(p) {
    state.modalProduct = p;

    const title = getProductTitle(p);
    const desc = getProductDesc(p);
    const images = getProductImages(p);
    const priceCents = getProductPriceCents(p);
    const sizes = getSizes(p);

    dom.pmTitle.textContent = title;
    dom.pmDesc.textContent = desc || "—";
    dom.pmPrice.textContent = money(centsToMXN(priceCents));

    dom.pmSize.innerHTML = "";
    if (sizes.length) {
      for (const s of sizes) {
        const opt = document.createElement("option");
        opt.value = s;
        opt.textContent = s;
        dom.pmSize.appendChild(opt);
      }
    } else {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Única";
      dom.pmSize.appendChild(opt);
    }

    dom.pmQty.value = "1";

    dom.pmCarousel.innerHTML = "";
    dom.pmCarousel.appendChild(buildCarousel(images, title));

    openModal(dom.productModal);
  }

  function addToCart(p, size, qty) {
    const sku = getProductSku(p);
    const key = `${sku}__${size || ""}`;
    const existing = state.cart.find(it => it.key === key);

    if (existing) {
      existing.qty = clampQty(existing.qty + qty);
    } else {
      const images = getProductImages(p);
      state.cart.push({
        key,
        sku,
        size: size || "",
        qty: clampQty(qty),
        title: getProductTitle(p),
        img: images[0] || "",
        price_cents: getProductPriceCents(p),
      });
    }

    saveCart();
    renderCart();
    toast("Agregado al carrito");
  }

  function removeFromCart(key) {
    state.cart = state.cart.filter(it => it.key !== key);
    saveCart();
    renderCart();
  }

  function changeQty(key, delta) {
    const it = state.cart.find(x => x.key === key);
    if (!it) return;
    it.qty = clampQty(it.qty + delta);
    saveCart();
    renderCart();
  }

  function calcSubtotalCents() {
    return state.cart.reduce((a, it) => a + (Number(it.price_cents || 0) * Number(it.qty || 0)), 0);
  }

  function calcTotalCents() {
    return calcSubtotalCents() + Number(state.shippingQuoteCents || 0);
  }

  function renderCart() {
    dom.cartItems.innerHTML = "";

    if (!state.cart.length) {
      dom.cartItems.innerHTML = `<div class="hint">Tu carrito está vacío.</div>`;
      state.shippingQuoteCents = 0;
      dom.shippingLine.textContent = money(0);
      dom.cartSubtotal.textContent = money(0);
      dom.cartTotal.textContent = money(0);
      updateCartBadge();
      return;
    }

    for (const it of state.cart) {
      const row = document.createElement("div");
      row.className = "cartitem";
      row.innerHTML = `
        <img class="cartitem__img" src="${safeAssetUrl(it.img)}" alt="" loading="lazy"
          onerror="this.style.opacity=.25">
        <div>
          <p class="cartitem__title">${escapeHtml(it.title)} <span class="small">${it.size ? `· ${escapeHtml(it.size)}` : ""}</span></p>
          <div class="cartitem__meta">
            <div class="qty">
              <button type="button" aria-label="Menos">−</button>
              <span>${it.qty}</span>
              <button type="button" aria-label="Más">+</button>
            </div>
            <div>
              <b>${money(centsToMXN(Number(it.price_cents || 0) * Number(it.qty || 0)))}</b>
            </div>
          </div>
          <div style="display:flex; gap:10px; margin-top:8px;">
            <button class="btn btn--tiny btn--ghost" type="button" data-remove="1">Quitar</button>
          </div>
        </div>
      `;

      const [minusBtn, plusBtn] = $$("button[aria-label]", row);
      minusBtn.addEventListener("click", () => changeQty(it.key, -1));
      plusBtn.addEventListener("click", () => changeQty(it.key, +1));
      row.querySelector("[data-remove]").addEventListener("click", () => removeFromCart(it.key));

      dom.cartItems.appendChild(row);
    }

    const subtotal = calcSubtotalCents();
    dom.cartSubtotal.textContent = money(centsToMXN(subtotal));
    dom.shippingLine.textContent = money(centsToMXN(state.shippingQuoteCents || 0));
    dom.cartTotal.textContent = money(centsToMXN(calcTotalCents()));

    updateCartBadge();
  }

  /* ---------------------------
     Shipping quote
  --------------------------- */
  function setShippingMode(mode) {
    state.shippingMode = mode === "delivery" ? "delivery" : "pickup";

    if (state.shippingMode === "delivery") {
      dom.postalWrap.hidden = false;
      dom.shipHint.textContent = "Ingresa CP para cotizar";
    } else {
      dom.postalWrap.hidden = true;
      dom.shipHint.textContent = "Pickup seleccionado";
      state.shippingQuoteCents = 0;
      renderCart();
    }
  }

  async function quoteShipping() {
    const cp = (dom.postalCode.value || "").trim();
    state.postalCode = cp;

    if (state.shippingMode !== "delivery") return;

    if (!/^\d{5}$/.test(cp)) {
      toast("CP inválido (5 dígitos)");
      return;
    }

    const payload = {
      shipping_mode: "delivery",
      postal_code: cp,
      items: state.cart.map(it => ({ sku: it.sku, qty: it.qty, size: it.size })),
    };

    dom.quoteBtn.disabled = true;
    dom.quoteBtn.textContent = "Cotizando…";

    try {
      const r = await fetch(CONFIG.endpoints.quote, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await r.json().catch(() => null);
      if (!r.ok || !data) throw new Error(data?.error || "No quote");

      // Esperamos: { ok:true, quote:{ total_cents } }
      const cents = Number(data?.quote?.total_cents || 0);
      state.shippingQuoteCents = Math.max(0, Math.round(cents));
      dom.shipHint.textContent = "Cotización lista";
      toast("Envío cotizado");
      renderCart();
    } catch (e) {
      state.shippingQuoteCents = 0;
      dom.shipHint.textContent = "No se pudo cotizar";
      toast("No se pudo cotizar envío");
      renderCart();
    } finally {
      dom.quoteBtn.disabled = false;
      dom.quoteBtn.textContent = "Cotizar";
    }
  }

  /* ---------------------------
     Checkout
  --------------------------- */
  async function checkout() {
    if (!state.cart.length) {
      toast("Tu carrito está vacío");
      return;
    }

    dom.checkoutBtn.disabled = true;
    dom.checkoutMsg.hidden = true;

    const ship = state.shippingMode;
    const cp = (dom.postalCode.value || "").trim();
    const promo = (dom.promoCode.value || "").trim();

    const payload = {
      items: state.cart.map(it => ({ sku: it.sku, qty: it.qty, size: it.size })),
      shipping_mode: ship,
      postal_code: ship === "delivery" ? cp : "",
      promo_code: promo || "",
    };

    try {
      const r = await fetch(CONFIG.endpoints.checkout, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.url) throw new Error(data?.error || "Checkout failed");

      window.location.href = data.url;
    } catch (e) {
      dom.checkoutMsg.hidden = false;
      dom.checkoutMsg.textContent = "No se pudo iniciar el pago. Revisa /api/checkout (Netlify Function).";
      toast("Error al iniciar pago");
    } finally {
      dom.checkoutBtn.disabled = false;
    }
  }

  /* ---------------------------
     AI chat (optional)
  --------------------------- */
  function chatBubble(text, who = "bot") {
    const div = document.createElement("div");
    div.className = `bubble ${who === "me" ? "bubble--me" : "bubble--bot"}`;
    div.textContent = text;
    return div;
  }

  async function sendAi() {
    const text = (dom.aiInput.value || "").trim();
    if (!text) return;

    dom.aiOutput.appendChild(chatBubble(text, "me"));
    dom.aiOutput.scrollTop = dom.aiOutput.scrollHeight;
    dom.aiInput.value = "";

    try {
      const r = await fetch(CONFIG.endpoints.chat, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: text }] }),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok || !data?.reply) throw new Error(data?.error || "Chat failed");

      dom.aiOutput.appendChild(chatBubble(data.reply, "bot"));
      dom.aiOutput.scrollTop = dom.aiOutput.scrollHeight;
    } catch (e) {
      dom.aiOutput.appendChild(chatBubble("No pude responder (API/Key). Pero tu tienda sigue funcionando.", "bot"));
      dom.aiOutput.scrollTop = dom.aiOutput.scrollHeight;
    }
  }

  /* ---------------------------
     Cookies + Pixel Gate
  --------------------------- */
  const COOKIE_KEY = "scorestore_cookie_consent_v1"; // "accepted" | "rejected"

  function maybeShowCookieBanner() {
    const v = localStorage.getItem(COOKIE_KEY);
    if (v === "accepted") {
      enableTracking();
      return;
    }
    if (v === "rejected") return;

    dom.cookieBanner.hidden = false;
  }

  function enableTracking() {
    const id = CONFIG.metaPixelId;
    if (!id) return;

    /* eslint-disable */
    !(function(f,b,e,v,n,t,s){
      if(f.fbq)return; n=f.fbq=function(){ n.callMethod ?
        n.callMethod.apply(n,arguments) : n.queue.push(arguments) };
      if(!f._fbq)f._fbq=n; n.push=n; n.loaded=!0; n.version='2.0';
      n.queue=[]; t=b.createElement(e); t.async=!0;
      t.src=v; s=b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t,s)
    })(window, document,'script','https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', id);
    fbq('track', 'PageView');
    /* eslint-enable */
  }

  /* ---------------------------
     Legal
  --------------------------- */
  function openLegal(kind) {
    const isPrivacy = kind === "privacy";
    dom.legalTitle.textContent = isPrivacy ? "Privacidad" : "Términos";
    dom.legalBody.innerHTML = isPrivacy
      ? `
        <b>Privacidad</b><br/><br/>
        Guardamos datos mínimos necesarios para operar la tienda (carrito local y checkout).<br/>
        Si aceptas cookies, se puede habilitar medición (pixel). Puedes rechazar sin afectar compras.
      `
      : `
        <b>Términos</b><br/><br/>
        Compras procesadas por Stripe Checkout. OXXO disponible cuando Stripe lo habilita para tu cuenta.<br/>
        Los tiempos de envío dependen de la cotización y la paquetería.
      `;
    openModal(dom.legalModal);
  }

  /* ---------------------------
     Events
  --------------------------- */
  function scrollTo(sel) {
    const el = $(sel);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function bindEvents() {
    dom.appVersionLabel.textContent = APP_VERSION;

    dom.overlay.addEventListener("click", () => {
      [dom.sideMenu, dom.cartDrawer, dom.productModal, dom.aiModal, dom.legalModal].forEach(el => {
        if (el && !el.hidden) el.hidden = true;
      });
      hideOverlay();
    });

    // menu
    dom.openMenuBtn.addEventListener("click", () => openDrawer(dom.sideMenu));
    dom.closeMenuBtn.addEventListener("click", () => closeDrawer(dom.sideMenu));
    dom.navOpenCart.addEventListener("click", () => {
      closeDrawer(dom.sideMenu);
      openDrawer(dom.cartDrawer);
      renderCart();
    });
    dom.navOpenAi.addEventListener("click", () => {
      closeDrawer(dom.sideMenu);
      openModal(dom.aiModal);
    });
    $$(".navitem[data-scroll]", dom.sideMenu).forEach(btn => {
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-scroll");
        closeDrawer(dom.sideMenu);
        scrollTo(target);
      });
    });

    // hero scroll
    dom.scrollToCategoriesBtn.addEventListener("click", () => scrollTo("#categories"));
    dom.scrollToCatalogBtn.addEventListener("click", () => scrollTo("#catalog"));

    // search / sort
    dom.searchInput.addEventListener("input", debounce(() => {
      state.search = (dom.searchInput.value || "").trim();
      renderProducts(true);
    }, 200));

    dom.sortSelect.addEventListener("change", () => {
      state.sort = dom.sortSelect.value || "featured";
      renderProducts(true);
    });

    // filters
    dom.clearCategoryBtn.addEventListener("click", () => {
      state.activeSectionId = null;
      dom.activeFilterRow.hidden = true;
      renderProducts(true);
      toast("Mostrando todo");
    });

    dom.clearFilterBtn.addEventListener("click", () => {
      state.activeSectionId = null;
      dom.activeFilterRow.hidden = true;
      renderProducts(true);
    });

    // cart open/close
    dom.openCartBtn.addEventListener("click", () => {
      openDrawer(dom.cartDrawer);
      renderCart();
    });
    dom.closeCartBtn.addEventListener("click", () => closeDrawer(dom.cartDrawer));

    // shipping mode radios
    $$('input[name="shipMode"]').forEach(r => {
      r.addEventListener("change", () => setShippingMode(r.value));
    });

    dom.quoteBtn.addEventListener("click", quoteShipping);
    dom.postalCode.addEventListener("input", debounce(() => {
      if (state.shippingMode === "delivery" && /^\d{5}$/.test((dom.postalCode.value||"").trim())) {
        quoteShipping();
      }
    }, 500));

    // checkout
    dom.checkoutBtn.addEventListener("click", checkout);

    // product modal
    dom.pmClose.addEventListener("click", () => closeModal(dom.productModal));
    dom.pmAdd.addEventListener("click", () => {
      if (!state.modalProduct) return;
      const size = dom.pmSize.value || "";
      const qty = clampQty(dom.pmQty.value);
      addToCart(state.modalProduct, size, qty);
      closeModal(dom.productModal);
      openDrawer(dom.cartDrawer);
    });

    // AI
    dom.openAiBtn.addEventListener("click", () => openModal(dom.aiModal));
    dom.aiClose.addEventListener("click", () => closeModal(dom.aiModal));
    dom.aiSendBtn.addEventListener("click", sendAi);
    dom.aiInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendAi();
    });

    // legal
    dom.openLegalBtn.addEventListener("click", () => openLegal("terms"));
    dom.openPrivacyBtn.addEventListener("click", () => openLegal("privacy"));
    dom.legalClose.addEventListener("click", () => closeModal(dom.legalModal));

    // cookies
    dom.cookieAccept.addEventListener("click", () => {
      localStorage.setItem(COOKIE_KEY, "accepted");
      dom.cookieBanner.hidden = true;
      enableTracking();
      toast("Cookies aceptadas");
    });
    dom.cookieReject.addEventListener("click", () => {
      localStorage.setItem(COOKIE_KEY, "rejected");
      dom.cookieBanner.hidden = true;
      toast("Sin tracking");
    });

    // ESC
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      [dom.sideMenu, dom.cartDrawer, dom.productModal, dom.aiModal, dom.legalModal].forEach(el => {
        if (el && !el.hidden) el.hidden = true;
      });
      hideOverlay();
    });
  }

  /* ---------------------------
     HTML escaping
  --------------------------- */
  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /* ---------------------------
     Boot
  --------------------------- */
  async function boot() {
    dom.appVersionLabel.textContent = APP_VERSION;
    updateCartBadge();
    bindEvents();
    renderCart();
    maybeShowCookieBanner();

    // ✅ REGISTRO DEL SERVICE WORKER (BLOQUE 2)
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    await loadCatalog();
  }

  boot();
})();
