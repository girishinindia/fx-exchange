/** Date/time formatting in the company time zone (Asia/Kolkata for now). */
const TZ = "Asia/Kolkata";

export function fmtDateTime(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(d));
}

export function fmtDate(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" }).format(new Date(d));
}

/** Short device label from a user agent string. */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

/** Today's date (YYYY-MM-DD) in the company time zone. */
export function todayISO(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function fmtTime(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(d));
}

/** "22 Sep, 10:34" — compact date + time for dense tables. */
export function fmtShort(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(d));
}

export const formatDate = fmtDate;

/** First day of the current month (YYYY-MM-DD) in the company time zone. */
export function monthStartISO(): string {
  return todayISO().slice(0, 8) + "01";
}

/**
 * First day of the financial year the given day falls in. An accounting report asked for
 * without a period means "this year so far" — a month-to-date default hides the year's work.
 */
export function fyStartISO(startMonth = 4, on = todayISO()): string {
  const y = Number(on.slice(0, 4));
  const m = Number(on.slice(5, 7));
  const year = m >= startMonth ? y : y - 1;
  return `${year}-${String(startMonth).padStart(2, "0")}-01`;
}
