/**
 * Helpers for Chrome integration tests that time readiness waits.
 *
 * Node's test runner executes files in parallel child processes, so cold
 * Chrome launches from content-ready / SPA suites (and the hung-binary
 * chrome-driver case) compete for CPU on shared CI runners. Wall-clock
 * budgets then include cold start + contention and flake.
 *
 * These helpers:
 *   1. Serialize real Chrome work across test processes (file lock)
 *   2. Warm a browser before timed cases so launch cost is not in the budget
 *   3. Scale wall-clock budgets on CI without relaxing content assertions
 */
import { closeSync, openSync, unlinkSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  renderViaLocalChromeDetailed,
  type ChromeRenderResult,
} from "../../engine/chrome.js";

const LOCK_PATH = join(tmpdir(), "webcrawl-chrome-test.lock");
const LOCK_STALE_MS = 5 * 60_000;

/** Multiply timing budgets on CI (or via WEBCRAWL_TEST_TIMING_FACTOR). Content checks stay strict. */
export function timingBudget(baseMs: number): number {
  const raw = process.env.WEBCRAWL_TEST_TIMING_FACTOR;
  let factor = 1;
  if (raw != null && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) factor = n;
  } else if (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true") {
    // Shared runners are routinely 1.5–2× slower under Chrome load than a quiet laptop.
    factor = 2;
  }
  return Math.ceil(baseMs * factor);
}

function tryRemoveStaleLock(): void {
  try {
    const age = Date.now() - statSync(LOCK_PATH).mtimeMs;
    if (age > LOCK_STALE_MS) unlinkSync(LOCK_PATH);
  } catch {
    /* missing or busy */
  }
}

/**
 * Cross-process mutex so only one Chrome integration suite drives a browser
 * at a time. No-ops quickly when nothing else holds the lock.
 */
export async function withChromeTestLock<T>(fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 3 * 60_000;
  for (;;) {
    tryRemoveStaleLock();
    let fd: number | undefined;
    try {
      fd = openSync(LOCK_PATH, "wx");
      writeFileSync(fd, `${process.pid}\n${Date.now()}\n`);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for Chrome test lock at ${LOCK_PATH}`);
      }
      await new Promise((r) => setTimeout(r, 150));
      continue;
    }
    try {
      return await fn();
    } finally {
      try {
        if (fd !== undefined) closeSync(fd);
      } catch {
        /* already closed */
      }
      try {
        unlinkSync(LOCK_PATH);
      } catch {
        /* another waiter may have cleaned up */
      }
    }
  }
}

/** Discard one render so subsequent timed cases do not pay cold-start cost. */
export async function warmLocalChrome(url: string): Promise<ChromeRenderResult> {
  return renderViaLocalChromeDetailed(url, {
    timeoutMs: 18_000,
    // Cold connect on a busy CI runner can exceed the default 4s.
    connectTimeoutMs: 8_000,
  });
}

export function chromeAttemptsDetail(out: ChromeRenderResult): string {
  if (!out.attempts.length) return out.error || "no attempts";
  return out.attempts
    .map((a) => `${a.method}:${a.ok ? "ok" : "fail"}:${a.ms}ms${a.error ? `(${a.error})` : ""}`)
    .join("; ");
}
