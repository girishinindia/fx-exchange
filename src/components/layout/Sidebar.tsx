"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/nav";
import { cn, Icon } from "@/components/ui";

export function Sidebar({ companyName, isAdmin }: { companyName: string; isAdmin: boolean }) {
  const pathname = usePathname();
  const groups = NAV.filter((g) => !g.adminOnly || isAdmin);

  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col bg-white border-r border-sky-100 sticky top-0 h-screen">
      <Link href="/dashboard" className="h-16 flex items-center gap-3 px-5 border-b border-sky-100">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-sky-500 to-sky-700 text-white grid place-items-center shadow">
          <Icon name="fa-coins" />
        </div>
        <div className="min-w-0">
          <div className="font-bold text-slate-900 leading-tight">FX Desk</div>
          <div className="text-[11px] text-slate-500 leading-tight truncate">{companyName}</div>
        </div>
      </Link>

      <nav className="flex-1 overflow-y-auto pb-6">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="px-5 pt-5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {g.title}
              {g.adminOnly && <Icon name="fa-lock" className="text-[9px] ml-1" />}
            </div>
            {g.items
              .map((i) => {
                const active = pathname === i.href || pathname.startsWith(i.href + "/");
                return (
                  <Link
                    key={i.href}
                    href={i.href}
                    className={cn(
                      "flex items-center gap-3 mx-2 px-3 py-2 rounded-lg text-sm",
                      active ? "bg-sky-100 text-sky-800 font-semibold" : "text-slate-600 hover:bg-sky-50 hover:text-sky-700",
                    )}
                  >
                    <Icon name={i.icon} className={cn("w-4 text-center", active ? "text-sky-600" : "text-slate-400")} />
                    <span>{i.label}</span>
                  </Link>
                );
              })}
          </div>
        ))}
      </nav>

      <div className="border-t border-sky-100 p-4 text-xs text-slate-500 flex items-center gap-2">
        <Icon name="fa-circle" className="text-[7px] text-emerald-500" /> Double-entry books
      </div>
    </aside>
  );
}
