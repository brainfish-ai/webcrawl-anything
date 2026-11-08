#!/usr/bin/env node
import { spawn } from "node:child_process";

export function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

/**
 * Run `npx --yes webcrawl@latest --mode local ...`.
 * Captures stdout/stderr. Does not log environment secrets.
 */
export function runWebcrawl(args, { inherit = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["--yes", "webcrawl@latest", "--mode", "local", ...args], {
      env: { ...process.env, WEBCRAWL_MODE: "local" },
      stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    if (inherit) {
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? 1, stdout: "", stderr: "" }));
      return;
    }
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

export function parseJsonOutput(stdout) {
  const text = stdout.trim();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("CLI did not print JSON. Pass --json.");
  }
}

export function asMarkdown(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const rec = payload;
  const data = rec.data && typeof rec.data === "object" ? rec.data : rec;
  if (typeof rec.markdown === "string" && rec.markdown.trim()) {
    return rec.markdown;
  }
  if (typeof data.markdown === "string") {
    return data.markdown;
  }
  return "";
}

export function excerptFromMarkdown(markdown, maxChars = 900) {
  const cleaned = markdown.replace(/^\s*#+\s+/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  if (cleaned.length <= maxChars) {
    return cleaned;
  }
  const cut = cleaned.slice(0, maxChars);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 400 ? cut.slice(0, sp) : cut).trim()}...`;
}
