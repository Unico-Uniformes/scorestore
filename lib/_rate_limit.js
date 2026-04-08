"use strict";
const { supabaseAdmin } = require("./_shared.js");

const WINDOW = 60 * 1000; // 1 min
const LIMIT = 60;

function normalizeIP(ip) {
  const raw = String(ip || "").trim();
  if (!raw) return "unknown";
  const first = raw.split(",")[0].trim();
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(first)) return first.split(":")[0];
  return first;
}

function getIP(req) {
  const h = req?.headers || {};
  return normalizeIP(
    h["x-forwarded-for"] || h["x-real-ip"] || h["cf-connecting-ip"] || req?.socket?.remoteAddress || "unknown"
  );
}

// Transformado a asíncrono para interactuar con la DB real
async function rateLimit(req) {
  const ip = getIP(req);
  if (ip === "unknown") return { ok: true, remaining: LIMIT, limit: LIMIT, resetAt: Date.now() + WINDOW };

  const sb = supabaseAdmin();
  if (!sb) return { ok: true, remaining: LIMIT, limit: LIMIT, resetAt: Date.now() + WINDOW }; // Fallback si no hay DB

  const key = `ratelimit_${ip}`;
  const now = Date.now();

  try {
    const { data } = await sb.from("kv_store").select("*").eq("key", key).maybeSingle();
    let count = 1;
    let ts = now;

    if (data && data.value) {
       const current = data.value;
       if (now - current.ts <= WINDOW) {
           count = current.count + 1;
           ts = current.ts;
       }
    }

    await sb.from("kv_store").upsert({ key, value: { count, ts }, expires_at: new Date(ts + WINDOW).toISOString() });

    if (count > LIMIT) {
      return { ok: false, error: "rate_limited", remaining: 0, limit: LIMIT, resetAt: ts + WINDOW };
    }
    return { ok: true, remaining: Math.max(0, LIMIT - count), limit: LIMIT, resetAt: ts + WINDOW };
  } catch (error) {
    return { ok: true, remaining: LIMIT, limit: LIMIT, resetAt: now + WINDOW };
  }
}

module.exports = { rateLimit };
