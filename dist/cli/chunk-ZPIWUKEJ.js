#!/usr/bin/env node
import { createRequire as __cr } from 'node:module'; if (typeof globalThis.require === 'undefined') { globalThis.require = __cr(import.meta.url); }
import {
  SseTransport,
  StdioTransport,
  StreamableHttpTransport
} from "./chunk-TEUGA73O.js";

// src/mcp/preflight.ts
import { statSync } from "fs";
import { isAbsolute, resolve } from "path";
var FILESYSTEM_PKG = "@modelcontextprotocol/server-filesystem";
function resolveSandboxPath(dir, cwd) {
  if (!cwd || isAbsolute(dir)) return dir;
  return resolve(cwd, dir);
}
function describeResolvedPath(dir, resolved) {
  return dir === resolved ? `'${dir}'` : `'${dir}' (resolved to '${resolved}')`;
}
function preflightStdioSpec(spec, opts = {}) {
  const pkgIndex = spec.args.indexOf(FILESYSTEM_PKG);
  if (pkgIndex < 0) return;
  const positional = spec.args.slice(pkgIndex + 1).filter((a) => !a.startsWith("-"));
  const cwd = spec.cwd ?? opts.cwd;
  for (const dir of positional) {
    const resolved = resolveSandboxPath(dir, cwd);
    let stat;
    try {
      stat = statSync(resolved);
    } catch {
      throw new Error(
        `MCP filesystem sandbox ${describeResolvedPath(dir, resolved)} does not exist \u2014 create it with: mkdir -p '${resolved}'`
      );
    }
    if (!stat.isDirectory()) {
      throw new Error(
        `MCP filesystem sandbox ${describeResolvedPath(dir, resolved)} exists but is not a directory`
      );
    }
  }
}

// src/mcp/transport-from-spec.ts
function buildTransportFromSpec(spec, opts = {}) {
  if (spec.transport === "sse") {
    return new SseTransport({ url: spec.url, headers: opts.headers ?? spec.headers });
  }
  if (spec.transport === "streamable-http") {
    return new StreamableHttpTransport({
      url: spec.url,
      headers: opts.headers ?? spec.headers
    });
  }
  return new StdioTransport({
    command: spec.command,
    args: spec.args,
    env: opts.env ?? spec.env,
    cwd: spec.cwd ?? opts.cwd
  });
}

export {
  preflightStdioSpec,
  buildTransportFromSpec
};
//# sourceMappingURL=chunk-ZPIWUKEJ.js.map