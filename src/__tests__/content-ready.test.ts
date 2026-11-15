import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONTENT_READY_MAX_WAIT_MS,
  CONTENT_STABLE_MS,
  WAIT_FOR_CONTENT_READY_FN,
  buildWaitForContentReadyExpression,
  isContentReadySnapshot,
  looksLikeLoadingPlaceholder,
  type ContentReadySnapshot,
} from "../engine/content-ready.js";
import {
  SPA_MARKER,
  startSpaLateLoadServer,
} from "./fixtures/spa-late-load.js";
import {
  isLocalChromeAvailable,
  renderViaLocalChromeDetailed,
} from "../engine/chrome.js";
import { fastHtmlToMarkdown } from "../engine/markdown.js";
import {
  chromeAttemptsDetail,
  timingBudget,
  warmLocalChrome,
  withChromeTestLock,
} from "./helpers/chrome-timing.js";

describe("content-ready helpers", () => {
  it("treats loading placeholders and near-empty bodies as not ready", () => {
    assert.equal(looksLikeLoadingPlaceholder("Loading..."), true);
    assert.equal(looksLikeLoadingPlaceholder("Please wait"), true);
    assert.equal(looksLikeLoadingPlaceholder("", { hasVisibleLoadingUi: true }), true);
    assert.equal(looksLikeLoadingPlaceholder("hi", { hasVisibleLoadingUi: true }), true);
    // Bare tiny pages without loading UI are allowed to finish.
    assert.equal(looksLikeLoadingPlaceholder("OK"), false);
    assert.equal(
      looksLikeLoadingPlaceholder("Welcome to the dashboard. Loading your data…", {
        hasVisibleLoadingUi: true,
      }),
      true
    );
    assert.equal(
      looksLikeLoadingPlaceholder(
        `The delayed API finally rendered this paragraph. ${SPA_MARKER}`
      ),
      false
    );
  });

  it("requires a stable quiet window before declaring content ready", () => {
    const loading: ContentReadySnapshot = {
      html: '<div id="root">Loading...</div>',
      title: "t",
      textLen: 10,
      readyState: "complete",
      elemCount: 5,
      loading: true,
    };
    const ready: ContentReadySnapshot = {
      html: `<article>${SPA_MARKER}</article>`,
      title: "t",
      textLen: 120,
      readyState: "complete",
      elemCount: 12,
      loading: false,
    };
    assert.equal(
      isContentReadySnapshot(loading, null, { quietMs: 500, stableMs: CONTENT_STABLE_MS }),
      false
    );
    assert.equal(
      isContentReadySnapshot(ready, ready, { quietMs: 200, stableMs: CONTENT_STABLE_MS }),
      false
    );
    assert.equal(
      isContentReadySnapshot(ready, ready, { quietMs: 500, stableMs: CONTENT_STABLE_MS }),
      true
    );
  });

  it("builds a capped wait expression for CDP evaluate", () => {
    assert.ok(WAIT_FOR_CONTENT_READY_FN.includes("stableMs"));
    assert.ok(WAIT_FOR_CONTENT_READY_FN.includes("loading"));
    const expr = buildWaitForContentReadyExpression(12_000);
    assert.match(expr, /\(10000\)$/);
    assert.ok(CONTENT_READY_MAX_WAIT_MS >= 8_000);
  });

  it("scales Chrome timing budgets on CI without changing the base locally", () => {
    const prevFactor = process.env.WEBCRAWL_TEST_TIMING_FACTOR;
    const prevCi = process.env.CI;
    const prevGa = process.env.GITHUB_ACTIONS;
    try {
      delete process.env.WEBCRAWL_TEST_TIMING_FACTOR;
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      assert.equal(timingBudget(8_000), 8_000);
      process.env.CI = "true";
      assert.equal(timingBudget(8_000), 16_000);
      process.env.WEBCRAWL_TEST_TIMING_FACTOR = "1.5";
      assert.equal(timingBudget(8_000), 12_000);
    } finally {
      if (prevFactor === undefined) delete process.env.WEBCRAWL_TEST_TIMING_FACTOR;
      else process.env.WEBCRAWL_TEST_TIMING_FACTOR = prevFactor;
      if (prevCi === undefined) delete process.env.CI;
      else process.env.CI = prevCi;
      if (prevGa === undefined) delete process.env.GITHUB_ACTIONS;
      else process.env.GITHUB_ACTIONS = prevGa;
    }
  });
});

