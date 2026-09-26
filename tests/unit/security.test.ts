import { describe, expect, it } from "vitest";
import { csvCell } from "@/lib/csv";
import { contentSecurityPolicy } from "@/proxy";

describe("CSV cells", () => {
  it("neutralises spreadsheet formulas but keeps numbers", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+91 98765")).toBe("'+91 98765");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-1234.50")).toBe("-1234.50");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell("a,b")).toBe(`"a,b"`);
    expect(csvCell("line\nbreak")).toBe(`"line\nbreak"`);
    expect(csvCell(null)).toBe("");
    expect(csvCell(new Date("2026-01-02T03:04:05Z"))).toBe("2026-01-02T03:04:05.000Z");
  });
});

describe("Content-Security-Policy", () => {
  const prod = contentSecurityPolicy("abc123", false);
  it("only runs scripts carrying the per-request nonce", () => {
    const script = prod.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toContain("'nonce-abc123'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
  });
  it("blocks framing, plugins, base-tag and foreign form targets", () => {
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "default-src 'self'", "upgrade-insecure-requests"]) expect(prod).toContain(d);
  });
  it("allows eval only in development", () => {
    expect(contentSecurityPolicy("n", true)).toContain("'unsafe-eval'");
  });
});
