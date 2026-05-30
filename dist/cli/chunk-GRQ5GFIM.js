#!/usr/bin/env node
import { createRequire as __cr } from 'node:module'; if (typeof globalThis.require === 'undefined') { globalThis.require = __cr(import.meta.url); }
import {
  checkOllamaStatus
} from "./chunk-A54B2AFL.js";
import {
  indexExists
} from "./chunk-V5MX275R.js";
import {
  detectProxyUrl,
  matchesNoProxy,
  resolveNoProxy
} from "./chunk-Z3IHAJSA.js";
import {
  isCacheDiagnosticEntry,
  resolveDataPath
} from "./chunk-ZL3BCUZY.js";
import {
  DeepSeekClient,
  pickPrimaryBalance
} from "./chunk-T47NAKZP.js";
import {
  loadHooks
} from "./chunk-AYVL2YX5.js";
import {
  listSessions
} from "./chunk-O5EHJ5L2.js";
import {
  VERSION
} from "./chunk-6CLGRUYN.js";
import {
  loadDotenv
} from "./chunk-2UQP6H6T.js";
import {
  t
} from "./chunk-4ETZ2I36.js";
import {
  defaultConfigPath,
  loadEndpoint,
  loadProxyConfig,
  normalizeMcpConfig,
  readConfig,
  resolveSemanticEmbeddingConfig
} from "./chunk-MY7XESPF.js";

