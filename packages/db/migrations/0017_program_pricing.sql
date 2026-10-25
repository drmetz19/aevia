-- Redesain Aevia Konsult (stitch-voucher): tampilan harga & akses per program. Idempoten.
ALTER TABLE programs ADD COLUMN IF NOT EXISTS price_mode text NOT NULL DEFAULT 'amount';
--> statement-breakpoint
ALTER TABLE programs ADD COLUMN IF NOT EXISTS access text NOT NULL DEFAULT 'open';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'programs_price_mode_check' AND conrelid = 'programs'::regclass) THEN
    ALTER TABLE programs ADD CONSTRAINT programs_price_mode_check CHECK (price_mode IN ('amount', 'coming_soon'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'programs_access_check' AND conrelid = 'programs'::regclass) THEN
    ALTER TABLE programs ADD CONSTRAINT programs_access_check CHECK (access IN ('open', 'voucher'));
  END IF;
END $$;
