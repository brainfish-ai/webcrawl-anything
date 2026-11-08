#!/usr/bin/env node
/**
 * Hosted search: POST https://webcrawl.app/v1/search
 *
 *   node scripts/search.mjs "RFC 9110 HTTP" --limit 5
 *   node scripts/search.mjs "sony headphones" --category shopping --json
 */
import { api, fail, printJson } from "./http.mjs";

function argValue(args, name) {
  const i = args.indexOf(name);
  if (i === -1 || i === args.length - 1) {
    return undefined;
  }
  return args[i + 1];
}

const args = process.argv.slice(2);
const jsonOut = args.includes("--json");
const limitRaw = argValue(args, "--limit");
const category = argValue(args, "--category");
const query = args.filter((a, i) => {
  if (a === "--json") {
    return false;
  }
  if (a === "--limit" || a === "--category") {
    return false;
  }
  if (args[i - 1] === "--limit" || args[i - 1] === "--category") {
    return false;
  }
  return !a.startsWith("-");
}).join(" ").trim();

if (!query) {
  fail('Usage: node scripts/search.mjs "<query>" [--limit N] [--category C] [--json]');
}

const limit = limitRaw ? Number(limitRaw) : 5;
if (!Number.isInteger(limit) || limit < 1) {
  fail("--limit must be a positive integer");
}

const body = { query, limit };
if (category) {
  body.category = category;
}

const { ok, status, json } = await api("POST", "/v1/search", body);
if (!ok || json.success === false) {
  const err = typeof json.error === "string" ? json.error : `HTTP ${status}`;
  if (jsonOut) {
    printJson({ success: false, status, error: err, body: json });
  } else {
    fail(`search failed: ${err}`);
  }
  process.exit(1);
}

const hits = Array.isArray(json.results)
  ? json.results
  : Array.isArray(json.data)
    ? json.data
    : [];

if (jsonOut) {
  printJson(json);
  process.exit(0);
}

if (!hits.length) {
  fail("No results.");
}

for (let i = 0; i < hits.length; i += 1) {
  const hit = hits[i] && typeof hits[i] === "object" ? hits[i] : {};
  const title = typeof hit.title === "string" ? hit.title : "(untitled)";
  const url = typeof hit.url === "string" ? hit.url : typeof hit.canonicalUrl === "string" ? hit.canonicalUrl : "";
  const desc = typeof hit.description === "string" ? hit.description.replace(/\s+/g, " ").slice(0, 180) : "";
  process.stdout.write(`${String(i + 1).padStart(2)}  ${title}\n    ${url}${desc ? `\n    ${desc}` : ""}\n`);
}
