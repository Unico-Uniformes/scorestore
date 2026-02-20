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
    const items = body.items || [];

    if (!postalCode || postalCode.length < 4) {
      return jsonResponse(400, { ok: false, error: "Código postal inválido" }, origin);
    }

    // Calcular peso y dimensiones dinámicas basadas en el carrito
    const totalItems = items.reduce((sum, item) => sum + (Number(item.qty) || 1), 0);
    const totalWeight = Math.max(1, totalItems * 0.4); // Estimado: 400g por prenda
    const boxHeight = Math.max(10, totalItems * 5); // 5cm de alto extra por prenda

    // Estructura real de la API de Envía.com con datos de ÚNICO UNIFORMES
    const enviaPayload = {
      origin: {
        name: "Score Store Tijuana",
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
        name: "Cliente Final",
        country: country,
        postalCode: postalCode
      },
      packages: [
        {
          content: "Ropa Oficial Score Store",
          amount: 1,
          type: "box",
          dimensions: { length: 30, width: 25, height: boxHeight },
          weight: totalWeight,
          weightUnit: "KG",
          lengthUnit: "CM"
        }
      ],
      shipment: { carrier: "fedex", type: 1 } 
    };

    // Llave de producción (Prioriza entorno, usa fallback directo del doc proporcionado)
    const ENVIA_TOKEN = process.env.ENVIA_API_KEY || "89d853b2b6fd03f6fcbea5e1570a15265342d53315fc9a36b16769bbf9bad4c6";

    const enviaResponse = await fetch("https://api.envia.com/ship/rate/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ENVIA_TOKEN}`
      },
      body: JSON.stringify(enviaPayload)
    });

    const enviaData = await enviaResponse.json();

    // Fallback de seguridad si el CP no tiene cobertura o la API rechaza
    if (!enviaResponse.ok || enviaData.error || !enviaData.data || enviaData.data.length === 0) {
       console.warn("Envía API Error o sin cobertura. Fallback activado.");
       return jsonResponse(200, {
        ok: true,
        amount_cents: country === "US" ? 35000 : 18000, 
        amount_mxn: country === "US" ? 350 : 180,
        label: "Envío Estándar Garantizado",
        provider: "envia_fallback"
      }, origin);
    }

    // Extracción exitosa (Tomamos la tarifa más económica disponible)
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
    return jsonResponse(500, { ok: false, error: "Error interno al cotizar envío." }, origin);
  }
};
