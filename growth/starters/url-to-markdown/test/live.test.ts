import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scrapePage } from "../lib/webcrawl.ts";

describe("live hosted scrape", { skip: process.env.LIVE !== "1" }, () => {
  it("reads example.com from https://webcrawl.app/v1/scrape", async () => {
    const page = await scrapePage("https://example.com", { env: { WEBCRAWL_URL: "https://webcrawl.app" } });
    assert.equal(page.mode, "hosted");
    assert.match(page.markdown.toLowerCase(), /example/);
  });
});
