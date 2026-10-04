CREATE TABLE IF NOT EXISTS assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  flagged boolean NOT NULL DEFAULT false,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS assessment_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  question_id text NOT NULL,
  value integer CHECK (value BETWEEN 1 AND 4),
  text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, question_id)
);
--> statement-breakpoint
-- Outbox: diisi dalam transaksi yang sama dengan perubahan data; dispatcher (Phase 9) mengirim & mengisi delivered_at.
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS events_pending ON events (created_at) WHERE delivered_at IS NULL;
--> statement-breakpoint
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assessments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assessment_answers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assessment_answers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON assessments;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON assessments
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON assessment_answers;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON assessment_answers
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON events;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON events
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON assessments TO aevia_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON assessment_answers TO aevia_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON events TO aevia_app;
