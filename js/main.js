/* =========================================================
   SCORE STORE — MASTER JS PROD 2026 (FIXED)
   - Catalog render
   - Cart + Drawer
   - Shipping (pickup/local/envia MX/US)
   - Promo
   - Stripe Checkout (via /api/checkout)
   - AI Chat (via /api/chat)
   ========================================================= */

/* ---------- config ---------- */
const CONFIG = {
  storageKey: "score_cart_2026",
  catalogUrl: "/data/catalog.json",
  legalUrl: "/legal.html",
  endpoints: {
    checkout: "/api/checkout",
    quote: "/api/quote",
    ai: "/api/chat",
  },
};

const $ = (q, el = document) => el.querySelector(q);
const $$ = (q, el = document) => Array.from(el.querySelectorAll(q));

const fmtMXN = (n) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    Number(n || 0)
  );

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const safeUrl = (u) => String(u || "").replace(/[\n\r]/g, "");

/* ---------- state ---------- */
const STATE = {
  products: [],
  sections: [],
  currentSection: null,

  cart: JSON.parse(localStorage.getItem(CONFIG.storageKey) || "[]"),

  shipping: {
    mode: "pickup", // pickup | local_tj | envia_mx | envia_us
    postal: "",
    quote: null, // {amount_mxn, label, carrier, provider}
    loading: false,
  },

  promo: {
    code: "",
    applied: null, // {code,type,value}
    discount_mxn: 0,
  },

  ui: {
    drawerOpen: false,
  },
};

/* ---------- storage ---------- */
function saveCart() {
  localStorage.setItem(CONFIG.storageKey, JSON.stringify(STATE.cart));
  const qty = STATE.cart.reduce((sum, it) => sum + (it.qty || 0), 0);
  $$(".cartCount").forEach((el) => (el.textContent = String(qty)));
}

function normalizeCart() {
  STATE.cart = (Array.isArray(STATE.cart) ? STATE.cart : [])
    .map((it) => ({
      sku: String(it.sku || it.id || "").trim(),
      name: String(it.name || "Producto"),
      img: safeUrl(it.img || ""),
      price_mxn: Number(it.price_mxn || it.price || 0) || 0,
      size: String(it.size || "Unitalla"),
      qty: clamp(parseInt(it.qty || 1, 10) || 1, 1, 99),
    }))
    .filter((it) => it.sku && it.qty > 0);
  saveCart();
}

/* ---------- catalog ---------- */
function normalizeCatalog(data) {
  const sections = Array.isArray(data?.sections) ? data.sections : [];
  const products = Array.isArray(data?.products) ? data.products : [];

  STATE.sections = sections.map((s) => ({
    id: String(s.id || "").toUpperCase(),
    name: String(s.name || ""),
    badge: String(s.badge || ""),
  }));

  STATE.products = products.map((p) => ({
    id: String(p.id || "").trim(),
    sku: String(p.sku || p.id || "").trim(),
    name: String(p.name || "Producto"),
    sectionId: String(p.sectionId || "SCORE").toUpperCase(),
    baseMXN: Number(p.baseMXN || p.price || 0) || 0,
    sizes: Array.isArray(p.sizes) && p.sizes.length ? p.sizes : ["Unitalla"],
    img: safeUrl(p.img || ""),
    images: Array.isArray(p.images) ? p.images.map(safeUrl) : [],
    desc: String(p.desc || ""),
  }));
}

/* ---------- render: sections ---------- */
function renderSections() {
  const wrap = $("#category-view");
  if (!wrap) return;
  wrap.innerHTML = "";

  const logos = {
    BAJA_1000: "/assets/logo-baja1000.webp",
    BAJA_500: "/assets/logo-baja500.webp",
    BAJA_400: "/assets/logo-baja400.webp",
    SF_250: "/assets/logo-sf250.webp",
    SCORE: "/assets/logo-score.webp",
  };

  const list = STATE.sections.length
    ? STATE.sections
    : [
        { id: "BAJA_1000", name: "Baja 1000" },
        { id: "BAJA_500", name: "Baja 500" },
        { id: "BAJA_400", name: "Baja 400" },
        { id: "SF_250", name: "San Felipe 250" },
        { id: "SCORE", name: "SCORE" },
      ];

  list.forEach((sec) => {
    const card = document.createElement("button");
    card.className = "cat-card";
    card.type = "button";

    const imgUrl = logos[sec.id] || logos.SCORE;

    card.innerHTML = `
      <img class="cat-logo" src="${imgUrl}" alt="${sec.name}">
      <div class="cat-title">${sec.name}</div>
      ${sec.badge ? `<div class="cat-badge">${sec.badge}</div>` : ""}
    `;
    card.addEventListener("click", () => showProducts(sec.id));
    wrap.appendChild(card);
  });
}

