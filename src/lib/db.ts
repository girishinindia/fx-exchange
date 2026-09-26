import "server-only";
import postgres from "postgres";
import { env } from "@/lib/env";

/**
 * The ONLY module allowed to talk to Postgres (enforced by ESLint).
 *
 * Every business query must go through `withTenant()`, which opens a transaction and
 * sets the session context used by Row Level Security and the audit trigger:
 *   app.company_id · app.user_id · app.client_ip · app.context
 * The company id always comes from the server-side session — never from a form, URL or header.
 */

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export type TenantContext = {
  companyId: number;
  userId: number;
  clientIp?: string | null;
  context?: "web" | "api" | "job";
};

const globalForDb = globalThis as unknown as { __fxSql?: Sql };

/**
 * How long to wait for a connection to open, in seconds.
 *
 * A cold TCP connect to a pooler on the other side of the internet, plus TLS and SCRAM, is
 * comfortably slower than a connection to a database on the same machine — on a home or office
 * line it can take several seconds, and the first one of the day is the slowest. Ten seconds
 * looked generous against a local Postgres and turned out to be tight against Supabase from
 * India: the desk would throw CONNECT_TIMEOUT at somebody trying to sign in.
 */
export const CONNECT_TIMEOUT_SECONDS = Number(process.env.DATABASE_CONNECT_TIMEOUT ?? 30);

/**
 * True when the database could not be reached at all — as opposed to reached and refusing.
 * The difference matters to the person on the other end: "try again in a moment" against
 * "your password is wrong". postgres.js reports these as driver codes, not SQL states.
 */
export function isUnreachable(e: unknown): boolean {
  const code = typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code) : "";
  return ["CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH",
          "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "CONNECTION_CLOSED", "CONNECTION_ENDED",
          "CONNECTION_DESTROYED"].includes(code);
}

function client(): Sql {
  if (!globalForDb.__fxSql) {
    globalForDb.__fxSql = postgres(env().DATABASE_URL, {
      prepare: false, // required for the Supabase transaction pooler (port 6543)
      // per server instance; keep (instances × max) below the Supabase pooler's pool size
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idle_timeout: 20,
      connect_timeout: CONNECT_TIMEOUT_SECONDS,
      // numeric and bigint come back as strings — money never touches JS floats
    });
  }
  return globalForDb.__fxSql;
}

/** Run `fn` inside one transaction scoped to a company. RLS guarantees it only sees that company. */
export async function withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>, opts: { snapshot?: boolean } = {}): Promise<T> {
  if (!Number.isSafeInteger(ctx.companyId) || ctx.companyId <= 0) throw new Error("withTenant: invalid companyId");
  if (!Number.isSafeInteger(ctx.userId) || ctx.userId <= 0) throw new Error("withTenant: invalid userId");
  // snapshot: one consistent, read-only view of the data for the whole callback (backups)
  const mode = opts.snapshot ? "isolation level repeatable read read only" : "";
  const result = await client().begin(mode, async (tx) => {
    await tx`
      select set_config('app.company_id', ${String(ctx.companyId)}, true),
             set_config('app.user_id',    ${String(ctx.userId)},    true),
             set_config('app.client_ip',  ${ctx.clientIp ?? ""},     true),
             set_config('app.context',    ${ctx.context ?? "web"},   true)`;
    return fn(tx);
  });
  return result as T;
}

/**
 * Queries that must run without a company: only the global reference tables
 * (ex.currency_master, ex.permission) and ex.fn_auth_lookup() at login.
 * RLS returns zero tenant rows here, so a mistake cannot leak company data.
 */
export async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const result = await client().begin(async (tx) => {
    await tx`select set_config('app.company_id', '', true), set_config('app.user_id', '', true), set_config('app.context', 'web', true)`;
    return fn(tx);
  });
  return result as T;
}

/** Health check used by /api/health. */
export async function dbPing(): Promise<{ ok: boolean; currencies?: number; error?: string }> {
  try {
    const rows = await withSystem((tx) => tx<{ n: string }[]>`select count(*)::text as n from ex.currency_master`);
    return { ok: true, currencies: Number(rows[0]?.n ?? 0) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
