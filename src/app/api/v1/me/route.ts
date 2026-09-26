import { json, withApi } from "@/lib/api";
import { getCompanyInfo } from "@/lib/company";
import { getPermissions } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/** GET /api/v1/me — who is signed in, what they may do, and how the books are set up. */
export const GET = withApi(async (_req, s) => {
  const [perms, company] = await Promise.all([getPermissions(s), getCompanyInfo(s)]);
  return json({
    user: { id: String(s.userId), name: s.userName, email: s.email, type: s.userType },
    company: {
      id: String(s.companyId), code: company.code, name: company.name,
      bookCurrency: company.baseCurrency, dealCurrency: company.primaryCurrency,
      dealCurrencyLocked: company.primaryLocked, fiscalYearStartMonth: company.fiscalYearStartMonth,
    },
    permissions: [...perms].sort(),
  });
});