/* ---------- render: products ---------- */
function showProducts(sectionId) {
  STATE.currentSection = String(sectionId || "").toUpperCase();

  $("#category-view")?.classList.add("hidden");
  $("#product-view")?.classList.remove("hidden");

  const title = $("#current-category-title");
  if (title) title.textContent = STATE.currentSection.replace(/_/g, " ");

  const grid = $("#productsGrid");
  if (!grid) return;
  grid.innerHTML = "";

  const filtered = STATE.products.filter((p) => p.sectionId === STATE.currentSection);

  filtered.forEach((p) => {
    const safeId = p.id.replace(/[^a-z0-9]/gi, "");
    const back = p.images && p.images.length > 1 ? p.images[1] : "";

    const card = document.createElement("div");
    card.className = "product-card";
    card.innerHTML = `
      <div class="p-media">
        <img src="${p.img}" alt="${p.name}">
        ${back ? `<img src="${back}" alt="${p.name}" class="img-back">` : ""}
      </div>
      <div class="p-body">
        <h3 class="p-name">${p.name}</h3>
        <div class="p-desc">${p.desc || ""}</div>
        <span class="p-price">${fmtMXN(p.baseMXN)}</span>
        <select id="size-${safeId}" class="p-size-sel">
          ${p.sizes.map((s) => `<option value="${s}">${s}</option>`).join("")}
        </select>
        <button class="p-btn-add" type="button" data-sku="${p.sku}" data-safeid="${safeId}">
          AGREGAR AL CARRITO
        </button>
      </div>
    `;

    card.querySelector(".p-btn-add")?.addEventListener("click", () => {
      const size = $(`#size-${safeId}`)?.value || "Unitalla";
      addToCart(p.sku, size);
    });

    grid.appendChild(card);
  });
}

function showCategories() {
  $("#product-view")?.classList.add("hidden");
  $("#category-view")?.classList.remove("hidden");
  STATE.currentSection = null;
}

/* ---------- cart ops ---------- */
function addToCart(sku, size) {
  const p = STATE.products.find((x) => x.sku === sku || x.id === sku);
  if (!p) return;

  const key = `${p.sku}__${String(size || "Unitalla")}`;
  const ex = STATE.cart.find((i) => `${i.sku}__${i.size}` === key);

  if (ex) ex.qty = clamp((ex.qty || 1) + 1, 1, 99);
  else {
    STATE.cart.push({
      sku: p.sku,
      name: p.name,
      img: p.img,
      price_mxn: p.baseMXN,
      size: String(size || "Unitalla"),
      qty: 1,
    });
  }

  saveCart();
  openDrawer();
  renderDrawer();
}

function removeFromCart(index) {
  STATE.cart.splice(index, 1);
  normalizeCart();
  renderDrawer();
}

function setQty(index, qty) {
  const it = STATE.cart[index];
  if (!it) return;
  it.qty = clamp(parseInt(qty, 10) || 1, 1, 99);
  normalizeCart();
  renderDrawer();
}

/* ---------- totals ---------- */
function calcSubtotal() {
  return STATE.cart.reduce((sum, it) => sum + (Number(it.price_mxn) || 0) * (it.qty || 1), 0);
}

function calcShipping() {
  if (STATE.shipping.mode === "pickup") return 0;
  if (STATE.shipping.mode === "local_tj") return 0; // can be billed later or flat in backend
  if (STATE.shipping.quote && Number.isFinite(STATE.shipping.quote.amount_mxn)) {
    return Number(STATE.shipping.quote.amount_mxn) || 0;
  }
  return 0;
}

