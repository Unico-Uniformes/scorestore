# SCORE Store — Tienda Oficial (PROD 2026)

**Operación / fabricación:** Único Uniformes (Tijuana)  
**Checkout:** Stripe Checkout (Tarjeta + OXXO)  
**Envíos:** Envia.com (cotización + guía)  
**Notificaciones:** Telegram (opcional)  
**IA (opcional):** Gemini (chat soporte/ventas)

---

## Estructura

```txt
/
├─ assets/                 # imágenes (webp) + icons PWA
├─ css/
│  └─ styles.css
├─ data/
│  ├─ catalog.json
│  └─ promos.json
├─ js/
│  └─ main.js
├─ netlify/
│  └─ functions/
│     ├─ _shared.js
│     ├─ create_checkout.js        # /api/checkout
│     ├─ quote_shipping.js         # /api/quote
│     ├─ stripe_webhook.js         # /.netlify/functions/stripe_webhook
│     ├─ envia_webhook.js          # /.netlify/functions/envia_webhook
│     └─ chat.js                   # /api/chat
├─ index.html
├─ success.html
├─ cancel.html
├─ legal.html
├─ netlify.toml
├─ package.json
├─ robots.txt
├─ site.webmanifest
├─ sitemap.xml
└─ sw.js
