import type { Metadata } from "next";
import Link from "next/link";
import { Note, PageHeader } from "@/components/ui";
import { fmtDate, todayISO } from "@/lib/format";
import { getPermissions } from "@/lib/permissions";
import { requireSession } from "@/lib/session";
import { dayClose } from "@/server/services/day";
import { DayCloseForm } from "./DayCloseForm";

export const metadata: Metadata = { title: "Day close" };

/** The end of the day: stock valued at typed closing rates, the drawers, the day's result. */
export default async function DayClosePage({ searchParams }: PageProps<"/reports/day-close">) {
  const s = await requireSession();
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const perms = await getPermissions(s);
  if (!perms.has("report.view")) return <Note tone="amber">Day close needs the report permission.</Note>;
  const sp = await searchParams;
  const today = todayISO();
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const initial = await dayClose(s, { date, rates: [] });
  return (
    <>
      <PageHeader title={`Day close · ${fmtDate(date)}`} crumbs={["Reports", "Day close"]}
        subtitle={<>What is in every drawer at the end of the day, valued at the closing rates you type here, and what the day made. <Link href={`/entry?date=${date}`} className="font-semibold text-sky-700 hover:underline">Open the board for this day</Link>.</>} />
      <DayCloseForm initial={initial} date={date} />
    </>
  );
}