function calcDiscount() {
  return Number(STATE.promo.discount_mxn || 0) || 0;
}

function calcTotal() {
  return Math.max(0, calcSubtotal() + calcShipping() - calcDiscount());
}

/* ---------- drawer ui ---------- */
function openDrawer() {
  STATE.ui.drawerOpen = true;
  $("#cartDrawer")?.classList.add("open");
  $("#pageOverlay")?.classList.add("show");
  document.body.classList.add("no-scroll");
}

function closeDrawer() {
  STATE.ui.drawerOpen = false;
  $("#cartDrawer")?.classList.remove("open");
  $("#pageOverlay")?.classList.remove("show");
  document.body.classList.remove("no-scroll");
}

function renderDrawer() {
  const itemsWrap = $("#cartItems");
  if (!itemsWrap) return;

  if (!STATE.cart.length) {
    itemsWrap.innerHTML = `<p style="text-align:center;padding:20px;opacity:0.6;">Tu carrito está vacío</p>`;
  } else {
    itemsWrap.innerHTML = "";
    STATE.cart.forEach((it, idx) => {
      const row = document.createElement("div");
      row.className = "cartRow";
      row.innerHTML = `
        <div class="cartThumb"><img src="${it.img}" alt=""></div>
        <div class="cartInfo">
          <div class="name">${it.name}</div>
          <div class="price">${fmtMXN(it.price_mxn)} x ${it.qty}</div>
          <div class="meta">Talla: ${it.size}</div>

          <div class="qtyLine">
            <button type="button" class="qtyBtn" data-d="-1">–</button>
            <input class="qtyInp" value="${it.qty}" inputmode="numeric">
            <button type="button" class="qtyBtn" data-d="1">+</button>
          </div>
        </div>
        <button class="rmBtn" type="button" aria-label="Quitar">✕</button>
      `;

      row.querySelector(".rmBtn")?.addEventListener("click", () => removeFromCart(idx));

      const inp = row.querySelector(".qtyInp");
      row.querySelectorAll(".qtyBtn").forEach((b) => {
        b.addEventListener("click", () => {
          const d = parseInt(b.getAttribute("data-d") || "0", 10);
          setQty(idx, (STATE.cart[idx]?.qty || 1) + d);
        });
      });

      inp?.addEventListener("change", () => setQty(idx, inp.value));

      itemsWrap.appendChild(row);
    });
  }

  // shipping UI
  const shipMode = $("#shipMode");
  if (shipMode) shipMode.value = STATE.shipping.mode;

  const postalWrap = $("#postalWrap");
  if (postalWrap) {
    postalWrap.classList.toggle("hidden", !(STATE.shipping.mode === "envia_mx" || STATE.shipping.mode === "envia_us"));
  }

  const postalInp = $("#postalCode");
  if (postalInp) postalInp.value = STATE.shipping.postal || "";

  const shipLine = $("#shippingLine");
  if (shipLine) {
    if (STATE.shipping.mode === "pickup") shipLine.textContent = "Gratis (Pickup)";
    else if (STATE.shipping.mode === "local_tj") shipLine.textContent = "A coordinar (TJ)";
    else if (STATE.shipping.loading) shipLine.textContent = "Cotizando…";
    else if (STATE.shipping.quote) shipLine.textContent = `${fmtMXN(STATE.shipping.quote.amount_mxn)} (${STATE.shipping.quote.label || "Envia"})`;
    else shipLine.textContent = "Pendiente";
  }

  // promo
  const promoInp = $("#promoCodeInput");
  if (promoInp) promoInp.value = STATE.promo.code || "";
  const promoMsg = $("#promoMessage");
  if (promoMsg) {
    promoMsg.textContent = STATE.promo.applied
      ? `Aplicado: ${STATE.promo.applied.code}`
      : (STATE.promo.code ? "Código no aplicado" : "");
    promoMsg.className = `promo-msg ${STATE.promo.applied ? "promo-success" : (STATE.promo.code ? "promo-error" : "")}`;
  }

  // totals
  $("#cartSubtotal") && ($("#cartSubtotal").textContent = fmtMXN(calcSubtotal()));
  $("#cartShipping") && ($("#cartShipping").textContent = fmtMXN(calcShipping()));
  $("#cartDiscount") && ($("#cartDiscount").textContent = calcDiscount() ? `- ${fmtMXN(calcDiscount())}` : fmtMXN(0));
  $("#cartTotal") && ($("#cartTotal").textContent = fmtMXN(calcTotal()));

  // bind drawer buttons (idempotent by replacing DOM often)
  $("#closeDrawerBtn")?.addEventListener("click", closeDrawer);
  $("#pageOverlay")?.addEventListener("click", closeDrawer);

  $("#shipMode")?.addEventListener("change", (e) => {
    const r = e.target;
    STATE.shipping.mode = String(r.value);
    STATE.shipping.quote = null;
    renderDrawer();
    if ((STATE.shipping.mode === "envia_mx" || STATE.shipping.mode === "envia_us") && String(STATE.shipping.postal || "").trim()) {
      setTimeout(() => { quoteShipping(); }, 50);
    }
  });

  $("#postalCode")?.addEventListener("input", (e) => {
    STATE.shipping.postal = String(e.target.value || "").trim();
  });

  $("#quoteBtn")?.addEventListener("click", quoteShipping);

  $("#applyPromoBtn")?.addEventListener("click", applyPromo);

  $("#checkoutBtn")?.addEventListener("click", doCheckout);

  // legal modal
  $("#openLegal")?.addEventListener("click", openLegal);
}

