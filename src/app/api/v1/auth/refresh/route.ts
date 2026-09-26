import type { NextRequest } from "next/server";
import { apiError, errorResponse, json, readJson, rotateTokens } from "@/lib/api";
import { withTenant } from "@/lib/db";
import type { NewSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** POST /api/v1/auth/refresh  { refreshToken } → a new pair (the old refresh token stops working) */
export async function POST(req: NextRequest) {
  try {
    const body = await readJson<{ refreshToken?: string }>(req);
    if (!body.refreshToken) return apiError("invalid", "refreshToken is required.", 400);
    const tokens = await rotateTokens(body.refreshToken, async (companyId, userId): Promise<NewSession | null> => {
      const [r] = await withTenant({ companyId, userId, context: "api" }, (tx) =>
        tx<{ code: string; name: string; full_name: string; email: string; user_type: "ADMIN" | "USER";
            counter_name: string | null; must_change_password: boolean; status: string;
            profile_done: boolean; company_set_up: boolean }[]>`
          select c.code, coalesce(c.display_name, c.legal_name) as name, u.full_name, u.email, u.user_type,
                 u.counter_name, u.must_change_password, u.status,
                 u.profile_completed_at is not null as profile_done,
                 c.setup_completed_at  is not null as company_set_up
            from ex.app_user u join ex.company c on c.id = u.company_id
           where u.id = ${userId}`);
      if (!r || r.status !== "ACTIVE") return null;
      return {
        userId, companyId, companyCode: r.code, companyName: r.name, userName: r.full_name, email: r.email,
        userType: r.user_type, counterName: r.counter_name, mustChangePassword: r.must_change_password,
        profileCompleted: r.profile_done, companySetUp: r.company_set_up,
      };
    });
    if (!tokens) return apiError("unauthorized", "The refresh token is invalid or has expired. Sign in again.", 401);
    return json(tokens);
  } catch (e) {
    return errorResponse(e);
  }
}
