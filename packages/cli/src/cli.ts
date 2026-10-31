import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import {
  WebcrawlClient,
  WebcrawlError,
  configPath,
  describeError,
  readConfigFile,
  resolveConfig,
  writeConfigFile,
} from "@webcrawl/client";
import {
  formatCrawl,
  formatCredits,
  formatMap,
  formatRerank,
  formatScrape,
  formatSearch,
  formatTargets,
} from "./format.js";
import {
  SUPPORTED_AGENTS,
  runDoctor,
  runSetup,
  type SupportedAgentId,
} from "./setup.js";

export interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
  /** Whole stdin as text (only called when needed). */
  readStdin: () => Promise<string>;
  isTTY: boolean;
}

export interface Deps {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  /** Config file path override (tests). */
  configFile?: string;
  /** Home directory override for `webcrawl setup` tests. */
  homeDir?: string;
  /** Working directory override for `webcrawl setup` tests. */
  cwd?: string;
}

export const HELP = `Webcrawl Anything: search, scrape, parse and crawl any target on the internet

Usage: webcrawl <command> [options]

Commands
  search <query>      Search the web or verticals. -c category, --sub, -n limit, --site <domain>
  scrape <url>        Inspect a URL (website, SPA, PDF, Office, YouTube, GitHub, ArXiv, llms.txt)
  map <url>           List a site's URLs. --filter <text>, -n limit
  crawl <url>         Read several pages. -n max pages (default 5, max 25)
  extract <url>       Structured JSON. --prompt <text> or --schema <file.json>
  rerank <query>      Rank documents. --doc <text> (repeatable), --file <path>, or lines on stdin. -n top
  targets             List all supported crawl & search targets and their requirements
  categories          List search categories and vertical filters
  setup               Register Webcrawl MCP server and Agent Skill (Claude, Cursor, Codex, Gemini, Windsurf)
  doctor              Check local crawl engine, parsers, stealth browser, and cloud configuration
  login / signup      Create an account or sign in (--email <addr> [--code <6-digit>], --web, or --key <key>)
  whoami              Show execution mode (local vs cloud), account email, key source, and credit balance

Options
  --mode <m>          Execution mode: auto (default: local without key, cloud with key), local, or cloud
  --email <addr>      Email address for CLI account creation / OTP sign-in (assigns 1,000 free credits)
  --code <6-digit>    6-digit email verification code from \`webcrawl login --email <addr>\`
  --name <name>       Optional display name when creating an account with \`--email\`
  --web               Sign in or create an account in your browser via OAuth PKCE redirect
  --json              Print the raw JSON response
  --api-key <key>     Override WEBCRAWL_API_KEY
  --url <base>        Override WEBCRAWL_URL (default https://webcrawl.app)
  --country, --city   Where to search from (default: this machine's timezone)
  --no-cache          Skip cached pages (scrape)
  --agent <name>      Target agent for setup: claude, cursor, codex, gemini, windsurf, or all (repeatable)
  --schema-profile    MCP schema profile for setup: compact (default) or full
  -h, --help

Config order: flags, then WEBCRAWL_API_KEY / WEBCRAWL_URL / WEBCRAWL_MODE, then ~/.config/webcrawl/config.json`;

const OPTIONS = {
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  "api-key": { type: "string" },
  url: { type: "string" },
  mode: { type: "string" },
  category: { type: "string", short: "c" },
  sub: { type: "string" },
  limit: { type: "string", short: "n" },
  site: { type: "string", multiple: true },
  country: { type: "string" },
  city: { type: "string" },
  filter: { type: "string" },
  prompt: { type: "string" },
  schema: { type: "string" },
  doc: { type: "string", multiple: true },
  file: { type: "string" },
  key: { type: "string" },
  email: { type: "string" },
  code: { type: "string" },
  name: { type: "string" },
  web: { type: "boolean" },
  "no-wait": { type: "boolean" },
  "no-cache": { type: "boolean" },
  content: { type: "boolean" },
  agent: { type: "string", multiple: true },
  "schema-profile": { type: "string" },
} as const;

