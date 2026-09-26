import "server-only";
import postgres from "postgres";
import { CONNECT_TIMEOUT_SECONDS } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * The Super Admin console's connection, and the only other module allowed to talk to Postgres.
 *
 * It signs in as `ex_platform_login`, which is NOT a member of the application role. That role
 * has no privilege on a single table in the schema — not ex.voucher, not ex.party, not even
 * ex.company. All it can do is execute the handful of ex.fn_platform_* functions, each of which
 * returns names, emails and statuses and nothing that looks like money.
 *
 * So the console genuinely cannot read a company's trade, and the desk's own connection
 * (`ex_app_login`, in lib/db.ts) genuinely cannot open a company. Neither is trusted to
 * restrain itself; the database will not let them.
 *
 * When DATABASE_PLATFORM_URL is not set there is no console. That is the intended state for the
 * deployment the desk uses — see docs/SECURITY.md.
 */

type Sql = postgres.Sql;
const globalForDb = globalThis as unknown as { __fxPlatformSql?: Sql };

export class ConsoleNotConfigured extends Error {
  constructor() {
    super("The Super Admin console is not available on this deployment.");
  }
}

export function consoleIsAvailable(): boolean {
  return Boolean(env().DATABASE_PLATFORM_URL);
}

function client(): Sql {
  const url = env().DATABASE_PLATFORM_URL;
  if (!url) throw new ConsoleNotConfigured();
  if (!globalForDb.__fxPlatformSql) {
    globalForDb.__fxPlatformSql = postgres(url, {
      prepare: false, // required for the Supabase transaction pooler (port 6543)
      max: Number(process.env.DATABASE_PLATFORM_POOL_MAX ?? 2), // the console is one or two people
      idle_timeout: 20,
      connect_timeout: CONNECT_TIMEOUT_SECONDS,
    });
  }
  return globalForDb.__fxPlatformSql;
}

/**
 * Run `fn` as the Super Admin. There is no company context to set, because a Super Admin is not
 * inside a company — which is also why every function they call takes the company as an argument
 * and records what was done in ex.platform_audit.
 */
export async function withPlatform<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return (await client().begin(async (tx) => fn(tx))) as T;
}

/** Health check for the console deployment. */
export async function platformPing(): Promise<{ ok: boolean; error?: string }> {
  if (!consoleIsAvailable()) return { ok: false, error: "not configured" };
  try {
    await withPlatform((tx) => tx`select 1`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
