import { json, readJson, requirePermissionApi, withApi } from "@/lib/api";
import { postExpense, type ExpenseInput } from "@/server/services/day";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/expenses — an expense paid from the drawer or the bank.
 * Body: { accountCode | accountId (the expense head), inrAmount, paidFrom?: "CASH-INR" | "BANK-INR", date?, partyId?, narration?, referenceNo?, clientRef? }
 * Posts one EXPENSE voucher. voucher.create.
 */
export const POST = withApi(async (req, s) => {
  await requirePermissionApi(s, "voucher.create");
  const body = await readJson<ExpenseInput>(req);
  const posted = await postExpense(s, body);
  return json(posted, posted.duplicate ? 200 : 201);
});
