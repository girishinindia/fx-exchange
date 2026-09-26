import { cn } from "@/components/ui";
import { fmtCell, isNegative, isNumeric } from "@/lib/report-format";
import type { ReportResult } from "@/lib/reports";

/** Report table shared by the screen and the print view. */
export function ReportTable({ r, dense = false }: { r: ReportResult; dense?: boolean }) {
  const pad = dense ? "px-2 py-1.5" : "px-4 py-2.5";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead className="bg-sky-50/70 print:bg-slate-100">
          <tr>{r.columns.map((c) => <th key={c.key} className={cn(pad, "text-xs font-semibold uppercase tracking-wide text-slate-500", isNumeric(c) ? "text-right" : "text-left")}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {r.rows.length === 0 && <tr><td colSpan={r.columns.length} className="px-4 py-10 text-center text-slate-500">No data for this period.</td></tr>}
          {r.rows.map((row, i) => (
            <tr key={i} className="border-t border-sky-50">
              {r.columns.map((c) => (
                <td key={c.key} className={cn(pad, isNumeric(c) && "text-right tabular-nums", (c.key === "profit" || c.key === "net" || c.key === "unrealised" || c.type === "pct") && isNegative(row[c.key]) && "text-rose-600")}>
                  {fmtCell(c, row[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {r.totals && r.rows.length > 0 && (
          <tfoot className="bg-sky-50/70 border-t-2 border-sky-100 font-semibold print:bg-slate-100">
            <tr>{r.columns.map((c) => <td key={c.key} className={cn(pad, isNumeric(c) && "text-right tabular-nums")}>{r.totals![c.key] === null ? "" : fmtCell(c, r.totals![c.key])}</td>)}</tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
