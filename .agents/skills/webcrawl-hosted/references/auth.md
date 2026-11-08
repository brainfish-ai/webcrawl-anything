# Hosted auth

## Get a key

```bash
npx webcrawl login                 # browser OAuth (default)
npx webcrawl login --email YOU@domain.com
npx webcrawl login --email YOU@domain.com --code 123456
npx webcrawl whoami
```

Signup landing used by the CLI: `https://webcrawl.app/?signup=cli`. Account/credits URL used by the SDK error helper: `https://webcrawl.app/account`.

The client can also call `POST /v1/auth/otp/send` and `POST /v1/auth/otp/verify`, then `POST /v1/account/keys`. Prefer the CLI so you do not print codes or keys into chat logs.

## Where the key lives

| Location | Use |
|---|---|
| `WEBCRAWL_API_KEY` env | Servers, CI, Vercel project env (not `NEXT_PUBLIC_`) |
| `--api-key` flag | One-off CLI. Avoid in shared transcripts |
| `~/.config/webcrawl/config.json` | Written by `webcrawl login`, mode 0600 |
| Browser session for `/mcp` | Hosted MCP only |

Never write keys into `SKILL.md`, starters, git, or client bundles.

## CLI vs REST without a key

`npx webcrawl --mode cloud scrape ...` exits with `authentication_required` when no key is configured. Direct REST `/v1/scrape` and `/v1/search` returned 200 without a key in the 2026-11-08 probe. Treat anonymous REST as best-effort. Production apps should still set a server-side key so credits and rate limits attach to an account.

## Mode flags

- `WEBCRAWL_MODE=cloud` forces the hosted API (key required in the CLI).
- `WEBCRAWL_MODE=local` forces the local engine (see `webcrawl-local`).
- `auto` (default): local when no key, cloud when a key is set.
