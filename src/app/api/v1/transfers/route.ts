import { json, readJson, requirePermissionApi, withApi } from "@/lib/api";
import { postTransfer, type TransferInput } from "@/server/services/day";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/transfers — rupees moved between two rupee accounts (drawer ⇄ bank).
 * Body: { from: "CASH-INR", to: "BANK-INR", inrAmount, date?, narration?, referenceNo?, clientRef? }
 * Posts one JOURNAL voucher of two lines. voucher.create.
 */
export const POST = withApi(async (req, s) => {
  await requirePermissionApi(s, "voucher.create");
  const body = await readJson<TransferInput>(req);
  const posted = await postTransfer(s, body);
  return json(posted, posted.duplicate ? 200 : 201);
});
