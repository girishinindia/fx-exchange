#!/usr/bin/env node
/**
 * Builds docs/testing/think-north-tutorial.pdf from the HTML parts in
 * docs/testing/tutorial-src/ (concatenated in name order) using headless Chromium.
 *
 *   node scripts/make-think-north-tutorial.mjs
 *
 * Needs the `playwright` package resolvable (npm i -D playwright, or NODE_PATH to a
 * folder that has it) and a Chromium it can launch. Edit the HTML parts, never the PDF;
 * the figures in them come from scripts/think-north-scenario.mjs.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const src = resolve("docs/testing/tutorial-src");
const html = readdirSync(src).filter((f) => f.endsWith(".html")).sort()
  .map((f) => readFileSync(join(src, f), "utf8")).join("\n");
const out = resolve("docs/testing/think-north-tutorial.html");
writeFileSync(out, html);

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  console.error("playwright is not installed here — `npm i -D playwright` (or set NODE_PATH) and run again. The HTML is at", out);
  process.exit(2);
}
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
await page.goto("file://" + out, { waitUntil: "load" });
await page.emulateMedia({ media: "print" });
const pdf = resolve("docs/testing/think-north-tutorial.pdf");
await page.pdf({
  path: pdf, format: "A4", printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: `<div style="width:100%;font-family:Carlito,Calibri,sans-serif;font-size:8pt;color:#5B6674;padding:0 16mm;display:flex;justify-content:space-between;">
      <span>FX Desk · Think North — the first month, step by step</span><span class="pageNumber"></span></div>`,
  margin: { top: "18mm", right: "16mm", bottom: "20mm", left: "16mm" },
});
await browser.close();
console.log("wrote", pdf);
