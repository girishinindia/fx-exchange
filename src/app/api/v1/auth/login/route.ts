import type { NextRequest } from "next/server";
import { apiError, errorResponse, issueTokens, json, readJson } from "@/lib/api";
import { requestMeta } from "@/lib/session";
import { authenticate } from "@/server/services/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/auth/login  { login, password } → tokens
 *
 * `login` is an email address or a mobile number. There is no company code: a person belongs
 * to one company and the server works out which. `email` is accepted as a spelling of the
 * same field so an older app keeps working.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readJson<{ login?: string; email?: string; password?: string }>(req);
    const login = (body.login ?? body.email ?? "").trim();
    if (!login || !body.password) {
      return apiError("invalid", "login (email address or mobile number) and password are required.", 400);
    }
    const { ip, userAgent } = await requestMeta();
    const res = await authenticate({ login, password: body.password, ip, userAgent, context: "api" });
    if (!res.ok) {
      const code = res.status === 429 ? "rate_limited"
        : res.status === 503 ? "unavailable"   // the database, not the password
        : res.status === 423 ? "locked"
        : "unauthorized";
      return apiError(code, res.error, res.status);
    }
    if (res.data.mustChangePassword) {
      return apiError("password_change_required", "Set a new password in the portal before using the app.", 403);
    }
    const tokens = await issueTokens(res.data);
    return json({
      ...tokens,
      user: { id: String(res.data.userId), name: res.data.userName, email: res.data.email, type: res.data.userType },
      company: { id: String(res.data.companyId), code: res.data.companyCode, name: res.data.companyName },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
