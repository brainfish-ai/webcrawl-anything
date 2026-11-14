#!/usr/bin/env node
// Score how much visible page text survives fastHtmlToMarkdown.
//
//   node --import tsx scripts/line-coverage.mjs
//
// Fetches the 18 pricing pages below, extracts normalized visible lines from
// the static HTML, and checks each line against the markdown. Prints the
// default (full page) score and the onlyMainContent trim for comparison.
// Static HTML cannot see JS-built calculators or SPA-only pricing tables.
import { fastHtmlToMarkdown } from "../src/engine/markdown.ts";

const PAGES = [
  { id: "avesapi", url: "https://avesapi.com/pricing" },
  { id: "scrupp", url: "https://scrupp.com/price" },
  { id: "enrichley", url: "https://enrichley.com/pricing" },
  { id: "emailverify", url: "https://www.emailverify.io/pricing/" },
  { id: "lead411", url: "https://www.lead411.com/pricing/" },
  { id: "enrow", url: "https://enrow.io/en/pricing" },
  { id: "derrick-app", url: "https://derrick-app.com/pricing" },
  { id: "mrscraper", url: "https://mrscraper.com/pricing" },
  { id: "pipecorn", url: "https://pipecorn.com/pricing" },
  { id: "scavio", url: "https://scavio.dev/pricing" },
  { id: "waterfall", url: "https://www.waterfall.io/pricing" },
  { id: "openmart", url: "https://www.openmart.com/pricing" },
  { id: "datamagnet", url: "https://www.datamagnet.co/pricing/" },
  { id: "thehog", url: "https://thehog.ai/pricing" },
  { id: "tinyfish", url: "https://www.tinyfish.ai/pricing" },
  { id: "browserbase", url: "https://www.browserbase.com/pricing" },
  { id: "anvendor", url: "https://anvendor.com/pricing" },
  { id: "signalwire", url: "https://signalwire.com/pricing" },
];

const MIN_LINE = 8;

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const code = parseInt(n, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    });
}

/** Unique visible lines a reader could see in the static HTML. */
function visibleLines(html) {
  const text = decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style|noscript|svg|canvas|template)(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(
        /<\/(p|div|li|tr|h[1-6]|section|article|header|footer|nav|aside|button|summary|label|td|th|dt|dd|figcaption|blockquote|form)>/gi,
        "\n"
      )
      .replace(/<[^>]+>/g, " ")
  );
  const lines = [];
  const seen = new Set();
  for (const raw of text.split(/\n+/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line.length < MIN_LINE) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines;
}

function normalizeMarkdown(markdown) {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_|`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function score(html, url, onlyMainContent) {
  const lines = visibleLines(html);
  const { markdown } = fastHtmlToMarkdown(html, url, onlyMainContent ? { onlyMainContent: true } : {});
  const haystack = normalizeMarkdown(markdown);
  let hit = 0;
  for (const line of lines) {
    if (haystack.includes(line.toLowerCase())) hit++;
  }
  return { lines: lines.length, hit, ratio: lines.length ? hit / lines.length : 0, markdownChars: markdown.length };
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(25_000),
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; webcrawl-line-coverage/1.0)",
      accept: "text/html,application/xhtml+xml",
    },
  });
  const html = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return html;
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

const rows = await mapPool(PAGES, 6, async (page) => {
  try {
    const html = await fetchHtml(page.url);
    const full = score(html, page.url, false);
    const trimmed = score(html, page.url, true);
    return { ...page, ok: true, full, trimmed };
  } catch (err) {
    return { ...page, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

const ok = rows.filter((r) => r.ok);
const sum = (pick) => ok.reduce((n, r) => n + r[pick].hit, 0);
const total = ok.reduce((n, r) => n + r.full.lines, 0);
const pct = (hit) => (total ? ((100 * hit) / total).toFixed(1) : "n/a");

const asJson = process.argv.includes("--json");
if (asJson) {
  console.log(
    JSON.stringify(
      {
        pages: rows.length,
        fetched: ok.length,
        fullPagePct: pct(sum("full")),
        onlyMainPct: pct(sum("trimmed")),
        rows,
      },
      null,
      2
    )
  );
} else {
  console.log("id            full   trim   lines  note");
  for (const row of rows) {
    if (!row.ok) {
      console.log(`${row.id.padEnd(13)} ${"-".padStart(5)}  ${"-".padStart(5)}  ${"-".padStart(5)}  ${row.error}`);
      continue;
    }
    const full = `${(100 * row.full.ratio).toFixed(1)}%`.padStart(6);
    const trim = `${(100 * row.trimmed.ratio).toFixed(1)}%`.padStart(6);
    console.log(`${row.id.padEnd(13)} ${full}  ${trim}  ${String(row.full.lines).padStart(5)}`);
  }
  console.log("");
  console.log(
    `overall ${ok.length}/${rows.length} pages  full page ${pct(sum("full"))}%  onlyMainContent ${pct(sum("trimmed"))}%  (${total} visible lines)`
  );
}