/* ---------- shipping quote ---------- */
async function quoteShipping() {
  if (!(STATE.shipping.mode === "envia_mx" || STATE.shipping.mode === "envia_us")) return;

  const postal = String(STATE.shipping.postal || "").trim();
  if (postal.length < 4) {
    alert("Ingresa un código postal válido.");
    return;
  }

  STATE.shipping.loading = true;
  renderDrawer();

  try {
    const res = await fetch(CONFIG.endpoints.quote, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shipping_mode: STATE.shipping.mode,
        postal_code: postal,
        items_qty: STATE.cart.reduce((sum, it) => sum + (it.qty || 1), 0),
        items: STATE.cart.map((it) => ({ sku: it.sku, qty: it.qty })),
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || "No se pudo cotizar.");

    STATE.shipping.quote = {
      amount_mxn: Number(data.amount_mxn || 0) || 0,
      label: data.label || "Standard",
      carrier: data.carrier || "",
      provider: data.provider || "envia",
    };
  } catch (err) {
    console.error(err);
    alert("No se pudo cotizar el envío. Se usará una tarifa estimada.");
    STATE.shipping.quote = { amount_mxn: 350, label: "Estimado", carrier: "", provider: "fallback" };
  } finally {
    STATE.shipping.loading = false;
    renderDrawer();
  }
}

/* ---------- promo ---------- */
async function applyPromo() {
  const code = String($("#promoCodeInput")?.value || "").trim().toUpperCase();
  STATE.promo.code = code;
  STATE.promo.applied = null;
  STATE.promo.discount_mxn = 0;

  if (!code) {
    renderDrawer();
    return;
  }

  try {
    const res = await fetch("/data/promos.json", { cache: "no-store" });
    const data = await res.json();
    const rules = Array.isArray(data?.rules) ? data.rules : [];
    const rule = rules.find((r) => String(r.code || "").toUpperCase() === code && r.active);

    if (!rule) throw new Error("Código inválido.");

    const subtotal = calcSubtotal();

    if (rule.type === "percent") {
      const pct = Number(rule.value || 0);
      STATE.promo.discount_mxn = Math.round(subtotal * pct);
    } else if (rule.type === "fixed_mxn") {
      STATE.promo.discount_mxn = Math.min(subtotal, Number(rule.value || 0));
    } else if (rule.type === "free_shipping") {
      // handled in backend; show as info
      STATE.promo.discount_mxn = 0;
    }

    STATE.promo.applied = { code, ...rule };
  } catch (err) {
    console.error(err);
    STATE.promo.applied = null;
    STATE.promo.discount_mxn = 0;
  } finally {
    renderDrawer();
  }
}

