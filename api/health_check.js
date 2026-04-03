// api/health_check.js
"use strict";

const noStoreHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function send(res, statusCode, payload) {
  res.statusCode = statusCode;
  for (const [k, v] of Object.entries(noStoreHeaders)) {
    res.setHeader(k, v);
  }
  res.end(JSON.stringify(payload));
}

function hasValue(...values) {
  return values.some((v) => String(v || "").trim().length > 0);
}

function checkRequired(label, value, description) {
  const ok = hasValue(value);
  return {
    label,
    status: ok ? "✅ Encontrada" : "❌ FALTANTE",
    ok,
    critical: true,
    description,
  };
}

function checkRecommended(label, value, description) {
  const ok = hasValue(value);
  return {
    label,
    status: ok ? "✅ Encontrada" : "⚠️ RECOMENDADA",
    ok,
    critical: false,
    description,
  };
}

function buildHealthReport() {
  const checks = {
    NEXT_PUBLIC_SUPABASE_URL: checkRequired(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      "Obligatoria para conectar el frontend con Supabase."
    ),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: checkRequired(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      "Obligatoria para autenticar el cliente web con Supabase."
    ),
    SUPABASE_URL: checkRequired(
      "SUPABASE_URL",
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
      "Obligatoria para conectar a la base de datos."
    ),
    SUPABASE_SERVICE_ROLE_KEY: checkRequired(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SECRET_KEY ||
        process.env.SUPABASE_SERVICE_ROLE,
      "Obligatoria para operaciones server-side con privilegios."
    ),
    STRIPE_SECRET_KEY: checkRequired(
      "STRIPE_SECRET_KEY",
      process.env.STRIPE_SECRET_KEY,
      "Obligatoria para procesar pagos y webhooks."
    ),
    ENVIA_API_KEY: checkRequired(
      "ENVIA_API_KEY",
      process.env.ENVIA_API_KEY,
      "Obligatoria para cotizar y generar envíos."
    ),
    GEMINI_API_KEY: checkRequired(
      "GEMINI_API_KEY",
      process.env.GEMINI_API_KEY,
      "Obligatoria para la IA del panel."
    ),
    GEMINI_MODEL: checkRecommended(
      "GEMINI_MODEL",
      process.env.GEMINI_MODEL,
      "Recomendada para fijar el modelo principal de IA."
    ),
    FX_USD_TO_MXN: checkRecommended(
      "FX_USD_TO_MXN",
      process.env.FX_USD_TO_MXN,
      "Recomendada si Stripe opera en USD y se reporta en MXN."
    ),
    SITE_URL: checkRecommended(
      "SITE_URL",
      process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL,
      "Recomendada para redirecciones y enlaces canónicos."
    ),
    VERCEL_URL: checkRecommended(
      "VERCEL_URL",
      process.env.VERCEL_URL,
      "Recomendada para contexto de despliegue."
    ),
    NEXT_PUBLIC_SCORESTORE_URL: checkRecommended(
      "NEXT_PUBLIC_SCORESTORE_URL",
      process.env.NEXT_PUBLIC_SCORESTORE_URL,
      "Recomendada para enlazar la tienda pública."
    ),
    STRIPE_WEBHOOK_SECRET: checkRecommended(
      "STRIPE_WEBHOOK_SECRET",
      process.env.STRIPE_WEBHOOK_SECRET,
      "Recomendada para validar webhooks de Stripe."
    ),
    ENVIA_WEBHOOK_SECRET: checkRecommended(
      "ENVIA_WEBHOOK_SECRET",
      process.env.ENVIA_WEBHOOK_SECRET,
      "Recomendada para validar webhooks de Envía."
    ),
  };

  const entries = Object.values(checks);
  const criticalMissing = entries.filter((item) => item.critical && !item.ok);
  const recommendedMissing = entries.filter((item) => !item.critical && !item.ok);

  const allGood = criticalMissing.length === 0;

  const summary = allGood
    ? "Todas las variables de entorno críticas están configuradas."
    : "Faltan una o más variables de entorno críticas. La API no puede funcionar.";

  return {
    ok: true,
    summary,
    ready: allGood,
    health_report: checks,
    critical_missing: criticalMissing.map((x) => x.label),
    recommended_missing: recommendedMissing.map((x) => x.label),
    timestamp: new Date().toISOString(),
  };
}

module.exports = (req, res) => {
  try {
    if (req.method && req.method !== "GET" && req.method !== "HEAD") {
      return send(res, 405, {
        ok: false,
        error: "Method not allowed",
      });
    }

    const payload = buildHealthReport();

    if (req.method === "HEAD") {
      res.statusCode = 200;
      for (const [k, v] of Object.entries(noStoreHeaders)) {
        res.setHeader(k, v);
      }
      return res.end();
    }

    return send(res, 200, payload);
  } catch (err) {
    return send(res, 500, {
      ok: false,
      error: err?.message || "No fue posible evaluar la salud del sistema.",
    });
  }
};