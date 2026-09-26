import type { Metadata } from "next";
import Link from "next/link";
import { ModalButton } from "@/components/ModalButton";
import { Badge, Card, Icon, Note, PageHeader } from "@/components/ui";
import { ACCOUNT_GROUPS, ACCOUNT_TYPES } from "@/lib/ledger";
import { formatINR, formatQty } from "@/lib/money";
import { getPermissions } from "@/lib/permissions";
import { requireSession } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { tenantOf } from "@/lib/session";
import { listAccounts } from "@/server/services/accounts";
import { AccountForm } from "./AccountForm";

export const metadata: Metadata = { title: "Chart of accounts" };

export default async function AccountsPage() {
  const s = await requireSession();
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const perms = await getPermissions(s);
  if (!perms.has("voucher.view") && !perms.has("account.manage") && !perms.has("report.view")) {
    return <Note tone="rose">You do not have permission to see the chart of accounts.</Note>;
  }
  const canManage = perms.has("account.manage");
  const accounts = await listAccounts(s);
  const currencies = await withTenant(await tenantOf(s), (tx) =>
    tx<{ code: string }[]>`select trim(currency_code) as code from ex.company_currency where is_active order by currency_code`);

  const byType = Object.keys(ACCOUNT_TYPES).map((t) => ({ type: t as keyof typeof ACCOUNT_TYPES, rows: accounts.filter((a) => a.account_type === t) }));

  return (
    <>
      <PageHeader
        title="Chart of accounts"
        crumbs={["Ledger"]}
        subtitle="Every voucher posts into these accounts. Cash and bank accounts hold one currency each; control accounts carry a balance per party."
        actions={canManage && (
          <ModalButton label="Add account" icon="fa-plus" title="Add an account">
            <AccountForm currencies={currencies.map((c) => c.code)} />
          </ModalButton>
        )}
      />
      {byType.filter((g) => g.rows.length > 0).map((g) => (
        <Card key={g.type} title={ACCOUNT_TYPES[g.type]} icon="fa-folder-open" padded={false}>
          <table className="w-full text-sm">
            <thead className="bg-sky-50/70">
              <tr>{["Code", "Name", "Kind", "Holds", "Balance (₹)", ""].map((h, i) => (
                <th key={h + i} className={`px-4 py-2.5 text-xs font-semibold uppercase text-slate-500 ${i === 4 ? "text-right" : "text-left"}`}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {g.rows.map((a) => (
                <tr key={a.id} className={`border-t border-sky-50 ${a.is_active ? "" : "opacity-60"}`}>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{a.code}</td>
                  <td className="px-4 py-2.5">
                    {perms.has("report.view") ? <Link href={`/reports/journal?q=${encodeURIComponent(a.name)}`} className="text-sky-700">{a.name}</Link> : a.name}
                    {!a.is_active && <span className="ml-2"><Badge tone="slate">Inactive</Badge></span>}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{ACCOUNT_GROUPS[a.account_group as keyof typeof ACCOUNT_GROUPS] ?? a.account_group}{a.is_control && <span className="ml-2"><Badge tone="violet">per party</Badge></span>}</td>
                  <td className="px-4 py-2.5 text-slate-600">{a.currency_code ? `${formatQty(a.balance_fx, 2)} ${a.currency_code.trim()}` : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{Number(a.balance_inr) ? formatINR(a.balance_inr) : <span className="text-slate-400">0.00</span>}</td>
                  <td className="px-4 py-2.5 text-right">
                    {canManage && (
                      <ModalButton variant="icon" icon="fa-pen" tooltip="Edit" title={`Edit ${a.name}`}>
                        <AccountForm currencies={currencies.map((c) => c.code)} account={a} />
                      </ModalButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
      <p className="text-xs text-slate-500"><Icon name="fa-circle-info" className="mr-1" />A cash or bank account is created automatically for every currency you add under Administration → Currencies.</p>
    </>
  );
}
