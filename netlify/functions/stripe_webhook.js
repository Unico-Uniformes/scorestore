import Stripe from "stripe";
import { getSupabaseAdmin, json, withCORS, rawBody } from "./_shared.js";

export const handler = withCORS(async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!stripeSecret) return json(500, { error: "STRIPE_SECRET_KEY missing" });
    if (!webhookSecret) return json(500, { error: "STRIPE_WEBHOOK_SECRET missing" });

    const stripe = new Stripe(stripeSecret, { apiVersion: "2024-06-20" });

    const sig = event.headers["stripe-signature"];
    const payload = rawBody(event);

    let ev;
    try {
      ev = stripe.webhooks.constructEvent(payload, sig, webhookSecret);
    } catch (e) {
      return json(400, { error: `Webhook signature failed: ${e.message}` });
    }

    const db = getSupabaseAdmin();

    if (ev.type === "checkout.session.completed") {
      const session = ev.data.object;

      const org_id = session?.metadata?.org_id || null;

      // Update order paid (UPSERT by stripe_session_id)
      await db.from("orders").upsert(
        {
          org_id: org_id || null,
          stripe_session_id: session.id,
          stripe_payment_intent_id: session.payment_intent || null,
          status: "paid",
          currency: session.currency || null,
          amount_total_cents: session.amount_total || null,
          amount_subtotal_cents: session.amount_subtotal || null,
          shipping_mode: session?.metadata?.shipping_mode || null,
          postal_code: session?.metadata?.postal_code || null,
          promo_code: session?.metadata?.promo_code || null,
          customer_email: session.customer_details?.email || null,
          customer_phone: session.customer_details?.phone || null,
          shipping_name: session.shipping_details?.name || null,
          shipping_address: session.shipping_details?.address || null,
          paid_at: new Date().toISOString(),
          raw_stripe: session,
        },
        { onConflict: "stripe_session_id" }
      );

      // (Optional) If you generate label on paid, you can store it.
      // If you already generate it elsewhere, this stays safe due to UPSERT.
      // Example label object expected in session.metadata or elsewhere:
      const label = session?.metadata?.label ? safeJson(session.metadata.label) : null;

      if (label) {
        await db.from("shipping_labels").upsert({
                org_id: org_id || null,
                stripe_session_id: session.id,
                provider: "envia",
                created_at: new Date().toISOString(),
                carrier: label.carrier || null,
                tracking_number: label.tracking_number || null,
                label_url: label.label_url || null,
                raw: label.raw || null,
              }, { onConflict: "stripe_session_id,provider" });
      }
    }

    return json(200, { received: true });
  } catch (err) {
    console.error(err);
    return json(500, { error: err?.message || "Server error" });
  }
});

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}