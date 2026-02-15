/* SCORE STORE — main.js · PROD_UNIFIED_362
   - Carrusel tipo Facebook por producto (scroll-snap + dots + flechas)
   - No cuadros vacíos si faltan imágenes (solo agrega slides que cargan)
   - encodeURI() para assets con espacios
   - Shipping: /api/quote  · Checkout: /api/checkout (con fallback a /.netlify/functions)
   - Legal modal (carga /legal.html) + cookies + SW register
*/

const BUILD_VERSION = "2026_PROD_UNIFIED_362";
const CFG = {
  catalog: "/data/catalog.json",
  endpoints: {
    quote: "/api/quote",
    checkout: "/api/checkout",
    quoteFn: "/.netlify/functions/quote_shipping",
    checkoutFn: "/.netlify/functions/create_checkout",
  },
  keyCart: "score_cart_2026",
  keyShip: "score_ship_2026",
  keyCookie: "cookieConsent",
};

const $ = (q, r = document) => r.querySelector(q);
const $$ = (q, r = document) => Array.from(r.querySelectorAll(q));
const fmt = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(n || 0));
const enc = (u) => (u ? encodeURI(String(u)) : "");
const clamp = (n, a, b) => Math.max(a, Math.min(b, Math.round(Number(n || 0))));
const jparse = (s, fb) => { try { const v = JSON.parse(s); return v ?? fb; } catch { return fb; } };

function toast(msg) {
  if (typeof window.showToastCompat === "function") { try { window.showToastCompat(msg); return; } catch {} }
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = String(msg || "");
  t.classList.add("show");
  clearTimeout(window.__t);
  window.__t = setTimeout(() => t.classList.remove("show"), 2400);
}

function killSplash(hard = false) {
  const el = document.getElementById("splash") || document.getElementById("splash-screen") || document.querySelector(".splash");
  if (!el) return;
  el.style.pointerEvents = "none";
  el.style.opacity = "0";
  el.setAttribute("aria-hidden", "true");
  if (hard) el.style.display = "none";
  else setTimeout(() => { try { el.style.display = "none"; } catch {} }, 520);
}

async function postJSON(url, payload) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  return data;
}
async function postSmart(primary, fallback, payload) {
  try { return await postJSON(primary, payload); } catch (e) { try { return await postJSON(fallback, payload); } catch { throw e; } }
}

function lsGet(key, fb) { try { const v = localStorage.getItem(key); return v === null ? fb : v; } catch { return fb; } }
function lsSet(key, val) { try { localStorage.setItem(key, val); } catch {} }
function lsDel(key) { try { localStorage.removeItem(key); } catch {} }
const STATE = {
  cart: (() => {
    const v = jparse(lsGet(CFG.keyCart, "[]"), []);
    if (Array.isArray(v)) return v;
    lsDel(CFG.keyCart);
    return [];
  })(),
  ship: (() => {
    const v = jparse(lsGet(CFG.keyShip, ""), null);
    if (v && typeof v === "object") return { mode: v.mode || "pickup", country: (v.country || "MX").toUpperCase(), zip: v.zip || "", amount: Number(v.amount || 0), label: v.label || "", quoted: !!(v.quoted ?? (v.mode === "pickup")) };
    return { mode: "pickup", country: "MX", zip: "", amount: 0, label: "Pickup Gratis", quoted: true };
  })(),
  products: [],
  sections: [],
  filter: "ALL",
  legalHtml: null,
};

function drawerEl() { return document.getElementById("cartDrawer") || document.querySelector(".drawer"); }
function overlayEl() { return document.getElementById("pageOverlay") || document.getElementById("overlay") || document.querySelector(".overlay"); }
function drawerBodyEl() { return document.getElementById("drawerBody") || document.getElementById("cartItems") || document.querySelector(".drawerBody"); }
function gridEl() { return document.getElementById("productsGrid") || document.querySelector(".productsGrid") || document.querySelector(".grid"); }
function chipsEl() { return document.getElementById("chips") || document.querySelector(".filters") || document.querySelector(".chips"); }
function totalsEls() {
  return {
    sub: document.getElementById("subtotalLabel") || document.getElementById("cartSubtotal"),
    ship: document.getElementById("shipLabel") || document.getElementById("cartShipping"),
    total: document.getElementById("totalLabel") || document.getElementById("cartTotal"),
  };
}

