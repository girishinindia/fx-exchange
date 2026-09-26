/**
 * Session lifecycle against a real Redis (Upstash REST, or the local shim scripts/local-upstash.py).
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN — skipped when not set.
 * next/headers is replaced by an in-memory cookie jar.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, { value: string; opts?: Record<string, unknown> }>();
const reqHeaders = new Map<string, string>([["user-agent", "vitest"], ["x-forwarded-for", "10.0.0.9"]]);
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)!.value } : undefined),
    set: (k: string, value: string, opts?: Record<string, unknown>) => void jar.set(k, { value, opts }),
    delete: (k: string) => void jar.delete(k),
  }),
  headers: async () => ({ get: (k: string) => reqHeaders.get(k.toLowerCase()) ?? null }),
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));

const ON = !!process.env.UPSTASH_REDIS_REST_URL;
process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.SESSION_COOKIE_NAME ??= "fx_sid";

describe.skipIf(!ON)("sessions", async () => {
  const S = await import("@/lib/session");
  const { redis, keys, TTL } = await import("@/lib/redis");
  const cid = 900000 + Math.floor(Math.random() * 99999);
  const base = { userId: 1, companyId: cid, companyCode: "T", companyName: "T", userName: "Test User", email: "t@test.invalid", userType: "USER" as const, counterName: null, mustChangePassword: false, profileCompleted: true, companySetUp: true };
  const cookie = () => jar.get("fx_sid");

  beforeEach(() => jar.clear());

  it("creates an httpOnly, SameSite=lax cookie holding only a random id", async () => {
    const sid = await S.createSession(base);
    expect(sid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie()!.value).toBe(sid);
    expect(cookie()!.opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    const s = await S.getSession();
    expect(s).toMatchObject({ sid, userId: 1, companyId: cid, ip: "10.0.0.9" });
    expect(JSON.stringify(cookie())).not.toContain(String(cid)); // tenant never in the cookie
  });

  it("rejects forged, deleted and too-old sessions", async () => {
    jar.set("fx_sid", { value: "forged-session-id" });
    expect(await S.getSession()).toBeNull();

    const sid = await S.createSession(base);
    const k = keys.session(sid);
    const stored = (await redis().get<Record<string, unknown>>(k))!;
    await redis().set(k, { ...stored, createdAt: Date.now() - (TTL.sessionAbsolute + 60) * 1000 }, { ex: 60 });
    expect(await S.getSession()).toBeNull();
    expect(await redis().get(k)).toBeNull(); // removed on sight

    await expect(S.requireSession()).rejects.toThrow("REDIRECT /login");
  });

  it("forces the password change before anything else", async () => {
    await S.createSession({ ...base, mustChangePassword: true });
    await expect(S.requireSession()).rejects.toThrow("REDIRECT /change-password");
    expect((await S.requireSession({ stage: "password" })).mustChangePassword).toBe(true);
  });

  it("signs a user out everywhere except the current device", async () => {
    const u = { ...base, userId: 11 };
    const a = await S.createSession(u);
    const b = await S.createSession(u);
    const other = await S.createSession({ ...base, userId: 12 });
    const c = await S.createSession(u); // current cookie
    expect(await S.destroyAllSessions(cid, 11, c)).toBe(2);
    for (const sid of [a, b]) expect(await redis().get(keys.session(sid))).toBeNull();
    expect(await S.getSession()).toMatchObject({ sid: c });
    expect(await redis().get(keys.session(other))).not.toBeNull(); // another user untouched
  });

  it("never removes another user's session by id", async () => {
    const mine = await S.createSession(base);
    const theirs = await S.createSession({ ...base, userId: 2 });
    await S.destroyOneSession(cid, 1, theirs);
    expect(await redis().get(keys.session(theirs))).not.toBeNull();
    await S.destroyOneSession(cid, 1, mine);
    expect(await redis().get(keys.session(mine))).toBeNull();
  });

  it("sign-out deletes the session and the cookie", async () => {
    const sid = await S.createSession(base);
    await S.destroySession();
    expect(cookie()).toBeUndefined();
    expect(await redis().get(keys.session(sid))).toBeNull();
  });

  it("puts the company id in every tenant key", () => {
    expect(keys.userSessions(cid, 1)).toContain(`:${cid}:`);
    expect(keys.permissions(cid, 1)).toContain(`:${cid}:`);
    expect(keys.idempotency(cid, "k")).toContain(`:${cid}:`);
    expect(keys.rates(cid)).toContain(String(cid));
  });

  it("prefers the platform IP header over a client-supplied x-forwarded-for", async () => {
    reqHeaders.set("x-real-ip", "203.0.113.7");
    expect((await S.requestMeta()).ip).toBe("203.0.113.7");
    reqHeaders.delete("x-real-ip");
  });
});
