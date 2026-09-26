/** Shared vocabulary of the ledger — used by the portal, the server actions and the API. */

export const VOUCHER_TYPES = {
  OPENING: "Opening balance",
  DEPOSIT: "Deposit received",
  DEAL: "Deal",
  PAYOUT: "Currency payout",
  RECEIPT: "Receipt from client",
  SETTLEMENT: "Settlement to depositor",
  EXPENSE: "Expense",
  JOURNAL: "Journal",
  REVERSAL: "Reversal",
  REVALUATION: "Revaluation",
} as const;
export type VoucherType = keyof typeof VOUCHER_TYPES;
export const VOUCHER_TYPE_LIST = Object.keys(VOUCHER_TYPES) as VoucherType[];

export const ACCOUNT_TYPES = { ASSET: "Asset", LIABILITY: "Liability", EQUITY: "Equity", INCOME: "Income", EXPENSE: "Expense" } as const;
export type AccountType = keyof typeof ACCOUNT_TYPES;

export const ACCOUNT_GROUPS = {
  CASH_BANK: "Cash & bank",
  RECEIVABLE: "Receivable",
  PAYABLE: "Payable",
  CURRENCY_PAYABLE: "Currency payable",
  EQUITY: "Equity",
  INCOME: "Income",
  EXPENSE: "Expense",
  ROUNDING: "Rounding",
} as const;
export type AccountGroup = keyof typeof ACCOUNT_GROUPS;

/** Accounts every company has; the app refers to them by code, never by id. */
export const SYSTEM_ACCOUNTS = {
  clientReceivable: "CLIENT-REC",
  depositorPayable: "DEP-PAY",
  clientCurrencyPayable: "CLIENT-CUR-PAY",
  openingEquity: "OB-EQUITY",
  fxMargin: "FX-MARGIN",
  rounding: "ROUNDING",
  bankCharges: "BANK-CHG",
  commission: "COMMISSION",
  fxLoss: "FX-LOSS",
  unrealised: "UNREAL-FX",
} as const;
export const cashAccountCode = (currency: string) => `CASH-${currency.toUpperCase()}`;

export type LineInput = {
  accountCode?: string;
  accountId?: number;
  partyId?: number | null;
  currency?: string;
  fxAmount: string;
  rate?: string;
  inrAmount?: string;
  dc: "D" | "C";
  dealId?: number | null;
  remarks?: string | null;
};

export type VoucherInput = {
  type: VoucherType;
  date?: string;
  partyId?: number | null;
  narration?: string | null;
  referenceNo?: string | null;
  rateJustification?: string | null;
  clientRef?: string | null;
  lines: LineInput[];
};

export type PostedVoucher = { id: string; voucherNo: string; totalInr?: string; duplicate: boolean };

/** Debit and credit of a party balance, in the words the screen uses. */
export function balanceLabel(balanceInr: number, kind: "CLIENT" | "DEPOSITOR"): string {
  if (balanceInr === 0) return "Settled";
  if (kind === "CLIENT") return balanceInr > 0 ? "Owes us" : "Credit with us";
  return balanceInr < 0 ? "We owe" : "Advance paid";
}
