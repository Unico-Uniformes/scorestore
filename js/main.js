/* SCORE STORE — main.js (production)
   - Home: Hero → Catálogos → Partners → Footer
   - UI blanca con acentos negro/rojo
   - Catálogos por edición con logos flotantes
   - Carrito con envío SOLO dentro del carrito (Pickup / Local TJ / Envia MX / Envia USA)
   - Código promocional (preview frontend + validación real backend)
   - Meta Pixel con consentimiento
   - Score AI (botón flotante) via /api/chat
*/

const CONFIG = {
  catalogUrl: "/data/catalog.json",
  promosUrl: "/data/promos.json",
  endpoints: {
    quote: "/api/quote",
    checkout: "/api/checkout",
    ai: "/api/chat",
  },
  storage: {
    cart: "scorestore_cart_v1",
    promo: "scorestore_promo_v1",
    consent: "scorestore_cookie_consent_v1",
  },
  metaPixelId: "4249947775334413",
};

const $ = (q) => document.querySelector(q);
const fmtMXN = (n) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(n || 0));

const STATE = {
  catalog: null,
  sections: [],
  products: [],
  currentSectionId: null,

  cart: loadJson(CONFIG.storage.cart, []),
  shipping: {
    mode: "pickup", // pickup | local_tj | envia_mx | envia_us
    postal_code: "",
    amount_cents: 0,
    service: "",
    quoted: false,
  },
  promo: loadJson(CONFIG.storage.promo, null), // {code,type,value,min_subtotal_mxn,active}
  promosDb: null,

  ai: {
    messages: [],
    busy: false,
  },
};

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function toast(msg) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = String(msg || "");
  el.style.display = "block";
  clearTimeout(window.__toast_t);
  window.__toast_t = setTimeout(() => (el.style.display = "none"), 2200);
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function getJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function postJSON(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  return data;
}

function cartQty() {
  return (STATE.cart || []).reduce((a, b) => a + (Number(b.qty) || 0), 0);
}

function openOverlay() { $("#pageOverlay")?.classList.add("show"); }
function closeOverlay() { $("#pageOverlay")?.classList.remove("show"); }

function openDrawer() { $("#cartDrawer")?.classList.add("show"); openOverlay(); }
function closeDrawer() { $("#cartDrawer")?.classList.remove("show"); closeOverlay(); }

function openModal(id) { $(id)?.classList.add("show"); openOverlay(); }
function closeModal(id) { $(id)?.classList.remove("show"); closeOverlay(); }

function setCartCount() {
  const el = $("#cartCount");
  if (el) el.textContent = String(cartQty());
}

/* ------------------------------
   Catalog render
---------------------------------*/
function renderEditionGrid() {
  const host = $("#editionGrid");
  if (!host) return;
  host.innerHTML = "";

  for (const s of STATE.sections) {
    const card = document.createElement("div");
    card.className = "editionCard";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Abrir catálogo ${s.name}`);

    const cover = s.cover || "/assets/hero.webp";
    const logo = s.logo || "";

    card.innerHTML = `
      <img class="editionCover" src="${cover}" alt="${escapeHtml(s.name)}" loading="lazy" />
      ${logo ? `<div class="editionPill"><img src="${logo}" alt="" /></div>` : ""}
      <div class="editionBody">
        <h3 class="editionTitle">${escapeHtml(s.name)}</h3>
        <p class="editionMeta">${escapeHtml(s.subtitle || "Explora el merch disponible")}</p>
      </div>
    `;

    card.addEventListener("click", () => openSection(s.id));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openSection(s.id);
      }
    });

    host.appendChild(card);
  }
}

function openSection(sectionId) {
  STATE.currentSectionId = sectionId;
  const sec = STATE.sections.find((x) => x.id === sectionId);
  const panel = $("#productsPanel");
  if (!panel) return;

  $("#editionTitle").textContent = sec?.name || "Edición";
  $("#editionMeta").textContent = sec?.meta || "Selecciona un producto para ver detalles.";

  renderProducts(sectionId);
  panel.classList.remove("hide");
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderProducts(sectionId) {
  const host = $("#productsGrid");
  if (!host) return;
  host.innerHTML = "";

  const products = (STATE.products || []).filter((p) => p.sectionId === sectionId);
  if (!products.length) {
    host.innerHTML = `<p class="muted" style="padding:10px 0">No hay productos en esta edición todavía.</p>`;
    return;
  }

  for (const p of products) {
    const card = document.createElement("div");
    card.className = "productCard";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Ver ${p.name}`);

    card.innerHTML = `
      <img class="productImg" src="${p.img}" alt="${escapeHtml(p.name)}" loading="lazy" />
      <div class="productBody">
        <h4 class="productName">${escapeHtml(p.name)}</h4>
        <div class="productSub">${escapeHtml(p.short || p.desc || "")}</div>
        <div class="productPrice">${fmtMXN((Number(p.price_cents) || 0) / 100)}</div>
      </div>
    `;

    card.addEventListener("click", () => openProduct(p.sku));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openProduct(p.sku);
      }
    });

    host.appendChild(card);
  }
}

