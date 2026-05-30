#!/usr/bin/env node
import { createRequire as __cr } from 'node:module'; if (typeof globalThis.require === 'undefined') { globalThis.require = __cr(import.meta.url); }
import {
  LruCache
} from "./chunk-6UNHNVJR.js";
import {
  cacheSavingsUsd
} from "./chunk-O5RECP35.js";

// src/tokenizer.ts
import { existsSync, readFileSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { gunzipSync } from "zlib";
function buildByteToChar() {
  const result = new Array(256);
  const bs = [];
  for (let b = 33; b <= 126; b++) bs.push(b);
  for (let b = 161; b <= 172; b++) bs.push(b);
  for (let b = 174; b <= 255; b++) bs.push(b);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n);
      n++;
    }
  }
  for (let i = 0; i < bs.length; i++) {
    result[bs[i]] = String.fromCodePoint(cs[i]);
  }
  return result;
}
var cached = null;
function resolveDataPath() {
  if (process.env.REASONIX_TOKENIZER_PATH) return process.env.REASONIX_TOKENIZER_PATH;
  const candidates = [];
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(here, "..", "data", "deepseek-tokenizer.json.gz"));
    candidates.push(join(here, "..", "..", "data", "deepseek-tokenizer.json.gz"));
  } catch {
  }
  try {
    const req = createRequire(import.meta.url);
    candidates.push(
      join(dirname(req.resolve("reasonix/package.json")), "data", "deepseek-tokenizer.json.gz")
    );
  } catch {
  }
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0] ?? join(process.cwd(), "data", "deepseek-tokenizer.json.gz");
}
function loadTokenizer() {
  if (cached) return cached;
  const buf = readFileSync(resolveDataPath());
  const json = gunzipSync(buf).toString("utf8");
  const data = JSON.parse(json);
  const mergeRank = /* @__PURE__ */ new Map();
  for (let i = 0; i < data.model.merges.length; i++) {
    mergeRank.set(data.model.merges[i], i);
  }
  const splitRegexes = [];
  for (const p of data.pre_tokenizer.pretokenizers) {
    if (p.type === "Split") {
      splitRegexes.push(new RegExp(p.pattern.Regex, "gu"));
    }
  }
  const addedMap = /* @__PURE__ */ new Map();
  const addedContents = [];
  for (const t of data.added_tokens) {
    if (!t.special) {
      addedMap.set(t.content, t.id);
      addedContents.push(t.content);
    }
  }
  addedContents.sort((a, b) => b.length - a.length);
  const addedPattern = addedContents.length ? new RegExp(addedContents.map(escapeRegex).join("|"), "g") : null;
  cached = {
    vocab: data.model.vocab,
    mergeRank,
    splitRegexes,
    byteToChar: buildByteToChar(),
    addedPattern,
    addedMap
  };
  return cached;
}
function warmupTokenizer() {
  loadTokenizer();
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function applySplit(chunks, re) {
  const out = [];
  for (const chunk of chunks) {
    if (!chunk) continue;
    re.lastIndex = 0;
    let last = 0;
    for (const m of chunk.matchAll(re)) {
      const idx = m.index ?? 0;
      if (idx > last) out.push(chunk.slice(last, idx));
      if (m[0].length > 0) out.push(m[0]);
      last = idx + m[0].length;
    }
    if (last < chunk.length) out.push(chunk.slice(last));
  }
  return out;
}
function byteLevelEncode(s, byteToChar) {
  const bytes = new TextEncoder().encode(s);
  const parts = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) parts[i] = byteToChar[bytes[i]];
  return parts.join("");
}
var bpeCache = new LruCache(8192);
function bpeEncode(piece, mergeRank) {
  if (piece.length <= 1) return piece ? [piece] : [];
  const cached2 = bpeCache.get(piece);
  if (cached2 !== void 0) return cached2;
  const word = Array.from(piece);
  while (word.length > 1) {
    let bestIdx = -1;
    let bestRank = Number.POSITIVE_INFINITY;
    for (let i = 0; i < word.length - 1; i++) {
      const pair = `${word[i]} ${word[i + 1]}`;
      const rank = mergeRank.get(pair);
      if (rank !== void 0 && rank < bestRank) {
        bestRank = rank;
        bestIdx = i;
        if (rank === 0) break;
      }
    }
    if (bestIdx < 0) break;
    word.splice(bestIdx, 2, word[bestIdx] + word[bestIdx + 1]);
  }
  bpeCache.set(piece, word);
  return word;
}
function countTokens(text) {
  if (!text) return 0;
  const t = loadTokenizer();
  let count = 0;
  const process2 = (segment) => {
    if (!segment) return;
    let chunks = [segment];
    for (const re of t.splitRegexes) chunks = applySplit(chunks, re);
    for (const chunk of chunks) {
      if (!chunk) continue;
      const byteLevel = byteLevelEncode(chunk, t.byteToChar);
      const pieces = bpeEncode(byteLevel, t.mergeRank);
      for (const p of pieces) {
        if (t.vocab[p] !== void 0) count++;
      }
    }
  };
  if (t.addedPattern) {
    t.addedPattern.lastIndex = 0;
    let last = 0;
    for (const m of text.matchAll(t.addedPattern)) {
      const idx = m.index ?? 0;
      if (idx > last) process2(text.slice(last, idx));
      if (t.addedMap.has(m[0])) count++;
      last = idx + m[0].length;
    }
    if (last < text.length) process2(text.slice(last));
  } else {
    process2(text);
  }
  return count;
}
var DEFAULT_BOUNDED_TOKENIZE_CHARS = 2 * 1024;
function countTokensBounded(text, maxChars = DEFAULT_BOUNDED_TOKENIZE_CHARS) {
  if (text.length === 0) return 0;
  const cap = Math.floor(maxChars);
  if (cap > 0 && text.length <= cap) return countTokens(text);
  if (cap <= 0) return Math.max(1, Math.ceil(text.length * 0.3));
  const headChars = Math.ceil(cap / 2);
  const tailChars = Math.floor(cap / 2);
  const head = text.slice(0, headChars);
  const tail = tailChars > 0 ? text.slice(-tailChars) : "";
  const sampleChars = head.length + tail.length;
  const sampleTokens = countTokens(head) + countTokens(tail);
  const ratio = sampleChars > 0 ? sampleTokens / sampleChars : 0.3;
  return Math.max(1, Math.ceil(text.length * ratio));
}
var THINK_START = "<think>";
var THINK_END = "</think>";
var DSML = "\uFF5CDSML\uFF5C";
var TC_BEGIN = `<${DSML}tool_calls>`;
var TC_END = `</${DSML}tool_calls>`;
var INVOKE_BEGIN = `<${DSML}invoke name="`;
var INVOKE_END = `</${DSML}invoke>`;
var PARAM_TEMPLATE = `<${DSML}parameter name="{key}" string="{is_str}">{value}</${DSML}parameter>`;
var toolsTemplateCache = /* @__PURE__ */ new WeakMap();
function renderTools(tools) {
  const cached2 = toolsTemplateCache.get(tools);
  if (cached2 !== void 0) return cached2;
  const schemas = tools.map((t) => {
    const fn = t.function ?? t;
    return JSON.stringify(fn);
  }).join("\n");
  const rendered = `## Tools

You have access to a set of tools to help answer the user's question. You can invoke tools by writing a "<${DSML}tool_calls>" block like the following:

<${DSML}tool_calls>
<${DSML}invoke name="$TOOL_NAME">
<${DSML}parameter name="$PARAMETER_NAME" string="true|false">$PARAMETER_VALUE</${DSML}parameter>
...
</${DSML}invoke>
<${DSML}invoke name="$TOOL_NAME2">
...
</${DSML}invoke>
</${DSML}tool_calls>

String parameters should be specified as is and set \`string="true"\`. For all other types (numbers, booleans, arrays, objects), pass the value in JSON format and set \`string="false"\`.

If thinking_mode is enabled (triggered by ${THINK_START}), you MUST output your complete reasoning inside ${THINK_START}...${THINK_END} BEFORE any tool calls or final response.

Otherwise, output directly after ${THINK_END} with tool calls or final response.

### Available Tool Schemas

${schemas}

You MUST strictly follow the above defined tool name and parameter schemas to invoke tool calls.`;
  toolsTemplateCache.set(tools, rendered);
  return rendered;
}
var PER_MESSAGE_TEMPLATE_TOKENS = 6;
var contentTokenCache = new LruCache(4096);
var MAX_CACHEABLE_CHARS = 10 * 1024;
function cachedBoundedTokens(s) {
  if (s.length === 0) return 0;
  const cached2 = contentTokenCache.get(s);
  if (cached2 !== void 0) return cached2;
  const n = countTokensBounded(s);
  if (s.length <= MAX_CACHEABLE_CHARS) contentTokenCache.set(s, n);
  return n;
}
function tokensForMessage(m, dropThisReasoning) {
  let n = 0;
  if (typeof m.content === "string" && m.content.length > 0) {
    n += cachedBoundedTokens(m.content);
  }
  if (m.role === "assistant") {
    if (!dropThisReasoning && typeof m.reasoning_content === "string" && m.reasoning_content.length > 0) {
      n += cachedBoundedTokens(m.reasoning_content);
    }
    const tcs = m.tool_calls;
    if (Array.isArray(tcs) && tcs.length > 0) {
      n += cachedBoundedTokens(JSON.stringify(tcs));
    }
  }
  return n;
}
function estimateConversationTokens(messages, drop_thinking = false) {
  if (messages.length === 0) return 0;
  let lastUserOrDev = -1;
  if (drop_thinking) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const r = messages[i].role;
      if (r === "user" || r === "developer") {
        lastUserOrDev = i;
        break;
      }
    }
  }
  let total = 2;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (drop_thinking && i < lastUserOrDev && m.role === "developer") continue;
    total += PER_MESSAGE_TEMPLATE_TOKENS;
    const dropReasoning = drop_thinking && i < lastUserOrDev && m.role === "assistant";
    total += tokensForMessage(m, dropReasoning);
  }
  return total;
}
function estimateRequestTokens(messages, toolSpecs, drop_thinking = false) {
  let total = estimateConversationTokens(messages, drop_thinking);
  if (toolSpecs && toolSpecs.length > 0) {
    total += countTokensBounded(renderTools(toolSpecs));
  }
  return total;
}

