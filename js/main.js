/* =========================================================
   SCORE STORE — main.js (REBUILD PRO VERCEL READY)
   Build: 2026.04
   ========================================================= */

(() => {
  "use strict";

  /* =========================================================
     CONFIG
  ========================================================= */
  const APP_VERSION = "2026.04.PRO";

  const API = {
    catalog: "/api/catalog",
    checkout: "/api/create_checkout",
    quote: "/api/quote_shipping",
    promos: "/api/promos",
  };

  const STORAGE = {
    cart: "ss_cart_v3",
    shipping: "ss_shipping_v3",
  };

  /* =========================================================
     HELPERS
  ========================================================= */
  const $ = (s) => document.querySelector(s);

  const money = (cents) =>
    new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
    }).format((Number(cents) || 0) / 100);

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  const toast = (msg) => {
    const t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    setTimeout(() => (t.hidden = true), 2500);
  };

  /* =========================================================
     STATE
  ========================================================= */
  let products = [];
  let cart = [];
  let shipping = { quote: null, postal: "", country: "MX" };
  let currentProduct = null;

  /* =========================================================
     STORAGE
  ========================================================= */
  const saveCart = () =>
    localStorage.setItem(STORAGE.cart, JSON.stringify(cart));

  const loadCart = () => {
    try {
      cart = JSON.parse(localStorage.getItem(STORAGE.cart)) || [];
    } catch {
      cart = [];
    }
  };

  const saveShipping = () =>
    localStorage.setItem(STORAGE.shipping, JSON.stringify(shipping));

  const loadShipping = () => {
    try {
      shipping = JSON.parse(localStorage.getItem(STORAGE.shipping)) || shipping;
    } catch {}
  };

  /* =========================================================
     FETCH
  ========================================================= */
  const fetchCatalog = async () => {
    const res = await fetch(API.catalog);
    const j = await res.json();
    if (!j?.products) throw new Error("Catalog error");
    products = j.products;
  };

  /* =========================================================
     RENDER PRODUCTS
  ========================================================= */
  const renderProducts = () => {
    const grid = $("#productGrid");
    if (!grid) return;

    grid.innerHTML = "";

    products.forEach((p) => {
      const el = document.createElement("div");
      el.className = "card";

      el.innerHTML = `
        <img src="${p.images?.[0] || ""}" />
        <h3>${p.title}</h3>
        <p>${money(p.price_cents)}</p>
        <button>Ver</button>
      `;

      el.querySelector("button").onclick = () => openProduct(p);
      grid.appendChild(el);
    });
  };

  /* =========================================================
     PRODUCT MODAL
  ========================================================= */
  const openProduct = (p) => {
    currentProduct = p;

    $("#pmTitle").textContent = p.title;
    $("#pmPrice").textContent = money(p.price_cents);
    $("#pmDesc").textContent = p.description || "";

    const img = $("#pmCarousel");
    img.innerHTML = `<img src="${p.images?.[0] || ""}" />`;

    $("#productModal").hidden = false;
  };

  $("#pmClose")?.addEventListener("click", () => {
    $("#productModal").hidden = true;
  });

  /* =========================================================
     CART
  ========================================================= */
  const renderCart = () => {
    const el = $("#cartItems");
    if (!el) return;

    el.innerHTML = "";

    cart.forEach((i, idx) => {
      const row = document.createElement("div");

      row.innerHTML = `
        <div>${i.title}</div>
        <div>${money(i.priceCents)}</div>
        <div>x${i.qty}</div>
        <button data-i="${idx}">X</button>
      `;

      row.querySelector("button").onclick = () => {
        cart.splice(idx, 1);
        saveCart();
        renderCart();
      };

      el.appendChild(row);
    });

    $("#cartTotal").textContent = money(
      cart.reduce((a, i) => a + i.priceCents * i.qty, 0)
    );
  };

  const addToCart = () => {
    if (!currentProduct) return;

    cart.push({
      sku: currentProduct.sku,
      title: currentProduct.title,
      priceCents: currentProduct.price_cents,
      qty: 1,
    });

    saveCart();
    renderCart();
    toast("Agregado");
  };

  $("#pmAdd")?.addEventListener("click", addToCart);

  /* =========================================================
     SHIPPING
  ========================================================= */
  const quoteShipping = async () => {
    const postal = $("#postalCode").value;

    const res = await fetch(API.quote, {
      method: "POST",
      body: JSON.stringify({
        postal_code: postal,
        country: shipping.country,
        items: cart.map((i) => ({ qty: i.qty })),
      }),
      headers: { "Content-Type": "application/json" },
    });

    const j = await res.json();

    const amount =
      j?.quote?.amount_cents ||
      j?.amount_cents ||
      0;

    shipping.quote = amount;
    shipping.postal = postal;

    saveShipping();

    $("#shippingLine").textContent = money(amount);

    toast("Envío calculado");
  };

  $("#quoteBtn")?.addEventListener("click", quoteShipping);

  /* =========================================================
     CHECKOUT
  ========================================================= */
  const checkout = async () => {
    const email = $("#checkoutEmail").value;

    if (!email) return toast("Email requerido");
    if (!shipping.quote) return toast("Cotiza envío");

    const res = await fetch(API.checkout, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        customer_email: email,
        items: cart,
        shipping_amount: shipping.quote,
      }),
    });

    const j = await res.json();

    if (!j?.url) return toast("Error checkout");

    window.location.href = j.url;
  };

  $("#checkoutBtn")?.addEventListener("click", checkout);

  /* =========================================================
     INIT
  ========================================================= */
  const init = async () => {
    loadCart();
    loadShipping();

    await fetchCatalog();
    renderProducts();
    renderCart();

    console.log("SCORE STORE READY", APP_VERSION);
  };

  init();
})();