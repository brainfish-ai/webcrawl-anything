/**
 * Scripts that run inside the interact sandbox VM.
 *
 * Layout inside the VM:
 *   /opt/wc/node_modules/playwright   Playwright client (used over CDP only)
 *   /opt/wc/step.mjs                  runs ONE action against the live browser
 *   Chromium listens on 127.0.0.1:9222 (started detached, survives across commands)
 *
 * The step runner is plain JS so it can also run locally against a desktop
 * Chromium in tests (set WC_PLAYWRIGHT / WC_CDP).
 */

export const VM_ROOT = "/opt/wc";
export const CDP_PORT = 9222;
export const STEP_SCRIPT_PATH = `${VM_ROOT}/step.mjs`;

/** Shared libraries Chromium needs on Amazon Linux 2023 (sandbox base image). */
const CHROMIUM_DNF_DEPS = [
  "nss",
  "nspr",
  "atk",
  "at-spi2-atk",
  "cups-libs",
  "libdrm",
  "libXcomposite",
  "libXdamage",
  "libXrandr",
  "libXfixes",
  "mesa-libgbm",
  "pango",
  "alsa-lib",
  "libxkbcommon",
  "libxshmfence",
].join(" ");

/** One-time VM setup. Baked into a snapshot; also used as a slow fallback. */
export const SETUP_SCRIPT = [
  "set -e",
  `dnf install -y ${CHROMIUM_DNF_DEPS} >/tmp/wc-dnf.log 2>&1`,
  `mkdir -p ${VM_ROOT} && cd ${VM_ROOT}`,
  "[ -f package.json ] || npm init -y >/dev/null",
  "npm i playwright@1 >/tmp/wc-npm.log 2>&1",
  "npx playwright install chromium >/tmp/wc-pw.log 2>&1",
  `node -e "console.log(require('playwright').chromium.executablePath())" > ${VM_ROOT}/chrome-path`,
  `cat ${VM_ROOT}/chrome-path`,
].join(" && ");