/* ------------------------------
   Product modal
---------------------------------*/
function openProduct(sku) {
  const p = STATE.products.find((x) => x.sku === sku);
  if (!p) return;

  $("#productTitle").textContent = p.name;

  const sizes = Array.isArray(p.sizes) && p.sizes.length ? p.sizes : ["S", "M", "L", "XL"];
  const images = Array.isArray(p.images) && p.images.length ? p.images : [p.img];

  const safeSku = sku.replace(/[^a-zA-Z0-9_-]/g, "");

  const body = $("#productBody");
  body.innerHTML = `
    <div class="productGallery">
      ${images
        .slice(0, 6)
        .map((src) => `<img class="galleryImg" src="${src}" alt="${escapeHtml(p.name)}" loading="lazy" />`)
        .join("")}
    </div>

    <div style="margin-top:14px">
      <div class="muted" style="font-weight:850">${escapeHtml(p.desc || "")}</div>
    </div>

    <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between">
      <div style="font-weight:1100;color:var(--red);font-size:20px">${fmtMXN((Number(p.price_cents) || 0) / 100)}</div>
      <div class="muted" style="font-weight:850">SKU: ${escapeHtml(p.sku)}</div>
    </div>

    <div style="margin-top:14px">
      <div style="font-weight:1000;margin-bottom:10px">Selecciona talla</div>
      <div class="sizeGrid" id="sizeGrid-${safeSku}">
        ${sizes.map((s, i) => `<button class="sizeBtn ${i === 1 ? "active" : ""}" type="button" data-size="${s}">${s}</button>`).join("")}
      </div>
    </div>

    <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between">
      <button class="btn btnPrimary" type="button" id="addToCartBtn">Agregar al carrito</button>
      <button class="btn" type="button" id="buyNowBtn">Comprar ahora</button>
    </div>
  `;

  let selectedSize = sizes[1] || sizes[0];

  const grid = $(`#sizeGrid-${safeSku}`);
  grid?.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("button[data-size]");
    if (!btn) return;
    selectedSize = btn.dataset.size;
    grid.querySelectorAll(".sizeBtn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });

  $("#addToCartBtn").addEventListener("click", () => {
    addToCart(p.sku, selectedSize, 1);
    closeModal("#productModal");
    toast("Agregado al carrito");
  });

  $("#buyNowBtn").addEventListener("click", () => {
    addToCart(p.sku, selectedSize, 1);
    closeModal("#productModal");
    openDrawer();
  });

  openModal("#productModal");
}

/* ------------------------------
   Cart
---------------------------------*/
function addToCart(sku, size, qty) {
  const p = STATE.products.find((x) => x.sku === sku);
  if (!p) return;

  const key = `${sku}::${String(size || "M").trim()}`;
  const existing = STATE.cart.find((x) => x.key === key);
  if (existing) existing.qty += Number(qty) || 1;
  else
    STATE.cart.push({
      key,
      sku,
      size: String(size || "M").trim(),
      qty: Number(qty) || 1,
      name: p.name,
      img: p.img,
    });

  if (STATE.shipping.mode === "envia_mx" || STATE.shipping.mode === "envia_us") {
    STATE.shipping.quoted = false;
  }

  saveJson(CONFIG.storage.cart, STATE.cart);
  setCartCount();
  renderCartDrawer();
  updateTotals();
}

function removeFromCart(key) {
  STATE.cart = STATE.cart.filter((x) => x.key !== key);
  saveJson(CONFIG.storage.cart, STATE.cart);
  setCartCount();
  renderCartDrawer();
  updateTotals();
}

function setQty(key, newQty) {
  const it = STATE.cart.find((x) => x.key === key);
  if (!it) return;
  it.qty = Math.max(1, Math.min(99, Number(newQty) || 1));
  saveJson(CONFIG.storage.cart, STATE.cart);

  if (STATE.shipping.mode === "envia_mx" || STATE.shipping.mode === "envia_us") {
    STATE.shipping.quoted = false;
  }

  setCartCount();
  renderCartDrawer();
  updateTotals();
}

function cartSubtotalCents() {
  let sum = 0;
  for (const it of STATE.cart) {
    const p = STATE.products.find((x) => x.sku === it.sku);
    if (!p) continue;
    sum += (Number(p.price_cents) || 0) * (Number(it.qty) || 0);
  }
  return sum;
}

function promoDiscountCents(subtotalCents) {
  const promo = STATE.promo;
  if (!promo || !promo.code || !promo.active) return 0;

  const subtotalMxn = subtotalCents / 100;
  if (promo.min_subtotal_mxn && subtotalMxn < promo.min_subtotal_mxn) return 0;

  if (promo.type === "percent") {
    const pct = Number(promo.value) || 0;
    return Math.round(subtotalCents * (pct / 100));
  }
  if (promo.type === "fixed_mxn") {
    const fixed = Math.round((Number(promo.value) || 0) * 100);
    return Math.min(fixed, subtotalCents);
  }
  return 0;
}

function effectiveShippingCents() {
  if (STATE.promo && STATE.promo.active && STATE.promo.type === "free_shipping") return 0;
  return Number(STATE.shipping.amount_cents) || 0;
}

function updateTotals() {
  const subtotalCents = cartSubtotalCents();
  const discountCents = promoDiscountCents(subtotalCents);
  const shippingCents = effectiveShippingCents();
  const totalCents = Math.max(0, subtotalCents - discountCents + shippingCents);

  $("#cartSubtotal").textContent = fmtMXN(subtotalCents / 100);
  $("#cartShipping").textContent = fmtMXN(shippingCents / 100);
  $("#cartTotal").textContent = fmtMXN(totalCents / 100);

  const shipLabelEl = $("#cartShipLabel");
  if (shipLabelEl) shipLabelEl.textContent = shippingLabel();

  const discountRow = $("#discountRow");
  if (discountRow) discountRow.style.display = discountCents > 0 ? "flex" : "none";
  const discountEl = $("#cartDiscount");
  if (discountEl) discountEl.textContent = "-" + fmtMXN(discountCents / 100);

  const checkoutBtn = $("#checkoutBtn");
  if (checkoutBtn) checkoutBtn.disabled = !STATE.cart.length;
}

function shippingLabel() {
  const mode = STATE.shipping.mode;
  if (mode === "pickup") return "Pickup";
  if (mode === "local_tj") return "Envío local TJ (Uber/Didi)";
  if (mode === "envia_mx") return "Envío Nacional (Envia.com)";
  if (mode === "envia_us") return "Envío USA (Envia.com)";
  return "Entrega";
}

function renderCartDrawer() {
  const host = $("#drawerBody");
  if (!host) return;

  if (!STATE.cart.length) {
    host.innerHTML = `
      <p class="muted" style="text-align:center;margin:20px 0;font-weight:850">Tu carrito está vacío</p>
      <div style="text-align:center">
        <a class="btn btnPrimary" href="#editions" onclick="closeDrawer()">Ver catálogos</a>
      </div>
    `;
    return;
  }

  const itemsHtml = STATE.cart
    .map((it) => {
      const p = STATE.products.find((x) => x.sku === it.sku);
      const price = (Number(p?.price_cents) || 0) / 100;
      return `
        <div class="cartItem">
          <img class="cartThumb" src="${it.img}" alt="" />
          <div>
            <div class="cartName">${escapeHtml(it.name)}</div>
            <div class="cartMeta">Talla: <strong>${escapeHtml(it.size)}</strong></div>
            <div class="cartRow">
              <div class="qty">
                <button type="button" aria-label="Menos" data-act="dec" data-key="${escapeHtml(it.key)}">−</button>
                <span>${Number(it.qty) || 1}</span>
                <button type="button" aria-label="Más" data-act="inc" data-key="${escapeHtml(it.key)}">+</button>
              </div>
              <div style="font-weight:1100;color:var(--red)">${fmtMXN(price)}</div>
              <button class="btn" type="button" style="padding:8px 12px" data-act="rm" data-key="${escapeHtml(it.key)}">Quitar</button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  host.innerHTML = `
    <div>${itemsHtml}</div>

    <div style="margin-top:14px">
      <h4 style="margin:0 0 10px;font-weight:1100">Entrega</h4>

      <label class="radioRow">
        <input type="radio" name="ship" value="pickup" ${STATE.shipping.mode === "pickup" ? "checked" : ""}/>
        <div>
          <p class="radioTitle">Pickup en fábrica</p>
          <p class="radioSub">Recoges directo en fábrica. Gratis.</p>
        </div>
      </label>

      <label class="radioRow">
        <input type="radio" name="ship" value="local_tj" ${STATE.shipping.mode === "local_tj" ? "checked" : ""}/>
        <div>
          <p class="radioTitle">Envío local Tijuana (Uber/Didi)</p>
          <p class="radioSub">Solo dentro de Tijuana. El costo se coordina contigo según Uber/Didi.</p>
        </div>
      </label>

      <label class="radioRow">
        <input type="radio" name="ship" value="envia_mx" ${STATE.shipping.mode === "envia_mx" ? "checked" : ""}/>
        <div>
          <p class="radioTitle">Envío Nacional (Envia.com)</p>
          <p class="radioSub">Cotización y guía en tiempo real con Envia.com.</p>
        </div>
      </label>

      <label class="radioRow">
        <input type="radio" name="ship" value="envia_us" ${STATE.shipping.mode === "envia_us" ? "checked" : ""}/>
        <div>
          <p class="radioTitle">Envío USA (Envia.com)</p>
          <p class="radioSub">Cotización y guía en tiempo real con Envia.com.</p>
        </div>
      </label>

      <div id="zipBox" style="margin-top:10px;display:${STATE.shipping.mode.startsWith("envia") ? "block" : "none"}">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <input id="zipInput" class="input" placeholder="Código postal" value="${escapeHtml(STATE.shipping.postal_code || "")}" style="max-width:220px"/>
          <button id="quoteBtn" class="btn btnOutline" type="button">Cotizar</button>
          <div class="muted" id="quoteHint" style="font-weight:850"></div>
        </div>
      </div>

      <div class="muted" style="margin-top:10px;font-weight:850">
        Para envíos con Envia.com, la guía se genera automáticamente después del pago.
      </div>
    </div>

    <div style="margin-top:14px">
      <h4 style="margin:0 0 10px;font-weight:1100">Código promocional</h4>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <input id="promoInput" class="input" placeholder="Ej: BAJA10" value="${escapeHtml(STATE.promo?.code || "")}" style="max-width:240px"/>
        <button id="applyPromoBtn" class="btn btnOutline" type="button">Aplicar</button>
        <button id="clearPromoBtn" class="btn" type="button">Quitar</button>
      </div>
      <div id="promoHint" class="muted" style="margin-top:8px;font-weight:850"></div>
    </div>
  `;

  host.querySelectorAll("button[data-act]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const act = btn.dataset.act;
      const key = btn.dataset.key;
      const it = STATE.cart.find((x) => x.key === key);
      if (!it) return;
      if (act === "rm") return removeFromCart(key);
      if (act === "inc") return setQty(key, (it.qty || 1) + 1);
      if (act === "dec") return it.qty <= 1 ? removeFromCart(key) : setQty(key, (it.qty || 1) - 1);
    });
  });

  host.querySelectorAll('input[name="ship"]').forEach((r) => {
    r.addEventListener("change", () => setShippingMode(r.value));
  });

  const zipInput = $("#zipInput");
  const quoteBtn = $("#quoteBtn");
  if (zipInput && quoteBtn) {
    zipInput.addEventListener("input", () => {
      STATE.shipping.postal_code = zipInput.value.trim();
      STATE.shipping.quoted = false;
      saveShippingState();
      updateTotals();
    });
    quoteBtn.addEventListener("click", () => quoteShipping(true));
  }

  $("#applyPromoBtn")?.addEventListener("click", applyPromo);
  $("#clearPromoBtn")?.addEventListener("click", clearPromo);

  updateTotals();
  refreshPromoHint();
}

function saveShippingState() {
  saveJson("scorestore_ship_v1", {
    mode: STATE.shipping.mode,
    postal_code: STATE.shipping.postal_code,
    amount_cents: STATE.shipping.amount_cents,
    service: STATE.shipping.service,
    quoted: STATE.shipping.quoted,
  });
}
function loadShippingState() {
  const s = loadJson("scorestore_ship_v1", null);
  if (!s) return;
  STATE.shipping.mode = s.mode || "pickup";
  STATE.shipping.postal_code = s.postal_code || "";
  STATE.shipping.amount_cents = Number(s.amount_cents) || 0;
  STATE.shipping.service = s.service || "";
  STATE.shipping.quoted = Boolean(s.quoted);
}

function setShippingMode(mode) {
  STATE.shipping.mode = mode;
  if (mode === "pickup" || mode === "local_tj") {
    STATE.shipping.amount_cents = 0;
    STATE.shipping.service = "";
    STATE.shipping.quoted = true;
  } else {
    STATE.shipping.amount_cents = 0;
    STATE.shipping.service = "";
    STATE.shipping.quoted = false;
  }
  saveShippingState();
  renderCartDrawer();
}

async function quoteShipping(showToast) {
  try {
    if (!(STATE.shipping.mode === "envia_mx" || STATE.shipping.mode === "envia_us")) return;

    if (STATE.promo && STATE.promo.active && STATE.promo.type === "free_shipping") {
      STATE.shipping.amount_cents = 0;
      STATE.shipping.quoted = true;
      saveShippingState();
      updateTotals();
      if (showToast) toast("Envío gratis aplicado");
      return;
    }

    const zip = String(STATE.shipping.postal_code || "").trim();
    if (!zip) { if (showToast) toast("Escribe tu código postal"); return; }

    const data = await postJSON(CONFIG.endpoints.quote, {
      shipping_mode: STATE.shipping.mode,
      postal_code: zip,
      items_qty: STATE.cart.reduce((a, b) => a + (Number(b.qty) || 0), 0),
    });

    STATE.shipping.amount_cents = Number(data.amount_cents) || 0;
    STATE.shipping.service = data.service || "";
    STATE.shipping.quoted = true;
    saveShippingState();

    const hint = $("#quoteHint");
    if (hint) hint.textContent = `Cotizado: ${fmtMXN(STATE.shipping.amount_cents / 100)} ${STATE.shipping.service ? "— " + STATE.shipping.service : ""}`;
    updateTotals();
    if (showToast) toast("Envío cotizado");
  } catch (e) {
    $("#quoteHint") && ($("#quoteHint").textContent = "");
    STATE.shipping.quoted = false;
    saveShippingState();
    if (showToast) toast(e?.message || "Error cotizando envío");
  }
}

/* ------------------------------
   Promos
---------------------------------*/
function refreshPromoHint() {
  const hint = $("#promoHint");
  if (!hint) return;

  if (!STATE.promo || !STATE.promo.code) {
    hint.textContent = "Si tienes un código, aplícalo aquí.";
    return;
  }

  if (!STATE.promo.active) {
    hint.textContent = "Este código no está activo.";
    return;
  }

  if (STATE.promo.type === "percent") hint.textContent = `Aplicado: ${STATE.promo.value}% de descuento.`;
  else if (STATE.promo.type === "fixed_mxn") hint.textContent = `Aplicado: ${fmtMXN(STATE.promo.value)} de descuento.`;
  else if (STATE.promo.type === "free_shipping") hint.textContent = "Aplicado: envío gratis.";
  else hint.textContent = "Código aplicado.";
}

async function ensurePromosLoaded() {
  if (STATE.promosDb) return STATE.promosDb;
  try { STATE.promosDb = await getJSON(CONFIG.promosUrl); }
  catch { STATE.promosDb = { promos: [] }; }
  return STATE.promosDb;
}

function normalizePromoCode(code) {
  return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
}

async function applyPromo() {
  try {
    const input = $("#promoInput");
    const code = normalizePromoCode(input?.value || "");
    if (!code) { toast("Escribe un código"); return; }

    const db = await ensurePromosLoaded();
    const p = (db.promos || []).find((x) => String(x.code || "").trim().toUpperCase() === code && x.active);

    if (!p) {
      toast("Código inválido");
      STATE.promo = null;
      saveJson(CONFIG.storage.promo, null);
      refreshPromoHint();
      updateTotals();
      return;
    }

    const subMxn = cartSubtotalCents() / 100;
    if (p.min_subtotal_mxn && subMxn < p.min_subtotal_mxn) { toast(`Mínimo ${fmtMXN(p.min_subtotal_mxn)} para aplicar`); return; }

    STATE.promo = p;
    saveJson(CONFIG.storage.promo, p);
    refreshPromoHint();
    updateTotals();

    if (p.type === "free_shipping") await quoteShipping(false);
    toast("Código aplicado");
  } catch {
    toast("No se pudo aplicar el código");
  }
}

function clearPromo() {
  STATE.promo = null;
  saveJson(CONFIG.storage.promo, null);
  refreshPromoHint();
  updateTotals();
  toast("Código removido");
}

/* ------------------------------
   Checkout
---------------------------------*/
async function checkout() {
  try {
    if (!STATE.cart.length) { toast("Carrito vacío"); return; }

    if ((STATE.shipping.mode === "envia_mx" || STATE.shipping.mode === "envia_us") && !STATE.shipping.quoted) {
      await quoteShipping(false);
      if (!STATE.shipping.quoted) { toast("Primero cotiza tu envío"); return; }
    }

    const payload = {
      origin: window.location.origin,
      items: STATE.cart.map((it) => ({ sku: it.sku, qty: it.qty, size: it.size })),
      shipping_mode: STATE.shipping.mode,
      postal_code: String(STATE.shipping.postal_code || "").trim(),
      promo_code: STATE.promo?.code || "",
    };

    trackPixel("InitiateCheckout", {
      value: (cartSubtotalCents() + effectiveShippingCents()) / 100,
      currency: "MXN",
      num_items: cartQty(),
    });

    $("#checkoutBtn").disabled = true;
    $("#checkoutBtn").textContent = "Generando pago…";

    const res = await postJSON(CONFIG.endpoints.checkout, payload);
    if (res?.url) { window.location.href = res.url; return; }

    throw new Error("No se pudo crear el checkout");
  } catch (e) {
    toast(e?.message || "Error en checkout");
  } finally {
    const btn = $("#checkoutBtn");
    if (btn) { btn.disabled = !STATE.cart.length; btn.textContent = "Pagar seguro"; }
  }
}

/* ------------------------------
   Legal modal
---------------------------------*/
async function openLegal() {
  try {
    const body = $("#legalBody");
    body.innerHTML = "<p class='muted'>Cargando…</p>";
    openModal("#legalModal");
    const res = await fetch("/legal.html", { cache: "no-store" });
    if (!res.ok) throw new Error("Legal no disponible");
    body.innerHTML = await res.text();
  } catch {
    $("#legalBody").innerHTML = "<p class='muted'>Legal no disponible por el momento. Escríbenos por Linktree para soporte.</p>";
  }
}

/* ------------------------------
   Meta Pixel (consent)
---------------------------------*/
function getConsent() { return loadJson(CONFIG.storage.consent, null); }
function setConsent(status) { saveJson(CONFIG.storage.consent, { status, ts: Date.now() }); }

function ensureCookieBanner() {
  const banner = $("#cookieBanner");
  if (!banner) return;

  const c = getConsent();
  if (c?.status === "accept" || c?.status === "reject") {
    banner.style.display = "none";
    if (c.status === "accept") loadPixel();
    return;
  }

  banner.style.display = "block";
  $("#cookieAcceptBtn")?.addEventListener("click", () => {
    setConsent("accept");
    banner.style.display = "none";
    loadPixel();
  });
  $("#cookieRejectBtn")?.addEventListener("click", () => {
    setConsent("reject");
    banner.style.display = "none";
  });
}

function loadPixel() {
  if (window.__pixel_loaded) return;
  window.__pixel_loaded = true;

  !(function (f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    t = b.createElement(e);
    t.async = true;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

  window.fbq("init", CONFIG.metaPixelId);
  window.fbq("track", "PageView");
}

function trackPixel(eventName, params) {
  try {
    const c = getConsent();
    if (c?.status !== "accept") return;
    if (typeof window.fbq !== "function") return;
    window.fbq("track", eventName, params || {});
  } catch {}
}

/* ------------------------------
   Score AI
---------------------------------*/
function pushAiMessage(role, text) {
  STATE.ai.messages.push({ role, text: String(text || "") });
  renderAi();
}

function renderAi() {
  const host = $("#aiMessages");
  if (!host) return;
  host.innerHTML = "";
  for (const m of STATE.ai.messages.slice(-30)) {
    const div = document.createElement("div");
    div.className = "msg " + (m.role === "user" ? "me" : "");
    div.textContent = m.text;
    host.appendChild(div);
  }
  host.scrollTop = host.scrollHeight;
}

async function aiSend() {
  if (STATE.ai.busy) return;
  const input = $("#aiInput");
  const text = String(input?.value || "").trim();
  if (!text) return;

  input.value = "";
  pushAiMessage("user", text);
  STATE.ai.busy = true;

  try {
    const res = await postJSON(CONFIG.endpoints.ai, { message: text });
    const reply = res?.reply || res?.text || res?.message || "No pude responder en este momento.";
    pushAiMessage("assistant", reply);
  } catch {
    pushAiMessage("assistant", "Score AI está temporalmente fuera. Intenta de nuevo en un momento.");
  } finally {
    STATE.ai.busy = false;
  }
}

function openAi() {
  if (!STATE.ai.messages.length) {
    pushAiMessage("assistant", "Soy Score AI. Dime qué edición estás viendo y te ayudo con tallas, envíos o disponibilidad.");
  }
  openModal("#aiModal");
}

/* ------------------------------
   Init
---------------------------------*/
async function init() {
  try {
    loadShippingState();
    setCartCount();

    $("#openCartBtn")?.addEventListener("click", openDrawer);
    $("#heroOpenCart")?.addEventListener("click", openDrawer);
    $("#closeCartBtn")?.addEventListener("click", closeDrawer);

    $("#pageOverlay")?.addEventListener("click", () => {
      closeDrawer();
      closeModal("#productModal");
      closeModal("#aiModal");
      closeModal("#legalModal");
    });

    $("#closeProductBtn")?.addEventListener("click", () => closeModal("#productModal"));
    $("#closeAiBtn")?.addEventListener("click", () => closeModal("#aiModal"));
    $("#closeLegalBtn")?.addEventListener("click", () => closeModal("#legalModal"));
    $("#openLegalBtn")?.addEventListener("click", openLegal);

    $("#openAiBtn")?.addEventListener("click", openAi);
    $("#openAiBtnFab")?.addEventListener("click", openAi);
    $("#footerAiBtn")?.addEventListener("click", openAi);

    $("#aiSendBtn")?.addEventListener("click", aiSend);
    $("#aiInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") aiSend(); });

    $("#checkoutBtn")?.addEventListener("click", checkout);

    $("#closeProductsBtn")?.addEventListener("click", () => {
      $("#productsPanel")?.classList.add("hide");
      STATE.currentSectionId = null;
    });

    ensureCookieBanner();

    STATE.catalog = await getJSON(CONFIG.catalogUrl);
    STATE.sections = Array.isArray(STATE.catalog.sections) ? STATE.catalog.sections : [];
    STATE.products = Array.isArray(STATE.catalog.products) ? STATE.catalog.products : [];

    renderEditionGrid();
    renderCartDrawer();
    updateTotals();

    trackPixel("ViewContent", { content_name: "Score Store Home" });

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  } catch (e) {
    console.error(e);
    toast("No se pudo cargar el catálogo");
  }
}

document.addEventListener("DOMContentLoaded", init);
