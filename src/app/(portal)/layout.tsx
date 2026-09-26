import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { getCompanyInfo } from "@/lib/company";
import { requireSession } from "@/lib/session";

/** Every page inside (portal) requires a valid Redis session. */
export default async function PortalLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  const company = await getCompanyInfo(session);

  return (
    <div className="flex min-h-dvh">
      <Sidebar companyName={company.name} isAdmin={session.userType === "ADMIN"} />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar session={session} />
        <main className="flex-1 p-4 lg:p-6 space-y-6">{children}</main>
        <footer className="no-print px-6 py-4 text-xs text-slate-400 border-t border-sky-100 bg-white">FX Desk · Currency Exchange Management · © Genius ITens</footer>
      </div>
    </div>
  );
}