/* ---------- checkout ---------- */
async function doCheckout() {
  if (!STATE.cart.length) return;

  const btn = $("#checkoutBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "PROCESANDO…";
  }

  try {
    // Validate required for Envia
    if ((STATE.shipping.mode === "envia_mx" || STATE.shipping.mode === "envia_us") && String(STATE.shipping.postal || "").trim().length < 4) {
      alert("Ingresa tu código postal para el envío.");
      return;
    }

    const payload = {
      items: STATE.cart.map((it) => ({
        sku: it.sku,
        qty: it.qty,
        size: it.size,
      })),
      shipping_mode: STATE.shipping.mode,
      postal_code: STATE.shipping.postal,
      promo_code: STATE.promo.applied ? STATE.promo.applied.code : "",
    };

    const res = await fetch(CONFIG.endpoints.checkout, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok || !data.url) throw new Error(data.error || "Checkout error");

    window.location.href = data.url;
  } catch (err) {
    console.error(err);
    alert("No se pudo iniciar el pago. Intenta de nuevo.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "PAGAR AHORA";
    }
  }
}

/* ---------- legal modal ---------- */
function openModal(sel) {
  const el = $(sel);
  if (!el) return;
  el.classList.add("open");
  $("#pageOverlayModal")?.classList.add("show");
  document.body.classList.add("no-scroll");
}

function closeModal(sel) {
  const el = $(sel);
  if (!el) return;
  el.classList.remove("open");
  $("#pageOverlayModal")?.classList.remove("show");
  document.body.classList.remove("no-scroll");
}

window.closeLegal = () => closeModal("#legalModal");

// ---------- legal ----------
async function openLegal() {
  try {
    const res = await fetch(CONFIG.legalUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const doc = new DOMParser().parseFromString(html, "text/html");
    const main = doc.querySelector("main");
    const content = main
      ? main.innerHTML
      : "<div class=\"muted\">Legal no disponible.</div>";

    const body = document.querySelector("#legalBody");
    if (body) body.innerHTML = content;
    openModal("#legalModal");
  } catch (err) {
    console.error(err);
    const body = document.querySelector("#legalBody");
    if (body) body.innerHTML = "<div class=\"muted\">No se pudo cargar Legal.</div>";
    openModal("#legalModal");
  }
}

// ---------- init ----------
async function init() {
  normalizeCart();

  // load catalog
  try {
    const res = await fetch(CONFIG.catalogUrl, { cache: "no-store" });
    const data = await res.json();
    normalizeCatalog(data);
    renderSections();
  } catch (err) {
    console.error("Error loading catalog", err);
    renderSections(); // fallback sections
  }

  // UI binds
  $$(".openCart").forEach((b) => b.addEventListener("click", () => {
    openDrawer();
    renderDrawer();
  }));

  $("#backToCategories")?.addEventListener("click", showCategories);

  $("#scrollToCatalog")?.addEventListener("click", () => {
    $("#catalog-section")?.scrollIntoView({ behavior: "smooth" });
  });

  // splash
  const splash = $("#splash");
  if (splash) {
    setTimeout(() => {
      splash.style.opacity = "0";
      setTimeout(() => (splash.style.display = "none"), 450);
    }, 1200);
  }

  // register SW
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
}

document.addEventListener("DOMContentLoaded", init);

/* ---------- AI chat (optional UI) ---------- */
window.openAi = () => openModal("#aiModal");
window.closeAi = () => closeModal("#aiModal");

async function sendAi() {
  const inp = $("#aiInput");
  const out = $("#aiOutput");
  if (!inp || !out) return;
  const text = String(inp.value || "").trim();
  if (!text) return;

  out.innerHTML += `<div class="aiMsg user">${escapeHtml(text)}</div>`;
  inp.value = "";

  try {
    const res = await fetch(CONFIG.endpoints.ai, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || "AI error");
    out.innerHTML += `<div class="aiMsg bot">${escapeHtml(data.reply || "…")}</div>`;
    out.scrollTop = out.scrollHeight;
  } catch (err) {
    console.error(err);
    out.innerHTML += `<div class="aiMsg bot">No pude responder ahorita.</div>`;
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

$("#aiSendBtn")?.addEventListener("click", sendAi);
$("#aiInput")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendAi();
});
