import "server-only";
import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";
import { loginKey } from "@/lib/login";

/**
 * The ONLY module allowed to create a Redis client (enforced by ESLint).
 * Redis holds sessions, rate limits, caches and idempotency keys — never money data.
 * Every tenant key contains the company id so a cache bug cannot cross companies.
 */

let redisClient: Redis | null = null;

export function redis(): Redis {
  if (!redisClient) {
    const e = env();
    redisClient = new Redis({ url: e.UPSTASH_REDIS_REST_URL, token: e.UPSTASH_REDIS_REST_TOKEN });
  }
  return redisClient;
}

const P = "fx"; // namespace, in case the Redis database is shared

export const keys = {
  session: (sid: string) => `${P}:sess:${sid}`,
  // the Super Admin's own keys — no company id, because they belong to no company
  platformSession: (sid: string) => `${P}:psess:${sid}`,
  platformUserSessions: (uid: number) => `${P}:pusess:${uid}`,
  platformLoginAccount: (login: string) => `${P}:rl:plogin:${loginKey(login)}`,
  userSessions: (cid: number, uid: number) => `${P}:usess:${cid}:${uid}`,
  permissions: (cid: number, uid: number) => `${P}:perm:${cid}:${uid}`,
  loginIp: (ip: string) => `${P}:rl:login:ip:${ip}`,
  // keyed on the normalised login, so trying the same account as an email and as a mobile
  // number does not get two separate allowances
  loginAccount: (login: string) => `${P}:rl:login:acct:${loginKey(login)}`,
  idempotency: (cid: number, key: string) => `${P}:idem:${cid}:${key}`,
  rates: (cid: number) => `${P}:rates:${cid}`,
  dashboard: (cid: number, scope: number | "all", date: string) => `${P}:dash:${cid}:${scope}:${date}`,
  approvalsCount: (cid: number) => `${P}:cnt:${cid}:approvals`,
} as const;

export const TTL = {
  sessionSliding: 8 * 60 * 60, // 8 h
  sessionAbsolute: 12 * 60 * 60, // 12 h
  permissions: 5 * 60,
  idempotency: 24 * 60 * 60,
  dashboard: 60,
} as const;

export async function redisPing(): Promise<{ ok: boolean; error?: string }> {
  try {
    const pong = await redis().ping();
    return { ok: pong === "PONG" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