// src/cli/commands/doctor.ts
import { existsSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
async function runDoctorChecks(projectRoot) {
  const r = await Promise.all([
    checkApiKey(),
    checkConfig(),
    checkApiReach(),
    checkTokenizer(),
    checkSessions(),
    checkHooks(projectRoot),
    checkOllama(projectRoot),
    checkProject(projectRoot)
  ]);
  return [r[0], r[1], ...checkProxy(), r[2], r[3], r[4], r[5], r[6], r[7]];
}
async function runCacheDoctorChecks(projectRoot) {
  const r = await Promise.all([
    checkCacheDynamicPrompt(projectRoot),
    checkCacheMcpOrder(),
    checkCacheSkillsAndMemory(projectRoot),
    checkCacheHooks(projectRoot),
    checkCacheEvidence()
  ]);
  return r;
}
var PROXY_PROBE_HOSTS = ["api.deepseek.com", "github.com", "api.github.com"];
function checkProxy() {
  const cfg = loadProxyConfig();
  const envUrl = detectProxyUrl();
  const url = cfg.url ?? envUrl;
  if (!url) {
    return [
      {
        id: "proxy",
        label: "http proxy   ",
        level: "ok",
        detail: "no proxy configured (cfg.proxy.url / HTTPS_PROXY / HTTP_PROXY / ALL_PROXY unset) \u2014 direct connection"
      }
    ];
  }
  let redacted = url;
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = "***";
      u.password = "";
      redacted = u.toString();
    }
  } catch {
  }
  const urlSource = cfg.url ? "cfg.proxy.url" : "HTTPS_PROXY";
  if (cfg.disabled) {
    return [
      {
        id: "proxy",
        label: "http proxy   ",
        level: "ok",
        detail: `${urlSource}=${redacted} is set but cfg.proxy.disabled \u2014 Reasonix routes direct`
      }
    ];
  }
  const resolved = resolveNoProxy(process.env, {
    extraNoProxy: cfg.noProxy,
    bypassDeepSeekDirect: cfg.bypassDeepSeekDirect
  });
  const total = resolved.all.length;
  const sourceSummary = [
    `defaults ${resolved.defaults.length}`,
    resolved.envSystem.length > 0 ? `env ${resolved.envSystem.length}` : null,
    resolved.envReasonix.length > 0 ? `REASONIX ${resolved.envReasonix.length}` : null,
    resolved.extra.length > 0 ? `config ${resolved.extra.length}` : null
  ].filter(Boolean).join(" + ");
  const proxyCheck = {
    id: "proxy",
    label: "http proxy   ",
    level: "ok",
    detail: `routing fetch through ${redacted} via ${urlSource} (NO_PROXY: ${total} pattern${total === 1 ? "" : "s"} \u2014 ${sourceSummary})`
  };
  const probes = PROXY_PROBE_HOSTS.map(
    (h) => `${h} \u2192 ${matchesNoProxy(h, resolved.all) ? "direct" : "via proxy"}`
  );
  const routingCheck = {
    id: "proxy-routing",
    label: "proxy routing",
    level: "ok",
    detail: probes.join(", ")
  };
  return [proxyCheck, routingCheck];
}
var TTY = process.stdout.isTTY && process.env.TERM !== "dumb";
function color(text, code) {
  if (!TTY) return text;
  return `\x1B[${code}m${text}\x1B[0m`;
}
function badge(level) {
  if (level === "ok") return color("\u2713", "32");
  if (level === "warn") return color("\u26A0", "33");
  return color("\u2717", "31");
}
function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
async function checkApiKey() {
  const fromEnv = process.env.DEEPSEEK_API_KEY;
  if (fromEnv) {
    return {
      id: "api-key",
      label: "api key      ",
      level: "ok",
      detail: "set via env DEEPSEEK_API_KEY"
    };
  }
  try {
    const cfg = readConfig();
    if (cfg.apiKey) {
      return {
        id: "api-key",
        label: "api key      ",
        level: "ok",
        detail: `from ${defaultConfigPath()}`
      };
    }
  } catch {
  }
  return {
    id: "api-key",
    label: "api key      ",
    level: "fail",
    detail: "not set \u2014 `reasonix setup` to save one, or export DEEPSEEK_API_KEY. Get a key at https://platform.deepseek.com/api_keys"
  };
}
async function checkConfig() {
  const path = defaultConfigPath();
  if (!existsSync(path)) {
    return {
      id: "config",
      label: "config       ",
      level: "warn",
      detail: "missing \u2014 running with library defaults. `reasonix setup` writes one."
    };
  }
  try {
    const cfg = readConfig(path);
    const parts = [];
    if (cfg.model) parts.push(`model=${cfg.model}`);
    if (cfg.reasoningEffort) parts.push(`effort=${cfg.reasoningEffort}`);
    if (cfg.editMode) parts.push(`editMode=${cfg.editMode}`);
    const mcpCount = normalizeMcpConfig(cfg).length;
    if (mcpCount > 0) parts.push(`mcp=${mcpCount}`);
    return {
      id: "config",
      label: "config       ",
      level: "ok",
      detail: `${path}${parts.length ? ` (${parts.join(", ")})` : ""}`
    };
  } catch (err) {
    return {
      id: "config",
      label: "config       ",
      level: "fail",
      detail: t("doctorErrors.unreadable", { path, message: err.message })
    };
  }
}
async function checkApiReach() {
  const endpoint = loadEndpoint();
  const key = endpoint.apiKey;
  if (!key) {
    return {
      id: "api-reach",
      label: "api reach    ",
      level: "warn",
      detail: "skipped \u2014 no api key to test with"
    };
  }
  try {
    const client = new DeepSeekClient({ apiKey: key, baseUrl: endpoint.baseUrl });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8e3);
    let models;
    let balance;
    try {
      models = await client.listModels({ signal: ctl.signal });
      if (models) {
        return {
          id: "api-reach",
          label: "api reach    ",
          level: "ok",
          detail: `/models ok \u2014 ${summarizeModels(models.data)}`
        };
      }
      balance = await client.getBalance({ signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!balance) {
      return {
        id: "api-reach",
        label: "api reach    ",
        level: "fail",
        detail: "/models and /user/balance returned null \u2014 auth failed or network blocked"
      };
    }
    const summary = summarizeBalances(balance.balance_infos);
    if (!balance.is_available) {
      return {
        id: "api-reach",
        label: "api reach    ",
        level: "warn",
        detail: `account flagged not-available${summary ? ` (${summary})` : ""} \u2014 top up or check your dashboard`
      };
    }
    return {
      id: "api-reach",
      label: "api reach    ",
      level: "ok",
      detail: summary ? `/user/balance ok \u2014 ${summary}` : "/user/balance ok"
    };
  } catch (err) {
    return {
      id: "api-reach",
      label: "api reach    ",
      level: "fail",
      detail: `${err.message}`
    };
  }
}
function summarizeModels(models) {
  if (models.length === 0) return "0 models";
  const ids = models.map((m) => m.id).filter(Boolean);
  const preview = ids.slice(0, 3).join(", ");
  const suffix = ids.length > 3 ? ", ..." : "";
  return `${models.length} model${models.length === 1 ? "" : "s"}${preview ? ` (${preview}${suffix})` : ""}`;
}
function summarizeBalances(infos) {
  if (infos.length === 0) return "";
  const primary = pickPrimaryBalance(infos);
  if (infos.length === 1 || !primary)
    return primary ? `${primary.total_balance} ${primary.currency}` : "";
  const rest = infos.filter((i) => i !== primary).map((i) => `${i.total_balance} ${i.currency}`);
  return `${primary.total_balance} ${primary.currency} + ${rest.join(" + ")}`;
}
async function checkTokenizer() {
  const path = resolveDataPath();
  if (existsSync(path)) {
    try {
      const stat = statSync(path);
      return {
        id: "tokenizer",
        label: "tokenizer    ",
        level: "ok",
        detail: `${path} (${fmtBytes(stat.size)})`
      };
    } catch {
    }
  }
  return {
    id: "tokenizer",
    label: "tokenizer    ",
    level: "warn",
    detail: "data/deepseek-tokenizer.json.gz not found \u2014 token counts will fall back to char heuristics"
  };
}
async function checkSessions() {
  try {
    const list = listSessions();
    if (list.length === 0) {
      return {
        id: "sessions",
        label: "sessions     ",
        level: "ok",
        detail: "0 saved"
      };
    }
    const totalBytes = list.reduce((s, e) => s + e.size, 0);
    const oldest = list[list.length - 1];
    const ageDays = Math.floor((Date.now() - oldest.mtime.getTime()) / (24 * 60 * 60 * 1e3));
    const stale = list.filter(
      (e) => Date.now() - e.mtime.getTime() >= 90 * 24 * 60 * 60 * 1e3
    ).length;
    const detail = `${list.length} saved \xB7 ${fmtBytes(totalBytes)} \xB7 oldest ${ageDays}d`;
    if (stale > 0) {
      return {
        id: "sessions",
        label: "sessions     ",
        level: "warn",
        detail: `${detail} \xB7 ${stale} idle \u226590d (run \`reasonix prune-sessions\`)`
      };
    }
    return { id: "sessions", label: "sessions     ", level: "ok", detail };
  } catch (err) {
    return {
      id: "sessions",
      label: "sessions     ",
      level: "warn",
      detail: t("doctorErrors.cannotList", { message: err.message })
    };
  }
}
async function checkHooks(projectRoot) {
  try {
    const all = loadHooks({ projectRoot });
    const global = all.filter((h) => h.scope === "global").length;
    const project = all.filter((h) => h.scope === "project").length;
    return {
      id: "hooks",
      label: "hooks        ",
      level: "ok",
      detail: `${global} global, ${project} project`
    };
  } catch (err) {
    return {
      id: "hooks",
      label: "hooks        ",
      level: "warn",
      detail: t("doctorErrors.parseFailed", { message: err.message })
    };
  }
}
async function checkCacheDynamicPrompt(projectRoot) {
  const path = join(projectRoot, "REASONIX.md");
  if (!existsSync(path)) {
    return {
      id: "cache-dynamic-prompt",
      label: "cache prompt ",
      level: "ok",
      detail: "no project REASONIX.md found; no obvious project-memory timestamp source"
    };
  }
  try {
    const body = readFileSync(path, "utf8");
    const dynamicPattern = /\b(Date\.now|new Date|toISOString|timestamp|current time|today is|当前时间|今天是)\b/i;
    if (dynamicPattern.test(body)) {
      return {
        id: "cache-dynamic-prompt",
        label: "cache prompt ",
        level: "warn",
        detail: "REASONIX.md contains timestamp-like text/code; dynamic time in the system prompt changes the byte-stable prefix"
      };
    }
    return {
      id: "cache-dynamic-prompt",
      label: "cache prompt ",
      level: "ok",
      detail: "REASONIX.md has no obvious timestamp injection markers"
    };
  } catch (err) {
    return {
      id: "cache-dynamic-prompt",
      label: "cache prompt ",
      level: "warn",
      detail: `could not read REASONIX.md: ${err.message}`
    };
  }
}
async function checkCacheMcpOrder() {
  try {
    const cfg = readConfig();
    const specs = normalizeMcpConfig(cfg).filter((spec) => !spec.disabled);
    if (specs.length === 0) {
      return {
        id: "cache-mcp-order",
        label: "cache mcp    ",
        level: "ok",
        detail: "no enabled MCP servers configured"
      };
    }
    const unnamed = specs.filter((spec) => !spec.name).length;
    if (unnamed > 0) {
      return {
        id: "cache-mcp-order",
        label: "cache mcp    ",
        level: "warn",
        detail: `${unnamed}/${specs.length} MCP server specs have no stable name; name servers so tool prefixes stay deterministic`
      };
    }
    return {
      id: "cache-mcp-order",
      label: "cache mcp    ",
      level: "ok",
      detail: `${specs.length} enabled MCP server${specs.length === 1 ? "" : "s"} have stable names; tool order/schema are normalized before prefix hashing`
    };
  } catch (err) {
    return {
      id: "cache-mcp-order",
      label: "cache mcp    ",
      level: "warn",
      detail: `could not inspect MCP config: ${err.message}`
    };
  }
}
async function checkCacheSkillsAndMemory(projectRoot) {
  const markers = ["REASONIX.md", ".reasonix"].filter(
    (name) => existsSync(join(projectRoot, name))
  );
  return {
    id: "cache-memory-skills",
    label: "cache memory ",
    level: "ok",
    detail: markers.length > 0 ? `${markers.join(", ")} present; project memory is loaded into the immutable prefix and should only change on /new or restart` : "no project memory markers found; skill/memory prefix churn unlikely from this workspace"
  };
}
async function checkCacheHooks(projectRoot) {
  try {
    const all = loadHooks({ projectRoot });
    if (all.length === 0) {
      return {
        id: "cache-hooks",
        label: "cache hooks  ",
        level: "ok",
        detail: "no hooks loaded"
      };
    }
    return {
      id: "cache-hooks",
      label: "cache hooks  ",
      level: "warn",
      detail: `${all.length} hook${all.length === 1 ? "" : "s"} loaded; ensure hook output does not inject timestamps or mutate prompt-visible files every turn`
    };
  } catch (err) {
    return {
      id: "cache-hooks",
      label: "cache hooks  ",
      level: "warn",
      detail: `could not inspect hooks: ${err.message}`
    };
  }
}
async function checkCacheEvidence() {
  try {
    const sessions = listSessions();
    const withEvidence = sessions.filter(
      (s) => s.meta.cacheDiagnostics?.some((entry) => isCacheDiagnosticEntry(entry))
    );
    if (withEvidence.length === 0) {
      return {
        id: "cache-evidence",
        label: "cache report ",
        level: "warn",
        detail: "no session has cacheDiagnostics yet; run a model turn, then use /cache-miss-report"
      };
    }
    return {
      id: "cache-evidence",
      label: "cache report ",
      level: "ok",
      detail: `${withEvidence.length}/${sessions.length} saved session${sessions.length === 1 ? "" : "s"} include cacheDiagnostics evidence`
    };
  } catch (err) {
    return {
      id: "cache-evidence",
      label: "cache report ",
      level: "warn",
      detail: `could not inspect session meta: ${err.message}`
    };
  }
}
async function checkOllama(projectRoot) {
  let exists = false;
  try {
    exists = await indexExists(projectRoot);
  } catch {
  }
  if (!exists) {
    return {
      id: "semantic",
      label: "semantic     ",
      level: "ok",
      detail: "not in use (no semantic index built; `reasonix index` to enable)"
    };
  }
  const meta = readSemanticMeta(projectRoot);
  if (meta?.provider === "openai-compat") {
    const resolved = resolveSemanticEmbeddingConfig();
    if (resolved.provider !== "openai-compat") {
      return {
        id: "semantic",
        label: "semantic     ",
        level: "warn",
        detail: `index uses openai-compat/${meta.model} but current config resolves to ${resolved.provider}/${resolved.model} \u2014 rebuild before searching`
      };
    }
    return {
      id: "semantic",
      label: "semantic     ",
      level: "ok",
      detail: `openai-compat \xB7 ${resolved.baseUrl} \xB7 model ${resolved.model} \xB7 api key configured`
    };
  }
  try {
    const model = meta?.model || process.env.REASONIX_EMBED_MODEL || "nomic-embed-text";
    const status = await checkOllamaStatus(model);
    if (!status.binaryFound) {
      return {
        id: "semantic",
        label: "semantic     ",
        level: "warn",
        detail: "ollama binary not on PATH \u2014 semantic_search will fail; install from https://ollama.com"
      };
    }
    if (!status.daemonRunning) {
      return {
        id: "semantic",
        label: "semantic     ",
        level: "warn",
        detail: "ollama daemon not running \u2014 `ollama serve` (or call /semantic in TUI to auto-start)"
      };
    }
    if (!status.modelPulled) {
      return {
        id: "semantic",
        label: "semantic     ",
        level: "warn",
        detail: `model ${status.modelName} not pulled \u2014 \`ollama pull ${status.modelName}\``
      };
    }
    return {
      id: "semantic",
      label: "semantic     ",
      level: "ok",
      detail: `ollama daemon up \xB7 model ${status.modelName} ready`
    };
  } catch (err) {
    return {
      id: "semantic",
      label: "semantic     ",
      level: "warn",
      detail: t("doctorErrors.probeFailed", { message: err.message })
    };
  }
}
function readSemanticMeta(projectRoot) {
  try {
    const raw = readFileSync(join(projectRoot, ".reasonix", "semantic", "index.meta.json"), "utf8");
    const parsed = JSON.parse(raw);
    return {
      provider: parsed.provider === "openai-compat" ? "openai-compat" : "ollama",
      model: typeof parsed.model === "string" ? parsed.model : ""
    };
  } catch {
    return null;
  }
}
async function checkProject(projectRoot) {
  const markers = [".git", "REASONIX.md", "package.json", "pyproject.toml", "Cargo.toml", "go.mod"];
  const found = markers.filter((m) => existsSync(join(projectRoot, m)));
  if (found.length === 0) {
    return {
      id: "project",
      label: "project      ",
      level: "warn",
      detail: `${projectRoot} has none of: ${markers.slice(0, 3).join(", ")} \u2026 \u2014 \`reasonix code\` will still run, but @-mentions and project memory have nothing to anchor`
    };
  }
  return {
    id: "project",
    label: "project      ",
    level: "ok",
    detail: `${projectRoot} (${found.join(", ")})`
  };
}
function formatDoctorJson(checks, version) {
  const ok = checks.filter((c) => c.level === "ok").length;
  const warn = checks.filter((c) => c.level === "warn").length;
  const fail = checks.filter((c) => c.level === "fail").length;
  return JSON.stringify({
    version,
    summary: { ok, warn, fail },
    checks: checks.map((c) => ({ id: c.id, status: c.level, message: c.detail }))
  });
}
async function doctorCommand(opts = {}) {
  loadDotenv();
  const projectRoot = resolve(process.cwd());
  const json = !!opts.json;
  const cacheOnly = !!opts.cache;
  if (!json) {
    console.log(
      `${color(`reasonix ${VERSION}  \xB7  ${cacheOnly ? "doctor --cache" : "doctor"}`, "1")}  (cwd: ${projectRoot})`
    );
    console.log(`  home: ${homedir()}`);
    console.log("");
  }
  const checks = cacheOnly ? await runCacheDoctorChecks(projectRoot) : await runDoctorChecks(projectRoot);
  const ok = checks.filter((c) => c.level === "ok").length;
  const warn = checks.filter((c) => c.level === "warn").length;
  const fail = checks.filter((c) => c.level === "fail").length;
  if (json) {
    console.log(formatDoctorJson(checks, VERSION));
    if (fail > 0) process.exit(1);
    return;
  }
  for (const c of checks) {
    console.log(`  ${badge(c.level)}  ${c.label}  ${c.detail}`);
  }
  console.log("");
  const summary = `${ok} ok \xB7 ${warn} warn \xB7 ${fail} fail`;
  if (fail > 0) {
    console.log(color(summary, "31"));
    process.exit(1);
  } else if (warn > 0) {
    console.log(color(summary, "33"));
  } else {
    console.log(color(summary, "32"));
  }
}

export {
  runDoctorChecks,
  runCacheDoctorChecks,
  formatDoctorJson,
  doctorCommand
};
//# sourceMappingURL=chunk-GRQ5GFIM.js.map