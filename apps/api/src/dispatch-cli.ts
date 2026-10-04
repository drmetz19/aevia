import { createDb, defaultPgliteDir } from "@aevia/db";
import { reencryptWebhookSecrets, resolveEncryptionKey } from "./modules/integrations/crypto";
import { dispatchOnce } from "./modules/integrations/dispatcher";

/** pnpm --filter @aevia/api dispatch [--watch] — kirim webhook yang jatuh tempo (satu putaran, atau tiap 5 detik). */
const url = process.env.DATABASE_URL || undefined;
const db = await createDb({ url, dataDir: url ? undefined : defaultPgliteDir() });
await db.migrate();
const encryptionKey = resolveEncryptionKey();
await reencryptWebhookSecrets(db, encryptionKey);
const watch = process.argv.includes("--watch");
do {
  const r = await dispatchOnce({ db, now: () => new Date(), encryptionKey });
  console.log(`[dispatch] ${new Date().toISOString()} ${JSON.stringify(r)}`);
  if (watch) await new Promise((res) => setTimeout(res, 5000));
} while (watch);
await db.close();
