# SCORE Store — Tienda Oficial (PROD 2026)

**Operación / fabricación:** Único Uniformes (BAJATEX)  
**Checkout:** Stripe Checkout (Tarjeta + OXXO opcional)  
**Envíos:** Envía.com (cotización + guía automática)  
**Notificaciones:** Telegram (opcional)  
**IA (opcional):** Gemini (chat soporte/ventas)  
**Admin App:** UnicOs (consume Supabase: orders + shipping_labels)

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
├─ db/
│  └─ schema.sql           # tablas Supabase (orders + shipping_labels + webhooks)
├─ js/
│  └─ main.js
├─ netlify/
│  └─ functions/
│     ├─ _shared.js
│     ├─ create_checkout.js        # POST /.netlify/functions/create_checkout
│     ├─ quote_shipping.js         # POST /.netlify/functions/quote_shipping
│     ├─ checkout_status.js        # GET  /.netlify/functions/checkout_status?session_id=...
│     ├─ stripe_webhook.js         # POST /.netlify/functions/stripe_webhook
│     ├─ envia_webhook.js          # POST /.netlify/functions/envia_webhook
│     └─ chat.js                   # POST /.netlify/functions/chat
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
```

---

## Setup rápido (Netlify)

1) Sube el repo a GitHub y conéctalo a Netlify.  
2) En **Netlify → Site settings → Environment variables**, agrega lo de `.env.example`.  
3) En Stripe, crea un **Webhook endpoint** apuntando a:

- `https://TU-DOMINIO/.netlify/functions/stripe_webhook`

Eventos recomendados:
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`

> Esto es clave para OXXO / pagos “delayed”: no se debe generar guía hasta que Stripe confirme el pago.

4) (Opcional) En Envía, configura webhook a:
- `https://TU-DOMINIO/.netlify/functions/envia_webhook`

---

## Supabase (para UnicOs)

Ejecuta `db/schema.sql` en Supabase (public schema).  
Tablas clave:
- `orders` (idempotente por `stripe_session_id`)
- `shipping_labels` (idempotente por `stripe_session_id`)
- `shipping_webhooks` (logs de tracking)

---

## Dev local

```bash
npm i
npx netlify dev
```

Luego abre el URL que te da Netlify Dev (normalmente http://localhost:8888).