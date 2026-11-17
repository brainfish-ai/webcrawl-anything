import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Public repo URL used in the occasional CLI star nudge. */
export const STAR_REPO_URL = "https://github.com/brainfish-ai/webcrawl-anything";

/** One-line message printed to stderr (dim when color is allowed). */
export const STAR_PROMPT_MESSAGE = `like webcrawl? star us: ${STAR_REPO_URL}`;

/** Show at most once per day on eligible successful interactive runs. */
export const STAR_PROMPT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface StarPromptState {
  lastShownAt: number;
}

export interface StarPromptGateInput {
  isStdoutTTY: boolean;
  env: NodeJS.ProcessEnv;
  jsonOutput: boolean;
  /** When true, never print (MCP stdio must stay clean). */
  mcpStdio?: boolean;
  nowMs: number;
  lastShownAtMs: number | null;
}

export function starPromptStatePath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "webcrawl", "star-prompt.json");
}

function isEnvFlagOn(value: string | undefined): boolean {
  if (value == null) {
    return false;
  }
  const v = value.trim().toLowerCase();
  if (!v) {
    return false;
  }
  return v === "1" || v === "true" || v === "yes";
}

/** True when CI is set to a truthy value (empty / 0 / false / no do not count). */
export function isCiEnv(env: NodeJS.ProcessEnv): boolean {
  const raw = env.CI;
  if (raw == null) {
    return false;
  }
  const v = raw.trim().toLowerCase();
  if (!v || v === "0" || v === "false" || v === "no") {
    return false;
  }
  return true;
}

export function isStarPromptOptedOut(env: NodeJS.ProcessEnv): boolean {
  return isEnvFlagOn(env.WEBCRAWL_NO_STAR_PROMPT);
}

/**
 * Pure gating for the occasional GitHub star nudge.
 * Never shows for MCP stdio, non-TTY stdout, JSON output, CI, opt-out, or within the interval.
 */
export function shouldShowStarPrompt(input: StarPromptGateInput): boolean {
  if (input.mcpStdio) {
    return false;
  }
  if (!input.isStdoutTTY) {
    return false;
  }
  if (input.jsonOutput) {
    return false;
  }
  if (isCiEnv(input.env)) {
    return false;
  }
  if (isStarPromptOptedOut(input.env)) {
    return false;
  }
  if (
    input.lastShownAtMs != null &&
    input.nowMs - input.lastShownAtMs < STAR_PROMPT_INTERVAL_MS
  ) {
    return false;
  }
  return true;
}

export function formatStarPromptLine(useColor: boolean): string {
  if (!useColor) {
    return `${STAR_PROMPT_MESSAGE}\n`;
  }
  return `\u001b[2m${STAR_PROMPT_MESSAGE}\u001b[0m\n`;
}

export function readStarPromptState(path: string): StarPromptState | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const lastShownAt = (parsed as { lastShownAt?: unknown }).lastShownAt;
    if (typeof lastShownAt !== "number" || !Number.isFinite(lastShownAt)) {
      return null;
    }
    return { lastShownAt };
  } catch {
    return null;
  }
}

export function writeStarPromptState(path: string, state: StarPromptState): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(state)}\n`, { mode: 0o600 });
}

export interface MaybeShowStarPromptOpts {
  isStdoutTTY: boolean;
  env: NodeJS.ProcessEnv;
  jsonOutput: boolean;
  mcpStdio?: boolean;
  /** Prefer stderr so piped stdout stays clean even if a gate is wrong. */
  write: (s: string) => void;
  stateFile?: string;
  nowMs?: number;
  readState?: () => StarPromptState | null;
  writeState?: (state: StarPromptState) => void;
}

/**
 * Optionally print the star nudge. Failures reading/writing state are swallowed.
 * Returns whether the message was printed.
 */
export function maybeShowStarPrompt(opts: MaybeShowStarPromptOpts): boolean {
  try {
    const nowMs = opts.nowMs ?? Date.now();
    const stateFile = opts.stateFile ?? starPromptStatePath(opts.env);
    const state = opts.readState ? opts.readState() : readStarPromptState(stateFile);
    if (
      !shouldShowStarPrompt({
        isStdoutTTY: opts.isStdoutTTY,
        env: opts.env,
        jsonOutput: opts.jsonOutput,
        mcpStdio: opts.mcpStdio,
        nowMs,
        lastShownAtMs: state?.lastShownAt ?? null,
      })
    ) {
      return false;
    }
    const next: StarPromptState = { lastShownAt: nowMs };
    // Persist first so a disk failure skips the nudge instead of spamming every run.
    if (opts.writeState) {
      opts.writeState(next);
    } else {
      writeStarPromptState(stateFile, next);
    }
    const useColor = !(opts.env.NO_COLOR != null && opts.env.NO_COLOR !== "");
    opts.write(formatStarPromptLine(useColor));
    return true;
  } catch {
    return false;
  }
}
