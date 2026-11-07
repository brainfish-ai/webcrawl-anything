import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_SEARCH_ERROR,
  fetchKeylessSearchFallbacks,
  isSerpChallengeHtml,
  parseBingWebRss,
} from "../search/providers.js";

describe("keyless search fallbacks", () => {
  it("flags DDG and Brave challenge pages so they are not parsed as results", () => {
    assert.equal(
      isSerpChallengeHtml(
        "<html>Unfortunately, bots use DuckDuckGo too. Please complete the following challenge</html>",
        202
      ),
      true
    );
    assert.equal(isSerpChallengeHtml("<html>anomaly-modal</html>", 200), true);
    assert.equal(isSerpChallengeHtml("flagged as being suspicious; schedule a captcha", 200), true);
    assert.equal(isSerpChallengeHtml("<html>results</html>", 429), true);
    assert.equal(
      isSerpChallengeHtml(
        "<html><a class='result-link' href='https://example.com'>Real result</a></html>",
        200
      ),
      false
    );
  });

  it("parses Bing RSS item title/link/description", () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item><title>Next.js App Router</title><link>https://nextjs.org/docs/app</link><description>The App Router</description></item>
      <item><title>Pages vs App</title><link>https://example.com/pages-vs-app</link><description>Comparison</description></item>
    </channel></rss>`;
    const items = parseBingWebRss(xml, 5);
    assert.equal(items.length, 2);
    assert.equal(items[0].url, "https://nextjs.org/docs/app");
    assert.equal(items[0].title, "Next.js App Router");
    assert.equal(items[0].engine, "bing-rss");
  });

  it("fetchKeylessSearchFallbacks returns Wikipedia/HN/Bing hits from mocked fetch", async () => {
    const realFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: string | URL) => {
        const url = String(input);
        if (url.includes("en.wikipedia.org")) {
          return new Response(
            JSON.stringify({
              query: {
                search: [{ title: "Next.js", snippet: "React framework", timestamp: "2024-01-01" }],
              },
            }),
            { status: 200 }
          );
        }
        if (url.includes("hn.algolia.com")) {
          return new Response(
            JSON.stringify({
              hits: [
                {
                  title: "Next.js App Router Update",
                  url: "https://news.ycombinator.com/item?id=1",
                  objectID: "1",
                  points: 10,
                  num_comments: 2,
                  created_at: "2024-01-01",
                },
              ],
            }),
            { status: 200 }
          );
        }
        if (url.includes("bing.com/search")) {
          return new Response(
            `<?xml version="1.0"?><rss><channel><item><title>App Router docs</title><link>https://nextjs.org/docs</link><description>docs</description></item></channel></rss>`,
            { status: 200 }
          );
        }
        return new Response("nope", { status: 404 });
      }) as typeof fetch;
      const docs = await fetchKeylessSearchFallbacks("next.js app router", 5);
      assert.ok(docs.length >= 2, JSON.stringify(docs));
      assert.ok(docs.some((d) => d.engine === "hn-algolia"));
      assert.ok(docs.some((d) => d.engine === "wikipedia"));
      assert.ok(docs.some((d) => /nextjs\.org/i.test(d.url)));
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("documents the honest empty-search error", () => {
    assert.match(EMPTY_SEARCH_ERROR, /BRAVE_SEARCH_API_KEY/);
    assert.match(EMPTY_SEARCH_ERROR, /no results/);
  });
});
