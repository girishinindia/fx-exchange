import "server-only";
import type { Tx } from "@/lib/db";
import { formatINR } from "@/lib/money";
import type { Permission } from "@/lib/permissions";

/**
 * Report engine: every report returns columns + rows + totals, so the same definition
 * feeds the screen, CSV, Excel and the print / PDF view.
 * All numbers come from Postgres as strings (numeric) — never JS floats.
 * Phase 7 ships the accounting core; deal, deposit and ageing reports arrive with their phases.
 */

export type ColType = "text" | "money" | "qty" | "rate" | "int" | "pct" | "date" | "link";
export type Col = { key: string; label: string; type: ColType; total?: boolean; dp?: number };
export type Row = Record<string, string | number | null>;
export type ReportParams = { from: string; to: string; group: "day" | "month" | "year"; cur: string | null; q: string | null; party: number | null };
export type Scope = { ownUserId: number | null };
export type ReportResult = { columns: Col[]; rows: Row[]; totals: Row | null; note?: string; chart?: { label: string; value: string; title: string } };

export type ReportDef = {
  title: string;
  description: string;
  icon: string;
  group: "Accounts" | "Parties" | "Registers";
  params: Array<"period" | "group" | "cur" | "q" | "party">;
  permission?: Permission;
  hidden?: boolean;
  run: (tx: Tx, p: ReportParams, s: Scope) => Promise<ReportResult>;
};

export function bucketLabel(v: string | Date | null, group: ReportParams["group"]): string {
  if (!v) return "";
  const d = new Date(v);
  if (group === "day") return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
  if (group === "month") return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }).format(d);
  const y = d.getUTCFullYear();
  return d.getUTCMonth() === 0 ? String(y) : `FY ${y}-${String(y + 1).slice(2)}`;
}

