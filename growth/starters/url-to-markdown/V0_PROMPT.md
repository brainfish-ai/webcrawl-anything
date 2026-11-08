# v0-ready prompt (not a published template)

Paste into a new chat at https://v0.app. This does not create a gallery template. Publishing still needs Project menu → Settings → Template → Publish after a maintainer merge. Docs: https://v0.app/docs/templates

Alternatively import this folder from GitHub: + menu → Import from GitHub → `https://github.com/brainfish-ai/webcrawl-anything` → Root Directory `growth/starters/url-to-markdown`. Docs: https://v0.app/docs/git-import

---

Build a URL-to-Markdown reader.

Used by developers who need the live text of a public page,
in a browser,
to copy clean Markdown with the source URL still attached.

Product surface:
- Single URL field and a Read page button
- Server-only POST /api/read that calls @webcrawl/client scrape against https://webcrawl.app/v1/scrape
- WEBCRAWL_API_KEY from server env only (never NEXT_PUBLIC_)
- Show retrieved title, source link, hosted/local badge, and Markdown
- Empty, loading, and error states
- Footer links to https://webcrawl.app and https://github.com/brainfish-ai/webcrawl-anything

Constraints:
- Next.js App Router, Node.js runtime for the API route (not Edge)
- No language-model rewrite. Label the body as retrieved Markdown
- No ngrok, no extra paid APIs
- If WEBCRAWL_MODE=local and VERCEL=1, return an error telling the user to use the hosted API
- Polished paper-and-ink UI, desktop and mobile, accessible labels
