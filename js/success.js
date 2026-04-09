(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  const els = {
    heroEmoji: $("#heroEmoji"),
    heroTitle: $("#heroTitle"),
    heroText: $("#heroText"),
    orderId: $("#orderId"),
    orderTotal: $("#orderTotal"),
    orderStatusText: $("#orderStatusText"),
    orderEmail: $("#orderEmail"),
    orderShipMode: $("#orderShipMode"),
    extraHint: $("#extraHint"),
    copyBtn: $("#copyBtn"),
    successSupportEmail: $("#successSupportEmail"),
    successSupportWa: $("#successSupportWa"),
    footerNote: $("#footerNote"),
  };

  const STORAGE_KEYS = [
    "scorestore_cart_v3",
    "scorestore_ship_v3",
    "scorestore_promo_v3",
    "scorestore_customer_v3",
    "scorestore_ui_v3",
    "scorestore_cart_v2_pro",
    "scorestore_ship_v2",
    "scorestore_customer_v2",
  ];

  const ROUTES = {
    checkoutStatus: ["/api/checkout_status", "/.netlify/functions/checkout_status"],
    siteSettings: ["/api/site_settings", "/.netlify/functions/site_settings"],
  };

  const safeStr = (v, d = "—") => (typeof v === "string" && v.trim() ? v.trim() : d);

  function money(value) {
    const n = Number(value);
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 2,
    }).format(Number.isFinite(n) ? n / 100 : 0);
  }

  function clearCart() {
    try {
      for (const key of STORAGE_KEYS) localStorage.removeItem(key);
    } catch {}
  }

  function getSessionId() {
    const url = new URL(window.location.href);
    return (
      url.searchParams.get("session_id") ||
      url.searchParams.get("payment_intent") ||
      url.searchParams.get("checkout_id") ||
      url.searchParams.get("order_id") ||
      ""
    ).trim();
  }

  function normalizePaymentStatus(v) {
    const s = safeStr(v, "").toLowerCase();
    if (!s) return "processing";
    if (["paid", "succeeded", "complete", "completed", "confirmed"].includes(s)) return "paid";
    if (["pending", "processing", "open", "requires_payment_method", "requires_action", "unpaid"].includes(s)) return "pending";
    if (["refunded", "refund"].includes(s)) return "refunded";
    if (["failed", "canceled", "cancelled", "error"].includes(s)) return "failed";
    return s;
  }

  function normalizeShipMode(mode) {
    const m = safeStr(mode, "").toLowerCase();
    if (m === "pickup") return "Recogida en tienda";
    if (m === "pickup_local") return "Recogida local";
    if (m === "delivery") return "Envío a domicilio";
    if (m === "envia_mx") return "Envía MX";
    if (m === "envia_us") return "Envía US";
    return m ? m.replaceAll("_", " ") : "No definido";
  }

  function setText(el, value) {
    if (!el) return;
    el.textContent = value;
  }

  function setHref(el, href) {
    if (!el || !href) return;
    el.setAttribute("href", href);
  }

  function setHero(type, title, text) {
    const map = {
      paid: ["🏆", "Pago confirmado"],
      pending: ["⏳", "Pago en proceso"],
      refunded: ["↩️", "Pago reembolsado"],
      failed: ["⚠️", "Error de verificación"],
      default: ["🏁", "Estado del pedido"],
    };
    const [emoji, defaultTitle] = map[type] || map.default;
    if (els.heroEmoji) els.heroEmoji.textContent = emoji;
    if (els.heroTitle) els.heroTitle.textContent = title || defaultTitle;
    if (els.heroText) els.heroText.textContent = text || "Estableciendo conexión con el estado de tu compra.";
    document.title = `${title || defaultTitle} — SCORE STORE`;
  }

  async function fetchJsonFirstOk(urls) {
    const list = Array.isArray(urls) ? urls : [urls];
    let lastErr = null;
    for (const u of list) {
      try {
        const res = await fetch(u, { cache: "no-store" });
        if (!res.ok) {
          lastErr = new Error(`HTTP ${res.status}`);
          continue;
        }
        const j = await res.json().catch(() => null);
        if (j) return j;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("No se pudo cargar JSON");
  }

  function applyOrderData(data, sessionId) {
    const statusRaw = normalizePaymentStatus(data?.payment_status || data?.status || data?.paymentIntentStatus);
    const shipModeLabel = normalizeShipMode(data?.shipping_mode);
    const idValue = safeStr(data?.session_id || data?.checkout_session_id || data?.stripe_session_id || data?.id || sessionId || "");
    const totalCents =
      Number.isFinite(Number(data?.amount_total_cents))
        ? Number(data.amount_total_cents)
        : Number.isFinite(Number(data?.total_cents))
          ? Number(data.total_cents)
          : Number.isFinite(Number(data?.amount_total))
            ? Number(data.amount_total)
            : Number.isFinite(Number(data?.amount_total_mxn))
              ? Math.round(Number(data.amount_total_mxn) * 100)
              : null;

    const emailValue = safeStr(
      data?.customer_email ||
        data?.email ||
        data?.customer_details?.email ||
        data?.stripe_session?.customer_email ||
        "—"
    );

    const titleMap = {
      paid: "Pago confirmado",
      pending: "Pago en proceso",
      refunded: "Pago reembolsado",
      failed: "No se pudo verificar",
    };

    const heroMap = {
      paid: "Tu compra quedó lista y registrada en el sistema.",
      pending: "Tu pago todavía puede estar sincronizándose con Stripe o con el método elegido.",
      refunded: "La orden fue marcada como reembolsada o cancelada.",
      failed: "El estado no pudo confirmarse en este momento.",
    };

    setText(els.orderId, idValue || "—");
    setText(els.orderTotal, Number.isFinite(totalCents) ? money(totalCents) : "—");
    setText(
      els.orderStatusText,
      statusRaw === "paid" ? "Confirmado" : statusRaw === "pending" ? "Procesando" : statusRaw === "refunded" ? "Reembolsado" : statusRaw === "failed" ? "Error" : "Procesando"
    );
    setText(els.orderEmail, emailValue);
    setText(els.orderShipMode, shipModeLabel);

    setHero(
      statusRaw,
      titleMap[statusRaw] || "Estado del pedido",
      heroMap[statusRaw] || "Estableciendo conexión con el estado de tu compra."
    );

    if (els.extraHint) {
      els.extraHint.textContent =
        statusRaw === "paid"
          ? "Tu compra quedó registrada. Conserva el ID de sesión para soporte."
          : statusRaw === "pending"
            ? "Si pagaste con OXXO, la validación puede tardar hasta 1 día hábil. Si fue con tarjeta, revisa tu correo o recarga la página."
            : statusRaw === "refunded"
              ? "Si el cargo fue reembolsado, el tiempo de reflejo depende del banco o método de pago."
              : "Conserva el ID de sesión para soporte y seguimiento.";
    }

    document.body.classList.remove("is-paid", "is-pending", "is-failed", "is-refunded");
    if (statusRaw === "paid") document.body.classList.add("is-paid");
    else if (statusRaw === "pending") document.body.classList.add("is-pending");
    else if (statusRaw === "refunded") document.body.classList.add("is-refunded");
    else if (statusRaw === "failed") document.body.classList.add("is-failed");
  }

  async function hydrateSupport() {
    try {
      const data = await fetchJsonFirstOk(ROUTES.siteSettings);
      const settings = data?.site_settings || data?.data || data || {};
      const contact = settings.contact || {};
      const home = settings.home || {};
      const socials = settings.socials || {};

      const email = safeStr(contact.email || "ventas.unicotextil@gmail.com", "ventas.unicotextil@gmail.com");
      const waE164 = safeStr(contact.whatsapp_e164 || "5216642368701", "5216642368701");
      const waDisplay = safeStr(contact.whatsapp_display || "664 236 8701", "664 236 8701");
      const footerText = safeStr(
        home.footer_note || "Pago cifrado vía Stripe. Aceptamos OXXO Pay. Logística inteligente internacional con Envía.com.",
        "Pago cifrado vía Stripe. Aceptamos OXXO Pay. Logística inteligente internacional con Envía.com."
      );

      if (els.successSupportEmail) {
        setText(els.successSupportEmail, email);
        setHref(els.successSupportEmail, `mailto:${email}`);
      }

      if (els.successSupportWa) {
        setText(els.successSupportWa, waDisplay);
        setHref(els.successSupportWa, `https://wa.me/${encodeURIComponent(waE164)}`);
      }

      if (els.footerNote) setText(els.footerNote, footerText);

      const fb = $("#footerFacebookLink");
      const ig = $("#footerInstagramLink");
      const yt = $("#footerYoutubeLink");
      if (fb && socials.facebook) setHref(fb, socials.facebook);
      if (ig && socials.instagram) setHref(ig, socials.instagram);
      if (yt && socials.youtube) setHref(yt, socials.youtube);
    } catch {}
  }

  async function loadStatus() {
    const sessionId = getSessionId();

    if (els.copyBtn && sessionId) {
      els.copyBtn.dataset.sessionId = sessionId;
    }

    if (!sessionId) {
      setHero("failed", "Sin ID de sesión", "No se pudo identificar el pedido.");
      setText(els.orderId, "—");
      setText(els.orderTotal, "—");
      setText(els.orderStatusText, "Procesando");
      setText(els.orderEmail, "—");
      setText(els.orderShipMode, "No definido");
      return;
    }

    try {
      setHero("default", "Verificando pedido...", "Estableciendo conexión con el estado de tu compra.");
      const data = await fetchJsonFirstOk(ROUTES.checkoutStatus.map((u) => `${u}?session_id=${encodeURIComponent(sessionId)}`));
      if (!data || data.ok === false) throw new Error(data?.error || "No se pudo verificar el estado");
      applyOrderData(data, sessionId);
    } catch {
      setHero("failed", "Error temporal", "No se pudo verificar el estado en este momento.");
      setText(els.orderId, sessionId);
      setText(els.orderStatusText, "Procesando");
      if (els.extraHint) els.extraHint.textContent = "La orden puede seguir sincronizándose. Conserva el ID de sesión para soporte.";
    }
  }

  function bindCopy() {
    if (!els.copyBtn) return;
    els.copyBtn.addEventListener("click", async () => {
      const text = safeStr(els.orderId?.textContent || "", "");
      if (!text || text === "—") return;
      try {
        await navigator.clipboard.writeText(text);
        const original = els.copyBtn.textContent;
        els.copyBtn.textContent = "Copiado ✅";
        setTimeout(() => {
          els.copyBtn.textContent = original || "Copiar ID";
        }, 1500);
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