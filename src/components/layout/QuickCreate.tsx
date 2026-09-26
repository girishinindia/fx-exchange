"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cn, Icon } from "@/components/ui";

export type QuickAction = { href: string; icon: string; label: string; hint: string };

/**
 * The topbar's one-click way into the day's work.
 *
 * It replaces a button reading "New exchange" that pointed at /exchange/new — the retail
 * counter's single entry screen, which 0007 removed along with the rest of the counter. The
 * route has 404'd ever since. There is no single equivalent here: a wholesale desk takes money
 * in, deals it out, hands it over, collects rupees and settles depositors, and those are five
 * different vouchers, so this offers the five rather than guessing at one.
 *
 * Which of them appear is decided on the server, from the signed-in person's permissions; an
 * empty list renders nothing at all rather than a button that leads somewhere they are refused.
 */
export function QuickCreate({ actions }: { actions: QuickAction[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Close on a click outside and on Escape — a menu that survives either is a menu that gets
  // in the way of the next thing the person does. Choosing an item closes it from the item's
  // own onClick: the topbar lives in the layout and survives the navigation, and the
  // outside-click handler will not fire for a click that lands inside the menu.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <div className="relative hidden sm:block" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-sky-700"
      >
        <Icon name="fa-plus" />
        New entry
        <Icon name="fa-chevron-down" className={cn("text-[10px] transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-72 rounded-xl border border-sky-100 bg-white p-1.5 shadow-lg z-30">
          {actions.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-sky-50"
            >
              <Icon name={a.icon} className="mt-0.5 w-4 text-center text-sky-600" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-800">{a.label}</span>
                <span className="block text-xs text-slate-500">{a.hint}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
