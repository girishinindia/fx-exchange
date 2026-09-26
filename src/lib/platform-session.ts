import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { consoleIsAvailable } from "@/lib/platform-db";
import { keys, redis, TTL } from "@/lib/redis";
import { requestMeta } from "@/lib/session";

/**
 * The Super Admin's session. Deliberately a separate type, a separate cookie and a separate set
 * of Redis keys from the company session, with no company id anywhere in it — so there is no
 * way for one to be mistaken for the other, and no code path where a Super Admin arrives at a
 * company screen carrying a tenant identity they should not have.
 */

export type PlatformSession = {
  sid: string;
  userId: number;
  userName: string;
  email: string;
  mustChangePassword: boolean;
  createdAt: number;
  ip: string | null;
  userAgent: string | null;
};

type Stored = Omit<PlatformSession, "sid">;
export type NewPlatformSession = Omit<Stored, "createdAt" | "ip" | "userAgent">;

const COOKIE = () => env().PLATFORM_COOKIE_NAME;

export async function createPlatformSession(data: NewPlatformSession): Promise<string> {
  const meta = await requestMeta();
  const sid = randomBytes(32).toString("base64url");
  const stored: Stored = { ...data, createdAt: Date.now(), ip: meta.ip, userAgent: meta.userAgent?.slice(0, 200) ?? null };
  const r = redis();
  await r.set(keys.platformSession(sid), stored, { ex: TTL.sessionSliding });
  await r.sadd(keys.platformUserSessions(data.userId), sid);
  await r.expire(keys.platformUserSessions(data.userId), TTL.sessionAbsolute);

  (await cookies()).set(COOKIE(), sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL.sessionAbsolute,
  });
  return sid;
}

export async function getPlatformSession(): Promise<PlatformSession | null> {
  const sid = (await cookies()).get(COOKIE())?.value;
  if (!sid) return null;
  const r = redis();
  const stored = await r.get<Stored>(keys.platformSession(sid));
  if (!stored) return null;
  if (Date.now() - stored.createdAt > TTL.sessionAbsolute * 1000) {
    await r.del(keys.platformSession(sid));
    return null;
  }
  await r.expire(keys.platformSession(sid), TTL.sessionSliding);
  return { sid, ...stored };
}

/** Top of every console page and action. Sends an unknown visitor to the console's own sign-in. */
export async function requirePlatformSession(opts: { allowPasswordChange?: boolean } = {}): Promise<PlatformSession> {
  if (!consoleIsAvailable()) redirect("/login");
  const s = await getPlatformSession();
  if (!s) redirect("/platform/login");
  if (s.mustChangePassword && !opts.allowPasswordChange) redirect("/platform/password");
  return s;
}

export async function destroyPlatformSession(): Promise<void> {
  const jar = await cookies();
  const sid = jar.get(COOKIE())?.value;
  if (sid) {
    const r = redis();
    const stored = await r.get<Stored>(keys.platformSession(sid));
    await r.del(keys.platformSession(sid));
    if (stored) await r.srem(keys.platformUserSessions(stored.userId), sid);
  }
  jar.delete(COOKIE());
}

/** Used after a password change, and when a Super Admin is blocked. */
export async function destroyAllPlatformSessions(userId: number, exceptSid?: string): Promise<number> {
  const r = redis();
  const setKey = keys.platformUserSessions(userId);
  const sids = (await r.smembers(setKey)).filter((s) => s !== exceptSid);
  if (sids.length) {
    await r.del(...sids.map((s) => keys.platformSession(s)));
    await r.srem(setKey, ...sids);
  }
  return sids.length;
}

/** Update the stored record in place — after the first-sign-in password change. */
export async function patchPlatformSession(sid: string, patch: Partial<Stored>): Promise<void> {
  const r = redis();
  const stored = await r.get<Stored>(keys.platformSession(sid));
  if (!stored) return;
  await r.set(keys.platformSession(sid), { ...stored, ...patch }, { ex: TTL.sessionSliding });
}
