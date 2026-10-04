CREATE TABLE IF NOT EXISTS prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  consultation_id uuid NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'superseded')),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  issued_by uuid REFERENCES staff(id),
  issued_at timestamptz,
  created_by uuid REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consultation_id, version)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS care_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  consultation_id uuid NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'signed', 'superseded')),
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  signed_by uuid REFERENCES staff(id),
  signed_at timestamptz,
  signature_hash text,
  created_by uuid REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consultation_id, version)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS care_plans_patient ON care_plans (patient_id, status, signed_at DESC);
--> statement-breakpoint
-- Keabadian di level DB: resep issued dan rencana signed tidak bisa diubah isinya; hanya boleh berganti status ke superseded.
CREATE OR REPLACE FUNCTION aevia_guard_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'prescriptions' AND OLD.status IN ('issued', 'superseded') THEN
    IF NEW.items IS DISTINCT FROM OLD.items OR NEW.consultation_id <> OLD.consultation_id OR NEW.version <> OLD.version
       OR NEW.issued_at IS DISTINCT FROM OLD.issued_at OR NEW.issued_by IS DISTINCT FROM OLD.issued_by
       OR (OLD.status = 'superseded' AND NEW.status <> 'superseded')
       OR (OLD.status = 'issued' AND NEW.status NOT IN ('issued', 'superseded')) THEN
      RAISE EXCEPTION 'Resep yang sudah diterbitkan tidak dapat diubah. Buat versi baru.';
    END IF;
  ELSIF TG_TABLE_NAME = 'care_plans' AND OLD.status IN ('signed', 'superseded') THEN
    IF NEW.content IS DISTINCT FROM OLD.content OR NEW.summary IS DISTINCT FROM OLD.summary OR NEW.version <> OLD.version
       OR NEW.signed_at IS DISTINCT FROM OLD.signed_at OR NEW.signed_by IS DISTINCT FROM OLD.signed_by
       OR NEW.signature_hash IS DISTINCT FROM OLD.signature_hash
       OR (OLD.status = 'superseded' AND NEW.status <> 'superseded')
       OR (OLD.status = 'signed' AND NEW.status NOT IN ('signed', 'superseded')) THEN
      RAISE EXCEPTION 'Rencana yang sudah ditandatangani tidak dapat diubah. Buat versi baru.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS prescriptions_immutable ON prescriptions;
--> statement-breakpoint
CREATE TRIGGER prescriptions_immutable BEFORE UPDATE ON prescriptions FOR EACH ROW EXECUTE FUNCTION aevia_guard_immutable();
--> statement-breakpoint
DROP TRIGGER IF EXISTS care_plans_immutable ON care_plans;
--> statement-breakpoint
CREATE TRIGGER care_plans_immutable BEFORE UPDATE ON care_plans FOR EACH ROW EXECUTE FUNCTION aevia_guard_immutable();
--> statement-breakpoint
ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE prescriptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE care_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE care_plans FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON prescriptions;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON prescriptions
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON care_plans;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON care_plans
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON prescriptions TO aevia_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON care_plans TO aevia_app;