function openDrawer() {
  drawerEl()?.classList.add("open");
  overlayEl()?.classList.add("show");
  document.body.classList.add("no-scroll");
}
function closeDrawer() {
  drawerEl()?.classList.remove("open");
  overlayEl()?.classList.remove("show");
  document.body.classList.remove("no-scroll");
}
window.openDrawer = openDrawer;
window.closeDrawer = closeDrawer;

function cartQty() { return (STATE.cart || []).reduce((a, it) => a + clamp(it?.qty, 0, 99), 0); }
function subtotal() { return (STATE.cart || []).reduce((a, it) => a + Number(it.price || 0) * clamp(it.qty, 0, 99), 0); }
function shipCost() { return STATE.ship.mode === "pickup" ? 0 : Number(STATE.ship.amount || 0); }

function persistCart() { lsSet(CFG.keyCart, JSON.stringify(STATE.cart || [])); }
function persistShip() { lsSet(CFG.keyShip, JSON.stringify(STATE.ship || {})); }

function updateBadge() {
  const n = String(cartQty());
  const nodes = [document.getElementById("cartCount"), ...$$(".cartCount")].filter(Boolean);
  nodes.forEach((el) => { try { el.textContent = n; } catch {} });
}

function updateTotals() {
  const t = totalsEls();
  const sub = subtotal();
  const ship = shipCost();
  const total = sub + ship;
  if (t.sub) t.sub.textContent = fmt(sub);
  if (t.ship) t.ship.textContent = fmt(ship);
  if (t.total) t.total.textContent = fmt(total);

  const heroLabel = document.getElementById("shipLabelHero") || document.getElementById("shipQuote");
  const drawerLabel = document.getElementById("shipLabelDrawer");
  const labelText = STATE.ship.mode === "pickup" ? "Pickup Gratis" : (STATE.ship.quoted ? `${STATE.ship.label || "Envío"}: ${fmt(ship)}` : "Cotiza envío para ver total.");
  if (heroLabel) heroLabel.textContent = labelText;
  if (drawerLabel) drawerLabel.textContent = labelText;

  persistShip();
}

function setShipMode(mode, { silent } = {}) {
  const m = String(mode || "pickup").toLowerCase();
  if (!["pickup", "mx", "us"].includes(m)) return;
  STATE.ship.mode = m;
  STATE.ship.country = m === "us" ? "US" : "MX";
  STATE.ship.zip = STATE.ship.zip || "";
  if (m === "pickup") { STATE.ship.amount = 0; STATE.ship.label = "Pickup Gratis"; STATE.ship.quoted = true; }
  else { STATE.ship.amount = 0; STATE.ship.label = m === "us" ? "Envío USA" : "Envío México"; STATE.ship.quoted = false; }
  if (!silent) syncShipUI();
  updateTotals();
}
window.toggleShipping = (m) => setShipMode(m);

function pickZip() {
  const z = (id) => (document.getElementById(id)?.value || "");
  const raw = z("zipInputHero") || z("zipInputDrawer") || z("miniZip") || z("shipZip") || STATE.ship.zip || "";
  return String(raw).replace(/[^\d]/g, "").slice(0, 5);
}

