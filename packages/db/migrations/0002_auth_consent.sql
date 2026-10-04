CREATE TABLE IF NOT EXISTS patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text,
  global_subject_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, email)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('assessment', 'medical_record', 'photos', 'external_context')),
  granted_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (patient_id, scope)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('professional', 'clinic_admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Lintas klinik: tanpa clinic_id, tanpa RLS, tanpa grant ke aevia_app (hanya koneksi pemilik).
CREATE TABLE IF NOT EXISTS platform_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- OTP dicek sebelum identitas/tenant diketahui → hanya koneksi pemilik (tanpa grant ke aevia_app).
CREATE TABLE IF NOT EXISTS otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL CHECK (subject_type IN ('patient', 'staff')),
  clinic_id uuid REFERENCES clinics(id) ON DELETE CASCADE,
  email text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS otp_codes_lookup ON otp_codes (subject_type, clinic_id, email, created_at DESC);
--> statement-breakpoint
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE patients FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE consents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE staff FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON patients;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON patients
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON consents;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON consents
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON staff;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON staff
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON patients TO aevia_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON consents TO aevia_app;
--> statement-breakpoint
GRANT SELECT ON staff TO aevia_app;
