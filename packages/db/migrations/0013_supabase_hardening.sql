-- Kesiapan Supabase: PostgREST memakai role anon/authenticated. API AEVIA tidak memakai PostgREST, jadi tutup akses
-- langsung ke semua tabel untuk role tersebut (hanya berjalan bila role itu ada; aman di Postgres biasa dan PGlite).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated';
  END IF;
END $$;
--> statement-breakpoint
-- Tabel rahasia tanpa kebijakan: tertutup untuk semua role selain pemilik (pemilik melewati RLS).
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE _migrations ENABLE ROW LEVEL SECURITY;
