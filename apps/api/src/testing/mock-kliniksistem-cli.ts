import { startMockKlinikSistemServer } from "./mock-kliniksistem";

/** pnpm --filter @aevia/api mock:kliniksistem — KlinikSistem tiruan di http://127.0.0.1:4200 (MOCK_KS_SECRET = rahasia konektor). */
const secret = process.env.MOCK_KS_SECRET ?? "";
if (!secret) console.error("Peringatan: MOCK_KS_SECRET kosong; semua tanda tangan akan ditolak (401).");
const { url, mock } = await startMockKlinikSistemServer(secret, Number(process.env.MOCK_KS_PORT ?? 4200));
console.log(`Mock KlinikSistem siap di ${url}`);
setInterval(() => void mock, 1 << 30);
