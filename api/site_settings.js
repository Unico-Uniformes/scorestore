'use strict';

const { supabaseAdmin, jsonResponse, handleOptions, readPublicSiteSettings, SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_WHATSAPP_E164, SUPPORT_WHATSAPP_DISPLAY } = require('./_shared');

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';

  if (req.method === 'OPTIONS') {
    const optionsRes = handleOptions({ headers: req.headers });
    Object.keys(optionsRes.headers || {}).forEach(key => res.setHeader(key, optionsRes.headers[key]));
    res.status(optionsRes.statusCode).send(optionsRes.body);
    return;
  }

  if (req.method !== 'GET') {
    const response = jsonResponse(405, { ok: false, error: 'Method not allowed' }, origin);
    Object.keys(response.headers || {}).forEach(key => res.setHeader(key, response.headers[key]));
    res.status(response.statusCode).send(response.body);
    return;
  }

  try {
    const sb = supabaseAdmin();
    if (sb) {
      const { data: settings, error } = await sb.from('site_settings').select('*').limit(1).maybeSingle();
      if (!error && settings) {
        const response = jsonResponse(200, { ok: true, settings, source: 'database' }, origin);
        Object.keys(response.headers || {}).forEach(key => res.setHeader(key, response.headers[key]));
        res.status(response.statusCode).send(response.body);
        return;
      }
    }

    const defaultSettings = await readPublicSiteSettings();
    const response = jsonResponse(200, {
      ok: true,
      settings: { ...defaultSettings, contact_email: SUPPORT_EMAIL, contact_phone: SUPPORT_PHONE, whatsapp_e164: SUPPORT_WHATSAPP_E164, whatsapp_display: SUPPORT_WHATSAPP_DISPLAY },
      source: 'defaults'
    }, origin);
    Object.keys(response.headers || {}).forEach(key => res.setHeader(key, response.headers[key]));
    res.status(response.statusCode).send(response.body);
  } catch (e) {
    console.error('[site_settings] error:', e?.message);
    const response = jsonResponse(500, { ok: false, error: 'site_settings_failed' }, origin);
    Object.keys(response.headers || {}).forEach(key => res.setHeader(key, response.headers[key]));
    res.status(response.statusCode).send(response.body);
  }
};