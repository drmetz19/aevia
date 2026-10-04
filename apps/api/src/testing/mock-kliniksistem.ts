import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";

/**
 * Mock KlinikSistem (sisi penerima) mengikuti kontrak docs/integrasi/kliniksistem.md.
 * Memverifikasi X-Aevia-Signature, menyimpan booking, dan membalas {booking_id}.
 * Dipakai test lewat `fetch` tiruan, atau sebagai server HTTP sungguhan (startMockKlinikSistemServer).
 */
export interface MockBooking {
  headers: Record<string, string>;
  body: Record<string, any>;
  raw: string;
  booking_id: string;
}
export interface MockKlinikSistem {
  handle: (req: Request) => Promise<Response>;
  fetch: typeof fetch;
  secret: { value: string };
  bookings: MockBooking[];
  pings: { headers: Record<string, string>; body: Record<string, any> }[];
  /** 0 = sambungan putus; angka lain = status HTTP yang dibalas. Fungsi dipanggil per permintaan. */
  failWith: (() => number | null) | null;
  rejected: number;
  seq: number;
}

export function verifySignature(secret: string, header: string | null | undefined, raw: string, toleranceSeconds = 300, nowMs = Date.now()): boolean {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header ?? "");
  if (!m) return false;
  if (Math.abs(nowMs / 1000 - Number(m[1])) > toleranceSeconds) return false;
  const exp = createHmac("sha256", secret).update(`${m[1]}.${raw}`).digest();
  return timingSafeEqual(exp, Buffer.from(m[2]!, "hex"));
}

export function createMockKlinikSistem(secret = "", opts: { nowMs?: () => number } = {}): MockKlinikSistem {
  const mock: MockKlinikSistem = {
    secret: { value: secret },
    bookings: [],
    pings: [],
    failWith: null,
    rejected: 0,
    seq: 1000,
    handle: async (req) => {
      const url = new URL(req.url);
      const raw = await req.text();
      const headers = Object.fromEntries(req.headers.entries());
      const forced = mock.failWith?.() ?? null;
      if (forced === 0) throw new Error("ECONNREFUSED");
      if (forced) return new Response("error", { status: forced });
      if (!verifySignature(mock.secret.value, headers["x-aevia-signature"], raw, 300, opts.nowMs?.())) {
        mock.rejected++;
        return Response.json({ error: "invalid_signature" }, { status: 401 });
      }
      const body = JSON.parse(raw) as Record<string, any>;
      if (url.pathname === "/aevia/ping") {
        mock.pings.push({ headers, body });
        return Response.json({ ok: true });
      }
      if (url.pathname === "/aevia/bookings" && req.method === "POST") {
        // idempoten per booking_id yang dikirim AEVIA (pembaruan), selain itu buat baru
        const existing = body.booking_id ? mock.bookings.find((b) => b.booking_id === body.booking_id) : undefined;
        const booking_id = existing?.booking_id ?? `KS-${++mock.seq}`;
        mock.bookings.push({ headers, body, raw, booking_id });
        return Response.json({ booking_id }, { status: 201 });
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    },
    fetch: (async (input: string | URL | Request, init?: RequestInit) => mock.handle(new Request(input, init))) as typeof fetch,
  };
  return mock;
}

export async function startMockKlinikSistemServer(secret: string, port = 4200): Promise<{ server: Server; mock: MockKlinikSistem; url: string }> {
  const mock = createMockKlinikSistem(secret);
  const server = createServer(async (nreq, nres) => {
    const chunks: Buffer[] = [];
    for await (const c of nreq) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(nreq.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    const res = await mock
      .handle(new Request(`http://${nreq.headers.host}${nreq.url}`, { method: nreq.method, headers, body: nreq.method === "GET" ? undefined : Buffer.concat(chunks) }))
      .catch(() => new Response("error", { status: 500 }));
    nres.writeHead(res.status, Object.fromEntries(res.headers));
    nres.end(Buffer.from(await res.arrayBuffer()));
  });
  await new Promise<void>((r) => server.listen(port, r));
  return { server, mock, url: `http://127.0.0.1:${port}` };
}
