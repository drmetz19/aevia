-- Log pemakaian LLM per klinik (visibilitas biaya). Tidak menyimpan isi teks.
CREATE TABLE IF NOT EXISTS llm_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('prep_narrative', 'plan_explanation')),
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  fallback boolean NOT NULL DEFAULT false,
  fallback_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS llm_calls_clinic_time ON llm_calls (clinic_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE llm_calls ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE llm_calls FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON llm_calls;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON llm_calls
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT ON llm_calls TO aevia_app;
