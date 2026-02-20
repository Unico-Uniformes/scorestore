"use strict";

const {
  jsonResponse,
  handleOptions,
  safeJsonParse
} = require("./_shared");
const fetch = require("node-fetch");

exports.handler = async (event) => {
  const origin = event?.headers?.origin || event?.headers?.Origin;

  try {
    if (event.httpMethod === "OPTIONS") return handleOptions(event);
    if (event.httpMethod !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" }, origin);

    const body = safeJsonParse(event.body) || {};
    const postalCode = String(body.postal_code || "").trim();
    const country = String(body.country || "MX").trim().toUpperCase();

    if (!postalCode || postalCode.length < 4) {
      return jsonResponse(400, { ok: false, error: "Código postal inválido" }, origin);
    }

    // Estructura real de la API de Envía.com
    const enviaPayload = {
      origin: {
        name: "Score Store TJ",
        company: "Unico Uniformes",
        email: "contacto.hocker@gmail.com",
        phone: "6643011271",
        street: "Calle Base",
        number: "123",
        district: "Centro",
        city: "Tijuana",
        state: "BC",
        country: "MX",
        postalCode: "22000"
      },
      destination: {
        name: "Cliente",
        country: country,
        postalCode: postalCode
      },
      packages: [
        {
          content: "Merch Oficial",
          amount: 1,
          type: "box",
          dimensions: { length: 20, width: 20, height: 10 },
          weight: 1,
          weightUnit: "KG",
          lengthUnit: "CM"
        }
      ],
      shipment: { carrier: "fedex", type: 1 } 
    };

    // Llamada a la API Real de Envía (Sustituye 'TU_TOKEN_ENVIA' en tus variables de entorno)
    const enviaResponse = await fetch("https://api.envia.com/ship/rate/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.ENVIA_API_KEY || 'FALLBACK_TOKEN'}`
      },
      body: JSON.stringify(enviaPayload)
    });

    const enviaData = await enviaResponse.json();

    // Si no hay token configurado o falla, devuelve un fallback seguro para UX
    if (!enviaResponse.ok || enviaData.error) {
       console.warn("Envía API Error/Fallback activado.");
       return jsonResponse(200, {
        ok: true,
        amount_cents: country === "US" ? 35000 : 18000, 
        amount_mxn: country === "US" ? 350 : 180,
        label: "Envío Estándar Garantizado",
        provider: "envia_fallback"
      }, origin);
    }

    // Extracción exitosa (Asumiendo que Envia devuelve data.data[0].totalPrice)
    const rate = enviaData.data[0];
    const finalAmountCents = Math.round(Number(rate.totalPrice) * 100);

    return jsonResponse(200, {
      ok: true,
      amount_cents: finalAmountCents,
      amount_mxn: Number(rate.totalPrice),
      label: rate.carrierDescription || "Envío Estándar",
      provider: "envia"
    }, origin);

  } catch (error) {
    console.error("Shipping Quote Error:", error);
    return jsonResponse(500, { ok: false, error: "Error interno al cotizar." }, origin);
  }
};
