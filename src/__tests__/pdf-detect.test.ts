import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectFileKind, sniffMagic } from "../parse/detect.js";
import { isBinaryKind } from "../parse/index.js";
import { looksLikeBinaryUrl } from "../parse/fetch.js";

describe("PDF detection without a .pdf URL suffix", () => {
  it("sniffs %PDF- magic bytes", () => {
    const bytes = new TextEncoder().encode("%PDF-1.5\n%\xe2\xe3\xcf\xd3\n");
    assert.deepEqual(sniffMagic(bytes), { kind: "pdf", mime: "application/pdf" });
  });

  it("detects application/pdf Content-Type even when the URL has no extension", () => {
    const url = "https://arxiv.org/pdf/1706.03762";
    assert.equal(looksLikeBinaryUrl(url), false, "extension-only helper must stay false");
    const { kind } = detectFileKind({
      contentType: "application/pdf",
      fileName: url,
    });
    assert.equal(kind, "pdf");
    assert.equal(isBinaryKind(kind), true);
  });

  it("detects PDF from magic when Content-Type is wrong or generic", () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\ntrailer\n");
    const { kind } = detectFileKind({
      bytes,
      contentType: "application/octet-stream",
      fileName: "https://arxiv.org/pdf/1706.03762",
    });
    assert.equal(kind, "pdf");
  });
});
