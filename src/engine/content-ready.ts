/**
 * Shared "page content looks stable" readiness helpers for JS rendering.
 *
 * Used by the local Chrome CDP path and the Playwright stealth/vm render
 * path. Static (non-JS) fetch is unaffected.
 *
 * Strategy after document load:
 *   1. Poll main-content text length and DOM mutation activity.
 *   2. Treat loading placeholders, skeleton/spinner markers, and near-empty
 *      bodies as not ready.
 *   3. Return once content is stable for a short window (~500ms), or when
 *      the hard overall cap is hit so fast pages stay fast.
 */

/** How long main content must stay unchanged before we call it ready. */
export const CONTENT_STABLE_MS = 500;

/** Poll interval while waiting for content to settle. */
export const CONTENT_POLL_MS = 120;

/**
 * Hard cap on the post-load readiness wait. Kept well under the default
 * Chrome page budget (18s) so a hung SPA cannot burn the whole attempt.
 * Override via `maxWaitMs` on the browser expression builder.
 */
export const CONTENT_READY_MAX_WAIT_MS = 10_000;

/** Below this trimmed body text length, content is treated as not ready. */
export const CONTENT_MIN_TEXT_LEN = 40;

/** Meaningful growth thresholds (ignore tiny spinner tick updates). */
export const CONTENT_TEXT_GROWTH = 20;
export const CONTENT_ELEM_GROWTH = 2;

const LOADING_ONLY_RE =
  /^(loading|please wait|spinner|skeleton|fetching|coming soon)([\s.…!]*)$/i;

const LOADING_PHRASE_RE =
  /\b(loading(\s+(please\s+)?wait)?|please\s+wait|fetching(\s+data)?|content\s+is\s+loading|still\s+loading)\b/i;

const SKELETON_ATTR_RE =
  /\b(skeleton|spinner|loading-spinner|animate-pulse|aria-busy\s*=\s*["']true["']|data-loading\s*=\s*["']true["']|role\s*=\s*["']progressbar["'])\b/i;

/**
 * True when visible text / markup still looks like a loading shell rather
 * than real page content. Exported for unit tests and callers that inspect
 * a snapshot without running the browser wait loop.
 */
export function looksLikeLoadingPlaceholder(
  text: string,
  html = "",
  opts: { minTextLen?: number } = {}
): boolean {
  const minTextLen = opts.minTextLen ?? CONTENT_MIN_TEXT_LEN;
  const trimmed = String(text || "").replace(/\s+/g, " ").trim();
  if (trimmed.length < minTextLen) return true;
  if (LOADING_ONLY_RE.test(trimmed)) return true;

  // Short shells that are mostly a loading phrase are not ready yet.
  if (trimmed.length < 160 && LOADING_PHRASE_RE.test(trimmed)) return true;

  // Skeleton / spinner markup with little real text.
  if (trimmed.length < 240 && SKELETON_ATTR_RE.test(String(html || ""))) return true;

  return false;
}

export interface ContentReadySnapshot {
  html: string;
  title: string;
  textLen: number;
  readyState: string;
  elemCount: number;
  loading: boolean;
}

export interface ContentReadyOptions {
  /** Overall post-load wait cap in ms (default CONTENT_READY_MAX_WAIT_MS). */
  maxWaitMs?: number;
  stableMs?: number;
  pollMs?: number;
  minTextLen?: number;
}

/**
 * Async function source evaluated inside the page (CDP Runtime.evaluate or
 * Playwright page.evaluate). Takes maxWaitMs as its sole argument.
 */
