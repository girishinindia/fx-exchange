import { describe, expect, it } from "vitest";
import { amount, amountInWords, formatINR, formatQty, saleProfit, weightedAverage, withinTolerance } from "@/lib/money";

describe("formatINR", () => {
  it("uses Indian grouping", () => {
    expect(formatINR("1244437.75")).toBe("₹12,44,437.75");
    expect(formatINR(209625)).toBe("₹2,09,625.00");
    expect(formatINR("999")).toBe("₹999.00");
    expect(formatINR("10000000")).toBe("₹1,00,00,000.00");
  });
  it("handles negatives, zero and options", () => {
    expect(formatINR("-41250")).toBe("-₹41,250.00");
    expect(formatINR(0)).toBe("₹0.00");
    expect(formatINR("-0.001")).toBe("₹0.00");
    expect(formatINR("186400", { decimals: 0 })).toBe("₹1,86,400");
    expect(formatINR("150000", { symbol: false })).toBe("1,50,000.00");
  });
  it("rounds half up", () => {
    expect(formatINR("0.005")).toBe("₹0.01");
  });
});

describe("formatQty", () => {
  it("uses western grouping for currency quantities", () => {
    expect(formatQty("12450")).toBe("12,450.00");
    expect(formatQty("145000", 0)).toBe("145,000");
  });
});

describe("exchange maths (worked example from the build plan)", () => {
  it("amount = quantity × rate, exact to paise", () => {
    expect(amount("2500", "83.75").toFixed(2)).toBe("209375.00");
    expect(amount("0.1", "0.2").toFixed(2)).toBe("0.02"); // no float drift
  });
  it("weighted average cost after a BUY", () => {
    expect(weightedAverage("13750", "83.2522", "1200", "83.10").toFixed(4)).toBe("83.2400");
  });
  it("profit on a SELL at average cost", () => {
    expect(saleProfit("2500", "83.75", "83.24").toFixed(2)).toBe("1275.00");
  });
  it("tolerance check (±0.50%)", () => {
    expect(withinTolerance("83.75", "83.90", "0.50")).toBe(true); // −0.18%
    expect(withinTolerance("83.40", "83.90", "0.50")).toBe(false); // −0.60%
  });
});

describe("amount in words (receipts)", () => {
  it("uses the Indian system", () => {
    expect(amountInWords("209625")).toBe("Rupees Two Lakh Nine Thousand Six Hundred Twenty-Five only");
    expect(amountInWords("12345678.50")).toBe("Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight and Fifty Paise only");
    expect(amountInWords("100")).toBe("Rupees One Hundred only");
    expect(amountInWords("0.05")).toBe("Rupees Zero and Five Paise only");
    expect(amountInWords("1000000")).toBe("Rupees Ten Lakh only");
  });
});
