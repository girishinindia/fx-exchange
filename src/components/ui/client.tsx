"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn, Icon } from "@/components/ui";

/** Client-side pieces of the UI kit: Modal and Tabs. */

export function Modal({ open, onClose, title, children, footer, width = "max-w-lg" }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    // m-auto: a native <dialog> is centred by the browser through `margin: auto`, and
    // Tailwind's preflight resets every margin to 0 — without it every modal in the product
    // sits in the top-left corner.
    <dialog
      ref={ref}
      onClose={onClose}
      className={cn("m-auto rounded-2xl shadow-xl w-full p-0 backdrop:bg-slate-900/40 backdrop:backdrop-blur-sm", width)}
    >
      <div className="flex items-center px-5 py-4 border-b border-sky-100">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <button type="button" onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-600" aria-label="Close">
          <Icon name="fa-xmark" />
        </button>
      </div>
      <div className="p-5 space-y-4">{children}</div>
      {footer && <div className="px-5 py-4 border-t border-sky-100 flex justify-end gap-2 bg-sky-50/50">{footer}</div>}
    </dialog>
  );
}

export function Tabs({ tabs, initial }: { tabs: Array<{ key: string; label: string; content: ReactNode }>; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.key);
  return (
    <div>
      <div role="tablist" className="flex gap-1 border-b border-sky-100 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={active === t.key}
            onClick={() => setActive(t.key)}
            className={cn("px-4 py-2.5 text-sm font-medium border-b-2", active === t.key ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500 hover:text-sky-700")}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.key} role="tabpanel" hidden={active !== t.key}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
