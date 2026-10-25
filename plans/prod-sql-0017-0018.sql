-- Pasang migrasi 0017 (harga/akses program) + 0018 (voucher) di Supabase prod (SQL Editor → Run). Idempoten.
-- Jalankan SETELAH PR stitch-voucher di-merge & deploy, atau sebelum — kolom baru punya default sehingga kode lama tetap jalan.
BEGIN;
-- Redesain Aevia Konsult (stitch-voucher): tampilan harga & akses per program. Idempoten.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS price_mode text NOT NULL DEFAULT 'amount';
ALTER TABLE programs ADD COLUMN IF NOT EXISTS access text NOT NULL DEFAULT 'open';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'programs_price_mode_check' AND conrelid = 'programs'::regclass) THEN
    ALTER TABLE programs ADD CONSTRAINT programs_price_mode_check CHECK (price_mode IN ('amount', 'coming_soon'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'programs_access_check' AND conrelid = 'programs'::regclass) THEN
    ALTER TABLE programs ADD CONSTRAINT programs_access_check CHECK (access IN ('open', 'voucher'));
  END IF;
END $$;
;
-- Voucher akses program (stitch-voucher). Idempoten. Kebijakan RLS memakai bentuk (SELECT …) seperti 0016.
-- program_id NULL = berlaku untuk semua program klinik. Penukaran (voucher_redemptions) dibuat satu transaksi dengan permintaan konsultasi.
CREATE TABLE IF NOT EXISTS vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9-]{4,32}$'),
  program_id uuid REFERENCES programs(id),
  max_uses integer CHECK (max_uses IS NULL OR max_uses > 0),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, code)
);
CREATE TABLE IF NOT EXISTS voucher_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  voucher_id uuid NOT NULL REFERENCES vouchers(id),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES consultation_requests(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (voucher_id, patient_id)
);
CREATE INDEX IF NOT EXISTS vouchers_program ON vouchers (program_id);
CREATE INDEX IF NOT EXISTS voucher_redemptions_clinic ON voucher_redemptions (clinic_id, voucher_id);
CREATE INDEX IF NOT EXISTS voucher_redemptions_patient ON voucher_redemptions (patient_id);
CREATE INDEX IF NOT EXISTS voucher_redemptions_request ON voucher_redemptions (request_id);
ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vouchers FORCE ROW LEVEL SECURITY;
ALTER TABLE voucher_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE voucher_redemptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON vouchers;
CREATE POLICY tenant_isolation ON vouchers
  USING (clinic_id = (SELECT nullif(current_setting('app.clinic_id', true), '')::uuid))
  WITH CHECK (clinic_id = (SELECT nullif(current_setting('app.clinic_id', true), '')::uuid));
DROP POLICY IF EXISTS tenant_isolation ON voucher_redemptions;
CREATE POLICY tenant_isolation ON voucher_redemptions
  USING (clinic_id = (SELECT nullif(current_setting('app.clinic_id', true), '')::uuid))
  WITH CHECK (clinic_id = (SELECT nullif(current_setting('app.clinic_id', true), '')::uuid));
GRANT SELECT, INSERT, UPDATE ON vouchers TO aevia_app;
-- penukaran append-only
GRANT SELECT, INSERT ON voucher_redemptions TO aevia_app;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON vouchers, voucher_redemptions FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON vouchers, voucher_redemptions FROM authenticated';
  END IF;
END $$;
;
INSERT INTO _migrations (name) VALUES ('0017_program_pricing.sql'), ('0018_vouchers.sql') ON CONFLICT (name) DO NOTHING;
COMMIT;

-- Cek: harus 18 baris dan 2 tabel baru
SELECT count(*) FROM _migrations;
SELECT tablename, rowsecurity FROM pg_tables WHERE tablename IN ('vouchers','voucher_redemptions');
