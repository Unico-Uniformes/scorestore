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

INSERT INTO storage.buckets (id, name, public)
VALUES ('products', 'products', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF to_regclass('public.site_settings') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY';

    EXECUTE 'ALTER TABLE public.site_settings
      ADD COLUMN IF NOT EXISTS org_id uuid,
      ADD COLUMN IF NOT EXISTS hero_title text DEFAULT ''SCORE STORE'',
      ADD COLUMN IF NOT EXISTS hero_image text,
      ADD COLUMN IF NOT EXISTS promo_active boolean DEFAULT false,
      ADD COLUMN IF NOT EXISTS promo_text text,
      ADD COLUMN IF NOT EXISTS pixel_id text,
      ADD COLUMN IF NOT EXISTS maintenance_mode boolean DEFAULT false,
      ADD COLUMN IF NOT EXISTS season_key text DEFAULT ''default'',
      ADD COLUMN IF NOT EXISTS theme jsonb NOT NULL DEFAULT ''{}''::jsonb,
      ADD COLUMN IF NOT EXISTS home jsonb NOT NULL DEFAULT ''{}''::jsonb,
      ADD COLUMN IF NOT EXISTS socials jsonb NOT NULL DEFAULT ''{}''::jsonb,
      ADD COLUMN IF NOT EXISTS contact_email text,
      ADD COLUMN IF NOT EXISTS contact_phone text,
      ADD COLUMN IF NOT EXISTS whatsapp_e164 text,
      ADD COLUMN IF NOT EXISTS whatsapp_display text,
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()';

    EXECUTE 'UPDATE public.site_settings
      SET org_id = organization_id
      WHERE org_id IS NULL AND organization_id IS NOT NULL';

    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS site_settings_org_id_uidx
      ON public.site_settings (org_id)';

    EXECUTE 'DROP TRIGGER IF EXISTS trg_site_settings_sync_org_alias ON public.site_settings';
    EXECUTE 'CREATE TRIGGER trg_site_settings_sync_org_alias
      BEFORE INSERT OR UPDATE ON public.site_settings
      FOR EACH ROW EXECUTE FUNCTION public.sync_org_alias()';

    EXECUTE 'DROP TRIGGER IF EXISTS trg_site_settings_touch_updated_at ON public.site_settings';
    EXECUTE 'CREATE TRIGGER trg_site_settings_touch_updated_at
      BEFORE UPDATE ON public.site_settings
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()';

    EXECUTE 'DROP POLICY IF EXISTS "Lectura global" ON public.site_settings';
    EXECUTE 'CREATE POLICY "Lectura global"
      ON public.site_settings
      FOR SELECT
      TO anon, authenticated
      USING (true)';

    EXECUTE 'DROP POLICY IF EXISTS "Roles autorizados actualizan settings" ON public.site_settings';
    EXECUTE 'CREATE POLICY "Roles autorizados actualizan settings"
      ON public.site_settings
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.admin_users a
          WHERE a.organization_id = COALESCE(site_settings.org_id, site_settings.organization_id)
            AND a.role IN (''owner'',''admin'',''marketing'')
            AND a.is_active = true
            AND (
              (a.user_id IS NOT NULL AND a.user_id = auth.uid())
              OR
              (a.email IS NOT NULL AND lower(trim(a.email)) = lower(coalesce(auth.jwt()->>''email'', auth.jwt()->''user_metadata''->>''email'', '''')))
            )
        )
      )';

    EXECUTE 'DROP POLICY IF EXISTS "Roles autorizados update settings" ON public.site_settings';
    EXECUTE 'CREATE POLICY "Roles autorizados update settings"
      ON public.site_settings
      FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.admin_users a
          WHERE a.organization_id = COALESCE(site_settings.org_id, site_settings.organization_id)
            AND a.role IN (''owner'',''admin'',''marketing'')
            AND a.is_active = true
            AND (
              (a.user_id IS NOT NULL AND a.user_id = auth.uid())
              OR
              (a.email IS NOT NULL AND lower(trim(a.email)) = lower(coalesce(auth.jwt()->>''email'', auth.jwt()->''user_metadata''->>''email'', '''')))
            )
        )
      )';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.products') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.products ENABLE ROW LEVEL SECURITY';

    EXECUTE 'ALTER TABLE public.products
      ADD COLUMN IF NOT EXISTS org_id uuid,
      ADD COLUMN IF NOT EXISTS description text,
      ADD COLUMN IF NOT EXISTS base_mxn numeric(12,2) NOT NULL DEFAULT 0.00,
      ADD COLUMN IF NOT EXISTS price_cents integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS price_mxn numeric(12,2) NOT NULL DEFAULT 0.00,
      ADD COLUMN IF NOT EXISTS stock integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS category text DEFAULT ''SCORE'',
      ADD COLUMN IF NOT EXISTS section_id text,
      ADD COLUMN IF NOT EXISTS sub_section text,
      ADD COLUMN IF NOT EXISTS rank integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS img text,
      ADD COLUMN IF NOT EXISTS image_url text,
      ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT ''[]''::jsonb,
      ADD COLUMN IF NOT EXISTS sizes jsonb NOT NULL DEFAULT ''[]''::jsonb,
      ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT ''{}''::jsonb';

    EXECUTE 'UPDATE public.products
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
        images = COALESCE(images, ''[]''::jsonb),
        sizes = COALESCE(sizes, ''[]''::jsonb),
        metadata = COALESCE(metadata, ''{}''::jsonb),
        created_at = COALESCE(created_at, now()),
        updated_at = COALESCE(updated_at, now())
      WHERE true';

    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_products_org
      ON public.products (org_id)';

    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_products_org_section_rank
      ON public.products (org_id, section_id, rank, created_at DESC)';

    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_products_sku_norm
      ON public.products (org_id, lower(trim(sku)))
      WHERE sku IS NOT NULL AND trim(sku) <> '''' AND deleted_at IS NULL';

    EXECUTE 'DROP TRIGGER IF EXISTS trg_products_sync_org_alias ON public.products';
    EXECUTE 'CREATE TRIGGER trg_products_sync_org_alias
      BEFORE INSERT OR UPDATE ON public.products
      FOR EACH ROW EXECUTE FUNCTION public.sync_org_alias()';

    EXECUTE 'DROP TRIGGER IF EXISTS trg_products_touch_updated_at ON public.products';
    EXECUTE 'CREATE TRIGGER trg_products_touch_updated_at
      BEFORE UPDATE ON public.products
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()';

    EXECUTE 'DROP POLICY IF EXISTS "Lectura global productos" ON public.products';
    EXECUTE 'CREATE POLICY "Lectura global productos"
      ON public.products
      FOR SELECT
      TO anon, authenticated
      USING (deleted_at IS NULL)';

    EXECUTE 'DROP POLICY IF EXISTS "Staff inserta productos" ON public.products';
    EXECUTE 'CREATE POLICY "Staff inserta productos"
      ON public.products
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.admin_users a
          WHERE a.organization_id = COALESCE(products.org_id, products.organization_id)
            AND a.role IN (''owner'',''admin'',''ops'')
            AND a.is_active = true
            AND (
              (a.user_id IS NOT NULL AND a.user_id = auth.uid())
              OR
              (a.email IS NOT NULL AND lower(trim(a.email)) = lower(coalesce(auth.jwt()->>''email'', auth.jwt()->''user_metadata''->>''email'', '''')))
            )
        )
      )';

    EXECUTE 'DROP POLICY IF EXISTS "Staff actualiza productos" ON public.products';
    EXECUTE 'CREATE POLICY "Staff actualiza productos"
      ON public.products
      FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.admin_users a
          WHERE a.organization_id = COALESCE(products.org_id, products.organization_id)
            AND a.role IN (''owner'',''admin'',''ops'')
            AND a.is_active = true
            AND (
              (a.user_id IS NOT NULL AND a.user_id = auth.uid())
              OR
              (a.email IS NOT NULL AND lower(trim(a.email)) = lower(coalesce(auth.jwt()->>''email'', auth.jwt()->''user_metadata''->>''email'', '''')))
            )
        )
      )';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.orders') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY';

    EXECUTE 'ALTER TABLE public.orders
      ADD COLUMN IF NOT EXISTS org_id uuid,
      ADD COLUMN IF NOT EXISTS checkout_session_id text,
      ADD COLUMN IF NOT EXISTS stripe_session_id text,
      ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
      ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT ''unpaid'',
      ADD COLUMN IF NOT EXISTS customer_email text,
      ADD COLUMN IF NOT EXISTS customer_phone text,
      ADD COLUMN IF NOT EXISTS shipping_country text,
      ADD COLUMN IF NOT EXISTS shipping_postal_code text,
      ADD COLUMN IF NOT EXISTS shipping_mode text,
      ADD COLUMN IF NOT EXISTS subtotal_cents integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS discount_cents integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS shipping_cents integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total_cents integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS amount_subtotal_cents integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS amount_shipping_cents integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS amount_discount_cents integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS amount_total_cents integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS amount_total_mxn numeric(12,2),
      ADD COLUMN IF NOT EXISTS items_json jsonb,
      ADD COLUMN IF NOT EXISTS customer_details jsonb,
      ADD COLUMN IF NOT EXISTS shipping_details jsonb,
      ADD COLUMN IF NOT EXISTS tracking_number text,
      ADD COLUMN IF NOT EXISTS carrier text,
      ADD COLUMN IF NOT EXISTS shipment_status text,
      ADD COLUMN IF NOT EXISTS shipping_status text,
      ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
      ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz,
      ADD COLUMN IF NOT EXISTS paid_at timestamptz,
      ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
      ADD COLUMN IF NOT EXISTS envia_cost_mxn numeric(12,2),
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()';

    EXECUTE 'UPDATE public.orders
      SET
        org_id = COALESCE(org_id, organization_id),
        checkout_session_id = COALESCE(checkout_session_id, stripe_session_id),
        stripe_session_id = COALESCE(stripe_session_id, checkout_session_id),
        customer_email = COALESCE(customer_email, email),
        customer_phone = COALESCE(customer_phone, phone),
        shipping_country = COALESCE(shipping_country, ''MX''),
        shipping_postal_code = COALESCE(shipping_postal_code, postal_code),
        subtotal_cents = COALESCE(subtotal_cents, amount_subtotal_cents, 0),
        amount_subtotal_cents = COALESCE(amount_subtotal_cents, subtotal_cents, 0),
        shipping_cents = COALESCE(shipping_cents, amount_shipping_cents, 0),
        amount_shipping_cents = COALESCE(amount_shipping_cents, shipping_cents, 0),
        discount_cents = COALESCE(discount_cents, amount_discount_cents, 0),
        amount_discount_cents = COALESCE(amount_discount_cents, discount_cents, 0),
        total_cents = COALESCE(total_cents, amount_total_cents, 0),
        amount_total_cents = COALESCE(amount_total_cents, total_cents, 0),
        amount_total_mxn = COALESCE(amount_total_mxn, (COALESCE(amount_total_cents, total_cents, 0)::numeric / 100)),
        items_json = COALESCE(items_json, ''[]''::jsonb),
        customer_details = COALESCE(customer_details, ''{}''::jsonb),
        shipping_details = COALESCE(shipping_details, ''{}''::jsonb),
        updated_at = COALESCE(updated_at, now())
      WHERE true';

    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_orders_org_id ON public.orders (org_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_orders_checkout_session_id ON public.orders (checkout_session_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders (payment_status)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_orders_tracking_number ON public.orders (tracking_number)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_orders_shipping_status ON public.orders (shipping_status)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_orders_shipment_status ON public.orders (shipment_status)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_orders_stripe_payment_intent_id ON public.orders (stripe_payment_intent_id)';

    EXECUTE 'DROP TRIGGER IF EXISTS trg_orders_sync_org_alias ON public.orders';
    EXECUTE 'CREATE TRIGGER trg_orders_sync_org_alias
      BEFORE INSERT OR UPDATE ON public.orders
      FOR EACH ROW EXECUTE FUNCTION public.sync_org_alias()';

    EXECUTE 'DROP TRIGGER IF EXISTS trg_orders_touch_updated_at ON public.orders';
    EXECUTE 'CREATE TRIGGER trg_orders_touch_updated_at
      BEFORE UPDATE ON public.orders
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()';

    EXECUTE 'DROP POLICY IF EXISTS "UnicOs lee pedidos" ON public.orders';
    EXECUTE 'CREATE POLICY "UnicOs lee pedidos"
      ON public.orders
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.admin_users a
          WHERE a.organization_id = COALESCE(orders.org_id, orders.organization_id)
            AND a.is_active = true
            AND (
              (a.user_id IS NOT NULL AND a.user_id = auth.uid())
              OR
              (a.email IS NOT NULL AND lower(trim(a.email)) = lower(coalesce(auth.jwt()->>''email'', auth.jwt()->''user_metadata''->>''email'', '''')))
            )
        )
      )';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.audit_log') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY';

    EXECUTE 'ALTER TABLE public.audit_log
      ADD COLUMN IF NOT EXISTS org_id uuid,
      ADD COLUMN IF NOT EXISTS actor_email text,
      ADD COLUMN IF NOT EXISTS actor_user_id uuid,
      ADD COLUMN IF NOT EXISTS action text,
      ADD COLUMN IF NOT EXISTS entity text,
      ADD COLUMN IF NOT EXISTS entity_id text,
      ADD COLUMN IF NOT EXISTS summary text,
      ADD COLUMN IF NOT EXISTS before jsonb,
      ADD COLUMN IF NOT EXISTS after jsonb,
      ADD COLUMN IF NOT EXISTS meta jsonb,
      ADD COLUMN IF NOT EXISTS ip text,
      ADD COLUMN IF NOT EXISTS user_agent text';

    EXECUTE 'UPDATE public.audit_log
      SET org_id = organization_id
      WHERE org_id IS NULL AND organization_id IS NOT NULL';

    EXECUTE 'CREATE INDEX IF NOT EXISTS audit_log_org_created_at_idx
      ON public.audit_log (org_id, created_at DESC)';

    EXECUTE 'CREATE INDEX IF NOT EXISTS audit_log_org_created_at_idx_legacy
      ON public.audit_log (organization_id, created_at DESC)';

    EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_log_sync_org_alias ON public.audit_log';
    EXECUTE 'CREATE TRIGGER trg_audit_log_sync_org_alias
      BEFORE INSERT OR UPDATE ON public.audit_log
      FOR EACH ROW EXECUTE FUNCTION public.sync_org_alias()';

    EXECUTE 'DROP POLICY IF EXISTS "UnicOs lee audit_log" ON public.audit_log';
    EXECUTE 'CREATE POLICY "UnicOs lee audit_log"
      ON public.audit_log
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.admin_users a
          WHERE a.organization_id = COALESCE(audit_log.org_id, audit_log.organization_id)
            AND a.is_active = true
            AND a.role IN (''owner'',''admin'')
            AND (
              (a.user_id IS NOT NULL AND a.user_id = auth.uid())
              OR
              (a.email IS NOT NULL AND lower(trim(a.email)) = lower(coalesce(auth.jwt()->>''email'', auth.jwt()->''user_metadata''->>''email'', '''')))
            )
        )
      )';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.shipping_labels') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.shipping_labels ENABLE ROW LEVEL SECURITY';

    EXECUTE 'ALTER TABLE public.shipping_labels
      ADD COLUMN IF NOT EXISTS org_id uuid,
      ADD COLUMN IF NOT EXISTS order_id uuid,
      ADD COLUMN IF NOT EXISTS stripe_session_id text,
      ADD COLUMN IF NOT EXISTS carrier text,
      ADD COLUMN IF NOT EXISTS service text,
      ADD COLUMN IF NOT EXISTS tracking_number text,
      ADD COLUMN IF NOT EXISTS label_url text,
      ADD COLUMN IF NOT EXISTS shipment_status text,
      ADD COLUMN IF NOT EXISTS shipping_status text,
      ADD COLUMN IF NOT EXISTS envia_cost_mxn numeric(12,2),
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT ''pending'',
      ADD COLUMN IF NOT EXISTS raw jsonb NOT NULL DEFAULT ''{}''::jsonb,
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()';

    EXECUTE 'UPDATE public.shipping_labels
      SET org_id = COALESCE(org_id, organization_id)
      WHERE org_id IS NULL AND organization_id IS NOT NULL';

    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shipping_labels_org ON public.shipping_labels (org_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shipping_labels_session ON public.shipping_labels (stripe_session_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shipping_labels_tracking ON public.shipping_labels (tracking_number)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shipping_labels_order_id ON public.shipping_labels (order_id)';

    EXECUTE 'DROP TRIGGER IF EXISTS trg_shipping_labels_sync_org_alias ON public.shipping_labels';
    EXECUTE 'CREATE TRIGGER trg_shipping_labels_sync_org_alias
      BEFORE INSERT OR UPDATE ON public.shipping_labels
      FOR EACH ROW EXECUTE FUNCTION public.sync_org_alias()';

    EXECUTE 'DROP TRIGGER IF EXISTS trg_shipping_labels_touch_updated_at ON public.shipping_labels';
    EXECUTE 'CREATE TRIGGER trg_shipping_labels_touch_updated_at
      BEFORE UPDATE ON public.shipping_labels
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()';

    EXECUTE 'DROP POLICY IF EXISTS "UnicOs lee envios" ON public.shipping_labels';
    EXECUTE 'CREATE POLICY "UnicOs lee envios"
      ON public.shipping_labels
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.admin_users a
          WHERE a.organization_id = COALESCE(shipping_labels.org_id, shipping_labels.organization_id)
            AND a.is_active = true
            AND (
              (a.user_id IS NOT NULL AND a.user_id = auth.uid())
              OR
              (a.email IS NOT NULL AND lower(trim(a.email)) = lower(coalesce(auth.jwt()->>''email'', auth.jwt()->''user_metadata''->>''email'', '''')))
            )
        )
      )';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.shipping_webhooks') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.shipping_webhooks ENABLE ROW LEVEL SECURITY';

    EXECUTE 'ALTER TABLE public.shipping_webhooks
      ADD COLUMN IF NOT EXISTS org_id uuid,
      ADD COLUMN IF NOT EXISTS order_id uuid,
      ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT ''envia'',
      ADD COLUMN IF NOT EXISTS status text,
      ADD COLUMN IF NOT EXISTS tracking_number text,
      ADD COLUMN IF NOT EXISTS stripe_session_id text,
      ADD COLUMN IF NOT EXISTS carrier text,
      ADD COLUMN IF NOT EXISTS raw jsonb NOT NULL DEFAULT ''{}''::jsonb,
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()';

    EXECUTE 'UPDATE public.shipping_webhooks
      SET org_id = COALESCE(org_id, organization_id)
      WHERE org_id IS NULL AND organization_id IS NOT NULL';

    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shipping_webhooks_org ON public.shipping_webhooks (org_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shipping_webhooks_tracking ON public.shipping_webhooks (tracking_number)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shipping_webhooks_session ON public.shipping_webhooks (stripe_session_id)';

    EXECUTE 'DROP TRIGGER IF EXISTS trg_shipping_webhooks_sync_org_alias ON public.shipping_webhooks';
    EXECUTE 'CREATE TRIGGER trg_shipping_webhooks_sync_org_alias
      BEFORE INSERT OR UPDATE ON public.shipping_webhooks
      FOR EACH ROW EXECUTE FUNCTION public.sync_org_alias()';

    EXECUTE 'DROP TRIGGER IF EXISTS trg_shipping_webhooks_touch_updated_at ON public.shipping_webhooks';
    EXECUTE 'CREATE TRIGGER trg_shipping_webhooks_touch_updated_at
      BEFORE UPDATE ON public.shipping_webhooks
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.admin_users') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.admin_users
      ADD COLUMN IF NOT EXISTS org_id uuid';

    EXECUTE 'UPDATE public.admin_users
      SET org_id = COALESCE(org_id, organization_id)
      WHERE org_id IS NULL AND organization_id IS NOT NULL';

    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_admin_users_org_id ON public.admin_users (org_id)';

    EXECUTE 'DROP TRIGGER IF EXISTS trg_admin_users_sync_org_alias ON public.admin_users';
    EXECUTE 'CREATE TRIGGER trg_admin_users_sync_org_alias
      BEFORE INSERT OR UPDATE ON public.admin_users
      FOR EACH ROW EXECUTE FUNCTION public.sync_org_alias()';

    EXECUTE 'DROP POLICY IF EXISTS "UnicOs lee admin_users" ON public.admin_users';
    EXECUTE 'CREATE POLICY "UnicOs lee admin_users"
      ON public.admin_users
      FOR SELECT
      TO authenticated
      USING (
        (user_id IS NOT NULL AND user_id = auth.uid())
        OR
        (email IS NOT NULL AND lower(trim(email)) = lower(coalesce(auth.jwt()->>''email'', auth.jwt()->''user_metadata''->>''email'', '''')))
        OR
        EXISTS (
          SELECT 1
          FROM public.admin_users me
          WHERE me.organization_id = admin_users.organization_id
            AND me.is_active = true
            AND me.role IN (''owner'',''admin'')
            AND (
              (me.user_id IS NOT NULL AND me.user_id = auth.uid())
              OR
              (me.email IS NOT NULL AND lower(trim(me.email)) = lower(coalesce(auth.jwt()->>''email'', auth.jwt()->''user_metadata''->>''email'', '''')))
            )
        )
      )';

    EXECUTE 'DROP POLICY IF EXISTS "Owner/Admin actualizan usuarios" ON public.admin_users';
    EXECUTE 'CREATE POLICY "Owner/Admin actualizan usuarios"
      ON public.admin_users
      FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.admin_users a
          WHERE a.organization_id = admin_users.organization_id
            AND a.role IN (''owner'',''admin'')
            AND a.is_active = true
            AND (
              (a.user_id IS NOT NULL AND a.user_id = auth.uid())
              OR
              (a.email IS NOT NULL AND lower(trim(a.email)) = lower(coalesce(auth.jwt()->>''email'', auth.jwt()->''user_metadata''->>''email'', '''')))
            )
        )
      )';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.organizations') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "UnicOs lee organizaciones" ON public.organizations';
    EXECUTE 'CREATE POLICY "UnicOs lee organizaciones"
      ON public.organizations
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.admin_users a
          WHERE a.organization_id = organizations.id
            AND a.is_active = true
            AND (
              (a.user_id IS NOT NULL AND a.user_id = auth.uid())
              OR
              (a.email IS NOT NULL AND lower(trim(a.email)) = lower(coalesce(auth.jwt()->>''email'', auth.jwt()->''user_metadata''->>''email'', '''')))
            )
        )
      )';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'products') THEN
    EXECUTE 'DROP POLICY IF EXISTS "UnicOs subida de fotos" ON storage.objects';
    EXECUTE 'CREATE POLICY "UnicOs subida de fotos"
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = ''products'')';

    EXECUTE 'DROP POLICY IF EXISTS "UnicOs lectura de fotos" ON storage.objects';
    EXECUTE 'CREATE POLICY "UnicOs lectura de fotos"
      ON storage.objects
      FOR SELECT
      TO anon, authenticated
      USING (bucket_id = ''products'')';
  END IF;
END $$;

COMMIT;