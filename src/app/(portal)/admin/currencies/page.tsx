import type { Metadata } from "next";
import { enableCurrency, updateCurrency } from "@/app/actions/currencies";
import { ActionForm } from "@/components/ActionForm";
import { ModalButton } from "@/components/ModalButton";
import { Badge, Card, Field, Note, PageHeader, SelectField } from "@/components/ui";
import { withTenant } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";
import { tenantOf } from "@/lib/session";

export const metadata: Metadata = { title: "Currencies" };

/**
 * `is_primary` is the currency depositors bring in — ex.company.primary_currency_code, chosen
 * once at setup and locked. It is not a column on company_currency, so it is joined in rather
 * than read off the row.
 *
 * There is deliberately no rate here. This desk agrees a rate per transaction, on the line, so
 * there is nothing to publish and nothing to look up. (Until Phase 7 this page showed a "Rate"
 * column fed by ex.v_current_rate, the retail counter's rate board — that view was dropped with
 * the rest of the counter and the column went on asking for it.)
 */
type Row = { id: string; currency_code: string; name: string; symbol: string | null; decimal_places: number; is_base: boolean; is_primary: boolean; is_active: boolean; display_order: number };

export default async function CurrenciesPage() {
  const s = await requirePermission("currency.manage");
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;

  const { rows, available } = await withTenant(await tenantOf(s), async (tx) => {
    const rows = await tx<Row[]>`
      select cc.id, cc.currency_code, m.name, m.symbol, m.decimal_places, cc.is_base, cc.is_active, cc.display_order,
             (cc.currency_code = co.primary_currency_code) as is_primary
        from ex.company_currency cc
        join ex.currency_master m on m.code = cc.currency_code
        join ex.company co on co.id = ex.current_company_id()
       order by cc.is_base desc, cc.is_active desc, cc.display_order, cc.currency_code`;
    const available = await tx<{ code: string; name: string }[]>`
      select code, name from ex.currency_master m
       where is_active and not exists (select 1 from ex.company_currency cc where cc.currency_code = m.code and cc.is_active)
       order by code`;
    return { rows, available };
  });

  return (
    <>
      <PageHeader
        title="Currencies"
        crumbs={["Administration"]}
        subtitle="The currencies this company deals in. Enabling one opens a cash account for it; a currency that has been used can be disabled but never deleted, because its entries stay in the books."
        actions={
          <ModalButton label="Enable currency" icon="fa-plus" title="Enable currency">
            <ActionForm action={enableCurrency} submit="Enable" closeOnSuccess>
              <SelectField label="Currency (ISO 4217)" name="code" required options={available.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))} />
              <Field label="Display order" name="order" type="number" defaultValue="10" min={0} max={999} hint="Where it sits in currency lists on the deal and payout screens." />
            </ActionForm>
          </ModalButton>
        }
      />
      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-sky-50/70">
              <tr>{["Currency", "Name", "Symbol", "Decimals", "Order", "Status", ""].map((h) => <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-sky-50 hover:bg-sky-50/50">
                  <td className="px-4 py-3 font-semibold">
                    <span className="inline-flex items-center gap-2"><span className="h-6 w-6 rounded-md bg-sky-100 text-sky-700 grid place-items-center text-[10px] font-bold">{r.currency_code.slice(0, 2)}</span>{r.currency_code}</span>
                    {r.is_base && <span className="ml-2"><Badge tone="sky">Books</Badge></span>}
                    {r.is_primary && <span className="ml-2"><Badge tone="violet">Dealing</Badge></span>}
                  </td>
                  <td className="px-4 py-3">{r.name}</td>
                  <td className="px-4 py-3">{r.symbol}</td>
                  <td className="px-4 py-3">{r.decimal_places}</td>
                  <td className="px-4 py-3 tabular-nums">{r.display_order}</td>
                  <td className="px-4 py-3">{r.is_active ? <Badge tone="emerald">Active</Badge> : <Badge tone="slate">Disabled</Badge>}</td>
                  <td className="px-4 py-3 text-right">
                    {!r.is_base && !r.is_primary && (
                      <ModalButton icon="fa-pen" title={`Edit ${r.currency_code}`} variant="icon" tooltip="Edit">
                        <ActionForm action={updateCurrency} closeOnSuccess>
                          <input type="hidden" name="id" value={r.id} />
                          <Field label="Display order" name="order" type="number" defaultValue={String(r.display_order)} min={0} max={999} />
                          <label className="flex items-center gap-2 text-sm"><input type="hidden" name="active" value="" /><input type="checkbox" name="active" defaultChecked={r.is_active} className="accent-sky-600" /> Active — can be dealt to clients</label>
                          <Note tone="slate">Disabling only takes it off the lists on the deal and payout screens. Everything already posted in {r.currency_code} stays exactly where it is.</Note>
                        </ActionForm>
                      </ModalButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Note tone="slate">
        <b>Books</b> is the currency the accounts are kept in and everything is valued against.
        <b className="ml-2">Dealing</b> is the currency depositors bring in. Both were fixed when
        the company was set up and neither can be changed or switched off — every other currency
        here is one you deal out to clients, and the rate for that is agreed on the deal itself,
        never set here.
      </Note>
    </>
  );
}
