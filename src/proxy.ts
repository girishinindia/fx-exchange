import { NextResponse, type NextRequest } from "next/server";
import { PROTECTED_PREFIXES } from "@/lib/nav";

/**
 * Runs before every page request:
 *  1. Optimistic gate: no session cookie → /login. The real check (session in Redis, user active)
 *     happens in the (portal) layout and in every server action via requireSession().
 *  2. Content-Security-Policy with a fresh nonce per request. Next.js puts the nonce on its own
 *     scripts, so no other script — injected or third-party — can run.
 * No DB or Redis calls here.
 */
const COOKIE = process.env.SESSION_COOKIE_NAME ?? "fx_sid";
const PLATFORM_COOKIE = process.env.PLATFORM_COOKIE_NAME ?? "fx_psid";

export function contentSecurityPolicy(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'", // style="" attributes (chart bars); no script can run from CSS
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const preview = process.env.NODE_ENV !== "production" && process.env.FX_PREVIEW === "1";

  // The Super Admin console has its own cookie and its own front door. A company session is not
  // a console session and vice versa — the two never stand in for each other.
  const isConsole = pathname === "/platform" || pathname.startsWith("/platform/");
  if (isConsole) {
    const isConsoleDoor = pathname === "/platform/login";
    if (!isConsoleDoor && !req.cookies.get(PLATFORM_COOKIE)?.value) {
      return NextResponse.redirect(new URL("/platform/login", req.url));
    }
  } else {
    const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
    if (isProtected && !preview && !req.cookies.get(COOKIE)?.value) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development");
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
