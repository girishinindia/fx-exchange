import { ModeSwitch } from "@/components/layout/ModeSwitch";
import { Sidebar } from "@/components/layout/Sidebar";
import { SimpleHeader } from "@/components/layout/SimpleHeader";
import { Topbar } from "@/components/layout/Topbar";
import { getCompanyInfo } from "@/lib/company";
import { requireSession } from "@/lib/session";
import { getUiMode } from "@/lib/ui-mode";

/**
 * Every page inside (portal) requires a valid Redis session. Two frames share the same
 * pages: the Simple portal (a five-word header, no sidebar — the desk's) and the Full
 * portal (sidebar + top bar — the accountant's). A cookie decides; see lib/ui-mode.ts.
 */
export default async function PortalLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  const company = await getCompanyInfo(session);
  const mode = await getUiMode();

  if (mode === "simple") {
    return (
      <div className="min-h-dvh bg-slate-50">
        <SimpleHeader companyName={company.name} userName={session.userName} isAdmin={session.userType === "ADMIN"}>
          <ModeSwitch current="simple" onDark />
        </SimpleHeader>
        <main className="mx-auto max-w-7xl p-4 lg:p-6 space-y-6">{children}</main>
        <footer className="no-print px-6 py-4 text-xs text-slate-400 text-center">FX Desk · Simple portal · © Genius ITens</footer>
      </div>
    );
  }

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
