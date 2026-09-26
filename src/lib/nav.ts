/** Sidebar navigation + the phase each screen arrives in (used by the "coming soon" page). */
export type NavItem = { href: string; icon: string; label: string; phase: number; adminOnly?: boolean };
export type NavGroup = { title: string; items: NavItem[]; adminOnly?: boolean };

export const NAV: NavGroup[] = [
  {
    title: "Overview",
    items: [{ href: "/dashboard", icon: "fa-gauge-high", label: "Dashboard", phase: 7 }],
  },
  {
    title: "Daily work",
    items: [
      { href: "/deposits", icon: "fa-down-long", label: "Deposits", phase: 8 },
      { href: "/deals", icon: "fa-right-left", label: "Deals", phase: 9 },
      { href: "/payouts", icon: "fa-money-bill-transfer", label: "Currency payouts", phase: 10 },
      { href: "/receipts", icon: "fa-inbox", label: "Receipts", phase: 10 },
      { href: "/settlements", icon: "fa-up-long", label: "Settlements", phase: 8 },
    ],
  },
  {
    title: "Ledger",
    items: [
      { href: "/vouchers", icon: "fa-file-lines", label: "Vouchers", phase: 7 },
      { href: "/accounts", icon: "fa-sitemap", label: "Chart of accounts", phase: 7 },
      { href: "/opening", icon: "fa-flag-checkered", label: "Opening balance", phase: 7, adminOnly: true },
    ],
  },
  {
    title: "Parties",
    items: [{ href: "/parties", icon: "fa-users", label: "Depositors & clients", phase: 7 }],
  },
  {
    title: "Reports",
    items: [{ href: "/reports", icon: "fa-chart-pie", label: "Reports", phase: 7 }],
  },
  {
    title: "Administration",
    adminOnly: true,
    items: [
      { href: "/admin/users", icon: "fa-users", label: "People", phase: 1, adminOnly: true },
      { href: "/admin/roles", icon: "fa-shield-halved", label: "What each person may do", phase: 1, adminOnly: true },
      { href: "/admin/currencies", icon: "fa-coins", label: "Currencies", phase: 2, adminOnly: true },
      { href: "/admin/settings", icon: "fa-sliders", label: "Company Settings", phase: 2, adminOnly: true },
      { href: "/admin/audit", icon: "fa-clock-rotate-left", label: "Audit Log", phase: 1, adminOnly: true },
      { href: "/admin/year-end", icon: "fa-calendar-check", label: "Year end", phase: 12, adminOnly: true },
      { href: "/admin/backup", icon: "fa-box-archive", label: "Backup", phase: 6, adminOnly: true },
      { href: "/admin/api", icon: "fa-plug", label: "API & mobile app", phase: 7, adminOnly: true },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV.flatMap((g) => g.items);

export function findNavItem(pathname: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((i) => i.href === pathname);
}

/** Portal routes the proxy protects (optimistic cookie check). */
export const PROTECTED_PREFIXES = [
  "/dashboard", "/vouchers", "/accounts", "/opening", "/parties", "/reports", "/print", "/search",
  "/deposits", "/deals", "/payouts", "/receipts", "/settlements",
  "/admin", "/profile", "/change-password", "/setup",
];
