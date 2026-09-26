import "server-only";
import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { keys, redis, TTL } from "@/lib/redis";
import type { TenantContext } from "@/lib/db";

/**
 * Sessions live in Redis; the browser only holds a random id in an httpOnly cookie.
 * The company id in the session is the ONLY source of tenant identity in the app.
 */

export type Session = {
  sid: string;
  userId: number;
  companyId: number;
  companyCode: string;
  companyName: string;
  userName: string;
  email: string;
  userType: "ADMIN" | "USER";
  counterName: string | null;
  mustChangePassword: boolean;
  /** Null until this person has confirmed their own name and number. */
  profileCompleted: boolean;
  /** Null until the company's first Administrator has set it up and chosen its dealing currency. */
  companySetUp: boolean;
  createdAt: number;
  ip: string | null;
  userAgent: string | null;
  preview?: boolean;
};

type Stored = Omit<Session, "sid">;
export type NewSession = Omit<Stored, "createdAt" | "ip" | "userAgent" | "preview">;

export async function requestMeta(): Promise<{ ip: string; userAgent: string | null }> {
  const h = await headers();
  // Vercel sets x-vercel-forwarded-for / x-real-ip itself (a client cannot spoof them there);
  // x-forwarded-for is only a fallback for other hosts and local development.
  const ip = h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return { ip, userAgent: h.get("user-agent") };
}

/** Store a session in Redis and return its id — shared by the portal (cookie) and the API (bearer token). */
export async function createSessionRecord(data: NewSession, ttlSeconds = TTL.sessionSliding): Promise<string> {
  const meta = await requestMeta();
  const sid = randomBytes(32).toString("base64url");
  const stored: Stored = { ...data, createdAt: Date.now(), ip: meta.ip, userAgent: meta.userAgent?.slice(0, 200) ?? null };
  const r = redis();
  await r.set(keys.session(sid), stored, { ex: ttlSeconds });
  await r.sadd(keys.userSessions(data.companyId, data.userId), sid);
  await r.expire(keys.userSessions(data.companyId, data.userId), TTL.sessionAbsolute);
  return sid;
}

/** Read a session by id (bearer token or cookie value); slides the expiry. */
export async function readSession(sid: string): Promise<Session | null> {
  const r = redis();
  const stored = await r.get<Stored>(keys.session(sid));
  if (!stored) return null;
  if (Date.now() - stored.createdAt > TTL.sessionAbsolute * 1000) {
    await r.del(keys.session(sid));
    return null;
  }
  await r.expire(keys.session(sid), TTL.sessionSliding);
  return { sid, ...stored };
}

export async function createSession(data: NewSession): Promise<string> {
  const jar = await cookies();
  const sid = await createSessionRecord(data);
  jar.set(env().SESSION_COOKIE_NAME, sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL.sessionAbsolute,
  });
  return sid;
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies(); // first: marks the route as dynamic (never prerendered)
  const e = env();
  const sid = jar.get(e.SESSION_COOKIE_NAME)?.value;

  if (!sid) {
    if (process.env.NODE_ENV !== "production" && e.FX_PREVIEW === "1") return previewSession();
    return null;
  }

  return readSession(sid);
}

/**
 * The three things that have to be true before anybody reaches a desk screen, in order:
 *   1. password — they have chosen their own; the one they were given is known to somebody else
 *   2. profile  — they have confirmed who they are, so their name on a voucher means something
 *   3. company  — the company has been set up and its dealing currency chosen
 */
export const FIRST_RUN = ["password", "profile", "company"] as const;
export type FirstRunStage = (typeof FIRST_RUN)[number];

/**
 * Top of every protected page, layout and server action.
 *
 * A page that IS one of the first-run steps names its own stage. That allows its own step and
 * every step after it, and never an earlier one — so the sequence cannot deadlock (two pages
 * each sending the visitor to the other) and cannot be skipped. Everything else names nothing
 * and gets all three gates.
 */
export async function requireSession(opts: { stage?: FirstRunStage } = {}): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  const from = opts.stage ? FIRST_RUN.indexOf(opts.stage) : FIRST_RUN.length;
  if (s.mustChangePassword && from > 0) redirect("/change-password");
  if (!s.profileCompleted && from > 1) redirect("/profile/setup");
  if (!s.companySetUp && from > 2) redirect("/setup");
  return s;
}

/** Update the stored session in place, after a step of the first-run sequence is finished. */
export async function patchSession(sid: string, patch: Partial<Stored>): Promise<void> {
  const r = redis();
  const stored = await r.get<Stored>(keys.session(sid));
  if (!stored) return;
  await r.set(keys.session(sid), { ...stored, ...patch }, { ex: TTL.sessionSliding });
}

export async function requireAdmin(): Promise<Session> {
  const s = await requireSession();
  if (s.userType !== "ADMIN") redirect("/dashboard");
  return s;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const e = env();
  const sid = jar.get(e.SESSION_COOKIE_NAME)?.value;
  if (sid) {
    const r = redis();
    const stored = await r.get<Stored>(keys.session(sid));
    await r.del(keys.session(sid));
    if (stored) await r.srem(keys.userSessions(stored.companyId, stored.userId), sid);
  }
  jar.delete(e.SESSION_COOKIE_NAME);
}

/** Sign a user out everywhere (disabled user, password reset, "sign out everywhere"). */
export async function destroyAllSessions(companyId: number, userId: number, exceptSid?: string): Promise<number> {
  const r = redis();
  const setKey = keys.userSessions(companyId, userId);
  const sids = (await r.smembers(setKey)).filter((s) => s !== exceptSid);
  if (sids.length) {
    await r.del(...sids.map((s) => keys.session(s)));
    await r.srem(setKey, ...sids);
  }
  return sids.length;
}

export async function destroyOneSession(companyId: number, userId: number, sid: string): Promise<void> {
  const r = redis();
  const isMine = await r.sismember(keys.userSessions(companyId, userId), sid);
  if (!isMine) return; // never touch another user's session
  await r.del(keys.session(sid));
  await r.srem(keys.userSessions(companyId, userId), sid);
}

export type SessionInfo = { sid: string; createdAt: number; ip: string | null; userAgent: string | null; current: boolean };

export async function listSessions(s: Session): Promise<SessionInfo[]> {
  const r = redis();
  const setKey = keys.userSessions(s.companyId, s.userId);
  const sids = await r.smembers(setKey);
  const out: SessionInfo[] = [];
  const stale: string[] = [];
  for (const sid of sids) {
    const st = await r.get<Stored>(keys.session(sid));
    if (!st) stale.push(sid);
    else out.push({ sid, createdAt: st.createdAt, ip: st.ip, userAgent: st.userAgent, current: sid === s.sid });
  }
  if (stale.length) await r.srem(setKey, ...stale);
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Build the DB tenant context from a session (the only source of company id). */
export async function tenantOf(s: Session): Promise<TenantContext> {
  if (s.preview) throw new Error("Preview session has no database access");
  const { ip } = await requestMeta();
  return { companyId: s.companyId, userId: s.userId, clientIp: ip, context: "web" };
}

function previewSession(): Session {
  return {
    sid: "preview",
    userId: 0,
    companyId: 0,
    companyCode: "PREVIEW",
    companyName: "Preview company",
    userName: "Preview Admin",
    email: "preview@localhost",
    userType: "ADMIN",
    counterName: "Head Office",
    mustChangePassword: false,
    profileCompleted: true,
    companySetUp: true,
    createdAt: Date.now(),
    ip: null,
    userAgent: null,
    preview: true,
  };
}
