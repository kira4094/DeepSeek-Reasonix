#!/usr/bin/env node
import { createRequire as __cr } from 'node:module'; if (typeof globalThis.require === 'undefined') { globalThis.require = __cr(import.meta.url); }
import {
  formatMcpLifecycleEvent,
  formatMcpSlowToast
} from "./chunk-JGN6VD3B.js";
import {
  buildTransportFromSpec,
  preflightStdioSpec
} from "./chunk-ZPIWUKEJ.js";
import {
  CacheFirstLoop,
  ImmutablePrefix,
  ToolRegistry,
  bridgeMcpTools
} from "./chunk-4XMNMGWP.js";
import "./chunk-7WLGY72J.js";
import {
  McpClient
} from "./chunk-TEUGA73O.js";
import {
  openTranscriptFile,
  recordFromLoopEvent,
  writeRecord
} from "./chunk-IJC3BWW2.js";
import "./chunk-75N64M56.js";
import {
  appendUsage
} from "./chunk-GDWPGJNM.js";
import "./chunk-5CUZ3JDP.js";
import "./chunk-5WOT6JCF.js";
import "./chunk-L3VPEESB.js";
import "./chunk-ZL3BCUZY.js";
import {
  DeepSeekClient
} from "./chunk-T47NAKZP.js";
import "./chunk-25T6CVUP.js";
import "./chunk-AYVL2YX5.js";
import "./chunk-6UNHNVJR.js";
import "./chunk-O5EHJ5L2.js";
import "./chunk-O5RECP35.js";
import "./chunk-6CLGRUYN.js";
import {
  loadDotenv
} from "./chunk-2UQP6H6T.js";
import {
  t
} from "./chunk-4ETZ2I36.js";
import {
  bridgeEndpointEnv,
  defaultConfigPath,
  isPlausibleKey,
  loadApiKey,
  loadEndpoint,
  loadMaxIterPerTurn,
  loadToolRateLimit,
  normalizeMcpConfig,
  readConfig,
  saveApiKey
} from "./chunk-MY7XESPF.js";
import "./chunk-TUK7OWJA.js";

// src/cli/commands/run.ts
import { stdin, stdout } from "process";
import { createInterface } from "readline/promises";
async function ensureApiKey() {
  const existing = loadApiKey();
  if (existing) return existing;
  if (!stdin.isTTY) {
    process.stderr.write(t("run.missingApiKey"));
    process.exit(1);
  }
  process.stdout.write(
    "DeepSeek API key not configured.\nGet one at https://platform.deepseek.com/api_keys\n"
  );
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      const answer = (await rl.question("API key \u203A ")).trim();
      if (!answer) continue;
      if (!isPlausibleKey(answer)) {
        process.stdout.write("Key looks too short. Paste the full token (16+ chars, no spaces).\n");
        continue;
      }
      saveApiKey(answer);
      process.stdout.write(`Saved to ${defaultConfigPath()}

`);
      return answer;
    }
  } finally {
    rl.close();
  }
}
async function runCommand(opts) {
  loadDotenv();
  await ensureApiKey();
  bridgeEndpointEnv();
  const cfg = readConfig();
  const normalizedSpecs = normalizeMcpConfig(
    cfg,
    opts.mcp && opts.mcp.length > 0 ? opts.mcp : void 0
  );
  const clients = [];
  let tools;
  let successCount = 0;
  const workspaceDir = process.cwd();
  if (normalizedSpecs.length > 0) {
    tools = new ToolRegistry({ rateLimit: loadToolRateLimit() });
    for (const spec of normalizedSpecs) {
      let label = "anon";
      let mcp;
      try {
        label = spec.name ?? "anon";
        if (spec.disabled) {
          process.stderr.write(`${formatMcpLifecycleEvent({ state: "disabled", name: label })}
`);
          continue;
        }
        process.stderr.write(`${formatMcpLifecycleEvent({ state: "handshake", name: label })}
`);
        const t0 = Date.now();
        const prefix2 = spec.name ? `${spec.name}_` : normalizedSpecs.length === 1 && opts.mcpPrefix ? opts.mcpPrefix : "";
        if (spec.transport === "stdio") preflightStdioSpec(spec, { cwd: workspaceDir });
        const transport = buildTransportFromSpec(spec, { cwd: workspaceDir });
        mcp = new McpClient({ transport, workspaceDir, requestTimeoutMs: spec.requestTimeoutMs });
        await mcp.initialize();
        const bridge = await bridgeMcpTools(mcp, {
          registry: tools,
          namePrefix: prefix2,
          serverName: label,
          onSlow: (info) => process.stderr.write(
            `${formatMcpSlowToast({ name: info.serverName, p95Ms: info.p95Ms, sampleSize: info.sampleSize })}
`
          )
        });
        process.stderr.write(
          `${formatMcpLifecycleEvent({
            state: "connected",
            name: label,
            tools: bridge.registeredNames.length,
            ms: Date.now() - t0
          })}
`
        );
        clients.push(mcp);
        successCount++;
      } catch (err) {
        await mcp?.close().catch(() => void 0);
        process.stderr.write(
          `${formatMcpLifecycleEvent({ state: "failed", name: label, reason: err.message })}
  ${t("mcpLifecycle.failedSetupConfigHint")}
`
        );
      }
    }
    if (successCount === 0) tools = void 0;
  }
  const ep = loadEndpoint();
  const client = new DeepSeekClient({ apiKey: ep.apiKey, baseUrl: ep.baseUrl });
  const prefix = new ImmutablePrefix({
    system: opts.system,
    toolSpecs: tools?.specs()
  });
  const loop = new CacheFirstLoop({
    client,
    prefix,
    tools,
    model: opts.model,
    budgetUsd: opts.budgetUsd,
    maxIterPerTurn: loadMaxIterPerTurn()
  });
  const prefixHash = prefix.fingerprint;
  let transcriptStream = null;
  if (opts.transcript) {
    transcriptStream = openTranscriptFile(opts.transcript, {
      version: 1,
      source: "reasonix run",
      model: opts.model,
      startedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    writeRecord(transcriptStream, {
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      turn: 1,
      role: "user",
      content: opts.task
    });
  }
  try {
    for await (const ev of loop.step(opts.task)) {
      if (ev.role === "assistant_delta" && ev.content) process.stdout.write(ev.content);
      if (ev.role === "tool") process.stdout.write(`
[tool ${ev.toolName}] ${ev.content}
`);
      if (ev.role === "error") process.stderr.write(`
[error] ${ev.error}
`);
      if (ev.role === "done") process.stdout.write("\n");
      if (ev.role === "assistant_final" && ev.stats?.usage) {
        appendUsage({ session: null, model: ev.stats.model, usage: ev.stats.usage });
      }
      if (transcriptStream && ev.role !== "assistant_delta") {
        writeRecord(transcriptStream, recordFromLoopEvent(ev, { model: opts.model, prefixHash }));
      }
    }
  } finally {
    transcriptStream?.end();
  }
  const s = loop.stats.summary();
  process.stdout.write(
    `
\u2014 turns:${s.turns} cache:${(s.cacheHitRatio * 100).toFixed(1)}% cost:$${s.totalCostUsd.toFixed(6)} save-vs-claude:${s.savingsVsClaudePct.toFixed(1)}%
`
  );
  if (opts.transcript) {
    process.stdout.write(`
transcript: ${opts.transcript}
`);
    process.stdout.write(`  \u2192 npx reasonix replay ${opts.transcript}
`);
  }
  for (const c of clients) await c.close();
}
export {
  runCommand
};
//# sourceMappingURL=run-RT3TKR3K.js.map