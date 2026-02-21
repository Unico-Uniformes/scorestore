# SCORE Store — Tienda Oficial (V4 PROD 2026)

**Operación y Fabricación:** Único Uniformes (BAJATEX)  
**Checkout de Alta Seguridad:** Stripe Checkout (Tarjeta de Crédito/Débito + OXXO Pay)  
**Logística Nacional e Internacional:** Envía.com (Cotización en tiempo real + Guías Automáticas)  
**Sistema de Alertas:** Notificaciones instantáneas vía Telegram  
**Inteligencia Artificial:** SCORE AI (Asistente de ventas motorizado por Google Gemini)  
**Centro de Administración:** Conectado directamente a **UnicOs Admin App** vía Supabase.

---

## Arquitectura del Proyecto (DevSecOps Standard)

```txt
/
├─ assets/                 # Imágenes optimizadas (webp) + Íconos PWA
├─ css/
│  └─ styles.css           # UI/UX con Aceleración por Hardware (GPU)
├─ data/
│  ├─ catalog.json         # Base de Datos estática de productos
│  └─ promos.json          # Reglas dinámicas de descuentos
├─ db/
│  └─ schema.sql           # Tablas Supabase (orders, shipping_labels, webhooks con Índices de alto rendimiento)
├─ js/
│  └─ main.js              # Lógica de carrito, UI, validaciones anti-fraude y PWA
├─ netlify/
│  └─ functions/           # Backend Serverless (Node.js)
│     ├─ _shared.js                # Core y utilidades compartidas
│     ├─ create_checkout.js        # POST /.netlify/functions/create_checkout (Seguridad Anti-DoS)
│     ├─ quote_shipping.js         # POST /.netlify/functions/quote_shipping
│     ├─ checkout_status.js        # GET  /.netlify/functions/checkout_status?session_id=...
│     ├─ stripe_webhook.js         # POST /.netlify/functions/stripe_webhook (Idempotente)
│     ├─ envia_webhook.js          # POST /.netlify/functions/envia_webhook
│     └─ chat.js                   # POST /.netlify/functions/chat (Anti-Prompt Injection)
├─ scripts/
│  ├─ fix_assets_aliases.sh        # Sanitizador de nombres de imágenes
│  └─ generate_pwa_icons.py        # Generador de íconos compatibles con Pillow 10+
├─ index.html
├─ success.html
├─ cancel.html
├─ legal.html
├─ netlify.toml            # Reglas de construcción, enrutamiento y Headers HTTP Seguros
├─ package.json
├─ robots.txt
├─ site.webmanifest
├─ sitemap.xml
└─ sw.js                   # Service Worker para funcionamiento offline e instalación PWA