class UsageError extends Error {}

function int(v: string | undefined, name: string): number | undefined {
  if (v === undefined) {return undefined;}
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) {throw new UsageError(`${name} must be a positive whole number`);}
  return n;
}

async function promptLine(io: Io, promptText: string): Promise<string> {
  if (!io.isTTY) {
    return (await io.readStdin()).trim();
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(promptText, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });
}

async function readKeyInteractively(io: Io): Promise<string> {
  return promptLine(io, "Paste your API key (wc_live_…): ");
}

function openBrowserUrl(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    execFile(cmd, args, () => {
      // ignore browser launch errors in headless environments
    });
  } catch {
    // ignore
  }
}

async function runWebOAuthLogin(
  baseUrl: string,
  fetchImpl: typeof fetch,
  io: Io
): Promise<{ apiKey: string; email?: string; creditsRemaining?: number; creditsLimit?: number; plan?: string }> {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(16).toString("base64url");

  return new Promise((resolve, reject) => {
    const server = createServer();
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Browser sign-in timed out after 180 seconds."));
    }, 180_000);

    server.listen(0, "127.0.0.1", async () => {
      try {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const redirectUri = `http://127.0.0.1:${port}/callback`;

        const regRes = await fetchImpl(`${baseUrl}/oauth/register`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            client_name: "Webcrawl Anything CLI",
            redirect_uris: [redirectUri],
          }),
        });
        if (!regRes.ok) {
          throw new Error(`Could not register CLI OAuth client (HTTP ${regRes.status}). Try \`webcrawl login --email <you@domain.com>\`.`);
        }
        const { client_id: clientId } = (await regRes.json()) as { client_id: string };
        const authUrl = `${baseUrl}/oauth/authorize?${new URLSearchParams({
          response_type: "code",
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: challenge,
          code_challenge_method: "S256",
          state,
        }).toString()}`;

        io.out(
          [
            "Open this URL in your browser to create your webcrawl.app account or sign in (1,000 free monthly credits):",
            `  ${authUrl}`,
            "",
            "Waiting for browser authorization...",
          ].join("\n") + "\n"
        );
        openBrowserUrl(authUrl);

        server.on("request", async (req, res) => {
          try {
            const u = new URL(req.url || "/", redirectUri);
            if (u.pathname !== "/callback") {
              res.writeHead(404).end("Not found");
              return;
            }
            const code = u.searchParams.get("code");
            const returnedState = u.searchParams.get("state");
            if (!code || returnedState !== state) {
              res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
              res.end("<h3>Authorization failed or state mismatch. You can close this tab.</h3>");
              clearTimeout(timeout);
              server.close();
              reject(new Error("OAuth callback missing code or state mismatch."));
              return;
            }

            const tokenRes = await fetchImpl(`${baseUrl}/oauth/token`, {
              method: "POST",
              headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
              body: new URLSearchParams({
                grant_type: "authorization_code",
                code,
                client_id: clientId,
                redirect_uri: redirectUri,
                code_verifier: verifier,
              }).toString(),
            });
            if (!tokenRes.ok) {
              throw new Error(`OAuth token exchange failed (HTTP ${tokenRes.status}).`);
            }
            const tokenData = (await tokenRes.json()) as { access_token: string };
            let finalKey = tokenData.access_token;

            const authedClient = new WebcrawlClient({
              baseUrl,
              apiKey: finalKey,
              fetch: fetchImpl,
              userAgent: "webcrawl-cli/1.2",
            });
            try {
              const keyRes = await authedClient.request<{ success: boolean; apiKey?: string }>(
                "POST",
                "/v1/account/keys",
                { name: "CLI API Key" }
              );
              if (keyRes.apiKey) {
                finalKey = keyRes.apiKey;
              }
            } catch {
              // keep OAuth access_token (`wc_mcp_...`) which is also accepted on all /v1/* endpoints
            }
            const meRes = await authedClient.me().catch(() => undefined);
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            res.end(
              "<html><body style='font-family:system-ui;padding:2rem'><h2>✓ Webcrawl CLI authenticated!</h2><p>Your account and 1,000 monthly credits are now linked. You can close this tab and return to your terminal or agent.</p></body></html>"
            );
            clearTimeout(timeout);
            server.close();
            resolve({
              apiKey: finalKey,
              email: meRes?.user?.email,
              creditsRemaining: meRes?.user?.creditsRemaining,
              creditsLimit: meRes?.user?.creditsLimit,
              plan: meRes?.user?.plan,
            });
          } catch (err) {
            clearTimeout(timeout);
            server.close();
            reject(err);
          }
        });
      } catch (err) {
        clearTimeout(timeout);
        server.close();
        reject(err);
      }
    });
  });
}

