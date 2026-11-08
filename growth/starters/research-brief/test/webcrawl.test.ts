import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BRIEF_DISCLAIMER,
  buildBrief,
  excerptFromMarkdown,
  hitsFromSearchPayload,
  resolveEngineMode,
} from "../lib/webcrawl.ts";

describe("hitsFromSearchPayload", () => {
  it("reads hosted data[] and SDK results[]", () => {
    const hosted = hitsFromSearchPayload({
      data: [{ title: "Example Domain", url: "https://example.com", description: "docs" }],
    });
    assert.equal(hosted[0].url, "https://example.com/");
    const sdk = hitsFromSearchPayload({
      results: [{ title: "RFC", url: "https://www.rfc-editor.org/rfc/rfc9110" }],
    });
    assert.equal(sdk.length, 1);
  });

  it("drops localhost hits", () => {
    assert.equal(hitsFromSearchPayload({ data: [{ url: "http://127.0.0.1/x" }] }).length, 0);
  });
});

describe("excerptFromMarkdown", () => {
  it("strips headings and truncates", () => {
    const text = excerptFromMarkdown("# Hello\n\n" + "word ".repeat(400), 80);
    assert.equal(text.includes("#"), false);
    assert.ok(text.endsWith("..."));
  });
});

describe("resolveEngineMode", () => {
  it("blocks local on Vercel", () => {
    assert.throws(() => resolveEngineMode({ WEBCRAWL_MODE: "local", VERCEL: "1" }), /Vercel/);
  });
});

describe("buildBrief", () => {
  it("scrapes each search hit and labels page excerpts", async () => {
    const fetchImpl = (async (url: string) => {
      const path = String(url);
      if (path.endsWith("/v1/search")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: [
              { title: "Example Domain", url: "https://example.com", description: "IANA example" },
            ],
          }),
          { status: 200 }
        );
      }
      if (path.endsWith("/v1/scrape")) {
        return new Response(
          JSON.stringify({
            success: true,
            markdown: "This domain is for use in documentation examples without needing permission.",
          }),
          { status: 200 }
        );
      }
      return new Response("no", { status: 404 });
    }) as typeof fetch;

    const brief = await buildBrief("example domain", 3, {
      env: { WEBCRAWL_URL: "https://webcrawl.app" },
      fetch: fetchImpl,
    });
    assert.equal(brief.mode, "hosted");
    assert.equal(brief.disclaimer, BRIEF_DISCLAIMER);
    assert.equal(brief.sources[0].kind, "page-excerpt");
    assert.match(brief.sources[0].excerpt, /documentation examples/);
    assert.match(brief.disclaimer, /does not run a language model/);
  });

  it("falls back to a labeled search snippet when scrape fails", async () => {
    const fetchImpl = (async (url: string) => {
      const path = String(url);
      if (path.endsWith("/v1/search")) {
        return new Response(
          JSON.stringify({
            success: true,
            results: [{ title: "Hit", url: "https://example.com/missing", description: "from search" }],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ success: false, error: "blocked" }), { status: 200 });
    }) as typeof fetch;

    const brief = await buildBrief("missing page", 2, {
      env: { WEBCRAWL_URL: "https://webcrawl.app" },
      fetch: fetchImpl,
    });
    assert.equal(brief.sources[0].kind, "search-snippet");
    assert.equal(brief.sources[0].excerpt, "from search");
  });
});
