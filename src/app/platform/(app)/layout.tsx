import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui";
import { requirePlatformSession } from "@/lib/platform-session";
import { platformLogoutAction } from "@/app/actions/platform";

/**
 * The console's shell. Deliberately dark and plain — nobody should ever be a moment unsure
 * whether they are looking at Genius ITens' console or a company's own desk.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const s = await requirePlatformSession();
  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center gap-6">
          <Link href="/platform" className="flex items-center gap-2.5 font-bold">
            <span className="h-8 w-8 rounded-lg bg-white/15 grid place-items-center"><Icon name="fa-shield-halved" /></span>
            Genius ITens
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link href="/platform" className="rounded-lg px-3 py-1.5 hover:bg-white/10">Companies</Link>
            <Link href="/platform/audit" className="rounded-lg px-3 py-1.5 hover:bg-white/10">What has been done</Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-white/60 hidden sm:inline">{s.userName}</span>
            <form action={platformLogoutAction}>
              <button className="rounded-lg px-3 py-1.5 hover:bg-white/10" type="submit">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      <footer className="mx-auto max-w-6xl px-6 pb-10 text-xs text-slate-400">
        This console opens and closes accounts. It cannot read any company&apos;s trade.
      </footer>
    </div>
  );
}
