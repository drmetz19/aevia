-- CRM: data kontak + fase lead (funnel penjualan) per klinik.
-- Fase otomatis maju dari kejadian perjalanan pasien (trigger di patients & events, satu transaksi dengan kejadiannya);
-- fase manual (contacted, lost, koreksi) diubah lewat API integrasi. Urutan fase = LEAD_STAGE_INFO di packages/core/src/crm.ts.
CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id uuid UNIQUE REFERENCES patients(id) ON DELETE SET NULL,
  name text,
  email text,
  phone text,
  source text NOT NULL DEFAULT 'other' CHECK (source IN ('website', 'whatsapp', 'phone', 'email', 'referral', 'social', 'ads', 'event', 'walk_in', 'aevia', 'other')),
  source_detail text,
  utm jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags text[] NOT NULL DEFAULT '{}',
  notes text,
  owner_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  value_idr bigint CHECK (value_idr IS NULL OR value_idr >= 0),
  external_source text,
  external_ref text,
  stage text NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'contacted', 'registered', 'assessed', 'consultation_requested', 'consultation_scheduled', 'consulted', 'won', 'lost')),
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  lost_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (stage <> 'lost' OR lost_reason IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS contacts_email ON contacts (clinic_id, email) WHERE email IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS contacts_phone ON contacts (clinic_id, phone) WHERE phone IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS contacts_external ON contacts (clinic_id, external_source, external_ref) WHERE external_ref IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contacts_sync ON contacts (clinic_id, updated_at, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contacts_stage ON contacts (clinic_id, stage);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contact_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  from_stage text,
  to_stage text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('auto', 'manual')),
  trigger text,
  reason text,
  actor_type text NOT NULL DEFAULT 'system' CHECK (actor_type IN ('staff', 'system', 'api', 'mcp')),
  actor_id uuid,
  at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contact_stage_history_contact ON contact_stage_history (contact_id, at);
--> statement-breakpoint
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE contact_stage_history ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE contact_stage_history FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON contacts;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON contacts
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON contact_stage_history;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON contact_stage_history
  USING (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid)
  WITH CHECK (clinic_id = nullif(current_setting('app.clinic_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON contacts TO aevia_app;
--> statement-breakpoint
-- riwayat fase append-only
GRANT SELECT, INSERT ON contact_stage_history TO aevia_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aevia_lead_stage_rank(s text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE s
    WHEN 'lost' THEN 0
    WHEN 'new' THEN 1
    WHEN 'contacted' THEN 2
    WHEN 'registered' THEN 3
    WHEN 'assessed' THEN 4
    WHEN 'consultation_requested' THEN 5
    WHEN 'consultation_scheduled' THEN 6
    WHEN 'consulted' THEN 7
    WHEN 'won' THEN 8
    ELSE -1
  END
$$;
--> statement-breakpoint
-- Fase tertinggi yang sudah dibuktikan data perjalanan pasien (untuk pasien lama / kontak yang baru ditautkan).
CREATE OR REPLACE FUNCTION aevia_patient_lead_stage(p uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM care_plans WHERE patient_id = p AND status IN ('signed', 'superseded')) THEN 'won'
    WHEN EXISTS (SELECT 1 FROM consultations WHERE patient_id = p AND status = 'completed') THEN 'consulted'
    WHEN EXISTS (SELECT 1 FROM consultations WHERE patient_id = p) THEN 'consultation_scheduled'
    WHEN EXISTS (SELECT 1 FROM consultation_requests WHERE patient_id = p) THEN 'consultation_requested'
    WHEN EXISTS (SELECT 1 FROM assessments WHERE patient_id = p AND status = 'completed') THEN 'assessed'
    ELSE 'registered'
  END
$$;
--> statement-breakpoint
-- Majukan fase secara otomatis. Tidak pernah memundurkan; lead `lost` dibuka kembali oleh aktivitas pasien.
-- Waktu dibulatkan ke milidetik agar cursor sinkron (ISO, ms) presisi.
CREATE OR REPLACE FUNCTION aevia_contact_auto_advance(p_contact uuid, p_target text, p_trigger text, p_at timestamptz) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  c contacts%ROWTYPE;
  t timestamptz := date_trunc('milliseconds', p_at);
  proven text;
BEGIN
  SELECT * INTO c FROM contacts WHERE id = p_contact FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF c.stage <> 'lost' AND aevia_lead_stage_rank(p_target) <= aevia_lead_stage_rank(c.stage) THEN RETURN; END IF;
  -- dibuka kembali dari lost: kembali ke fase tertinggi yang dibuktikan data pasien, bukan sekadar fase pemicu
  IF c.stage = 'lost' AND c.patient_id IS NOT NULL THEN
    proven := aevia_patient_lead_stage(c.patient_id);
    IF aevia_lead_stage_rank(proven) > aevia_lead_stage_rank(p_target) THEN p_target := proven; END IF;
  END IF;
  UPDATE contacts SET stage = p_target, stage_changed_at = t, lost_reason = NULL, updated_at = t WHERE id = p_contact;
  INSERT INTO contact_stage_history (clinic_id, contact_id, from_stage, to_stage, mode, trigger, at)
    VALUES (c.clinic_id, p_contact, c.stage, p_target, 'auto', p_trigger, t);
  INSERT INTO events (clinic_id, type, payload, created_at)
    VALUES (c.clinic_id, 'contact.stage_changed', jsonb_build_object('contact_id', p_contact, 'patient_id', c.patient_id, 'stage', p_target, 'previous_stage', c.stage, 'mode', 'auto'), t);
END
$$;
--> statement-breakpoint
-- Pastikan pasien punya kontak: tautkan kontak CRM ber-email sama (belum tertaut), atau buat kontak baru (sumber aevia).
CREATE OR REPLACE FUNCTION aevia_contact_for_patient(p_patient uuid, p_at timestamptz, p_trigger text, p_emit boolean) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  p patients%ROWTYPE;
  cid uuid;
  st text;
  t timestamptz := date_trunc('milliseconds', p_at);
BEGIN
  SELECT id INTO cid FROM contacts WHERE patient_id = p_patient;
  IF cid IS NOT NULL THEN RETURN cid; END IF;
  SELECT * INTO p FROM patients WHERE id = p_patient;
  IF NOT FOUND THEN RETURN NULL; END IF;
  st := aevia_patient_lead_stage(p_patient);
  SELECT id INTO cid FROM contacts WHERE email = lower(p.email) AND patient_id IS NULL FOR UPDATE;
  IF cid IS NOT NULL THEN
    UPDATE contacts SET patient_id = p_patient, name = coalesce(name, p.name), updated_at = t WHERE id = cid;
    PERFORM aevia_contact_auto_advance(cid, st, p_trigger, t);
    RETURN cid;
  END IF;
  INSERT INTO contacts (clinic_id, patient_id, name, email, source, stage, stage_changed_at, created_at, updated_at)
    VALUES (
      p.clinic_id, p_patient, p.name,
      CASE WHEN EXISTS (SELECT 1 FROM contacts WHERE email = lower(p.email)) THEN NULL ELSE lower(p.email) END,
      'aevia', st, t, t, t)
    RETURNING id INTO cid;
  INSERT INTO contact_stage_history (clinic_id, contact_id, from_stage, to_stage, mode, trigger, at)
    VALUES (p.clinic_id, cid, NULL, st, 'auto', p_trigger, t);
  IF p_emit THEN
    INSERT INTO events (clinic_id, type, payload, created_at)
      VALUES (p.clinic_id, 'contact.created', jsonb_build_object('contact_id', cid, 'patient_id', p_patient, 'stage', st), t);
  END IF;
  RETURN cid;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aevia_contact_on_patient() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM aevia_contact_for_patient(NEW.id, NEW.created_at, 'patient.registered', true);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION aevia_contact_on_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target text;
  cid uuid;
BEGIN
  target := CASE NEW.type
    WHEN 'assessment.completed' THEN 'assessed'
    WHEN 'consultation.requested' THEN 'consultation_requested'
    WHEN 'consultation.accepted' THEN 'consultation_scheduled'
    WHEN 'plan.approved' THEN 'won'
    WHEN 'consultation.status_changed' THEN CASE WHEN NEW.payload->>'status' = 'completed' THEN 'consulted' END
  END;
  IF target IS NULL OR NOT (NEW.payload ? 'patient_id') THEN RETURN NULL; END IF;
  cid := aevia_contact_for_patient((NEW.payload->>'patient_id')::uuid, NEW.created_at, NEW.type, true);
  IF cid IS NOT NULL THEN
    PERFORM aevia_contact_auto_advance(cid, target, NEW.type, NEW.created_at);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS patients_contact ON patients;
--> statement-breakpoint
CREATE TRIGGER patients_contact AFTER INSERT ON patients FOR EACH ROW EXECUTE FUNCTION aevia_contact_on_patient();
--> statement-breakpoint
DROP TRIGGER IF EXISTS events_contact_stage ON events;
--> statement-breakpoint
CREATE TRIGGER events_contact_stage AFTER INSERT ON events FOR EACH ROW EXECUTE FUNCTION aevia_contact_on_event();
--> statement-breakpoint
-- Backfill pasien yang sudah ada (tanpa event agar webhook lama tidak dibanjiri). Konteks klinik dipasang per klinik
-- agar lolos FORCE RLS di Postgres sungguhan.
DO $$
DECLARE
  c record;
  p record;
BEGIN
  FOR c IN SELECT id FROM clinics LOOP
    PERFORM set_config('app.clinic_id', c.id::text, true);
    FOR p IN SELECT id, created_at FROM patients WHERE clinic_id = c.id ORDER BY created_at LOOP
      PERFORM aevia_contact_for_patient(p.id, p.created_at, 'backfill', false);
    END LOOP;
  END LOOP;
  PERFORM set_config('app.clinic_id', '', true);
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON contacts, contact_stage_history FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION aevia_lead_stage_rank(text), aevia_patient_lead_stage(uuid), aevia_contact_auto_advance(uuid, text, text, timestamptz), aevia_contact_for_patient(uuid, timestamptz, text, boolean) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON contacts, contact_stage_history FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION aevia_lead_stage_rank(text), aevia_patient_lead_stage(uuid), aevia_contact_auto_advance(uuid, text, text, timestamptz), aevia_contact_for_patient(uuid, timestamptz, text, boolean) FROM authenticated';
  END IF;
END $$;
