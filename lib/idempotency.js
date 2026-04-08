// lib/idempotency.js
"use strict";

const { supabaseAdmin } = require("./_shared.js");

function getKey(req) {
  return (
    req.headers["idempotency-key"] ||
    req.headers["Idempotency-Key"] ||
    ""
  );
}

async function checkIdempotency(key) {
  if (!key) return { ok: true };

  const sb = supabaseAdmin();
  // Fallback seguro: si no hay DB configurada, permitimos que pase para no romper el flujo
  if (!sb) return { ok: true }; 

  try {
    const { data, error } = await sb
      .from("kv_store")
      .select("value")
      .eq("key", `idem_${key}`)
      .maybeSingle();

    if (error) throw error;

    if (data && data.value) {
      return {
        ok: false,
        cached: data.value,
      };
    }
  } catch (error) {
    console.error("[checkIdempotency] Error leyendo DB:", error?.message || error);
  }

  return { ok: true };
}

async function saveIdempotency(key, response) {
  if (!key) return;

  const sb = supabaseAdmin();
  if (!sb) return;

  try {
    // Expira en 24 horas para mantener la BD limpia sin saturar el almacenamiento
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    
    const { error } = await sb.from("kv_store").upsert({
      key: `idem_${key}`,
      value: response,
      expires_at: expires
    });

    if (error) throw error;
  } catch (error) {
    console.error("[saveIdempotency] Error escribiendo en DB:", error?.message || error);
  }
}

async function clearIdempotency(key) {
  const safeKey = String(key || "").trim();
  if (!safeKey) return;

  const sb = supabaseAdmin();
  if (!sb) return;

  try {
    const { error } = await sb.from("kv_store").delete().eq("key", `idem_${safeKey}`);
    if (error) throw error;
  } catch (error) {
    console.error("[clearIdempotency] Error borrando en DB:", error?.message || error);
  }
}

async function resetIdempotencyStore() {
  const sb = supabaseAdmin();
  if (!sb) return;

  try {
    // Borramos solo las llaves de idempotencia para no afectar otros procesos del kv_store
    const { error } = await sb.from("kv_store").delete().like("key", "idem_%");
    if (error) throw error;
  } catch (error) {
    console.error("[resetIdempotencyStore] Error reseteando DB:", error?.message || error);
  }
}

module.exports = {
  getKey,
  checkIdempotency,
  saveIdempotency,
  clearIdempotency,
  resetIdempotencyStore,
};
