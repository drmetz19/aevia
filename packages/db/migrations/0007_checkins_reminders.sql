-- progress_metrics sengaja tidak dibuat: progres dihitung (derived) dari checkins + rencana signed, tanpa tabel yang bisa basi.
CREATE TABLE IF NOT EXISTS checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  care_plan_id uuid REFERENCES care_plans(id),
  values jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  mood integer CHECK (mood BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS checkins_patient ON checkins (patient_id, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('checkin', 'review', 'plan')),
  message text NOT NULL,
  due_at timestamptz NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS reminders_due ON reminders (patient_id, due_at) WHERE read_at IS NULL;
--> statement-breakpoint
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE checkins FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE reminders FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON checkins;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON checkins
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON reminders;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON reminders
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT ON checkins TO aevia_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON reminders TO aevia_app;