function syncShipUI() {
  $$(`input[name='shipModeHero']`).forEach((r) => (r.checked = String(r.value).toLowerCase() === STATE.ship.mode));
  $$(`input[name='shipMode']`).forEach((r) => (r.checked = String(r.value).toLowerCase() === STATE.ship.mode));

  const showZip = STATE.ship.mode !== "pickup";
  const wrapHero = document.getElementById("zipWrapHero") || document.getElementById("shipZipWrap") || document.getElementById("shipZipWrapHero");
  if (wrapHero) wrapHero.style.display = showZip ? "block" : "none";
  const wrapDrawer = document.querySelector(".shipMiniZip");
  if (wrapDrawer) wrapDrawer.style.display = showZip ? "flex" : "none";

  const zip = STATE.ship.zip ? String(STATE.ship.zip) : "";
  ["zipInputHero", "zipInputDrawer", "miniZip", "shipZip"].forEach((id) => {
    const el = document.getElementById(id);
    if (el && zip && !el.value) el.value = zip;
  });
}
async function quoteShippingUI() {
  if (!STATE.cart.length) return toast("Tu carrito está vacío.");
  if (STATE.ship.mode === "pickup") { setShipMode("pickup"); return toast("Pickup: $0"); }

  const zip = pickZip();
  if (zip.length !== 5) return toast("CP/ZIP inválido (5 dígitos)." );
  STATE.ship.zip = zip;

  const items = STATE.cart.map((it) => ({ id: it.id, qty: clamp(it.qty, 1, 99) }));
  const payload = { zip, country: STATE.ship.country, items };

  const heroLabel = document.getElementById("shipLabelHero") || document.getElementById("shipQuote");
  const drawerLabel = document.getElementById("shipLabelDrawer");
  if (heroLabel) heroLabel.textContent = "Cotizando…";
  if (drawerLabel) drawerLabel.textContent = "Cotizando…";

  try {
    const data = await postSmart(CFG.endpoints.quote, CFG.endpoints.quoteFn, payload);
    STATE.ship.amount = Math.max(0, Math.round(Number(data.amount || 0)));
    STATE.ship.label = String(data.label || (STATE.ship.mode === "us" ? "Envío USA" : "Envío México"));
    STATE.ship.quoted = true;
    updateTotals();
    toast(`${STATE.ship.label}: ${fmt(STATE.ship.amount)}`);
  } catch (e) {
    console.error("[quote]", e);
    STATE.ship.amount = 0;
    STATE.ship.quoted = false;
    updateTotals();
    toast("No se pudo cotizar. Intenta otra vez.");
  }
}
window.quoteShippingUI = quoteShippingUI;

function saveCart() {
  persistCart();
  updateBadge();
  renderDrawer();
  updateTotals();
}

function addToCart(pid) {
  const p = STATE.products.find((x) => String(x.id) === String(pid));
  if (!p) return;
  const safeId = String(p.id || "").replace(/[^a-z0-9]/gi, "");
  const size = document.getElementById(`size-${safeId}`)?.value || "Unitalla";
  const key = `${p.id}::${size}`;
  const it = STATE.cart.find((x) => x.key === key);
  if (it) it.qty = clamp(Number(it.qty || 1) + 1, 1, 99);
  else STATE.cart.push({ key, id: p.id, name: p.name, price: Number(p.baseMXN || 0), img: p.img, size, qty: 1 });
  if (STATE.ship.mode !== "pickup") STATE.ship.quoted = false;
  saveCart();
  openDrawer();
}
window.addToCart = addToCart;

