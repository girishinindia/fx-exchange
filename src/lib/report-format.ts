import { formatINR, formatQty, D, formatRate } from "@/lib/money";
import type { Col, Row } from "@/lib/reports";

/** Display formatting of a report cell (screen and print). */
export function fmtCell(c: Col, v: Row[string]): string {
  if (v === null || v === undefined || v === "") return c.type === "text" ? "" : "—";
  switch (c.type) {
    case "money": return formatINR(String(v));
    case "qty": return formatQty(String(v), 2);
    case "rate": return formatRate(String(v));
    case "int": return String(v);
    case "pct": return `${D(String(v)).toFixed(2)}%`;
    case "date": {
      // a totals row puts its label in the first column, which may well be the date one —
      // anything that is not a real date is shown as written rather than crashing the report
      const d = new Date(String(v));
      return Number.isNaN(d.getTime())
        ? String(v)
        : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
    }
    default: return String(v);
  }
}

export const isNumeric = (c: Col) => c.type !== "text" && c.type !== "date" && c.type !== "link";
export const isNegative = (v: Row[string]) => typeof v === "string" && v.startsWith("-");
