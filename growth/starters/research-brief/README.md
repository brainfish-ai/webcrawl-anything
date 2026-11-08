# Multi-source research brief

Ask a question, fetch real pages, and read **quoted excerpts** with source URLs. This starter does not call a language model. If a scrape fails, it keeps the search snippet and labels it.

## Benefit

A small research UI that cannot hallucinate citations: every block is text webcrawl returned from `POST /v1/search` and `POST /v1/scrape`.

## Prerequisites

- Node.js >= 20
- Network egress to `https://webcrawl.app` (default) or a local Node CLI (`WEBCRAWL_MODE=local`)
- Optional server-side `WEBCRAWL_API_KEY` (`npx webcrawl login`)
- No OpenAI / Anthropic / other LLM key

Local mode needs Chrome for some JS pages (`npx webcrawl doctor`) and is refused on Vercel.

## Quick start

```bash
cd growth/starters/research-brief
npm install
cp env.example .env.local
npm run dev
```

Open `http://localhost:3001`. The default query is a public IANA example-domain lookup.

```bash
npm test
npm run build
npm run test:live
```

## Verified APIs

| Path | Role |
|---|---|
| `POST https://webcrawl.app/v1/search` | Hit list (`data[]` or `results[]`) |
| `POST https://webcrawl.app/v1/scrape` | Markdown for each public URL |
| `npx webcrawl --mode local --json search \| scrape` | Local Node engine |

SDK: `@webcrawl/client` `search` and `scrape`. Hosted MCP at `https://webcrawl.app/mcp` is not used here (auth required).

## Runtime and deploy

Server route `POST /api/brief` runs on the Node.js runtime (`maxDuration` 60s). Credentials stay in the server environment. Set `WEBCRAWL_API_KEY` on Vercel for attributed credits. Do not set `WEBCRAWL_MODE=local` on Vercel.

This folder is v0-importable. It is **not** a published v0 template until a maintainer publishes it. See `V0_PROMPT.md` and [docs/growth.md](../../../docs/growth.md).

## Links

- [webcrawl.app](https://webcrawl.app/?utm_source=github&utm_medium=starter&utm_campaign=research-brief)
- [GitHub repo](https://github.com/brainfish-ai/webcrawl-anything)
- Skills: `npx skills add brainfish-ai/webcrawl-anything --skill webcrawl-hosted`
- [Contribute](https://github.com/brainfish-ai/webcrawl-anything/blob/main/CONTRIBUTING.md)
