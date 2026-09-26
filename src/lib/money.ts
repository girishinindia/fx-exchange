import Decimal from "decimal.js";

/**
 * Money helpers. Amounts arrive from Postgres as strings (numeric) and are
 * handled with decimal.js — never with JS floating point.
 * The authoritative maths (stock, average cost, profit) lives in Postgres functions;
 * these helpers are for display and live previews on forms.
 */

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Num = Decimal.Value;

export const D = (v: Num) => new Decimal(v);

/** Indian grouping: 12,44,437.75 */
function groupIndian(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  let rest = intPart.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return `${parts.join(",")},${last3}`;
}

/** Western grouping for currency quantities: 12,450.00 */
function groupWestern(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatINR(v: Num, opts: { decimals?: number; symbol?: boolean } = {}): string {
  const { decimals = 2, symbol = true } = opts;
  const d = D(v).toDecimalPlaces(decimals);
  const neg = d.isNegative() && !d.isZero();
  const [i, f] = d.abs().toFixed(decimals).split(".");
  return `${neg ? "-" : ""}${symbol ? "₹" : ""}${groupIndian(i)}${f ? `.${f}` : ""}`;
}

export function formatQty(v: Num, decimals = 2): string {
  const d = D(v).toDecimalPlaces(decimals);
  const neg = d.isNegative() && !d.isZero();
  const [i, f] = d.abs().toFixed(decimals).split(".");
  return `${neg ? "-" : ""}${groupWestern(i)}${f ? `.${f}` : ""}`;
}

/**
 * A rate, shown as it was typed: at least two decimals, at most six, trailing zeros dropped.
 * 86 reads 86.00, 1.08 reads 1.08, 95.308448 reads 95.308448 — a person never loses a digit
 * they entered, and never has to read six zeros they did not.
 */
export function formatRate(v: Num, min = 2, max = 6): string {
  const s = D(v).toDecimalPlaces(max).toFixed(max);
  const [i, f = ""] = s.split(".");
  const trimmed = f.replace(/0+$/, "");
  return `${i}.${trimmed.length >= min ? trimmed : trimmed.padEnd(min, "0")}`;
}

/** quantity × rate, rounded to paise */
export function amount(quantity: Num, rate: Num): Decimal {
  return D(quantity).mul(rate).toDecimalPlaces(2);
}

/** New weighted-average cost after buying `buyQty` at `buyRate` on top of `qty` at `avg`. */
export function weightedAverage(qty: Num, avg: Num, buyQty: Num, buyRate: Num): Decimal {
  const q = D(qty).plus(buyQty);
  if (q.isZero()) return D(0);
  return D(qty).mul(avg).plus(D(buyQty).mul(buyRate)).div(q).toDecimalPlaces(6);
}

/** Gross profit on a sale at `rate` of `quantity` held at average cost `avg`. */
export function saleProfit(quantity: Num, rate: Num, avg: Num): Decimal {
  return amount(quantity, rate).minus(amount(quantity, avg));
}

/** Is `rate` within ±tolerancePct of `standard`? */
export function withinTolerance(rate: Num, standard: Num, tolerancePct: Num): boolean {
  const s = D(standard);
  if (s.isZero()) return false;
  return D(rate).minus(s).abs().div(s).mul(100).lte(tolerancePct);
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below100(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
}
function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? below100(r) : ""].filter(Boolean).join(" ");
}

/** Indian-system words for a rupee amount: "Rupees Two Lakh Nine Thousand Six Hundred Twenty-Five and Fifty Paise only". */
export function amountInWords(v: Num): string {
  const d = D(v).abs().toDecimalPlaces(2);
  let rupees = d.floor().toNumber();
  const paise = d.minus(d.floor()).mul(100).toNumber();
  if (rupees === 0 && paise === 0) return "Rupees Zero only";
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10_000_000);
  rupees %= 10_000_000;
  const lakh = Math.floor(rupees / 100_000);
  rupees %= 100_000;
  const thousand = Math.floor(rupees / 1000);
  rupees %= 1000;
  if (crore) parts.push(`${crore >= 1000 ? amountInWords(crore).replace(/^Rupees | only$/g, "") : below1000(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rupees) parts.push(below1000(rupees));
  const r = parts.length ? `Rupees ${parts.join(" ")}` : "Rupees Zero";
  return `${r}${paise ? ` and ${below100(paise)} Paise` : ""} only`;
}
