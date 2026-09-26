import { json, readJson, requirePermissionApi, withApi } from "@/lib/api";
import { listAccounts, saveAccount, type AccountInput } from "@/server/services/accounts";

export const dynamic = "force-dynamic";

/** GET /api/v1/accounts — the chart of accounts with balances. */
export const GET = withApi(async (req, s) => {
  const accounts = await listAccounts(s, { activeOnly: req.nextUrl.searchParams.get("active") !== "all" });
  return json({ accounts });
});

/** POST /api/v1/accounts — add a cash/bank, expense or income account. */
export const POST = withApi(async (req, s) => {
  await requirePermissionApi(s, "account.manage");
  const saved = await saveAccount(s, await readJson<AccountInput>(req));
  return json(saved, 201);
});
