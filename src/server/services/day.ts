import "server-only";
import { withTenant } from "@/lib/db";
import { assertPermission, hasPermission, PermissionError } from "@/lib/permissions";
import { tenantOf, type Session } from "@/lib/session";
import { postVoucher } from "./ledger";

/**
 * The day sheet — the client's whiteboard read off the ledger.
 *
 * One column per Cash/Bank account (USD, EUR, …, ₹ Cash, ₹ Bank), one row per voucher of the
 * day, and under them what came in, what went out and what is left. Opening is the account's
 * balance before the day's first voucher, closing after its last, so yesterday's bottom row is
 * today's top row without anybody copying it. Nothing is stored: a cell is the sum of that
 * voucher's lines on that account, and it can never disagree with the vouchers or the trial
 * balance because it is them.
 */

export type DayColumn = { accountId: string; code: string; name: string; currency: string; isBase: boolean; kind: "CASH" | "BANK" | "FX" };
export type DayCell = { fx: string; inr: string };
export type DayRow = {
  voucherId: string; voucherNo: string; type: string; status: string;
  /** what the row is, in the client's words */
  line: "Opening" | "Sell" | "Buy" | "Handed over" | "Received" | "Paid" | "Expense" | "Cash⇄Bank" | "Journal" | "Reversed" | "Restated";
  time: string; partyId: string | null; partyName: string | null;
  /** the rate typed on the line, when there was one */
  rate: string | null; currency: string | null;
  remark: string;
  cells: Record<string, DayCell>;
};
export type DaySheet = {
  date: string; today: string; baseCurrency: string; dealingCurrency: string;
  columns: DayColumn[];
  opening: Record<string, DayCell>;
  rows: DayRow[];
  inflow: Record<string, DayCell>;
  outflow: Record<string, DayCell>;
  closing: Record<string, DayCell>;
  /** margin earned, other income and expenses posted on the day, in rupees */
  day: { margin: string; otherIncome: string; expenses: string; result: string; vouchers: number };
};

type LineAgg = { voucher_id: string; account_id: string; fx: string; inr: string };

const num = (s: string | number | null | undefined) => Number(s ?? 0);
const money = (n: number) => n.toFixed(2);
const qty = (n: number) => n.toFixed(4);
const fmtQty = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInr = (n: number) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtRate = (n: number) => { const s = n.toFixed(6).replace(/0+$/, ""); const [a, b = ""] = s.split("."); return `${a}.${b.padEnd(2, "0")}`; };

