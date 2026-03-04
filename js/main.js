/* =========================================================
   SCORE STORE — Frontend (Repo-alineado + Anti-404 assets + Carousel Snap)
   Build: 2026-03-04
   ========================================================= */

(() => {
  "use strict";

  const APP_VERSION = window.__APP_VERSION__ || "2026.03.04.SCORESTORE";

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

  const safeUrl = (u) => {
    const s = String(u || "").trim();
    if (!s) return "";
    if (s.startsWith("http://") || s.startsWith("https://")) return s;
    if (s.startsWith("/")) return s;
    return s;
  };

  const escapeHtml = (s) =>
    String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  // =========================================================
  // DOM
  // =========================================================
  const splash = $("#splash");
  const overlay = $("#overlay");

  const sideMenu = $("#sideMenu");
  const openMenuBtn = $("#openMenuBtn");
  const closeMenuBtn = $("#closeMenuBtn");

  const cartDrawer = $("#cartDrawer");
  const openCartBtn = $("#openCartBtn");
  const closeCartBtn = $("#closeCartBtn");
  const navOpenCart = $("#navOpenCart");

  const assistantModal = $("#assistantModal");
  const openAssistantBtn = $("#openAssistantBtn");
  const floatingAssistantBtn = $("#floatingAssistantBtn");
  const navOpenAssistant = $("#navOpenAssistant");
  const assistantClose = $("#assistantClose");
  const assistantOutput = $("#assistantOutput");
  const assistantInput = $("#assistantInput");
  const assistantSendBtn = $("#assistantSendBtn");

  const scrollToCategoriesBtn = $("#scrollToCategoriesBtn");

  const categoryGrid = $("#categoryGrid");
  const categoryHint = $("#categoryHint");

  const catalogCarouselSection = $("#catalogCarouselSection");
  const carouselTitle = $("#carouselTitle");
  const scrollLeftBtn = $("#scrollLeftBtn");
  const scrollRightBtn = $("#scrollRightBtn");

  const productGrid = $("#productGrid");
  const statusRow = $("#statusRow");

  const searchInput = $("#searchInput");
  const mobileSearchBtn = $("#mobileSearchBtn");
  const mobileSearchWrap = $("#mobileSearchWrap");
  const mobileSearchInput = $("#mobileSearchInput");
  const closeMobileSearchBtn = $("#closeMobileSearchBtn");
  const sortSelect = $("#sortSelect");

  const menuSearchInput = $("#menuSearchInput");

  const promoBar = $("#promoBar");
  const promoBarText = $("#promoBarText");
  const promoBarClose = $("#promoBarClose");

  const activeFilterRow = $("#activeFilterRow");
  const activeFilterLabel = $("#activeFilterLabel");
  const clearFilterBtn = $("#clearFilterBtn");

  const cartCount = $("#cartCount");
  const cartItemsEl = $("#cartItems");
  const cartSubtotalEl = $("#cartSubtotal");
  const shippingLineEl = $("#shippingLine");
  const discountLineWrap = $("#discountLineWrap");
  const discountLineEl = $("#discountLine");
  const cartTotalEl = $("#cartTotal");

  const shipHint = $("#shipHint");
  const shippingNote = $("#shippingNote");
  const postalWrap = $("#postalWrap");
  const postalCode = $("#postalCode");
  const quoteBtn = $("#quoteBtn");

  const promoCode = $("#promoCode");
  const applyPromoBtn = $("#applyPromoBtn");

  const checkoutBtn = $("#checkoutBtn");
  const continueShoppingBtn = $("#continueShoppingBtn");
  const checkoutMsg = $("#checkoutMsg");
  const checkoutLoader = $("#checkoutLoader");

  const productModal = $("#productModal");
  const pmBackBtn = $("#pmBackBtn");
  const pmClose = $("#pmClose");
  const pmTitle = $("#pmTitle");
  const pmCarousel = $("#pmCarousel");
  const pmChips = $("#pmChips");
  const pmPrice = $("#pmPrice");
  const pmDesc = $("#pmDesc");
  const pmShareBtn = $("#pmShareBtn");
  const pmAdd = $("#pmAdd");
  const pmSizePills = $("#pmSizePills");
  const pmQtyDec = $("#pmQtyDec");
  const pmQtyInc = $("#pmQtyInc");
  const pmQtyDisplay = $("#pmQtyDisplay");
  const pmStockBadge = $("#pmStockBadge");

  const sizeGuideModal = $("#sizeGuideModal");
  const openSizeGuideBtn = $("#openSizeGuideBtn");
  const closeSizeGuideBtn = $("#closeSizeGuideBtn");
  const understandSizeBtn = $("#understandSizeBtn");

  const cookieBanner = $("#cookieBanner");
  const cookieAccept = $("#cookieAccept");
  const cookieReject = $("#cookieReject");

  const scrollTopBtn = $("#scrollTopBtn");
  const toast = $("#toast");
  const appVersionLabel = $("#appVersionLabel");

  const salesNotification = $("#salesNotification");
  const salesName = $("#salesName");
  const salesAction = $("#salesAction");

  // =========================================================
  // Storage
  // =========================================================
  const STORAGE_KEYS = {
    cart: "scorestore_cart_v2_pro",
    ship: "scorestore_ship_v2",
    consent: "scorestore_consent_v2",
    carousel_used: "scorestore_carousel_used",
  };

  // =========================================================
  // Config
  // =========================================================
  const CATEGORY_CONFIG = [
    { uiId: "BAJA1000", name: "BAJA 1000", logo: "assets/logo-baja1000.webp", mapFrom: ["BAJA1000", "BAJA_1000", "EDICION_2025", "OTRAS_EDICIONES"] },
    { uiId: "BAJA500",  name: "BAJA 500",  logo: "assets/logo-baja500.webp",  mapFrom: ["BAJA500", "BAJA_500"] },
    { uiId: "BAJA400",  name: "BAJA 400",  logo: "assets/logo-baja400.webp",  mapFrom: ["BAJA400", "BAJA_400"] },
    { uiId: "SF250",    name: "SAN FELIPE 250", logo: "assets/logo-sf250.webp", mapFrom: ["SF250", "SF_250"] },
  ];

  const SHIPPING_LABELS = {
    pickup: "Recoger en fábrica (Tijuana)",
    envia_mx: "Envío México (Envía.com)",
    envia_us: "Envío USA (Envía.com)",
  };

  // =========================================================
  // State
  // =========================================================
  let catalog = null;
  let products = [];
  let promosData = null;
  let activePromo = null;

  let activeCategory = null;
  let searchQuery = "";
  let sortMode = "featured";

  let cart = [];
  let shipping = { mode: "pickup", postal_code: "", quote: null };

  let currentProduct = null;
  let selectedSize = "";
  let selectedQty = 1;

  // =========================================================
  // UI Helpers
  // =========================================================
  const showToast = (msg, type = "ok") => {
    if (!toast) return;
    toast.hidden = false;
    toast.setAttribute("data-type", type);
    toast.textContent = String(msg || "");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { toast.hidden = true; }, 2800);
  };

  const openLayer = (el) => {
    if (!el) return;
    el.hidden = false;
    overlay && (overlay.hidden = false);
    document.documentElement.classList.add("no-scroll");
    setTimeout(() => el.classList.add("is-open"), 0);
  };

  const closeLayer = (el) => {
    if (!el) return;
    el.classList.remove("is-open");
    setTimeout(() => {
      el.hidden = true;
      const anyOpen =
        !sideMenu?.hidden ||
        !cartDrawer?.hidden ||
        !assistantModal?.hidden ||
        !productModal?.hidden ||
        !sizeGuideModal?.hidden;
      if (!anyOpen) {
        overlay && (overlay.hidden = true);
        document.documentElement.classList.remove("no-scroll");
      }
    }, 220);
  };

  // =========================================================
  // Asset fallback (real fix for your repo filenames)
  // =========================================================
  const buildAssetCandidates = (src) => {
    const s0 = safeUrl(src);
    if (!s0) return [];

    // only adjust local assets
    const isLocal = s0.startsWith("assets/") || s0.startsWith("/assets/");
    if (!isLocal) return [s0];

    const s = s0.startsWith("/assets/") ? s0.slice(1) : s0;

    const variants = new Set();
    const add = (x) => { if (x && typeof x === "string") variants.add(x); };

    add(s);

    // folder alias: BAJA_400 -> BAJA400, BAJA_500 -> BAJA500, SF_250 -> SF250
    add(s.replace("assets/BAJA_400/", "assets/BAJA400/"));
    add(s.replace("assets/BAJA_500/", "assets/BAJA500/"));
    add(s.replace("assets/SF_250/", "assets/SF250/"));

    // remove accidental double spaces and " - " weirdness
    add(s.replaceAll("  ", " "));
    add(s.replaceAll("- ", "-").replaceAll(" -", "-"));

    // if filename accidentally has a space after a dash like "cafe- oscuro"
    add(s.replaceAll("- ", "-"));

    // jpg.webp variant
    if (s.endsWith(".webp") && !s.endsWith(".jpg.webp")) {
      add(s.replace(/\.webp$/i, ".jpg.webp"));
    }

    // Some of your real files include " - " space; try insert
    add(s.replaceAll("-", "- "));

    // also accept original with leading slash
    return Array.from(variants).map((x) => (s0.startsWith("/assets/") ? `/${x}` : x));
  };

  const bindImgFallback = (img, primarySrc) => {
    if (!img) return;
    const cands = buildAssetCandidates(primarySrc);
    if (!cands.length) return;

    img.dataset.ci = "0";
    img.dataset.cands = JSON.stringify(cands);

    img.onerror = () => {
      try {
        const arr = JSON.parse(img.dataset.cands || "[]");
        let i = Number(img.dataset.ci || "0");
        i++;
        if (i >= arr.length) return; // stop
        img.dataset.ci = String(i);
        img.src = arr[i];
      } catch {}
    };

    // set initial src to first candidate
    img.src = cands[0];
  };

  // =========================================================
  // Data helpers
  // =========================================================
  const normalizeSectionIdToUi = (sectionId) => {
    const sid = String(sectionId || "").trim();
    const found = CATEGORY_CONFIG.find((c) => c.mapFrom.includes(sid));
    return found ? found.uiId : null;
  };

  const getLogoForSection = (uiId) => {
    const found = CATEGORY_CONFIG.find((c) => c.uiId === uiId);
    return found?.logo || "assets/logo-baja1000.webp";
  };

  const inferCollection = (p) => {
    const sid = String(p?.sectionId || p?.section_id || p?.section || "").trim();
    if (sid === "EDICION_2025") return "Edición 2025";
    if (sid === "OTRAS_EDICIONES") return "Ediciones Clásicas";
    return "";
  };

  const normalizeProduct = (p) => {
    const sku = String(p?.sku || p?.id || "").trim();
    const title = String(p?.title || p?.name || "Producto Oficial").trim();

    const priceCents = Number.isFinite(Number(p?.price_cents))
      ? Math.round(Number(p.price_cents))
      : Number.isFinite(Number(p?.priceCents))
        ? Math.round(Number(p.priceCents))
        : 0;

    const images = Array.isArray(p?.images) ? p.images : p?.img ? [p.img] : [];
    const sizes = Array.isArray(p?.sizes) && p.sizes.length ? p.sizes : ["S", "M", "L", "XL", "XXL"];
    const rawSection = String(p?.sectionId || p?.categoryId || p?.section || "").trim();

    const img = images[0] ? safeUrl(images[0]) : "";

    return {
      sku,
      id: sku,
      title,
      description: String(p?.description || "").trim(),
      priceCents,
      images: images.map(safeUrl).filter(Boolean),
      img,
      sizes: sizes.map((s) => String(s || "").trim()).filter(Boolean),
      rawSection,
      uiSection: normalizeSectionIdToUi(rawSection) || "BAJA1000",
      collection: inferCollection(p),
      rank: Number.isFinite(Number(p?.rank)) ? Number(p.rank) : 999,
      stock: Number.isFinite(Number(p?.stock)) ? Number(p.stock) : null,
    };
  };

  const fetchJsonFirstOk = async (urls) => {
    const list = Array.isArray(urls) ? urls : [];
    let lastErr = null;
    for (const u of list) {
      try {
        const res = await fetch(u, { headers: { "cache-control": "no-store" } });
        if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
        const j = await res.json().catch(() => null);
        if (j) return j;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("No se pudo cargar JSON");
  };

  const fetchCatalog = async () => {
    const cv = encodeURIComponent(APP_VERSION);
    return await fetchJsonFirstOk([`/.netlify/functions/catalog?cv=${cv}`, `data/catalog.json?cv=${cv}`]);
  };

  const fetchPromos = async () => {
    const cv = encodeURIComponent(APP_VERSION);
    try {
      promosData = await fetchJsonFirstOk([`/.netlify/functions/promos?cv=${cv}`, `data/promos.json?cv=${cv}`]);
      if (!promosData || !Array.isArray(promosData.rules)) promosData = { rules: [] };
    } catch { promosData = { rules: [] }; }
  };

  // =========================================================
  // Carousel control (snap real + hint + arrows)
  // =========================================================
  const ensureCarouselUX = () => {
    if (!productGrid) return;

    productGrid.classList.add("carousel-track");
    productGrid.style.scrollSnapType = "x mandatory";
    productGrid.style.scrollBehavior = "smooth";
    productGrid.style.overscrollBehaviorX = "contain";

    // iOS inercia más controlada (evita “derrape”)
    productGrid.style.webkitOverflowScrolling = "auto";

    // Hint pro + fades
    let hint = $("#carouselHint");
    if (!hint && catalogCarouselSection) {
      hint = document.createElement("div");
      hint.id = "carouselHint";
      hint.className = "carousel-hint";
      hint.hidden = true;
      hint.innerHTML = `Desliza <span class="carousel-hint__arrow">→</span>`;
      const host = carouselTitle?.parentElement || catalogCarouselSection;
      host.appendChild(hint);
    }

    if (catalogCarouselSection && !catalogCarouselSection.querySelector(".carousel-fade--left")) {
      const left = document.createElement("div");
      left.className = "carousel-fade carousel-fade--left";
      const right = document.createElement("div");
      right.className = "carousel-fade carousel-fade--right";
      catalogCarouselSection.style.position = "relative";
      catalogCarouselSection.appendChild(left);
      catalogCarouselSection.appendChild(right);
    }

    const updateHint = () => {
      const used = localStorage.getItem(STORAGE_KEYS.carousel_used) === "1";
      const cards = $$(".card", productGrid);
      if (hint) hint.hidden = used || cards.length <= 1;
    };

    const getOffsets = () => $$(".card", productGrid).map((c) => c.offsetLeft);

    const snapToNearest = () => {
      const offsets = getOffsets();
      if (!offsets.length) return;
      const x = productGrid.scrollLeft;

      let best = offsets[0];
      let bestDist = Math.abs(x - best);
      for (const o of offsets) {
        const d = Math.abs(x - o);
        if (d < bestDist) { bestDist = d; best = o; }
      }
      productGrid.scrollTo({ left: best, behavior: "smooth" });
    };

    const markUsed = () => {
      try { localStorage.setItem(STORAGE_KEYS.carousel_used, "1"); } catch {}
      updateHint();
    };

    // snap al “soltar”
    const snapOnScrollEnd = debounce(() => {
      snapToNearest();
      markUsed();
    }, 120);

    productGrid.addEventListener("scroll", snapOnScrollEnd, { passive: true });
    productGrid.addEventListener("pointerdown", markUsed, { passive: true });
    productGrid.addEventListener("touchstart", markUsed, { passive: true });

    // Arrows = salto por tarjeta (si existen)
    const jump = (dir) => {
      const offsets = getOffsets();
      if (!offsets.length) return;
      const x = productGrid.scrollLeft;

      let idx = 0;
      for (let i = 0; i < offsets.length; i++) {
        if (Math.abs(x - offsets[i]) < Math.abs(x - offsets[idx])) idx = i;
      }
      const next = clamp(idx + dir, 0, offsets.length - 1);
      productGrid.scrollTo({ left: offsets[next], behavior: "smooth" });
      markUsed();
    };

    scrollLeftBtn?.addEventListener("click", () => jump(-1));
    scrollRightBtn?.addEventListener("click", () => jump(+1));

    updateHint();
  };

  // =========================================================
  // Sorting + filter UI
  // =========================================================
  const applySort = (list) => {
    const arr = Array.isArray(list) ? [...list] : [];
    if (sortMode === "price_asc") return arr.sort((a, b) => a.priceCents - b.priceCents);
    if (sortMode === "price_desc") return arr.sort((a, b) => b.priceCents - a.priceCents);
    if (sortMode === "name_asc") return arr.sort((a, b) => a.title.localeCompare(b.title));
    return arr.sort((a, b) => (a.rank - b.rank) || a.title.localeCompare(b.title));
  };

  const updateFilterUI = () => {
    const catLabel = activeCategory ? (CATEGORY_CONFIG.find((c) => c.uiId === activeCategory)?.name || activeCategory) : "";
    const hasSearch = !!String(searchQuery || "").trim();

    if (activeFilterRow && activeFilterLabel && clearFilterBtn) {
      if (activeCategory || hasSearch) {
        activeFilterRow.hidden = false;
        activeFilterLabel.textContent = `${activeCategory ? `Colección: ${catLabel}` : ""}${activeCategory && hasSearch ? " · " : ""}${hasSearch ? `Búsqueda: ${searchQuery}` : ""}`;
      } else {
        activeFilterRow.hidden = true;
      }
    }

    if (carouselTitle) carouselTitle.textContent = activeCategory ? `Catálogo — ${catLabel}` : "Catálogo";
  };

  // =========================================================
  // Render categories
  // =========================================================
  const renderCategories = () => {
    if (!categoryGrid) return;
    categoryGrid.innerHTML = "";

    const counts = new Map();
    products.forEach((p) => counts.set(p.uiSection, (counts.get(p.uiSection) || 0) + 1));

    const frag = document.createDocumentFragment();

    for (const cat of CATEGORY_CONFIG) {
      const count = counts.get(cat.uiId) || 0;

      const card = document.createElement("button");
      card.className = "catcard hover-fx";
      card.type = "button";
      card.setAttribute("data-cat", cat.uiId);
      card.setAttribute("aria-label", `Explorar ${cat.name}`);

      card.innerHTML = `
        <div class="catcard__inner">
          <img class="catcard__logo" alt="${escapeHtml(cat.name)}" loading="lazy" decoding="async" style="height:auto">
          <div class="catcard__meta">
            <div class="catcard__title tech-text">${escapeHtml(cat.name)}</div>
            <div class="catcard__sub">${count} productos</div>
          </div>
          <div class="catcard__chev">→</div>
        </div>
      `;

      const imgEl = $(".catcard__logo", card);
      bindImgFallback(imgEl, cat.logo);

      card.addEventListener("click", () => {
        activeCategory = cat.uiId;
        searchQuery = "";
        sortMode = "featured";

        if (searchInput) searchInput.value = "";
        if (mobileSearchInput) mobileSearchInput.value = "";
        if (menuSearchInput) menuSearchInput.value = "";

        updateFilterUI();
        renderProducts();

        if (categoryHint) categoryHint.hidden = true;
        if (catalogCarouselSection) catalogCarouselSection.hidden = false;

        catalogCarouselSection?.scrollIntoView({ behavior: "smooth", block: "start" });
      });

      frag.appendChild(card);
    }

    categoryGrid.appendChild(frag);
  };

  // =========================================================
  // Render products
  // =========================================================
  const renderProducts = () => {
    if (!productGrid) return;

    const q = String(searchQuery || "").trim().toLowerCase();
    let list = products;

    if (activeCategory) list = list.filter((p) => p.uiSection === activeCategory);
    if (q) list = list.filter((p) => `${p.title} ${p.sku} ${p.collection}`.toLowerCase().includes(q));

    list = applySort(list);

    if (statusRow) {
      if (!activeCategory && !q) statusRow.textContent = "Selecciona una colección para ver productos.";
      else statusRow.textContent = `${list.length} productos disponibles`;
    }

    productGrid.innerHTML = "";

    if (list.length === 0) {
      productGrid.innerHTML = `<div class="hint" style="padding:18px; text-align:center;">Sin resultados para tu búsqueda.</div>`;
      catalogCarouselSection && (catalogCarouselSection.hidden = false);
      return;
    }

    const frag = document.createDocumentFragment();

    for (const p of list) {
      const card = document.createElement("div");
      card.className = "card hover-fx";
      card.style.scrollSnapAlign = "start";
      card.style.scrollSnapStop = "always";
      card.setAttribute("data-sku", p.sku);

      card.innerHTML = `
        <div class="card__img">
          <img class="prod-img" alt="${escapeHtml(p.title)}" loading="lazy" decoding="async" width="400" height="500" style="object-fit:cover;">
        </div>
        <div class="card__body">
          <div class="card__title tech-text">${escapeHtml(p.title)}</div>
          <div class="card__meta">
            <span class="pill pill--logo">
              <img class="pill-logo" alt="Logo" width="30" height="16" style="height:auto; width:auto;">
            </span>
            ${p.collection ? `<span class="pill pill--red">${escapeHtml(p.collection)}</span>` : ""}
          </div>
          <div class="card__price">${money(p.priceCents)}</div>
          <button class="btn btn--black card__action-btn hover-fx" type="button" aria-label="Ver detalles y comprar">Ver Detalles y Comprar</button>
        </div>
      `;

      const mainImg = $(".prod-img", card);
      bindImgFallback(mainImg, p.img);

      const logo = $(".pill-logo", card);
      bindImgFallback(logo, getLogoForSection(p.uiSection));

      card.querySelector(".card__action-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        openProduct(p.sku);
      });
      card.addEventListener("click", () => openProduct(p.sku));

      frag.appendChild(card);
    }

    productGrid.appendChild(frag);
    catalogCarouselSection && (catalogCarouselSection.hidden = false);

    ensureCarouselUX();
  };

  // =========================================================
  // Scarcity
  // =========================================================
  const getScarcityText = (p) => {
    const stock = Number(p?.stock);
    if (!Number.isFinite(stock)) return "";
    if (stock <= 0) return "⏳ Sin stock por ahora. Confirma por WhatsApp si quieres apartar.";
    if (stock <= 3) return "🔥 Últimas piezas disponibles.";
    return "";
  };

  // =========================================================
  // Modal
  // =========================================================
  const openProduct = (sku) => {
    const p = products.find((x) => x.sku === sku);
    if (!p) return;

    currentProduct = p;
    selectedQty = 1;

    if (pmQtyDisplay) pmQtyDisplay.textContent = selectedQty;
    if (pmTitle) pmTitle.textContent = p.title;
    if (pmPrice) pmPrice.textContent = money(p.priceCents);

    if (pmStockBadge) {
      const stock = Number(p.stock);
      if (Number.isFinite(stock)) {
        pmStockBadge.hidden = false;
        pmStockBadge.textContent = stock > 0 ? `Stock: ${stock}` : "AGOTADO";
        pmStockBadge.style.borderColor = stock > 0 ? "rgba(0,0,0,0.1)" : "var(--red)";
      } else pmStockBadge.hidden = true;
    }

    if (pmDesc) {
      const scarcity = getScarcityText(p);
      pmDesc.innerHTML = `<p>${escapeHtml(p.description || "Merch oficial Score Store.")}</p>${scarcity ? `<p style="color:var(--red); font-weight:bold; margin-top:10px;">${scarcity}</p>` : ""}`;
    }

    if (pmChips) {
      pmChips.innerHTML = `<span class="pill pill--logo"><img class="pm-pill-logo" width="30" height="16" alt="Logo" style="height:auto; width:auto;"></span>`;
      const logo = $(".pm-pill-logo", pmChips);
      bindImgFallback(logo, getLogoForSection(p.uiSection));
      if (p.collection) pmChips.innerHTML += `<span class="pill pill--red">${escapeHtml(p.collection)}</span>`;
    }

    if (pmSizePills) {
      pmSizePills.innerHTML = "";
      selectedSize = "";
      p.sizes.forEach((s) => {
        const btn = document.createElement("button");
        btn.className = "size-pill";
        btn.textContent = String(s || "").trim();

        const stock = Number(p.stock);
        const isOutOfStock = Number.isFinite(stock) && stock <= 0;

        if (isOutOfStock) {
          btn.classList.add("out-of-stock");
          btn.setAttribute("aria-disabled", "true");
          btn.title = "Sin stock";
          btn.onclick = () => showToast("Por ahora no hay stock registrado. Si necesitas apartar, contáctanos por WhatsApp.", "error");
        } else {
          btn.onclick = () => {
            $$(".size-pill").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            selectedSize = String(s || "").trim();
          };
        }

        pmSizePills.appendChild(btn);
      });
    }

    if (pmCarousel) {
      const imgs = p.images.length ? p.images : p.img ? [p.img] : [];
      pmCarousel.innerHTML = `
        <div class="pm__track" id="pmTrack" style="scroll-snap-type:x mandatory; overflow-x:auto; display:flex; gap:12px;">
          ${imgs.map(() => `<img class="pm-img" width="400" height="500" loading="lazy" decoding="async" alt="${escapeHtml(p.title)}"
            style="scroll-snap-align:start; scroll-snap-stop:always; flex:0 0 100%; object-fit:cover; border-radius:18px;">`).join("")}
        </div>
        ${imgs.length > 1 ? `<div class="pm__dots">${imgs.map((_, i) => `<span class="pm__dot ${i === 0 ? "active" : ""}"></span>`).join("")}</div>` : ""}
      `;

      const track = pmCarousel.querySelector("#pmTrack");
      const pmImgs = $$(".pm-img", pmCarousel);
      pmImgs.forEach((im, i) => bindImgFallback(im, imgs[i]));

      const dots = pmCarousel.querySelectorAll(".pm__dot");

      dots.forEach((d, i) => {
        d.addEventListener("click", () => {
          track?.scrollTo({ left: i * track.clientWidth, behavior: "smooth" });
          dots.forEach((x) => x.classList.remove("active"));
          d.classList.add("active");
        });
      });

      const snapPm = debounce(() => {
        const idx = Math.round((track?.scrollLeft || 0) / (track?.clientWidth || 1));
        track?.scrollTo({ left: idx * (track?.clientWidth || 1), behavior: "smooth" });
      }, 120);

      track?.addEventListener(
        "scroll",
        () => {
          const idx = Math.round(track.scrollLeft / (track.clientWidth || 1));
          dots.forEach((x, i) => x.classList.toggle("active", i === idx));
          snapPm();
        },
        { passive: true }
      );
    }

    openLayer(productModal);
  };

  // =========================================================
  // Cart
  // =========================================================
  const loadCart = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.cart);
      const parsed = raw ? JSON.parse(raw) : null;
      cart = Array.isArray(parsed) ? parsed : [];
    } catch { cart = []; }
    if (cartCount) cartCount.textContent = String(cart.reduce((a, it) => a + Number(it.qty || 0), 0));
  };

  const saveCart = () => {
    try { localStorage.setItem(STORAGE_KEYS.cart, JSON.stringify(cart)); } catch {}
    if (cartCount) cartCount.textContent = String(cart.reduce((a, it) => a + Number(it.qty || 0), 0));
  };

  const loadShipping = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ship);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object") shipping = { ...shipping, ...parsed };
    } catch {}
  };

  const saveShipping = () => {
    try { localStorage.setItem(STORAGE_KEYS.ship, JSON.stringify(shipping)); } catch {}
  };

  const computeSubtotal = () => cart.reduce((sum, it) => sum + Number(it.priceCents || 0) * Number(it.qty || 0), 0);

  const computeDiscount = (subtotalCents) => {
    if (!activePromo) return 0;
    const type = String(activePromo.type || "").toLowerCase();
    if (type === "percent") {
      const raw = Number(activePromo.value || 0);
      const frac = clamp(raw > 1 ? raw / 100 : raw, 0, 1);
      return Math.round(subtotalCents * frac);
    }
    if (type === "fixed_mxn") return Math.round(Number(activePromo.value || 0) * 100);
    return 0;
  };

  const computeShippingCents = () => {
    if (activePromo && String(activePromo.type || "").toLowerCase() === "free_shipping") return 0;
    const cents = Number(shipping?.quote?.amount_cents);
    if (shipping.mode === "pickup") return 0;
    return Number.isFinite(cents) ? Math.max(0, Math.round(cents)) : 0;
  };

  const refreshTotals = () => {
    const subtotal = computeSubtotal();
    const discount = computeDiscount(subtotal);
    const shippingCents = computeShippingCents();
    const total = Math.max(0, subtotal - discount + shippingCents);

    if (cartSubtotalEl) cartSubtotalEl.textContent = money(subtotal);
    if (discountLineWrap && discountLineEl) {
      if (discount > 0) {
        discountLineWrap.hidden = false;
        discountLineEl.textContent = `-${money(discount)}`;
      } else discountLineWrap.hidden = true;
    }
    if (shippingLineEl) shippingLineEl.textContent = money(shippingCents);
    if (cartTotalEl) cartTotalEl.textContent = money(total);

    if (checkoutBtn) checkoutBtn.disabled = cart.length === 0;
  };

  const renderCart = () => {
    if (!cartItemsEl) return;
    cartItemsEl.innerHTML = "";

    if (cart.length === 0) {
      cartItemsEl.innerHTML = `<div class="hint" style="padding:14px;">Tu carrito está vacío.</div>`;
      refreshTotals();
      return;
    }

    const frag = document.createDocumentFragment();

    for (const it of cart) {
      const row = document.createElement("div");
      row.className = "cartitem";
      row.innerHTML = `
        <div class="cartitem__meta">
          <div class="cartitem__title">${escapeHtml(it.title || it.sku)}</div>
          <div class="cartitem__sub">${escapeHtml(it.sku)} ${it.size ? `· Talla: ${escapeHtml(it.size)}` : ""}</div>
        </div>
        <div class="cartitem__right">
          <div class="cartitem__price">${money(it.priceCents)}</div>
          <div class="cartitem__qty">
            <button class="iconbtn iconbtn--dark" data-act="dec" aria-label="Disminuir">−</button>
            <span class="cartitem__qtynum">${Number(it.qty || 1)}</span>
            <button class="iconbtn iconbtn--dark" data-act="inc" aria-label="Aumentar">+</button>
          </div>
          <button class="iconbtn" data-act="del" aria-label="Eliminar" title="Eliminar">✕</button>
        </div>
      `;

      row.querySelector('[data-act="dec"]')?.addEventListener("click", () => { it.qty = Math.max(1, Number(it.qty || 1) - 1); saveCart(); renderCart(); });
      row.querySelector('[data-act="inc"]')?.addEventListener("click", () => { it.qty = Math.min(99, Number(it.qty || 1) + 1); saveCart(); renderCart(); });
      row.querySelector('[data-act="del"]')?.addEventListener("click", () => { cart = cart.filter((x) => x !== it); saveCart(); renderCart(); });

      frag.appendChild(row);
    }

    cartItemsEl.appendChild(frag);
    refreshTotals();
  };

  // =========================================================
  // Promos
  // =========================================================
  const normCode = (s) => String(s || "").trim().toUpperCase().replace(/\s+/g, "");
  const validatePromo = () => {
    const code = normCode(promoCode?.value || "");
    if (!code) { activePromo = null; refreshTotals(); return; }

    const rules = Array.isArray(promosData?.rules) ? promosData.rules : [];
    const r = rules.find((x) => normCode(x?.code) === code && !!x?.active);

    if (!r) { activePromo = null; showToast("Código inválido o expirado.", "error"); refreshTotals(); return; }

    const expOk = !r.expires_at || Date.now() <= new Date(r.expires_at).getTime();
    if (!expOk) { activePromo = null; showToast("Código expirado.", "error"); refreshTotals(); return; }

    activePromo = {
      code: String(r.code || "").trim(),
      type: String(r.type || "").trim(),
      value: Number(r.value || 0),
      description: String(r.description || "").trim(),
      min_amount_mxn: Number(r.min_amount_mxn || 0),
    };

    const subtotalMXN = computeSubtotal() / 100;
    if (subtotalMXN < Number(activePromo.min_amount_mxn || 0)) {
      activePromo = null;
      showToast("Tu compra no alcanza el mínimo para ese código.", "error");
      refreshTotals();
      return;
    }

    showToast(activePromo.description || "Promoción aplicada.", "ok");
    refreshTotals();
  };

  // =========================================================
  // Shipping quote (usa tu quote_shipping real)
  // =========================================================
  const refreshShippingUI = () => {
    if (shipHint) shipHint.textContent = SHIPPING_LABELS[shipping.mode] || "Selecciona ▼";

    if (shipping.mode === "pickup") {
      postalWrap && (postalWrap.hidden = true);
      shippingNote && (shippingNote.textContent = "Recolección sin costo en nuestras instalaciones (Tijuana).");
      shipping.quote = null;
      saveShipping();
      refreshTotals();
      return;
    }

    postalWrap && (postalWrap.hidden = false);
    shippingNote && (shippingNote.textContent = "Ingresa tu CP/ZIP y cotiza en vivo (Envía.com).");
    refreshTotals();
  };

  const doQuote = async () => {
    const zip = String(postalCode?.value || "").trim();
    if (!zip) return showToast("Escribe tu CP/ZIP.", "error");
    if (!cart.length) return showToast("Agrega productos antes de cotizar.", "error");

    try {
      quoteBtn && (quoteBtn.disabled = true);
      quoteBtn && (quoteBtn.textContent = "Cotizando...");

      const res = await fetch("/.netlify/functions/quote_shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postal_code: zip,
          country: shipping.mode === "envia_us" ? "US" : "MX",
          items: cart.map((it) => ({ qty: Math.max(1, Number(it.qty || 1)) })),
        }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j) throw new Error(j?.error || "No se pudo cotizar.");
      if (j.ok === false) throw new Error(j.error || "No se pudo cotizar.");

      shipping.postal_code = zip;
      shipping.quote = j;
      saveShipping();

      showToast("Envío cotizado.", "ok");
      refreshTotals();
    } catch (e) {
      showToast(String(e?.message || e), "error");
    } finally {
      quoteBtn && (quoteBtn.disabled = false);
      quoteBtn && (quoteBtn.textContent = "Cotizar");
    }
  };

  // =========================================================
  // Checkout
  // =========================================================
  const doCheckout = async () => {
    if (cart.length === 0) return showToast("Tu carrito está vacío.", "error");

    const needsZip = shipping.mode !== "pickup";
    if (needsZip && !String(shipping.postal_code || "").trim()) {
      showToast("Cotiza tu envío (CP/ZIP) antes de pagar.", "error");
      return;
    }

    const req_id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;

    try {
      checkoutMsg && (checkoutMsg.hidden = true);
      checkoutLoader && (checkoutLoader.hidden = false);

      const payload = {
        req_id,
        shipping_mode: shipping.mode,
        postal_code: needsZip ? String(shipping.postal_code || "").trim() : "",
        promo_code: activePromo?.code || "",
        items: cart.map((it) => ({
          sku: String(it.sku || "").trim(),
          qty: Math.max(1, Number(it.qty || 1)),
          size: it.size || "Unitalla",
        })),
      };

      const res = await fetch("/.netlify/functions/create_checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok || !j?.url) throw new Error(j?.error || "No se pudo iniciar el pago.");

      window.location.href = j.url;
    } catch (e) {
      checkoutLoader && (checkoutLoader.hidden = true);
      checkoutMsg && (checkoutMsg.hidden = false);
      checkoutMsg && (checkoutMsg.textContent = String(e?.message || e));
      showToast(String(e?.message || e), "error");
    }
  };

  // =========================================================
  // Assistant
  // =========================================================
  const appendAssistant = (who, text) => {
    if (!assistantOutput) return;
    const item = document.createElement("div");
    item.className = `chat__msg chat__msg--${who}`;
    item.innerHTML = `<div class="chat__bubble">${escapeHtml(text)}</div>`;
    assistantOutput.appendChild(item);
    assistantOutput.scrollTop = assistantOutput.scrollHeight;
  };

  const askAssistant = async () => {
    const q = String(assistantInput?.value || "").trim();
    if (!q) return;
    assistantInput.value = "";
    appendAssistant("me", q);

    try {
      const res = await fetch("/.netlify/functions/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || "No hay respuesta.");
      appendAssistant("bot", String(j.reply || "Listo."));
    } catch {
      appendAssistant("bot", "Hubo un problema. Intenta de nuevo.");
    }
  };

  // =========================================================
  // Neuromarketing toast
  // =========================================================
  const initNeuromarketing = () => {
    if (!salesNotification || !salesName || !salesAction) return;
    const names = ["Alex", "María", "Chris", "Fernanda", "Luis", "Sofía", "Diego", "Ana", "Jorge", "Daniela"];
    const actions = ["compró un hoodie", "compró una gorra", "compró una camiseta", "compró una chamarra", "compró mercancía oficial"];
    const tick = () => {
      if (document.hidden) return;
      salesName.textContent = names[Math.floor(Math.random() * names.length)];
      salesAction.textContent = actions[Math.floor(Math.random() * actions.length)];
      salesNotification.hidden = false;
      setTimeout(() => (salesNotification.hidden = true), 3500);
    };
    setTimeout(() => { tick(); setInterval(tick, 18000); }, 7000);
  };

  // =========================================================
  // SW
  // =========================================================
  const registerServiceWorker = () => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("sw.js").catch(() => {});
  };

  // =========================================================
  // Events
  // =========================================================
  const initEvents = () => {
    openMenuBtn?.addEventListener("click", () => openLayer(sideMenu));
    closeMenuBtn?.addEventListener("click", () => closeLayer(sideMenu));

    openCartBtn?.addEventListener("click", () => { openLayer(cartDrawer); refreshShippingUI(); renderCart(); });
    closeCartBtn?.addEventListener("click", () => closeLayer(cartDrawer));
    navOpenCart?.addEventListener("click", () => { closeLayer(sideMenu); openLayer(cartDrawer); refreshShippingUI(); renderCart(); });

    const openAssistant = () => {
      openLayer(assistantModal);
      if (assistantOutput && assistantOutput.childElementCount === 0) {
        appendAssistant("bot", "Hola. Soy el asistente de SCORE STORE. ¿Qué buscas hoy? (tallas, envíos, modelos, etc.)");
      }
    };

    openAssistantBtn?.addEventListener("click", openAssistant);
    floatingAssistantBtn?.addEventListener("click", openAssistant);
    navOpenAssistant?.addEventListener("click", () => { closeLayer(sideMenu); openAssistant(); });
    assistantClose?.addEventListener("click", () => closeLayer(assistantModal));
    assistantSendBtn?.addEventListener("click", askAssistant);
    assistantInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") askAssistant(); });

    overlay?.addEventListener("click", () => {
      if (!productModal?.hidden) return closeLayer(productModal);
      if (!sizeGuideModal?.hidden) return closeLayer(sizeGuideModal);
      if (!assistantModal?.hidden) return closeLayer(assistantModal);
      if (!cartDrawer?.hidden) return closeLayer(cartDrawer);
      if (!sideMenu?.hidden) return closeLayer(sideMenu);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!productModal?.hidden) return closeLayer(productModal);
      if (!sizeGuideModal?.hidden) return closeLayer(sizeGuideModal);
      if (!assistantModal?.hidden) return closeLayer(assistantModal);
      if (!cartDrawer?.hidden) return closeLayer(cartDrawer);
      if (!sideMenu?.hidden) return closeLayer(sideMenu);
    });

    scrollToCategoriesBtn?.addEventListener("click", () => {
      document.querySelector("#categories")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    sortSelect?.addEventListener("change", () => { sortMode = String(sortSelect.value || "featured"); renderProducts(); });

    clearFilterBtn?.addEventListener("click", () => {
      activeCategory = null;
      searchQuery = "";
      if (searchInput) searchInput.value = "";
      if (mobileSearchInput) mobileSearchInput.value = "";
      if (menuSearchInput) menuSearchInput.value = "";
      updateFilterUI();
      renderProducts();
    });

    const triggerSearch = debounce(() => {
      searchQuery = String(searchInput?.value || mobileSearchInput?.value || menuSearchInput?.value || "").trim();
      if (searchQuery !== "" && catalogCarouselSection) catalogCarouselSection.hidden = false;
      updateFilterUI();
      renderProducts();
    }, 250);

    searchInput?.addEventListener("input", () => { if (mobileSearchInput) mobileSearchInput.value = searchInput.value; if (menuSearchInput) menuSearchInput.value = searchInput.value; triggerSearch(); });
    mobileSearchInput?.addEventListener("input", () => { if (searchInput) searchInput.value = mobileSearchInput.value; if (menuSearchInput) menuSearchInput.value = mobileSearchInput.value; triggerSearch(); });
    menuSearchInput?.addEventListener("input", () => { if (searchInput) searchInput.value = menuSearchInput.value; if (mobileSearchInput) mobileSearchInput.value = menuSearchInput.value; triggerSearch(); try { closeLayer(sideMenu); } catch {} });

    mobileSearchBtn?.addEventListener("click", () => { if (!mobileSearchWrap) return; mobileSearchWrap.hidden = false; mobileSearchInput?.focus(); });
    closeMobileSearchBtn?.addEventListener("click", () => { if (!mobileSearchWrap) return; mobileSearchWrap.hidden = true; });

    pmClose?.addEventListener("click", () => closeLayer(productModal));
    pmBackBtn?.addEventListener("click", () => closeLayer(productModal));

    pmQtyDec?.addEventListener("click", () => { selectedQty = Math.max(1, selectedQty - 1); if (pmQtyDisplay) pmQtyDisplay.textContent = selectedQty; });
    pmQtyInc?.addEventListener("click", () => { selectedQty = Math.min(99, selectedQty + 1); if (pmQtyDisplay) pmQtyDisplay.textContent = selectedQty; });

    openSizeGuideBtn?.addEventListener("click", () => openLayer(sizeGuideModal));
    closeSizeGuideBtn?.addEventListener("click", () => closeLayer(sizeGuideModal));
    understandSizeBtn?.addEventListener("click", () => closeLayer(sizeGuideModal));

    pmShareBtn?.addEventListener("click", () => {
      if (!currentProduct) return;
      const url = new URL(window.location.href);
      url.searchParams.set("sku", currentProduct.sku);
      navigator.clipboard?.writeText(url.toString()).then(
        () => showToast("Link copiado para compartir.", "ok"),
        () => showToast("No se pudo copiar el link.", "error")
      );
    });

    pmAdd?.addEventListener("click", () => {
      if (!currentProduct) return;
      if (!selectedSize) return showToast("Selecciona una talla.", "error");

      const sku = currentProduct.sku;
      const found = cart.find((x) => x.sku === sku && x.size === selectedSize);
      if (found) found.qty = Math.min(99, Number(found.qty || 1) + selectedQty);
      else cart.push({ sku, title: currentProduct.title, priceCents: currentProduct.priceCents, size: selectedSize, qty: selectedQty });

      saveCart();
      showToast("Agregado al carrito.", "ok");
      closeLayer(productModal);
      openLayer(cartDrawer);
      refreshShippingUI();
      renderCart();
    });

    $$('input[name="shipMode"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        shipping.mode = String(radio.value || "pickup");
        shipping.quote = null;
        saveShipping();
        refreshShippingUI();
      });
    });

    quoteBtn?.addEventListener("click", doQuote);

    applyPromoBtn?.addEventListener("click", validatePromo);
    promoCode?.addEventListener("keydown", (e) => { if (e.key === "Enter") validatePromo(); });

    continueShoppingBtn?.addEventListener("click", () => closeLayer(cartDrawer));
    checkoutBtn?.addEventListener("click", doCheckout);

    const consentDecision = localStorage.getItem(STORAGE_KEYS.consent);
    if (!consentDecision && cookieBanner) cookieBanner.hidden = false;

    cookieAccept?.addEventListener("click", () => { try { localStorage.setItem(STORAGE_KEYS.consent, "accept"); } catch {} if (cookieBanner) cookieBanner.hidden = true; });
    cookieReject?.addEventListener("click", () => { try { localStorage.setItem(STORAGE_KEYS.consent, "reject"); } catch {} if (cookieBanner) cookieBanner.hidden = true; });

    promoBarClose?.addEventListener("click", () => { try { localStorage.setItem("scorestore_promo_dismissed", "1"); } catch {} if (promoBar) promoBar.hidden = true; });

    const onScroll = debounce(() => {
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      if (!scrollTopBtn) return;
      scrollTopBtn.hidden = y < 800;
    }, 80);

    window.addEventListener("scroll", onScroll, { passive: true });
    scrollTopBtn?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  };

  // =========================================================
  // Init
  // =========================================================
  const init = async () => {
    if (appVersionLabel) appVersionLabel.textContent = APP_VERSION;

    registerServiceWorker();

    loadCart();
    loadShipping();
    initEvents();

    await fetchPromos();
    validatePromo();

    refreshShippingUI();
    renderCart();

    try {
      catalog = await fetchCatalog();
      products = (catalog?.products || []).map(normalizeProduct).filter((p) => p.sku);

      // default category sanity
      products = products.map((p) => {
        if (!CATEGORY_CONFIG.some((c) => c.uiId === p.uiSection)) p.uiSection = "BAJA1000";
        return p;
      });

      renderCategories();
      updateFilterUI();
      renderProducts();

      const qs = new URLSearchParams(window.location.search);
      const deepSku = qs.get("sku");
      if (deepSku && products.some((p) => p.sku === deepSku)) openProduct(deepSku);
    } catch {
      showToast("Problemas al cargar el catálogo principal. Verifica tu conexión.", "error");
    } finally {
      setTimeout(() => {
        if (splash) {
          splash.classList.add("fade-out");
          setTimeout(() => (splash.hidden = true), 800);
        }
        initNeuromarketing();
      }, 1600);
    }
  };

  init().catch(() => { if (splash) splash.hidden = true; });
})();