#!/usr/bin/env node
/**
 * GET https://webcrawl.app/v1/auth/me
 * Reports whether a key is configured without printing it.
 */
import { api, baseUrl, fail, hasKey, printJson } from "./http.mjs";

const jsonOut = process.argv.includes("--json");
const { ok, status, json } = await api("GET", "/v1/auth/me");

const summary = {
  baseUrl: baseUrl(),
  keyConfigured: hasKey(),
  httpStatus: status,
  authenticated: Boolean(json && json.authenticated),
  email: json && json.user && typeof json.user.email === "string" ? json.user.email : null,
  plan: json && json.user && typeof json.user.plan === "string" ? json.user.plan : null,
  creditsRemaining:
    json && json.user && typeof json.user.creditsRemaining === "number" ? json.user.creditsRemaining : null,
};

if (jsonOut) {
  printJson({ summary, body: json });
} else {
  process.stdout.write(
    [
      `base:           ${summary.baseUrl}`,
      `key configured: ${summary.keyConfigured ? "yes (value hidden)" : "no"}`,
      `authenticated:  ${summary.authenticated}`,
      summary.email ? `email:          ${summary.email}` : null,
      summary.plan ? `plan:           ${summary.plan}` : null,
      summary.creditsRemaining !== null ? `credits left:   ${summary.creditsRemaining}` : null,
      !ok ? `http:           ${status}` : null,
    ]
      .filter(Boolean)
      .join("\n") + "\n"
  );
}

if (!ok) {
  fail(`whoami failed (HTTP ${status}). Try npx webcrawl login.`);
}
