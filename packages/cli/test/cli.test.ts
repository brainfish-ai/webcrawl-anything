import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { main } from "../src/index.js";

function setup(handler: (url: string, body?: Record<string, unknown>) => { status?: number; json: unknown } = () => ({ json: {} }), stdin = "") {
  const dir = mkdtempSync(join(tmpdir(), "wc-cli-"));
  const calls: Array<{ url: string; body?: Record<string, unknown>; auth?: string }> = [];
  let out = "";
  let err = "";
  const f = (async (url: string, init: RequestInit) => {
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ url, body, auth: (init.headers as Record<string, string>).authorization });
    const r = handler(url, body);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  const run = (args: string[], env: NodeJS.ProcessEnv = { WEBCRAWL_API_KEY: "wc_live_test", WEBCRAWL_URL: "https://x.test" }) =>
    main(args, { out: (s) => (out += s), err: (s) => (err += s), readStdin: async () => stdin, isTTY: false }, { env, fetch: f, configFile: join(dir, "config.json") });
  return { run, calls, dir, out: () => out, err: () => err };
}

describe("webcrawl CLI", () => {
  it("search prints a table and sends category, limit and sites", async () => {
    const t = setup(() => ({ json: { hotels: [{ name: "Hotel A", priceText: "$120", provider: "booking.com", url: "https://b.com/a" }], credits: { charged: 2, remaining: 9 } } }));
    const code = await t.run(["search", "hotels", "in", "shibuya", "-c", "hotels", "-n", "3", "--site", "booking.com"]);
    assert.equal(code, 0);
    assert.match(t.out(), /1\s+Hotel A\s+\$120\s+booking\.com/);
    assert.match(t.err(), /9 remaining/);
    assert.equal(t.calls[0].auth, "Bearer wc_live_test");
    assert.deepEqual(t.calls[0].body, { query: "hotels in shibuya", category: "hotels", limit: 3, filters: { sites: ["booking.com"] } });
  });

  it("--json prints the raw response only", async () => {
    const t = setup(() => ({ json: { success: true, results: [] } }));
    assert.equal(await t.run(["search", "x", "--json"]), 0);
    assert.deepEqual(JSON.parse(t.out()), { success: true, results: [] });
    assert.equal(t.err(), "");
  });

  it("scrape prints markdown", async () => {
    const t = setup(() => ({ json: { data: { markdown: "# Hello" } } }));
    await t.run(["scrape", "https://a.com"]);
    assert.equal(t.out(), "# Hello\n");
  });

  it("usage errors exit 2 without calling the API", async () => {
    const t = setup();
    assert.equal(await t.run(["search"]), 2);
    assert.match(t.err(), /Missing query/);
    assert.equal(await t.run(["search", "x", "-n", "0"]), 2);
    assert.equal(await t.run(["bogus"]), 2);
    assert.equal(await t.run(["--nope"]), 2);
    assert.equal(t.calls.length, 0);
  });

  it("no command prints help and exits 2; --help exits 0", async () => {
    const t = setup();
    assert.equal(await t.run([]), 2);
    assert.equal(await t.run(["--help"]), 0);
    assert.match(t.out(), /Usage: webcrawl/);
  });

  it("API failures exit 1 with an actionable message", async () => {
    const t = setup(() => ({ status: 401, json: { error: "bad" } }));
    assert.equal(await t.run(["scrape", "https://a.com"]), 1);
    assert.match(t.err(), /webcrawl login/);
  });

  it("rerank reads documents from stdin lines", async () => {
    const t = setup(() => ({ json: { results: [{ description: "doc b", score: 0.9 }] } }), "doc a\ndoc b\n");
    assert.equal(await t.run(["rerank", "q"]), 0);
    assert.deepEqual(t.calls[0].body?.documents, ["doc a", "doc b"]);
    assert.match(t.out(), /0\.900\s+doc b/);
  });

  it("extract reads a schema file", async () => {
    const t = setup(() => ({ json: { data: { name: "x" } } }));
    const p = join(t.dir, "s.json");
    writeFileSync(p, JSON.stringify({ type: "object" }));
    assert.equal(await t.run(["extract", "https://a.com", "--schema", p, "--prompt", "name"]), 0);
    assert.deepEqual(t.calls[0].body, { url: "https://a.com", prompt: "name", schema: { type: "object" } });
    assert.match(t.out(), /"name": "x"/);
  });

  it("login saves the key at 0600 and later commands use it", async () => {
    const t = setup();
    assert.equal(await t.run(["login", "--key", "wc_live_saved"], {}), 0);
    const p = join(t.dir, "config.json");
    assert.equal(statSync(p).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(p, "utf8")).apiKey, "wc_live_saved");
    await t.run(["categories"], {});
    assert.equal(t.calls[0].auth, "Bearer wc_live_saved");
  });

  it("whoami shows key source without calling the API when no key", async () => {
    const t = setup();
    assert.equal(await t.run(["whoami"], {}), 0);
    assert.match(t.out(), /none\. Run `webcrawl login`/);
    assert.equal(t.calls.length, 0);
  });

  it("setup writes MCP config and SKILL.md for selected agents", async () => {
    const t = setup();
    const homeDir = mkdtempSync(join(tmpdir(), "wc-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "wc-cwd-"));
    let out = "";
    const code = await main(
      ["setup", "--agent", "claude", "--agent", "codex"],
      { out: (s) => (out += s), err: () => {}, readStdin: async () => "", isTTY: false },
      { env: {}, homeDir, cwd, configFile: join(t.dir, "config.json") }
    );
    assert.equal(code, 0);
    assert.match(out, /Claude Code/);
    const claudeCfg = JSON.parse(readFileSync(join(homeDir, ".claude.json"), "utf8"));
    assert.equal(claudeCfg.mcpServers.webcrawl.command, "npx");
    assert.equal(claudeCfg.mcpServers.webcrawl.env.WEBCRAWL_MCP_SCHEMA_PROFILE, "compact");
    const codexSkill = readFileSync(join(cwd, ".agents", "skills", "webcrawl-anything", "SKILL.md"), "utf8");
    assert.match(codexSkill, /name: webcrawl-anything/);
  });

  it("doctor reports local zero-key engine readiness", async () => {
    const t = setup();
    assert.equal(await t.run(["doctor"], {}), 0);
    assert.match(t.out(), /Webcrawl Anything Doctor/);
    assert.match(t.out(), /local zero-key engine/);
  });

  it("targets lists supported crawl targets in local mode", async () => {
    let out = "";
    const code = await main(
      ["targets", "--mode", "local"],
      { out: (s) => (out += s), err: () => {}, readStdin: async () => "", isTTY: false },
      { env: {}, configFile: join(tmpdir(), "nonexistent-wc.json") }
    );
    assert.equal(code, 0);
    assert.match(out, /github/);
    assert.match(out, /arxiv/);
    assert.match(out, /pdf-office/);
  });

  it("cloud mode requires login when no API key is configured", async () => {
    let err = "";
    const code = await main(
      ["search", "dpo", "--mode", "cloud"],
      { out: () => {}, err: (s) => (err += s), readStdin: async () => "", isTTY: false },
      { env: {}, configFile: join(tmpdir(), "nonexistent-wc.json") }
    );
    assert.equal(code, 1);
    assert.match(err, /Cloud mode requires a logged-in webcrawl\.app account/);
    assert.match(err, /webcrawl login --email/);
    assert.match(err, /webcrawl login --web/);
  });

  it("login --email sends OTP and --code verifies account, assigns 1000 credits, and saves key", async () => {
    const t = setup((url) => {
      if (url.endsWith("/v1/auth/otp/send")) {
        return {
          json: {
            success: true,
            email: "agent@example.com",
            expiresInSeconds: 600,
          },
        };
      }
      return {
        json: {
          success: true,
          isNewUser: true,
          apiKey: "wc_live_newuser1000credits",
          sessionToken: "wc_sess_abc",
          user: {
            id: "u_1",
            email: "agent@example.com",
            plan: "free",
            creditsLimit: 1000,
            creditsUsed: 0,
            creditsRemaining: 1000,
          },
        },
      };
    });
    // Step 1: send OTP (non-interactive agent step)
    const step1 = await t.run(["login", "--email", "agent@example.com"], {});
    assert.equal(step1, 0);
    assert.match(t.calls[0].url, /\/v1\/auth\/otp\/send$/);
    assert.match(t.out(), /webcrawl login --email agent@example\.com --code <6-digit-code>/);

    // Step 2: verify OTP code -> creates account with 1,000 credits and saves wc_live_... key
    const step2 = await t.run(["login", "--email", "agent@example.com", "--code", "482910"], {});
    assert.equal(step2, 0);
    assert.match(t.calls[1].url, /\/v1\/auth\/otp\/verify$/);
    assert.match(t.out(), /Created webcrawl\.app account as agent@example\.com/);
    assert.match(t.out(), /1000 credits remaining of 1000/);
  });
});