function renderDrawer() {
  const host = drawerBodyEl();
  if (!host) return;

  if (!host.querySelector(".shipMini")) {
    const d = document.createElement("div");
    d.className = "shipMini";
    d.innerHTML = `
      <div class="shipMiniTitle">Entrega</div>
      <div class="shipMiniRow">
        <label class="radioPill"><input type="radio" name="shipMode" value="pickup"><span>Pickup</span></label>
        <label class="radioPill"><input type="radio" name="shipMode" value="mx"><span>México</span></label>
        <label class="radioPill"><input type="radio" name="shipMode" value="us"><span>USA</span></label>
      </div>
      <div class="shipMiniZip" style="display:none">
        <input id="zipInputDrawer" class="zipInput" inputmode="numeric" placeholder="CP/ZIP (5 dígitos)">
        <button class="btn small" type="button" id="quoteDrawerBtn">Cotizar</button>
      </div>
      <div class="shipMiniHint"><span id="shipLabelDrawer">Pickup Gratis</span></div>
      <div class="shipMiniDivider"></div>
    `;
    host.prepend(d);
  }

  let list = host.querySelector(".cartItemsList");
  if (!list) { list = document.createElement("div"); list.className = "cartItemsList"; host.appendChild(list); }

  list.innerHTML = "";

  if (!STATE.cart.length) {
    list.innerHTML = `<p class="emptyCart">Tu carrito está vacío</p>`;
  } else {
    STATE.cart.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = "cartRow";
      row.innerHTML = `
        <div class="cartThumb"><img src="${enc(it.img)}" alt=""></div>
        <div class="cartInfo">
          <div class="name">${it.name || ""}</div>
          <div class="meta">Talla: <b>${it.size || "Unitalla"}</b></div>
          <div class="meta">${fmt(it.price)} c/u</div>
          <div class="qtyBar">
            <button class="qtyBtn" type="button" data-m="${i}">−</button>
            <span class="qtyNum">${clamp(it.qty, 1, 99)}</span>
            <button class="qtyBtn" type="button" data-p="${i}">+</button>
          </div>
        </div>
        <div class="cartRight">
          <div class="lineTotal">${fmt(Number(it.price || 0) * clamp(it.qty, 1, 99))}</div>
          <button class="removeBtn" type="button" data-r="${i}">✕</button>
        </div>
      `;
      list.appendChild(row);
    });
  }

  if (!host.__bound) {
    host.__bound = true;

    host.addEventListener("click", (e) => {
      const t = e.target;
      const rm = t?.getAttribute?.("data-r");
      const mi = t?.getAttribute?.("data-m");
      const pi = t?.getAttribute?.("data-p");

      if (rm !== null && rm !== undefined) {
        STATE.cart.splice(clamp(rm, 0, 9999), 1);
        if (!STATE.cart.length) setShipMode("pickup", { silent: true });
        if (STATE.ship.mode !== "pickup") STATE.ship.quoted = false;
        return saveCart();
      }
      if (mi !== null && mi !== undefined) {
        const i = clamp(mi, 0, 9999);
        if (STATE.cart[i]) STATE.cart[i].qty = clamp(Number(STATE.cart[i].qty || 1) - 1, 1, 99);
        if (STATE.ship.mode !== "pickup") STATE.ship.quoted = false;
        return saveCart();
      }
      if (pi !== null && pi !== undefined) {
        const i = clamp(pi, 0, 9999);
        if (STATE.cart[i]) STATE.cart[i].qty = clamp(Number(STATE.cart[i].qty || 1) + 1, 1, 99);
        if (STATE.ship.mode !== "pickup") STATE.ship.quoted = false;
        return saveCart();
      }
      if (t?.id === "quoteDrawerBtn") quoteShippingUI();
    });

    host.addEventListener("change", (e) => {
      const r = e.target.closest?.("input[name='shipMode']");
      if (r) setShipMode(r.value);
    });

    host.addEventListener("keydown", (e) => {
      if (e.target?.id === "zipInputDrawer" && e.key === "Enter") quoteShippingUI();
    });
  }

  syncShipUI();
}
window.doCheckout = async () => {
  if (!STATE.cart.length) return toast("Agrega productos al carrito.");
  if (STATE.ship.mode !== "pickup" && !STATE.ship.quoted) {
    await quoteShippingUI();
    if (!STATE.ship.quoted) return;
  }

  try { if (typeof fbq === "function") fbq("track", "InitiateCheckout", { num_items: cartQty(), currency: "MXN", value: subtotal() }); } catch {}

  const payload = {
    cart: STATE.cart,
    shipping: shipCost(),
    shippingLabel: STATE.ship.label,
    shippingMode: STATE.ship.mode,
    shippingData: { postal_code: STATE.ship.zip || pickZip() || "", country: STATE.ship.country || "MX" },
  };

  const btn = document.getElementById("checkoutBtn") || document.querySelector(".drawerFoot .btn.primary") || document.querySelector("[data-checkout]");
  const txt = btn ? btn.textContent : "";

  try {
    if (btn) { btn.disabled = true; btn.textContent = "PROCESANDO…"; }
    const data = await postSmart(CFG.endpoints.checkout, CFG.endpoints.checkoutFn, payload);
    if (data?.url) return (window.location.href = data.url);
    throw new Error(data?.error || "No se recibió URL de pago.");
  } catch (e) {
    console.error("[checkout]", e);
    toast("Checkout falló. Revisa tu conexión.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = txt || "Pagar con Stripe"; }
  }
};

/* ---------- Carrusel ---------- */
function preload(url, timeout = 6500) {
  return new Promise((ok) => {
    if (!url) return ok(false);
    const img = new Image();
    let done = false;
    const fin = (v) => { if (done) return; done = true; try { img.onload = img.onerror = null; } catch {} ok(v); };
    const t = setTimeout(() => fin(false), timeout);
    img.onload = () => { clearTimeout(t); fin(true); };
    img.onerror = () => { clearTimeout(t); fin(false); };
    img.src = enc(url);
  });
}

function carouselShell(pid) {
  const root = document.createElement("div");
  root.className = "p-carousel";
  root.dataset.pid = pid;
  root.innerHTML = `<button class="p-nav prev" type="button" aria-label="Anterior">‹</button><div class="p-track" tabindex="0"></div><button class="p-nav next" type="button" aria-label="Siguiente">›</button><div class="p-dots" aria-hidden="true"></div>`;
  return root;
}

function setDots(root, n, active) {
  const d = $(".p-dots", root);
  if (!d) return;
  d.innerHTML = "";
  if (n <= 1) { d.style.display = "none"; return; }
  d.style.display = "flex";
  for (let i = 0; i < n; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `p-dot${i === active ? " active" : ""}`;
    b.addEventListener("click", () => scrollTo(root, i));
    d.appendChild(b);
  }
}

function scrollTo(root, idx) {
  const tr = $(".p-track", root);
  if (!tr) return;
  const w = tr.clientWidth || 1;
  tr.scrollTo({ left: idx * w, behavior: "smooth" });
}

function bindCarousel(root) {
  if (root.__b) return;
  root.__b = true;
  const tr = $(".p-track", root);
  const prev = $(".p-nav.prev", root);
  const next = $(".p-nav.next", root);

  const upd = () => {
    const w = tr.clientWidth || 1;
    const idx = Math.round(tr.scrollLeft / w);
    root.dataset.active = String(idx);
    $$(".p-dot", root).forEach((x, i) => x.classList.toggle("active", i === idx));
  };

  tr.addEventListener("scroll", () => requestAnimationFrame(upd));
  tr.addEventListener("keydown", (e) => {
    const c = Number(root.dataset.count || 1);
    const a = Number(root.dataset.active || 0);
    if (e.key === "ArrowLeft") scrollTo(root, clamp(a - 1, 0, c - 1));
    if (e.key === "ArrowRight") scrollTo(root, clamp(a + 1, 0, c - 1));
  });

  const go = (dir) => {
    const c = Number(root.dataset.count || 1);
    const a = Number(root.dataset.active || 0);
    if (c <= 1) return;
    scrollTo(root, clamp(a + dir, 0, c - 1));
  };

  prev.addEventListener("click", () => go(-1));
  next.addEventListener("click", () => go(1));
}

function placeholder(root, text) {
  const tr = $(".p-track", root);
  tr.innerHTML = `<div class="p-slide placeholder"><div class="p-placeholder"><div class="p-ph-title">Foto en proceso</div><div class="p-ph-sub">${text || "Estamos cargando imágenes reales."}</div></div></div>`;
  root.dataset.count = "1";
  root.dataset.active = "0";
  setDots(root, 1, 0);
  $$(".p-nav", root).forEach((b) => (b.style.display = "none"));
  bindCarousel(root);
}

function addSlide(root, url, alt) {
  const tr = $(".p-track", root);
  tr.querySelector(".p-slide.placeholder")?.remove();
  const slide = document.createElement("div");
  slide.className = "p-slide";
  slide.innerHTML = `<img loading="lazy" alt="${alt || ""}">`;
  slide.querySelector("img").src = enc(url);
  tr.appendChild(slide);
  const c = tr.children.length;
  root.dataset.count = String(c);
  root.dataset.active = root.dataset.active || "0";
  setDots(root, c, Number(root.dataset.active || 0));
  $$(".p-nav", root).forEach((b) => (b.style.display = c > 1 ? "grid" : "none"));
  bindCarousel(root);
}

async function hydrateCarousel(root, p) {
  placeholder(root, p.tagline || "");
  const urls = Array.from(new Set([...(Array.isArray(p.images) ? p.images : []), p.img].filter(Boolean)));
  let loaded = 0;
  for (const u of urls) {
    // eslint-disable-next-line no-await-in-loop
    if (await preload(u)) { addSlide(root, u, p.name); loaded++; if (loaded >= 8) break; }
  }
  if (!loaded) root.classList.add("no-images");
}

function renderGrid() {
  const grid = gridEl();
  if (!grid) return;

  const list = (STATE.products || []).filter((p) => {
    const sec = String(p.sectionId || "").toUpperCase();
    if (STATE.filter === "ALL") return true;
    if (STATE.filter === "HOODIES") return String(p.subSection || "") === "Hoodies";
    if (STATE.filter === "TEES") return String(p.subSection || "") === "Camisetas";
    if (STATE.filter === "CAPS") return String(p.subSection || "") === "Gorras";
    return sec === STATE.filter;
  });

  if (!list.length) {
    grid.innerHTML = `<div class="emptyState"><b>No hay productos en este filtro.</b><div class="muted">Prueba con “Todo”.</div></div>`;
    return;
  }

  grid.innerHTML = "";
  list.forEach((p) => {
    const safeId = String(p.id || "").replace(/[^a-z0-9]/gi, "");
    const sizes = Array.isArray(p.sizes) && p.sizes.length ? p.sizes : ["Unitalla"];

    const card = document.createElement("div");
    card.className = "product-card";
    card.innerHTML = `
      <div class="p-media"></div>
      <div class="p-body">
        <div class="p-top"><h3 class="p-name">${p.name || ""}</h3><span class="p-price">${fmt(p.baseMXN)}</span></div>
        ${p.tagline ? `<div class="p-tagline">${p.tagline}</div>` : ""}
        <select id="size-${safeId}" class="p-size-sel" aria-label="Talla">${sizes.map((s) => `<option value="${s}">${s}</option>`).join("")}</select>
        <button class="p-btn-add" type="button" data-add="${p.id}">AGREGAR AL CARRITO</button>
      </div>
    `;

    const c = carouselShell(p.id);
    card.querySelector(".p-media").appendChild(c);
    card.querySelector("[data-add]").addEventListener("click", () => addToCart(p.id));

    grid.appendChild(card);
    hydrateCarousel(c, p);
  });
}

function buildChips() {
  const host = chipsEl();
  if (!host) return;

  const mk = (txt, id, active) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `chip${active ? " active" : ""}`;
    b.dataset.filter = String(id).toUpperCase();
    b.textContent = txt;
    b.addEventListener("click", () => {
      $$(".chip", host).forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      STATE.filter = String(b.dataset.filter || "ALL");
      renderGrid();
    });
    return b;
  };

  host.innerHTML = "";
  host.appendChild(mk("Todo", "ALL", true));
  host.appendChild(mk("Hoodies", "HOODIES", false));
  host.appendChild(mk("Camisetas", "TEES", false));
  host.appendChild(mk("Gorras", "CAPS", false));
  (STATE.sections || []).forEach((s) => {
    const id = String(s.id || "").toUpperCase();
    if (!id) return;
    host.appendChild(mk(String(s.title || id).trim(), id, false));
  });
}

