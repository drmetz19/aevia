CREATE TABLE IF NOT EXISTS soap_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  consultation_id uuid NOT NULL UNIQUE REFERENCES consultations(id) ON DELETE CASCADE,
  subjective text NOT NULL DEFAULT '',
  objective text NOT NULL DEFAULT '',
  assessment text NOT NULL DEFAULT '',
  plan text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS skin_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  consultation_id uuid NOT NULL UNIQUE REFERENCES consultations(id) ON DELETE CASCADE,
  scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS skin_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  consultation_id uuid NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  content_type text NOT NULL,
  angle text NOT NULL DEFAULT 'front' CHECK (angle IN ('front', 'left', 'right', 'other')),
  taken_at timestamptz NOT NULL DEFAULT now(),
  annotations jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  actor_type text NOT NULL CHECK (actor_type IN ('staff', 'patient', 'system', 'api', 'mcp')),
  actor_id uuid,
  entity text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  before jsonb,
  after jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS audit_logs_entity ON audit_logs (clinic_id, entity, entity_id, at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS skin_photos_consultation ON skin_photos (consultation_id);
--> statement-breakpoint
ALTER TABLE soap_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE soap_notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE skin_analyses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE skin_analyses FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE skin_photos ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE skin_photos FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON soap_notes;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON soap_notes
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON skin_analyses;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON skin_analyses
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON skin_photos;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON skin_photos
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON audit_logs;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON audit_logs
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON soap_notes TO aevia_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON skin_analyses TO aevia_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON skin_photos TO aevia_app;
--> statement-breakpoint
-- Audit log append-only: aevia_app tidak bisa mengubah atau menghapus.
GRANT SELECT, INSERT ON audit_logs TO aevia_app;
