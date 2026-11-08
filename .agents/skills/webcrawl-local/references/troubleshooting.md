# Local troubleshooting

Run `npx webcrawl doctor` first.

| Symptom | What to do |
|---|---|
| Empty Markdown, "Checking your browser", HTTP 403/429 | Bot check. See the `webcrawl-protected-sites` skill. Do not invent content. |
| `needsJs` / thin SPA shell | Install Chrome or set `WEBCRAWL_CHROME_PATH`. Retry. |
| Search prints "No results." | Keyless SERPs throttled. Retry a different query, scrape known URLs, or optionally set `BRAVE_SEARCH_API_KEY`. Filed upstream as issue #8. |
| `impit` / engine import error | Reinstall `webcrawl` (`npx webcrawl@latest`). Confirm Node >=20. |
| Spawn from a Next.js route fails on Vercel | Expected. Unset `WEBCRAWL_MODE` and use hosted REST (`webcrawl-hosted`). |
| PDF URL dumps garbage | Known class of bugs (see open issue #10 for some arXiv `/pdf/` URLs). Prefer the abstract HTML page or hosted scrape after login. |

## Challenge vs real page

A real scrape of `https://example.com` is a short paragraph about documentation examples. A challenge page is tiny, titled like "Just a moment", or `success: false` with `blocked: true`. Trust `success` and Markdown length, not HTTP 200 alone.
