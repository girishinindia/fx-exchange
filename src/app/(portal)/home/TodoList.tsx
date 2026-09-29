import Link from "next/link";
import { Icon, cn } from "@/components/ui";
import { formatINR, formatQty } from "@/lib/money";
import type { TodoItem } from "@/server/services/counter";

const STYLE: Record<TodoItem["kind"], { verb: string; icon: string; tone: string; href: (i: TodoItem) => string }> = {
  HAND_OVER: { verb: "Hand over", icon: "fa-money-bill-transfer", tone: "bg-amber-100 text-amber-800 hover:bg-amber-200", href: (i) => `/payouts/new?due=${i.partyId}:${i.currency}` },
  COLLECT:   { verb: "Collect",   icon: "fa-inbox",               tone: "bg-emerald-100 text-emerald-800 hover:bg-emerald-200", href: (i) => `/receipts/new?client=${i.partyId}` },
  PAY:       { verb: "Pay",       icon: "fa-up-long",             tone: "bg-sky-100 text-sky-800 hover:bg-sky-200", href: (i) => `/settlements/new?depositor=${i.partyId}` },
};

/** What is still open, one line per action; the button opens the existing form, pre-filled. */
export function TodoList({ items, compact = false }: { items: TodoItem[]; compact?: boolean }) {
  if (items.length === 0) return null;
  return (
    <ul className="divide-y divide-sky-50">
      {items.map((i, n) => {
        const st = STYLE[i.kind];
        const what = i.kind === "HAND_OVER" ? `hand over ${formatQty(i.fxAmount ?? 0)} ${i.currency}`
          : i.kind === "COLLECT" ? `collect ${formatINR(i.inrAmount, { decimals: 0 })}`
          : `pay ${formatQty(i.fxAmount ?? 0)} ${i.currency}`;
        return (
          <li key={`${i.kind}-${i.partyId}-${i.currency}-${n}`} className={cn("flex items-center justify-between gap-3 px-4", compact ? "py-2" : "py-3")}>
            <div className="min-w-0">
              <Link href={`/parties/${i.partyId}`} className="font-semibold text-slate-800 hover:text-sky-700">{i.partyName}</Link>
              <span className="text-slate-600"> — {what}</span>
              {!compact && <div className="text-xs text-slate-500">
                {i.kind === "HAND_OVER" && `worth ${formatINR(i.inrAmount, { decimals: 0 })}`}
                {i.kind === "PAY" && `carried at ${formatINR(i.inrAmount, { decimals: 0 })}${i.carriedAt ? ` · ${Number(i.carriedAt).toFixed(2)} a ${i.currency}` : ""} — today's rate is typed when you pay`}
                {i.kind === "COLLECT" && "oldest bill first"}
              </div>}
            </div>
            <Link href={st.href(i)} className={cn("shrink-0 rounded-full px-3 py-1 text-xs font-bold", st.tone)}><Icon name={st.icon} className="mr-1" />{st.verb}</Link>
          </li>
        );
      })}
    </ul>
  );
}
