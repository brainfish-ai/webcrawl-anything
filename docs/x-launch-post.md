# X launch post (draft — not posted)

Post from the project account, ideally with a 15-second screen recording attached.

---

## Main post

Your AI agent can't read half the web.

I gave it this URL — a travel site that challenges automated clients. It returned a bot-check shell.

So I built webcrawl: it retries with a real-Chrome TLS fingerprint, escalates to a residential proxy, and spins up a real browser — until the page comes back as clean Markdown.

Same URL, 8 seconds, clean Markdown. Any coding agent. One command.

npx skills add brainfish-ai/webcrawl-anything

Open source. MIT.

[screen recording: blocked request → clean markdown side-by-side]

---

## Reply 1 (the skills)

It ships as 8 agent skills — install all with one command:

🎫 webcrawl-ticket-watch — watch StubHub/Ticketmaster prices, get a push on your phone the second tickets hit your target

💼 webcrawl-jobs-leads — crawl every careers page + Greenhouse/Lever board, see new postings first

🔥 webcrawl-deal-watch — Black Friday watchlist that pings your phone when an item hits target price (free, no signup — uses ntfy.sh)

Plus: webcrawl-crawl (any URL → Markdown), webcrawl-protected-sites, webcrawl-learn-topic (deep research w/ citations), webcrawl-research-corpus (RAG), webcrawl-real-estate

## Reply 2 (the ladder, with a table)

How it gets past bot checks — the escalation ladder:

1. TLS-impersonated fetch (zero config)
2. curl-impersonate w/ pinned Chrome fingerprint
3. Residential proxy hop (bring any proxy — env var)
4. Real Chrome session (solves the check once, cookies reused everywhere)

It remembers which tier each domain needs — first hit pays the cost, the next 50 are fast.

Zero API keys to start. One env var for the proxy tier. MIT license.

## Reply 3 (compliance + links)

To be clear: this is for reading pages a normal browser could — your own research, price watches, docs crawls, RAG corpora. It respects robots.txt, keeps polite rates, and never auto-buys or auto-applies.

Repo: github.com/brainfish-ai/webcrawl-anything
Docs: webcrawl.app

---

## Notes for the poster

- Attach the video to the FIRST post, not a reply (Browser Use's 250K-view posts put the demo up top).
- Record the demo with a DataDome-protected travel/ticket page: left pane shows curl/naive fetch returning the challenge shell; right pane shows `npx webcrawl scrape <same-url>` returning clean Markdown with the tier badge.
- Framing rules (from research): say "sites that challenge automated clients", never "bypasses Cloudflare/DataDome"; mention robots.txt/rate compliance in a reply; no purchase automation claims.
- Timing: Black Friday angle is strongest Nov 10-25 (deal-watch skill). Ticket-watch angle is evergreen.
- Suggested first comment: pin the install command.
