/* =========================================================
   SCORE STORE — SISTEMA OPERATIVO DE TIENDA (V3.0)
   Integración: Stripe + Envía.com + IA Assistant + Social Proof
   Build: 2026-03-23-ULTIMATE-ROBUST
========================================================= */

(() => {
  "use strict";

  const APP_VERSION = "2026.03.23.SCORE-MASTER";

  // --- CONFIGURACIÓN DE RUTAS Y DOMINIOS ---
  const API_BASE = "/api";
  const ASSETS_PATH = "/assets";

  // --- UTILS & CORE ---
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const money = (cents) => new Intl.NumberFormat("es-MX", {
    style: "currency", currency: "MXN"
  }).format((cents || 0) / 100);

  const safeUrl = (u) => {
    if (!u) return "";
    if (u.startsWith("http")) return u;
    let path = u.replace("assets/", "").replace(/^\//, "");
    return `${ASSETS_PATH}/${path}`;
  };

  // --- STATE MANAGEMENT ---
  let products = [];
  let cart = JSON.parse(localStorage.getItem("score_cart")) || [];
  let activeCategory = null;
  let currentProduct = null;
  let selectedSize = "";
  let selectedQty = 1;
  let shippingData = { mode: "pickup", quote: 0, zip: "" };
  let appliedDiscount = 0;

  // --- 1. MOTOR DE DATOS Y CATÁLOGO ---
  const fetchCatalog = async () => {
    try {
      const res = await fetch(`${API_BASE}/catalog?v=${Date.now()}`);
      const data = await res.json();
      products = data.products.map(p => ({
        ...p,
        img: safeUrl(p.images?.[0] || p.img),
        priceCents: p.price_cents || (p.price_mxn * 100)
      }));
      renderCategories();
      renderProducts();
    } catch (e) {
      console.error("Error cargando catálogo:", e);
      showToast("Error de conexión con el servidor", "error");
    }
  };

  // --- 2. SISTEMA DE ASISTENTE IA (LÓGICA COMPLETA) ---
  const initAssistant = () => {
    const out = $("#assistantOutput");
    const input = $("#assistantInput");
    const sendBtn = $("#assistantSendBtn");

    const addMsg = (text, role) => {
      const div = document.createElement("div");
      div.className = `msg msg--${role}`;
      div.innerHTML = `<div class="msg__bubble">${text}</div>`;
      out.appendChild(div);
      out.scrollTop = out.scrollHeight;
    };

    const handleQuery = async () => {
      const q = input.value.trim();
      if (!q) return;
      addMsg(q, "user");
      input.value = "";

      try {
        const res = await fetch(`${API_BASE}/assistant`, {
          method: "POST",
          body: JSON.stringify({ query: q, context: "store_navigation" })
        });
        const data = await res.json();
        addMsg(data.response, "bot");
      } catch {
        addMsg("Lo siento, estoy teniendo problemas de conexión. ¿Te puedo ayudar con algo más?", "bot");
      }
    };

    sendBtn?.addEventListener("click", handleQuery);
    input?.addEventListener("keypress", (e) => e.key === "Enter" && handleQuery());
  };

  // --- 3. GESTIÓN DEL CARRITO Y ENVÍOS ---
  const updateCartUI = () => {
    const itemsEl = $("#cartItems");
    if (!itemsEl) return;

    itemsEl.innerHTML = cart.map((item, idx) => `
      <div class="cartitem glass-panel">
        <img src="${item.img}" width="50">
        <div class="cartitem__info">
          <div class="cartitem__title">${item.title}</div>
          <div class="cartitem__meta">Talla: ${item.size}</div>
          <div class="cartitem__price">${money(item.priceCents * item.qty)}</div>
        </div>
        <div class="qty-stepper">
          <button onclick="window._modQty(${idx}, -1)">-</button>
          <span>${item.qty}</span>
          <button onclick="window._modQty(${idx}, 1)">+</button>
        </div>
      </div>
    `).join("");

    const subtotal = cart.reduce((acc, it) => acc + (it.priceCents * it.qty), 0);
    const total = subtotal + shippingData.quote - appliedDiscount;

    $("#cartSubtotal").textContent = money(subtotal);
    $("#shippingLine").textContent = money(shippingData.quote);
    $("#cartTotal").textContent = money(total);
    $("#cartCount").textContent = cart.reduce((a, b) => a + b.qty, 0);
    localStorage.setItem("score_cart", JSON.stringify(cart));
  };

  window._modQty = (idx, delta) => {
    cart[idx].qty += delta;
    if (cart[idx].qty <= 0) cart.splice(idx, 1);
    updateCartUI();
  };

  const handleShipping = async () => {
    const zip = $("#postalCode").value;
    if (zip.length < 5) return showToast("CP Inválido", "error");

    $("#quoteBtn").textContent = "Cotizando...";
    try {
      const res = await fetch(`${API_BASE}/shipping/quote`, {
        method: "POST",
        body: JSON.stringify({ zip, items: cart })
      });
      const data = await res.json();
      shippingData.quote = data.total_cents;
      showToast("Envío actualizado");
    } catch {
      showToast("Error al cotizar", "error");
    } finally {
      $("#quoteBtn").textContent = "Cotizar";
      updateCartUI();
    }
  };

  // --- 4. SOCIAL PROOF (VENTAS EN TIEMPO REAL) ---
  const initSocialProof = () => {
    const names = ["Carlos R.", "Mark W.", "Ana M.", "John D.", "Baja Team"];
    const actions = ["compró una Hoodie Baja 1000", "adquirió la Gorra SF250", "reservó Merch Oficial"];
    
    setInterval(() => {
      if (Math.random() > 0.7) {
        $("#salesName").textContent = names[Math.floor(Math.random() * names.length)];
        $("#salesAction").textContent = actions[Math.floor(Math.random() * actions.length)];
        const toast = $("#salesNotification");
        toast.hidden = false;
        setTimeout(() => toast.hidden = true, 5000);
      }
    }, 15000);
  };

  // --- 5. INTERFAZ Y MODALES ---
  window._openProduct = (sku) => {
    const p = products.find(x => x.sku === sku);
    if (!p) return;
    currentProduct = p;
    selectedQty = 1;
    selectedSize = "";

    $("#pmTitle").textContent = p.title;
    $("#pmPrice").textContent = money(p.priceCents);
    $("#pmDesc").textContent = p.description;
    $("#pmCarousel").innerHTML = `<img src="${p.img}" class="vfx-zoom">`;
    $("#pmQtyDisplay").textContent = "1";
    
    $("#pmSizePills").innerHTML = (p.sizes || ["S", "M", "L", "XL"]).map(s => `
      <button class="size-pill" onclick="window._setSize(this, '${s}')">${s}</button>
    `).join("");

    openLayer($("#productModal"));
  };

  window._setSize = (btn, s) => {
    $$(".size-pill").forEach(el => el.classList.remove("active"));
    btn.classList.add("active");
    selectedSize = s;
  };

  const openLayer = (el) => {
    if (!el) return;
    el.hidden = false;
    $("#overlay").hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => el.classList.add("open"), 10);
  };

  const closeAll = () => {
    $$(".drawer, .modal, .overlay").forEach(el => {
      el.classList.remove("open");
      setTimeout(() => el.hidden = true, 400);
    });
    document.body.style.overflow = "";
  };

  // --- 6. CHECKOUT STRIPE ---
  const handleCheckout = async () => {
    if (cart.length === 0) return showToast("Carrito vacío", "error");
    
    $("#checkoutLoader").hidden = false;
    try {
      const res = await fetch(`${API_BASE}/checkout`, {
        method: "POST",
        body: JSON.stringify({ cart, shipping: shippingData })
      });
      const { url } = await res.json();
      window.location.href = url;
    } catch {
      showToast("Error al iniciar pago", "error");
      $("#checkoutLoader").hidden = true;
    }
  };

  // --- INITIALIZATION ---
  const init = () => {
    fetchCatalog();
    initAssistant();
    initSocialProof();
    updateCartUI();

    // Event Listeners
    $("#openCartBtn")?.addEventListener("click", () => openLayer($("#cartDrawer")));
    $("#closeCartBtn")?.addEventListener("click", closeAll);
    $("#overlay")?.addEventListener("click", closeAll);
    $("#pmClose")?.addEventListener("click", closeAll);
    $("#checkoutBtn")?.addEventListener("click", handleCheckout);
    $("#quoteBtn")?.addEventListener("click", handleShipping);
    
    $("#pmAdd")?.addEventListener("click", () => {
      if (!selectedSize) return showToast("Selecciona una talla", "error");
      cart.push({ ...currentProduct, size: selectedSize, qty: selectedQty });
      closeAll();
      openLayer($("#cartDrawer"));
      updateCartUI();
      showToast("Agregado al carrito");
    });

    // Efecto Splash
    setTimeout(() => {
      const s = $("#splash");
      s.classList.add("fade-out");
      setTimeout(() => s.hidden = true, 600);
    }, 2000);
  };

  document.addEventListener("DOMContentLoaded", init);
})();
