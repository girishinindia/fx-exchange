import "server-only";
import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { PermissionError, hasPermission, type Permission } from "@/lib/permissions";
import { checkRate } from "@/lib/ratelimit";
import { keys, redis, TTL } from "@/lib/redis";
import { createSessionRecord, readSession, type NewSession, type Session } from "@/lib/session";
import { RuleError } from "@/lib/action";
import { isUnreachable } from "@/lib/db";

/**
 * /api/v1 — the same services the portal uses, reached with a bearer token so the
 * mobile app can call them. One envelope, one error shape, idempotent creates.
 *
 *   { "data": … }                                  success
 *   { "error": { "code": …, "message": … } }       failure
 */

export const API_VERSION = "v1";
const TOKEN_TTL = TTL.sessionSliding;      // 8 h access token
const REFRESH_TTL = 30 * 24 * 60 * 60;     // 30 days

export type ApiTokens = { accessToken: string; refreshToken: string; expiresIn: number };

const refreshKey = (t: string) => `fx:apirt:${t}`;

/** Issue an access token (a normal session, so "sign out everywhere" kills it) and a refresh token. */
export async function issueTokens(data: NewSession): Promise<ApiTokens> {
  const accessToken = await createSessionRecord(data, TOKEN_TTL);
  const refreshToken = randomBytes(32).toString("base64url");
  await redis().set(refreshKey(refreshToken), { companyId: data.companyId, userId: data.userId }, { ex: REFRESH_TTL });
  return { accessToken, refreshToken, expiresIn: TOKEN_TTL };
}

/** Exchange a refresh token for a new pair (the old refresh token is dropped). */
export async function rotateTokens(refreshToken: string, load: (companyId: number, userId: number) => Promise<NewSession | null>): Promise<ApiTokens | null> {
  const r = redis();
  const stored = await r.get<{ companyId: number; userId: number }>(refreshKey(refreshToken));
  if (!stored) return null;
  await r.del(refreshKey(refreshToken));
  const data = await load(stored.companyId, stored.userId);
  if (!data) return null;
  return issueTokens(data);
}

export async function revokeRefresh(refreshToken: string): Promise<void> {
  await redis().del(refreshKey(refreshToken));
}

/**
 * The services speak the database's snake_case; the app on the phone gets one convention
 * for everything, so every key is camelCased on the way out. Values are never touched.
 */
function camelize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(camelize);
  if (v === null || typeof v !== "object" || v instanceof Date) return v;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = camelize(val);
  }
  return out;
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json({ data: camelize(data) }, { status, headers: { "cache-control": "no-store", ...headers } });
}

export function apiError(code: string, message: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json({ error: { code, message, ...extra } }, { status, headers: { "cache-control": "no-store" } });
}

export class ApiProblem extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

/** Bearer token → session. Also enforces the api.access permission and the password-change gate. */
export async function apiSession(req: NextRequest): Promise<Session> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new ApiProblem("unauthorized", "Send an Authorization: Bearer <token> header.", 401);
  const s = await readSession(token);
  if (!s) throw new ApiProblem("unauthorized", "The token is invalid or has expired. Sign in again.", 401);
  if (s.mustChangePassword) throw new ApiProblem("password_change_required", "Set a new password in the portal before using the API.", 403);
  if (!(await hasPermission(s, "api.access"))) throw new ApiProblem("forbidden", "This user may not use the API (permission api.access).", 403);
  return s;
}

export async function requirePermissionApi(s: Session, p: Permission): Promise<void> {
  if (!(await hasPermission(s, p))) throw new ApiProblem("forbidden", `Permission denied: ${p}`, 403);
}

/** Wraps a handler: authentication, rate limit and one error shape for everything. */
export function withApi(handler: (req: NextRequest, s: Session, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) {
  return async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => {
    try {
      const s = await apiSession(req);
      const rl = await checkRate("api", s.companyId, s.userId);
      if (!rl.ok) return apiError("rate_limited", `Too many requests. Try again in ${rl.retryAfterSec} s.`, 429, { retryAfter: rl.retryAfterSec });
      return await handler(req, s, ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown): Response {
  if (e instanceof ApiProblem) return apiError(e.code, e.message, e.status);
  if (e instanceof PermissionError) return apiError("forbidden", e.message, 403);
  if (e instanceof RuleError) return apiError("rule", e.message, 422);
  if (typeof e === "object" && e && "code" in e) {
    const pg = e as { code: string; message?: string };
    if (pg.code === "23505") return apiError("duplicate", "This already exists.", 409);
    if (pg.code === "P0001" || pg.code === "42501") return apiError("rule", pg.message ?? "Not allowed.", 422);
    if (pg.code === "23503" || pg.code === "23514") return apiError("invalid", pg.message ?? "A value is not allowed.", 422);
  }
  if (isUnreachable(e)) {
    console.error("api: the database could not be reached", e);
    return apiError("unavailable", "The database cannot be reached at the moment. Try again shortly.", 503);
  }
  console.error("api error", e);
  return apiError("server_error", "Something went wrong.", 500);
}

/** Query helpers. */
export const qInt = (req: NextRequest, k: string, d?: number) => {
  const v = req.nextUrl.searchParams.get(k);
  return v && /^\d+$/.test(v) ? Number(v) : d;
};
export const qStr = (req: NextRequest, k: string) => req.nextUrl.searchParams.get(k)?.trim() || undefined;
export const qDate = (req: NextRequest, k: string) => {
  const v = qStr(req, k);
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
};

export async function readJson<T>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiProblem("invalid_json", "The request body must be JSON.", 400);
  }
}

export const page = (req: NextRequest) => ({ limit: Math.min(qInt(req, "limit", 50)!, 200), offset: qInt(req, "offset", 0)! });
export { keys };
