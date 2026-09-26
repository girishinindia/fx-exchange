import { Badge, Icon } from "@/components/ui";
import { formatINR, formatQty } from "@/lib/money";

export type Cycle = {
  currency: string; status: "EMPTY" | "OPEN" | "CLOSED";
  deposit_count: number; deposited_fx: string; deposited_inr: string;
  dealt_fx: string; unspent_fx: string; deal_count: number;
  billed_inr: string; collected_inr: string; uncollected_inr: string;
  settled_fx: string; settled_inr: string; owed_fx: string; owed_inr: string;
  earned_inr: string;
};

const pct = (part: string, whole: string) => {
  const w = Number(whole); if (!(w > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((Number(part) / w) * 100)));
};

/**
 * One depositor's money walking round the loop.
 *
 * Four stages, read left to right, each with a bar for how far it has got. The desk person
 * should be able to answer "where is Mehta's money right now?" from this without opening a
 * single report: some of it is still sitting here, some is out with clients who have not paid,
 * some has come back, and some has gone home.
 */
export function DepositorCycle({ c, name }: { c: Cycle; name: string }) {
  const cur = c.currency.trim();
  const dealtPct = pct(c.dealt_fx, c.deposited_fx);
  const collectedPct = pct(c.collected_inr, c.billed_inr);
  const settledPct = pct(c.settled_fx, c.deposited_fx);

  const stages: Array<{ icon: string; label: string; big: string; small: string; pct: number; tone: string }> = [
    { icon: "fa-down-long", label: "Deposited", pct: c.deposit_count ? 100 : 0, tone: "bg-sky-500",
      big: `${formatQty(c.deposited_fx)} ${cur}`,
      small: `${c.deposit_count} deposit${c.deposit_count === 1 ? "" : "s"} · carried at ${formatINR(c.deposited_inr, { decimals: 0 })}` },
    { icon: "fa-right-left", label: "Dealt to clients", pct: dealtPct, tone: "bg-violet-500",
      big: `${formatQty(c.dealt_fx)} ${cur}`,
      small: Number(c.unspent_fx) > 0 ? `${formatQty(c.unspent_fx)} ${cur} still unspent` : `all of it, on ${c.deal_count} deal${c.deal_count === 1 ? "" : "s"}` },
    { icon: "fa-inbox", label: "Collected from clients", pct: collectedPct, tone: "bg-emerald-500",
      big: formatINR(c.collected_inr, { decimals: 0 }),
      small: Number(c.billed_inr) > 0 ? `of ${formatINR(c.billed_inr, { decimals: 0 })} billed` + (Number(c.uncollected_inr) > 0 ? ` · ${formatINR(c.uncollected_inr, { decimals: 0 })} still to come` : "") : "nothing billed yet" },
    { icon: "fa-up-long", label: "Settled back", pct: settledPct, tone: "bg-amber-500",
      big: `${formatQty(c.settled_fx)} ${cur}`,
      small: Number(c.owed_fx) > 0 ? `${formatQty(c.owed_fx)} ${cur} still owed to ${name}` : `paid in full — ${formatINR(c.settled_inr, { decimals: 0 })}` },
  ];

  return (
    <div>
      <div className="grid gap-3 md:grid-cols-4">
        {stages.map((s, i) => (
          <div key={s.label} className="relative rounded-xl border border-sky-100 bg-white p-4">
            {i > 0 && <Icon name="fa-chevron-right" className="absolute -left-3 top-1/2 hidden -translate-y-1/2 text-slate-300 md:block" />}
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Icon name={s.icon} className="text-slate-400" />{s.label}
            </div>
            <div className="mt-1.5 text-lg font-semibold tabular-nums text-slate-800">{s.big}</div>
            <div className="mt-0.5 text-xs text-slate-500">{s.small}</div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${s.tone}`} style={{ width: `${s.pct}%` }} />
            </div>
            <div className="mt-1 text-right text-[11px] tabular-nums text-slate-400">{s.pct}%</div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        {c.status === "CLOSED" && <Badge tone="emerald">Cycle closed</Badge>}
        {c.status === "OPEN" && <Badge tone="amber">Cycle open</Badge>}
        {c.status === "EMPTY" && <Badge tone="slate">Nothing deposited yet</Badge>}
        <span className="text-slate-600">
          {c.status === "CLOSED"
            ? <>Every {cur} that came in has gone out, every rupee billed has come back, and {name} has been paid in full. The desk made <b>{formatINR(c.earned_inr, { decimals: 0 })}</b> out of it.</>
            : c.status === "OPEN"
            ? <>Earned so far: <b>{formatINR(c.earned_inr, { decimals: 0 })}</b>. It becomes final when the cycle closes.</>
            : <>The cycle starts with a deposit.</>}
        </span>
      </div>
    </div>
  );
}
