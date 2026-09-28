import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { ModalButton } from "@/components/ModalButton";
import { ReasonForm } from "@/components/ReasonForm";
import { Badge, Card, Field, Icon, LinkButton, Note, PageHeader } from "@/components/ui";
import { lockYearAction, unlockYearAction } from "@/app/actions/yearend";
import { getCompanyInfo } from "@/lib/company";
import { fmtDate, todayISO } from "@/lib/format";
import { formatINR, formatQty } from "@/lib/money";
import { getPermissions, requirePermission } from "@/lib/permissions";
import { runReport } from "@/lib/report-access";
import { listFinancialYears, openPositions } from "@/server/services/yearend";
import { RevalueForm } from "./RevalueForm";

export const metadata: Metadata = { title: "Year end" };

/**
 * The end of a financial year, in the order it is actually done: check the books agree,
 * restate the currency at closing rates, then close the year so nothing can change under
 * the accountant's feet.
 */
export default async function YearEndPage() {
  const s = await requirePermission("fy.lock");
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const perms = await getPermissions(s);
  const company = await getCompanyInfo(s);

  const [years, positions, tb] = await Promise.all([
    listFinancialYears(s),
    openPositions(s),
    runReport(s, "trialbalance", {}),
  ]);
  const balanced = tb?.result?.totals?.debit === tb?.result?.totals?.credit;
  const open = years.filter((y) => y.status === "OPEN");

  return (
    <>
      <PageHeader
        title="Year end"
        crumbs={["Administration"]}
        subtitle={`The financial year runs 1 April to 31 March. Books in ${company.baseCurrency}, deals in ${company.primaryCurrency}.`}
        actions={perms.has("report.view") && <LinkButton href="/reports/ca-pack" icon="fa-folder-open" variant="ghost">Pack for the CA</LinkButton>}
      />

      {!balanced && (
        <Note tone="rose" icon="fa-circle-exclamation">
          The trial balance does not agree, so no year can be closed. Open the{" "}
          <Link href="/reports/trialbalance" className="underline font-medium">trial balance</Link> and check the most recent vouchers.
        </Note>
      )}

      <Card title="1 · Restate the currency at closing rates" icon="fa-scale-balanced"
        actions={<span className="text-xs text-slate-500">Optional, but do it before closing the year</span>}>
        <RevalueForm positions={positions} baseCurrency={company.baseCurrency} today={todayISO()} />
      </Card>

      <Card title="2 · Close the year" icon="fa-lock" padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-sky-50/70 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Year</th>
                <th className="px-4 py-2 text-left font-semibold">From</th>
                <th className="px-4 py-2 text-left font-semibold">To</th>
                <th className="px-4 py-2 text-right font-semibold">Vouchers</th>
                <th className="px-4 py-2 text-left font-semibold">Status</th>
                <th className="px-4 py-2 text-right font-semibold" />
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <tr key={y.id} className="border-t border-sky-50">
                  <td className="px-4 py-3 font-medium">{y.fy_code}</td>
                  <td className="px-4 py-3 text-slate-600">{fmtDate(y.start_date)}</td>
                  <td className="px-4 py-3 text-slate-600">{fmtDate(y.end_date)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{y.vouchers}
                    {y.first_voucher && <div className="text-xs text-slate-500">{fmtDate(y.first_voucher)} – {fmtDate(y.last_voucher!)}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {y.status === "LOCKED"
                      ? <><Badge tone="rose">Closed</Badge>
                          <div className="mt-1 text-xs text-slate-500">
                            {y.locked_at ? `${fmtDate(y.locked_at)}${y.locked_by_name ? ` by ${y.locked_by_name}` : ""}` : ""}
                            {y.lock_note ? ` · ${y.lock_note}` : ""}
                          </div></>
                      : <><Badge tone="emerald">Open</Badge>
                          {y.lock_note && <div className="mt-1 text-xs text-slate-500">{y.lock_note}</div>}</>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {y.status === "OPEN" ? (
                      <ModalButton label="Close" icon="fa-lock" variant="secondary" title={`Close ${y.fy_code}`}>
                        <ActionForm action={lockYearAction} submit="Close the year" icon="fa-lock" submitVariant="danger" closeOnSuccess>
                          <input type="hidden" name="fyId" value={y.id} />
                          {positions.length > 0 && y.revaluations === 0 && (
                            <Note tone="rose" icon="fa-scale-unbalanced">
                              <b>The currency has not been restated for {y.fy_code}.</b> Step 1 above has not been run, so{" "}
                              {positions.map((p, i) => (
                                <span key={p.currency_code}>
                                  {i > 0 && (i === positions.length - 1 ? " and " : ", ")}
                                  <b>{p.currency_code}</b> ({formatQty(p.held_fx)} held, {formatQty(p.owed_fx)} owed)
                                </span>
                              ))}{" "}
                              {positions.length === 1 ? "is" : "are"} still carried at the old rates. The year&apos;s profit will not include the
                              rate movement. Close anyway only if the CA has agreed.
                            </Note>
                          )}
                          <Note tone="amber" icon="fa-triangle-exclamation">
                            Nothing more can be entered or reversed in {y.fy_code} once it is closed — including corrections.
                            Do this after your CA has signed the year off. An Administrator can reopen it, and the reason is recorded.
                          </Note>
                          <Field label="Note for the record (optional)" name="note" maxLength={300} placeholder="Signed off by the CA on …"
                            hint="Shown under the year once it is closed — who signed it off and when." />
                        </ActionForm>
                      </ModalButton>
                    ) : (
                      <ModalButton label="Reopen" icon="fa-lock-open" variant="ghost" title={`Reopen ${y.fy_code}`}>
                        <ReasonForm action={unlockYearAction} id={y.id} name="reason"
                          label="Why is the year being reopened?"
                          placeholder="CA asked for a correction to …"
                          submit="Reopen it"
                          warning={`Reopening ${y.fy_code} lets entries be made in a year that has been signed off. The reason you give stays on the record.`} />
                      </ModalButton>
                    )}
                  </td>
                </tr>
              ))}
              {years.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  No financial year yet — one is created the first time a voucher is posted.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {open.length > 1 && (
        <Note tone="amber" icon="fa-circle-info">
          {open.length} years are open. Close the older ones once they have been signed off, so a stray date cannot
          put an entry into a year that has already been filed.
        </Note>
      )}

      <p className="text-xs text-slate-500">
        <Icon name="fa-circle-info" className="mr-1" />
        Closing a year is refused while the trial balance disagrees
        {balanced && tb?.result?.totals?.debit ? ` (it currently agrees at ${formatINR(tb.result.totals.debit, { decimals: 0 })})` : ""}.
        Reopening is allowed, but it is recorded with the reason and who did it.
      </p>
    </>
  );
}
