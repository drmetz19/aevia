import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { AeviaClient } from "./client.js";
import { createMcpServer } from "./tools.js";

export interface HandlerOptions {
  apiUrl?: string;
  fetchFn?: typeof fetch;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const rpcError = (status: number, message: string, headers?: Record<string, string>) => json(status, { jsonrpc: "2.0", error: { code: -32001, message }, id: null }, headers);

/**
 * Streamable HTTP tanpa sesi (cocok untuk serverless): tiap permintaan membuat server MCP sendiri dengan kunci API
 * dari header Authorization yang diteruskan apa adanya ke API AEVIA. Tidak ada kunci yang disimpan di sini.
 */
export async function handleMcpRequest(req: Request, o: HandlerOptions = {}): Promise<Response> {
  const apiUrl = o.apiUrl ?? process.env.AEVIA_API_URL;
  if (!apiUrl) return rpcError(500, "AEVIA_API_URL belum diatur.");
  const h = req.headers.get("authorization");
  const key = h?.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!key) return rpcError(401, "Kunci API AEVIA diperlukan: Authorization: Bearer aev_live_…", { "www-authenticate": 'Bearer realm="aevia-mcp"' });
  if (req.method !== "POST") return json(405, { jsonrpc: "2.0", error: { code: -32000, message: "Gunakan POST (mode tanpa sesi)." }, id: null }, { allow: "POST" });

  const server = createMcpServer(new AeviaClient({ apiUrl, apiKey: key, fetchFn: o.fetchFn }));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // Respons JSON sudah lengkap; tutup agar tidak ada state tertinggal antar permintaan.
    queueMicrotask(() => void server.close().catch(() => {}));
  }
}
