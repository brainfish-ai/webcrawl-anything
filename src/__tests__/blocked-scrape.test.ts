import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blockedScrapeResult } from "../local-engine.js";
import { isAntiBotChallenge } from "../engine/fetcher.js";

describe("blocked local scrape", () => {
  it("returns success:false with no content and an actionable error", () => {
    const res = blockedScrapeResult("https://www.g2.com/products/x/reviews", 403, "impit-tls", 120);
    assert.equal(res.success, false);
    assert.equal(res.blocked, true);
    assert.equal(res.statusCode, 403);
    assert.equal(res.markdown, "");
    assert.deepEqual((res.data as Record<string, unknown>).markdown, "");
    assert.match(String(res.error), /HTTP 403/);
    assert.match(String(res.error), /--mode cloud/);
  });

  it("treats 403 / 429 / 503 and challenge markers as blocked, a normal 200 page as not", () => {
    assert.equal(isAntiBotChallenge("<html>Forbidden</html>", 403), true);
    assert.equal(isAntiBotChallenge("", 429), true);
    assert.equal(isAntiBotChallenge("<title>Just a moment...</title>", 200), true);
    assert.equal(isAntiBotChallenge("<html><h1>Quotes</h1><p>Real text</p></html>", 200), false);
  });
});
