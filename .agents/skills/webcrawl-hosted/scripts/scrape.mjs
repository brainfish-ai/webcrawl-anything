#!/usr/bin/env node
/**
 * Hosted scrape: POST https://webcrawl.app/v1/scrape
 *
 *   node scripts/scrape.mjs https://example.com
 *   node scripts/scrape.mjs https://example.com --json
 *
 * Uses WEBCRAWL_API_KEY when set. Never prints the key.
 */
import { api, asMarkdown, fail, printJson } from "./http.mjs";

const args = process.argv.slice(2);
const jsonOut = args.includes("--json");
const url = args.find((a) => a !== "--json" && !a.startsWith("-"));

if (!url) {
  fail("Usage: node scripts/scrape.mjs <url> [--json]");
}

if (!/^https?:\/\//i.test(url)) {
  fail("URL must start with http:// or https://");
}

const { ok, status, json } = await api("POST", "/v1/scrape", { url, formats: ["markdown"] });
if (!ok || json.success === false) {
  const err = typeof json.error === "string" ? json.error : `HTTP ${status}`;
  if (jsonOut) {
    printJson({ success: false, status, error: err, body: json });
  } else {
    fail(`scrape failed: ${err}`);
  }
  process.exit(1);
}

if (jsonOut) {
  printJson(json);
} else {
  const md = asMarkdown(json).trim();
  if (!md) {
    fail("scrape returned no Markdown. The page may be a challenge shell.");
  }
  process.stdout.write(`${md}\n`);
}
