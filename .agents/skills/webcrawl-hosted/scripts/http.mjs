#!/usr/bin/env node
/**
 * Shared hosted-API helper for skill scripts. No secrets are logged.
 */
export const DEFAULT_BASE_URL = "https://webcrawl.app";

export function baseUrl() {
  const raw = (process.env.WEBCRAWL_URL || DEFAULT_BASE_URL).trim();
  return raw.replace(/\/+$/, "") || DEFAULT_BASE_URL;
}

export function apiHeaders() {
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": "webcrawl-hosted-skill/1.0 (https://github.com/brainfish-ai/webcrawl-anything)",
  };
  const key = (process.env.WEBCRAWL_API_KEY || "").trim();
  if (key) {
    headers.authorization = `Bearer ${key}`;
  }
  return headers;
}

export function hasKey() {
  return Boolean((process.env.WEBCRAWL_API_KEY || "").trim());
}

export async function api(method, path, body) {
  const url = `${baseUrl()}${path}`;
  const res = await fetch(url, {
    method,
    headers: apiHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { success: false, error: text.slice(0, 300) };
  }
  return { ok: res.ok, status: res.status, json };
}

export function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function asMarkdown(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const rec = payload;
  const data = rec.data && typeof rec.data === "object" ? rec.data : rec;
  const md = typeof rec.markdown === "string" ? rec.markdown : typeof data.markdown === "string" ? data.markdown : "";
  return md;
}
