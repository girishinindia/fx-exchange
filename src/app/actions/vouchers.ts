"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fieldErrors, optId, RuleError, runAction, type ActionState } from "@/lib/action";
import { VOUCHER_TYPE_LIST, type LineInput, type VoucherType } from "@/lib/ledger";
import { requireSession } from "@/lib/session";
import { postVoucher } from "@/server/services/ledger";

const DEC = (label: string, dp: number) =>
  z.string().trim().regex(new RegExp(`^\\d{1,15}(\\.\\d{1,${dp}})?$`), `${label}: enter a number`).refine((v) => Number(v) > 0, `${label} must be more than 0`);

const Header = z.object({
  type: z.enum(VOUCHER_TYPE_LIST as [VoucherType, ...VoucherType[]]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date"),
  partyId: optId(),
  narration: z.string().trim().max(300).optional(),
  referenceNo: z.string().trim().max(60).optional(),
  rateJustification: z.string().trim().max(300).optional(),
  clientRef: z.string().trim().max(80).optional(),
});

/**
 * Post a voucher typed line by line (opening balance, journal, expense).
 * Form fields: line-0-account, line-0-party, line-0-currency, line-0-fx, line-0-rate, line-0-dc, …
 */
export async function postVoucherAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await runAction(async () => {
    const s = await requireSession();
    const raw = Object.fromEntries(fd);
    const head = Header.safeParse(raw);
    if (!head.success) return { fieldErrors: fieldErrors(head.error) };

    const lines: LineInput[] = [];
    for (let i = 0; i < 40; i++) {
      const account = String(fd.get(`line-${i}-account`) ?? "").trim();
      const fx = String(fd.get(`line-${i}-fx`) ?? "").trim();
      if (!account || !fx) continue;
      const currency = String(fd.get(`line-${i}-currency`) ?? "").trim().toUpperCase();
      const rate = String(fd.get(`line-${i}-rate`) ?? "").trim();
      const dc = String(fd.get(`line-${i}-dc`) ?? "").trim().toUpperCase();
      const party = String(fd.get(`line-${i}-party`) ?? "").trim();
      const check = z.object({ fx: DEC("Amount", 4), rate: DEC("Rate", 6) }).safeParse({ fx, rate: rate || "1" });
      if (!check.success) return { error: `Line ${i + 1}: ${check.error.issues[0]?.message}` };
      if (dc !== "D" && dc !== "C") return { error: `Line ${i + 1}: choose debit or credit` };
      lines.push({
        accountCode: /^\d+$/.test(account) ? undefined : account,
        accountId: /^\d+$/.test(account) ? Number(account) : undefined,
        partyId: party ? Number(party) : null,
        currency: currency || undefined,
        fxAmount: fx,
        rate: rate || undefined,
        dc,
        remarks: String(fd.get(`line-${i}-remarks`) ?? "").trim() || null,
      });
    }
    if (lines.length < 2) throw new RuleError("A voucher needs at least two lines — one debit and one credit.");

    const d = head.data;
    const posted = await postVoucher(s, { ...d, partyId: d.partyId ?? null, lines });
    revalidatePath("/vouchers");
    revalidatePath("/dashboard");
    target = `/vouchers/${posted.id}`;
    return { ok: true, message: posted.duplicate ? `Already posted as ${posted.voucherNo}.` : `Posted ${posted.voucherNo}.` };
  });
  if (res.ok && target) redirect(target);
  return res;
}
