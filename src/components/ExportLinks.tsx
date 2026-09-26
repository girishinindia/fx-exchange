import { Icon } from "@/components/ui";

/** Excel / CSV / PDF buttons for a list or report (needs the export.data permission — checked by the caller and the route). */
export function ExportLinks({ report, qs }: { report: string; qs: string }) {
  const cls = "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium bg-white hover:bg-sky-50 text-slate-700 border border-sky-200";
  return (
    <div className="flex gap-1.5">
      <a href={`/api/export/${report}?${qs}&format=xlsx`} className={cls} title="Download Excel"><Icon name="fa-file-excel" className="text-emerald-600" />Excel</a>
      <a href={`/api/export/${report}?${qs}&format=csv`} className={cls} title="Download CSV"><Icon name="fa-file-csv" className="text-sky-600" />CSV</a>
      <a href={`/print/${report}?${qs}`} target="_blank" className={cls} title="Print or save as PDF"><Icon name="fa-file-pdf" className="text-rose-600" />PDF</a>
    </div>
  );
}
