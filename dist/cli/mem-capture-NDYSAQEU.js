#!/usr/bin/env node
import { createRequire as __cr } from 'node:module'; if (typeof globalThis.require === 'undefined') { globalThis.require = __cr(import.meta.url); }
import "./chunk-TUK7OWJA.js";

// src/memory/mem-capture.ts
import { spawn } from "child_process";
import { createHash } from "crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
var MEM_DIR = join(homedir(), ".reasonix", "mem", "sessions");
var CHUNK_SIZE = 50;
var CHECKPOINT_INTERVAL = 10;
var TOOL_RESULT_MAX_CHARS = 2e3;
function captureTurn(opts) {
  const hash = createHash("sha1").update(opts.cwd).digest("hex").slice(0, 16);
  const dateStr = todayCompact();
  let sessionDir = (opts.sessionName || "default").replace(/[<>:"/\\|?*]/g, "_").replace(/__archive_\d+.*$/, "").slice(0, 80);
  const dir = join(MEM_DIR, hash, dateStr, sessionDir);
  mkdirSync(dir, { recursive: true });
  const metaPath = join(MEM_DIR, hash, "meta.json");
  if (!existsSync(metaPath)) {
    try {
      writeFileSync(metaPath, JSON.stringify({ cwd: opts.cwd }), "utf8");
    } catch {
    }
  }
  const chunkIndex = resolveChunkIndex(dir);
  const filePath = join(
    dir,
    `chunk-${String(chunkIndex).padStart(3, "0")}.jsonl`
  );
  const hasText = opts.text?.trim().length > 0;
  const hasAssistant = opts.lastAssistantText?.trim().length > 0;
  if (!hasText && !hasAssistant) return;
  const hasToolCalls = opts.toolCalls && opts.toolCalls.length > 0;
  const captureType = hasToolCalls ? "tool_call" : hasText ? "user_message" : "assistant_message";
  const entry = {
    type: captureType,
    t: opts.turn ?? 0,
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    text: opts.text || "",
    lastAssistantText: opts.lastAssistantText || "",
    sessionName: opts.sessionName
  };
  if (hasToolCalls) {
    entry.toolCalls = opts.toolCalls.map((tc) => ({
      name: tc.name,
      args: tc.args,
      result: truncateOutput(tc.result)
    }));
  }
  appendFileSync(filePath, `${JSON.stringify(entry)}
`, "utf8");
  const turn = opts.turn ?? 0;
  if (turn > 0 && turn % CHECKPOINT_INTERVAL === 0) {
    spawnSummaryChild(opts.cwd);
  }
}
function todayCompact() {
  const d = /* @__PURE__ */ new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
function truncateOutput(output) {
  if (!output) return void 0;
  if (output.length <= TOOL_RESULT_MAX_CHARS) return output;
  return `${output.slice(0, TOOL_RESULT_MAX_CHARS)}
\u2026 (truncated ${output.length - TOOL_RESULT_MAX_CHARS} chars)`;
}
function resolveChunkIndex(dir) {
  let maxChunk = -1;
  try {
    const files = readdirSync(dir);
    for (const f of files) {
      const match = f.match(/^chunk-(\d+)\.jsonl$/);
      if (match?.[1]) {
        const n = Number.parseInt(match[1], 10);
        if (n > maxChunk) maxChunk = n;
      }
    }
  } catch {
    return 0;
  }
  if (maxChunk < 0) return 0;
  const currentPath = join(
    dir,
    `chunk-${String(maxChunk).padStart(3, "0")}.jsonl`
  );
  if (existsSync(currentPath)) {
    const content = readFileSync(currentPath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    if (lines.length < CHUNK_SIZE) return maxChunk;
  }
  return maxChunk + 1;
}
function spawnSummaryChild(cwd) {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const summarizerPath = join(currentDir, "mem-summarize.js");
  const code = `import(${JSON.stringify(`file://${summarizerPath}`)}).then(m => m.summarizeSession(${JSON.stringify({ cwd })})).catch(() => {})`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}
export {
  captureTurn
};
//# sourceMappingURL=mem-capture-NDYSAQEU.js.map