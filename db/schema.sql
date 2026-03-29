-- =========================================================
-- SCORE STORE — SAFE SQL (IDEMPOTENT) v2026-02-26
-- Target: Supabase Postgres (public schema)
-- Objetivo:
-- - Multi-tenant REAL (Score Store + UnicOs + futuras marcas)
-- - Sin romper: crea lo faltante, respeta lo existente
-- =========================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1) Organizations
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Score Store default org (ID fijo)
INSERT INTO public.organizations (id, name, slug, metadata)
VALUES (
  '1f3b9980-a1c5-4557-b4eb-a75bb9a8aaa6'::uuid,
  'Score Store',
  'score-store',
  jsonb_build_object('source','schema.sql','created','2026-02-26')
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  slug = COALESCE(NULLIF(public.organizations.slug,''), EXCLUDED.slug),
  metadata = public.organizations.metadata || EXCLUDED.metadata;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.organizations'::regclass
      AND contype='u'
      AND pg_get_constraintdef(oid) ILIKE '%(slug)%'
  ) THEN
    ALTER TABLE public.organizations ADD CONSTRAINT organizations_slug_uniq UNIQUE (slug);
  END IF;
EXCEPTION WHEN duplicate_object THEN
END $$;

-- -----------------------------------------------------------------------------
-- 2) Admin users (multi-tenant)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NULL,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'staff',
  is_active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login timestamptz NULL
);

DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'public.admin_users'::regclass
    AND contype='u'
    AND pg_get_constraintdef(oid) ILIKE '%(email)%'
    AND pg_get_constraintdef(oid) NOT ILIKE '%(organization_id, email)%'
  LIMIT 1;

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.admin_users DROP CONSTRAINT %I', cname);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.admin_users'::regclass
      AND contype='u'
      AND pg_get_constraintdef(oid) ILIKE '%(organization_id, email)%'
  ) THEN
    ALTER TABLE public.admin_users ADD CONSTRAINT admin_users_org_email_uniq UNIQUE (organization_id, email);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_admin_users_email_norm ON public.admin_users ((lower(trim(email))));
CREATE INDEX IF NOT EXISTS idx_admin_users_org ON public.admin_users (organization_id);

-- -----------------------------------------------------------------------------
-- 3) Orders
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NULL REFERENCES public.organizations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  email text NULL,
  customer_name text NULL,
  phone text NULL,
  currency text NOT NULL DEFAULT 'MXN',
  amount_subtotal_mxn numeric(12,2) NULL,
  amount_shipping_mxn numeric(12,2) NULL,
  amount_discount_mxn numeric(12,2) NULL,
  amount_total_mxn numeric(12,2) NULL,
  promo_code text NULL,
  items_summary text NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  shipping_mode text NULL,
  postal_code text NULL,
  stripe_session_id text NULL,
  stripe_payment_intent_id text NULL,
  stripe_customer_id text NULL,
  status text NOT NULL DEFAULT 'pending',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_stripe_session ON public.orders(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_orders_org ON public.orders(organization_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND contype='u'
      AND pg_get_constraintdef(oid) ILIKE '%(stripe_session_id)%'
  ) THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_stripe_session_id_uniq UNIQUE (stripe_session_id);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 4) Shipping labels + webhooks
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shipping_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NULL REFERENCES public.organizations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  stripe_session_id text NULL,
  carrier text NULL,
  tracking_number text NULL,
  label_url text NULL,
  status text NOT NULL DEFAULT 'pending',
  raw jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_shipping_labels_session ON public.shipping_labels(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_shipping_labels_org ON public.shipping_labels(org_id);
CREATE INDEX IF NOT EXISTS idx_shipping_labels_tracking ON public.shipping_labels(tracking_number);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.shipping_labels'::regclass
      AND contype='u'
      AND pg_get_constraintdef(oid) ILIKE '%(stripe_session_id)%'
  ) THEN
    ALTER TABLE public.shipping_labels ADD CONSTRAINT shipping_labels_stripe_session_id_uniq UNIQUE (stripe_session_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.shipping_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  provider text NOT NULL DEFAULT 'envia',
  status text NULL,
  tracking_number text NULL,
  stripe_session_id text NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_shipping_webhooks_tracking ON public.shipping_webhooks(tracking_number);

-- -----------------------------------------------------------------------------
-- 5) RLS mínimo (backend)
-- -----------------------------------------------------------------------------
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipping_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipping_webhooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "backend_orders_all" ON public.orders;
CREATE POLICY "backend_orders_all" ON public.orders FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "backend_shipping_labels_all" ON public.shipping_labels;
CREATE POLICY "backend_shipping_labels_all" ON public.shipping_labels FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "backend_shipping_webhooks_all" ON public.shipping_webhooks;
CREATE POLICY "backend_shipping_webhooks_all" ON public.shipping_webhooks FOR ALL USING (auth.role() = 'service_role');

