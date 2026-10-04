ALTER TABLE clinics ADD COLUMN IF NOT EXISTS custom_domain_verified boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS logo_key text;
--> statement-breakpoint
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS avatar_key text;
--> statement-breakpoint
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS pending_assistant_name text;
--> statement-breakpoint
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS pending_avatar_key text;
--> statement-breakpoint
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS assistant_review_note text;
--> statement-breakpoint
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS assistant_submitted_at timestamptz;
--> statement-breakpoint
-- Nama asisten yang belum disetujui tidak lagi menimpa nama yang tampil: pindahkan ke kolom pending.
UPDATE clinics SET pending_assistant_name = assistant_name, assistant_name = 'Sovia', assistant_submitted_at = now()
  WHERE assistant_name_status = 'pending' AND assistant_name <> 'Sovia' AND pending_assistant_name IS NULL;
--> statement-breakpoint
ALTER TABLE staff ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
--> statement-breakpoint
GRANT INSERT, UPDATE ON staff TO aevia_app;
