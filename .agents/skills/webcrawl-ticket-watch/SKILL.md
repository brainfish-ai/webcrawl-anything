---
name: webcrawl-ticket-watch
description: Use when monitoring concert, sports, or event ticket prices and availability — checking StubHub, Ticketmaster, SeatGeek, AXS, or venue pages for price drops, seat availability, or sold-out changes, and alerting the user when a target price or condition is met. Covers re-checking event pages on a schedule with webcrawl, extracting all-in prices and seat info, and sending push alerts (ntfy.sh, Telegram) when prices drop below a threshold. Trigger for "watch these tickets and tell me when they drop", "alert me if the concert price goes below $X", "is this event sold out", "track ticket prices for the Cubs game", "notify me when good seats open up". Skip for buying tickets or automating purchases (this skill monitors and alerts only), scalping/bulk-buying, or bypassing purchase limits.
license: MIT
metadata:
  version: "1.3.3"
  author: brainfish-ai
  repo: brainfish-ai/webcrawl-anything
---

# Webcrawl — ticket price & availability watch

Event pages (StubHub, Ticketmaster, SeatGeek, venue sites) commonly challenge automated clients, and prices move by the minute. This skill watches event pages on a schedule, extracts the all-in price and availability, and pings your phone when your target hits.

**Monitors and alerts only.** It never buys, queues, or automates purchases, and it must not be used for bulk-buying or scalping — that's against site terms and often the law.

## Quick start

```bash
# Read a team/category page now (bot-check passes; listings are JS-rendered — see "If prices are missing")
npx webcrawl scrape https://www.stubhub.com/chicago-cubs-tickets/

# Structured extraction of the listings you care about
npx webcrawl extract "https://www.stubhub.com/chicago-cubs-tickets/" \
  --prompt "upcoming events with date, opponent, venue, and lowest price"
```

## Workflow

1. **Set the watchlist.** For each event: URL, target price (all-in, per ticket), and optional seat preferences (section/quantity).
2. **Baseline read.** Scrape once and extract current listings with `extract --prompt "…all-in price, section, quantity…"`. Record the baseline in a small JSON state file (`{url, targetPrice, lastPrice, lastChecked}`).
3. **Schedule re-checks.** Re-run every 15-60 min during on-sales and price-drop windows (cron: `*/30 * * * *`, or an agent scheduler). Always pass `--no-cache` on scheduled re-checks — the engine caches pages by content hash and will replay the first fetch (stale prices) otherwise. Event pages change fast; don't poll faster than every 10-15 min — keep it polite.
4. **Evaluate the trigger.** Compare extracted all-in price against the target. Fire the alert only on a meaningful change (below target, or a drop >5% since last check, or sold-out → available flip).
5. **Push to mobile (ntfy.sh — free, no signup):**
   ```bash
   curl -d " Cubs tickets just hit $85 all-in (was $120) — https://www.stubhub.com/..." \
        -H "Title: Ticket price drop" -H "Tags: ticket" \
        -H "Priority: high" ntfy.sh/my-secret-topic-name
   ```
   The user subscribes to the same topic in the ntfy app once; every alert lands as a push notification. Use a long random topic name (it's the only "auth"). Telegram bot is the alternative (see `references/alerting.md`).
6. **Update state.** Write the new price/timestamp back so the next run diffs against it (avoid alert-spam on the same price).

## Extracting prices

- Use the all-in price (with fees) — that's what the user pays; list price alone misleads.
- Store `checkedAt`, `price`, `currency`, `sections available`, and the URL in state.

## If prices are missing

- If `extract` returns only the site tagline / a "Please enable JS" shell with no listings, the page renders its listings client-side. **Neither local nor cloud mode renders it today** — verified live: a StubHub category page passes the bot check (`tier: "impersonate"`, real title) but the event list itself only appears after JS renders; an event page returned the shell at `tier: "static"`, HTTP 403, in both zero-key local and logged-in cloud modes. The scrape path does not auto-escalate to a headless browser.
- Do not treat an empty result as "sold out" — that is a rendering gap, not a page fact. Do not retry blindly; a different tier won't change it.
- Working path: **Jina Reader renders these pages** (verified live on a StubHub category page: full 91-event list returned). `curl -s "https://r.jina.ai/<url>"` returns the rendered Markdown — use it for JS-rendered event pages. Verify a Jina result is real before trusting it: check the Title/URL Source header and watch for its "may require CAPTCHA" warning on heavily protected pages.
- For webcrawl-native monitoring, build the watchlist only from event pages that serve real listing HTML — verify each URL with `npx webcrawl scrape <url>` first. If listing text comes back, `extract` will work; if only the tagline comes back, that URL needs Jina or a headless browser.
- Verify URLs are real before monitoring: a dead URL renders as an empty page too (a "Page Not Found" page looks like a shell in Markdown). Cross-check the page against the live site or a Jina fetch.

## Validation loop

- Confirm the scrape returns real listings, not a challenge shell (title matches the event, substantive text).
- Verify the alert actually reaches the phone (send one test ntfy push before relying on it).
- Re-check that state updates after each run so you don't alert twice on the same price.

## Compliance

Only monitor pages you can view as a consumer. Respect site ToS, keep poll rates low (15+ min), and never use this for automated purchasing, scalping, or evading purchase limits.

## References

- `references/alerting.md` — ntfy.sh setup, Telegram bot alternative, alert-deduping, cron scheduling patterns
