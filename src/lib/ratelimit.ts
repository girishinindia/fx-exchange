import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { keys, redis } from "@/lib/redis";

/** Login brute-force protection: 10 attempts per 15 minutes per IP and per account. */
let ipLimiter: Ratelimit | null = null;
let accountLimiter: Ratelimit | null = null;

function limiters() {
  if (!ipLimiter || !accountLimiter) {
    ipLimiter = new Ratelimit({ redis: redis(), limiter: Ratelimit.slidingWindow(10, "15 m"), prefix: "fx:rl:ip", analytics: false });
    accountLimiter = new Ratelimit({ redis: redis(), limiter: Ratelimit.slidingWindow(10, "15 m"), prefix: "fx:rl:acct", analytics: false });
  }
  return { ipLimiter, accountLimiter };
}

export async function checkLoginRate(ip: string, login: string): Promise<{ ok: boolean; retryAfterSec: number }> {
  const { ipLimiter, accountLimiter } = limiters();
  const [a, b] = await Promise.all([ipLimiter.limit(keys.loginIp(ip)), accountLimiter.limit(keys.loginAccount(login))]);
  const ok = a.success && b.success;
  const reset = Math.max(a.success ? 0 : a.reset, b.success ? 0 : b.reset);
  return { ok, retryAfterSec: ok ? 0 : Math.max(1, Math.ceil((reset - Date.now()) / 1000)) };
}

/** The Super Admin console's sign-in. Same limiters, but there is no company code to key on. */
export async function checkPlatformLoginRate(ip: string, email: string): Promise<{ ok: boolean; retryAfterSec: number }> {
  const { ipLimiter, accountLimiter } = limiters();
  const [a, b] = await Promise.all([ipLimiter.limit(keys.loginIp(ip)), accountLimiter.limit(keys.platformLoginAccount(email))]);
  const ok = a.success && b.success;
  const reset = Math.max(a.success ? 0 : a.reset, b.success ? 0 : b.reset);
  return { ok, retryAfterSec: ok ? 0 : Math.max(1, Math.ceil((reset - Date.now()) / 1000)) };
}

/** Limits for heavy or sensitive endpoints, per company + user. */
const LIMITS = {
  export: { n: 30, w: "1 m" },   // report downloads
  search: { n: 60, w: "1 m" },   // global search
  backup: { n: 3, w: "10 m" },   // full company backup
  import: { n: 10, w: "10 m" },  // bulk imports
  api: { n: 120, w: "1 m" },     // mobile app / API calls
} as const;
export type LimitName = keyof typeof LIMITS;
const named = new Map<LimitName, Ratelimit>();

export async function checkRate(name: LimitName, companyId: number, userId: number): Promise<{ ok: boolean; retryAfterSec: number }> {
  let l = named.get(name);
  if (!l) {
    l = new Ratelimit({ redis: redis(), limiter: Ratelimit.slidingWindow(LIMITS[name].n, LIMITS[name].w), prefix: `fx:rl:${name}`, analytics: false });
    named.set(name, l);
  }
  const r = await l.limit(`${companyId}:${userId}`);
  return { ok: r.success, retryAfterSec: r.success ? 0 : Math.max(1, Math.ceil((r.reset - Date.now()) / 1000)) };
}