COMMIT;

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION public.sync_org_alias()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.org_id IS NOT NULL THEN
    NEW.organization_id := NEW.org_id;
  END IF;

  IF NEW.org_id IS NULL AND NEW.organization_id IS NOT NULL THEN
    NEW.org_id := NEW.organization_id;
  END IF;

  IF NEW.organization_id IS NOT NULL THEN
    NEW.org_id := NEW.organization_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.site_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  org_id uuid,
  hero_title text DEFAULT 'SCORE STORE',
  hero_image text NULL,
  promo_active boolean DEFAULT false,
  promo_text text NULL,
  pixel_id text NULL,
  maintenance_mode boolean DEFAULT false,
  season_key text DEFAULT 'default',
  theme jsonb NOT NULL DEFAULT '{}'::jsonb,
  home jsonb NOT NULL DEFAULT '{}'::jsonb,
  socials jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_email text NULL,
  contact_phone text NULL,
  whatsapp_e164 text NULL,
  whatsapp_display text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS org_id uuid,
  ADD COLUMN IF NOT EXISTS hero_title text DEFAULT 'SCORE STORE',
  ADD COLUMN IF NOT EXISTS hero_image text NULL,
  ADD COLUMN IF NOT EXISTS promo_active boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS promo_text text NULL,
  ADD COLUMN IF NOT EXISTS pixel_id text NULL,
  ADD COLUMN IF NOT EXISTS maintenance_mode boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS season_key text DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS theme jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS home jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS socials jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS contact_email text NULL,
  ADD COLUMN IF NOT EXISTS contact_phone text NULL,
  ADD COLUMN IF NOT EXISTS whatsapp_e164 text NULL,
  ADD COLUMN IF NOT EXISTS whatsapp_display text NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.site_settings
SET org_id = organization_id
WHERE org_id IS NULL AND organization_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_site_settings_sync_org_alias ON public.site_settings;
CREATE TRIGGER trg_site_settings_sync_org_alias
BEFORE INSERT OR UPDATE ON public.site_settings
FOR EACH ROW
EXECUTE FUNCTION public.sync_org_alias();

DROP TRIGGER IF EXISTS trg_site_settings_touch_updated_at ON public.site_settings;
CREATE TRIGGER trg_site_settings_touch_updated_at
BEFORE UPDATE ON public.site_settings
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_site_settings_org_id
  ON public.site_settings (org_id);

CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  org_id uuid,
  name text NOT NULL,
  description text NULL,
  sku text NULL,
  base_mxn numeric(12,2) NOT NULL DEFAULT 0.00,
  price_cents integer NOT NULL DEFAULT 0,
  price_mxn numeric(12,2) NOT NULL DEFAULT 0.00,
  stock integer NOT NULL DEFAULT 0,
  category text DEFAULT 'BAJA_1000',
  section_id text NULL,
  sub_section text NULL,
  rank integer NOT NULL DEFAULT 0,
  img text NULL,
  image_url text NULL,
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  sizes jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS org_id uuid,
  ADD COLUMN IF NOT EXISTS description text NULL,
  ADD COLUMN IF NOT EXISTS base_mxn numeric(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS price_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_mxn numeric(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS stock integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'BAJA_1000',
  ADD COLUMN IF NOT EXISTS section_id text NULL,
  ADD COLUMN IF NOT EXISTS sub_section text NULL,
  ADD COLUMN IF NOT EXISTS rank integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS img text NULL,
  ADD COLUMN IF NOT EXISTS image_url text NULL,
  ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sizes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.products
SET
  org_id = COALESCE(org_id, organization_id),
  active = COALESCE(active, is_active, true),
  is_active = COALESCE(is_active, active, true),
  base_mxn = CASE
    WHEN base_mxn IS NOT NULL AND base_mxn > 0 THEN base_mxn
    WHEN price_mxn IS NOT NULL AND price_mxn > 0 THEN price_mxn
    WHEN price_cents IS NOT NULL AND price_cents > 0 THEN (price_cents::numeric / 100)
    ELSE 0.00
  END,
  price_cents = CASE
    WHEN price_cents IS NOT NULL AND price_cents > 0 THEN price_cents
    WHEN price_mxn IS NOT NULL AND price_mxn > 0 THEN ROUND(price_mxn * 100)::int
    WHEN base_mxn IS NOT NULL AND base_mxn > 0 THEN ROUND(base_mxn * 100)::int
    ELSE 0
  END,
  price_mxn = CASE
    WHEN price_mxn IS NOT NULL AND price_mxn > 0 THEN price_mxn
    WHEN price_cents IS NOT NULL AND price_cents > 0 THEN (price_cents::numeric / 100)
    WHEN base_mxn IS NOT NULL AND base_mxn > 0 THEN base_mxn
    ELSE 0.00
  END,
  images = COALESCE(images, '[]'::jsonb),
  sizes = COALESCE(sizes, '[]'::jsonb),
  metadata = COALESCE(metadata, '{}'::jsonb),
  created_at = COALESCE(created_at, now()),
  updated_at = COALESCE(updated_at, now());

DROP TRIGGER IF EXISTS trg_products_sync_org_alias ON public.products;
CREATE TRIGGER trg_products_sync_org_alias
BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.sync_org_alias();

DROP TRIGGER IF EXISTS trg_products_touch_updated_at ON public.products;
CREATE TRIGGER trg_products_touch_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_products_org
  ON public.products (org_id);

CREATE INDEX IF NOT EXISTS idx_products_org_section_rank
  ON public.products (org_id, section_id, rank, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_products_sku_norm
  ON public.products (org_id, lower(trim(sku)))
  WHERE sku IS NOT NULL AND trim(sku) <> '' AND deleted_at IS NULL;

ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS org_id uuid NULL REFERENCES public.organizations(id);

UPDATE public.admin_users
SET org_id = COALESCE(org_id, organization_id)
WHERE org_id IS NULL AND organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_users_org_id ON public.admin_users (org_id);

DROP TRIGGER IF EXISTS trg_admin_users_sync_org_alias ON public.admin_users;
CREATE TRIGGER trg_admin_users_sync_org_alias
BEFORE INSERT OR UPDATE ON public.admin_users
FOR EACH ROW
EXECUTE FUNCTION public.sync_org_alias();

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS org_id uuid NULL REFERENCES public.organizations(id),
  ADD COLUMN IF NOT EXISTS checkout_session_id text NULL,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS customer_email text NULL,
  ADD COLUMN IF NOT EXISTS customer_phone text NULL,
  ADD COLUMN IF NOT EXISTS shipping_country text NULL,
  ADD COLUMN IF NOT EXISTS shipping_postal_code text NULL,
  ADD COLUMN IF NOT EXISTS subtotal_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_subtotal_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_shipping_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_discount_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_total_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS items_json jsonb NULL,
  ADD COLUMN IF NOT EXISTS customer_details jsonb NULL,
  ADD COLUMN IF NOT EXISTS shipping_details jsonb NULL,
  ADD COLUMN IF NOT EXISTS tracking_number text NULL,
  ADD COLUMN IF NOT EXISTS carrier text NULL,
  ADD COLUMN IF NOT EXISTS shipment_status text NULL,
  ADD COLUMN IF NOT EXISTS shipping_status text NULL,
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS envia_cost_mxn numeric(12,2) NULL;

UPDATE public.orders
SET
  org_id = COALESCE(org_id, organization_id),
  checkout_session_id = COALESCE(checkout_session_id, stripe_session_id),
  customer_email = COALESCE(customer_email, email),
  customer_phone = COALESCE(customer_phone, phone),
  shipping_country = COALESCE(shipping_country, 'MX'),
  shipping_postal_code = COALESCE(shipping_postal_code, postal_code),
  subtotal_cents = COALESCE(subtotal_cents, amount_subtotal_cents, 0),
  amount_subtotal_cents = COALESCE(amount_subtotal_cents, subtotal_cents, 0),
  shipping_cents = COALESCE(shipping_cents, amount_shipping_cents, 0),
  amount_shipping_cents = COALESCE(amount_shipping_cents, shipping_cents, 0),
  discount_cents = COALESCE(discount_cents, amount_discount_cents, 0),
  amount_discount_cents = COALESCE(amount_discount_cents, discount_cents, 0),
  total_cents = COALESCE(total_cents, amount_total_cents, 0),
  amount_total_cents = COALESCE(amount_total_cents, total_cents, 0),
  items_json = COALESCE(items_json, '[]'::jsonb),
  customer_details = COALESCE(customer_details, '{}'::jsonb),
  shipping_details = COALESCE(shipping_details, '{}'::jsonb),
  updated_at = COALESCE(updated_at, now());

CREATE INDEX IF NOT EXISTS idx_orders_org_id ON public.orders (org_id);
CREATE INDEX IF NOT EXISTS idx_orders_checkout_session_id ON public.orders (checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders (payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_tracking_number ON public.orders (tracking_number);
CREATE INDEX IF NOT EXISTS idx_orders_shipping_status ON public.orders (shipping_status);
CREATE INDEX IF NOT EXISTS idx_orders_shipment_status ON public.orders (shipment_status);

DROP TRIGGER IF EXISTS trg_orders_sync_org_alias ON public.orders;
CREATE TRIGGER trg_orders_sync_org_alias
BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_org_alias();

DROP TRIGGER IF EXISTS trg_orders_touch_updated_at ON public.orders;
CREATE TRIGGER trg_orders_touch_updated_at
BEFORE UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.shipping_labels
  ADD COLUMN IF NOT EXISTS org_id uuid NULL,
  ADD COLUMN IF NOT EXISTS order_id uuid NULL,
  ADD COLUMN IF NOT EXISTS stripe_session_id text NULL,
  ADD COLUMN IF NOT EXISTS carrier text NULL,
  ADD COLUMN IF NOT EXISTS service text NULL,
  ADD COLUMN IF NOT EXISTS tracking_number text NULL,
  ADD COLUMN IF NOT EXISTS label_url text NULL,
  ADD COLUMN IF NOT EXISTS shipment_status text NULL,
  ADD COLUMN IF NOT EXISTS shipping_status text NULL,
  ADD COLUMN IF NOT EXISTS envia_cost_mxn numeric(12,2) NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.shipping_labels
SET org_id = COALESCE(org_id, organization_id)
WHERE org_id IS NULL AND organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shipping_labels_org ON public.shipping_labels (org_id);
CREATE INDEX IF NOT EXISTS idx_shipping_labels_session ON public.shipping_labels (stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_shipping_labels_tracking ON public.shipping_labels (tracking_number);
CREATE INDEX IF NOT EXISTS idx_shipping_labels_order_id ON public.shipping_labels (order_id);

DROP TRIGGER IF EXISTS trg_shipping_labels_sync_org_alias ON public.shipping_labels;
CREATE TRIGGER trg_shipping_labels_sync_org_alias
BEFORE INSERT OR UPDATE ON public.shipping_labels
FOR EACH ROW
EXECUTE FUNCTION public.sync_org_alias();

DROP TRIGGER IF EXISTS trg_shipping_labels_touch_updated_at ON public.shipping_labels;
CREATE TRIGGER trg_shipping_labels_touch_updated_at
BEFORE UPDATE ON public.shipping_labels
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.shipping_webhooks
  ADD COLUMN IF NOT EXISTS org_id uuid NULL,
  ADD COLUMN IF NOT EXISTS order_id uuid NULL,
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'envia',
  ADD COLUMN IF NOT EXISTS status text NULL,
  ADD COLUMN IF NOT EXISTS tracking_number text NULL,
  ADD COLUMN IF NOT EXISTS stripe_session_id text NULL,
  ADD COLUMN IF NOT EXISTS carrier text NULL,
  ADD COLUMN IF NOT EXISTS raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.shipping_webhooks
SET org_id = COALESCE(org_id, organization_id)
WHERE org_id IS NULL AND organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shipping_webhooks_org ON public.shipping_webhooks (org_id);
CREATE INDEX IF NOT EXISTS idx_shipping_webhooks_tracking ON public.shipping_webhooks (tracking_number);
CREATE INDEX IF NOT EXISTS idx_shipping_webhooks_session ON public.shipping_webhooks (stripe_session_id);

DROP TRIGGER IF EXISTS trg_shipping_webhooks_sync_org_alias ON public.shipping_webhooks;
CREATE TRIGGER trg_shipping_webhooks_sync_org_alias
BEFORE INSERT OR UPDATE ON public.shipping_webhooks
FOR EACH ROW
EXECUTE FUNCTION public.sync_org_alias();

DROP TRIGGER IF EXISTS trg_shipping_webhooks_touch_updated_at ON public.shipping_webhooks;
CREATE TRIGGER trg_shipping_webhooks_touch_updated_at
BEFORE UPDATE ON public.shipping_webhooks
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.site_settings (
  organization_id,
  org_id,
  hero_title,
  hero_image,
  promo_active,
  promo_text,
  pixel_id,
  maintenance_mode,
  season_key,
  theme,
  home,
  socials,
  contact_email,
  contact_phone,
  whatsapp_e164,
  whatsapp_display
)
SELECT
  id,
  id,
  'SCORE STORE 2026',
  NULL,
  true,
  '🔥 ENVÍOS NACIONALES E INTERNACIONALES 🔥',
  NULL,
  false,
  'default',
  '{"accent":"#e10600","accent2":"#111111","particles":true}'::jsonb,
  '{"footer_note":"","shipping_note":"","returns_note":"","support_hours":""}'::jsonb,
  jsonb_build_object(
    'facebook', COALESCE(current_setting('app.social_facebook', true), 'https://www.facebook.com/uniforme.unico/'),
    'instagram', COALESCE(current_setting('app.social_instagram', true), 'https://www.instagram.com/uniformes.unico'),
    'youtube', COALESCE(current_setting('app.social_youtube', true), 'https://youtu.be/F4lw1EcehIA?si=jFBT9skFLs566g8N'),
    'tiktok', COALESCE(current_setting('app.social_tiktok', true), '')
  ),
  'ventas.unicotextil@gmail.com',
  '6642368701',
  '5216642368701',
  '664 236 8701'
FROM (
  SELECT COALESCE(
    (SELECT id FROM public.organizations WHERE name ILIKE '%score%' ORDER BY created_at ASC NULLS LAST LIMIT 1),
    (SELECT id FROM public.organizations ORDER BY created_at ASC NULLS LAST LIMIT 1)
  ) AS id
) target_org
WHERE id IS NOT NULL
ON CONFLICT (organization_id) DO UPDATE
SET
  org_id = EXCLUDED.org_id,
  hero_title = EXCLUDED.hero_title,
  hero_image = EXCLUDED.hero_image,
  promo_active = EXCLUDED.promo_active,
  promo_text = EXCLUDED.promo_text,
  pixel_id = EXCLUDED.pixel_id,
  maintenance_mode = EXCLUDED.maintenance_mode,
  season_key = EXCLUDED.season_key,
  theme = EXCLUDED.theme,
  home = EXCLUDED.home,
  socials = EXCLUDED.socials,
  contact_email = EXCLUDED.contact_email,
  contact_phone = EXCLUDED.contact_phone,
  whatsapp_e164 = EXCLUDED.whatsapp_e164,
  whatsapp_display = EXCLUDED.whatsapp_display,
  updated_at = now();

INSERT INTO public.products (
  organization_id,
  org_id,
  name,
  description,
  sku,
  base_mxn,
  price_cents,
  price_mxn,
  stock,
  category,
  section_id,
  sub_section,
  rank,
  img,
  image_url,
  images,
  sizes,
  active,
  is_active,
  metadata
)
SELECT
  id,
  id,
  'Gorra SCORE — Demo',
  'Producto demo para validar catálogo, checkout y panel.',
  'SCORE-DEMO-CAP',
  550.00,
  55000,
  550.00,
  25,
  'SCORE',
  'EDICION_2026',
  'Edición 2026',
  1,
  '/icon-512.png',
  '/icon-512.png',
  '[]'::jsonb,
  '[]'::jsonb,
  true,
  true,
  '{}'::jsonb
FROM (
  SELECT COALESCE(
    (SELECT id FROM public.organizations WHERE name ILIKE '%score%' ORDER BY created_at ASC NULLS LAST LIMIT 1),
    (SELECT id FROM public.organizations ORDER BY created_at ASC NULLS LAST LIMIT 1)
  ) AS id
) target_org
WHERE id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.organization_id = (SELECT id FROM (
      SELECT COALESCE(
        (SELECT id FROM public.organizations WHERE name ILIKE '%score%' ORDER BY created_at ASC NULLS LAST LIMIT 1),
        (SELECT id FROM public.organizations ORDER BY created_at ASC NULLS LAST LIMIT 1)
      ) AS id
    ) t)
    AND p.deleted_at IS NULL
  );

COMMIT;