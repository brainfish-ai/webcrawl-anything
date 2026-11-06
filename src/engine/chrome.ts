/**
 * Local Chrome dump-dom renderer (JS pages the native fetch ladder cannot hydrate).
 *
 * Uses a user-installed Chrome/Chromium binary — the same one `webcrawl doctor`
 * reports — with `--dump-dom` + virtual time so `document.write` / client-rendered
 * content appears in the HTML. Playwright is not required; this is the zero-key
 * local JS tier.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DUMP_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;
const VIRTUAL_TIME_MS = 10_000;

/**
 * Path to a real installed Chrome/Chromium, or null.
 * Priority: WEBCRAWL_CHROME_PATH, INTERACT_CHROME_PATH, CHROME_PATH, then per-OS
 * defaults (same locations `webcrawl doctor` checks).
 */
export function installedChromePath(): string | null {
  const fromEnv =
    process.env.WEBCRAWL_CHROME_PATH?.trim() ||
    process.env.INTERACT_CHROME_PATH?.trim() ||
    process.env.CHROME_PATH?.trim();
  if (fromEnv) return fromEnv;
  const candidates: string[] = [];
  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      `${process.env.HOME || ""}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
    );
  } else if (process.platform === "win32") {
    candidates.push(
      `${process.env["ProgramFiles"] || "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)"}\\Google\\Chrome\\Application\\chrome.exe`
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/snap/bin/chromium"
    );
  }
  for (const p of candidates) {
    try {
      if (p && existsSync(p)) return p;
    } catch {
      /* not installed here */
    }
  }
  return null;
}

export function isLocalChromeAvailable(): boolean {
  return installedChromePath() !== null;
}

/**
 * Render `url` in local Chrome and return the hydrated HTML, or null when
 * Chrome is missing, times out, or produces nothing.
 */
export async function renderViaLocalChrome(
  url: string,
  opts: { timeoutMs?: number } = {}
): Promise<string | null> {
  const chrome = installedChromePath();
  if (!chrome) return null;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let profile = "";
  try {
    profile = mkdtempSync(join(tmpdir(), "wc-chrome-"));
  } catch {
    return null;
  }
  const args = [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-crash-reporter",
    "--disable-breakpad",
    `--user-data-dir=${profile}`,
    `--virtual-time-budget=${VIRTUAL_TIME_MS}`,
    `--timeout=${timeoutMs}`,
    "--dump-dom",
    url,
  ];
  try {
    return await new Promise<string | null>((resolve) => {
      let settled = false;
      const done = (value: string | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(chrome, args, { stdio: ["ignore", "pipe", "pipe"] });
      } catch {
        done(null);
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        done(null);
      }, timeoutMs + 2_000);
      child.stdout?.on("data", (c: Buffer) => {
        if (bytes >= DUMP_MAX_BYTES) return;
        const take = c.subarray(0, DUMP_MAX_BYTES - bytes);
        chunks.push(take);
        bytes += take.length;
      });
      child.on("error", () => {
        clearTimeout(timer);
        done(null);
      });
      child.on("close", () => {
        clearTimeout(timer);
        if (bytes === 0) {
          done(null);
          return;
        }
        const text = Buffer.concat(chunks).toString("utf8");
        done(text.trim().length > 0 ? text : null);
      });
    });
  } finally {
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* leftover profile is in /tmp */
    }
  }
}
