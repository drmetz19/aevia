import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@aevia/core";
import { AuthError } from "./otp";
import { verifyToken, type Principal } from "./tokens";

declare module "fastify" {
  interface FastifyRequest {
    principal?: Principal;
  }
}

export const SESSION_ENDED = "Sepertinya sesi Anda sudah berakhir. Silakan masuk kembali.";
export const FORBIDDEN = "Akun Anda tidak memiliki akses ke bagian ini.";

export function requireRole(secret: Uint8Array, now: () => Date, ...roles: Role[]) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const h = req.headers.authorization;
    const token = h?.startsWith("Bearer ") ? h.slice(7) : undefined;
    const p = token ? await verifyToken(secret, token, now()) : null;
    if (!p) throw new AuthError(401, "session_ended", SESSION_ENDED);
    if (!roles.includes(p.role)) throw new AuthError(403, "forbidden", FORBIDDEN);
    req.principal = p;
  };
}
