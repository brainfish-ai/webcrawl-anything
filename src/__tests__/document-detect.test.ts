import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isBinaryContentType } from "../parse/fetch.js";

// The local HTML tier re-routes a response to the documents pipeline when
// `isBinaryContentType(contentType)` is true or the decoded head starts with
// "%PDF-" (src/local-engine.ts). The head check is a plain startsWith on the
// fetched bytes, so these pin the content-type half of that decision.
describe("isBinaryContentType", () => {
  it("routes a declared application/pdf response to the documents pipeline", () => {
    assert.equal(isBinaryContentType("application/pdf"), true);
    assert.equal(isBinaryContentType("application/pdf;charset=utf-8"), true);
  });

  it("routes generic octet-stream responses so the bytes decide", () => {
    assert.equal(isBinaryContentType("application/octet-stream"), true);
  });

  it("routes other binary kinds (Office, images, media) by content type", () => {
    assert.equal(
      isBinaryContentType("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      true
    );
    assert.equal(isBinaryContentType("image/png"), true);
  });

  it("keeps HTML and text on the HTML pipeline", () => {
    assert.equal(isBinaryContentType("text/html; charset=utf-8"), false);
    assert.equal(isBinaryContentType("application/json"), false);
    assert.equal(isBinaryContentType(undefined), false);
    assert.equal(isBinaryContentType(""), false);
  });
});
