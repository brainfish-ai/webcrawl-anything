# Growth assets (skills and starters)

Public Agent Skills and small v0-ready apps that show webcrawl doing real fetches. They exist to send qualified traffic to [webcrawl.app](https://webcrawl.app) and this GitHub repo. They are **not** published listings, npm releases, or v0 gallery templates until a maintainer (Ajain) reviews, merges, and then publishes.

This document does not replace [docs/skills.md](./skills.md) (the eight task skills). It covers two extra **access** skills and two runnable starters.

## Public skills (repo skills, not personal)

Install from GitHub with the [skills CLI](https://www.skills.sh/docs/cli) (`npx skills`, verified `1.7.6`):

```bash
npx skills add brainfish-ai/webcrawl-anything --list
npx skills add brainfish-ai/webcrawl-anything --skill webcrawl-hosted
npx skills add brainfish-ai/webcrawl-anything --skill webcrawl-local
```

| Skill | Directory | Use |
|---|---|---|
| Hosted webcrawl.app access | [`.agents/skills/webcrawl-hosted/`](../.agents/skills/webcrawl-hosted/SKILL.md) | REST `/v1/*`, `@webcrawl/client`, login, hosted MCP |
| Local keyless webcrawl | [`.agents/skills/webcrawl-local/`](../.agents/skills/webcrawl-local/SKILL.md) | `npx webcrawl --mode local`, doctor, local Chrome |

Format: [Agent Skills specification](https://agentskills.io/specification). After merge to the default branch, the public catalog page is [skills.sh/brainfish-ai/webcrawl-anything](https://skills.sh/brainfish-ai/webcrawl-anything). Until then, install from a clone with `npx skills add ./ --skill webcrawl-hosted`.

Do not create a skills.sh pack or submit directory posts from this PR.

## v0-ready starters (repo apps, not gallery templates)

| App | Directory | What it does |
|---|---|---|
| URL to clean Markdown | [`growth/starters/url-to-markdown/`](../growth/starters/url-to-markdown/README.md) | Server route scrapes a public URL; UI shows retrieved Markdown |
| Multi-source research brief | [`growth/starters/research-brief/`](../growth/starters/research-brief/README.md) | Search, scrape hits, quote real excerpts with source URLs. No LLM |

A GitHub folder is **not** a published v0 template. Current v0 paths (read 2026-11-08):

1. **Prompt:** paste the starter's `V0_PROMPT.md` into a new chat at [v0.app](https://v0.app). Prompting guide: [How to prompt v0](https://vercel.com/blog/how-to-prompt-v0).
2. **Import from GitHub:** new chat, `+` menu, Import from GitHub, paste `https://github.com/brainfish-ai/webcrawl-anything`, set **Root Directory** to `growth/starters/url-to-markdown` or `growth/starters/research-brief`. Docs: [Import from GitHub](https://v0.app/docs/git-import), [GitHub](https://v0.app/docs/github).
3. **Share a chat (not a template):** Invite, then "Anyone with the link" (not search-indexed) or "Anyone on the web". Docs: [Sharing](https://v0.app/docs/sharing).
4. **Publish as a v0 template (manual, after merge):** Project menu `...` → Settings → Template → Publish. Needs a 1920x1080 preview, name, description, category, tags, visibility. Git-connected templates pin the commit at publish time; later git pushes do not update the template until **Sync from Repo**. Docs: [Templates](https://v0.app/docs/templates). **No live template URL exists yet.** Do not invent `v0.app/t/...` links.

Hosted execution uses `@webcrawl/client` against `https://webcrawl.app` from **server** routes. Local execution spawns `npx webcrawl --mode local` only on a Node.js machine. Vercel production must use the hosted API (the apps refuse `WEBCRAWL_MODE=local` when `VERCEL=1`).

## Measurement (honest)

Links you control can carry UTM query parameters, for example `https://webcrawl.app/?utm_source=github&utm_medium=skill&utm_campaign=growth-assets`. Confirm in webcrawl.app analytics after merge; this repo cannot see those dashboards.

Countable without claiming last-click:

- [skills.sh](https://www.skills.sh/docs) anonymous install telemetry and the [install badge](https://skills.sh/brainfish-ai/webcrawl-anything)
- npm downloads for `webcrawl` / `@webcrawl/client`
- GitHub traffic / clone graphs (maintainers)

**GitHub stars have no referrer.** Star counts are aggregate. GitHub's [privacy-safe star history](https://github.blog/changelog/2026-09-04-new-api-endpoint-provides-privacy-safe-star-history-data/) does not expose who starred or which campaign caused it. Correlate star velocity with launch dates; do not attribute a star to a skill, UTM link, or v0 fork.

## Sources

- Agent Skills spec: https://agentskills.io/specification
- Skill creation quickstart: https://agentskills.io/skill-creation/quickstart
- skills.sh CLI: https://www.skills.sh/docs/cli
- skills CLI source/options: https://github.com/vercel-labs/skills
- v0 templates: https://v0.app/docs/templates
- v0 git import: https://v0.app/docs/git-import
- v0 sharing: https://v0.app/docs/sharing
- v0 GitHub: https://v0.app/docs/github
