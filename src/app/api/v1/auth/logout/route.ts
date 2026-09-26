import { errorResponse, json, readJson, revokeRefresh, withApi } from "@/lib/api";
import { destroyOneSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** POST /api/v1/auth/logout  { refreshToken? } — drops this device's tokens. */
export const POST = withApi(async (req, s) => {
  try {
    const body = await readJson<{ refreshToken?: string }>(req).catch(() => ({}) as { refreshToken?: string });
    if (body.refreshToken) await revokeRefresh(body.refreshToken);
    await destroyOneSession(s.companyId, s.userId, s.sid);
    return json({ signedOut: true });
  } catch (e) {
    return errorResponse(e);
  }
});
