import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBrief } from "../lib/webcrawl.ts";

describe("live hosted brief", { skip: process.env.LIVE !== "1" }, () => {
  it("returns at least one source URL from real search+scrape", async () => {
    const brief = await buildBrief("example domain", 2, { env: { WEBCRAWL_URL: "https://webcrawl.app" } });
    assert.ok(brief.sources.length >= 1);
    assert.match(brief.sources[0].url, /^https?:\/\//);
    assert.ok(brief.sources[0].excerpt.length > 0);
  });
});
