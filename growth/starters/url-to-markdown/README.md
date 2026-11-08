# URL to clean Markdown

Read any public URL as Markdown in a small Next.js app. The page you see is **retrieved by webcrawl**, not rewritten by a language model.

## Benefit

Paste a docs, blog, or GitHub URL and get clean Markdown with the source link. Use it as a reader, or as a starting point for agents that must cite the live page.

## Prerequisites

- Node.js >= 20
- Network egress to `https://webcrawl.app` (hosted, default) or the ability to spawn `npx webcrawl` (local)
- Optional: `WEBCRAWL_API_KEY` from `npx webcrawl login` so hosted usage is attributed. Keep it server-side.

Local engine extra: a laptop/VM with optional Chrome for JavaScript pages (`npx webcrawl doctor`). Local mode is **not** for Vercel/Edge.

## Quick start

```bash
cd growth/starters/url-to-markdown
npm install
cp env.example .env.local   # optional key
npm run dev
```

Open `http://localhost:3000`, keep `https://example.com`, click **Read page**.

```bash
npm test
npm run build
npm run test:live    # hits https://webcrawl.app/v1/scrape
```

## Verified APIs

| Path | Role |
|---|---|
| `POST https://webcrawl.app/v1/scrape` | Hosted Markdown (probed 2026-11-08) |
| `npx webcrawl --mode local --json scrape <url>` | Local engine on Node |

SDK: `npm install @webcrawl/client`, `client.scrape({ url, formats: ["markdown"] })`. MCP hosted endpoint `https://webcrawl.app/mcp` needs a browser session; this app uses REST instead.

## Runtime and deploy

| Where | How |
|---|---|
| `next dev` on a laptop | Hosted REST by default. `WEBCRAWL_MODE=local` spawns the CLI |
| Vercel / v0 preview | Hosted REST only. Set `WEBCRAWL_API_KEY` in project env (not `NEXT_PUBLIC_`). Local mode throws if `VERCEL=1` |
| Edge runtime | Not supported |

This app is a **repo starter**. Importing the folder into v0 does not publish a template. Remaining manual steps (after maintainer merge): [docs/growth.md](../../../docs/growth.md) and `V0_PROMPT.md`.

## Links

- Product: [webcrawl.app](https://webcrawl.app/?utm_source=github&utm_medium=starter&utm_campaign=url-to-markdown)
- Source: [brainfish-ai/webcrawl-anything](https://github.com/brainfish-ai/webcrawl-anything)
- Access skills: `npx skills add brainfish-ai/webcrawl-anything --skill webcrawl-hosted`
- Contribute: [CONTRIBUTING.md](https://github.com/brainfish-ai/webcrawl-anything/blob/main/CONTRIBUTING.md) and [good first issues](https://github.com/brainfish-ai/webcrawl-anything/issues?q=is%3Aopen+label%3A%22good+first+issue%22)