type BackendClient = Pick<
  WebcrawlClient,
  "baseUrl" | "search" | "scrape" | "parse" | "run" | "map" | "crawl" | "extract" | "rerank" | "categories" | "targets" | "usage"
>;

async function resolveBackendClient(
  cfg: ReturnType<typeof resolveConfig>,
  deps: Deps
): Promise<BackendClient> {
  // When a custom fetch mock is injected (e.g. unit tests) or effectiveMode is cloud, use WebcrawlClient
  if (cfg.effectiveMode === "cloud" || deps.fetch) {
    return new WebcrawlClient({
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      fetch: deps.fetch,
      userAgent: "webcrawl-cli/0.1",
    });
  }
  try {
    const packagedSpec = ["./core/local-engine.js"].join("");
    const fallbackSpec = ["..", "..", "..", "src", "local-engine.js"].join("/");
    const localMod = (await import(packagedSpec).catch(() => import(fallbackSpec))) as {
      createLocalEngineClient: () => BackendClient;
    };
    return localMod.createLocalEngineClient();
  } catch {
    return new WebcrawlClient({
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      fetch: deps.fetch,
      userAgent: "webcrawl-cli/0.1",
    });
  }
}

export async function main(argv: string[], io: Io, deps: Deps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\nRun \`webcrawl --help\`.\n`);
    return 2;
  }
  const { values: v, positionals } = parsed;
  const [cmd, ...rest] = positionals;
  if (v.help || !cmd || cmd === "help") {
    io.out(`${HELP}\n`);
    return cmd || v.help ? 0 : 2;
  }

  const file = deps.configFile ?? configPath(env);
  const cfg = resolveConfig(
    { apiKey: v["api-key"], baseUrl: v.url, mode: v.mode },
    env,
    readConfigFile(file)
  );
  const client = await resolveBackendClient(cfg, deps);
  const arg = rest.join(" ").trim();
  const need = (what: string) => {
    if (!arg) {throw new UsageError(`Missing ${what}. Usage: webcrawl ${cmd} <${what}>`);}
    return arg;
  };
  const emit = (res: Record<string, unknown>, pretty: string) => {
    if (v.json) {
      io.out(`${JSON.stringify(res, null, 2)}\n`);
      return;
    }
    io.out(`${pretty}\n`);
    const credits = formatCredits(res);
    if (credits) {io.err(`[${credits}]\n`);}
  };

  const METERED_COMMANDS = new Set(["search", "scrape", "map", "crawl", "extract", "rerank"]);
  if (METERED_COMMANDS.has(cmd) && cfg.effectiveMode === "cloud" && !cfg.apiKey && !deps.fetch) {
    const authHelp = [
      "webcrawl: Cloud mode requires a logged-in webcrawl.app account so credits can be attributed to your user (1,000 free monthly credits on signup).",
      "",
      "Create an account or sign in from the CLI:",
      "  1. Email OTP (agent & terminal friendly):",
      "     webcrawl login --email <you@domain.com>",
      "     webcrawl login --email <you@domain.com> --code <6-digit-code>",
      "  2. Browser OAuth redirect:",
      "     webcrawl login --web",
      "  3. Or run in zero-key local mode:",
      `     webcrawl --mode local ${cmd} ${rest.join(" ")}`,
    ].join("\n");
    if (v.json) {
      io.out(
        `${JSON.stringify(
          {
            success: false,
            error: "authentication_required",
            message: "Cloud mode requires a logged-in webcrawl.app account (1,000 free monthly credits on signup).",
            loginCommands: {
              sendOtp: "webcrawl login --email <you@domain.com>",
              verifyOtp: "webcrawl login --email <you@domain.com> --code <6-digit-code>",
              browserRedirect: "webcrawl login --web",
              signupUrl: `${cfg.baseUrl}/?signup=cli`,
            },
          },
          null,
          2
        )}\n`
      );
    } else {
      io.err(`${authHelp}\n`);
    }
    return 1;
  }

  try {
    switch (cmd) {
      case "search": {
        const res = await client.search({
          query: need("query"),
          category: v.category,
          subcategory: v.sub,
          limit: int(v.limit, "--limit"),
          sites: v.site,
          country: v.country,
          city: v.city,
          scrapeContent: v.content,
        });
        emit(res, formatSearch(res));
        return 0;
      }
      case "scrape": {
        const res = await client.scrape({ url: need("url"), formats: ["markdown"], noCache: v["no-cache"] });
        emit(res, formatScrape(res));
        return 0;
      }
      case "map": {
        const res = await client.map({ url: need("url"), search: v.filter, limit: int(v.limit, "--limit") });
        emit(res, formatMap(res));
        return 0;
      }
      case "crawl": {
        const res = await client.crawl({ url: need("url"), maxPages: int(v.limit, "--limit") });
        emit(res, formatCrawl(res));
        return 0;
      }
      case "extract": {
        let schema: Record<string, unknown> | undefined;
        if (v.schema) {
          try {
            schema = JSON.parse(readFileSync(v.schema, "utf8")) as Record<string, unknown>;
          } catch (e) {
            throw new UsageError(`Could not read schema ${v.schema}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        const res = await client.extract({ url: need("url"), prompt: v.prompt, schema });
        emit(res, JSON.stringify(res.data ?? res, null, 2));
        return 0;
      }
      case "rerank": {
        const query = need("query");
        let docs = v.doc ?? [];
        if (v.file) {
          docs = docs.concat(readFileSync(v.file, "utf8").split(/\r?\n/).filter(Boolean));
        }
        if (!docs.length && !io.isTTY) {
          docs = (await io.readStdin()).split(/\r?\n/).filter(Boolean);
        }
        if (!docs.length) {throw new UsageError("No documents. Pass --doc, --file, or pipe lines on stdin.");}
        const res = await client.rerank({ query, documents: docs, topK: int(v.limit, "--limit") });
        emit(res, formatRerank(res));
        return 0;
      }
      case "categories": {
        const res = await client.categories();
        emit(res, JSON.stringify(res, null, 2));
        return 0;
      }
      case "targets": {
        const res = await client.targets();
        emit(res, formatTargets(res));
        return 0;
      }
      case "setup": {
        const rawAgents = v.agent ?? [];
        let agents: SupportedAgentId[] | undefined;
        if (rawAgents.includes("all")) {
          agents = SUPPORTED_AGENTS.map((a) => a.id);
        } else if (rawAgents.length) {
          const valid = new Set<string>(SUPPORTED_AGENTS.map((a) => a.id));
          for (const a of rawAgents) {
            if (!valid.has(a)) {
              throw new UsageError(
                `Unknown agent "${a}". Supported: ${SUPPORTED_AGENTS.map((x) => x.id).join(", ")}, all`
              );
            }
          }
          agents = rawAgents as SupportedAgentId[];
        }
        const schemaProfile = v["schema-profile"] === "full" ? "full" : "compact";
        const setupRes = runSetup({
          agents,
          schemaProfile,
          apiKey: cfg.apiKey,
          baseUrl: cfg.source.baseUrl !== "default" ? cfg.baseUrl : undefined,
          homeDir: deps.homeDir,
          cwd: deps.cwd,
        });
        const prettyLines = [
          `Webcrawl Anything agent setup complete (MCP schema profile: ${setupRes.schemaProfile}):`,
          ...setupRes.configuredAgents.map(
            (a) =>
              `  ✓ ${a.name}\n    MCP:   ${a.mcpConfigPath}${a.backupPath ? ` (backup: ${a.backupPath})` : ""}\n    Skill: ${a.skillPath}`
          ),
          "",
          "Restart your agent to load the `webcrawl` MCP server and `webcrawl-anything` skill.",
        ].join("\n");
        emit({ success: true, ...setupRes }, prettyLines);
        return 0;
      }
      case "doctor": {
        const report = runDoctor(env, cfg.effectiveMode, cfg.source.apiKey);
        const prettyLines = [
          `Webcrawl Anything Doctor (mode: ${report.mode})`,
          ...report.checks.map((c) => {
            const badge = c.status === "ok" ? "✓" : c.status === "optional" ? "○" : "!";
            return `  ${badge} ${c.name.padEnd(26)} ${c.detail}`;
          }),
        ].join("\n");
        emit({ success: true, ...report }, prettyLines);
        return 0;
      }
      case "login":
      case "signup": {
        const authClient = new WebcrawlClient({
          baseUrl: cfg.baseUrl,
          fetch: deps.fetch,
          userAgent: "webcrawl-cli/1.2",
        });

        // 1. Browser OAuth PKCE redirect (`webcrawl login --web`)
        if (v.web) {
          const webRes = await runWebOAuthLogin(cfg.baseUrl, deps.fetch ?? globalThis.fetch, io);
          const existing = readConfigFile(file);
          writeConfigFile(
            { ...existing, apiKey: webRes.apiKey, ...(v.url ? { baseUrl: v.url } : {}) },
            file
          );
          const payload = {
            success: true,
            method: "web_oauth",
            email: webRes.email,
            plan: webRes.plan ?? "free",
            creditsRemaining: webRes.creditsRemaining ?? 1000,
            creditsLimit: webRes.creditsLimit ?? 1000,
            configFile: file,
          };
          emit(
            payload,
            [
              `✓ Authenticated${webRes.email ? ` as ${webRes.email}` : ""} (${payload.plan} plan · ${payload.creditsRemaining} credits remaining of ${payload.creditsLimit}).`,
              `Saved API key to ${file}.`,
            ].join("\n")
          );
          return 0;
        }

        // 2. Email OTP account creation / sign-in (`webcrawl login --email <addr> [--code <6-digit>]`)
        if (v.email) {
          const email = v.email.trim();
          let code = v.code?.trim();
          if (!code) {
            const otpRes = await authClient.sendOtp(email);
            if (!otpRes.success) {
              throw new WebcrawlError("bad_request", otpRes.error || "Could not send verification code.");
            }
            if (otpRes.devCode && !io.isTTY) {
              code = otpRes.devCode;
            } else if (io.isTTY && !v["no-wait"]) {
              io.err(`Sent a 6-digit verification code to ${email} (expires in 10 minutes).\n`);
              code = await promptLine(io, `Enter the 6-digit code sent to ${email}: `);
            } else {
              const stepPayload = {
                success: true,
                step: "otp_sent",
                email: otpRes.email,
                expiresInSeconds: otpRes.expiresInSeconds,
                nextCommand: `webcrawl login --email ${email} --code <6-digit-code>`,
                browserFallbackUrl: `${cfg.baseUrl}/?signup=cli&email=${encodeURIComponent(email)}`,
              };
              emit(
                stepPayload,
                [
                  `Verification code sent to ${otpRes.email} (expires in ${Math.round(otpRes.expiresInSeconds / 60)} minutes).`,
                  `Ask the user for the 6-digit code from their email, then complete sign-in with:`,
                  `  webcrawl login --email ${email} --code <6-digit-code>`,
                  `Or redirect the user to sign in on the web: ${stepPayload.browserFallbackUrl}`,
                ].join("\n")
              );
              return 0;
            }
          }

          const verified = await authClient.verifyOtp({ email, code, name: v.name });
          if (!verified.success || !verified.apiKey) {
            throw new WebcrawlError(
              "auth",
              verified.error || "Could not verify the 6-digit code."
            );
          }
          const existing = readConfigFile(file);
          writeConfigFile(
            { ...existing, apiKey: verified.apiKey, ...(v.url ? { baseUrl: v.url } : {}) },
            file
          );
          const u = verified.user;
          const payload = {
            success: true,
            isNewUser: verified.isNewUser ?? false,
            email: u?.email ?? email,
            plan: u?.plan ?? "free",
            creditsRemaining: u?.creditsRemaining ?? 1000,
            creditsLimit: u?.creditsLimit ?? 1000,
            configFile: file,
          };
          emit(
            payload,
            [
              `✓ ${verified.isNewUser ? "Created webcrawl.app account" : "Signed in"} as ${payload.email} (${payload.plan} plan · ${payload.creditsRemaining} credits remaining of ${payload.creditsLimit}).`,
              `Saved API key (${verified.apiKey.slice(0, 8)}…${verified.apiKey.slice(-4)}) to ${file}.`,
            ].join("\n")
          );
          return 0;
        }

        // 3. Direct API key (`webcrawl login --key wc_live_...` or interactive paste)
        const key = (v.key ?? (await readKeyInteractively(io))).trim();
        if (!key) {throw new UsageError("No key provided. Pass --key <wc_live_...>, --email <you@domain.com>, or --web.");}
        const existing = readConfigFile(file);
        writeConfigFile({ ...existing, apiKey: key, ...(v.url ? { baseUrl: v.url } : {}) }, file);
        io.out(`Saved your key to ${file}.\n`);
        return 0;
      }
      case "whoami": {
        const masked = cfg.apiKey ? `${cfg.apiKey.slice(0, 8)}…${cfg.apiKey.slice(-4)}` : "none";
        const lines = [
          `endpoint: ${cfg.baseUrl} (${cfg.source.baseUrl})`,
          `mode:     ${cfg.effectiveMode} (${cfg.source.mode})`,
          `key:      ${masked}${cfg.apiKey ? ` (${cfg.source.apiKey})` : ". Run `webcrawl login` (`--email <you@domain.com>` or `--web`) or set WEBCRAWL_API_KEY (local mode works with zero key)."}`,
        ];
        if (cfg.apiKey) {
          const u = await client.usage();
          if (v.json) {
            io.out(`${JSON.stringify({ endpoint: cfg.baseUrl, mode: cfg.effectiveMode, keySource: cfg.source.apiKey, usage: u }, null, 2)}\n`);
            return 0;
          }
          const userObj = (u.user ?? {}) as Record<string, unknown>;
          if (typeof userObj.email === "string") {
            lines.push(`account:  ${userObj.email} (${userObj.plan ?? "free"} plan)`);
          }
          const credits = (u.credits ?? u) as Record<string, unknown>;
          if (typeof credits.remaining === "number") {
            lines.push(`credits:  ${credits.remaining} remaining of ${credits.limit ?? "?"}`);
          }
        }
        io.out(`${lines.join("\n")}\n`);
        return 0;
      }
      default:
        throw new UsageError(`Unknown command "${cmd}".`);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`${e.message}\nRun \`webcrawl --help\`.\n`);
      return 2;
    }
    if (e instanceof WebcrawlError) {
      io.err(`webcrawl: ${describeError(e, cfg.baseUrl)}\n`);
      return 1;
    }
    io.err(`webcrawl: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}