describe("SPA late-load Chrome readiness", () => {
  it("waits for short, long, and quiet-then-fetch SPA content", async (t) => {
    if (!isLocalChromeAvailable()) {
      t.skip("local Chrome not available");
      return;
    }
    await withChromeTestLock(async () => {
      const server = await startSpaLateLoadServer();
      try {
        const warm = await warmLocalChrome(server.urlFor("static"));
        assert.ok(
          warm.html && /STATIC_PAGE_MARKER/.test(warm.html),
          `Chrome warmup failed: ${chromeAttemptsDetail(warm)}`
        );

        for (const variant of ["short", "long", "quiet-then-fetch"] as const) {
          const url = server.urlFor(variant);
          const t0 = Date.now();
          const out = await renderViaLocalChromeDetailed(url, {
            timeoutMs: 18_000,
            connectTimeoutMs: 6_000,
          });
          const ms = Date.now() - t0;
          assert.ok(
            out.html,
            `${variant}: ${out.error || "empty"} (${chromeAttemptsDetail(out)})`
          );
          assert.match(out.html!, new RegExp(SPA_MARKER));
          assert.match(out.html!, /data-content-ready="true"/);
          // Long / quiet-then-fetch must wait past the old ~2.5s networkidle cap.
          // Wall-clock caps assume a warm browser; CI scales via timingBudget().
          const upper = timingBudget(16_000);
          if (variant === "short") {
            assert.ok(
              ms < upper,
              `${variant} should settle after 1.5s fetch without hanging, took ${ms}ms (budget ${upper}ms)`
            );
          } else {
            assert.ok(ms > 3_000, `${variant} finished too fast (${ms}ms)`);
            assert.ok(
              ms < upper,
              `${variant} should not hang past the hard cap, took ${ms}ms (budget ${upper}ms)`
            );
          }
        }
      } finally {
        await server.close();
      }
    });
  });

  it("keeps static pages fast and leaves the non-JS fetch path alone", async (t) => {
    if (!isLocalChromeAvailable()) {
      t.skip("local Chrome not available");
      return;
    }
    await withChromeTestLock(async () => {
      const server = await startSpaLateLoadServer();
      try {
        const staticUrl = server.urlFor("static");

        // Non-JS fetch path: plain HTTP, no Chrome, no readiness wait.
        const fetchT0 = Date.now();
        const res = await fetch(staticUrl, { signal: AbortSignal.timeout(5_000) });
        const html = await res.text();
        const fetchMs = Date.now() - fetchT0;
        assert.match(html, /STATIC_PAGE_MARKER/);
        assert.ok(fetchMs < timingBudget(500), `static fetch took ${fetchMs}ms`);
        const md = fastHtmlToMarkdown(html, staticUrl);
        assert.match(md.markdown, /STATIC_PAGE_MARKER/);

        // Warm once, then time a static Chrome render so cold start is not
        // counted against the "stay fast" budget.
        const warm = await warmLocalChrome(staticUrl);
        assert.ok(warm.html, `Chrome warmup failed: ${chromeAttemptsDetail(warm)}`);

        const chromeT0 = Date.now();
        const out = await renderViaLocalChromeDetailed(staticUrl, {
          timeoutMs: 12_000,
          connectTimeoutMs: 6_000,
        });
        const chromeMs = Date.now() - chromeT0;
        assert.ok(out.html, out.error);
        assert.match(out.html!, /STATIC_PAGE_MARKER/);
        const chromeBudget = timingBudget(6_000);
        assert.ok(
          chromeMs < chromeBudget,
          `static Chrome render should stay fast, took ${chromeMs}ms (budget ${chromeBudget}ms)`
        );
        console.log(
          JSON.stringify({
            timing: {
              staticFetchMs: fetchMs,
              staticChromeMs: chromeMs,
              chromeBudget,
            },
          })
        );
      } finally {
        await server.close();
      }
    });
  });
});
