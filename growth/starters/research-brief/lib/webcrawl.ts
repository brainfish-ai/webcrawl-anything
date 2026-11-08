import { spawn } from "node:child_process";
import { WebcrawlClient } from "@webcrawl/client";
import { parsePublicHttpUrl } from "./public-url";

export type EngineMode = "hosted" | "local";

export interface SearchHit {
  title: string;
  url: string;
  description: string;
}

export interface SourceCard {
  title: string;
  url: string;
  excerpt: string;
  kind: "page-excerpt" | "search-snippet";
  error?: string;
}

export interface Brief {
  query: string;
  mode: EngineMode;
  disclaimer: string;
  sources: SourceCard[];
}

export interface WebcrawlRuntime {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  spawnCli?: (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
}

export const BRIEF_DISCLAIMER =
  "Retrieved source excerpts. This brief does not run a language model. Every block is text webcrawl returned from search or scrape.";

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

export function excerptFromMarkdown(markdown: string, maxChars = 720): string {
  const cleaned = markdown.replace(/^\s*#+\s+/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  if (cleaned.length <= maxChars) {
    return cleaned;
  }
  const cut = cleaned.slice(0, maxChars);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 400 ? cut.slice(0, sp) : cut).trim()}...`;
}

export function hitsFromSearchPayload(payload: Record<string, unknown>): SearchHit[] {
  const raw = Array.isArray(payload.results)
    ? payload.results
    : Array.isArray(payload.data)
      ? payload.data
      : [];
  const hits: SearchHit[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const rec = item as Record<string, unknown>;
    const urlRaw = typeof rec.url === "string" ? rec.url : typeof rec.canonicalUrl === "string" ? rec.canonicalUrl : "";
    const parsed = parsePublicHttpUrl(urlRaw);
    if (!parsed) {
      continue;
    }
    hits.push({
      title: typeof rec.title === "string" && rec.title.trim() ? rec.title : parsed.hostname,
      url: parsed.toString(),
      description: typeof rec.description === "string" ? rec.description.replace(/\s+/g, " ").trim() : "",
    });
  }
  return hits;
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

function client(runtime: WebcrawlRuntime, env: NodeJS.ProcessEnv): WebcrawlClient {
  return new WebcrawlClient({
    apiKey: (env.WEBCRAWL_API_KEY || "").trim() || undefined,
    baseUrl: (env.WEBCRAWL_URL || "https://webcrawl.app").replace(/\/+$/, ""),
    fetch: runtime.fetch,
    userAgent: "webcrawl-starter-research-brief/0.0.0",
  });
}

export async function searchWeb(query: string, limit: number, runtime: WebcrawlRuntime = {}): Promise<SearchHit[]> {
  const env = runtime.env ?? process.env;
  const mode = resolveEngineMode(env);
  const cap = Math.min(5, Math.max(1, limit));

  if (mode === "local") {
    const spawnCli = runtime.spawnCli ?? spawnNpxWebcrawl;
    const { code, stdout, stderr } = await spawnCli(["--json", "search", query, "-n", String(cap)]);
    if (code !== 0) {
      throw new Error((stderr || stdout || `webcrawl search exited ${code}`).trim().slice(0, 500));
    }
    const payload = parseCliJson(stdout);
    if (payload.success === false) {
      throw new Error(typeof payload.error === "string" ? payload.error : "Local search failed.");
    }
    return hitsFromSearchPayload(payload).slice(0, cap);
  }

  const payload = (await client(runtime, env).search({ query, limit: cap })) as Record<string, unknown>;
  if (payload.success === false) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Hosted search failed.");
  }
  return hitsFromSearchPayload(payload).slice(0, cap);
}

export async function scrapeMarkdown(url: string, runtime: WebcrawlRuntime = {}): Promise<string> {
  const env = runtime.env ?? process.env;
  const mode = resolveEngineMode(env);

  if (mode === "local") {
    const spawnCli = runtime.spawnCli ?? spawnNpxWebcrawl;
    const { code, stdout, stderr } = await spawnCli(["--json", "scrape", url]);
    if (code !== 0) {
      throw new Error((stderr || stdout || "scrape failed").trim().slice(0, 400));
    }
    const payload = parseCliJson(stdout);
    if (payload.success === false) {
      throw new Error(typeof payload.error === "string" ? payload.error : "Local scrape failed.");
    }
    return markdownFromPayload(payload).trim();
  }

  const payload = (await client(runtime, env).scrape({ url, formats: ["markdown"] })) as Record<string, unknown>;
  if (payload.success === false) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Hosted scrape failed.");
  }
  return markdownFromPayload(payload).trim();
}

export async function buildBrief(query: string, limit = 4, runtime: WebcrawlRuntime = {}): Promise<Brief> {
  const q = query.trim();
  if (q.length < 2) {
    throw new Error("Enter a search query.");
  }
  const env = runtime.env ?? process.env;
  const mode = resolveEngineMode(env);
  const hits = await searchWeb(q, limit, runtime);
  if (!hits.length) {
    throw new Error("Search returned no URLs. Try another query, or run locally with Chrome if keyless search is throttled.");
  }

  const sources: SourceCard[] = [];
  for (const hit of hits) {
    try {
      const markdown = await scrapeMarkdown(hit.url, runtime);
      if (!markdown) {
        throw new Error("empty markdown");
      }
      sources.push({
        title: hit.title,
        url: hit.url,
        excerpt: excerptFromMarkdown(markdown),
        kind: "page-excerpt",
      });
    } catch (err) {
      sources.push({
        title: hit.title,
        url: hit.url,
        excerpt: hit.description || "Page could not be retrieved. Search snippet only.",
        kind: "search-snippet",
        error: err instanceof Error ? err.message : "scrape failed",
      });
    }
  }

  return { query: q, mode, disclaimer: BRIEF_DISCLAIMER, sources };
}
