import { dbPing } from "@/lib/db";
import { redisPing } from "@/lib/redis";

export const dynamic = "force-dynamic";

/** Liveness check for Vercel / uptime monitors. Returns no company data and no secrets. */
export async function GET() {
  const [db, redis] = await Promise.all([dbPing(), redisPing()]);
  const ok = db.ok && redis.ok;
  return Response.json(
    { ok, db: { ok: db.ok }, redis: { ok: redis.ok }, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
