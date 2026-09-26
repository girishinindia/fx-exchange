"use client";

import { useEffect } from "react";
import { Icon } from "@/components/ui";

/** Opens the browser print dialog once the page has rendered (used for PDF export). */
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, []);
  return null;
}

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="no-print inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white">
      <Icon name="fa-print" />Print / Save as PDF
    </button>
  );
}
