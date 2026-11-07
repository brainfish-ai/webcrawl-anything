# JS render, extract, and search: Jina Reader, Firecrawl, webcrawl

Short comparison after reading the open-source trees (not just marketing pages). This is what v1.4.3+ adopts, and why.

## Sources

- Jina Reader: [jina-ai/reader](https://github.com/jina-ai/reader) (`src/services/puppeteer.ts`, `src/api/crawler.ts`, `src/api/searcher.ts`, `src/dto/crawler-options.ts`). Product: [r.jina.ai](https://r.jina.ai), [s.jina.ai](https://s.jina.ai).
- Firecrawl: [firecrawl/firecrawl](https://github.com/firecrawl/firecrawl) (`apps/api/src/scraper/scrapeURL/engines/index.ts`, `apps/api/src/scraper/scrapeURL/index.ts`, `apps/api/src/scraper/scrapeURL/transformers/llmExtract.ts`, `apps/api/src/search/v2/index.ts`).
- webcrawl (this repo): `src/engine/chrome.ts`, `src/engine/chrome-cdp.ts`, `src/extract/structured.ts`, `src/search/providers.ts`.

## Headless Chrome / JS pages

| | Jina Reader | Firecrawl | webcrawl (adopted) |
|---|---|---|---|
| Driver | Puppeteer over CDP (`PuppeteerControl`). Not `--dump-dom`. | Engine waterfall: Fire Engine chrome-cdp → Playwright (`page.goto` + `waitFor`) → fetch. | **CDP against installed Chrome** (no puppeteer dependency). `--dump-dom` is last resort only. |
| Wait | `page.goto({ waitUntil: ['load','domcontentloaded','networkidle0'] })` plus in-page **mutationIdle (200ms DOM quiet)**. Early return via `respond-timing`. | Playwright: `waitUntil: 'load'` then optional `waitFor` ms / selector. | **loadEventFired + 200ms mutation-idle poll**, then `outerHTML`. Hard timeout on the whole attempt. |
| Hang / crash | `BlackHoleDetector`, page TTL 300s, `crippled` reconnect, curl snapshot backup. Goto timeout → error, not a fake page. | Engine failure → next engine. All fail → `NoEnginesLeftError`, `success: false`. Empty markdown after 200 is not a win. | **Process-group SIGKILL**, retry `--headless=old` / chrome-headless-shell, then dump-dom with a short timeout. JS pages that still cannot render return **`success: false`** with an actionable error — never the unrendered nav shell. |
| When is JS needed? | `auto` engine: curl-impersonate first; browser if options or HTML is thin (`tokens < 42`). `htmlSignificantlyModifiedByJs` (5% DOM growth). | Feature flags (`waitFor`, screenshot, actions) pick browser-capable engines. | Unchanged: `needsBrowserEscalation` (SPA shells, `document.write`, challenge pages). **Static pages stay browser-free.** |

Why: the v1.4.3 smoke test showed Chrome 156 hanging on `--headless=new --dump-dom` with a fresh profile. Jina and Firecrawl never use dump-dom as the primary driver; they control the page over CDP/Playwright and fail honestly when the browser does not produce content.

## JSON / nested schema extract

| | Firecrawl | webcrawl (adopted) |
|---|---|---|
| Schema walk | `normalizeSchema` / `toRootSchema` recurse `properties` and `items`. Root arrays wrap as `{ items: schema }`. Strict OpenAI schema preflight. | **Same wrap + shorthand coerce** so `{items:[{quote,author}]}` becomes a real object/array schema. Nested quote/author fields are found even when the array key is `items`, not `quotes`. |
| Empty extract | HTTP 200, `success: true`, `json: null` + warning (`JSON extraction did not produce a result.`). | **`success: false`** and `data: {}` when a prompt/schema was given and nothing matched. Silent empty success was the bug. |
| JS pages | Extract runs on the scraped (rendered) document. | Scrape first (CDP). Card/microdata parsing uses **script/style/template-stripped HTML**. `var data = [...]` JSON is still read. `document.write("…"+ d['text'] +"…")` junk is dropped. |

Jina does not ship a JSON-schema extract API comparable to Firecrawl; we follow Firecrawl’s schema walk and webcrawl’s existing honest-error style (blocked scrapes already used `success: false`).

## Search providers / fallbacks

| | Jina `s.jina.ai` | Firecrawl | webcrawl (adopted) |
|---|---|---|---|
| Chain | Serper (if keyed) → curl-scraped Google HTML (`@retry(2)`, 3.7s) → Bing HTML → Common SERP. Stale SERP cache on failure. Then parallel crawl of result URLs. | Fire Engine search → SearXNG (if configured) → DuckDuckGo. Empty → `{}`. | Zero-key fan-out: Brave HTML, DDG HTML (lite + html.duckduckgo.com), Wikipedia, **HN Algolia**, **Bing RSS**, **DDG Instant Answer**. Paid: Serper / Brave API / Jina when keys exist. |
| Fill `n` | Target ~6–10; race live SERP vs local index. | Return whatever the first non-empty provider gave. | **Merge + URL dedupe, round-robin across sources** so Wikipedia cannot fill `-n 5` alone. If unique hits `< n`, run keyless fallbacks with **retry/backoff** (not only when every engine is empty). Quorum waits until `n` unique URLs or engines finish; default quorum 2.8s so DDG/Brave are not cut off after Wikipedia. |

Why: the smoke test saw 2 Wikipedia hits for “open source web crawler” (`-n 5`) because (1) general search did not include HN/Bing, (2) keyless fallbacks ran only on *zero* hits, (3) quorum (1.5s) was shorter than DDG’s 2.2s fetch. Jina retries SERP providers; Firecrawl walks a fallback list until something returns rows. We do both, with only keyless sources unless the user set a key.

## What we deliberately did not copy

- Jina’s fat Chrome+Puppeteer container, SSE snapshot streaming, and paid `s.jina.ai` auth gate.
- Firecrawl’s proprietary Fire Engine, URL index, and “empty extract still HTTP 200 with a warning” (we fail closed when the caller asked for a schema).
- Extra keyful SERP vendors. Local mode stays zero-key.
