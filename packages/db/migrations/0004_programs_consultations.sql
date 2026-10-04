CREATE TABLE IF NOT EXISTS programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  summary text NOT NULL DEFAULT '',
  duration_weeks integer,
  price_idr integer CHECK (price_idr IS NULL OR price_idr >= 0),
  includes jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, slug)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS consultation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES programs(id),
  assessment_id uuid REFERENCES assessments(id),
  prep jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'accepted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  request_id uuid NOT NULL UNIQUE REFERENCES consultation_requests(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES staff(id),
  scheduled_at timestamptz NOT NULL,
  meeting_url text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'no_show', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS consultation_requests_queue ON consultation_requests (clinic_id, status, created_at);
--> statement-breakpoint
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE programs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE consultation_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE consultation_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE consultations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE consultations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON programs;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON programs
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON consultation_requests;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON consultation_requests
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON consultations;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON consultations
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON programs TO aevia_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON consultation_requests TO aevia_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON consultations TO aevia_app;
