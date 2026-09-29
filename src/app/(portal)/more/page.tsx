import type { Metadata } from "next";
import Link from "next/link";
import { ModeSwitch } from "@/components/layout/ModeSwitch";
import { Card, Icon, Note } from "@/components/ui";
import { NAV } from "@/lib/nav";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "More" };

const WORD: Record<string, string> = {
  "/deposits": "Purchases (deposits)", "/deals": "Sales (deals)", "/payouts": "Hand-overs (currency payouts)",
  "/receipts": "Collections (receipts)", "/settlements": "Payments to depositors (settlements)",
  "/vouchers": "All entries (vouchers)", "/accounts": "Chart of accounts", "/opening": "Opening balance",
};

/**
 * Everything that is not one of the five words — the accountant's desk. The same screens
 * the Full portal has, with the desk's word beside the accountant's.
 */
export default async function MorePage() {
  const s = await requireSession();
  const isAdmin = s.userType === "ADMIN";
  const groups = NAV.filter((g) => !g.adminOnly || isAdmin).filter((g) => g.title !== "Overview" && g.title !== "Parties" && g.title !== "Reports");
  return (
    <div className="space-y-6">
      <Note icon="fa-table-columns">This is the accountant&apos;s desk — every screen of the full portal. Prefer it all the time? Switch this browser to the <b>Full portal</b>: <span className="inline-block align-middle"><ModeSwitch current="simple" /></span></Note>
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => (
          <Card key={g.title} title={g.title === "Daily work" ? "Registers — the day's entries by kind" : g.title} icon={g.title === "Administration" ? "fa-lock" : "fa-folder-open"} padded={false}>
            <ul className="divide-y divide-sky-50">
              {g.items.filter((i) => !i.adminOnly || isAdmin).map((i) => (
                <li key={i.href}>
                  <Link href={i.href} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-sky-50">
                    <Icon name={i.icon} className="w-4 text-center text-slate-400" />
                    <span className="font-medium text-slate-800">{WORD[i.href] ?? i.label}</span>
                    {WORD[i.href] && <span className="text-xs text-slate-400">{i.label}</span>}
                    <Icon name="fa-chevron-right" className="ml-auto text-xs text-slate-300" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
        <Card title="Also" icon="fa-circle-info" padded={false}>
          <ul className="divide-y divide-sky-50">
            <li><Link href="/dashboard" className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-sky-50"><Icon name="fa-gauge-high" className="w-4 text-center text-slate-400" /><span className="font-medium">Full dashboard</span><span className="text-xs text-slate-400">twelve figures, cycles, recent entries</span></Link></li>
            <li><Link href="/profile" className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-sky-50"><Icon name="fa-user" className="w-4 text-center text-slate-400" /><span className="font-medium">Profile · change password · sign out</span></Link></li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
