import { json, page, qDate, qInt, qStr, readJson, requirePermissionApi, withApi } from "@/lib/api";
import { availableDeposits, listDeals, postDeal, type DealInput } from "@/server/services/deals";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/deals?from=&to=&clientId=&currency=&q=&limit=&offset=
 * With `funding=available`, returns the deposits a new deal can still draw on instead.
 */
export const GET = withApi(async (req, s) => {
  if (qStr(req, "funding") === "available") {
    return json({ available: await availableDeposits(s, qDate(req, "on")) });
  }
  const { rows, total, totals } = await listDeals(s, {
    from: qDate(req, "from"),
    to: qDate(req, "to"),
    clientId: qInt(req, "clientId") ?? null,
    currency: qStr(req, "currency")?.toUpperCase() ?? null,
    q: qStr(req, "q") ?? null,
    ...page(req),
  });
  return json({ deals: rows, total, totals });
});

/**
 * POST /api/v1/deals — book a deal.
 * `funding` may be left out, in which case the oldest deposits with currency left are used.
 * `clientRef` makes a retry safe: the same value returns the deal already booked.
 */
export const POST = withApi(async (req, s) => {
  await requirePermissionApi(s, "deal.manage");
  const posted = await postDeal(s, await readJson<DealInput>(req));
  return json(posted, posted.duplicate ? 200 : 201);
});
