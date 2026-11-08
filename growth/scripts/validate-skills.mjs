#!/usr/bin/env node
/**
 * Validate public Agent Skills in .agents/skills against
 * https://agentskills.io/specification (name, description, directory match).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const skillsRoot = join(root, ".agents", "skills");

function parseFrontmatter(text, file) {
  if (!text.startsWith("---\n")) {
    throw new Error(`${file}: missing YAML frontmatter`);
  }
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) {
    throw new Error(`${file}: unclosed frontmatter`);
  }
  const yaml = text.slice(4, end);
  const body = text.slice(end + 5);
  const fields = {};
  let key = null;
  let folded = false;
  for (const line of yaml.split("\n")) {
    const nested = line.match(/^  ([A-Za-z0-9_-]+):\s*(.*)$/);
    if (nested && key === "metadata") {
      if (!fields.metadata || typeof fields.metadata !== "object") {
        fields.metadata = {};
      }
      fields.metadata[nested[1]] = nested[2].replace(/^"|"$/g, "");
      folded = false;
      continue;
    }
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) {
      key = m[1];
      const raw = m[2];
      folded = raw === ">" || raw === ">|" || raw === ">-" || raw === "|" || raw === "|-";
      fields[key] = folded || raw === "" ? (folded ? "" : {}) : raw.replace(/^"|"$/g, "");
      continue;
    }
    if (folded && key && /^\s+\S/.test(line)) {
      const piece = line.trim();
      fields[key] = `${fields[key] ? `${fields[key]} ` : ""}${piece}`;
    }
  }
  return { fields, body };
}

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const errors = [];
const reports = [];

for (const dir of readdirSync(skillsRoot).sort()) {
  const skillDir = join(skillsRoot, dir);
  if (!statSync(skillDir).isDirectory()) {
    continue;
  }
  const skillFile = join(skillDir, "SKILL.md");
  let text;
  try {
    text = readFileSync(skillFile, "utf8");
  } catch {
    errors.push(`${dir}: missing SKILL.md`);
    continue;
  }
  const { fields, body } = parseFrontmatter(text, `${dir}/SKILL.md`);
  const name = String(fields.name || "");
  const description = String(fields.description || "");
  if (name !== dir) {
    errors.push(`${dir}: frontmatter name "${name}" must match directory`);
  }
  if (name.length < 1 || name.length > 64 || !NAME_RE.test(name)) {
    errors.push(`${dir}: invalid name "${name}"`);
  }
  if (description.length < 1 || description.length > 1024) {
    errors.push(`${dir}: description length ${description.length} (want 1..1024)`);
  }
  if (body.split("\n").length > 500) {
    errors.push(`${dir}: SKILL.md body has more than 500 lines`);
  }
  const scriptsDir = join(skillDir, "scripts");
  let scriptCount = 0;
  try {
    for (const file of readdirSync(scriptsDir)) {
      if (!file.endsWith(".mjs") && !file.endsWith(".sh")) {
        continue;
      }
      scriptCount += 1;
      const src = readFileSync(join(scriptsDir, file), "utf8");
      if (!src.startsWith("#!/usr/bin/env")) {
        errors.push(`${dir}/scripts/${file}: missing shebang`);
      }
      if (/wc_live_[A-Za-z0-9]+/.test(src) || /sk-[A-Za-z0-9]{10,}/.test(src)) {
        errors.push(`${dir}/scripts/${file}: looks like a hardcoded secret`);
      }
    }
  } catch {
    // scripts/ is optional in the spec
  }
  reports.push({ name, descriptionChars: description.length, scriptCount, bodyLines: body.split("\n").length });
}

if (!reports.length) {
  errors.push("no skills found");
}

process.stdout.write(`${JSON.stringify({ skills: reports, errors }, null, 2)}\n`);
if (errors.length) {
  process.stderr.write(errors.map((e) => `error: ${e}`).join("\n") + "\n");
  process.exit(1);
}