export function chromeArgs(opts: { userAgent?: string; width?: number; height?: number } = {}): string[] {
  const args = [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${CDP_PORT}`,
    "--remote-debugging-address=127.0.0.1",
    "--user-data-dir=/tmp/wc-profile",
    // Hide the automation flag (navigator.webdriver) that bot checks look for.
    "--disable-blink-features=AutomationControlled",
    `--window-size=${opts.width ?? 1280},${opts.height ?? 800}`,
  ];
  if (opts.userAgent) args.push(`--user-agent=${opts.userAgent}`);
  args.push("about:blank");
  return args;
}

/** Waits until the CDP endpoint answers. Exit 1 if it never does. */
export const WAIT_FOR_CDP_SCRIPT = `for i in $(seq 1 50); do curl -sf http://127.0.0.1:${CDP_PORT}/json/version >/dev/null && echo up && exit 0; sleep 0.2; done; echo "browser did not start" >&2; exit 1`;

/**
 * Step runner. Usage: node step.mjs '<json action>'
 * Prints exactly one line: `WCRESULT {"ok":true,...}`.
 * Never throws: failures are reported as { ok: false, error }.
 */
export const STEP_SCRIPT = String.raw`
const PW = process.env.WC_PLAYWRIGHT || "/opt/wc/node_modules/playwright/index.mjs";
const CDP = process.env.WC_CDP || "http://127.0.0.1:9222";
const { chromium } = await import(PW);

const action = JSON.parse(process.argv[2] || "{}");
const timeout = Math.max(500, Math.min(Number(action.timeoutMs) || 10000, 30000));
const out = (r) => { process.stdout.write("WCRESULT " + JSON.stringify(r) + "\n"); };

let browser;
try {
  const cdpHeaders = process.env.WC_CDP_HEADERS ? JSON.parse(process.env.WC_CDP_HEADERS) : undefined;
  browser = await chromium.connectOverCDP(CDP, { timeout: 15000, ...(cdpHeaders ? { headers: cdpHeaders } : {}) });
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.setDefaultTimeout(timeout);
  const sel = action.selector ? String(action.selector) : undefined;
  const need = () => { if (!sel) throw new Error("selector is required for " + action.type); return sel; };
  // Fail fast with a clear message when the selector matches nothing.
  const locate = async () => {
    const loc = page.locator(need()).first();
    try {
      await loc.waitFor({ state: "attached", timeout });
    } catch {
      throw new Error("No element matches selector " + JSON.stringify(sel));
    }
    return loc;
  };
  let data;

  switch (action.type) {
    case "goto": {
      const resp = await page.goto(String(action.url), { waitUntil: "domcontentloaded", timeout: Math.max(timeout, 20000) });
      data = { status: resp ? resp.status() : null };
      break;
    }
    case "wait": {
      if (sel) await (await locate()).waitFor({ state: "visible", timeout });
      else await page.waitForTimeout(Math.max(0, Math.min(Number(action.ms) || 500, 15000)));
      break;
    }
    case "click": await (await locate()).click({ timeout }); break;
    case "hover": await (await locate()).hover({ timeout }); break;
    case "fill": await (await locate()).fill(String(action.text ?? action.value ?? ""), { timeout }); break;
    case "type": await (await locate()).pressSequentially(String(action.text ?? action.value ?? ""), { delay: 20, timeout }); break;
    case "select": await (await locate()).selectOption(String(action.value ?? action.text ?? ""), { timeout }); break;
    case "press": {
      const key = String(action.key || "Enter");
      if (sel) await (await locate()).press(key, { timeout });
      else await page.keyboard.press(key);
      break;
    }
    case "scroll": {
      if (sel) await (await locate()).scrollIntoViewIfNeeded({ timeout });
      else await page.mouse.wheel(0, Number(action.y ?? action.amount ?? 800));
      await page.waitForTimeout(300);
      break;
    }
    case "evaluate": {
      const script = String(action.script ?? action.expression ?? "");
      if (!script) throw new Error("script is required for evaluate");
      const value = await page.evaluate(script);
      let json = JSON.stringify(value ?? null);
      if (json.length > 8192) json = JSON.stringify(json.slice(0, 8192) + "…");
      data = { value: JSON.parse(json) };
      break;
    }
    case "extract": {
      const loc = await locate();
      const html = await loc.evaluate((el) => el.outerHTML);
      data = { html: html.slice(0, 2000000) };
      break;
    }
    case "snapshot": {
      try { await page.waitForLoadState("networkidle", { timeout: 3000 }); } catch {}
      data = { html: (await page.content()).slice(0, 4000000) };
      break;
    }
    case "fetchMany": {
      // Stealth fetch: pass the bot check once on the entry page in a real browser,
      // then read every item with the cleared session (same IP, cookies, TLS).
      const items = Array.isArray(action.items) ? action.items.slice(0, 40) : [];
      const budget = Math.max(5000, Math.min(Number(action.budgetMs) || 60000, 240000));
      const solveMs = Math.max(2000, Math.min(Number(action.solveMs) || 20000, 45000));
      const PER_DOC = 1500000;
      const TOTAL = 10000000;
      const started = Date.now();
      const markers = ["vercel security checkpoint", "just a moment...", "cf-browser-verification", "challenge-platform", "_cf_chl_opt", "enable javascript and cookies to continue", "_vercel/security", "attention required! | cloudflare"];
      const looksBlocked = (s) => { const l = String(s || "").slice(0, 8000).toLowerCase(); return markers.some((m) => l.includes(m)); };
      let ua = "";
      try {
        const cdp = await ctx.newCDPSession(page);
        const ver = await cdp.send("Browser.getVersion");
        ua = String(ver.userAgent || "").replace(/HeadlessChrome/g, "Chrome");
        // A remote provider's browser already has a coherent fingerprint; overriding it would break that.
        if (action.keepFingerprint) throw new Error("keep");
        const major = (ua.match(/Chrome\/(\d+)/) || [])[1] || "140";
        const full = (ua.match(/Chrome\/([\d.]+)/) || [])[1] || major + ".0.0.0";
        await cdp.send("Emulation.setUserAgentOverride", {
          userAgent: ua,
          acceptLanguage: "en-US,en;q=0.9",
          platform: "Linux x86_64",
          userAgentMetadata: {
            brands: [{ brand: "Chromium", version: major }, { brand: "Google Chrome", version: major }, { brand: "Not.A/Brand", version: "99" }],
            fullVersion: full, platform: "Linux", platformVersion: "6.1.0", architecture: "x86", model: "", mobile: false,
          },
        });
        await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: "Object.defineProperty(Navigator.prototype,'webdriver',{get:()=>false});" });
      } catch {}
      // Remote browsers bill proxy traffic per GB: skip bytes markdown never uses.
      if (action.lightweight) {
        const skip = new Set(["image", "media", "font"]);
        await page.route("**/*", (r) => (skip.has(r.request().resourceType()) ? r.abort() : r.continue())).catch(() => {});
      }
      let navStatus = null;
      page.on("response", (r) => { try { if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) navStatus = r.status(); } catch {} });
      const render = async (url, wait) => {
        navStatus = null;
        try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: Math.min(30000, wait + 10000) }); } catch (e) { if (navStatus === null) throw e; }
        const deadline = Date.now() + wait;
        let html = "";
        for (;;) {
          html = await page.content().catch(() => "");
          if ((html && !looksBlocked(html)) || Date.now() > deadline) break;
          await page.waitForLoadState("load", { timeout: 2000 }).catch(() => {});
          await page.waitForTimeout(700);
        }
        try { await page.waitForLoadState("networkidle", { timeout: 2500 }); } catch {}
        html = await page.content().catch(() => html);
        const blocked = looksBlocked(html);
        return { status: blocked ? navStatus : (navStatus && navStatus < 400 ? navStatus : 200), contentType: "text/html", body: html, finalUrl: page.url(), title: await page.title().catch(() => ""), blocked };
      };
      const raw = async (url) => {
        let sameOrigin = false;
        try { sameOrigin = new URL(url).origin === new URL(page.url()).origin; } catch {}
        if (sameOrigin) {
          const r = await page.evaluate(async (u) => {
            const res = await fetch(u, { credentials: "include", redirect: "follow" });
            return { status: res.status, contentType: res.headers.get("content-type") || "", body: await res.text(), finalUrl: res.url };
          }, url);
          return { ...r, title: "", blocked: r.status === 429 || looksBlocked(r.body) };
        }
        const res = await ctx.request.get(url, { timeout: 15000 });
        const body = await res.text();
        return { status: res.status(), contentType: res.headers()["content-type"] || "", body, finalUrl: res.url(), title: "", blocked: res.status() === 429 || looksBlocked(body) };
      };
      let total = 0;
      const clip = (d) => {
        const room = Math.max(0, Math.min(PER_DOC, TOTAL - total));
        const body = String(d.body || "").slice(0, room);
        total += body.length;
        return { ...d, body };
      };
      let entry = null;
      if (action.entry) {
        try { entry = clip(await render(String(action.entry), solveMs)); } catch (e) { entry = { blocked: true, error: String(e && e.message || e).split("\n")[0].slice(0, 300) }; }
      }
      const docs = [];
      const queue = items.slice();
      const seen = new Set(queue.map((it) => String(it && it.url || "")));
      const maxFollow = Math.max(0, Math.min(Number(action.followSitemaps) || 0, 20));
      let followed = 0;
      // Queue sitemaps named in robots.txt or a sitemap index, read in this same session.
      const follow = (d) => {
        if (!maxFollow || !d.body || d.blocked || (d.status || 200) >= 400) return;
        const found = [];
        if (/\/robots\.txt(\?|$)/i.test(d.url)) {
          for (const m of String(d.body).matchAll(/^\s*Sitemap:\s*(\S+)/gim)) found.push(m[1].trim());
        } else if (/<sitemapindex[\s>]/i.test(d.body)) {
          for (const m of String(d.body).matchAll(/<loc>\s*(?:<!\[CDATA\[)?([^<\]]+?)(?:\]\]>)?\s*<\/loc>/gi)) found.push(m[1].trim().replace(/&amp;/g, "&"));
        }
        for (const u of found) {
          if (followed >= maxFollow || seen.has(u)) continue;
          seen.add(u); followed++;
          queue.push({ url: u, raw: true });
        }
      };
      while (queue.length) {
        const it = queue.shift();
        const url = String(it && it.url || "");
        if (!url) continue;
        if (Date.now() - started > budget) { docs.push({ url, ok: false, error: "Ran out of time" }); continue; }
        try {
          let d = it.raw ? await raw(url) : await render(url, Math.min(solveMs, 10000));
          // A raw read that still hits the check gets one rendered attempt.
          if (d.blocked && it.raw) d = await render(url, Math.min(solveMs, 10000));
          const doc = { url, ok: true, ...clip(d) };
          docs.push(doc);
          follow(doc);
        } catch (e) {
          docs.push({ url, ok: false, error: String(e && e.message || e).split("\n")[0].slice(0, 300) });
        }
      }
      data = { value: { entry, docs, solved: entry ? !entry.blocked : true, userAgent: ua } };
      break;
    }
    default:
      throw new Error("Unsupported action type " + JSON.stringify(action.type));
  }

  out({ ok: true, url: page.url(), title: await page.title().catch(() => ""), data });
} catch (err) {
  const msg = err && err.message ? String(err.message).split("\n")[0] : String(err);
  out({ ok: false, error: msg.slice(0, 500) });
} finally {
  // Disconnect only; the browser keeps running for the next step.
  if (browser) await browser.close().catch(() => {});
}
`;

export type StepResultLine = {
  ok: boolean;
  url?: string;
  title?: string;
  error?: string;
  data?: { status?: number | null; html?: string; value?: unknown };
};

/** Parses the WCRESULT line emitted by STEP_SCRIPT. */
export function parseStepOutput(stdout: string, stderr = ""): StepResultLine {
  const line = stdout
    .split("\n")
    .reverse()
    .find((l) => l.startsWith("WCRESULT "));
  if (!line) {
    const tail = (stderr || stdout).trim().split("\n").slice(-3).join(" ").slice(0, 400);
    return { ok: false, error: tail || "Step produced no result" };
  }
  try {
    return JSON.parse(line.slice("WCRESULT ".length)) as StepResultLine;
  } catch {
    return { ok: false, error: "Step result was not valid JSON" };
  }
}
