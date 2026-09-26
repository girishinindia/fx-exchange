import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/** Small UI kit matching the FX Desk design prototype (light-blue / sky theme). */

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function Icon({ name, className }: { name: string; className?: string }) {
  return <i aria-hidden className={cn("fa-solid", name, className)} />;
}

// ------------------------------------------------------------------ Button
type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
const variants: Record<Variant, string> = {
  primary: "bg-sky-600 hover:bg-sky-700 text-white shadow-sm",
  secondary: "bg-white hover:bg-sky-50 text-slate-700 border border-sky-200",
  ghost: "hover:bg-sky-50 text-sky-700",
  danger: "bg-white hover:bg-rose-50 text-rose-600 border border-rose-200",
  success: "bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm",
};
const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300";

type BtnProps = ComponentProps<"button"> & { variant?: Variant; icon?: string };
export function Button({ variant = "primary", icon, className, children, type = "button", ...rest }: BtnProps) {
  return (
    <button type={type} className={cn(btnBase, variants[variant], className)} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

type LinkBtnProps = ComponentProps<typeof Link> & { variant?: Variant; icon?: string };
export function LinkButton({ variant = "primary", icon, className, children, ...rest }: LinkBtnProps) {
  return (
    <Link className={cn(btnBase, variants[variant], className)} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </Link>
  );
}

// ------------------------------------------------------------------ Badge
type Tone = "sky" | "emerald" | "rose" | "amber" | "violet" | "slate";
const tones: Record<Tone, string> = {
  sky: "bg-sky-50 text-sky-700 ring-sky-200",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rose: "bg-rose-50 text-rose-700 ring-rose-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  slate: "bg-slate-50 text-slate-700 ring-slate-200",
};
export function Badge({ tone = "sky", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone])}>{children}</span>;
}

// ------------------------------------------------------------------ Card
export function Card({ title, icon, actions, children, padded = true, className }: { title?: string; icon?: string; actions?: ReactNode; children: ReactNode; padded?: boolean; className?: string }) {
  return (
    <section className={cn("bg-white rounded-xl border border-sky-100 shadow-card", className)}>
      {title && (
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-sky-100">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2">
            {icon && <Icon name={icon} className="text-sky-500" />}
            {title}
          </h2>
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </div>
      )}
      <div className={padded ? "p-5" : undefined}>{children}</div>
    </section>
  );
}

// ------------------------------------------------------------------ Kpi
const kpiTones: Record<Tone, string> = {
  sky: "bg-sky-50 text-sky-600",
  emerald: "bg-emerald-50 text-emerald-600",
  rose: "bg-rose-50 text-rose-600",
  amber: "bg-amber-50 text-amber-600",
  violet: "bg-violet-50 text-violet-600",
  slate: "bg-slate-100 text-slate-600",
};
export function Kpi({ label, value, sub, icon = "fa-circle", tone = "sky" }: { label: string; value: ReactNode; sub?: ReactNode; icon?: string; tone?: Tone }) {
  return (
    <div className="bg-white rounded-xl border border-sky-100 shadow-card p-4">
      <div className="flex items-center gap-3">
        <div className={cn("h-10 w-10 rounded-lg grid place-items-center", kpiTones[tone])}>
          <Icon name={icon} />
        </div>
        <div className="text-sm text-slate-500">{label}</div>
      </div>
      <div className="mt-3 text-2xl font-bold text-slate-900 tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ Note
export function Note({ tone = "sky", icon = "fa-circle-info", children }: { tone?: Tone; icon?: string; children: ReactNode }) {
  const t: Record<Tone, string> = {
    sky: "bg-sky-50 border-sky-200 text-sky-800",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-800",
    rose: "bg-rose-50 border-rose-200 text-rose-800",
    amber: "bg-amber-50 border-amber-200 text-amber-800",
    violet: "bg-violet-50 border-violet-200 text-violet-800",
    slate: "bg-slate-50 border-slate-200 text-slate-700",
  };
  return (
    <div className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", t[tone])}>
      <Icon name={icon} className="mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------ Form fields
export function Field({ label, hint, required, icon, suffix, className, ...input }: ComponentProps<"input"> & { label: string; hint?: ReactNode; icon?: string; suffix?: ReactNode }) {
  return (
    <label className={cn("block", className)}>
      <span className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      <div className="relative mt-1">
        {icon && <Icon name={icon} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" />}
        <input
          required={required}
          className={cn(
            "w-full rounded-lg border border-slate-200 bg-white py-2 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-400 disabled:bg-slate-50",
            icon ? "pl-9" : "pl-3",
          )}
          {...input}
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">{suffix}</span>}
      </div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </label>
  );
}

export function SelectField({ label, hint, required, options, className, ...select }: ComponentProps<"select"> & { label: string; hint?: ReactNode; options: Array<{ value: string; label: string }> }) {
  return (
    <label className={cn("block", className)}>
      <span className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      <select required={required} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300" {...select}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </label>
  );
}

// ------------------------------------------------------------------ Table
export type Column<T> = { key: string; header: string; align?: "left" | "right"; render: (row: T) => ReactNode };
export function Table<T>({ columns, rows, rowKey, empty, footer }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string | number; empty?: ReactNode; footer?: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-sky-50/70">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cn("px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap", c.align === "right" ? "text-right" : "text-left")}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-slate-500">
                {empty ?? "Nothing to show yet."}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={rowKey(r)} className="border-t border-sky-50 hover:bg-sky-50/50">
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-4 py-3 whitespace-nowrap", c.align === "right" && "text-right tabular-nums")}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {footer && <tfoot className="bg-sky-50/70 border-t border-sky-100 font-semibold">{footer}</tfoot>}
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ Page header / empty state
export function PageHeader({ title, subtitle, crumbs = [], actions }: { title: string; subtitle?: ReactNode; crumbs?: string[]; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-0">
        {crumbs.length > 0 && <div className="text-xs text-slate-400 mb-1">{crumbs.join("  ›  ")}</div>}
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

export function EmptyState({ icon = "fa-inbox", title, text, action }: { icon?: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="text-center py-10">
      <div className="mx-auto h-12 w-12 rounded-full bg-sky-50 text-sky-500 grid place-items-center">
        <Icon name={icon} />
      </div>
      <div className="mt-3 font-semibold">{title}</div>
      {text && <p className="text-sm text-slate-500 mt-1">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
