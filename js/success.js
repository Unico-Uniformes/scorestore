(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  const heroEmoji = $("#heroEmoji");
  const heroTitle = $("#heroTitle");
  const heroText = $("#heroText");

  const orderId = $("#orderId");
  const orderTotal = $("#orderTotal");
  const orderStatusText = $("#orderStatusText");
  const orderEmail = $("#orderEmail");
  const orderShipMode = $("#orderShipMode");

  const extraHint = $("#extraHint");
  const copyBtn = $("#copyBtn");

  const successSupportEmail = $("#successSupportEmail");
  const successSupportWa = $("#successSupportWa");

  // 🧹 LIMPIEZA POST-COMPRA
  function clearCart() {
    try {
      localStorage.removeItem("scorestore_cart_v2_pro");
      localStorage.removeItem("scorestore_ship_v2");
      window.history.replaceState(null, "", window.location.pathname);
    } catch {}
  }

  const money = (value) => {
    const n = Number(value);
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
    }).format(Number.isFinite(n) ? n : 0);
  };

  const safeStr = (v, d = "—") =>
    typeof v === "string" && v.trim() ? v.trim() : d;

  const getSessionId = () => {
    const url = new URL(window.location.href);
    return (
      url.searchParams.get("session_id") ||
      url.searchParams.get("payment_intent") ||
      ""
    ).trim();
  };

  function setHero(type, title, text) {
    const map = {
      paid: ["🏆", "Pago confirmado"],
      pending: ["⏳", "Pago en proceso"],
      error: ["⚠️", "Error de verificación"],
      default: ["🏁", "Estado del pedido"],
    };

    const [emoji, defaultTitle] = map[type] || map.default;

    if (heroEmoji) heroEmoji.textContent = emoji;
    if (heroTitle) heroTitle.textContent = title || defaultTitle;
    if (heroText) heroText.textContent = text || "";
  }

  function normalizeShipMode(mode) {
    const m = String(mode || "").toLowerCase();
    if (m === "pickup") return "Recolección en fábrica";
    if (m === "envia_mx") return "Envío nacional";
    if (m === "envia_us") return "Envío USA";
    return "No definido";
  }

  function applyOrderData(data) {
    const ps = String(data?.payment_status || "").toLowerCase();
    const status = String(data?.status || "").toLowerCase();

    if (ps === "paid" || status === "paid") {
      setHero("paid", null, "Tu pago fue confirmado correctamente.");
      clearCart();
    } else if (ps === "unpaid" || status.includes("pending")) {
      setHero("pending", null, "Tu pago está en proceso.");
    } else {
      setHero("default");
    }

    if (orderId) orderId.textContent = safeStr(data?.session_id);
    if (orderTotal) orderTotal.textContent = money(data?.amount_total_mxn);
    if (orderEmail) orderEmail.textContent = safeStr(data?.customer_email);
    if (orderShipMode)
      orderShipMode.textContent = normalizeShipMode(data?.shipping_mode);

    if (orderStatusText) {
      orderStatusText.textContent =
        ps === "paid" ? "Pagado" : ps === "unpaid" ? "Pendiente" : "Procesando";
    }
  }

  async function hydrateSupport() {
    try {
      const res = await fetch("/api/site_settings", { cache: "no-store" });
      const data = await res.json();

      if (!data?.ok) return;

      const { email, whatsapp_e164, whatsapp_display } = data.contact || {};

      if (email && successSupportEmail) {
        successSupportEmail.href = `mailto:${email}`;
        successSupportEmail.textContent = email;
      }

      if (successSupportWa) {
        if (whatsapp_e164)
          successSupportWa.href = `https://wa.me/${encodeURIComponent(
            whatsapp_e164
          )}`;
        if (whatsapp_display)
          successSupportWa.textContent = whatsapp_display;
      }
    } catch {}
  }

  async function loadStatus() {
    const sessionId = getSessionId();

    if (!sessionId) {
      setHero("error", "Sin ID de sesión", "No se pudo identificar el pedido.");
      return;
    }

    try {
      setHero("default", "Verificando pedido...");

      const res = await fetch(
        `/api/checkout_status?session_id=${encodeURIComponent(sessionId)}`,
        { cache: "no-store" }
      );

      const data = await res.json();

      if (!data?.ok) throw new Error();

      applyOrderData(data);
    } catch {
      setHero(
        "error",
        "Error temporal",
        "No se pudo verificar el estado en este momento."
      );
    }
  }

  function bindCopy() {
    if (!copyBtn) return;

    copyBtn.addEventListener("click", async () => {
      const text = orderId?.textContent || "";
      if (!text || text === "—") return;

      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = "Copiado ✅";
        setTimeout(() => (copyBtn.textContent = "Copiar ID"), 1500);
      } catch {}
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    clearCart();
    bindCopy();
    hydrateSupport();
    loadStatus();
  });
})();