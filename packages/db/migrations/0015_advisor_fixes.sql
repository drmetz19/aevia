-- Temuan Supabase advisor (2026-10-23). Idempoten.
-- 1) Keamanan: fungsi trigger tanpa search_path tetap (lint 0011). Fungsi hanya memakai OLD/NEW/TG_*, tanpa rujukan tabel.
ALTER FUNCTION aevia_guard_immutable() SET search_path = '';
--> statement-breakpoint
-- 2) Performa: current_setting() di kebijakan dievaluasi ulang per baris (lint 0003). Dibungkus subquery agar dihitung
--    sekali per query (initPlan). Makna kebijakan tidak berubah.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clinic_settings', 'patients', 'consents', 'staff', 'assessments', 'assessment_answers', 'events', 'programs',
    'consultation_requests', 'consultations', 'soap_notes', 'skin_analyses', 'skin_photos', 'audit_logs',
    'prescriptions', 'care_plans', 'checkins', 'reminders', 'webhook_endpoints', 'webhook_deliveries',
    'clinic_connectors', 'connector_deliveries', 'inbound_events', 'external_context', 'llm_calls'
  ] LOOP
    EXECUTE format(
      'ALTER POLICY tenant_isolation ON %I USING (clinic_id = (SELECT nullif(current_setting(''app.clinic_id'', true), '''')::uuid)) '
      'WITH CHECK (clinic_id = (SELECT nullif(current_setting(''app.clinic_id'', true), '''')::uuid))', t);
  END LOOP;
END $$;
