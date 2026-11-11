import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { describe, it } from "node:test";
import { setCachedPage } from "../engine/cache.js";
import { createLocalEngineClient } from "../local-engine.js";
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

describe("local scrape of extensionless PDFs", () => {
  function makePdf(prefix = "") {
    const text = "BT /F1 18 Tf 60 100 Td (PDF routing fixture) Tj ET";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "<< /Length " + text.length + " >>\nstream\n" + text + "\nendstream",
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = objects.map((object, index) => {
      const offset = pdf.length;
      pdf += (index + 1) + " 0 obj\n" + object + "\nendobj\n";
      return offset.toString().padStart(10, "0") + " 00000 n \n";
    });
    return prefix + pdf + "xref\n0 6\n0000000000 65535 f \n" + offsets.join("")
      + "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + pdf.length + "\n%%EOF\n";
  }

  for (const [contentType, prefix] of [
    ["application/pdf", "\n"],
    ["application/octet-stream", ""],
  ]) {
    it("routes " + contentType + " to the PDF parser", async (t) => {
      const allowPrivate = process.env.WEBCRAWL_ALLOW_PRIVATE_URLS;
      process.env.WEBCRAWL_ALLOW_PRIVATE_URLS = "true";
      const server = createServer((_req, res) => {
        res.writeHead(200, { "content-type": contentType });
        res.end(makePdf(prefix));
      }).listen(0, "127.0.0.1");
      t.after(async () => {
        if (allowPrivate === undefined) delete process.env.WEBCRAWL_ALLOW_PRIVATE_URLS;
        else process.env.WEBCRAWL_ALLOW_PRIVATE_URLS = allowPrivate;
        const closed = once(server, "close");
        server.close();
        server.closeAllConnections();
        await closed;
      });
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const url = "http://127.0.0.1:" + address.port + "/document";
      if (contentType === "application/octet-stream") {
        setCachedPage(url, "none", {
          title: "",
          markdown: makePdf(),
          links: [],
          statusCode: 200,
          contentHash: "raw-pdf-fixture",
        });
      }
      const result = await createLocalEngineClient().scrape({ url });
      assert.equal(result.success, true);
      assert.match(String(result.markdown), /PDF routing fixture/);
      assert.doesNotMatch(String(result.markdown), /%PDF-/);
      assert.equal((result.evidence as { targetId: string }).targetId, "pdf-office");
    });
  }
});
