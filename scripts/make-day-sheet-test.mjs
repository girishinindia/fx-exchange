#!/usr/bin/env node
/**
 * Builds docs/testing/day-sheet-test.pdf from docs/testing/day-sheet-src.html using headless
 * Chromium.
 *
 *   node scripts/make-day-sheet-test.mjs
 *
 * Needs the `playwright` package resolvable (npm i -D playwright, or NODE_PATH to a folder that
 * has it) and a Chromium it can launch. Edit the HTML, never the PDF; the figures in it come from
 * scripts/day-sheet-scenario.mjs (docs/testing/day-sheet-run.txt).
 */
import { createRequire } from "node:module";
import { resolve } from "node:path";

const src = resolve("docs/testing/day-sheet-src.html");
let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  console.error("playwright is not installed here — `npm i -D playwright` (or set NODE_PATH) and run again. The HTML is at", src);
  process.exit(2);
}
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
await page.goto("file://" + src, { waitUntil: "load" });
await page.emulateMedia({ media: "print" });
const pdf = resolve("docs/testing/day-sheet-test.pdf");
await page.pdf({
  path: pdf, format: "A4", printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: `<div style="width:100%;font-family:Carlito,Calibri,sans-serif;font-size:8pt;color:#5B6674;padding:0 14mm;display:flex;justify-content:space-between;">
      <span>FX Desk · The day sheet — one day, every part of it</span><span class="pageNumber"></span></div>`,
  margin: { top: "14mm", right: "14mm", bottom: "18mm", left: "14mm" },
});
await browser.close();
console.log("wrote", pdf);
