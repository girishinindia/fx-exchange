/**
 * Ageing is the one report where the arithmetic can be quietly wrong and still look right:
 * net a party's balance, date it by the last entry, and a debt from January reads as current.
 * These tests pin the FIFO matching that stops that happening.
 */
import { describe, expect, it } from "vitest";
import { __testing } from "@/lib/reports";

const { ageByFifo } = __testing;
const line = (date: string, up: number, down = 0) => ({
  party_id: "1", party_code: "C-1", full_name: "Kumar Overseas",
  date, up: up.toFixed(2), down: down.toFixed(2),
});

describe("ageing", () => {
  it("settles the oldest bill first, so what is left keeps its own age", () => {
    // billed in January and in March; one payment that covers January and part of March
    const [row] = ageByFifo(
      [line("2026-01-10", 100000), line("2026-03-10", 60000), line("2026-03-20", 0, 130000)],
      "2026-03-31",
    );
    // ₹30,000 left, and it belongs to the 10 March bill — 21 days old, not 80 and not 11:
    // the age comes from the bill it still belongs to, never from the date of the payment
    expect(row.total).toBe(3_000_000);
    expect(row.b0).toBe(3_000_000);
    expect(row.b31).toBe(0);
    expect(row.oldest).toBe(21);
  });

  it("puts a debt nobody has paid in the bucket its age deserves", () => {
    const [row] = ageByFifo(
      [line("2025-11-01", 50000), line("2026-02-01", 20000), line("2026-03-25", 10000)],
      "2026-03-31",
    );
    expect(row.b90).toBe(5_000_000);   // November, 150 days
    expect(row.b31).toBe(2_000_000);   // February, 58 days
    expect(row.b0).toBe(1_000_000);    // late March
    expect(row.total).toBe(8_000_000);
    expect(row.oldest).toBe(150);
  });

  it("carries an over-payment forward instead of ageing it as a debt", () => {
    const [row] = ageByFifo([line("2026-03-01", 10000), line("2026-03-05", 0, 25000)], "2026-03-31");
    expect(row.total).toBe(0);
    expect(row.advance).toBe(1_500_000);   // ₹15,000 paid ahead
  });

  it("uses money already paid ahead against the next bill", () => {
    const [row] = ageByFifo(
      [line("2026-03-01", 0, 50000), line("2026-03-10", 30000), line("2026-03-20", 40000)],
      "2026-03-31",
    );
    // ₹50,000 sitting ahead covers the ₹30,000 bill and ₹20,000 of the next
    expect(row.advance).toBe(0);
    expect(row.total).toBe(2_000_000);
    expect(row.oldest).toBe(11);
  });

  it("leaves out a party who owes nothing at all", () => {
    expect(ageByFifo([line("2026-03-01", 10000), line("2026-03-02", 0, 10000)], "2026-03-31")).toEqual([]);
  });

  it("lists the party with the oldest money first", () => {
    const other = (date: string, up: number) => ({
      party_id: "2", party_code: "C-2", full_name: "Sharma Exports", date, up: up.toFixed(2), down: "0.00",
    });
    const rows = ageByFifo([line("2026-03-20", 10000), other("2025-12-01", 5000)], "2026-03-31");
    expect(rows.map((r) => r.name)).toEqual(["Sharma Exports", "Kumar Overseas"]);
  });
});