export const WAIT_FOR_CONTENT_READY_FN = String.raw`async (maxWaitMs) => {
  const STABLE_MS = 500;
  const POLL_MS = 120;
  const MIN_TEXT = 40;
  const TEXT_GROWTH = 20;
  const ELEM_GROWTH = 2;
  const loadingOnly = /^(loading|please wait|spinner|skeleton|fetching|coming soon)([\s.…!]*)$/i;
  const loadingPhrase = /\b(loading(\s+(please\s+)?wait)?|please\s+wait|fetching(\s+data)?|content\s+is\s+loading|still\s+loading)\b/i;
  // Only inspect the live document shell for skeleton markers, not inline
  // script source that may mention "spinner" as a string.
  const skeletonAttr = /\b(skeleton|spinner|loading-spinner|animate-pulse|aria-busy\s*=\s*["']true["']|data-loading\s*=\s*["']true["']|role\s*=\s*["']progressbar["'])\b/i;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shellHtml = () => {
    try {
      const clone = document.documentElement.cloneNode(true);
      for (const s of clone.querySelectorAll("script, style, noscript")) s.remove();
      return clone.outerHTML || "";
    } catch (_) {
      return document.body ? document.body.innerHTML : "";
    }
  };
  const isLoading = (text, html) => {
    const trimmed = String(text || "").replace(/\s+/g, " ").trim();
    if (trimmed.length < MIN_TEXT) return true;
    if (loadingOnly.test(trimmed)) return true;
    if (trimmed.length < 160 && loadingPhrase.test(trimmed)) return true;
    if (trimmed.length < 240 && skeletonAttr.test(String(html || ""))) return true;
    return false;
  };
  const snap = () => {
    const body = document.body;
    const text = body && typeof body.innerText === "string" ? body.innerText.trim() : "";
    const html = document.documentElement ? document.documentElement.outerHTML : "";
    const shell = shellHtml();
    return {
      html,
      title: document.title || "",
      textLen: text.length,
      readyState: document.readyState || "",
      elemCount: document.getElementsByTagName("*").length,
      loading: isLoading(text, shell),
    };
  };
  const budget = Math.max(500, Math.min(Number(maxWaitMs) || 10000, 20000));
  const start = Date.now();
  let last = snap();
  let stableMs = 0;
  while (Date.now() - start < budget) {
    await sleep(POLL_MS);
    const now = snap();
    const grown =
      now.elemCount > last.elemCount + ELEM_GROWTH ||
      now.textLen > last.textLen + TEXT_GROWTH ||
      now.textLen + TEXT_GROWTH < last.textLen;
    if (now.loading || grown) stableMs = 0;
    else stableMs += POLL_MS;
    last = now;
    if (
      now.readyState === "complete" &&
      !now.loading &&
      now.textLen >= MIN_TEXT &&
      stableMs >= STABLE_MS
    ) break;
  }
  return last;
}`;

/** Build a `(async (maxWaitMs) => ...)(N)` expression for CDP evaluate. */
export function buildWaitForContentReadyExpression(maxWaitMs: number): string {
  const budget = Math.max(
    500,
    Math.min(Math.floor(maxWaitMs), CONTENT_READY_MAX_WAIT_MS, 20_000)
  );
  return `(${WAIT_FOR_CONTENT_READY_FN})(${budget})`;
}

/**
 * Decide whether a polled snapshot is ready. Node-side mirror of the
 * browser loop exit condition, used by unit tests.
 */
export function isContentReadySnapshot(
  snap: ContentReadySnapshot,
  prev: ContentReadySnapshot | null,
  opts: {
    quietMs: number;
    stableMs: number;
    minTextLen?: number;
  }
): boolean {
  const minTextLen = opts.minTextLen ?? CONTENT_MIN_TEXT_LEN;
  if (snap.readyState !== "complete") return false;
  if (snap.loading) return false;
  if (snap.textLen < minTextLen) return false;
  if (opts.quietMs < opts.stableMs) return false;
  if (!prev) return false;
  const grown =
    snap.elemCount > prev.elemCount + CONTENT_ELEM_GROWTH ||
    snap.textLen > prev.textLen + CONTENT_TEXT_GROWTH ||
    snap.textLen + CONTENT_TEXT_GROWTH < prev.textLen;
  return !grown;
}
