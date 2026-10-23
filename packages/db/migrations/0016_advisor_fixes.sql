-- Temuan Supabase advisor (2026-10-23). Idempoten. Bernomor 0016 karena 0015 dipakai migrasi CRM (branch terpisah).
-- 1) Keamanan: fungsi trigger tanpa search_path tetap (lint 0011). Fungsi hanya memakai OLD/NEW/TG_*, tanpa rujukan tabel.
ALTER FUNCTION aevia_guard_immutable() SET search_path = '';
--> statement-breakpoint
-- 2) Performa: current_setting() di kebijakan dievaluasi ulang per baris (lint 0003). Dibungkus subquery agar dihitung
--    sekali per query (initPlan). Makna kebijakan tidak berubah. Berlaku untuk semua kebijakan tenant_isolation berbasis
--    app.clinic_id yang sudah ada saat migrasi ini jalan; kebijakan baru sebaiknya langsung memakai bentuk (SELECT …).
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_policies
    WHERE schemaname = 'public' AND policyname = 'tenant_isolation' AND qual LIKE '%app.clinic_id%'
  LOOP
    EXECUTE format(
      'ALTER POLICY tenant_isolation ON %I USING (clinic_id = (SELECT nullif(current_setting(''app.clinic_id'', true), '''')::uuid)) '
      'WITH CHECK (clinic_id = (SELECT nullif(current_setting(''app.clinic_id'', true), '''')::uuid))', t);
  END LOOP;
END $$;
