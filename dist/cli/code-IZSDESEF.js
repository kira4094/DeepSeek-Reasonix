#!/usr/bin/env node
import { createRequire as __cr } from 'node:module'; if (typeof globalThis.require === 'undefined') { globalThis.require = __cr(import.meta.url); }
import {
  buildCodeToolset
} from "./chunk-5JBTJYWM.js";
import "./chunk-TX2U3QKU.js";
import {
  chatCommand
} from "./chunk-AP3PPK6F.js";
import "./chunk-JMBMLOBP.js";
import "./chunk-RZCRW6B5.js";
import "./chunk-X4X7HXKP.js";
import "./chunk-JGN6VD3B.js";
import "./chunk-ZPIWUKEJ.js";
import "./chunk-YFHAISDM.js";
import "./chunk-6DEO3COY.js";
import "./chunk-IAPTBV4B.js";
import "./chunk-3XYTTYUZ.js";
import "./chunk-XJXDHAES.js";
import "./chunk-JJ4D6VBC.js";
import {
  markPhase
} from "./chunk-ZZM6QJ4W.js";
import "./chunk-4XMNMGWP.js";
import "./chunk-7WLGY72J.js";
import "./chunk-TEUGA73O.js";
import "./chunk-IJC3BWW2.js";
import "./chunk-75N64M56.js";
import "./chunk-GDWPGJNM.js";
import "./chunk-5CUZ3JDP.js";
import {
  detectForeignAgentPlatform
} from "./chunk-5WOT6JCF.js";
import "./chunk-FM3SAL6X.js";
import "./chunk-AZCMURQM.js";
import "./chunk-2CONX3GE.js";
import "./chunk-PLHAZOLZ.js";
import "./chunk-L3VPEESB.js";
import "./chunk-GRQ5GFIM.js";
import "./chunk-A54B2AFL.js";
import "./chunk-V5MX275R.js";
import "./chunk-Z3IHAJSA.js";
import "./chunk-ZL3BCUZY.js";
import "./chunk-T47NAKZP.js";
import "./chunk-25T6CVUP.js";
import "./chunk-AYVL2YX5.js";
import "./chunk-6UNHNVJR.js";
import {
  sanitizeName
} from "./chunk-O5EHJ5L2.js";
import "./chunk-O5RECP35.js";
import "./chunk-6CLGRUYN.js";
import {
  loadDotenv
} from "./chunk-2UQP6H6T.js";
import {
  t
} from "./chunk-4ETZ2I36.js";
import {
  DEFAULT_MODEL,
  bridgeEndpointEnv,
  loadModel,
  normalizeMcpConfig,
  readConfig,
  specToRaw
} from "./chunk-MY7XESPF.js";
import "./chunk-TUK7OWJA.js";

// src/cli/commands/code.tsx
import { readFileSync } from "fs";
import { basename, resolve } from "path";
async function codeCommand(opts = {}) {
  markPhase("code_command_enter");
  const resolvedModel = opts.model?.trim() || loadModel() || DEFAULT_MODEL;
  loadDotenv();
  bridgeEndpointEnv();
  const { codeSystemPrompt } = await import("./prompt-2LWWS5TG.js");
  const rootDir = resolve(opts.dir ?? process.cwd());
  const cfg = readConfig();
  const explicitResume = opts.forceResume || opts.forceNew;
  const autoResume = opts.noSession ? false : explicitResume || cfg.autoResumeSession !== false;
  const session = autoResume ? `code-${sanitizeName(basename(rootDir))}` : void 0;
  markPhase("semantic_bootstrap_start");
  const { tools, jobs, registerRooted, reBootstrapSemantic, semantic } = await buildCodeToolset({
    rootDir
  });
  markPhase(
    semantic.enabled ? "semantic_bootstrap_done_enabled" : "semantic_bootstrap_done_skipped"
  );
  process.stderr.write(
    `${t("startup.codeRooted", {
      rootDir,
      session: session ?? t("startup.ephemeral"),
      tools: tools.size,
      semantic: semantic.enabled ? t("startup.semanticOn") : ""
    })}
`
  );
  const foreign = detectForeignAgentPlatform(rootDir);
  if (foreign) {
    process.stderr.write(t("code.workspaceConflict", { platforms: foreign.join(", ") }));
  }
  process.once("exit", () => {
    void jobs.shutdown();
  });
  let systemAppendFileContents;
  if (opts.systemAppend !== void 0 && opts.systemAppend.trim().length === 0) {
    process.stderr.write(t("code.systemAppendEmpty"));
  }
  if (opts.systemAppendFile) {
    const filePath = resolve(opts.systemAppendFile);
    try {
      systemAppendFileContents = readFileSync(filePath, "utf8");
    } catch (err) {
      const e = err;
      const errorDetails = e.code ? `[${e.code}] ${e.message}` : e.message;
      process.stderr.write(t("code.systemAppendFileReadError", { filePath, errorDetails }));
      process.exit(1);
    }
  }
  let currentRoot = rootDir;
  let semanticEnabled = semantic.enabled;
  const codeRebuildSystem = () => codeSystemPrompt(currentRoot, {
    hasSemanticSearch: semanticEnabled,
    systemAppend: opts.systemAppend,
    systemAppendFile: systemAppendFileContents,
    modelId: resolvedModel
  });
  await chatCommand({
    model: resolvedModel,
    budgetUsd: opts.budgetUsd,
    system: codeRebuildSystem(),
    rebuildSystem: codeRebuildSystem,
    transcript: opts.transcript,
    session,
    seedTools: tools,
    codeMode: {
      rootDir,
      jobs,
      reregisterTools: registerRooted,
      reBootstrapSemantic: async (root) => {
        const r = await reBootstrapSemantic(root);
        semanticEnabled = r.enabled;
        return r;
      },
      onRootChange: (newRoot) => {
        currentRoot = newRoot;
      }
    },
    mcp: normalizeMcpConfig(readConfig()).map(specToRaw),
    forceResume: opts.forceResume,
    forceNew: opts.forceNew,
    noDashboard: opts.noDashboard,
    openDashboard: opts.openDashboard,
    dashboardPort: opts.dashboardPort,
    dashboardHost: opts.dashboardHost,
    dashboardToken: opts.dashboardToken,
    noMouse: opts.noMouse
  });
}
export {
  codeCommand
};
//# sourceMappingURL=code-IZSDESEF.js.map