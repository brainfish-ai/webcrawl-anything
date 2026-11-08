# Local runtime

## Process model

`npx webcrawl --mode local` loads `webcrawl/local-engine` (published from this repo as `webcrawl`). That module uses `impit` TLS impersonation, optional curl-impersonate, and a CDP session against installed Chrome for JS pages. Those are **Node + OS process** features.

Supported:

- Developer laptop / CI VM with Node.js >=20
- `next dev` on that same machine, if a server route spawns the CLI
- MCP stdio (`npx -y @webcrawl/mcp@latest` with `WEBCRAWL_MODE=local`)

Not supported:

- Edge runtimes (`export const runtime = "edge"`)
- Browser `fetch` pretending to be the engine
- Typical Vercel serverless: no durable Chrome, short timeouts, `npx` download on each cold start

Doctor text when Chrome is missing: static pages still work; for JS pages install Chrome or `npx playwright install chromium-headless-shell`, or `webcrawl login` for hosted browsers.

## Environment

| Variable | Role |
|---|---|
| `WEBCRAWL_MODE=local` | Force local even if a key is set |
| `WEBCRAWL_CHROME_PATH` | Chrome/Chromium binary |
| `WEBCRAWL_PROXY_URL` (or user/password/host/port) | Optional residential proxy |
| `BRAVE_SEARCH_API_KEY` / `SERPER_API_KEY` | Optional search providers. Local search works without them |
| `WEBCRAWL_ALLOW_PRIVATE_URLS=true` | Local-only escape hatch for private IPs. Never set in production |

## CLI surface used by this skill

Verified against `webcrawl` help and a live `npx webcrawl --mode local scrape https://example.com` on 2026-11-08 (Node v22.23.4, Chrome at `/usr/bin/google-chrome`):

```text
npx webcrawl scrape <url>
npx webcrawl search <query> [-c category] [--sub sub] [-n limit]
npx webcrawl map <url> [--filter text] [-n limit]
npx webcrawl crawl <url> [-n max pages]
npx webcrawl extract <url> [--prompt text]
npx webcrawl doctor
npx webcrawl --json ...
npx webcrawl --mode local ...
```

`--json` prints the raw engine object (Markdown at `markdown` and/or `data.markdown`).
