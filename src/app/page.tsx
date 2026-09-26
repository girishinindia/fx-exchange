import Link from "next/link";
import { Icon } from "@/components/ui";

/** Home — one screen, no scrolling (private portal, no marketing content). */
export default function Home() {
  return (
    <div className="relative h-dvh w-full overflow-hidden flex flex-col bg-sky-50">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-sky-50 via-white to-sky-100" />
      <div className="pointer-events-none absolute -top-40 -right-40 h-[32rem] w-[32rem] rounded-full bg-sky-200/50 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-48 -left-40 h-[30rem] w-[30rem] rounded-full bg-sky-300/30 blur-3xl" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{ backgroundImage: "radial-gradient(#bae6fd 1px, transparent 1px)", backgroundSize: "22px 22px" }}
      />

      <header className="relative z-10 flex items-center gap-3 px-6 sm:px-10 py-5">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-sky-500 to-sky-700 text-white grid place-items-center shadow">
          <Icon name="fa-coins" />
        </div>
        <span className="font-bold text-slate-900">FX Desk</span>
        <span className="ml-auto inline-flex items-center gap-2 rounded-full bg-white/80 border border-sky-100 px-3 py-1 text-xs text-slate-500">
          <Icon name="fa-lock" className="text-sky-500" />
          Private portal
        </span>
      </header>

      <main className="relative z-10 flex-1 grid place-items-center px-6">
        <div className="w-full max-w-xl text-center">
          <div className="mx-auto h-20 w-20 rounded-3xl bg-gradient-to-br from-sky-400 to-sky-700 text-white grid place-items-center text-3xl shadow-lg shadow-sky-200 ring-8 ring-white">
            <Icon name="fa-right-left" />
          </div>
          <h1 className="mt-7 text-4xl sm:text-5xl font-bold tracking-tight text-slate-900">
            Currency Exchange
            <br />
            <span className="text-sky-600">made simple</span>
          </h1>
          <p className="mt-4 text-slate-500">Buy, sell, stock and profit — for your team, in one place.</p>
          <Link
            href="/login"
            className="mt-9 inline-flex items-center gap-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white px-8 py-3.5 text-base font-semibold shadow-lg shadow-sky-200 transition"
          >
            <Icon name="fa-right-to-bracket" /> Sign in
          </Link>
          <div className="mt-10 flex flex-wrap justify-center gap-3 text-sm">
            {[
              ["fa-arrow-right-arrow-left", "Buy & sell"],
              ["fa-vault", "Live stock"],
              ["fa-chart-line", "Profit & reports"],
            ].map(([icon, label]) => (
              <span key={label} className="inline-flex items-center gap-2 rounded-full bg-white/90 border border-sky-100 px-4 py-2 text-slate-600 shadow-sm">
                <Icon name={icon} className="text-sky-500" />
                {label}
              </span>
            ))}
          </div>
        </div>
      </main>

      <footer className="relative z-10 flex flex-wrap items-center gap-x-4 gap-y-1 px-6 sm:px-10 py-5 text-xs text-slate-400">
        <span>Authorised staff only · accounts are created by your administrator</span>
        <span className="ml-auto">© Genius ITens</span>
      </footer>
    </div>
  );
}
