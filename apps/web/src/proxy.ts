import { NextResponse, type NextRequest } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:4000";
const PLATFORM_HOSTS = new Set((process.env.PLATFORM_HOSTS ?? "localhost,127.0.0.1").split(",").map((h) => h.trim().toLowerCase()));
const cache = new Map<string, { slug: string | null; until: number }>();

async function resolveHost(host: string): Promise<string | null> {
  const hit = cache.get(host);
  if (hit && hit.until > Date.now()) return hit.slug;
  let slug: string | null = null;
  try {
    const res = await fetch(`${API_URL}/v1/domains/resolve?host=${encodeURIComponent(host)}`, { cache: "no-store" });
    if (res.ok) slug = ((await res.json()) as { slug: string }).slug;
  } catch {
    return null;
  }
  cache.set(host, { slug, until: Date.now() + (slug ? 30_000 : 2_000) });
  return slug;
}

/** Domain khusus klinik → /c/:slug (hanya domain yang sudah diverifikasi admin AEVIA). */
export async function proxy(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").split(":")[0]!.toLowerCase();
  if (!host || PLATFORM_HOSTS.has(host)) return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/c/")) return NextResponse.next();
  const slug = await resolveHost(host);
  if (!slug) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = `/c/${slug}${pathname === "/" ? "" : pathname}`;
  url.search = search;
  return NextResponse.rewrite(url);
}

export const config = { matcher: ["/((?!_next/|favicon.ico|.*\\..*).*)"] };
