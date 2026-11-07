# How the engine works

Webcrawl's local engine is in `src/`. The CLI and MCP server call the same code.

## JavaScript pages

Static HTML is fetched without a browser. Pages that only fill in after scripts run are opened in local Chrome over the Chrome DevTools Protocol. The driver waits until the document is loaded and the DOM has been quiet for a short interval, then reads the rendered HTML.

Each attempt has a hard timeout. If Chrome hangs, the engine retries with alternate headless flags or a headless shell. The dump-dom flag is a last resort. If a page needs JavaScript and rendering still fails, the result is `success: false` with `needsJs: true` and an actionable error, not an unrendered navigation shell.

## Extract

Structured extract walks nested objects and arrays in the caller schema. Script, style, and template tags are stripped before card matching so inline script text is not treated as page content. An empty extract for a custom prompt or schema is reported as failure.

## Search

Keyless search fans out across public sources (DuckDuckGo, Brave HTML, Wikipedia, Hacker News, Bing RSS), merges and dedupes URLs, retries thin results, and fills up to `n`. Optional keyed providers run only when their environment variables are set.
