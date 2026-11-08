#!/usr/bin/env node
/**
 * Local search via `npx webcrawl --mode local --json search`.
 *
 *   node scripts/search.mjs "RFC 9110 HTTP" --limit 5
 */
import { fail, parseJsonOutput, runWebcrawl } from "./run-cli.mjs";

function argValue(args, name) {
  const i = args.indexOf(name);
  if (i === -1 || i === args.length - 1) {
    return undefined;
  }
  return args[i + 1];
}

const args = process.argv.slice(2);
const jsonOut = args.includes("--json");
const limitRaw = argValue(args, "--limit") || argValue(args, "-n");
const category = argValue(args, "--category") || argValue(args, "-c");
const query = args
  .filter((a, i) => {
    if (a === "--json") {
      return false;
    }
    if (a === "--limit" || a === "-n" || a === "--category" || a === "-c") {
      return false;
    }
    const prev = args[i - 1];
    if (prev === "--limit" || prev === "-n" || prev === "--category" || prev === "-c") {
      return false;
    }
    return !a.startsWith("-");
  })
  .join(" ")
  .trim();

if (!query) {
  fail('Usage: node scripts/search.mjs "<query>" [--limit N] [--category C] [--json]');
}

const cliArgs = ["--json", "search", query];
if (limitRaw) {
  cliArgs.push("-n", limitRaw);
}
if (category) {
  cliArgs.push("-c", category);
}

const { code, stdout, stderr } = await runWebcrawl(cliArgs);
if (code !== 0) {
  process.stderr.write(stderr || stdout || `webcrawl search exited ${code}\n`);
  process.exit(code || 1);
}

let payload;
try {
  payload = parseJsonOutput(stdout);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

if (jsonOut) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(0);
}

const hits = Array.isArray(payload.results)
  ? payload.results
  : Array.isArray(payload.data)
    ? payload.data
    : [];

if (!hits.length) {
  fail("No results. Keyless search engines may be throttled; try another query or scrape known URLs.");
}

for (let i = 0; i < hits.length; i += 1) {
  const hit = hits[i] && typeof hits[i] === "object" ? hits[i] : {};
  const title = typeof hit.title === "string" ? hit.title : "(untitled)";
  const url = typeof hit.url === "string" ? hit.url : "";
  const desc = typeof hit.description === "string" ? hit.description.replace(/\s+/g, " ").slice(0, 180) : "";
  process.stdout.write(`${String(i + 1).padStart(2)}  ${title}\n    ${url}${desc ? `\n    ${desc}` : ""}\n`);
}
