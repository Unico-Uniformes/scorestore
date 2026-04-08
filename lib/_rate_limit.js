"use strict";

/**
 * IMPORTANTE: Importamos supabaseAdmin desde tu archivo central de librerías.
 * Esto permite que el rate limit sea parte de la misma función que lo llama,
 * respetando el límite de 12 funciones de Vercel.
 */
const { supabaseAdmin } = require("./_shared.js");

const WINDOW = 60 * 1000; // 1 minuto
const LIMIT = 60; // Máximo de peticiones por minuto por IP

/**
 * Normaliza la IP para entornos de Vercel.
 * Es vital para que el límite sea real y no bloquee a todos los usuarios 
 * bajo la IP del proxy de Vercel.
 */
function normalizeIP(ip) {
  const raw = String(ip || "").trim();
  if (!raw) return "unknown";
  const first = raw.split(",")[0].trim();
  // Limpia puertos (ej. 127.0.0.1:4532 -> 127.0.0.1)
  if (first.includes(":") && !first.includes("[")) return first.split(":")[0];
  return first;
}

function getIP(req) {
  const h = req?.headers || {};
  return normalizeIP(
    h["x-forwarded-for"] || 
    h["x-real-ip"] || 
    h["cf-connecting-ip"] || 
    req?.socket?.remoteAddress || 
    "unknown"
  );
}

/**
 * rateLimit: Función asíncrona que usa la tabla 'kv_store' de Supabase.
 * Se integra dentro de tus funciones existentes para no crear archivos .js nuevos en /api/
 */
async function rateLimit(req) {
  const ip = getIP(req);
  const now = Date.now();

  // Si no se detecta IP, dejamos pasar (fail-safe)
  if (ip === "unknown") {
    return { ok: true, remaining: LIMIT, limit: LIMIT, resetAt: now + WINDOW };
  }

  const sb = supabaseAdmin();
  // Si Supabase no está listo, no bloqueamos la venta
  if (!sb) {
    return { ok: true, remaining: LIMIT, limit: LIMIT, resetAt: now + WINDOW };
  }

  const key = `ratelimit_${ip}`;

  try {
    // 1. Consultamos el estado actual en la DB
    const { data, error } = await sb
      .from("kv_store")
      .select("value")
      .eq("key", key)
      .maybeSingle();

    if (error) throw error;

    let count = 1;
    let ts = now;

    if (data && data.value) {
      const current = data.value;
      // Si el registro es reciente (dentro del minuto), incrementamos
      if (now - current.ts <= WINDOW) {
        count = (current.count || 0) + 1;
        ts = current.ts;
      } else {
        // Si ya pasó el minuto, reiniciamos contador
        count = 1;
        ts = now;
      }
    }

    // 2. Guardamos o actualizamos usando upsert. 
    // NOTA: 'key' debe ser PRIMARY KEY en tu tabla kv_store de Supabase.
    await sb.from("kv_store").upsert({
      key,
      value: { count, ts },
      updated_at: new Date().toISOString(),
      expires_at: new Date(ts + WINDOW).toISOString()
    }, { onConflict: 'key' });

    // 3. Verificamos si excedió el límite
    if (count > LIMIT) {
      return { 
        ok: false, 
        error: "rate_limited", 
        remaining: 0, 
        limit: LIMIT, 
        resetAt: ts + WINDOW 
      };
    }

    return { 
      ok: true, 
      remaining: Math.max(0, LIMIT - count), 
      limit: LIMIT, 
      resetAt: ts + WINDOW 
    };

  } catch (err) {
    console.error("[RateLimit Error]:", err.message);
    // En caso de error de DB, permitimos el paso para no romper el flujo de pago
    return { ok: true, remaining: LIMIT, limit: LIMIT, resetAt: now + WINDOW };
  }
}

module.exports = { rateLimit, getIP };
