# Hosted API reference (verified)

Base URL: `https://webcrawl.app` (override with `WEBCRAWL_URL`). JSON in, JSON out. Send `Authorization: Bearer wc_live_...` when you have a key. SDK: `npm install @webcrawl/client`.

Probed 2026-11-08. Do not invent extra paths.

## Request / response

### POST `/v1/scrape`

```json
{ "url": "https://example.com", "formats": ["markdown"], "noCache": false }
```

Useful fields seen on success: `success`, `url`, `title`, `markdown`, `links`, `cached`. The CLI also accepts Markdown under `data.markdown`. Read both.

### POST `/v1/search`

```json
{ "query": "RFC 9110 HTTP", "limit": 5, "category": "tech" }
```

Hosted probe returned hits in `data[]` (`title`, `url`, `canonicalUrl`, `description`). The SDK types also mention `results[]`. Read both. Optional `category` values from `GET /v1/search/categories` include `general`, `news`, `shopping`, `flights`, `hotels`, `real-estate`, `business`, `security`, `academic`, `tech`.

### POST `/v1/map`

```json
{ "url": "https://example.com", "limit": 20, "search": "optional filter text" }
```

Success: `links[]` (strings or `{ url }`).

### POST `/v1/crawl`

```json
{ "url": "https://example.com", "maxPages": 5 }
```

SDK caps `maxPages` at 25. Success: `pages[]` with `url`, `title`, `markdown`.

### POST `/v1/extract`

```json
{ "url": "https://example.com", "prompt": "page title and first paragraph" }
```

Success: structured `data`. Costs extra credits when authenticated (`credits.structuredDataCredits` in the probe).

### GET `/v1/targets` and GET `/v1/search/categories`

No body. Use these instead of guessing vertical names.

### GET `/v1/auth/me`

Reports `authenticated` and, when signed in, plan and remaining credits.

### Not a substitute for REST: `https://webcrawl.app/mcp`

Streamable HTTP MCP. Returned 401 without a session. Configure it as an MCP server and sign in in the browser.

## curl

```bash
curl -sS -X POST "$WEBCRAWL_URL/v1/scrape" \
  -H "content-type: application/json" \
  -H "accept: application/json" \
  ${WEBCRAWL_API_KEY:+-H "authorization: Bearer $WEBCRAWL_API_KEY"} \
  -d '{"url":"https://example.com","formats":["markdown"]}'
```

Prefer `scripts/scrape.mjs` so the key is not copied into shell history twice.

## Parse caveat

`POST /v1/parse` returned HTTP 200 for a public PDF URL in the probe, but the body was a challenge shell (`title` "Just a moment...", empty Markdown). Do not claim that URL as a working parse example. For PDFs, try `npx webcrawl scrape <pdf-url>` locally (`webcrawl-local`) or another public file after checking the Markdown length.
