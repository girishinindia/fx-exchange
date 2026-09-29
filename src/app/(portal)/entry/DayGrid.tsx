import Link from "next/link";
import { Icon, cn } from "@/components/ui";
import { formatINR, formatQty } from "@/lib/money";
import type { DayCell, DayColumn, DaySheet } from "@/server/services/day";
import { CloseStrip } from "./CloseStrip";

const LINE_TONE: Record<string, string> = {
  Sell: "bg-amber-50 text-amber-800", Buy: "bg-emerald-50 text-emerald-800", "Handed over": "bg-amber-50 text-amber-700",
  Received: "bg-emerald-50 text-emerald-700", Paid: "bg-sky-50 text-sky-800", Expense: "bg-violet-50 text-violet-800",
  "Cash⇄Bank": "bg-sky-50 text-sky-700", Reversed: "bg-rose-50 text-rose-700", Restated: "bg-slate-100 text-slate-700",
  Journal: "bg-slate-100 text-slate-700", Opening: "bg-slate-100 text-slate-700",
};

const cellValue = (c: DayColumn, cell: DayCell | undefined) => (cell ? Number(c.isBase ? cell.inr : cell.fx) : 0);
const show = (c: DayColumn, n: number, opts: { zero?: string; signed?: boolean } = {}) => {
  if (Math.abs(n) < 0.000001) return opts.zero ?? "·";
  const s = c.isBase ? formatINR(Math.abs(n), { decimals: 0, symbol: false }) : formatQty(Math.abs(n));
  return opts.signed ? (n < 0 ? `−${s}` : `+${s}`) : n < 0 ? `−${s}` : s;
};
const head = (c: DayColumn) => (c.isBase ? `₹ ${c.name.replace(/ — .*$/, "")}` : c.currency);

/**
 * The whiteboard. Time · party · line · one column per drawer · rate · remark; opening on top,
 * in / out / closing underneath, then the closing-rate strip where today's rates are typed
 * (in the browser only — nothing is stored) and the stock is valued.
 */
export function DayGrid({ d, canRevalue }: { d: DaySheet; canRevalue: boolean }) {
  const cols = d.columns.filter((c) => c.isBase || Number(d.opening[c.code]?.fx ?? 0) !== 0 || d.rows.some((r) => r.cells[c.code]));
  const num = (c: DayColumn, cell?: DayCell) => cellValue(c, cell);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-[13px]">
        <thead>
          <tr className="border-b-2 border-sky-200 bg-sky-50/70 text-[11px] font-semibold uppercase tracking-wide text-sky-800">
            <th className="px-2 py-2 text-left">Time</th>
            <th className="px-2 py-2 text-left">Party</th>
            <th className="px-2 py-2 text-left">Line</th>
            {cols.map((c) => <th key={c.code} className="px-2 py-2 text-right whitespace-nowrap">{head(c)}</th>)}
            <th className="px-2 py-2 text-right">Rate ₹</th>
            <th className="px-2 py-2 text-left">Remark</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          <tr className="bg-slate-50 font-semibold text-slate-700">
            <td className="px-2 py-2">—</td>
            <td className="px-2 py-2">Opening</td>
            <td className="px-2 py-2 text-slate-500">from the day before</td>
            {cols.map((c) => <td key={c.code} className="px-2 py-2 text-right">{show(c, num(c, d.opening[c.code]), { zero: "0" })}</td>)}
            <td />
            <td className="px-2 py-2 text-xs font-normal text-slate-500">what was in every drawer when the day began — yesterday&rsquo;s closing, nobody copies it</td>
          </tr>
          {d.rows.length === 0 && (
            <tr><td colSpan={cols.length + 5} className="px-3 py-6 text-center text-sm text-slate-500">Nothing on the board yet. The first line you add appears here the moment it is saved.</td></tr>
          )}
          {d.rows.map((r) => (
            <tr key={r.voucherId} className={cn("border-b border-slate-100 hover:bg-sky-50/40", r.status === "REVERSED" && "text-slate-400 line-through decoration-slate-300")}>
              <td className="px-2 py-1.5 text-slate-500">{r.time}</td>
              <td className="px-2 py-1.5 font-semibold text-slate-800">{r.partyId ? <Link href={`/parties/${r.partyId}`} className="hover:text-sky-700">{r.partyName}</Link> : (r.partyName ?? <span className="text-slate-400">—</span>)}</td>
              <td className="px-2 py-1.5"><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", LINE_TONE[r.line] ?? "bg-slate-100 text-slate-700")}>{r.line}</span></td>
              {cols.map((c) => { const n = num(c, r.cells[c.code]); return (
                <td key={c.code} className={cn("px-2 py-1.5 text-right", n > 0 && "font-semibold text-emerald-700", n < 0 && "font-semibold text-rose-700", n === 0 && "text-slate-300")}>{show(c, n, { signed: true })}</td>
              ); })}
              <td className="px-2 py-1.5 text-right text-slate-700">{r.rate ? Number(r.rate).toFixed(2) : ""}</td>
              <td className="max-w-[26rem] px-2 py-1.5 text-xs text-slate-600">
                {r.remark.replace(/ · [A-Z]+\/\d+$/, "")} · <Link href={`/vouchers/${r.voucherId}`} className="font-mono text-sky-700 hover:underline">{r.voucherNo.split("/").slice(-2).join("/")}</Link>
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-sky-200 bg-slate-50 font-semibold text-slate-700">
            <td /><td className="px-2 py-1.5">In today</td><td />
            {cols.map((c) => <td key={c.code} className="px-2 py-1.5 text-right text-emerald-700">{show(c, num(c, d.inflow[c.code]), { zero: "0", signed: true })}</td>)}
            <td /><td />
          </tr>
          <tr className="bg-slate-50 font-semibold text-slate-700">
            <td /><td className="px-2 py-1.5">Out today</td><td />
            {cols.map((c) => <td key={c.code} className="px-2 py-1.5 text-right text-rose-700">{show(c, num(c, d.outflow[c.code]), { zero: "0", signed: true })}</td>)}
            <td /><td />
          </tr>
          <tr className="bg-sky-50 text-[14px] font-extrabold text-slate-900">
            <td /><td className="px-2 py-2">Closing</td><td className="px-2 py-2 text-xs font-normal text-slate-500">what is left</td>
            {cols.map((c) => <td key={c.code} className="px-2 py-2 text-right">{show(c, num(c, d.closing[c.code]), { zero: "0" })}</td>)}
            <td /><td className="px-2 py-2 text-xs font-normal text-slate-500">= opening + in − out, for every column</td>
          </tr>
        </tbody>
      </table>
      <CloseStrip columns={cols} closing={d.closing} day={d.day} date={d.date} canRevalue={canRevalue} />
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-xs text-slate-500">
        <span><Icon name="fa-circle-info" className="mr-1 text-sky-500" />A wrong line is put right by opening its voucher number and pressing <b>Reverse</b>, with a reason — the reversal shows as its own row. Nothing is ever deleted.</span>
        <span>Foreign-currency drawers show units; the rupee drawers show rupees.</span>
      </p>
    </div>
  );
}
