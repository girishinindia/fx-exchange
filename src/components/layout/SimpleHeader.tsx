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
 * Two registers the desk opens all day, which were a trip through More. They sit apart from
 * the five words on purpose: those are where the work is done, these are where it is looked
 * up. Both are also still under More, with every other register.
 */
export const SIMPLE_SHORTCUTS = [
  { href: "/vouchers", label: "Vouchers", icon: "fa-receipt", title: "Every entry posted, newest first" },
  { href: "/receipts", label: "Receipts", icon: "fa-hand-holding-dollar", title: "Rupees collected from clients" },
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
        <Link href="/home" className="mr-3 hidden min-w-0 shrink items-center gap-2 sm:flex">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-white/15"><Icon name="fa-coins" /></div>
          <div className="hidden leading-tight xl:block"><div className="whitespace-nowrap text-sm font-bold">FX Desk</div><div className="max-w-[10rem] truncate text-[11px] text-white/80">{companyName}</div></div>
        </Link>
        <nav className="flex shrink-0 items-center gap-1">
          {SIMPLE_TABS.map((t) => (
            <Link key={t.href} href={t.href}
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold transition",
                active(t.href) ? "bg-white text-sky-700 shadow-sm" : t.tone === "entry" ? "bg-emerald-500/90 text-white hover:bg-emerald-500" : "text-white/85 hover:bg-white/15 hover:text-white",
              )}>
              <Icon name={t.icon} className="text-xs" /><span className="hidden md:inline">{t.label}</span>
            </Link>
          ))}

          {/* Shortcuts only where there is room for them. On a narrow screen the five words
              come first and these two stay under More, where they have always been. */}
          <span aria-hidden className="mx-1 hidden h-5 w-px bg-white/25 lg:block" />

          {SIMPLE_SHORTCUTS.map((t) => (
            <Link key={t.href} href={t.href} title={t.title}
              className={cn(
                "hidden items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition lg:flex",
                active(t.href) ? "bg-white text-sky-700 shadow-sm" : "text-white/75 hover:bg-white/15 hover:text-white",
              )}>
              <Icon name={t.icon} className="text-xs" /><span className="hidden xl:inline">{t.label}</span>
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <form action="/search" role="search" className="relative hidden min-w-0 shrink lg:block">
            <Icon name="fa-magnifying-glass" className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-white/70" />
            <input type="search" name="q" required minLength={2} maxLength={60} aria-label="Search" placeholder="Voucher, party, mobile…"
              className="w-full min-w-[7rem] max-w-56 rounded-full border border-white/25 bg-white/15 py-1.5 pl-8 pr-3 text-sm text-white placeholder:text-white/60 focus:bg-white focus:text-slate-900 focus:placeholder:text-slate-400 focus:outline-none" />
          </form>
          <Link href="/more" className={cn("whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold", active("/more") ? "bg-white text-sky-700" : "text-white/85 hover:bg-white/15")}>
            <Icon name="fa-ellipsis" className="text-xs sm:mr-1" /><span className="hidden sm:inline">More</span>
          </Link>
          {/* The portal switch is the accountant's control; on a phone-width browser the five
              words and More are what matter, and the row has no space to spare for it. */}
          <span className="hidden sm:flex">{children}</span>
          <Link href="/profile" title={userName} className="grid h-8 w-8 place-items-center rounded-full bg-white/20 text-xs font-bold">
            {userName.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
          </Link>
        </div>
      </div>
    </header>
  );
}
