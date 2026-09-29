"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn, Icon } from "@/components/ui";

/** The Simple portal's five words. `/parties` and `/reports` are the existing screens. */
export const SIMPLE_TABS = [
  { href: "/entry", label: "Entry", icon: "fa-plus", tone: "entry" },
  { href: "/home", label: "Home", icon: "fa-house", tone: "" },
  { href: "/money", label: "Money", icon: "fa-wallet", tone: "" },
  { href: "/parties", label: "People", icon: "fa-users", tone: "" },
  { href: "/reports", label: "Reports", icon: "fa-chart-pie", tone: "" },
] as const;

/**
 * The header of the Simple portal: brand, five tabs, search, "More" for the accountant's
 * desk, and the person. There is no sidebar in Simple mode — everything a desk person
 * needs is one of these five words.
 */
export function SimpleHeader({ companyName, userName, isAdmin, children }: { companyName: string; userName: string; isAdmin: boolean; children?: React.ReactNode }) {
  const pathname = usePathname();
  const active = (href: string) => pathname === href || pathname.startsWith(href + "/");
  return (
    <header className="sticky top-0 z-20 bg-sky-600 text-white shadow">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 lg:px-6">
        <Link href="/home" className="mr-3 hidden items-center gap-2 sm:flex">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-white/15"><Icon name="fa-coins" /></div>
          <div className="leading-tight"><div className="text-sm font-bold">FX Desk</div><div className="max-w-[10rem] truncate text-[11px] text-white/80">{companyName}</div></div>
        </Link>
        <nav className="flex items-center gap-1">
          {SIMPLE_TABS.map((t) => (
            <Link key={t.href} href={t.href}
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold transition",
                active(t.href) ? "bg-white text-sky-700 shadow-sm" : t.tone === "entry" ? "bg-emerald-500/90 text-white hover:bg-emerald-500" : "text-white/85 hover:bg-white/15 hover:text-white",
              )}>
              <Icon name={t.icon} className="text-xs" /><span className="hidden md:inline">{t.label}</span>
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <form action="/search" role="search" className="relative hidden lg:block">
            <Icon name="fa-magnifying-glass" className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-white/70" />
            <input type="search" name="q" required minLength={2} maxLength={60} aria-label="Search" placeholder="Voucher, party, mobile…"
              className="w-56 rounded-full border border-white/25 bg-white/15 py-1.5 pl-8 pr-3 text-sm text-white placeholder:text-white/60 focus:bg-white focus:text-slate-900 focus:placeholder:text-slate-400 focus:outline-none" />
          </form>
          <Link href="/more" className={cn("rounded-full px-3 py-1.5 text-sm font-semibold", active("/more") ? "bg-white text-sky-700" : "text-white/85 hover:bg-white/15")}>
            <Icon name="fa-ellipsis" className="mr-1 text-xs" />{isAdmin ? "More" : "More"}
          </Link>
          {children}
          <Link href="/profile" title={userName} className="grid h-8 w-8 place-items-center rounded-full bg-white/20 text-xs font-bold">
            {userName.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
          </Link>
        </div>
      </div>
    </header>
  );
}
