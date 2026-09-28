import { json, withApi } from "@/lib/api";
import { listUsers } from "@/server/services/admin";

export const dynamic = "force-dynamic";

/** GET /api/v1/users — everybody who can sign in to this company (read-only; needs user.view). */
export const GET = withApi(async (_req, s) => json({ users: await listUsers(s) }));