export async function daySheet(s: Session, date?: string): Promise<DaySheet> {
  await assertPermission("report.view", s);
  return withTenant(await tenantOf(s), async (tx) => {
    const [co] = await tx<{ base: string; prim: string; today: string; tz: string }[]>`
      select trim(base_currency_code) as base, trim(primary_currency_code) as prim,
             to_char(ex.fn_company_today(), 'YYYY-MM-DD') as today, timezone as tz from ex.company`;
    const day = date ?? co.today;

    const accounts = await tx<{ id: string; code: string; name: string; currency_code: string; sort_order: number }[]>`
      select id, code, name, trim(currency_code) as currency_code, sort_order
        from ex.account where account_group = 'CASH_BANK' and is_active
       order by (trim(currency_code) = ${co.base}) desc, (trim(currency_code) = ${co.prim}) desc, sort_order, code`;
    const columns: DayColumn[] = accounts.map((a) => ({
      accountId: String(a.id), code: a.code, name: a.name, currency: a.currency_code, isBase: a.currency_code === co.base,
      kind: a.currency_code !== co.base ? "FX" : a.code.startsWith("BANK") || /bank/i.test(a.name) ? "BANK" : "CASH",
    }));
    const byId = new Map(columns.map((c) => [c.accountId, c]));

    // opening: everything before the day, per account
    const opening: Record<string, DayCell> = {};
    for (const c of columns) opening[c.code] = { fx: "0.0000", inr: "0.00" };
    const open = await tx<{ account_id: string; fx: string; inr: string }[]>`
      select l.account_id, sum(case when l.dc = 'D' then l.fx_amount else -l.fx_amount end)::text as fx,
             sum(case when l.dc = 'D' then l.inr_amount else -l.inr_amount end)::text as inr
        from ex.voucher_line l join ex.voucher v on v.id = l.voucher_id
        join ex.account a on a.id = l.account_id and a.account_group = 'CASH_BANK'
       where v.voucher_date < ${day}
       group by l.account_id`;
    for (const o of open) { const c = byId.get(String(o.account_id)); if (c) opening[c.code] = { fx: qty(num(o.fx)), inr: money(num(o.inr)) }; }

    // the day's vouchers, oldest first, with the deal / deposit behind each where there is one
    const vouchers = await tx<{
      id: string; voucher_no: string; voucher_type: string; status: string; time: string; party_id: string | null; party_name: string | null;
      narration: string | null; reference_no: string | null; reversal_of_no: string | null;
      deal_cur: string | null; deal_fx: string | null; deal_rate: string | null; deal_margin: string | null; deal_src: string | null; deal_src_amount: string | null; deal_cost: string | null;
      dep_cur: string | null; dep_fx: string | null; dep_rate: string | null; dep_recv_cur: string | null; dep_recv: string | null; dep_kept: boolean | null;
    }[]>`
      select v.id, v.voucher_no, v.voucher_type, v.status, to_char(v.posted_at at time zone ${co.tz}, 'HH24:MI') as time,
             v.party_id, p.full_name as party_name, v.narration, v.reference_no, rv.voucher_no as reversal_of_no,
             trim(d.fx_currency) as deal_cur, d.fx_amount::text as deal_fx, d.fx_to_inr_rate::text as deal_rate, d.margin_inr::text as deal_margin,
             trim(d.src_currency) as deal_src, d.src_amount::text as deal_src_amount, d.src_cost_inr::text as deal_cost,
             trim(dp.currency_code) as dep_cur, dp.fx_amount::text as dep_fx, dp.manual_rate::text as dep_rate,
             trim(dp.received_currency) as dep_recv_cur, dp.received_amount::text as dep_recv, dp.kept as dep_kept
        from ex.voucher v
        left join ex.party p on p.id = v.party_id
        left join ex.voucher rv on rv.id = v.reversal_of
        left join ex.deal d on d.voucher_id = v.id
        left join ex.deposit dp on dp.voucher_id = v.id
       where v.voucher_date = ${day}
       order by v.id`;

    const lines = vouchers.length
      ? await tx<LineAgg[]>`
          select l.voucher_id, l.account_id,
                 sum(case when l.dc = 'D' then l.fx_amount else -l.fx_amount end)::text as fx,
                 sum(case when l.dc = 'D' then l.inr_amount else -l.inr_amount end)::text as inr
            from ex.voucher_line l join ex.voucher v on v.id = l.voucher_id
           where v.voucher_date = ${day}
           group by l.voucher_id, l.account_id`
      : [];
    const cellsByVoucher = new Map<string, Record<string, DayCell>>();
    for (const l of lines) {
      const c = byId.get(String(l.account_id));
      if (!c) continue;
      const m = cellsByVoucher.get(String(l.voucher_id)) ?? {};
      m[c.code] = { fx: qty(num(l.fx)), inr: money(num(l.inr)) };
      cellsByVoucher.set(String(l.voucher_id), m);
    }

    // the settlement / payout / receipt figures live only in lines: currency and amount per voucher
    const fxLines = vouchers.length
      ? await tx<{ voucher_id: string; group: string; currency_code: string; fx: string; inr: string }[]>`
          select l.voucher_id, a.account_group as "group", trim(l.currency_code) as currency_code,
                 sum(case when l.dc = 'D' then l.fx_amount else -l.fx_amount end)::text as fx,
                 sum(case when l.dc = 'D' then l.inr_amount else -l.inr_amount end)::text as inr
            from ex.voucher_line l join ex.voucher v on v.id = l.voucher_id join ex.account a on a.id = l.account_id
           where v.voucher_date = ${day} and a.account_group in ('PAYABLE','CURRENCY_PAYABLE','RECEIVABLE','INCOME','EXPENSE','ROUNDING')
           group by l.voucher_id, a.account_group, trim(l.currency_code)`
      : [];
    const partyLines = new Map<string, { group: string; currency: string; fx: number; inr: number }[]>();
    for (const l of fxLines) {
      const arr = partyLines.get(String(l.voucher_id)) ?? [];
      arr.push({ group: l.group, currency: l.currency_code, fx: num(l.fx), inr: num(l.inr) });
      partyLines.set(String(l.voucher_id), arr);
    }

    const rows: DayRow[] = vouchers.map((v) => {
      const cells = cellsByVoucher.get(String(v.id)) ?? {};
      const pl = partyLines.get(String(v.id)) ?? [];
      const who = v.party_name ?? "";
      let line: DayRow["line"] = "Journal";
      let rate: string | null = null;
      let currency: string | null = null;
      let remark = "";
      const rupeeCells = columns.filter((c) => c.isBase).map((c) => cells[c.code]).filter(Boolean);
      const paidBy = (() => {
        const moved = columns.filter((c) => c.isBase && cells[c.code] && num(cells[c.code].inr) !== 0);
        return moved.length === 1 ? (moved[0].kind === "BANK" ? "bank" : "cash") : null;
      })();
      switch (v.voucher_type) {
        case "DEAL": {
          line = "Sell"; rate = v.deal_rate; currency = v.deal_cur;
          const own = v.deal_src === v.deal_cur;
          remark = `${who} bought ${fmtQty(num(v.deal_fx))} ${v.deal_cur} @ ${fmtRate(num(v.deal_rate))}` +
            (own ? "" : ` · used ${fmtQty(num(v.deal_src_amount))} ${v.deal_src}`) +
            ` · ${num(v.deal_margin) < 0 ? "loss" : "margin"} ${fmtInr(Math.abs(num(v.deal_margin)))}`;
          break;
        }
        case "DEPOSIT": {
          line = "Buy"; rate = v.dep_rate; currency = v.dep_cur;
          const changed = v.dep_recv_cur && v.dep_recv_cur !== v.dep_cur;
          remark = `bought ${fmtQty(num(changed ? v.dep_recv : v.dep_fx))} ${changed ? v.dep_recv_cur : v.dep_cur} from ${who}` +
            (changed ? ` → ${fmtQty(num(v.dep_fx))} ${v.dep_cur}` : "") +
            ` @ ${fmtRate(num(v.dep_rate))} a ${v.dep_cur}` + (v.dep_kept ? " · kept as " + v.dep_cur : "");
          break;
        }
        case "PAYOUT": {
          line = "Handed over";
          const cp = pl.find((l) => l.group === "CURRENCY_PAYABLE");
          currency = cp?.currency ?? null;
          remark = cp ? `handed ${fmtQty(Math.abs(cp.fx))} ${cp.currency} to ${who}` : `handed currency to ${who}`;
          break;
        }
        case "RECEIPT": {
          line = "Received";
          const rc = pl.find((l) => l.group === "RECEIVABLE");
          remark = `${fmtInr(Math.abs(rc?.inr ?? rupeeCells.reduce((a, c) => a + num(c.inr), 0)))} received from ${who}` + (paidBy ? ` · ${paidBy}` : "");
          break;
        }
        case "SETTLEMENT": {
          line = "Paid";
          const dp = pl.find((l) => l.group === "PAYABLE");
          const paid = Math.abs(rupeeCells.reduce((a, c) => a + num(c.inr), 0));
          currency = dp?.currency ?? null;
          if (dp && dp.fx !== 0) rate = (paid / Math.abs(dp.fx)).toFixed(6);
          remark = `paid ${who} ${fmtInr(paid)}` + (dp ? ` for ${fmtQty(Math.abs(dp.fx))} ${dp.currency}${rate ? ` @ ${fmtRate(num(rate))}` : ""}` : "") + (paidBy ? ` · ${paidBy}` : "");
          break;
        }
        case "EXPENSE": {
          line = "Expense";
          const ex = pl.filter((l) => l.group === "EXPENSE");
          remark = `${v.narration || "expense"}` + (ex.length ? ` · ${fmtInr(ex.reduce((a, l) => a + l.inr, 0))}` : "") + (paidBy ? ` · ${paidBy}` : "");
          break;
        }
        case "JOURNAL": {
          const moved = columns.filter((c) => c.isBase && cells[c.code] && num(cells[c.code].inr) !== 0);
          if (moved.length === 2 && pl.length === 0) {
            line = "Cash⇄Bank";
            const to = moved.find((c) => num(cells[c.code].inr) > 0)!, from = moved.find((c) => num(cells[c.code].inr) < 0)!;
            remark = `${fmtInr(num(cells[to.code].inr))} ${from.kind === "CASH" ? "drawer → bank" : "bank → drawer"}` + (v.narration ? ` · ${v.narration}` : "");
          } else {
            line = "Journal"; remark = v.narration || "journal";
          }
          break;
        }
        case "REVERSAL": {
          line = "Reversed";
          const reason = (v.narration ?? "").replace(/^Reverses\s+\S+\s*[—-]?\s*/i, "").trim();
          remark = `reversed ${(v.reversal_of_no ?? "").split("/").slice(-2).join("/")}${reason ? ` — ${reason}` : ""}`;
          break;
        }
        case "REVALUATION": { line = "Restated"; remark = v.narration || "stock restated at closing rates"; break; }
        case "OPENING": { line = "Opening"; remark = v.narration || "opening balance"; break; }
      }
      if (v.reference_no) remark += ` · ref ${v.reference_no}`;
      remark += ` · ${v.voucher_no.split("/").slice(-2).join("/")}`;
      return {
        voucherId: String(v.id), voucherNo: v.voucher_no, type: v.voucher_type, status: v.status, line, time: v.time,
        partyId: v.party_id ? String(v.party_id) : null, partyName: v.party_name, rate, currency, remark, cells,
      };
    });

    const inflow: Record<string, DayCell> = {}, outflow: Record<string, DayCell> = {}, closing: Record<string, DayCell> = {};
    for (const c of columns) {
      let inFx = 0, inInr = 0, outFx = 0, outInr = 0;
      for (const r of rows) {
        const cell = r.cells[c.code]; if (!cell) continue;
        const f = num(cell.fx), i = num(cell.inr);
        if (c.isBase ? i >= 0 : f >= 0) { inFx += f; inInr += i; } else { outFx += f; outInr += i; }
      }
      inflow[c.code] = { fx: qty(inFx), inr: money(inInr) };
      outflow[c.code] = { fx: qty(outFx), inr: money(outInr) };
      closing[c.code] = { fx: qty(num(opening[c.code].fx) + inFx + outFx), inr: money(num(opening[c.code].inr) + inInr + outInr) };
    }

    // the day's result, from the income and expense lines posted on the day
    const [pl] = await tx<{ margin: string; other: string; expenses: string }[]>`
      select coalesce(sum(case when a.code in ('FX-MARGIN','FX-LOSS') then (case when l.dc = 'C' then l.inr_amount else -l.inr_amount end) end), 0)::text as margin,
             coalesce(sum(case when a.account_type = 'INCOME' and a.code not in ('FX-MARGIN') then (case when l.dc = 'C' then l.inr_amount else -l.inr_amount end) end), 0)::text as other,
             coalesce(sum(case when a.account_type = 'EXPENSE' and a.code not in ('FX-LOSS') then (case when l.dc = 'D' then l.inr_amount else -l.inr_amount end) end), 0)::text as expenses
        from ex.voucher_line l join ex.voucher v on v.id = l.voucher_id join ex.account a on a.id = l.account_id
       where v.voucher_date = ${day} and a.account_type in ('INCOME','EXPENSE')`;
    const result = num(pl.margin) + num(pl.other) - num(pl.expenses);

    return {
      date: day, today: co.today, baseCurrency: co.base, dealingCurrency: co.prim, columns, opening, rows, inflow, outflow, closing,
      day: { margin: money(num(pl.margin)), otherIncome: money(num(pl.other)), expenses: money(num(pl.expenses)), result: money(result), vouchers: rows.length },
    };
  });
}

