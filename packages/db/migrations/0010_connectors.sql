ALTER TABLE consultations ADD COLUMN IF NOT EXISTS external_ref text;
--> statement-breakpoint
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS payment_status text CHECK (payment_status IN ('paid', 'unpaid'));
--> statement-breakpoint
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS external_updated_at timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS consultations_external_ref ON consultations (clinic_id, external_ref) WHERE external_ref IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS clinic_connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('kliniksistem', 'beautycode')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, kind)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS connector_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  connector_id uuid NOT NULL REFERENCES clinic_connectors(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_status_code integer,
  last_error text,
  external_ref text,
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  UNIQUE (event_id, connector_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS connector_deliveries_due ON connector_deliveries (next_attempt_at) WHERE status = 'pending';
--> statement-breakpoint
-- Idempotensi inbound: satu event id per sumber dicatat sekali; ulangan mengembalikan hasil yang sama.
CREATE TABLE IF NOT EXISTS inbound_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  source text NOT NULL,
  event_id text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, source, event_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS external_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('beautycode')),
  data jsonb NOT NULL,
  recorded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS external_context_patient ON external_context (patient_id, source, recorded_at DESC);
--> statement-breakpoint
ALTER TABLE clinic_connectors ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE clinic_connectors FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE connector_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE connector_deliveries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE inbound_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE inbound_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE external_context ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE external_context FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON clinic_connectors;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON clinic_connectors
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON connector_deliveries;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON connector_deliveries
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON inbound_events;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON inbound_events
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON external_context;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON external_context
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON clinic_connectors TO aevia_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON connector_deliveries TO aevia_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON inbound_events TO aevia_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON external_context TO aevia_app;
