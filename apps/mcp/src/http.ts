import { createServer } from "node:http";
import { handleMcpRequest } from "./handler.js";

/** Server HTTP lokal untuk Streamable HTTP: POST /mcp dengan Authorization: Bearer <kunci API>. */
const port = Number(process.env.MCP_PORT ?? 4100);
createServer(async (nreq, nres) => {
  if (!nreq.url?.startsWith("/mcp")) {
    nres.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not_found" }));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of nreq) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(nreq.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const res = await handleMcpRequest(new Request(`http://${nreq.headers.host ?? "localhost"}${nreq.url}`, { method: nreq.method, headers, body: nreq.method === "GET" || nreq.method === "HEAD" ? undefined : body }));
  nres.writeHead(res.status, Object.fromEntries(res.headers));
  nres.end(Buffer.from(await res.arrayBuffer()));
}).listen(port, () => console.error(`aevia-mcp (Streamable HTTP) di http://localhost:${port}/mcp`));
