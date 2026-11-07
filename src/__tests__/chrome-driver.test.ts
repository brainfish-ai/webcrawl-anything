import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chromeCdpArgs,
  chromeDumpDomArgs,
  parseDevToolsActivePort,
  renderViaLocalChromeDetailed,
} from "../engine/chrome.js";

describe("local Chrome driver", () => {
  it("parses DevToolsActivePort and prefers CDP args over dump-dom", () => {
    assert.equal(parseDevToolsActivePort("9222\n/devtools/browser/abc\n"), 9222);
    assert.equal(parseDevToolsActivePort("nope"), null);
    const cdp = chromeCdpArgs({ port: 9333, profile: "/tmp/p", headless: "new" });
    assert.ok(cdp.includes("--remote-debugging-port=9333"));
    assert.ok(cdp.includes("about:blank"));
    assert.equal(cdp.includes("--dump-dom"), false);
    const dump = chromeDumpDomArgs({
      profile: "/tmp/p",
      headless: "old",
      url: "https://example.com/",
      timeoutMs: 4000,
    });
    assert.ok(dump.includes("--dump-dom"));
    assert.ok(dump.includes("--headless=old"));
  });

  it("chrome-headless-shell uses --headless not --headless=new", () => {
    const args = chromeCdpArgs({
      port: 1,
      profile: "/tmp/p",
      headless: "new",
      binaryPath: "/home/me/.cache/ms-playwright/chromium_headless_shell-123/chrome-headless-shell-linux64/chrome-headless-shell",
    });
    assert.ok(args.includes("--headless"));
    assert.equal(args.includes("--headless=new"), false);
  });

  it("hard-timeouts a hanging Chrome binary instead of waiting forever", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wc-hang-chrome-"));
    const bin = join(dir, "hang-chrome");
    writeFileSync(bin, "#!/bin/sh\nexec sleep 60\n");
    chmodSync(bin, 0o755);
    const prev = process.env.WEBCRAWL_CHROME_PATH;
    process.env.WEBCRAWL_CHROME_PATH = bin;
    const t0 = Date.now();
    try {
      const out = await renderViaLocalChromeDetailed("https://example.com/", { timeoutMs: 2500 });
      const ms = Date.now() - t0;
      assert.equal(out.html, null);
      assert.ok(out.error && /JavaScript rendering failed|timed out|no content|never became ready/i.test(out.error), out.error);
      assert.ok(ms < 12_000, `hang should die in a few seconds, took ${ms}ms`);
      assert.ok(out.attempts.length >= 1);
      assert.equal(out.attempts.every((a) => a.ok === false), true);
    } finally {
      if (prev === undefined) delete process.env.WEBCRAWL_CHROME_PATH;
      else process.env.WEBCRAWL_CHROME_PATH = prev;
    }
  });

  it("dump-dom fallback still works when a stub binary prints HTML", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wc-dump-chrome-"));
    const bin = join(dir, "dump-chrome");
    writeFileSync(
      bin,
      `#!/bin/sh
if echo "$*" | grep -q -- --dump-dom; then
  printf '%s' '<html><body><h1>Rendered</h1><p>Enough content for the markdown floor check to pass.</p></body></html>'
  exit 0
fi
exit 1
`
    );
    chmodSync(bin, 0o755);
    const prev = process.env.WEBCRAWL_CHROME_PATH;
    process.env.WEBCRAWL_CHROME_PATH = bin;
    try {
      const out = await renderViaLocalChromeDetailed("https://example.com/", { timeoutMs: 8000 });
      assert.ok(out.html && /Enough content for the markdown floor/.test(out.html), JSON.stringify(out));
      assert.match(String(out.method), /dump-dom/);
    } finally {
      if (prev === undefined) delete process.env.WEBCRAWL_CHROME_PATH;
      else process.env.WEBCRAWL_CHROME_PATH = prev;
    }
  });
});