// src/telemetry/cache-diagnostics.ts
import { createHash } from "crypto";
var CACHE_DIAGNOSTICS_MAX_ENTRIES = 50;
function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
function prefixDiagnosticHashes(opts) {
  const toolNames = opts.toolSpecs.map((spec) => spec.function?.name ?? "").filter(Boolean);
  return {
    prefixHash: stableHash({
      system: opts.system,
      tools: opts.toolSpecs,
      shots: opts.fewShots
    }),
    systemHash: stableHash(opts.system),
    toolSpecsHash: stableHash(opts.toolSpecs),
    fewShotsHash: stableHash(opts.fewShots),
    toolCount: opts.toolSpecs.length,
    toolNames
  };
}
function buildCacheDiagnostic(input) {
  const usage = input.usage;
  const { reason, detail } = inferCacheMissReason(input.previous ?? null, input.prefix, usage);
  return {
    ...input.prefix,
    ts: input.now ?? Date.now(),
    turn: input.turn,
    model: input.model,
    inputTokens: usage.promptTokens,
    cachedTokens: usage.promptCacheHitTokens,
    cacheMissTokens: usage.promptCacheMissTokens,
    cacheHitRate: usage.cacheHitRatio,
    estimatedCostUsd: input.estimatedCostUsd,
    savedCostUsd: cacheSavingsUsd(input.model, usage.promptCacheHitTokens),
    missReason: reason,
    missReasonDetail: detail,
    inferred: true
  };
}
function appendCacheDiagnostic(existing, entry, limit = CACHE_DIAGNOSTICS_MAX_ENTRIES) {
  const safeExisting = Array.isArray(existing) ? existing.filter(isCacheDiagnosticEntry) : [];
  const next = [...safeExisting, entry];
  return next.slice(Math.max(0, next.length - limit));
}
function latestCacheDiagnostic(entries) {
  if (!Array.isArray(entries)) return null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (isCacheDiagnosticEntry(entry)) return entry;
  }
  return null;
}
function inferCacheMissReason(previous, current, usage) {
  if (usage.promptCacheMissTokens <= 0) {
    return { reason: "no-miss", detail: "No prompt-side cache miss tokens were reported." };
  }
  if (!previous) {
    return {
      reason: "cold-start",
      detail: "No previous cache evidence exists for this session."
    };
  }
  if (previous.systemHash !== current.systemHash) {
    return {
      reason: "system-prompt-changed",
      detail: `systemHash ${short(previous.systemHash)} -> ${short(current.systemHash)}`
    };
  }
  if (previous.fewShotsHash !== current.fewShotsHash) {
    return {
      reason: "memory-or-skill-changed",
      detail: `fewShotsHash ${short(previous.fewShotsHash)} -> ${short(current.fewShotsHash)}`
    };
  }
  if (previous.toolSpecsHash !== current.toolSpecsHash) {
    const oldNames = previous.toolNames;
    const newNames = current.toolNames;
    const added = newNames.filter((name) => !oldNames.includes(name));
    const removed = oldNames.filter((name) => !newNames.includes(name));
    if (added.length > 0 && removed.length === 0 && looksLikeMcpToolNames(added)) {
      return {
        reason: "mcp-tool-hot-add",
        detail: `MCP-like tool(s) added: ${added.join(", ")}`
      };
    }
    if (added.length > 0 || removed.length > 0 || previous.toolCount !== current.toolCount) {
      const parts = [];
      if (added.length > 0) parts.push(`added ${added.join(", ")}`);
      if (removed.length > 0) parts.push(`removed ${removed.join(", ")}`);
      if (parts.length === 0)
        parts.push(`tool count ${previous.toolCount} -> ${current.toolCount}`);
      return {
        reason: "tool-list-changed",
        detail: parts.join("; ")
      };
    }
    return {
      reason: "tool-schema-or-order-changed",
      detail: `toolSpecsHash ${short(previous.toolSpecsHash)} -> ${short(current.toolSpecsHash)}`
    };
  }
  if (previous.prefixHash !== current.prefixHash) {
    return {
      reason: "unknown",
      detail: `prefixHash changed (${short(previous.prefixHash)} -> ${short(current.prefixHash)}) but sub-hashes matched.`
    };
  }
  return {
    reason: "unknown",
    detail: "Prefix hashes matched. DeepSeek does not return cache-miss reasons, so this miss is likely due to provider-side cache state, TTL, or prompt bytes outside the immutable prefix."
  };
}
function renderCacheMissReport(entries, opts = {}) {
  const valid = Array.isArray(entries) ? entries.filter(isCacheDiagnosticEntry) : [];
  if (valid.length === 0) {
    return [
      "cache miss report",
      "",
      "No cache diagnostics recorded for this session yet.",
      "Run one model turn first. DeepSeek reports hit/miss token counts; Reasonix infers miss reasons locally from prefix hashes."
    ].join("\n");
  }
  const limit = opts.limit ?? 8;
  const recent = valid.slice(Math.max(0, valid.length - limit));
  const totalCached = valid.reduce((sum, e) => sum + e.cachedTokens, 0);
  const totalMiss = valid.reduce((sum, e) => sum + e.cacheMissTokens, 0);
  const totalInput = totalCached + totalMiss;
  const hitRate = totalInput > 0 ? totalCached / totalInput : 0;
  const saved = valid.reduce((sum, e) => sum + e.savedCostUsd, 0);
  const lines = [
    "cache miss report",
    `turns: ${valid.length} \xB7 input: ${totalInput.toLocaleString()} \xB7 cached: ${totalCached.toLocaleString()} \xB7 hit rate: ${pct(hitRate)} \xB7 saved: ${usd(saved)}`,
    "note: DeepSeek does not return a cache-miss reason. Reasonix infers the reason locally from byte-stable prefix evidence.",
    ""
  ];
  for (const entry of recent) {
    lines.push(
      `#${entry.turn} ${entry.model} \xB7 input ${entry.inputTokens.toLocaleString()} \xB7 cached ${entry.cachedTokens.toLocaleString()} \xB7 miss ${entry.cacheMissTokens.toLocaleString()} \xB7 hit ${pct(entry.cacheHitRate)} \xB7 cost ${usd(entry.estimatedCostUsd)} \xB7 saved ${usd(entry.savedCostUsd)}`,
      `  reason: ${entry.missReason} \u2014 ${entry.missReasonDetail}`,
      `  prefix: ${short(entry.prefixHash)} \xB7 system ${short(entry.systemHash)} \xB7 tools ${short(entry.toolSpecsHash)} (${entry.toolCount}) \xB7 few-shot ${short(entry.fewShotsHash)}`
    );
  }
  return lines.join("\n");
}
function isCacheDiagnosticEntry(value) {
  if (!value || typeof value !== "object") return false;
  const entry = value;
  return typeof entry.ts === "number" && typeof entry.turn === "number" && typeof entry.model === "string" && typeof entry.prefixHash === "string" && typeof entry.systemHash === "string" && typeof entry.toolSpecsHash === "string" && typeof entry.fewShotsHash === "string" && typeof entry.inputTokens === "number" && typeof entry.cachedTokens === "number" && typeof entry.cacheMissTokens === "number" && typeof entry.cacheHitRate === "number" && typeof entry.estimatedCostUsd === "number" && typeof entry.savedCostUsd === "number" && typeof entry.missReason === "string" && typeof entry.missReasonDetail === "string";
}
function looksLikeMcpToolNames(names) {
  return names.some((name) => name.includes("_") || name.includes("__"));
}
function short(hash) {
  return hash.slice(0, 8);
}
function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}
function usd(value) {
  return `$${value < 0.01 ? value.toFixed(6) : value.toFixed(4)}`;
}

export {
  resolveDataPath,
  warmupTokenizer,
  countTokens,
  countTokensBounded,
  estimateRequestTokens,
  prefixDiagnosticHashes,
  buildCacheDiagnostic,
  appendCacheDiagnostic,
  latestCacheDiagnostic,
  renderCacheMissReport,
  isCacheDiagnosticEntry
};
//# sourceMappingURL=chunk-ZL3BCUZY.js.map