async function loadCatalog() {
  const res = await fetch(CFG.catalog, { cache: "no-store" });
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const data = await res.json();
  STATE.sections = Array.isArray(data.sections) ? data.sections : [];
  STATE.products = Array.isArray(data.products) ? data.products.map((p) => ({ ...p, sectionId: String(p.sectionId || "").toUpperCase(), img: String(p.img || ""), images: Array.isArray(p.images) ? p.images.map(String) : [] })) : [];
}

/* ---------- Legal modal ---------- */
async function getLegalHtml() {
  if (STATE.legalHtml) return STATE.legalHtml;
  try { const r = await fetch("/legal.html", { cache: "no-store" }); const t = await r.text(); STATE.legalHtml = t; return t; } catch { return null; }
}
function openLegal() {
  const modal = document.getElementById("legalModal");
  const body = document.getElementById("legalBody");
  const title = document.getElementById("legalTitle") || $("#legalModal .modalTitle");
  if (!modal || !body) return (window.location.href = "/legal.html");
  modal.classList.add("show", "active");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("no-scroll");

  (async () => {
    const html = await getLegalHtml();
    if (!html) { if (title) title.textContent = "Legal"; body.innerHTML = `<h2>Legal</h2><p>Consulta nuestros términos y privacidad en esta sección.</p>`; return; }
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const main = doc.querySelector("main") || doc.body;
      if (title) title.textContent = doc.title ? doc.title.replace(/\s+\|.*$/, "") : "Legal";
      body.innerHTML = main ? main.innerHTML : body.innerHTML;
    } catch {
      if (title) title.textContent = "Legal";
      body.innerHTML = `<h2>Legal</h2><p>Consulta nuestros términos y privacidad en esta sección.</p>`;
    }
  })();
}
function closeLegal() {
  const modal = document.getElementById("legalModal");
  if (!modal) return;
  modal.classList.remove("show", "active");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("no-scroll");
}
window.openLegal = openLegal;
window.closeLegal = closeLegal;