// ------------------------------------------------------------ expense / transfer
export type ExpenseInput = {
  /** the expense head — an EXPENSE account code such as RENT, or its id */
  accountCode?: string; accountId?: number;
  inrAmount: string;
  /** which rupee drawer it left: CASH-INR (default) or BANK-INR */
  paidFrom?: string | null;
  date?: string; partyId?: number | null; narration?: string | null; referenceNo?: string | null; clientRef?: string | null;
};

/** An expense paid from the drawer or the bank — the same EXPENSE voucher the manual screen posts. */
export async function postExpense(s: Session, e: ExpenseInput) {
  await assertPermission("voucher.create", s);
  const amt = Number(e.inrAmount);
  if (!(amt > 0)) throw new Error("Enter the amount");
  if (!e.accountCode && !e.accountId) throw new Error("Choose what the expense was for");
  const base = await baseCurrency(s);
  return postVoucher(s, {
    type: "EXPENSE", date: e.date, partyId: e.partyId ?? null, narration: e.narration ?? null, referenceNo: e.referenceNo ?? null, clientRef: e.clientRef ?? null,
    lines: [
      { accountCode: e.accountCode, accountId: e.accountId, currency: base, fxAmount: amt.toFixed(2), rate: "1", inrAmount: amt.toFixed(2), dc: "D" },
      { accountCode: (e.paidFrom || `CASH-${base}`).toUpperCase(), currency: base, fxAmount: amt.toFixed(2), rate: "1", inrAmount: amt.toFixed(2), dc: "C" },
    ],
  });
}

