import Link from "next/link";
import { getPermissions } from "@/lib/permissions";
import type { Session } from "@/lib/session";
import { Icon } from "@/components/ui";
import { QuickCreate, type QuickAction } from "@/components/layout/QuickCreate";
import { signOut } from "@/app/actions/auth";
import { ModeSwitch } from "@/components/layout/ModeSwitch";

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * The five entries a desk makes, in the order the money moves through it. `need` is the
 * permission the screen itself asks for, so the menu can never offer a way in that the page
 * will then refuse.
 */
const QUICK: Array<QuickAction & { need: string }> = [
  { href: "/deposits/new",    icon: "fa-down-long",           label: "Deposit",         hint: "A depositor brings currency in",   need: "voucher.create" },
  { href: "/deals/new",       icon: "fa-right-left",          label: "Deal",            hint: "Sell currency to a client",        need: "deal.manage" },
  { href: "/payouts/new",     icon: "fa-money-bill-transfer", label: "Currency payout", hint: "Hand currency over to a client",   need: "voucher.create" },
  { href: "/receipts/new",    icon: "fa-inbox",               label: "Receipt",         hint: "A client pays rupees",             need: "voucher.create" },
  { href: "/settlements/new", icon: "fa-up-long",             label: "Settlement",      hint: "Pay a depositor what is owed",     need: "voucher.create" },
];

export async function Topbar({ session }: { session: Session }) {
  // In preview there is no real user to ask about, so offer nothing rather than guess.
  const perms = session.preview ? new Set<string>() : await getPermissions(session);
  const actions: QuickAction[] = QUICK.filter((a) => perms.has(a.need))
    .map((a): QuickAction => ({ href: a.href, icon: a.icon, label: a.label, hint: a.hint }));

  return (
    <header className="h-16 bg-white border-b border-sky-100 flex items-center gap-4 px-4 lg:px-6 sticky top-0 z-20">
      <form action="/search" role="search" className="relative flex-1 max-w-md">
        <Icon name="fa-magnifying-glass" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" />
        <input
          type="search"
          name="q"
          required
          minLength={2}
          maxLength={60}
          aria-label="Search"
          className="w-full rounded-lg border border-sky-100 bg-sky-50/70 pl-9 pr-3 py-2 text-sm placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-200"
          placeholder="Search voucher no., depositor, client, mobile…"
        />
      </form>
      <div className="ml-auto flex items-center gap-3">
        {session.preview && <span className="rounded-full bg-amber-100 text-amber-800 px-3 py-1 text-xs font-medium">Preview mode (dev only)</span>}
        <ModeSwitch current="full" />
        <QuickCreate actions={actions} />
        <Link href="/profile" className="flex items-center gap-2 pl-2 border-l border-sky-100">
          <div className="h-9 w-9 rounded-full bg-sky-100 text-sky-700 grid place-items-center font-semibold text-sm">{initials(session.userName)}</div>
          <div className="hidden md:block leading-tight">
            <div className="text-sm font-semibold">{session.userName}</div>
            <div className="text-[11px] text-slate-500">{session.userType === "ADMIN" ? "Admin" : "User"}</div>
          </div>
        </Link>
        <form action={signOut}>
          <button type="submit" title="Sign out" className="h-9 w-9 grid place-items-center rounded-lg hover:bg-sky-50 text-slate-500">
            <Icon name="fa-right-from-bracket" />
          </button>
        </form>
      </div>
    </header>
  );
}
