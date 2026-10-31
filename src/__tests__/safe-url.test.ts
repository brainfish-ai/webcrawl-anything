import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertSafeUrl, followSafely, UnsafeUrlError } from "../engine/safe-url.js";

const pub = async () => ["93.184.216.34"];
const priv = async () => ["10.0.0.5"];

describe("assertSafeUrl", () => {
  it("rejects private, loopback, metadata and non-http targets", async () => {
    for (const u of [
      "http://localhost/",
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
      "http://foo.internal/",
      "file:///etc/passwd",
      "ftp://example.com/",
    ]) {
      await assert.rejects(assertSafeUrl(u, pub), UnsafeUrlError, u);
    }
  });
  it("rejects hosts that resolve to private addresses", async () => {
    await assert.rejects(assertSafeUrl("https://evil.example/", priv), UnsafeUrlError);
  });
  it("accepts public hosts", async () => {
    const u = await assertSafeUrl("https://example.com/a", pub);
    assert.equal(u.hostname, "example.com");
  });
});

describe("followSafely", () => {
  it("blocks a redirect hop to an internal address", async () => {
    const calls: string[] = [];
    await assert.rejects(
      followSafely(
        "https://example.com/",
        async (u) => {
          calls.push(u);
          return { status: 302, headers: { location: "http://169.254.169.254/" } };
        },
        async (h) => (h === "example.com" ? ["93.184.216.34"] : [h])
      ),
      UnsafeUrlError
    );
    assert.deepEqual(calls, ["https://example.com/"]);
  });
  it("follows safe redirects and returns the final URL", async () => {
    const { res, finalUrl } = await followSafely(
      "https://a.example/",
      async (u): Promise<{ status: number; headers: Record<string, string> }> =>
        u === "https://a.example/"
          ? { status: 301, headers: { location: "/b" } }
          : { status: 200, headers: {} },
      pub
    );
    assert.equal(res.status, 200);
    assert.equal(finalUrl, "https://a.example/b");
  });
  it("stops redirect loops", async () => {
    await assert.rejects(
      followSafely("https://a.example/", async () => ({ status: 302, headers: { location: "/" } }), pub),
      /Too many redirects/
    );
  });
});