export type TransferInput = { from: string; to: string; inrAmount: string; date?: string; narration?: string | null; referenceNo?: string | null; clientRef?: string | null };

/** Rupees moved between the drawer and the bank (or any two rupee accounts): a JOURNAL of two lines. */
export async function postTransfer(s: Session, t: TransferInput) {
  await assertPermission("voucher.create", s);
  const amt = Number(t.inrAmount);
  if (!(amt > 0)) throw new Error("Enter the amount");
  const from = (t.from || "").toUpperCase(), to = (t.to || "").toUpperCase();
  if (!from || !to || from === to) throw new Error("Choose where the rupees come from and where they go");
  const base = await baseCurrency(s);
  return postVoucher(s, {
    type: "JOURNAL", date: t.date, narration: t.narration ?? null, referenceNo: t.referenceNo ?? null, clientRef: t.clientRef ?? null,
    lines: [
      { accountCode: to, currency: base, fxAmount: amt.toFixed(2), rate: "1", inrAmount: amt.toFixed(2), dc: "D" },
      { accountCode: from, currency: base, fxAmount: amt.toFixed(2), rate: "1", inrAmount: amt.toFixed(2), dc: "C" },
    ],
  });
}

async function baseCurrency(s: Session): Promise<string> {
  return withTenant(await tenantOf(s), async (tx) => {
    const [co] = await tx<{ base: string }[]>`select trim(base_currency_code) as base from ex.company`;
    return co.base;
  });
}

