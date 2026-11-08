import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { markdownFromPayload, resolveEngineMode, scrapePage } from "../lib/webcrawl.ts";
import { markdownToHtml } from "../lib/markdown.ts";

describe("markdownFromPayload", () => {
  it("reads top-level and data.markdown", () => {
    assert.equal(markdownFromPayload({ markdown: "A" }), "A");
    assert.equal(markdownFromPayload({ data: { markdown: "B" } }), "B");
  });
});

describe("resolveEngineMode", () => {
  it("defaults to hosted", () => {
    assert.equal(resolveEngineMode({}), "hosted");
  });

  it("refuses local mode on Vercel", () => {
    assert.throws(() => resolveEngineMode({ WEBCRAWL_MODE: "local", VERCEL: "1" }), /Vercel/);
  });

  it("allows local on a Node machine", () => {
    assert.equal(resolveEngineMode({ WEBCRAWL_MODE: "local" }), "local");
  });
});

describe("scrapePage hosted", () => {
  it("POSTs /v1/scrape and keeps the key on the request, not the result", async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const headers = (init?.headers || {}) as Record<string, string>;
      calls.push({ url: String(url), auth: headers.authorization });
      return new Response(
        JSON.stringify({
          success: true,
          url: "https://example.com/",
          title: "Example Domain",
          markdown: "This domain is for use in documentation examples.",
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const page = await scrapePage("https://example.com", {
      env: { WEBCRAWL_API_KEY: "wc_live_test", WEBCRAWL_URL: "https://webcrawl.app" },
      fetch: fetchImpl,
    });
    assert.equal(calls[0].url, "https://webcrawl.app/v1/scrape");
    assert.equal(calls[0].auth, "Bearer wc_live_test");
    assert.equal(page.mode, "hosted");
    assert.match(page.markdown, /documentation examples/);
    assert.equal(JSON.stringify(page).includes("wc_live_test"), false);
  });

  it("uses local CLI JSON when WEBCRAWL_MODE=local", async () => {
    const page = await scrapePage("https://example.com", {
      env: { WEBCRAWL_MODE: "local" },
      spawnCli: async () => ({
        code: 0,
        stdout: JSON.stringify({
          success: true,
          url: "https://example.com/",
          title: "Example Domain",
          data: { markdown: "Local markdown" },
        }),
        stderr: "",
      }),
    });
    assert.equal(page.mode, "local");
    assert.equal(page.markdown, "Local markdown");
  });
});

describe("markdownToHtml", () => {
  it("escapes HTML then formats headings and links", () => {
    const html = markdownToHtml("# Title\n\nSee [docs](https://example.com) and <script>");
    assert.match(html, /<h1>Title<\/h1>/);
    assert.match(html, /href="https:\/\/example.com"/);
    assert.match(html, /&lt;script&gt;/);
  });
});
