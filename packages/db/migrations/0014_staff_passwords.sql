-- Login staf dengan password. Hash disimpan TERPISAH dari tabel staff agar tidak pernah ikut terbaca oleh query
-- tenant (aevia_app punya SELECT pada staff). Kedua tabel hanya untuk koneksi pemilik: RLS aktif tanpa kebijakan, tanpa grant.
CREATE TABLE IF NOT EXISTS staff_credentials (
  email text PRIMARY KEY,
  password_hash text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS password_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('set', 'reset')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS password_tokens_email_idx ON password_tokens (email, created_at);
--> statement-breakpoint
ALTER TABLE staff_credentials ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE password_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON staff_credentials, password_tokens FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON staff_credentials, password_tokens FROM authenticated';
  END IF;
END $$;
