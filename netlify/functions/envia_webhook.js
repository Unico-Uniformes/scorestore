"use strict";

/**
 * =========================================================
 * envia_webhook.js (Netlify Function)
 *
 * PRO FIXES: Update idempotente y alertas limpias.
 * =========================================================
 */

const {
  jsonResponse,
  handleOptions,
  safeJsonParse,
  isSupabaseConfigured,
  supabaseAdmin,
  sendTelegram,
} = require("./_shared");

const getProvidedToken = (event) => {
  const h = event?.headers || {};
  return (
    h["x-envia-token"] ||
    h["X-Envia-Token"] ||
    h["x-webhook-token"] ||
    h["X-Webhook-Token"] ||
    (event?.queryStringParameters ? event.queryStringParameters.token : null) ||
    null
  );
};

exports.handler = async (event) => {
  const origin = event?.headers?.origin || event?.headers?.Origin || "*";

  try {
    if (event.httpMethod === "OPTIONS") return handleOptions(event);
    if (event.httpMethod !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" }, origin);

    const required = String(process.env.ENVIA_WEBHOOK_TOKEN || "").trim();
    if (required) {
      const provided = String(getProvidedToken(event) || "").trim();
      if (!provided || provided !== required) {
        return jsonResponse(401, { ok: false, error: "Unauthorized access" }, origin);
      }
    }

    const payload = safeJsonParse(event.body) || {};

    const trackingNumber = payload?.data?.trackingNumber || payload?.tracking_number || payload?.trackingNumber || null;
    const status = payload?.data?.status || payload?.status || "UNKNOWN";
    const carrier = payload?.data?.carrier || payload?.carrier || "envia";

    if (isSupabaseConfigured()) {
      const sb = supabaseAdmin();
      if (sb) {
        try {
          await sb.from("shipping_webhooks").insert({
            provider: carrier,
            tracking_number: trackingNumber,
            status,
            raw: payload,
            created_at: new Date().toISOString(),
          });

          if (trackingNumber) {
            await sb
              .from("shipping_labels")
              .update({
                status,
                updated_at: new Date().toISOString(),
              })
              .eq("tracking_number", trackingNumber);

            if (String(status).toUpperCase() === "DELIVERED" || String(status).toUpperCase() === "ENTREGADO") {
              try {
                await sendTelegram(
                  `📦 ✅ <b>Paquete Entregado</b>\nTracking: <code>${trackingNumber}</code>\nCarrier: <b>${String(carrier).toUpperCase()}</b>\n¡El cliente recibió su Merch SCORE!`
                );
              } catch {}
            }
          }
        } catch (e) {
          console.error("[shipping_webhooks] Supabase sync error:", e?.message);
        }
      }
    }

    return jsonResponse(200, { ok: true, received: true }, origin);
  } catch (e) {
    console.error("[envia_webhook] fatal error:", e);
    return jsonResponse(200, { ok: true, warning: "Processed with minor errors" }, origin);
  }
};