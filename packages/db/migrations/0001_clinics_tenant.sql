-- Role aplikasi: non-superuser, tanpa login. API memakai SET LOCAL ROLE aevia_app per transaksi.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aevia_app') THEN
    CREATE ROLE aevia_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
GRANT aevia_app TO CURRENT_USER;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS clinics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  tagline text,
  brand_mode text NOT NULL DEFAULT 'cobrand' CHECK (brand_mode IN ('cobrand', 'whitelabel')),
  logo_url text,
  colors jsonb NOT NULL DEFAULT '{}'::jsonb,
  font text,
  assistant_name text NOT NULL DEFAULT 'Sovia',
  assistant_name_status text NOT NULL DEFAULT 'approved' CHECK (assistant_name_status IN ('pending', 'approved', 'rejected')),
  avatar_url text,
  custom_domain text UNIQUE,
  llm_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Tabel pembuktian isolasi tenant (dipakai juga untuk preferensi klinik ke depan).
CREATE TABLE IF NOT EXISTS clinic_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, key)
);
--> statement-breakpoint
ALTER TABLE clinic_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE clinic_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON clinic_settings;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON clinic_settings
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
-- clinics = direktori brand publik (tanpa RLS); aevia_app hanya boleh membaca.
GRANT USAGE ON SCHEMA public TO aevia_app;
--> statement-breakpoint
GRANT SELECT ON clinics TO aevia_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON clinic_settings TO aevia_app;
