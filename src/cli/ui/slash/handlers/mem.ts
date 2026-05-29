import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { SlashHandler } from "../dispatch.js";

const mem: SlashHandler = (_args, _loop, ctx) => {
  const cwd = resolve(process.cwd());
  const hash = createHash("sha1").update(cwd).digest("hex").slice(0, 16);
  const dateStr = todayCompact();
  const dir = join(homedir(), ".reasonix", "mem", "sessions", hash, dateStr);

  if (!existsSync(dir)) {
    return { info: "No session memory recorded yet for today." };
  }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();
  if (files.length === 0) {
    return { info: "No session memory recorded yet for today." };
  }

  const records: Array<Record<string, unknown>> = [];
  for (const f of files) {
    const raw = readFileSync(join(dir, f), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { records.push(JSON.parse(trimmed)); } catch { /* skip */ }
    }
  }

  if (records.length === 0) {
    return { info: "No session memory recorded yet for today." };
  }

  // Show last 5 entries
  const preview = records.slice(-5)
    .map((r) => `  [${String(r.t || "?").padStart(3)}] ${(r.text as string || "").slice(0, 80)}`)
    .join("\n");

  return {
    info: `Session memory: ${records.length} turns captured today.\n${preview}`,
  };
};

function todayCompact(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export const handlers: Record<string, SlashHandler> = { mem };
