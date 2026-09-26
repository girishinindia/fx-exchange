/** The log stores an action code; a person reads a sentence. */
export function describeAction(action: string, d: Record<string, unknown> | null): string {
  const s = (k: string) => (typeof d?.[k] === "string" ? (d[k] as string) : undefined);
  const who = s("full_name") ?? s("admin_email") ?? s("email") ?? "";
  const removed = d?.removed as Record<string, number> | undefined;
  switch (action) {
    case "company.create":      return `Opened the account, with ${who} as its first Administrator`;
    case "company.block":       return `Blocked the company — ${s("reason") ?? "no reason recorded"}`;
    case "company.unblock":     return "Let the company back in";
    case "company.delete": {
      const code = s("code") ?? "the company";
      const held = removed && removed.vouchers > 0
        ? ` It was holding ${removed.vouchers} voucher${removed.vouchers === 1 ? "" : "s"} and ${removed.people} ${removed.people === 1 ? "person" : "people"}.`
        : " It had never been used.";
      return `Deleted ${code} and everything it owned — ${s("reason") ?? "no reason recorded"}.${held}`;
    }
    case "user.create":         return `Added ${who} as ${d?.user_type === "ADMIN" ? "an Administrator" : "a desk user"}`;
    case "user.block":          return `Blocked ${who}`;
    case "user.unblock":        return `Let ${who} back in`;
    case "user.reset_password": return `Reset ${who}'s password`;
    default:                    return action;
  }
}
