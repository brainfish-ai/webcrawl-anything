import { spawn } from "node:child_process";
import { WebcrawlClient } from "@webcrawl/client";

export type EngineMode = "hosted" | "local";

export interface ScrapePage {
  url: string;
  title: string;
  markdown: string;
  mode: EngineMode;
  cached?: boolean;
}

export interface WebcrawlRuntime {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  spawnCli?: (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
}

export function resolveEngineMode(env: NodeJS.ProcessEnv = process.env): EngineMode {
  if ((env.WEBCRAWL_MODE || "").trim() === "local") {
    if (env.VERCEL === "1") {
      throw new Error(
        "Local engine needs a Node.js machine with optional Chrome. Vercel production uses the hosted API. Unset WEBCRAWL_MODE or set WEBCRAWL_API_KEY."
      );
    }
    return "local";
  }
  return "hosted";
}

export function markdownFromPayload(payload: Record<string, unknown>): string {
  const data = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : payload;
  if (typeof payload.markdown === "string" && payload.markdown.trim()) {
    return payload.markdown;
  }
  if (typeof data.markdown === "string") {
    return data.markdown;
  }
  return "";
}

function spawnNpxWebcrawl(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["--yes", "webcrawl@latest", "--mode", "local", ...args], {
      env: { ...process.env, WEBCRAWL_MODE: "local" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function parseCliJson(stdout: string): Record<string, unknown> {
  const text = stdout.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Local webcrawl CLI did not return JSON.");
  }
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

export async function scrapePage(url: string, runtime: WebcrawlRuntime = {}): Promise<ScrapePage> {
  const env = runtime.env ?? process.env;
  const mode = resolveEngineMode(env);

  if (mode === "local") {
    const spawnCli = runtime.spawnCli ?? spawnNpxWebcrawl;
    const { code, stdout, stderr } = await spawnCli(["--json", "scrape", url]);
    if (code !== 0) {
      throw new Error((stderr || stdout || `webcrawl scrape exited ${code}`).trim().slice(0, 500));
    }
    const payload = parseCliJson(stdout);
    if (payload.success === false) {
      throw new Error(typeof payload.error === "string" ? payload.error : "Local scrape failed.");
    }
    const markdown = markdownFromPayload(payload).trim();
    if (!markdown) {
      throw new Error("Local scrape returned no Markdown. The page may need Chrome (`npx webcrawl doctor`).");
    }
    return {
      url: typeof payload.url === "string" ? payload.url : url,
      title: typeof payload.title === "string" ? payload.title : url,
      markdown,
      mode,
      cached: payload.cached === true,
    };
  }

  const client = new WebcrawlClient({
    apiKey: (env.WEBCRAWL_API_KEY || "").trim() || undefined,
    baseUrl: (env.WEBCRAWL_URL || "https://webcrawl.app").replace(/\/+$/, ""),
    fetch: runtime.fetch,
    userAgent: "webcrawl-starter-url-to-markdown/0.0.0",
  });
  const payload = (await client.scrape({ url, formats: ["markdown"] })) as Record<string, unknown>;
  if (payload.success === false) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Hosted scrape failed.");
  }
  const markdown = markdownFromPayload(payload).trim();
  if (!markdown) {
    throw new Error("Hosted scrape returned no Markdown. The page may be a challenge shell.");
  }
  return {
    url: typeof payload.url === "string" ? payload.url : url,
    title: typeof payload.title === "string" ? payload.title : url,
    markdown,
    mode,
    cached: payload.cached === true,
  };
}
