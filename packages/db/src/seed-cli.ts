import { createDb, defaultPgliteDir } from "./client";
import { seed } from "./seed";

const url = process.env.DATABASE_URL || undefined;
const d = await createDb({ url, dataDir: url ? undefined : defaultPgliteDir() });
await d.migrate();
await seed(d);
console.log(`Seed selesai (${d.driver}).`);
await d.close();