// ------------------------------------------------------------------ day close
export type DayCloseInput = { date?: string; rates: { currency: string; rate: string }[] };
export type DayClose = {
  date: string; baseCurrency: string;
  /** every currency with something in it at the end of the day, and what it is worth at the typed rate */
  stock: { currency: string; fx: string; carriedInr: string; rate: string | null; valueInr: string | null; carriedRate: string | null; owedToClientsFx: string; owedToDepositorsFx: string }[];
  rupees: { code: string; name: string; inr: string }[];
  totals: { carriedInr: string; valueInr: string | null; unrealised: string | null };
  day: DaySheet["day"];
};

/**
 * Sheets 2 and 4 of the client's Excel: the stock at the end of the day valued at the closing
 * rates typed just now, the two rupee drawers, and the day's result. Nothing is posted; a rate
 * typed here is used for this answer and forgotten. Restating the books at these rates is the
 * year-end revaluation, which stays where it is and needs fy.lock.
 */
export async function dayClose(s: Session, input: DayCloseInput): Promise<DayClose> {
  await assertPermission("report.view", s);
  const sheet = await daySheet(s, input.date);
  const rates = new Map(input.rates.filter((r) => r.currency && Number(r.rate) > 0).map((r) => [r.currency.toUpperCase(), Number(r.rate)]));
  return withTenant(await tenantOf(s), async (tx) => {
    const held = await tx<{ currency_code: string; fx: string; inr: string }[]>`
      select trim(l.currency_code) as currency_code,
             sum(case when l.dc = 'D' then l.fx_amount else -l.fx_amount end)::text as fx,
             sum(case when l.dc = 'D' then l.inr_amount else -l.inr_amount end)::text as inr
        from ex.voucher_line l join ex.voucher v on v.id = l.voucher_id join ex.account a on a.id = l.account_id
       where a.account_group = 'CASH_BANK' and v.voucher_date <= ${sheet.date} and trim(l.currency_code) <> ${sheet.baseCurrency}
       group by 1 having sum(case when l.dc = 'D' then l.fx_amount else -l.fx_amount end) <> 0 order by 1`;
    const owed = await tx<{ currency_code: string; to_clients: string; to_depositors: string }[]>`
      select cur as currency_code, sum(c)::text as to_clients, sum(d)::text as to_depositors from (
        select trim(l.currency_code) as cur,
               sum(case when a.account_group = 'CURRENCY_PAYABLE' then (case when l.dc = 'C' then l.fx_amount else -l.fx_amount end) else 0 end) as c,
               sum(case when a.account_group = 'PAYABLE' then (case when l.dc = 'C' then l.fx_amount else -l.fx_amount end) else 0 end) as d
          from ex.voucher_line l join ex.voucher v on v.id = l.voucher_id join ex.account a on a.id = l.account_id
         where a.account_group in ('CURRENCY_PAYABLE','PAYABLE') and v.voucher_date <= ${sheet.date} and trim(l.currency_code) <> ${sheet.baseCurrency}
         group by 1) o group by cur`;
    const owedBy = new Map(owed.map((o) => [o.currency_code, o]));
    let carried = 0, value = 0, allRated = true;
    const stock = held.map((h) => {
      const fx = num(h.fx), inr = num(h.inr), rate = rates.get(h.currency_code) ?? null;
      carried += inr;
      if (rate == null) allRated = false; else value += fx * rate;
      const o = owedBy.get(h.currency_code);
      return {
        currency: h.currency_code, fx: qty(fx), carriedInr: money(inr), rate: rate == null ? null : String(rate),
        valueInr: rate == null ? null : money(fx * rate), carriedRate: fx !== 0 ? (inr / fx).toFixed(6) : null,
        owedToClientsFx: qty(num(o?.to_clients)), owedToDepositorsFx: qty(num(o?.to_depositors)),
      };
    });
    const rupees = sheet.columns.filter((c) => c.isBase).map((c) => ({ code: c.code, name: c.name, inr: sheet.closing[c.code].inr }));
    return {
      date: sheet.date, baseCurrency: sheet.baseCurrency, stock, rupees,
      totals: { carriedInr: money(carried), valueInr: allRated ? money(value) : null, unrealised: allRated ? money(value - carried) : null },
      day: sheet.day,
    };
  });
}

