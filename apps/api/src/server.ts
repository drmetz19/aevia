import { createDb, defaultPgliteDir, seed } from "@aevia/db";
import { buildApp } from "./app";

const url = process.env.DATABASE_URL || undefined;
const db = await createDb({ url, dataDir: url ? undefined : defaultPgliteDir() });
await db.migrate();
if (!url) await seed(db); // dev: PGlite selalu berisi klinik demo

const app = await buildApp({ db });
const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: "0.0.0.0" });
console.log(`AEVIA API siap di http://localhost:${port}`);
