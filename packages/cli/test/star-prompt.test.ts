import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { main } from "../src/index.js";
import {
  STAR_PROMPT_INTERVAL_MS,
  STAR_PROMPT_MESSAGE,
  STAR_REPO_URL,
  formatStarPromptLine,
  maybeShowStarPrompt,
  readStarPromptState,
  shouldShowStarPrompt,
  starPromptStatePath,
  writeStarPromptState,
} from "../src/star-prompt.js";

const baseGate = {
  isStdoutTTY: true,
  env: {} as NodeJS.ProcessEnv,
  jsonOutput: false,
  nowMs: 1_700_000_000_000,
  lastShownAtMs: null as number | null,
};

describe("star prompt gating", () => {
  it("allows an interactive non-CI run with no prior show", () => {
    assert.equal(shouldShowStarPrompt(baseGate), true);
  });

  it("blocks when stdout is not a TTY (piped / quiet)", () => {
    assert.equal(shouldShowStarPrompt({ ...baseGate, isStdoutTTY: false }), false);
  });

  it("blocks in CI", () => {
    assert.equal(shouldShowStarPrompt({ ...baseGate, env: { CI: "true" } }), false);
    assert.equal(shouldShowStarPrompt({ ...baseGate, env: { CI: "1" } }), false);
    assert.equal(shouldShowStarPrompt({ ...baseGate, env: { CI: "0" } }), true);
  });

  it("blocks when WEBCRAWL_NO_STAR_PROMPT is set", () => {
    assert.equal(shouldShowStarPrompt({ ...baseGate, env: { WEBCRAWL_NO_STAR_PROMPT: "1" } }), false);
    assert.equal(shouldShowStarPrompt({ ...baseGate, env: { WEBCRAWL_NO_STAR_PROMPT: "true" } }), false);
    assert.equal(shouldShowStarPrompt({ ...baseGate, env: { WEBCRAWL_NO_STAR_PROMPT: "0" } }), true);
  });

  it("blocks JSON output", () => {
    assert.equal(shouldShowStarPrompt({ ...baseGate, jsonOutput: true }), false);
  });

  it("blocks the MCP stdio path", () => {
    assert.equal(shouldShowStarPrompt({ ...baseGate, mcpStdio: true }), false);
  });

  it("blocks when shown recently (frequency / once per day)", () => {
    const last = baseGate.nowMs - 60_000;
    assert.equal(shouldShowStarPrompt({ ...baseGate, lastShownAtMs: last }), false);
    assert.equal(
      shouldShowStarPrompt({
        ...baseGate,
        lastShownAtMs: baseGate.nowMs - STAR_PROMPT_INTERVAL_MS,
      }),
      true
    );
  });

  it("formats a dim one-line message without em dashes", () => {
    const colored = formatStarPromptLine(true);
    const plain = formatStarPromptLine(false);
    assert.match(colored, new RegExp(STAR_REPO_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(plain, `${STAR_PROMPT_MESSAGE}\n`);
    assert.ok(!plain.includes("—"));
    assert.ok(!plain.includes("--"));
    assert.match(colored, /^\u001b\[2m/);
  });
});

describe("star prompt state file", () => {
  it("reads and writes state under the config dir; write failures are silent", () => {
    const dir = mkdtempSync(join(tmpdir(), "wc-star-"));
    const path = join(dir, "star-prompt.json");
    assert.equal(readStarPromptState(path), null);
    writeStarPromptState(path, { lastShownAt: 42 });
    assert.deepEqual(readStarPromptState(path), { lastShownAt: 42 });
    assert.equal(JSON.parse(readFileSync(path, "utf8")).lastShownAt, 42);

    let written = "";
    const shown = maybeShowStarPrompt({
      isStdoutTTY: true,
      env: {},
      jsonOutput: false,
      write: (s) => {
        written += s;
      },
      stateFile: join(dir, "nested", "star-prompt.json"),
      nowMs: 100,
    });
    assert.equal(shown, true);
    assert.match(written, /like webcrawl\? star us:/);

    const again = maybeShowStarPrompt({
      isStdoutTTY: true,
      env: {},
      jsonOutput: false,
      write: () => {
        throw new Error("should not write");
      },
      stateFile: join(dir, "nested", "star-prompt.json"),
      nowMs: 100 + 1_000,
    });
    assert.equal(again, false);

    const silent = maybeShowStarPrompt({
      isStdoutTTY: true,
      env: {},
      jsonOutput: false,
      write: (s) => {
        written += s;
      },
      nowMs: 200,
      readState: () => null,
      writeState: () => {
        throw new Error("disk full");
      },
    });
    assert.equal(silent, false);

    assert.match(starPromptStatePath({ XDG_CONFIG_HOME: "/tmp/xdg-config" }), /\/tmp\/xdg-config\/webcrawl\/star-prompt\.json$/);
  });
});

describe("CLI star prompt integration", () => {
  it("prints the nudge once on a successful interactive command, then respects frequency", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wc-cli-star-"));
    const stateFile = join(dir, "star-prompt.json");
    let out = "";
    let err = "";
    const fetchMock = (async () =>
      new Response(JSON.stringify({ data: { markdown: "# Hi" } }), { status: 200 })) as unknown as typeof fetch;

    const run = (nowMs: number) =>
      main(
        ["scrape", "https://a.com"],
        {
          out: (s) => {
            out += s;
          },
          err: (s) => {
            err += s;
          },
          readStdin: async () => "",
          isTTY: true,
        },
        {
          env: { WEBCRAWL_API_KEY: "wc_live_test", WEBCRAWL_URL: "https://x.test" },
          fetch: fetchMock,
          configFile: join(dir, "config.json"),
          stdoutIsTTY: true,
          starPromptStateFile: stateFile,
          nowMs,
        }
      );

    out = "";
    err = "";
    assert.equal(await run(1_000_000), 0);
    assert.equal(out, "# Hi\n");
    assert.match(err, /like webcrawl\? star us: https:\/\/github\.com\/brainfish-ai\/webcrawl-anything/);
    assert.equal(readStarPromptState(stateFile)?.lastShownAt, 1_000_000);

    out = "";
    err = "";
    assert.equal(await run(1_000_000 + 60_000), 0);
    assert.equal(out, "# Hi\n");
    assert.equal(err, "");
  });

  it("never prints for --json, CI, opt-out, or non-TTY stdout", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wc-cli-star-gate-"));
    const fetchMock = (async () =>
      new Response(JSON.stringify({ data: { markdown: "# Hi" } }), { status: 200 })) as unknown as typeof fetch;

    const run = (extra: {
      args?: string[];
      env?: NodeJS.ProcessEnv;
      stdoutIsTTY?: boolean;
    }) => {
      let err = "";
      return main(
        extra.args ?? ["scrape", "https://a.com"],
        {
          out: () => {},
          err: (s) => {
            err += s;
          },
          readStdin: async () => "",
          isTTY: true,
        },
        {
          env: {
            WEBCRAWL_API_KEY: "wc_live_test",
            WEBCRAWL_URL: "https://x.test",
            ...extra.env,
          },
          fetch: fetchMock,
          configFile: join(dir, "config.json"),
          stdoutIsTTY: extra.stdoutIsTTY ?? true,
          starPromptStateFile: join(dir, `state-${Math.random().toString(16).slice(2)}.json`),
          nowMs: Date.now(),
        }
      ).then((code) => ({ code, err }));
    };

    assert.deepEqual(await run({ args: ["scrape", "https://a.com", "--json"] }), {
      code: 0,
      err: "",
    });
    assert.equal((await run({ env: { CI: "true" } })).err, "");
    assert.equal((await run({ env: { WEBCRAWL_NO_STAR_PROMPT: "1" } })).err, "");
    assert.equal((await run({ stdoutIsTTY: false })).err, "");
  });

  it("does not treat a seeded recent state file as eligible", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wc-cli-star-seed-"));
    const stateFile = join(dir, "star-prompt.json");
    writeFileSync(stateFile, `${JSON.stringify({ lastShownAt: 5_000_000 })}\n`);
    let err = "";
    const code = await main(
      ["scrape", "https://a.com"],
      {
        out: () => {},
        err: (s) => {
          err += s;
        },
        readStdin: async () => "",
        isTTY: true,
      },
      {
        env: { WEBCRAWL_API_KEY: "wc_live_test", WEBCRAWL_URL: "https://x.test" },
        fetch: (async () =>
          new Response(JSON.stringify({ data: { markdown: "x" } }), {
            status: 200,
          })) as unknown as typeof fetch,
        configFile: join(dir, "config.json"),
        stdoutIsTTY: true,
        starPromptStateFile: stateFile,
        nowMs: 5_000_000 + 3_600_000,
      }
    );
    assert.equal(code, 0);
    assert.equal(err, "");
  });
});
