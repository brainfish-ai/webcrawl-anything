# @webcrawl/mcp

Model Context Protocol (MCP) server for **[Webcrawl Anything](https://github.com/brainfish-ai/webcrawl-anything)** and **[webcrawl.app](https://webcrawl.app)**.

Gives Claude Code, Cursor, Codex, Windsurf, and Gemini CLI live access to web search, structured verticals (shopping, flights, hotels, real-estate, local business, CVEs), anti-bot page scraping, PDF/Office OCR, and YouTube transcripts.

## One-Command Agent Setup

Register `@webcrawl/mcp` and install the `webcrawl-anything` Agent Skill (`SKILL.md`) automatically:

```bash
npx webcrawl setup
```

## Manual MCP Configuration

Add to `.cursor/mcp.json`, `~/.claude.json`, or your MCP client config:

```json
{
  "mcpServers": {
    "webcrawl": {
      "command": "npx",
      "args": ["-y", "@webcrawl/mcp@latest"],
      "env": {
        "WEBCRAWL_MCP_SCHEMA_PROFILE": "compact",
        "WEBCRAWL_API_KEY": "wc_live_..."
      }
    }
  }
}
```

### Compact Schema Profile

Set `WEBCRAWL_MCP_SCHEMA_PROFILE=compact` (default when installed via `npx webcrawl setup`) to minimize tool schema token usage in context-constrained agents while keeping full server-side validation. Set `WEBCRAWL_MCP_SCHEMA_PROFILE=full` for verbose parameter descriptions.

## Tools Provided

- `web_search` — Search the web or structured verticals (`shopping`, `flights`, `hotels`, `real-estate`, `business`, `security`, `academic`, `tech`, `news`).
- `web_scrape` — Fetch a URL and return clean Markdown with target evidence.
- `web_parse` / `web_parse_status` — Parse PDFs (native + OCR), Word/Excel/PowerPoint files, YouTube videos, and audio/video into Markdown.
- `web_map` — Discover all URLs on a domain (`sitemap.xml`, `robots.txt`, and link graph).
- `web_crawl` — Crawl up to 25 pages starting from a URL.
- `web_extract` — Extract structured JSON from a URL using a prompt or JSON Schema.
- `web_rerank` — Rerank candidate documents by relevance to a query.
- `search_categories` — List all supported search categories, subcategories, and filters.

## License

MIT
