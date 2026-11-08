#!/usr/bin/env node
/**
 * Scrape a URL locally and print a labeled excerpt plus source URL.
 * For research notes without an LLM. Not synthesis.
 *
 *   node scripts/excerpt.mjs https://example.com
 */
import { asMarkdown, excerptFromMarkdown, fail, parseJsonOutput, runWebcrawl } from "./run-cli.mjs";

const url = process.argv.slice(2).find((a) => !a.startsWith("-"));
if (!url) {
  fail("Usage: node scripts/excerpt.mjs <url>");
}
if (!/^https?:\/\//i.test(url)) {
  fail("URL must start with http:// or https://");
}

const { code, stdout, stderr } = await runWebcrawl(["--json", "scrape", url]);
if (code !== 0) {
  process.stderr.write(stderr || stdout || `webcrawl scrape exited ${code}\n`);
  process.exit(code || 1);
}

const payload = parseJsonOutput(stdout);
if (!payload || payload.success === false) {
  fail(typeof payload?.error === "string" ? payload.error : "scrape failed");
}

const title = typeof payload.title === "string" ? payload.title : url;
const md = asMarkdown(payload);
const excerpt = excerptFromMarkdown(md);
if (!excerpt) {
  fail("No Markdown excerpt. The page may be blocked or need Chrome.");
}

process.stdout.write(
  [
    `# ${title}`,
    `Source: ${typeof payload.url === "string" ? payload.url : url}`,
    "",
    "Retrieved excerpt (not model synthesis):",
    "",
    excerpt,
    "",
  ].join("\n")
);