/** Exact decimal totals (string arithmetic — no floats). */
function sumRows(rows: Row[], cols: Col[], label: string): Row {
  const t: Row = {};
  cols.forEach((c, i) => {
    if (i === 0) t[c.key] = label;
    else if (c.total) {
      const scale = c.type === "qty" ? 4 : c.type === "int" ? 0 : 2;
      let acc = BigInt(0);
      for (const r of rows) {
        const v = r[c.key];
        if (v === null || v === undefined || v === "") continue;
        const [int, dec = ""] = String(v).split(".");
        acc += BigInt(int + dec.padEnd(scale, "0").slice(0, scale));
      }
      const neg = acc < BigInt(0);
      const digits = (neg ? BigInt(-1) * acc : acc).toString().padStart(scale + 1, "0");
      const out = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
      t[c.key] = (neg ? "-" : "") + out;
    } else t[c.key] = null;
  });
  return t;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function reportParams(sp: Record<string, string | string[] | undefined>, today: string, monthStart: string): ReportParams {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  return {
    from: DATE.test(one("from")) ? one("from") : monthStart,
    to: DATE.test(one("to")) ? one("to") : today,
    group: ["day", "month", "year"].includes(one("group")) ? (one("group") as ReportParams["group"]) : "month",
    cur: /^[A-Za-z]{3}$/.test(one("cur")) ? one("cur").toUpperCase() : null,
    q: one("q").slice(0, 60) || null,
    party: /^\d{1,18}$/.test(one("party")) ? Number(one("party")) : null,
  };
}

/** Balances of every account up to a date (the trial balance and everything built on it). */
function balancesUpTo(tx: Tx, to: string) {
  return tx`
    select a.id, a.code, a.name, a.account_type, a.account_group, a.currency_code,
           coalesce(sum(case when l.dc = 'D' then l.inr_amount else -l.inr_amount end), 0) as balance_inr,
           coalesce(sum(case when l.dc = 'D' then l.fx_amount  else -l.fx_amount  end), 0) as balance_fx
      from ex.account a
      left join ex.voucher_line l on l.account_id = a.id
      left join ex.voucher v on v.id = l.voucher_id and v.voucher_date <= ${to}::date
     where l.id is null or v.id is not null
     group by a.id, a.code, a.name, a.account_type, a.account_group, a.currency_code
     order by a.sort_order, a.code`;
}

/**
 * Movement of every account between two dates — what a profit and loss account is made of.
 * (A balance sheet uses `balancesUpTo` instead: it is a position, not a movement.)
 */
function movementBetween(tx: Tx, from: string, to: string) {
  return tx`
    select a.id, a.code, a.name, a.account_type, a.account_group,
           coalesce(sum(case when l.dc = 'D' then l.inr_amount else -l.inr_amount end), 0) as movement_inr
      from ex.account a
      left join ex.voucher_line l on l.account_id = a.id
      left join ex.voucher v on v.id = l.voucher_id
                            and v.voucher_date between ${from}::date and ${to}::date
     where l.id is null or v.id is not null
     group by a.id, a.code, a.name, a.account_type, a.account_group
     order by a.sort_order, a.code`;
}

type AccountBalance = { code: string; name: string; account_type: string; account_group: string; balance_inr: string };
type AccountMovement = { code: string; name: string; account_type: string; account_group: string; movement_inr: string };

/** Exact rupee arithmetic on strings — paise in, paise out, no floats anywhere. */
const paise = (v: string | number) => Math.round(Number(v) * 100);
const rupees = (p: number) => (p / 100).toFixed(2);

const TYPE_LABEL: Record<string, string> = { ASSET: "Asset", LIABILITY: "Liability", EQUITY: "Equity", INCOME: "Income", EXPENSE: "Expense" };

const BUCKETS = [
  { key: "b0", label: "0–30 days", max: 30 },
  { key: "b31", label: "31–60 days", max: 60 },
  { key: "b61", label: "61–90 days", max: 90 },
  { key: "b90", label: "Over 90 days", max: Infinity },
] as const;

type AgeingLine = { party_id: string; party_code: string; full_name: string; date: string; up: string; down: string };

/**
 * Ageing, the only way it is honest: money received settles the oldest bill first, and what is
 * left over is aged from the date of the bill it still belongs to. Netting a party's balance and
 * dating it by the last entry would make every old debt look new.
 */
function ageByFifo(lines: AgeingLine[], asAt: string) {
  const day = 24 * 60 * 60 * 1000;
  const asAtMs = Date.parse(asAt + "T00:00:00Z");
  const byParty = new Map<string, { code: string; name: string; open: { date: string; left: number }[]; credit: number }>();

  for (const l of lines) {
    let p = byParty.get(l.party_id);
    if (!p) {
      p = { code: l.party_code, name: l.full_name, open: [], credit: 0 };
      byParty.set(l.party_id, p);
    }
    const up = paise(l.up);
    const down = paise(l.down);
    if (up > 0) {
      // an older payment sitting unapplied settles this new debt first
      let add = up;
      if (p.credit > 0) {
        const used = Math.min(p.credit, add);
        p.credit -= used;
        add -= used;
      }
      if (add > 0) p.open.push({ date: l.date, left: add });
    }
    if (down > 0) {
      let pay = down;
      for (const o of p.open) {
        if (pay <= 0) break;
        const used = Math.min(o.left, pay);
        o.left -= used;
        pay -= used;
      }
      if (pay > 0) p.credit += pay;   // paid more than was owed: an advance, carried forward
    }
  }

  type Aged = { partyId: string; code: string; name: string; oldest: number;
                b0: number; b31: number; b61: number; b90: number; total: number; advance: number };

  return [...byParty.entries()].map(([partyId, p]): Aged => {
    const row = { b0: 0, b31: 0, b61: 0, b90: 0 };
    let total = 0;
    let oldest = 0;
    for (const o of p.open) {
      if (o.left <= 0) continue;
      const age = Math.floor((asAtMs - Date.parse(o.date + "T00:00:00Z")) / day);
      oldest = Math.max(oldest, age);
      row[(BUCKETS.find((b) => age <= b.max) ?? BUCKETS[3]).key] += o.left;
      total += o.left;
    }
    return { partyId, code: p.code, name: p.name, oldest, ...row, total, advance: p.credit };
  }).filter((r) => r.total > 0 || r.advance > 0)
    .sort((a, b) => b.oldest - a.oldest || b.total - a.total);
}

/**
 * The pack the CA is handed at filing time, in the order they read it: the books first, then
 * what the year earned, then where it stands, then who owes what, then the entries behind it all.
 */
/** Exposed for the unit tests — the FIFO matching behind ageing is worth pinning on its own. */
export const __testing = { ageByFifo };

export const CA_PACK = [
  "trialbalance", "profitloss", "balancesheet", "currencyposition",
  "partybalances", "ageing", "deals", "journal",
] as const;

export const REPORTS: Record<string, ReportDef> = {
  // ---------------------------------------------------------------- Accounts
  trialbalance: {
    title: "Trial balance",
    description: "Every account with its closing debit or credit. Both sides must be equal — the first page your CA opens.",
    icon: "fa-scale-balanced",
    group: "Accounts",
    params: ["period"],
    async run(tx, p) {
      const rows = (await balancesUpTo(tx, p.to)) as unknown as { code: string; name: string; account_type: string; balance_inr: string }[];
      const columns: Col[] = [
        { key: "code", label: "Code", type: "text" },
        { key: "name", label: "Account", type: "text" },
        { key: "type", label: "Group", type: "text" },
        { key: "debit", label: "Debit (₹)", type: "money", total: true },
        { key: "credit", label: "Credit (₹)", type: "money", total: true },
      ];
      const out: Row[] = rows
        .filter((r) => Number(r.balance_inr) !== 0)
        .map((r) => ({
          code: r.code,
          name: r.name,
          type: TYPE_LABEL[r.account_type] ?? r.account_type,
          debit: Number(r.balance_inr) > 0 ? Number(r.balance_inr).toFixed(2) : "0.00",
          credit: Number(r.balance_inr) < 0 ? (-Number(r.balance_inr)).toFixed(2) : "0.00",
        }));
      const totals = sumRows(out, columns, "Total");
      const ok = totals.debit === totals.credit;
      return { columns, rows: out, totals, note: ok ? "Debits equal credits — the books balance." : "OUT OF BALANCE — check the latest vouchers." };
    },
  },

  profitloss: {
    title: "Profit & loss",
    description: "What the desk earned and what it spent over the period, and the profit left over.",
    icon: "fa-chart-line",
    group: "Accounts",
    params: ["period"],
    async run(tx, p) {
      const rows = (await movementBetween(tx, p.from, p.to)) as unknown as AccountMovement[];
      const columns: Col[] = [
        { key: "section", label: "", type: "text" },
        { key: "code", label: "Code", type: "text" },
        { key: "name", label: "Account", type: "text" },
        { key: "amount", label: "Amount (₹)", type: "money" },
      ];
      // income sits as a credit and expense as a debit; both are shown as the positive number
      // a person expects to read, and the sign is handled once, here.
      const income = rows.filter((r) => r.account_type === "INCOME" && paise(r.movement_inr) !== 0);
      const expense = rows.filter((r) => r.account_type === "EXPENSE" && paise(r.movement_inr) !== 0);
      const earned = income.reduce((a, r) => a - paise(r.movement_inr), 0);
      const spent = expense.reduce((a, r) => a + paise(r.movement_inr), 0);
      const profit = earned - spent;

      const out: Row[] = [];
      out.push({ section: "Earned", code: null, name: null, amount: null });
      for (const r of income) out.push({ section: "", code: r.code, name: r.name, amount: rupees(-paise(r.movement_inr)) });
      out.push({ section: "", code: null, name: "Total earned", amount: rupees(earned) });
      out.push({ section: "Spent", code: null, name: null, amount: null });
      for (const r of expense) out.push({ section: "", code: r.code, name: r.name, amount: rupees(paise(r.movement_inr)) });
      out.push({ section: "", code: null, name: "Total spent", amount: rupees(spent) });

      const totals: Row = { section: profit < 0 ? "Loss for the period" : "Profit for the period", code: null, name: null, amount: rupees(profit) };
      const margin = income.find((r) => r.code === "FX-MARGIN");
      return {
        columns, rows: out, totals,
        chart: income.length > 1 ? { label: "name", value: "amount", title: "Where the money came from" } : undefined,
        note: margin
          ? `${formatINR(rupees(-paise(margin.movement_inr)))} of the earnings is deal margin — the gap between what clients were billed and what the currency cost.`
          : "No deal margin in this period.",
      };
    },
  },

  balancesheet: {
    title: "Balance sheet",
    description: "What the company holds and what it owes on one date, with the profit that ties the two together.",
    icon: "fa-scale-balanced",
    group: "Accounts",
    params: ["period"],
    async run(tx, p) {
      const rows = (await balancesUpTo(tx, p.to)) as unknown as AccountBalance[];
      const columns: Col[] = [
        { key: "section", label: "", type: "text" },
        { key: "code", label: "Code", type: "text" },
        { key: "name", label: "Account", type: "text" },
        { key: "amount", label: "Amount (₹)", type: "money" },
      ];
      const of = (type: string) => rows.filter((r) => r.account_type === type && paise(r.balance_inr) !== 0);
      const assets = of("ASSET");
      const liabilities = of("LIABILITY");
      const equity = of("EQUITY");

      const totalAssets = assets.reduce((a, r) => a + paise(r.balance_inr), 0);
      const totalLiabilities = liabilities.reduce((a, r) => a - paise(r.balance_inr), 0);
      const totalEquity = equity.reduce((a, r) => a - paise(r.balance_inr), 0);
      // everything earned and spent since the books opened, which is the company's own money too
      const retained = rows
        .filter((r) => r.account_type === "INCOME" || r.account_type === "EXPENSE")
        .reduce((a, r) => a - paise(r.balance_inr), 0);

      const out: Row[] = [];
      const section = (label: string, list: AccountBalance[], sign: 1 | -1, total: number) => {
        out.push({ section: label, code: null, name: null, amount: null });
        for (const r of list) out.push({ section: "", code: r.code, name: r.name, amount: rupees(sign * paise(r.balance_inr)) });
        out.push({ section: "", code: null, name: `Total ${label.toLowerCase()}`, amount: rupees(total) });
      };
      section("Holdings", assets, 1, totalAssets);
      section("Owed to others", liabilities, -1, totalLiabilities);
      out.push({ section: "The company's own", code: null, name: null, amount: null });
      for (const r of equity) out.push({ section: "", code: r.code, name: r.name, amount: rupees(-paise(r.balance_inr)) });
      out.push({ section: "", code: null, name: retained < 0 ? "Losses so far" : "Profit so far", amount: rupees(retained) });
      out.push({ section: "", code: null, name: "Total the company's own", amount: rupees(totalEquity + retained) });

      const right = totalLiabilities + totalEquity + retained;
      const balanced = totalAssets === right;
      return {
        columns, rows: out,
        totals: { section: "Holdings − what is owed", code: null, name: null, amount: rupees(totalAssets - totalLiabilities) },
        note: balanced
          ? `What the company holds (${formatINR(rupees(totalAssets))}) equals what it owes plus what is its own (${formatINR(rupees(right))}). The books are square.`
          : `OUT OF BALANCE: holdings ${formatINR(rupees(totalAssets))} against ${formatINR(rupees(right))}. Check the latest vouchers.`,
      };
    },
  },

  currencyposition: {
    title: "Currency position",
    description: "What the company holds in every currency, its carrying value in rupees and the rate behind it.",
    icon: "fa-coins",
    group: "Accounts",
    params: ["period"],
    async run(tx, p) {
      const rows = (await balancesUpTo(tx, p.to)) as unknown as { code: string; name: string; account_group: string; currency_code: string; balance_fx: string; balance_inr: string }[];
      const columns: Col[] = [
        { key: "currency", label: "Currency", type: "text" },
        { key: "account", label: "Account", type: "text" },
        { key: "held", label: "Held", type: "qty" }, // never totalled — EUR and USD do not add up
        { key: "value", label: "Value (₹)", type: "money", total: true },
        { key: "rate", label: "Carrying rate", type: "rate" },
      ];
      const out: Row[] = rows
        .filter((r) => r.account_group === "CASH_BANK")
        .map((r) => ({
          currency: (r.currency_code ?? "").trim(),
          account: r.name,
          held: Number(r.balance_fx).toFixed(2),
          value: Number(r.balance_inr).toFixed(2),
          rate: Number(r.balance_fx) ? (Number(r.balance_inr) / Number(r.balance_fx)).toFixed(6) : null,
        }));
      return { columns, rows: out, totals: sumRows(out, columns, "Total"), chart: { label: "currency", value: "value", title: "Value held by currency" } };
    },
  },

  // ---------------------------------------------------------------- Parties
  partybalances: {
    title: "Party balances",
    description: "What every client owes us, what we owe every depositor, and the currency still to be delivered.",
    icon: "fa-users",
    group: "Parties",
    params: ["period", "q"],
    async run(tx, p) {
      // A party is listed when ANY of the three columns is open. Netting them first would hide
      // a client who owes us rupees and is owed the same value in currency — the commonest case.
      const rows = await tx<{ party_code: string; full_name: string; kind: string; receivable: string; payable: string; currency_due: string }[]>`
        select * from (
          select pa.party_code, pa.full_name,
                 case when pa.is_depositor and pa.is_client then 'Depositor & client'
                      when pa.is_depositor then 'Depositor' else 'Client' end as kind,
                 coalesce(sum(case when a.account_group = 'RECEIVABLE'
                                   then (case when l.dc = 'D' then l.inr_amount else -l.inr_amount end) end), 0) as receivable,
                 coalesce(-sum(case when a.account_group = 'PAYABLE'
                                   then (case when l.dc = 'D' then l.inr_amount else -l.inr_amount end) end), 0) as payable,
                 coalesce(-sum(case when a.account_group = 'CURRENCY_PAYABLE'
                                   then (case when l.dc = 'D' then l.inr_amount else -l.inr_amount end) end), 0) as currency_due
            from ex.party pa
            left join ex.voucher_line l on l.party_id = pa.id
            left join ex.voucher v on v.id = l.voucher_id and v.voucher_date <= ${p.to}::date
            left join ex.account a on a.id = l.account_id
           where (l.id is null or v.id is not null)
             and (${p.q}::text is null or pa.full_name ilike ${p.q ? `%${p.q}%` : null} or pa.party_code ilike ${p.q ? `%${p.q}%` : null})
           group by pa.id, pa.party_code, pa.full_name, pa.is_depositor, pa.is_client
        ) b
         where receivable <> 0 or payable <> 0 or currency_due <> 0
         order by full_name`;
      const columns: Col[] = [
        { key: "code", label: "Code", type: "text" },
        { key: "name", label: "Party", type: "text" },
        { key: "kind", label: "Type", type: "text" },
        { key: "receivable", label: "Owes us (₹)", type: "money", total: true },
        { key: "payable", label: "We owe (₹)", type: "money", total: true },
        { key: "currency_due", label: "Currency to deliver (₹)", type: "money", total: true },
      ];
      const out: Row[] = rows.map((r) => ({
        code: r.party_code, name: r.full_name, kind: r.kind,
        receivable: r.receivable, payable: r.payable, currency_due: r.currency_due,
      }));
      return { columns, rows: out, totals: sumRows(out, columns, "Total") };
    },
  },

  clientsummary: {
    title: "Client summary",
    description: "Every client on both tracks: rupees they owe us, and the value of the currency we still owe them.",
    icon: "fa-user-tie",
    group: "Parties",
    params: ["q"],
    async run(tx, p) {
      const like = p.q ? `%${p.q}%` : null;
      const rows = await tx<{
        party_code: string; full_name: string; deal_count: number; total_billed: string; total_margin: string;
        receivable_inr: string; currency_payable_inr: string; last_deal: string | null;
      }[]>`
        select party_code, full_name, deal_count::int as deal_count, total_billed, total_margin,
               receivable_inr, currency_payable_inr, last_deal
          from ex.v_client_summary
         where ${like}::text is null or full_name ilike ${like} or party_code ilike ${like}
         order by receivable_inr desc, full_name`;
      const columns: Col[] = [
        { key: "code", label: "Code", type: "text" },
        { key: "name", label: "Client", type: "text" },
        { key: "deals", label: "Deals", type: "int", total: true },
        { key: "billed", label: "Billed (₹)", type: "money", total: true },
        { key: "margin", label: "Margin earned (₹)", type: "money", total: true },
        { key: "owes", label: "Owes us (₹)", type: "money", total: true },
        { key: "currency", label: "Currency we owe (₹)", type: "money", total: true },
        { key: "last", label: "Last deal", type: "date" },
      ];
      const out: Row[] = rows.map((r) => ({
        code: r.party_code, name: r.full_name, deals: r.deal_count,
        billed: Number(r.total_billed).toFixed(2), margin: Number(r.total_margin).toFixed(2),
        owes: Number(r.receivable_inr).toFixed(2), currency: Number(r.currency_payable_inr).toFixed(2),
        last: r.last_deal,
      }));
      return {
        columns, rows: out, totals: sumRows(out, columns, "Total"),
        note: "The two debts are never netted — a client can owe us rupees while we owe them currency.",
      };
    },
  },

  ageing: {
    title: "Ageing",
    description: "How long money has been outstanding — clients' rupees, currency still to deliver, and what depositors are waiting for.",
    icon: "fa-hourglass-half",
    group: "Parties",
    params: ["period", "q"],
    async run(tx, p) {
      const like = p.q ? `%${p.q}%` : null;
      const columns: Col[] = [
        { key: "track", label: "What", type: "text" },
        { key: "code", label: "Code", type: "text" },
        { key: "name", label: "Party", type: "text" },
        ...BUCKETS.map((b) => ({ key: b.key, label: b.label, type: "money" as const, total: true })),
        { key: "total", label: "Total (₹)", type: "money", total: true },
        { key: "oldest", label: "Oldest", type: "int" },
        { key: "advance", label: "Paid ahead (₹)", type: "money", total: true },
      ];

      // each track ages on its own: a client can be behind on rupees and owed currency at once
      const tracks = [
        { label: "Client owes us", group: "RECEIVABLE", sign: 1 as const },
        { label: "We owe currency", group: "CURRENCY_PAYABLE", sign: -1 as const },
        { label: "We owe depositor", group: "PAYABLE", sign: -1 as const },
      ];
      const out: Row[] = [];
      for (const t of tracks) {
        const lines = await tx<AgeingLine[]>`
          select l.party_id, pa.party_code, pa.full_name, to_char(v.voucher_date, 'YYYY-MM-DD') as date,
                 greatest(${t.sign}::numeric * (case when l.dc = 'D' then l.inr_amount else -l.inr_amount end), 0)::text as up,
                 greatest(${t.sign}::numeric * (case when l.dc = 'C' then l.inr_amount else -l.inr_amount end), 0)::text as down
            from ex.voucher_line l
            join ex.voucher v on v.id = l.voucher_id
            join ex.account a on a.id = l.account_id and a.account_group = ${t.group}
            join ex.party pa on pa.id = l.party_id
           where v.voucher_date <= ${p.to}::date
             and (${like}::text is null or pa.full_name ilike ${like} or pa.party_code ilike ${like})
           order by v.voucher_date, v.id, l.line_no`;
        for (const r of ageByFifo(lines, p.to)) {
          out.push({
            track: t.label, code: r.code, name: r.name,
            b0: rupees(r.b0), b31: rupees(r.b31), b61: rupees(r.b61), b90: rupees(r.b90),
            total: rupees(r.total), oldest: r.total > 0 ? r.oldest : null,
            advance: r.advance > 0 ? rupees(r.advance) : null,
          });
        }
      }

      const over90 = out.reduce((a, r) => a + paise(String(r.b90 ?? 0)), 0);
      return {
        columns, rows: out, totals: sumRows(out, columns, "Total"),
        note: over90 > 0
          ? `${formatINR(rupees(over90))} has been outstanding for more than 90 days. Money received settles the oldest bill first, so these are genuinely old.`
          : "Nothing has been outstanding for more than 90 days.",
      };
    },
  },

  clientstatement: {
    title: "Client statement",
    description: "One client's account on both tracks: the rupees they owe us, and the currency we owe them.",
    icon: "fa-file-invoice-dollar",
    group: "Parties",
    params: ["period", "party"],
    async run(tx, p) {
      const columns: Col[] = [
        { key: "voucher", label: "Voucher", type: "text" },
        { key: "date", label: "Date", type: "date" },
        { key: "track", label: "Track", type: "text" },
        { key: "what", label: "What happened", type: "text" },
        { key: "currency", label: "Currency", type: "text" },
        { key: "amount", label: "Amount", type: "qty" },   // two currencies in one column: never totalled
        { key: "rate", label: "Rate", type: "rate" },
        { key: "up", label: "Debt up (₹)", type: "money", total: true },
        { key: "down", label: "Debt down (₹)", type: "money", total: true },
        { key: "balance", label: "Balance (₹)", type: "money" },
      ];
      if (!p.party) return { columns, rows: [], totals: null, note: "Choose a client to see their statement." };
      const [who] = await tx<{ full_name: string }[]>`
        select full_name from ex.party where id = ${p.party} and is_client`;
      if (!who) return { columns, rows: [], totals: null, note: "That party is not a client." };

      const WHAT: Record<string, string> = {
        OPENING: "Balance brought forward", DEAL: "Deal booked", PAYOUT: "Currency handed over",
        RECEIPT: "Rupees received", REVERSAL: "Reversal", JOURNAL: "Adjustment",
      };
      const out: Row[] = [];
      let totalUp = 0;
      let totalDown = 0;

      // Receivable rises on a debit; currency payable rises on a credit. Both are shown as a debt
      // going up or coming down, so the client reads one idea twice instead of two conventions.
      for (const [group, track, sign] of [["RECEIVABLE", "Rupees they owe", 1], ["CURRENCY_PAYABLE", "Currency we owe", -1]] as const) {
        const [{ b: opening }] = await tx<{ b: string }[]>`
          select coalesce(${sign} * sum(case when l.dc = 'D' then l.inr_amount else -l.inr_amount end), 0)::text as b
            from ex.voucher_line l
            join ex.voucher v on v.id = l.voucher_id
            join ex.account a on a.id = l.account_id and a.account_group = ${group}
           where l.party_id = ${p.party} and v.voucher_date < ${p.from}::date`;
        const lines = await tx<{
          voucher_no: string; date: string; voucher_type: string; narration: string | null;
          currency_code: string; fx_amount: string; manual_rate: string; debit: string; credit: string;
        }[]>`
          select v.voucher_no, to_char(v.voucher_date, 'YYYY-MM-DD') as date, v.voucher_type, v.narration,
                 trim(l.currency_code) as currency_code, l.fx_amount::text, l.manual_rate::text,
                 (case when l.dc = 'D' then l.inr_amount else 0 end)::text as debit,
                 (case when l.dc = 'C' then l.inr_amount else 0 end)::text as credit
            from ex.voucher_line l
            join ex.voucher v on v.id = l.voucher_id
            join ex.account a on a.id = l.account_id and a.account_group = ${group}
           where l.party_id = ${p.party} and v.voucher_date between ${p.from}::date and ${p.to}::date
           order by v.voucher_date, v.id, l.line_no`;

        let acc = Math.round(Number(opening) * 100);
        out.push({ voucher: "", date: p.from, track, what: "Opening balance", currency: null, amount: null,
                   rate: null, up: null, down: null, balance: (acc / 100).toFixed(2) });
        for (const l of lines) {
          const move = sign * (Math.round(Number(l.debit) * 100) - Math.round(Number(l.credit) * 100));
          acc += move;
          const up = move > 0 ? move / 100 : 0;
          const down = move < 0 ? -move / 100 : 0;
          totalUp += up;
          totalDown += down;
          out.push({
            voucher: l.voucher_no, date: l.date, track,
            what: l.narration || WHAT[l.voucher_type] || l.voucher_type,
            currency: l.currency_code, amount: Number(l.fx_amount).toFixed(2),
            rate: Number(l.manual_rate).toFixed(6),
            up: up ? up.toFixed(2) : "0.00", down: down ? down.toFixed(2) : "0.00",
            balance: (acc / 100).toFixed(2),
          });
        }
      }

      const totals: Row = { voucher: "Total", date: null, track: null, what: null, currency: null,
                            amount: null, rate: null, up: totalUp.toFixed(2), down: totalDown.toFixed(2), balance: null };
      const closing = out.filter((r) => r.track === "Rupees they owe").at(-1)?.balance ?? "0.00";
      const closingCur = out.filter((r) => r.track === "Currency we owe").at(-1)?.balance ?? "0.00";
      return {
        columns, rows: out, totals,
        note: `${who.full_name} · owes us ${formatINR(closing)} · we owe them currency worth ${formatINR(closingCur)}. The two are never netted.`,
      };
    },
  },

  currencydue: {
    title: "Currency to deliver",
    description: "Currency promised to clients and not yet handed over, per client and per currency.",
    icon: "fa-hand-holding",
    group: "Parties",
    params: ["q"],
    async run(tx, p) {
      const like = p.q ? `%${p.q}%` : null;
      const rows = await tx<{ party_code: string; full_name: string; currency_code: string; fx_due: string; inr_value: string }[]>`
        select party_code, full_name, currency_code, fx_due, inr_value
          from ex.v_currency_due
         where ${like}::text is null or full_name ilike ${like} or party_code ilike ${like}
         order by full_name, currency_code`;
      const columns: Col[] = [
        { key: "code", label: "Code", type: "text" },
        { key: "name", label: "Client", type: "text" },
        { key: "currency", label: "Currency", type: "text" },
        { key: "due", label: "Still to deliver", type: "qty" }, // currencies never add up
        { key: "value", label: "Booked value (₹)", type: "money", total: true },
      ];
      const out: Row[] = rows.map((r) => ({
        code: r.party_code, name: r.full_name, currency: r.currency_code,
        due: Number(r.fx_due).toFixed(2), value: Number(r.inr_value).toFixed(2),
      }));
      return { columns, rows: out, totals: sumRows(out, columns, "Total") };
    },
  },

  cycles: {
    title: "Where each depositor's money is",
    description: "The loop, one line per depositor: how much came in, how much is dealt out, how much clients have paid back, how much has gone home — and whether the cycle has closed.",
    icon: "fa-rotate",
    group: "Parties",
    params: ["q"],
    async run(tx, p) {
      const like = p.q ? `%${p.q}%` : null;
      const rows = await tx<{
        party_id: string; party_code: string; full_name: string; currency: string; status: string;
        deposited_fx: string; dealt_fx: string; unspent_fx: string; billed_inr: string; collected_inr: string;
        uncollected_inr: string; settled_fx: string; owed_fx: string; earned_inr: string;
      }[]>`
        select party_id, party_code, full_name, trim(currency) as currency, status,
               deposited_fx, dealt_fx, unspent_fx, billed_inr, collected_inr, uncollected_inr,
               settled_fx, owed_fx, earned_inr
          from ex.v_depositor_cycle
         where ${like}::text is null or full_name ilike ${like} or party_code ilike ${like}
         order by (status = 'OPEN') desc, owed_fx desc, full_name`;
      const cur = rows[0]?.currency ?? "";
      const columns: Col[] = [
        { key: "code", label: "Code", type: "text" },
        { key: "name", label: "Depositor", type: "text" },
        { key: "status", label: "Cycle", type: "text" },
        { key: "deposited", label: `In (${cur})`, type: "qty" },
        { key: "unspent", label: `Unspent (${cur})`, type: "qty" },
        { key: "billed", label: "Billed to clients (₹)", type: "money", total: true },
        { key: "uncollected", label: "Clients still owe (₹)", type: "money", total: true },
        { key: "settled", label: `Settled (${cur})`, type: "qty" },
        { key: "owed", label: `Still owed (${cur})`, type: "qty" },
        { key: "earned", label: "Earned so far (₹)", type: "money", total: true },
      ];
      // partyId and currency ride along for the phone's dashboard; they are not columns.
      const out: Row[] = rows.map((r) => ({
        partyId: String(r.party_id), currency: r.currency,
        code: r.party_code, name: r.full_name,
        status: r.status === "CLOSED" ? "Closed" : r.status === "OPEN" ? "Open" : "—",
        deposited: Number(r.deposited_fx).toFixed(2), unspent: Number(r.unspent_fx) ? Number(r.unspent_fx).toFixed(2) : null,
        billed: Number(r.billed_inr).toFixed(2), uncollected: Number(r.uncollected_inr).toFixed(2),
        settled: Number(r.settled_fx) ? Number(r.settled_fx).toFixed(2) : null,
        owed: Number(r.owed_fx) ? Number(r.owed_fx).toFixed(2) : null,
        earned: Number(r.earned_inr).toFixed(2),
      }));
      return {
        columns, rows: out, totals: sumRows(out, columns, "Total"),
        note: "A cycle is closed when nothing is unspent, every rupee billed on that depositor's deals has been collected, and nothing is still owed to them. "
            + "Receipts settle a client's oldest bill first, so \"clients still owe\" is each depositor's share of what is genuinely outstanding, not a guess. "
            + "\"Earned so far\" becomes final when the cycle closes.",
      };
    },
  },

  depositorprofit: {
    title: "What each depositor has earned us",
    description: "The margin on deals their money funded, and the gain or loss on the rate between taking it and paying for it.",
    icon: "fa-hand-holding-dollar",
    group: "Parties",
    params: ["q"],
    async run(tx, p) {
      const like = p.q ? `%${p.q}%` : null;
      const rows = await tx<{
        party_code: string; full_name: string; funded_deals: number; currency_dealt: string;
        cost_of_that: string; dealing_margin: string; rate_gain: string; total_earned: string;
      }[]>`
        select party_code, full_name, funded_deals::int as funded_deals, currency_dealt,
               cost_of_that, dealing_margin, rate_gain, total_earned
          from ex.v_depositor_profit
         where ${like}::text is null or full_name ilike ${like} or party_code ilike ${like}
         order by total_earned desc, full_name`;
      const columns: Col[] = [
        { key: "code", label: "Code", type: "text" },
        { key: "name", label: "Depositor", type: "text" },
        { key: "deals", label: "Deals funded", type: "int", total: true },
        { key: "dealt", label: "Currency dealt", type: "qty" },
        { key: "cost", label: "What it cost (₹)", type: "money", total: true },
        { key: "margin", label: "Dealing margin (₹)", type: "money", total: true },
        { key: "rate", label: "On the rate (₹)", type: "money", total: true },
        { key: "earned", label: "Earned altogether (₹)", type: "money", total: true },
      ];
      const out: Row[] = rows.map((r) => ({
        code: r.party_code, name: r.full_name, deals: r.funded_deals,
        dealt: Number(r.currency_dealt) ? Number(r.currency_dealt).toFixed(2) : null,
        cost: Number(r.cost_of_that).toFixed(2), margin: Number(r.dealing_margin).toFixed(2),
        rate: Number(r.rate_gain).toFixed(2), earned: Number(r.total_earned).toFixed(2),
      }));
      return {
        columns, rows: out, totals: sumRows(out, columns, "Total"),
        chart: out.length > 1 ? { label: "name", value: "earned", title: "Earned by depositor" } : undefined,
        note: "Dealing margin is each deal's margin split across the deposits that funded it, in proportion to what each one cost — so this column adds up to the company's own margin exactly. "
            + "A depositor whose money has not been dealt yet has earned nothing yet, which is not the same as nothing to earn. "
            + "“On the rate” is the gain or loss between what the promise was carried at and what it cost to settle.",
      };
    },
  },

  depositorsummary: {
    title: "Depositor summary",
    description: "One line per depositor: currency brought in, what it cost, what has been paid back and what is still owed.",
    icon: "fa-hand-holding-dollar",
    group: "Parties",
    params: ["q"],
    async run(tx, p) {
      const like = p.q ? `%${p.q}%` : null;
      const rows = await tx<{
        party_code: string; full_name: string; deposit_count: number; currency_brought_in: string;
        value_brought_in: string; average_rate: string | null; total_settled: string; outstanding_inr: string;
        outstanding_fx: string; outstanding_currency: string | null; last_deposit: string | null;
      }[]>`
        select party_code, full_name, deposit_count::int as deposit_count, currency_brought_in, value_brought_in,
               average_rate, total_settled, outstanding_inr, outstanding_fx, outstanding_currency, last_deposit
          from ex.v_depositor_summary
         where ${like}::text is null or full_name ilike ${like} or party_code ilike ${like}
         order by outstanding_inr desc, full_name`;
      const columns: Col[] = [
        { key: "code", label: "Code", type: "text" },
        { key: "name", label: "Depositor", type: "text" },
        { key: "deposits", label: "Deposits", type: "int", total: true },
        { key: "brought", label: "Currency in", type: "qty" }, // one currency per desk, but never totalled blindly
        { key: "value", label: "Value (₹)", type: "money", total: true },
        { key: "rate", label: "Average rate", type: "rate" },
        { key: "settled", label: "Paid back (₹)", type: "money", total: true },
        { key: "owed_fx", label: "Still owed", type: "qty" },   // currency, never totalled blindly
        { key: "outstanding", label: "Carried at (₹)", type: "money", total: true },
        { key: "last", label: "Last deposit", type: "date" },
      ];
      const out: Row[] = rows.map((r) => ({
        code: r.party_code, name: r.full_name, deposits: r.deposit_count,
        brought: Number(r.currency_brought_in).toFixed(2), value: Number(r.value_brought_in).toFixed(2),
        rate: r.average_rate ? Number(r.average_rate).toFixed(6) : null,
        settled: Number(r.total_settled).toFixed(2),
        owed_fx: Number(r.outstanding_fx) ? Number(r.outstanding_fx).toFixed(2) : null,
        outstanding: Number(r.outstanding_inr).toFixed(2),
        last: r.last_deposit,
      }));
      return {
        columns, rows: out, totals: sumRows(out, columns, "Total"),
        chart: { label: "name", value: "outstanding", title: "Still owed by depositor" },
        note: "A depositor is owed currency, not rupees. “Carried at” is what that promise stands at in the books — what it will actually cost is the rate agreed on the day it is settled.",
      };
    },
  },

  depositorstatement: {
    title: "Depositor statement",
    description: "One depositor's account: every deposit and every payment, with the balance after each line.",
    icon: "fa-file-invoice-dollar",
    group: "Parties",
    params: ["period", "party"],
    async run(tx, p) {
      const columns: Col[] = [
        { key: "voucher", label: "Voucher", type: "text" },
        { key: "date", label: "Date", type: "date" },
        { key: "what", label: "What happened", type: "text" },
        { key: "reference", label: "Reference", type: "text" },
        { key: "paid", label: "Paid to them (₹)", type: "money", total: true },
        { key: "owed", label: "Owed to them (₹)", type: "money", total: true },
        { key: "balance", label: "Balance (₹)", type: "money" },
      ];
      if (!p.party) {
        return { columns, rows: [], totals: null, note: "Choose a depositor to see their statement." };
      }
      const [who] = await tx<{ full_name: string }[]>`
        select full_name from ex.party where id = ${p.party} and is_depositor`;
      if (!who) return { columns, rows: [], totals: null, note: "That party is not a depositor." };

      const [{ opening }] = await tx<{ opening: string }[]>`
        select coalesce(-sum(case when l.dc = 'D' then l.inr_amount else -l.inr_amount end), 0)::text as opening
          from ex.voucher_line l
          join ex.voucher v on v.id = l.voucher_id
          join ex.account a on a.id = l.account_id and a.account_group = 'PAYABLE'
         where l.party_id = ${p.party} and v.voucher_date < ${p.from}::date`;

      const lines = await tx<{
        date: string; voucher_no: string; voucher_type: string; narration: string | null;
        reference_no: string | null; debit: string; credit: string;
      }[]>`
        select to_char(v.voucher_date, 'YYYY-MM-DD') as date, v.voucher_no, v.voucher_type, v.narration, v.reference_no,
               (case when l.dc = 'D' then l.inr_amount else 0 end)::text as debit,
               (case when l.dc = 'C' then l.inr_amount else 0 end)::text as credit
          from ex.voucher_line l
          join ex.voucher v on v.id = l.voucher_id
          join ex.account a on a.id = l.account_id and a.account_group = 'PAYABLE'
         where l.party_id = ${p.party} and v.voucher_date between ${p.from}::date and ${p.to}::date
         order by v.voucher_date, v.id, l.line_no`;

      const WHAT: Record<string, string> = {
        OPENING: "Balance brought forward", DEPOSIT: "Currency received from them",
        SETTLEMENT: "Paid to them", REVERSAL: "Reversal", JOURNAL: "Adjustment",
      };
      // running balance in paise so nothing drifts
      let acc = Math.round(Number(opening) * 100);
      const out: Row[] = [{
        date: p.from, voucher: "", what: "Opening balance", reference: null,
        paid: null, owed: null, balance: (acc / 100).toFixed(2),
      }];
      for (const l of lines) {
        acc += Math.round(Number(l.credit) * 100) - Math.round(Number(l.debit) * 100);
        out.push({
          date: l.date, voucher: l.voucher_no,
          what: l.narration || WHAT[l.voucher_type] || l.voucher_type,
          reference: l.reference_no, paid: Number(l.debit).toFixed(2), owed: Number(l.credit).toFixed(2),
          balance: (acc / 100).toFixed(2),
        });
      }
      const totals = sumRows(out, columns, "This period");
      totals.balance = (acc / 100).toFixed(2);
      return {
        columns, rows: out, totals,
        note: `${who.full_name} · closing balance ${formatINR(acc / 100)} still owed to them.`,
      };
    },
  },

  // ---------------------------------------------------------------- Registers
  deposits: {
    title: "Deposit register",
    description: "Every deposit in the period with its rate, its rupee value and how much of it is still unspent.",
    icon: "fa-down-long",
    group: "Registers",
    params: ["period", "q"],
    async run(tx, p) {
      const like = p.q ? `%${p.q}%` : null;
      const rows = await tx<{
        voucher_no: string; deposit_date: string; depositor_name: string; currency_code: string;
        fx_amount: string; manual_rate: string; inr_amount: string; fx_unallocated: string; reference_no: string | null;
      }[]>`
        select d.voucher_no, to_char(d.deposit_date, 'YYYY-MM-DD') as deposit_date, d.depositor_name,
               trim(d.currency_code) as currency_code, d.fx_amount, d.manual_rate, d.inr_amount, d.fx_unallocated,
               v.reference_no
          from ex.v_deposit_status d
          join ex.voucher v on v.id = d.voucher_id
         where d.deposit_date between ${p.from}::date and ${p.to}::date
           and (${like}::text is null or d.depositor_name ilike ${like} or d.voucher_no ilike ${like} or v.reference_no ilike ${like})
         order by d.deposit_date, d.deposit_id`;
      const columns: Col[] = [
        { key: "voucher", label: "Voucher", type: "text" },
        { key: "date", label: "Date", type: "date" },
        { key: "depositor", label: "Depositor", type: "text" },
        { key: "currency", label: "Currency", type: "text" },
        { key: "amount", label: "Amount", type: "qty", total: true },
        { key: "rate", label: "Rate", type: "rate" },
        { key: "value", label: "Value (₹)", type: "money", total: true },
        { key: "unspent", label: "Still unspent", type: "qty", total: true },
        { key: "reference", label: "Reference", type: "text" },
      ];
      const out: Row[] = rows.map((r) => ({
        date: r.deposit_date, voucher: r.voucher_no, depositor: r.depositor_name, currency: r.currency_code,
        amount: Number(r.fx_amount).toFixed(4), rate: Number(r.manual_rate).toFixed(6),
        value: Number(r.inr_amount).toFixed(2), unspent: Number(r.fx_unallocated).toFixed(2),
        reference: r.reference_no,
      }));
      return { columns, rows: out, totals: sumRows(out, columns, "Total") };
    },
  },

  deals: {
    title: "Deal register",
    description: "Every deal in the period: what the client got, what they were billed, what it cost and the margin.",
    icon: "fa-right-left",
    group: "Registers",
    params: ["period", "cur", "q"],
    async run(tx, p) {
      const like = p.q ? `%${p.q}%` : null;
      const rows = await tx<{
        voucher_no: string; deal_date: string; client_name: string; fx_currency: string; fx_amount: string;
        fx_to_inr_rate: string; billed_inr: string; src_amount: string; average_cost_rate: string | null;
        src_cost_inr: string; margin_inr: string; margin_pct: string | null;
      }[]>`
        select voucher_no, to_char(deal_date, 'YYYY-MM-DD') as deal_date, client_name,
               trim(fx_currency) as fx_currency, fx_amount, fx_to_inr_rate, billed_inr,
               src_amount, average_cost_rate, src_cost_inr, margin_inr, margin_pct
          from ex.v_deal_status
         where deal_date between ${p.from}::date and ${p.to}::date
           and (${p.cur}::text is null or trim(fx_currency) = ${p.cur})
           and (${like}::text is null or client_name ilike ${like} or voucher_no ilike ${like} or reference_no ilike ${like})
         order by deal_date, deal_id`;
      const columns: Col[] = [
        { key: "voucher", label: "Voucher", type: "text" },
        { key: "date", label: "Date", type: "date" },
        { key: "client", label: "Client", type: "text" },
        { key: "currency", label: "Currency", type: "text" },
        { key: "given", label: "Given", type: "qty" },   // mixed currencies never add up
        { key: "rate", label: "Billed at", type: "rate" },
        { key: "billed", label: "Billed (₹)", type: "money", total: true },
        { key: "spent", label: "Spent", type: "qty", total: true },   // always the primary currency
        { key: "costrate", label: "Cost rate", type: "rate" },
        { key: "cost", label: "Cost (₹)", type: "money", total: true },
        { key: "margin", label: "Margin (₹)", type: "money", total: true },
        { key: "pct", label: "Margin %", type: "pct" },
      ];
      const out: Row[] = rows.map((r) => ({
        voucher: r.voucher_no, date: r.deal_date, client: r.client_name, currency: r.fx_currency,
        given: Number(r.fx_amount).toFixed(4), rate: Number(r.fx_to_inr_rate).toFixed(6),
        billed: Number(r.billed_inr).toFixed(2), spent: Number(r.src_amount).toFixed(2),
        costrate: r.average_cost_rate ? Number(r.average_cost_rate).toFixed(6) : null,
        cost: Number(r.src_cost_inr).toFixed(2), margin: Number(r.margin_inr).toFixed(2),
        pct: r.margin_pct ? Number(r.margin_pct).toFixed(2) : null,
      }));
      const totals = sumRows(out, columns, "Total");
      const cost = Number(totals.cost ?? 0);
      if (cost > 0) totals.pct = ((Number(totals.margin ?? 0) * 100) / cost).toFixed(2);
      return {
        columns, rows: out, totals,
        chart: { label: "voucher", value: "margin", title: "Margin by deal" },
        note: "Cost is what the primary currency actually cost when it came in, deposit by deposit — not a blended average.",
      };
    },
  },

  payouts: {
    title: "Payout register",
    description: "Currency handed to clients in the period, with what it was carried at.",
    icon: "fa-money-bill-transfer",
    group: "Registers",
    params: ["period", "cur", "q"],
    async run(tx, p) {
      const like = p.q ? `%${p.q}%` : null;
      const rows = await tx<{
        voucher_no: string; voucher_date: string; full_name: string; currency_code: string;
        fx_amount: string; manual_rate: string; inr_amount: string; reference_no: string | null;
      }[]>`
        select v.voucher_no, to_char(v.voucher_date, 'YYYY-MM-DD') as voucher_date, pa.full_name,
               trim(l.currency_code) as currency_code, l.fx_amount::text, l.manual_rate::text,
               l.inr_amount::text, v.reference_no
          from ex.voucher v
          join ex.voucher_line l on l.voucher_id = v.id
          join ex.account a on a.id = l.account_id and a.account_group = 'CURRENCY_PAYABLE'
          join ex.party pa on pa.id = l.party_id
         where v.voucher_type = 'PAYOUT' and v.status = 'POSTED' and l.dc = 'D'
           and v.voucher_date between ${p.from}::date and ${p.to}::date
           and (${p.cur}::text is null or trim(l.currency_code) = ${p.cur})
           and (${like}::text is null or pa.full_name ilike ${like} or v.voucher_no ilike ${like} or v.reference_no ilike ${like})
         order by v.voucher_date, v.id`;
      const columns: Col[] = [
        { key: "voucher", label: "Voucher", type: "text" },
        { key: "date", label: "Date", type: "date" },
        { key: "client", label: "Client", type: "text" },
        { key: "currency", label: "Currency", type: "text" },
        { key: "amount", label: "Handed over", type: "qty" },   // mixed currencies never add up
        { key: "rate", label: "Carried at", type: "rate" },
        { key: "value", label: "Value (₹)", type: "money", total: true },
        { key: "reference", label: "Reference", type: "text" },
      ];
      const out: Row[] = rows.map((r) => ({
        voucher: r.voucher_no, date: r.voucher_date, client: r.full_name, currency: r.currency_code,
        amount: Number(r.fx_amount).toFixed(4), rate: Number(r.manual_rate).toFixed(6),
        value: Number(r.inr_amount).toFixed(2), reference: r.reference_no,
      }));
      return { columns, rows: out, totals: sumRows(out, columns, "Total") };
    },
  },

  receipts: {
    title: "Receipt register",
    description: "Rupees received from clients in the period — the money that settles the depositors.",
    icon: "fa-inbox",
    group: "Registers",
    params: ["period", "q"],
    async run(tx, p) {
      const like = p.q ? `%${p.q}%` : null;
      const rows = await tx<{ voucher_no: string; voucher_date: string; full_name: string | null; reference_no: string | null; narration: string | null; total_inr: string }[]>`
        select v.voucher_no, to_char(v.voucher_date, 'YYYY-MM-DD') as voucher_date, pa.full_name,
               v.reference_no, v.narration, v.total_inr
          from ex.voucher v
          left join ex.party pa on pa.id = v.party_id
         where v.voucher_type = 'RECEIPT' and v.status = 'POSTED'
           and v.voucher_date between ${p.from}::date and ${p.to}::date
           and (${like}::text is null or pa.full_name ilike ${like} or v.voucher_no ilike ${like} or v.reference_no ilike ${like})
         order by v.voucher_date, v.id`;
      const columns: Col[] = [
        { key: "voucher", label: "Voucher", type: "text" },
        { key: "date", label: "Date", type: "date" },
        { key: "client", label: "Client", type: "text" },
        { key: "reference", label: "Reference", type: "text" },
        { key: "narration", label: "Narration", type: "text" },
        { key: "amount", label: "Received (₹)", type: "money", total: true },
      ];
      const out: Row[] = rows.map((r) => ({
        voucher: r.voucher_no, date: r.voucher_date, client: r.full_name, reference: r.reference_no,
        narration: r.narration, amount: Number(r.total_inr).toFixed(2),
      }));
      return { columns, rows: out, totals: sumRows(out, columns, "Total") };
    },
  },

  settlements: {
    title: "Settlement register",
    description: "Every rupee payment made to a depositor in the period.",
    icon: "fa-up-long",
    group: "Registers",
    params: ["period", "q"],
    async run(tx, p) {
      const like = p.q ? `%${p.q}%` : null;
      const rows = await tx<{ voucher_no: string; voucher_date: string; full_name: string; reference_no: string | null; narration: string | null; total_inr: string }[]>`
        select v.voucher_no, to_char(v.voucher_date, 'YYYY-MM-DD') as voucher_date, pa.full_name,
               v.reference_no, v.narration, v.total_inr
          from ex.voucher v
          join ex.party pa on pa.id = v.party_id
         where v.voucher_type = 'SETTLEMENT' and v.status = 'POSTED'
           and v.voucher_date between ${p.from}::date and ${p.to}::date
           and (${like}::text is null or pa.full_name ilike ${like} or v.voucher_no ilike ${like} or v.reference_no ilike ${like})
         order by v.voucher_date, v.id`;
      const columns: Col[] = [
        { key: "voucher", label: "Voucher", type: "text" },
        { key: "date", label: "Date", type: "date" },
        { key: "depositor", label: "Depositor", type: "text" },
        { key: "reference", label: "Reference", type: "text" },
        { key: "narration", label: "Narration", type: "text" },
        { key: "amount", label: "Paid (₹)", type: "money", total: true },
      ];
      const out: Row[] = rows.map((r) => ({
        date: r.voucher_date, voucher: r.voucher_no, depositor: r.full_name,
        reference: r.reference_no, narration: r.narration, amount: Number(r.total_inr).toFixed(2),
      }));
      return { columns, rows: out, totals: sumRows(out, columns, "Total") };
    },
  },

  vouchers: {
    title: "Voucher register",
    description: "Every voucher in the period with its type, party, reference and value.",
    icon: "fa-list-ul",
    group: "Registers",
    params: ["period", "q"],
    async run(tx, p) {
      const like = p.q ? `%${p.q}%` : null;
      const rows = await tx<{ voucher_no: string; voucher_date: string; voucher_type: string; party: string | null; narration: string | null; reference_no: string | null; total_inr: string; status: string }[]>`
        select v.voucher_no, to_char(v.voucher_date, 'YYYY-MM-DD') as voucher_date, v.voucher_type,
               pa.full_name as party, v.narration, v.reference_no, v.total_inr::text, v.status
          from ex.voucher v
          left join ex.party pa on pa.id = v.party_id
         where v.voucher_date between ${p.from}::date and ${p.to}::date
           and (${like}::text is null or v.voucher_no ilike ${like} or pa.full_name ilike ${like} or v.narration ilike ${like} or v.reference_no ilike ${like})
         order by v.voucher_date, v.id`;
      const columns: Col[] = [
        { key: "no", label: "Voucher", type: "text" },
        { key: "date", label: "Date", type: "date" },
        { key: "type", label: "Type", type: "text" },
        { key: "party", label: "Party", type: "text" },
        { key: "narration", label: "Narration", type: "text" },
        { key: "reference", label: "Reference", type: "text" },
        { key: "amount", label: "Amount (₹)", type: "money", total: true },
      ];
      const out: Row[] = rows.map((r) => ({
        no: r.voucher_no, date: r.voucher_date, type: r.voucher_type, party: r.party, narration: r.narration,
        reference: r.reference_no, amount: r.total_inr,
      }));
      return { columns, rows: out, totals: sumRows(out, columns, "Total") };
    },
  },

  journal: {
    title: "Journal (day book)",
    description: "Every debit and credit line in the period — the working paper an auditor asks for.",
    icon: "fa-book",
    group: "Registers",
    params: ["period", "q"],
    async run(tx, p) {
      const like = p.q ? `%${p.q}%` : null;
      const rows = await tx<{ voucher_no: string; voucher_date: string; account: string; party: string | null; currency_code: string; fx_amount: string; manual_rate: string; debit: string; credit: string }[]>`
        select v.voucher_no, to_char(v.voucher_date, 'YYYY-MM-DD') as voucher_date, a.name as account, pa.full_name as party,
               trim(l.currency_code) as currency_code, l.fx_amount::text, l.manual_rate::text,
               (case when l.dc = 'D' then l.inr_amount else 0 end)::text as debit,
               (case when l.dc = 'C' then l.inr_amount else 0 end)::text as credit
          from ex.voucher_line l
          join ex.voucher v on v.id = l.voucher_id
          join ex.account a on a.id = l.account_id
          left join ex.party pa on pa.id = l.party_id
         where v.voucher_date between ${p.from}::date and ${p.to}::date
           and (${like}::text is null or v.voucher_no ilike ${like} or a.name ilike ${like} or pa.full_name ilike ${like})
         order by v.voucher_date, v.id, l.line_no`;
      const columns: Col[] = [
        { key: "no", label: "Voucher", type: "text" },
        { key: "date", label: "Date", type: "date" },
        { key: "account", label: "Account", type: "text" },
        { key: "party", label: "Party", type: "text" },
        { key: "currency", label: "Currency", type: "text" },
        { key: "fx", label: "Amount", type: "qty" }, // never totalled — a column of mixed currencies
        { key: "rate", label: "Rate", type: "rate" },
        { key: "debit", label: "Debit (₹)", type: "money", total: true },
        { key: "credit", label: "Credit (₹)", type: "money", total: true },
      ];
      const out: Row[] = rows.map((r) => ({
        no: r.voucher_no, date: r.voucher_date, account: r.account, party: r.party, currency: r.currency_code,
        fx: r.fx_amount, rate: r.manual_rate, debit: r.debit, credit: r.credit,
      }));
      return { columns, rows: out, totals: sumRows(out, columns, "Total") };
    },
  },
};