/* ---------- Cookies ---------- */
function initCookies() {
  const b = document.getElementById("cookieBanner");
  if (!b) return;
  b.style.display = lsGet(CFG.keyCookie, "") === "1" ? "none" : "flex";
}
window.acceptCookies = () => { lsSet(CFG.keyCookie, "1"); const b = document.getElementById("cookieBanner"); if (b) b.style.display = "none"; };

/* ---------- SW ---------- */
function regSW() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", async () => {
    try { const reg = await navigator.serviceWorker.register(`/sw.js?v=${BUILD_VERSION}`); if (reg?.update) await reg.update(); } catch (e) { console.warn("[sw]", e); }
  });
}

function handleQuery() {
  try {
    const p = new URLSearchParams(location.search);
    const st = p.get("status");
    const oc = p.get("openCart");
    if (st === "success") { toast("✅ Pago confirmado. Gracias 🙌"); STATE.cart = []; saveCart(); p.delete("status"); history.replaceState({}, document.title, location.pathname + (p.toString() ? `?${p}` : "") + location.hash); }
    if (st === "cancel") { toast("Pago cancelado. Tu carrito sigue listo."); p.delete("status"); history.replaceState({}, document.title, location.pathname + (p.toString() ? `?${p}` : "") + location.hash); }
    if (oc === "1") setTimeout(openDrawer, 320);
  } catch {}
}

