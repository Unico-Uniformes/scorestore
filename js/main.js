/* SCORE STORE — main.js (v2026_PROD_UNIFIED_401)
   Objetivos:
   - Home = catálogos por edición (NO render masivo de productos al inicio)
   - Click catálogo => productos + carrusel tipo FB
   - Carrito drawer pro + Envia quote + Stripe Checkout (redirect)
   - SCORE AI (Gemini vía Netlify Function /api/chat)
   - Performance: splash no bloquea, imágenes optimizadas con Netlify Image CDN
*/

(() => {
  'use strict';

  const CFG = {
    currency: 'MXN',
    endpoints: {
      quote: '/api/quote',
      checkout: '/api/checkout',
      chat: '/api/chat',
      catalog: ['/data/catalog.json','/data/products.json','/data/catalogo.json']
    },
    netlifyImage: {
      enabled: true,
      q: 82
    },
    ui: {
      maxSlides: 6
    }
  };

  // ---------- Helpers ----------
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  function safeJsonParse(str, fallback) {
    try { return JSON.parse(str); } catch { return fallback; }
  }

  function money(n) {
    const v = Number(n || 0);
    try {
      return new Intl.NumberFormat('es-MX', { style:'currency', currency: CFG.currency }).format(v);
    } catch {
      return '$' + v.toFixed(2);
    }
  }

  function toast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function clampInt(x, min, max) {
    const n = Math.round(Number(x || 0));
    return Math.min(max, Math.max(min, n));
  }

  function encodePath(p) {
    if (!p) return '';
    // keep "/" but encode spaces & special chars
    return String(p).split('/').map(seg => encodeURIComponent(seg)).join('/').replace(/%2F/g,'/');
  }

  function netlifyImg(url, w, q) {
    if (!url) return '';
    const clean = (String(url).startsWith('http') ? url : (String(url).startsWith('/') ? url : '/' + url));
    if (!CFG.netlifyImage.enabled) return clean;
    const params = new URLSearchParams({ url: clean, w: String(w || 900), q: String(q || CFG.netlifyImage.q) });
    return `/.netlify/images?${params.toString()}`;
  }

  async function preload(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.decoding = 'async';
      img.src = src;
    });
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const text = await res.text();
    const json = safeJsonParse(text, null);
    if (!res.ok) {
      const msg = (json && (json.error || json.message)) || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return json ?? {};
  }

  // Fallback to direct function path if redirect is missing
  async function postSmart(url, body) {
    try {
      return await postJson(url, body);
    } catch (e) {
      if (!String(url).includes('/.netlify/functions/')) {
        const name = String(url).replace('/api/', '');
        return await postJson(`/.netlify/functions/${name}`, body);
      }
      throw e;
    }
  }

  async function getJson(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    const text = await res.text();
    const json = safeJsonParse(text, null);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return json;
  }

  function normalizeCatalog(raw) {
    // Accepts:
    // - {sections:[...], products:[...]}
    // - {products:[...]} (sections will be inferred)
    // - [...] (array of products)
    const obj = raw;
    let products = [];
    let sections = [];

    if (Array.isArray(obj)) {
      products = obj;
    } else if (obj && Array.isArray(obj.products)) {
      products = obj.products;
      if (Array.isArray(obj.sections)) sections = obj.sections;
    } else if (obj && Array.isArray(obj.items)) {
      products = obj.items;
      if (Array.isArray(obj.sections)) sections = obj.sections;
    }

    // Normalize product fields
    products = (products || []).map((p, idx) => ({
      id: p.id || p.pid || p.sku || `p_${idx}`,
      sku: p.sku || p.id || "",
      name: p.name || p.title || p.product || "Producto",
      price: Number(p.price || p.amount || p.cost || 0),
      section: (p.section || p.edition || p.catalog || p.drop || "GENERAL").toString().toUpperCase(),
      subSection: (p.subSection || p.sub || p.category || p.type || "").toString(),
      img: p.img || p.image || p.cover || "",
      images: p.images || p.gallery || []
    }));

    // Infer sections if missing
    if (!sections || !sections.length) {
      const ids = Array.from(new Set(products.map(p => p.section).filter(Boolean)));
      sections = ids.map(id => ({
        id,
        title: id.replace(/_/g,' '),
        desc: 'Drop por edición',
        logo: '/assets/logo-score.webp',
        tag: 'EDICIÓN'
      }));
    } else {
      sections = sections.map(s => ({
        id: (s.id || s.section || s.edition || '').toString().toUpperCase(),
        title: s.title || s.name || s.id,
        desc: s.desc || s.description || 'Drop por edición',
        logo: s.logo || s.image || '/assets/logo-score.webp',
        tag: s.tag || 'EDICIÓN'
      }));
    }

    return { sections, products };
  }


  // ---------- State ----------
  const STATE = {
    catalog: null,
    activeEdition: null,
    activeFilter: 'ALL',
    cart: safeJsonParse(localStorage.getItem('score_cart_v1') || '[]', []),
    shipMode: localStorage.getItem('score_ship_mode') || 'pickup', // pickup | mx | us
    shipQuote: safeJsonParse(localStorage.getItem('score_ship_quote') || 'null', null),
    consent: safeJsonParse(localStorage.getItem('score_cookie_consent') || 'null', null) // {analytics:boolean}
  };

  function saveCart() {
    localStorage.setItem('score_cart_v1', JSON.stringify(STATE.cart));
    updateCartBadge();
  }
  function saveShip() {
    localStorage.setItem('score_ship_mode', STATE.shipMode);
    localStorage.setItem('score_ship_quote', JSON.stringify(STATE.shipQuote));
  }

  function cartCount() {
    return STATE.cart.reduce((a, it) => a + (it.qty || 0), 0);
  }
  function cartSubtotal() {
    return STATE.cart.reduce((a, it) => a + (Number(it.price)||0) * (Number(it.qty)||0), 0);
  }

  // ---------- DOM refs ----------
  const UI = {
    editionGrid: null,
    productsView: null,
    productsGrid: null,
    chips: null,
    editionTitle: null,
    editionMeta: null,

    cartCount: null,
    drawer: null,
    overlay: null,
    drawerBody: null,
    subtotalLabel: null,
    shipLabel: null,
    totalLabel: null,

    aiModal: null,
    aiMessages: null,
    aiInput: null,

    legalModal: null,
    legalBody: null,

    cookieBanner: null,
    shipHero: {
      zipWrap: null,
      zipInput: null,
      quoteBtn: null,
      shipLabel: null
    }
  };

  // ---------- Init ----------
  document.addEventListener('DOMContentLoaded', () => {
    bindDom();
    bindTopbar();
    bindCookie();
    bindHeroShipping();
    bindCart();
    bindAI();
    bindLegal();

    // Splash is killed by inline script. We *do not* wait for data.
    // Load catalog async.
    loadCatalog().catch(err => {
      console.error(err);
      toast('No se pudo cargar el catálogo.');
    });
  });

  function bindDom() {
    UI.editionGrid = $('#editionGrid');
    UI.productsView = $('#productsView');
    UI.productsGrid = $('#productsGrid');
    UI.chips = $('#chips');
    UI.editionTitle = $('#editionTitle');
    UI.editionMeta = $('#editionMeta');

    UI.cartCount = $('#cartCount');
    UI.drawer = $('#cartDrawer');
    UI.overlay = $('#pageOverlay');
    UI.drawerBody = $('#drawerBody');
    UI.subtotalLabel = $('#subtotalLabel');
    UI.shipLabel = $('#shipLabel');
    UI.totalLabel = $('#totalLabel');

    UI.aiModal = $('#aiModal');
    UI.aiMessages = $('#aiMessages');
    UI.aiInput = $('#aiInput');

    UI.legalModal = $('#legalModal');
    UI.legalBody = $('#legalBody');

    UI.cookieBanner = $('#cookieBanner');

    UI.shipHero.zipWrap = $('#zipWrapHero');
    UI.shipHero.zipInput = $('#zipInputHero');
    UI.shipHero.quoteBtn = $('#quoteShipHeroBtn');
    UI.shipHero.shipLabel = $('#shipLabelHero');

    updateCartBadge();
  }

  // ---------- Cookie / Analytics ----------
  function bindCookie() {
    const acceptBtn = $('#cookieAcceptBtn');
    const rejectBtn = $('#cookieRejectBtn');

    const hasConsent = STATE.consent && typeof STATE.consent.analytics === 'boolean';
    if (!hasConsent) {
      UI.cookieBanner?.classList.add('active');
      UI.cookieBanner?.setAttribute('aria-hidden','false');
    } else {
      if (STATE.consent.analytics) initAnalytics();
    }

    acceptBtn?.addEventListener('click', () => {
      STATE.consent = { analytics: true };
      localStorage.setItem('score_cookie_consent', JSON.stringify(STATE.consent));
      UI.cookieBanner?.classList.remove('active');
      initAnalytics();
      toast('Cookies aceptadas.');
    });

    rejectBtn?.addEventListener('click', () => {
      STATE.consent = { analytics: false };
      localStorage.setItem('score_cookie_consent', JSON.stringify(STATE.consent));
      UI.cookieBanner?.classList.remove('active');
      toast('Cookies rechazadas.');
    });
  }

  function initAnalytics() {
    // Meta Pixel (deferred + con consentimiento)
    if (window.__pixelLoaded) return;
    window.__pixelLoaded = true;
    const PIXEL_ID = '331564696669571';
    try {
      !(function(f,b,e,v,n,t,s) {
        if(f.fbq) return; n=f.fbq=function(){ n.callMethod ? n.callMethod.apply(n,arguments) : n.queue.push(arguments) };
        if(!f._fbq) f._fbq=n; n.push=n; n.loaded=!0; n.version='2.0'; n.queue=[];
        t=b.createElement(e); t.async=!0; t.src=v;
        s=b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t,s);
      })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      window.fbq('init', PIXEL_ID);
      window.fbq('track', 'PageView');
    } catch(e) {
      console.warn('Pixel error', e);
    }
  }

  // ---------- Topbar / Nav ----------
  function bindTopbar() {
    $('#openCartBtn')?.addEventListener('click', openCart);
    $('#footerCartBtn')?.addEventListener('click', openCart);

    $('#openAiBtn')?.addEventListener('click', () => openAI());
    $('#footerAiBtn')?.addEventListener('click', () => openAI());

    $('#heroCtaAi')?.addEventListener('click', () => openAI('Quiero comprar merch. Recomiéndame algo 🔥'));
    $('#productsAiBtn')?.addEventListener('click', () => openAI(`Estoy viendo la edición ${STATE.activeEdition || ''}. Recomiéndame productos.`));

    $('#openLegalBtn')?.addEventListener('click', openLegal);
    $('#footerLegalLink')?.addEventListener('click', openLegal);

    $('#heroCtaCatalogos')?.addEventListener('click', () => {
      // anchor only
    });
  }

  // ---------- Legal ----------
  function bindLegal() {
    $('#closeLegalBtn')?.addEventListener('click', closeLegal);
    UI.legalModal?.addEventListener('click', (e) => {
      if (e.target === UI.legalModal) closeLegal();
    });

    $('#openLegalBtn')?.addEventListener('click', openLegal);
    $('#footerLegalLink')?.addEventListener('click', openLegal);
  }

  async function openLegal() {
    if (!UI.legalModal || !UI.legalBody) return;
    UI.legalModal.classList.add('active');
    UI.legalModal.setAttribute('aria-hidden','false');
    UI.legalBody.innerHTML = '<div style="opacity:.8">Cargando…</div>';
    try {
      const res = await fetch('/legal.html', { cache: 'no-cache' });
      const html = await res.text();
      // Extract <main> only
      const match = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
      UI.legalBody.innerHTML = match ? match[1] : html;
    } catch (e) {
      UI.legalBody.innerHTML = '<div style="opacity:.8">No se pudo cargar Legal. Abre /legal.html</div>';
    }
  }

  function closeLegal() {
    UI.legalModal?.classList.remove('active');
    UI.legalModal?.setAttribute('aria-hidden','true');
  }

  // ---------- Catalog / Editions ----------
  async function loadCatalog() {
    const urls = Array.isArray(CFG.endpoints.catalog) ? CFG.endpoints.catalog : [CFG.endpoints.catalog];
    let raw = null;
    let lastErr = null;

    for (const u of urls) {
      try {
        raw = await getJson(u);
        if (raw) break;
      } catch (e) { lastErr = e; }
    }
    if (!raw) throw (lastErr || new Error("No catalog source"));

    STATE.catalog = normalizeCatalog(raw);

    renderEditions();
    bindEditionRouting();
    syncHeroShipUI();

    // If URL hash includes edition, open it
    const hash = String(location.hash || '');
    const m = hash.match(/ed=([A-Z0-9_]+)/i);
    if (m && m[1]) openEdition(m[1].toUpperCase());
  }

  function bindEditionRouting() {
    window.addEventListener('hashchange', () => {
      const h = String(location.hash || '');
      const m = h.match(/ed=([A-Z0-9_]+)/i);
      if (m && m[1]) openEdition(m[1].toUpperCase());
    });

    $('#openAllBtn')?.addEventListener('click', () => {
      STATE.activeEdition = null;
      STATE.activeFilter = 'ALL';
      showAllEditions();
      location.hash = '#catalogos';
    });

    $('#backToEditionsBtn')?.addEventListener('click', () => {
      STATE.activeEdition = null;
      STATE.activeFilter = 'ALL';
      showAllEditions();
      const base = location.href.split('#')[0];
      history.replaceState(null, '', `${base}#catalogos`);
    });
  }

  function renderEditions() {
    if (!UI.editionGrid || !STATE.catalog) return;

    const sections = Array.isArray(STATE.catalog.sections) ? STATE.catalog.sections : [];
    const products = Array.isArray(STATE.catalog.products) ? STATE.catalog.products : [];

    UI.editionGrid.innerHTML = '';
    const frag = document.createDocumentFragment();

    for (const s of sections) {
      const count = products.filter(p => String(p.section).toUpperCase() === String(s.id).toUpperCase()).length;
      const logo = s.logo || '';
      const title = s.title || s.id;
      const desc = s.desc || 'Drop por edición';
      const tag = s.tag || 'EDICIÓN';

      const card = document.createElement('article');
      card.className = 'editionCard';
      card.tabIndex = 0;
      card.setAttribute('role','button');
      card.setAttribute('aria-label', `Abrir edición ${title}`);

      card.innerHTML = `
        <div class="editionCardInner">
          <div class="editionTop">
            <img class="editionLogo" src="${encodePath(logo)}" alt="${escapeHtml(title)}" loading="lazy" decoding="async" />
            <div class="editionTag">${escapeHtml(tag)}</div>
          </div>
          <h3 class="editionTitle">${escapeHtml(title)}</h3>
          <p class="editionDesc">${escapeHtml(desc)}</p>
          <div class="editionMeta">
            <span class="editionPill">${count} productos</span>
            <span class="editionPill">Carrusel</span>
            <span class="editionPill">Checkout</span>
            <span class="editionArrow" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M13 5 20 12l-7 7-1.41-1.41L16.17 13H4v-2h12.17l-4.58-4.59L13 5Z"/></svg>
            </span>
          </div>
        </div>
      `;

      const open = () => openEdition(String(s.id || '').toUpperCase());
      card.addEventListener('click', open);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });

      frag.appendChild(card);
    }

    UI.editionGrid.appendChild(frag);
  }

  function showAllEditions() {
    UI.editionGrid?.classList.remove('hidden');
    UI.productsView?.classList.remove('active');
    UI.productsView?.setAttribute('aria-hidden','true');
    UI.editionGrid?.setAttribute('aria-hidden','false');
  }

  function openEdition(id) {
    if (!STATE.catalog) return;
    const sections = Array.isArray(STATE.catalog.sections) ? STATE.catalog.sections : [];
    const s = sections.find(x => String(x.id).toUpperCase() === String(id).toUpperCase());

    const editionId = String(id || '').toUpperCase();
    STATE.activeEdition = editionId;
    STATE.activeFilter = 'ALL';

    // Update URL
    try {
      const base = location.href.split('#')[0];
      history.replaceState(null, '', `${base}#catalogos&ed=${editionId}`);
    } catch {}

    // UI swap
    UI.editionGrid?.classList.add('hidden');
    UI.editionGrid?.setAttribute('aria-hidden','true');
    UI.productsView?.classList.add('active');
    UI.productsView?.setAttribute('aria-hidden','false');

    UI.editionTitle.textContent = s?.title || editionId;
    UI.editionMeta.textContent = s?.desc || 'Drop oficial';
    renderChipsForEdition(editionId);
    renderProducts(editionId);

    setTimeout(() => {
      $('#productsView')?.scrollIntoView({ behavior:'smooth', block:'start' });
    }, 50);
  }

  function renderChipsForEdition(editionId) {
    if (!UI.chips || !STATE.catalog) return;
    const products = (STATE.catalog.products || []).filter(p => String(p.section).toUpperCase() === editionId);
    const subs = Array.from(new Set(products.map(p => p.subSection).filter(Boolean)));

    UI.chips.innerHTML = '';
    const mk = (label, value) => {
      const b = document.createElement('button');
      b.className = 'chip' + (STATE.activeFilter === value ? ' active' : '');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => {
        STATE.activeFilter = value;
        $$('.chip', UI.chips).forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        renderProducts(editionId);
      });
      return b;
    };

    UI.chips.appendChild(mk('Todo', 'ALL'));
    for (const s of subs) UI.chips.appendChild(mk(s, s));
  }

  // ---------- Products + Carousel ----------
  function renderProducts(editionId) {
    if (!UI.productsGrid || !STATE.catalog) return;
    const all = (STATE.catalog.products || []).filter(p => String(p.section).toUpperCase() === editionId);
    const products = (STATE.activeFilter === 'ALL') ? all : all.filter(p => String(p.subSection) === String(STATE.activeFilter));

    UI.productsGrid.innerHTML = '';
    if (!products.length) {
      UI.productsGrid.innerHTML = '<div style="grid-column: 1 / -1; padding: 12px; opacity:.8">No hay productos en esta sección.</div>';
      return;
    }

    const frag = document.createDocumentFragment();

    for (const p of products) {
      const card = document.createElement('article');
      card.className = 'productCard';
      card.dataset.pid = p.id || '';

      const imgList = [p.img, ...(Array.isArray(p.images) ? p.images : [])].filter(Boolean);
      const slides = imgList.slice(0, CFG.ui.maxSlides);

      const price = Number(p.price || 0);
      const meta = [p.subSection, p.sku].filter(Boolean).join(' • ');

      card.innerHTML = `
        <div class="productMedia">
          <div class="carouselTrack" data-track="1" aria-label="Galería del producto"></div>
          <div class="carouselControls" aria-hidden="false">
            <button class="cArrow" type="button" data-prev aria-label="Anterior">‹</button>
            <div class="cDots" data-dots></div>
            <button class="cArrow" type="button" data-next aria-label="Siguiente">›</button>
          </div>
        </div>

        <div class="productBody">
          <h4 class="productName">${escapeHtml(p.name || 'Producto')}</h4>
          <div class="productMetaRow">
            <span class="price">${money(price)}</span>
            <span class="meta">${escapeHtml(meta)}</span>
          </div>

          <div class="productActions">
            <button class="btn small primary" type="button" data-add>Agregar</button>
            <div class="qty" aria-label="Cantidad">
              <button type="button" data-minus aria-label="Menos">−</button>
              <span data-qty>1</span>
              <button type="button" data-plus aria-label="Más">+</button>
            </div>
          </div>
        </div>
      `;

      // qty controls
      const qtyEl = $('[data-qty]', card);
      let qty = 1;
      const setQty = (n) => {
        qty = clampInt(n, 1, 99);
        qtyEl.textContent = String(qty);
      };
      $('[data-minus]', card).addEventListener('click', () => setQty(qty - 1));
      $('[data-plus]', card).addEventListener('click', () => setQty(qty + 1));
      $('[data-add]', card).addEventListener('click', () => {
        addToCart(p, qty);
        toast('Agregado al carrito.');
      });

      // Lazy-hydrate carousel only when visible (perf)
      card.dataset.slides = JSON.stringify(slides);
      frag.appendChild(card);
    }

    UI.productsGrid.appendChild(frag);
    hydrateVisibleCarousels();
  }

  function hydrateVisibleCarousels() {
    const cards = $$('.productCard', UI.productsGrid);
    if (!cards.length) return;

    const io = new IntersectionObserver((entries) => {
      for (const ent of entries) {
        if (!ent.isIntersecting) continue;
        const card = ent.target;
        io.unobserve(card);
        hydrateCarousel(card).catch(console.warn);
      }
    }, {
      root: null,
      threshold: 0.25
    });

    cards.forEach(c => io.observe(c));
  }

  async function hydrateCarousel(card) {
    const track = $('.carouselTrack', card);
    const dots = $('[data-dots]', card);
    const prev = $('[data-prev]', card);
    const next = $('[data-next]', card);

    if (!track || track.dataset.ready === '1') return;
    track.dataset.ready = '1';

    const raw = safeJsonParse(card.dataset.slides || '[]', []);
    const slides = Array.isArray(raw) ? raw : [];
    if (!slides.length) {
      track.innerHTML = `<div class="slide"><img src="/assets/hero.webp" alt="Producto" loading="lazy" decoding="async"></div>`;
      dots.innerHTML = `<span class="dot active"></span>`;
      prev.style.display = 'none';
      next.style.display = 'none';
      return;
    }

    // Build slides only for images that exist (avoid blank)
    const okImgs = [];
    for (const s of slides) {
      const cleaned = encodePath(s);
      const candidate = netlifyImg(cleaned, 900, 82);
      const exists = await preload(candidate);
      if (exists) okImgs.push({ raw: cleaned, cdn: candidate });
      if (okImgs.length >= CFG.ui.maxSlides) break;
    }

    if (!okImgs.length) {
      track.innerHTML = `<div class="slide"><img src="/assets/hero.webp" alt="Producto" loading="lazy" decoding="async"></div>`;
      dots.innerHTML = `<span class="dot active"></span>`;
      prev.style.display = 'none';
      next.style.display = 'none';
      return;
    }

    track.innerHTML = '';
    dots.innerHTML = '';

    okImgs.forEach((img, i) => {
      const slide = document.createElement('div');
      slide.className = 'slide';
      slide.innerHTML = `
        <img
          src="${img.cdn}"
          srcset="${netlifyImg(img.raw, 520, 80)} 520w, ${netlifyImg(img.raw, 760, 82)} 760w, ${netlifyImg(img.raw, 980, 84)} 980w"
          sizes="(max-width: 680px) 92vw, (max-width: 1020px) 45vw, 320px"
          width="980"
          height="1225"
          alt="Producto"
          loading="lazy"
          decoding="async"
        />
      `;
      track.appendChild(slide);

      const d = document.createElement('span');
      d.className = 'dot' + (i === 0 ? ' active' : '');
      dots.appendChild(d);
    });

    let index = 0;
    const setActive = (i) => {
      index = clampInt(i, 0, okImgs.length - 1);
      track.scrollTo({ left: track.clientWidth * index, behavior:'smooth' });
      $$('.dot', dots).forEach((d, di) => d.classList.toggle('active', di === index));
    };

    prev.addEventListener('click', () => setActive(index - 1));
    next.addEventListener('click', () => setActive(index + 1));

    track.addEventListener('scroll', () => {
      const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      if (i !== index) {
        index = clampInt(i, 0, okImgs.length - 1);
        $$('.dot', dots).forEach((d, di) => d.classList.toggle('active', di === index));
      }
    }, { passive: true });
  }

  // ---------- Cart ----------
  function bindCart() {
    $('#openCartBtn')?.addEventListener('click', openCart);
    $('#productsCartBtn')?.addEventListener('click', openCart);
    $('#closeCartBtn')?.addEventListener('click', closeCart);
    UI.overlay?.addEventListener('click', closeCart);

    $('#checkoutBtn')?.addEventListener('click', checkout);

    updateTotals();
  }

  function updateCartBadge() {
    if (UI.cartCount) UI.cartCount.textContent = String(cartCount());
  }

  function openCart() {
    UI.overlay?.classList.add('active');
    UI.drawer?.classList.add('active');
    UI.drawer?.setAttribute('aria-hidden','false');
    UI.overlay?.setAttribute('aria-hidden','false');
    renderCart();
  }

  function closeCart() {
    UI.overlay?.classList.remove('active');
    UI.drawer?.classList.remove('active');
    UI.drawer?.setAttribute('aria-hidden','true');
    UI.overlay?.setAttribute('aria-hidden','true');
  }

  function addToCart(p, qty) {
    const id = String(p.id || p.sku || p.name || Math.random());
    const existing = STATE.cart.find(it => it.id === id);
    if (existing) {
      existing.qty = clampInt((existing.qty || 0) + qty, 1, 99);
    } else {
      STATE.cart.push({
        id,
        name: p.name || 'Producto',
        sku: p.sku || '',
        section: p.section || '',
        subSection: p.subSection || '',
        price: Number(p.price || 0),
        img: p.img || '',
        qty: clampInt(qty, 1, 99)
      });
    }
    saveCart();
    renderCart();
  }

  function removeFromCart(id) {
    STATE.cart = STATE.cart.filter(it => it.id !== id);
    saveCart();
    renderCart();
  }

  function changeQty(id, delta) {
    const it = STATE.cart.find(x => x.id === id);
    if (!it) return;
    it.qty = clampInt((it.qty || 1) + delta, 1, 99);
    saveCart();
    renderCart();
  }

  function renderCart() {
    if (!UI.drawerBody) return;
    if (!STATE.cart.length) {
      UI.drawerBody.innerHTML = '<div style="opacity:.8">Tu carrito está vacío.</div>';
      updateTotals();
      return;
    }

    UI.drawerBody.innerHTML = '';

    // Shipping controls
    const shipCard = document.createElement('div');
    shipCard.className = 'cartItem';
    shipCard.innerHTML = `
      <div class="cartThumb"><img src="/assets/fondo-pagina-score.webp" alt="Entrega" loading="lazy" decoding="async"></div>
      <div class="cartInfo">
        <p class="cartName">Entrega</p>
        <div class="cartSmall">Selecciona pickup o cotiza envío por CP/ZIP.</div>
        <div class="cartRow">
          <div>
            <label class="radioPill"><input type="radio" name="shipMode" value="pickup"><span>Pickup</span></label>
            <label class="radioPill"><input type="radio" name="shipMode" value="mx"><span>México</span></label>
            <label class="radioPill"><input type="radio" name="shipMode" value="us"><span>USA</span></label>
          </div>
        </div>
        <div class="cartRow" id="shipZipRow" style="display:none">
          <input id="shipZipInput" class="zipInput" inputmode="numeric" placeholder="Código postal / ZIP" />
          <button class="btn small" type="button" id="shipQuoteBtn">Cotizar</button>
        </div>
        <div class="cartSmall"><b id="shipSummary"></b></div>
      </div>
    `;
    UI.drawerBody.appendChild(shipCard);

    // bind shipping
    const radios = $$('input[name="shipMode"]', shipCard);
    radios.forEach(r => r.checked = (r.value === STATE.shipMode));
    const zipRow = $('#shipZipRow', shipCard);
    const zipInput = $('#shipZipInput', shipCard);
    const quoteBtn = $('#shipQuoteBtn', shipCard);
    const summary = $('#shipSummary', shipCard);

    const sync = () => {
      zipRow.style.display = (STATE.shipMode === 'pickup') ? 'none' : 'flex';
      summary.textContent = shippingLabel();
      saveShip();
      updateTotals();
    };
    radios.forEach(r => r.addEventListener('change', () => {
      STATE.shipMode = r.value;
      if (STATE.shipMode === 'pickup') STATE.shipQuote = null;
      sync();
      syncHeroShipUI();
    }));
    zipInput.value = (STATE.shipQuote && STATE.shipQuote.zip) ? STATE.shipQuote.zip : '';
    quoteBtn.addEventListener('click', async () => {
      const zip = String(zipInput.value || '').trim();
      if (!zip) return toast('Pon tu código postal/ZIP.');
      try {
        quoteBtn.disabled = true;
        quoteBtn.textContent = 'Cotizando…';
        const payload = buildShippingPayload(zip);
        const q = await postSmart(CFG.endpoints.quote, payload);
        if (!q?.ok) throw new Error(q?.error || 'No se pudo cotizar.');
        STATE.shipQuote = {
          zip,
          amount: Number(q.amount || 0),
          label: String(q.label || ''),
          carrier: String(q.carrier || '')
        };
        saveShip();
        toast('Envío cotizado.');
        sync();
      } catch (e) {
        console.error(e);
        toast('No se pudo cotizar envío.');
      } finally {
        quoteBtn.disabled = false;
        quoteBtn.textContent = 'Cotizar';
      }
    });
    sync();

    // Items
    for (const it of STATE.cart) {
      const row = document.createElement('div');
      row.className = 'cartItem';
      const thumb = netlifyImg(encodePath(it.img || '/assets/hero.webp'), 240, 82);
      row.innerHTML = `
        <div class="cartThumb"><img src="${thumb}" alt="${escapeHtml(it.name)}" loading="lazy" decoding="async"></div>
        <div class="cartInfo">
          <p class="cartName">${escapeHtml(it.name)}</p>
          <div class="cartSmall">${escapeHtml([it.section, it.subSection].filter(Boolean).join(' • '))}</div>
          <div class="cartRow">
            <div class="qty">
              <button type="button" data-minus aria-label="Menos">−</button>
              <span>${it.qty}</span>
              <button type="button" data-plus aria-label="Más">+</button>
            </div>
            <div class="cartSmall"><b>${money((it.price||0)*(it.qty||0))}</b></div>
            <button class="linkBtn" type="button" data-remove>Quitar</button>
          </div>
        </div>
      `;
      $('[data-minus]', row).addEventListener('click', () => changeQty(it.id, -1));
      $('[data-plus]', row).addEventListener('click', () => changeQty(it.id, +1));
      $('[data-remove]', row).addEventListener('click', () => removeFromCart(it.id));
      UI.drawerBody.appendChild(row);
    }

    updateTotals();
  }

  function shippingAmount() {
    if (STATE.shipMode === 'pickup') return 0;
    return Number(STATE.shipQuote?.amount || 0);
  }

  function shippingLabel() {
    if (STATE.shipMode === 'pickup') return 'Pickup Gratis';
    if (!STATE.shipQuote) return 'Envío sin cotizar';
    const carrier = STATE.shipQuote.carrier ? ` • ${STATE.shipQuote.carrier}` : '';
    return `${STATE.shipQuote.label || 'Envío'}: ${money(shippingAmount())}${carrier}`;
  }

  function updateTotals() {
    const subtotal = cartSubtotal();
    const ship = shippingAmount();
    const total = subtotal + ship;

    UI.subtotalLabel.textContent = money(subtotal);
    UI.shipLabel.textContent = (STATE.shipMode === 'pickup') ? 'Pickup Gratis' : money(ship);
    UI.totalLabel.textContent = money(total);
  }

  // ---------- Hero shipping sync ----------
  function bindHeroShipping() {
    const radios = $$('input[name="shipModeHero"]');
    radios.forEach(r => {
      r.checked = (r.value === STATE.shipMode);
      r.addEventListener('change', () => {
        STATE.shipMode = r.value;
        if (STATE.shipMode === 'pickup') STATE.shipQuote = null;
        saveShip();
        syncHeroShipUI();
        updateTotals();
      });
    });

    UI.shipHero.quoteBtn?.addEventListener('click', async () => {
      const zip = String(UI.shipHero.zipInput?.value || '').trim();
      if (!zip) return toast('Pon tu código postal/ZIP.');
      try {
        UI.shipHero.quoteBtn.disabled = true;
        UI.shipHero.quoteBtn.textContent = 'Cotizando…';
        const payload = buildShippingPayload(zip);
        const q = await postSmart(CFG.endpoints.quote, payload);
        if (!q?.ok) throw new Error(q?.error || 'No se pudo cotizar.');
        STATE.shipQuote = {
          zip,
          amount: Number(q.amount || 0),
          label: String(q.label || ''),
          carrier: String(q.carrier || '')
        };
        saveShip();
        syncHeroShipUI();
        toast('Envío cotizado.');
      } catch (e) {
        console.error(e);
        toast('No se pudo cotizar envío.');
      } finally {
        UI.shipHero.quoteBtn.disabled = false;
        UI.shipHero.quoteBtn.textContent = 'Cotizar';
      }
    });
  }

  function syncHeroShipUI() {
    const wrap = UI.shipHero.zipWrap;
    if (!wrap) return;
    wrap.style.display = (STATE.shipMode === 'pickup') ? 'none' : 'flex';
    if (UI.shipHero.shipLabel) UI.shipHero.shipLabel.textContent = shippingLabel();
  }

  function buildShippingPayload(zip) {
    return {
      mode: STATE.shipMode,
      zip,
      cart: STATE.cart.map(it => ({
        sku: it.sku || it.id,
        qty: it.qty,
        price: it.price
      })),
      items: STATE.cart.map(it => ({
        quantity: it.qty,
        weight: 0.6,
        length: 32,
        height: 6,
        width: 26
      }))
    };
  }

  // ---------- Checkout ----------
  async function checkout() {
    if (!STATE.cart.length) return toast('Tu carrito está vacío.');
    if (STATE.shipMode !== 'pickup' && !STATE.shipQuote) return toast('Cotiza el envío antes de pagar.');

    const btn = $('#checkoutBtn');
    try {
      btn.disabled = true;
      btn.textContent = 'Creando checkout…';

      const payload = {
        cart: STATE.cart,
        shippingMode: STATE.shipMode,
        shippingLabel: shippingLabel(),
        shipping: shippingAmount(),
        shippingData: {
          zip: STATE.shipQuote?.zip || '',
          carrier: STATE.shipQuote?.carrier || '',
          label: STATE.shipQuote?.label || ''
        }
      };

      const res = await postSmart(CFG.endpoints.checkout, payload);
      const url = res?.url || res?.checkout_url || res?.checkoutUrl;
      if (!url) throw new Error('Checkout URL no recibido.');

      try { window.fbq && window.fbq('track', 'InitiateCheckout'); } catch {}

      window.location.href = url;
    } catch (e) {
      console.error(e);
      toast('No se pudo iniciar el pago.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Pagar con Stripe';
    }
  }

  // ---------- SCORE AI ----------
  function bindAI() {
    $('#openAiBtn')?.addEventListener('click', () => openAI());
    $('#closeAiBtn')?.addEventListener('click', closeAI);
    $('#heroCtaAi')?.addEventListener('click', () => openAI('Quiero comprar merch. Recomiéndame algo 🔥'));
    $('#productsAiBtn')?.addEventListener('click', () => openAI(`Estoy viendo la edición ${STATE.activeEdition || ''}. Recomiéndame productos.`));
    $('#footerAiBtn')?.addEventListener('click', () => openAI());

    UI.aiModal?.addEventListener('click', (e) => {
      if (e.target === UI.aiModal) closeAI();
    });

    $('#aiSendBtn')?.addEventListener('click', sendAI);
    UI.aiInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendAI();
    });

    if (UI.aiMessages && !UI.aiMessages.dataset.ready) {
      UI.aiMessages.dataset.ready = '1';
      pushMsg('bot', 'Soy SCORE AI. Te ayudo a elegir merch por edición, tallas, envío y pago. ¿Qué edición quieres?');
    }
  }

  function openAI(prefill) {
    UI.aiModal?.classList.add('active');
    UI.aiModal?.setAttribute('aria-hidden','false');
    if (prefill && UI.aiInput) UI.aiInput.value = prefill;
    setTimeout(() => UI.aiInput?.focus(), 80);
  }

  function closeAI() {
    UI.aiModal?.classList.remove('active');
    UI.aiModal?.setAttribute('aria-hidden','true');
  }

  function pushMsg(who, text) {
    if (!UI.aiMessages) return;
    const div = document.createElement('div');
    div.className = 'msg ' + (who === 'me' ? 'me' : 'bot');
    div.textContent = text;
    UI.aiMessages.appendChild(div);
    UI.aiMessages.scrollTop = UI.aiMessages.scrollHeight;
  }

  async function sendAI() {
    const input = UI.aiInput;
    if (!input) return;
    const msg = String(input.value || '').trim();
    if (!msg) return;
    input.value = '';
    pushMsg('me', msg);

    try {
      const ctx = {
        edition: STATE.activeEdition,
        filter: STATE.activeFilter,
        cart: STATE.cart,
        shippingMode: STATE.shipMode,
        shippingLabel: shippingLabel(),
        subtotal: cartSubtotal(),
        total: cartSubtotal() + shippingAmount()
      };

      const res = await postSmart(CFG.endpoints.chat, {
        message: msg,
        context: ctx
      });

      const answer = res?.text || res?.reply || res?.message || 'Listo. ¿Qué edición quieres?';
      pushMsg('bot', String(answer));
    } catch (e) {
      console.error(e);
      pushMsg('bot', 'Ahorita traigo tráfico 😅. Intenta otra vez o escríbenos por WhatsApp.');
    }
  }

  // ---------- Escape ----------
  function escapeHtml(s) {
    return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

})();
