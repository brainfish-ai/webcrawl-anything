# v0-ready prompt (not a published template)

Paste into https://v0.app. Gallery publishing is a later manual step (Project menu → Settings → Template → Publish). Docs: https://v0.app/docs/templates

Git import: + → Import from GitHub → `https://github.com/brainfish-ai/webcrawl-anything` → Root Directory `growth/starters/research-brief`. Docs: https://v0.app/docs/git-import

---

Build a multi-source research brief.

Used by a developer checking a factual question,
at their desk,
to read quoted passages from pages that were actually fetched.

Product surface:
- Query field and Build brief button
- Server-only POST /api/brief
- Call @webcrawl/client search (https://webcrawl.app/v1/search) then scrape each public URL (/v1/scrape)
- Cap at 4 sources
- Each card: title, source URL, excerpt, badge "scraped page" or "search snippet"
- If scrape fails, show the search description and label it as a snippet, never invent a quote
- Banner: retrieved excerpts, no language model
- Footer links to webcrawl.app and github.com/brainfish-ai/webcrawl-anything

Constraints:
- Next.js App Router, Node runtime, not Edge
- WEBCRAWL_API_KEY server-side only
- No LLM keys, no ngrok, no extra paid APIs
- Refuse WEBCRAWL_MODE=local when VERCEL=1
- Polished paper UI, mobile stacking, accessible labels
