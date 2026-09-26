"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fieldErrors, optText, runAction, type ActionState } from "@/lib/action";
import { getCompanyInfo } from "@/lib/company";
import { D } from "@/lib/money";
import { requirePermission } from "@/lib/permissions";
import type { LineInput } from "@/lib/ledger";
import { postVoucher } from "@/server/services/ledger";

/**
 * "What did the company start with?" — the simple opening balance.
 *
 * One row per currency the company deals in: how much is in hand, and for anything that is not
 * rupees, the rate it was acquired at (which becomes its cost when it is sold). It posts the
 * same OPENING voucher the full form would — cash and bank debited, Opening Balance Equity
 * credited with the total — so nothing downstream knows the difference. A company that
 * started with money owed to it or by it uses the full voucher form, which is linked from the
 * same screen; that is a job for whoever keeps the books, not for the first morning.
 */
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date");
const Row = z.object({
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  amount: z.string().trim().default(""),
  rate: z.string().trim().default(""),
});
const Opening = z.object({
  date: DATE,
  narration: optText(300),
  rows: z.array(Row),
});

export async function postSimpleOpeningAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await runAction(async () => {
    const s = await requirePermission("company.manage");
    const company = await getCompanyInfo(s);

    // rows arrive as row.N.currency / row.N.amount / row.N.rate
    const idx = new Set<string>();
    for (const k of fd.keys()) { const m = /^row\.(\d+)\./.exec(k); if (m) idx.add(m[1]); }
    const rows = [...idx].map((i) => ({
      currency: String(fd.get(`row.${i}.currency`) ?? ""),
      amount: String(fd.get(`row.${i}.amount`) ?? ""),
      rate: String(fd.get(`row.${i}.rate`) ?? ""),
    }));
    const v = Opening.safeParse({ date: fd.get("date"), narration: fd.get("narration"), rows });
    if (!v.success) return { fieldErrors: fieldErrors(v.error), error: v.error.issues[0]?.message };

    const lines: LineInput[] = [];
    let total = D(0);
    for (const r of v.data.rows) {
      if (!r.amount || D(r.amount).isZero()) continue;
      const amount = D(r.amount);
      if (amount.isNegative()) return { error: `${r.currency}: an opening amount cannot be negative.` };
      const isBase = r.currency === company.baseCurrency;
      const rate = isBase ? D(1) : D(r.rate || "0");
      if (!isBase && (rate.isZero() || rate.isNegative())) {
        return { error: `${r.currency}: enter the rate it was acquired at — 1 ${r.currency} in ${company.baseCurrency}. That rate becomes its cost when it is sold.` };
      }
      const inr = amount.times(rate).toDecimalPlaces(2);
      lines.push({
        accountCode: `CASH-${r.currency}`, currency: r.currency,
        fxAmount: amount.toFixed(4), rate: rate.toFixed(6), inrAmount: inr.toFixed(2), dc: "D",
      });
      total = total.plus(inr);
    }
    if (lines.length === 0) {
      return { error: "Nothing to post. If the company started with nothing at all, there is no opening balance to record — go straight to Deposits." };
    }
    lines.push({
      accountCode: "OB-EQUITY", currency: company.baseCurrency,
      fxAmount: total.toFixed(4), rate: "1", inrAmount: total.toFixed(2), dc: "C",
    });

    const posted = await postVoucher(s, {
      type: "OPENING", date: v.data.date,
      narration: v.data.narration ?? `Opening balance as at ${v.data.date}`,
      lines,
    });
    revalidatePath("/opening"); revalidatePath("/dashboard"); revalidatePath("/accounts");
    target = `/vouchers/${posted.id}`;
    return { ok: true, message: `Opening balance ${posted.voucherNo} posted.` };
  });
  if (res.ok && target) redirect(target);
  return res;
}
