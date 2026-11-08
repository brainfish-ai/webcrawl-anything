import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePublicHttpUrl } from "../lib/public-url.ts";

describe("parsePublicHttpUrl", () => {
  it("accepts https example.com", () => {
    assert.equal(parsePublicHttpUrl("https://example.com").hostname, "example.com");
  });

  it("rejects javascript and localhost", () => {
    assert.throws(() => parsePublicHttpUrl("javascript:alert(1)"));
    assert.throws(() => parsePublicHttpUrl("http://localhost/x"));
    assert.throws(() => parsePublicHttpUrl("http://127.0.0.1/"));
    assert.throws(() => parsePublicHttpUrl("http://192.168.0.5/"));
  });
});