// ------------------------------------------------------------------ walk-in
/**
 * The client who has no account: a traveller at the counter. One per company, made the first
 * time it is needed, a client only — and a walk-in always pays on the spot, which the entry
 * screens enforce by collecting the rupees in the same save.
 */
export const WALK_IN_CODE = "WALK-IN";

export async function walkIn(s: Session): Promise<{ id: string; partyCode: string; fullName: string }> {
  if (!(await hasPermission(s, "deal.manage")) && !(await hasPermission(s, "voucher.create"))) throw new PermissionError("deal.manage");
  return withTenant(await tenantOf(s), async (tx) => {
    const [have] = await tx<{ id: string; party_code: string; full_name: string }[]>`
      select id, party_code, full_name from ex.party where party_code = ${WALK_IN_CODE}`;
    if (have) return { id: String(have.id), partyCode: have.party_code, fullName: have.full_name };
    const [row] = await tx<{ id: string; party_code: string; full_name: string }[]>`
      insert into ex.party (party_code, full_name, party_form, is_depositor, is_client, notes, is_active)
      values (${WALK_IN_CODE}, 'Walk-in', 'INDIVIDUAL', true, true, 'Counter clients with no account. Every line settles on the spot.', true)
      returning id, party_code, full_name`;
    return { id: String(row.id), partyCode: row.party_code, fullName: row.full_name };
  });
}