window.addEventListener("error", () => killSplash(true));
window.addEventListener("unhandledrejection", () => killSplash(true));

document.addEventListener("DOMContentLoaded", async () => {
  setTimeout(() => killSplash(false), 900);

  overlayEl()?.addEventListener("click", closeDrawer);

  $$("input[name='shipModeHero']").forEach((r) => r.addEventListener("change", () => setShipMode(r.value)));
  ["zipInputHero", "shipZip"].forEach((id) => document.getElementById(id)?.addEventListener("keydown", (e) => { if (e.key === "Enter") quoteShippingUI(); }));

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeLegal(); closeDrawer(); } });
  $$(".partnersGrid img").forEach((img) => img.addEventListener("error", () => (img.style.display = "none")));

  initCookies();

  try {
    await loadCatalog();
    buildChips();
    renderGrid();
  } catch (e) {
    console.error("[catalog]", e);
    gridEl() && (gridEl().innerHTML = `<div class="emptyState"><b>No se pudo cargar el catálogo.</b><div class="muted">Revisa /data/catalog.json y la consola.</div></div>`);
    toast("No se pudo cargar el catálogo");
  }

  updateBadge();
  renderDrawer();
  syncShipUI();
  updateTotals();

  regSW();
  handleQuery();
  killSplash(false);
});
