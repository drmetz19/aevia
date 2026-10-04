#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AeviaClient } from "./client.js";
import { createMcpServer } from "./tools.js";

const apiKey = process.env.AEVIA_API_KEY;
const apiUrl = process.env.AEVIA_API_URL ?? "http://localhost:4000";
if (!apiKey) {
  console.error("AEVIA_API_KEY belum diatur. Buat kunci di konsol: Pengaturan → Integrasi.");
  process.exit(1);
}
// stdout dipakai protokol; log hanya ke stderr.
await createMcpServer(new AeviaClient({ apiUrl, apiKey })).connect(new StdioServerTransport());
console.error(`aevia-mcp (stdio) siap → ${apiUrl}`);
