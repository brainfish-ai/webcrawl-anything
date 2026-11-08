#!/usr/bin/env node
/**
 * Local scrape via `npx webcrawl --mode local`.
 *
 *   node scripts/scrape.mjs https://example.com
 *   node scripts/scrape.mjs https://example.com --json
 */
import { asMarkdown, fail, parseJsonOutput, runWebcrawl } from "./run-cli.mjs";

const args = process.argv.slice(2);
const jsonOut = args.includes("--json");
const url = args.find((a) => a !== "--json" && !a.startsWith("-"));

if (!url) {
  fail("Usage: node scripts/scrape.mjs <url> [--json]");
}
if (!/^https?:\/\//i.test(url)) {
  fail("URL must start with http:// or https://");
}

const { code, stdout, stderr } = await runWebcrawl(["--json", "scrape", url]);
if (code !== 0) {
  process.stderr.write(stderr || stdout || `webcrawl scrape exited ${code}\n`);
  process.exit(code);
}

let payload;
try {
  payload = parseJsonOutput(stdout);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

if (!payload || payload.success === false) {
  const err = payload && typeof payload.error === "string" ? payload.error : "scrape failed";
  fail(err);
}

if (jsonOut) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} else {
  const md = asMarkdown(payload).trim();
  if (!md) {
    fail("scrape returned no Markdown. The page may be a challenge shell or need Chrome.");
  }
  process.stdout.write(`${md}\n`);
}
