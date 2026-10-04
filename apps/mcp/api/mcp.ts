import { handleMcpRequest } from "../src/handler.js";

/** Vercel Function (Web Standard): dipetakan ke /mcp lewat vercel.json. Streamable HTTP, tanpa sesi. */
export const POST = (req: Request) => handleMcpRequest(req);
export const GET = (req: Request) => handleMcpRequest(req);
export const DELETE = (req: Request) => handleMcpRequest(req);
