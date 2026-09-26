import { cn } from "@/components/ui";
import { formatINR } from "@/lib/money";

/**
 * Small single-measure bar chart (plain HTML): one hue for positive, one for negative values,
 * a zero baseline, a hover tooltip per bar and the value label on the largest bar only.
 * The table below the chart is the accessible data view.
 */
export function BarChart({ data, title, format = "money", height = 180 }: { data: Array<{ label: string; value: number }>; title: string; format?: "money" | "pct"; height?: number }) {
  if (data.length === 0) return null;
  const max = Math.max(0, ...data.map((d) => d.value));
  const min = Math.min(0, ...data.map((d) => d.value));
  const span = max - min || 1;
  const zero = (max / span) * 100; // % from top where the baseline sits
  const fmt = (v: number) => (format === "pct" ? `${v.toFixed(2)}%` : formatINR(v, { decimals: 0 }));
  const peak = data.reduce((a, d) => (Math.abs(d.value) > Math.abs(a.value) ? d : a), data[0]);
  return (
    <figure>
      <figcaption className="text-sm font-semibold text-slate-700 mb-2">{title}</figcaption>
      <div className="relative" style={{ height }} role="img" aria-label={`${title}: ${data.map((d) => `${d.label} ${fmt(d.value)}`).join(", ")}`}>
        <div className="absolute inset-x-0 border-t border-slate-300" style={{ top: `${zero}%` }} />
        <div className="absolute inset-0 flex items-stretch gap-[2px]">
          {data.map((d) => {
            const h = (Math.abs(d.value) / span) * 100;
            const neg = d.value < 0;
            return (
              <div key={d.label} className="group relative flex-1 min-w-0">
                <div
                  className={cn("absolute inset-x-[15%] max-w-10 mx-auto", neg ? "bg-rose-400 rounded-b" : "bg-sky-500 rounded-t", "group-hover:opacity-80")}
                  style={neg ? { top: `${zero}%`, height: `${h}%` } : { bottom: `${100 - zero}%`, height: `${h}%` }}
                />
                {d === peak && d.value !== 0 && (
                  <div className="absolute inset-x-0 text-center text-[10px] font-medium text-slate-600 tabular-nums" style={neg ? { top: `calc(${zero + h}% + 2px)` } : { bottom: `calc(${100 - zero + h}% + 2px)` }}>{fmt(d.value)}</div>
                )}
                <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-2 -translate-y-full hidden group-hover:block z-10 whitespace-nowrap rounded-md bg-slate-900 text-white text-xs px-2 py-1 shadow">
                  {d.label}: <b className="tabular-nums">{fmt(d.value)}</b>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex gap-[2px] mt-1">
        {data.map((d, i) => (
          <div key={d.label} className="flex-1 min-w-0 text-center text-[10px] text-slate-400 truncate">{data.length <= 16 || i % Math.ceil(data.length / 12) === 0 ? d.label : ""}</div>
        ))}
      </div>
    </figure>
  );
}
