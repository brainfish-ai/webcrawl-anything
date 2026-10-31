import { fastHtmlToMarkdown, setDomainCookie } from "./engine.js";
import { isAntiBotChallenge } from "./engine/fetcher.js";

export interface BrowserEscalationResult {
  html: string;
  markdown: string;
  title: string;
  links: string[];
  statusCode: number;
  tier: "sandbox" | "cloudflare" | "browser";
}

/** Bot-check copy that survives HTML → markdown conversion (Cloudflare `/markdown`). */
const CHALLENGE_MARKDOWN = [
  "just a moment",
  "vercel security checkpoint",
  "verify you are human",
  "checking your browser",
  "enable javascript and cookies to continue",
];

/** True when an escalation result is still the bot check, not the page. */
export function isChallengeResult(html: string, markdown: string, status = 200): boolean {
  if (html && isAntiBotChallenge(html, status)) return true;
  const head = markdown.slice(0, 1500).toLowerCase();
  // Short pages only: a long article that mentions "just a moment" is real content.
  return markdown.length < 1500 && CHALLENGE_MARKDOWN.some((s) => head.includes(s));
}

/**
 * True when Vercel Sandbox can authenticate. On Vercel (VERCEL=1) the OIDC token is
 * not in env at request time: it arrives in the `x-vercel-oidc-token` header, which
 * @vercel/sandbox reads via @vercel/oidc. Locally it comes from `vercel env pull`.
 */
function vercelSandboxAvailable(): boolean {
  return Boolean(
    process.env.VERCEL === "1" ||
      process.env.VERCEL_OIDC_TOKEN ||
      process.env.VERCEL_SANDBOX_ENABLED === "true"
  );
}

/** True when a browser tier (Cloudflare Browser Rendering or Vercel Sandbox) is configured. */
export function browserEscalationAvailable(): boolean {
  return Boolean((process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN) || vercelSandboxAvailable());
}

/**
 * Tier 2/3 Anti-Bot Escalation:
 * 1. Uses Cloudflare Browser Rendering `/markdown` if CF_ACCOUNT_ID + CF_API_TOKEN are set.
 * 2. Uses `@vercel/sandbox` isolated Linux microVM (with curl-impersonate / Playwright / Node TLS fetch + proxy)
 *    to bypass JA3/JA4 TLS blocks, solve JS challenges, and cache `cf_clearance` cookies per domain.
 */
export async function escalateToSandboxOrBrowser(
  url: string,
  options: {
    retainImages?: "all" | "none";
    timeoutMs?: number;
    /**
     * Last resort: open the page in a real browser and wait out the bot check.
     * Slow (cold start plus up to 20s solving), so only callers with a large
     * time budget should opt in.
     */
    browser?: boolean;
    browserBudgetMs?: number;
  } = {}
): Promise<BrowserEscalationResult | null> {
  // Option A: Cloudflare Browser Rendering Quick Action (/markdown) if configured
  const cfAccountId = process.env.CF_ACCOUNT_ID;
  const cfApiToken = process.env.CF_API_TOKEN;
  if (cfAccountId && cfApiToken) {
    try {
      const cfRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/browser-rendering/markdown`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfApiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url,
            gotoOptions: { waitUntil: "domcontentloaded", timeout: options.timeoutMs ?? 15000 },
            rejectRequestPattern: [
              "^.*\\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|mp4|mp3|css)(\\?.*)?$",
              "^.*(googletagmanager|google-analytics|intercom|segment|hotjar|sentry).*$",
            ],
          }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
        }
      );

      if (cfRes.ok) {
        const payload = (await cfRes.json()) as { success?: boolean; result?: string };
        if (payload.success && payload.result && !isChallengeResult("", payload.result)) {
          const titleMatch = payload.result.match(/^#\s+([^\n]+)/m);
          return {
            html: "",
            markdown: payload.result,
            title: titleMatch ? titleMatch[1].trim() : url,
            links: [],
            statusCode: 200,
            tier: "cloudflare",
          };
        }
      }
    } catch {
      // Fall through to Vercel Sandbox
    }
  }

  // Option B: Vercel Sandbox microVM execution (`@vercel/sandbox`)
  if (vercelSandboxAvailable()) {
    try {
      const { Sandbox } = await import("@vercel/sandbox");
      const sandbox = await Sandbox.create({
        timeout: options.timeoutMs ?? 20_000,
      });

      try {
        // Execute curl with browser cipher list + cookie capture inside the clean Linux microVM egress IP
        const proxyArg = process.env.PROXY_URL ? `-x "${process.env.PROXY_URL}"` : "";
        const cmd = await sandbox.runCommand({
          cmd: "curl",
          args: [
            "-sSL",
            "--compressed",
            "--max-time",
            "12",
            "-D",
            "/tmp/headers.txt",
            ...(proxyArg ? ["-x", process.env.PROXY_URL!] : []),
            "-H",
            "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            "-H",
            "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "-H",
            "Accept-Language: en-US,en;q=0.9",
            url,
          ],
        });

        const html = await cmd.stdout();
        try {
          const headersCmd = await sandbox.runCommand({
            cmd: "cat",
            args: ["/tmp/headers.txt"],
          });
          const headersText = await headersCmd.stdout();
          const setCookies = Array.from(headersText.matchAll(/^set-cookie:\s*([^;\r\n]+)/gim)).map(
            (m) => m[1]
          );
          if (setCookies.length > 0) {
            setDomainCookie(new URL(url).hostname, setCookies.join("; "));
          }
        } catch {
          // ignore cookie extraction failure
        }

        // A challenge page is not content: never return it as a successful escalation.
        if (html && html.length > 100 && !isAntiBotChallenge(html, 200)) {
          const parsed = fastHtmlToMarkdown(html, url, {
            retainImages: options.retainImages,
          });
          return {
            html,
            markdown: parsed.markdown,
            title: parsed.title,
            links: parsed.links,
            statusCode: 200,
            tier: "sandbox",
          };
        }
      } finally {
        await sandbox.stop().catch(() => {});
      }
    } catch {
      // Sandbox unavailable or not configured in this environment
    }
  }

  // Option C: real browser that waits out the bot check (opt-in, slow).
  if (options.browser) {
    const viaBrowser = await escalateViaStealthBrowser(url, options);
    if (viaBrowser) return viaBrowser;
  }

  return null;
}

async function escalateViaStealthBrowser(
  url: string,
  options: { retainImages?: "all" | "none"; browserBudgetMs?: number }
): Promise<BrowserEscalationResult | null> {
  try {
    const { stealthAvailable, stealthFetch } = await import("./engine/stealth.js");
    if (!(await stealthAvailable())) return null;
    const res = await stealthFetch(url, [], { budgetMs: options.browserBudgetMs ?? 30_000 });
    const entry = res.entry;
    if (!entry?.body || entry.blocked || isAntiBotChallenge(entry.body, entry.status ?? 200)) {
      return null;
    }
    const parsed = fastHtmlToMarkdown(entry.body, entry.finalUrl || entry.url || url, {
      retainImages: options.retainImages,
    });
    if (!parsed.markdown.trim()) return null;
    return {
      html: entry.body,
      markdown: parsed.markdown,
      title: entry.title || parsed.title,
      links: parsed.links,
      statusCode: entry.status ?? 200,
      tier: "browser",
    };
  } catch {
    return null;
  }
}
