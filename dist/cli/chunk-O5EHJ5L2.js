#!/usr/bin/env node
import { createRequire as __cr } from 'node:module'; if (typeof globalThis.require === 'undefined') { globalThis.require = __cr(import.meta.url); }
import {
  atomicWriteSync
} from "./chunk-MY7XESPF.js";

// src/memory/session.ts
import { execFileSync } from "child_process";
import { createHash, randomBytes } from "crypto";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "fs";
import {
  appendFile,
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile
} from "fs/promises";
import { homedir } from "os";
import { dirname, join, posix as posixPath, win32 as win32Path } from "path";
var SESSION_SIDECAR_EXTS = [
  ".events.jsonl",
  ".meta.json",
  ".pending.json",
  ".plan.json",
  ".jsonl.bak"
];
function detectGitBranch(cwd) {
  try {
    const out = execFileSync("git", ["branch", "--show-current"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 800,
      encoding: "utf8"
    }).trim();
    return out || void 0;
  } catch {
    return void 0;
  }
}
function sessionsDir() {
  return join(homedir(), ".reasonix", "sessions");
}
function sessionPath(name) {
  return join(sessionsDir(), `${sanitizeName(name)}.jsonl`);
}
function sanitizeName(name) {
  const cleaned = name.replace(/[^\w\-\u4e00-\u9fa5]/g, "_").slice(0, 64);
  return cleaned || "default";
}
function timestampSuffix() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/[^\d]/g, "").slice(0, 12);
}
function freshSessionName(currentName) {
  const base = currentName ? currentName.replace(/-\d{12,14}$/, "") : "default";
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[^\d]/g, "").slice(0, 14);
  return `${base || "default"}-${stamp}`;
}
function findSessionsByPrefix(prefix) {
  const dir = sessionsDir();
  if (!existsSync(dir)) return [];
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl") && !f.endsWith(".events.jsonl") && f.startsWith(prefix)).sort().reverse();
    return files.map((f) => f.replace(/\.jsonl$/, ""));
  } catch {
    return [];
  }
}
function resolveSession(sessionName, forceNew, forceResume) {
  let resolved = sessionName;
  let preview;
  if (sessionName && forceNew) {
    resolved = `${sessionName}-${timestampSuffix()}`;
  } else if (sessionName && !forceResume) {
    let sessionToCheck = sessionName;
    const prefixed = findSessionsByPrefix(`${sessionName}-`);
    if (prefixed.length > 0) {
      sessionToCheck = prefixed[0];
    }
    const prior = loadSessionMessages(sessionToCheck);
    if (prior.length > 0) {
      resolved = sessionToCheck;
      const p = sessionPath(sessionToCheck);
      const mtime = existsSync(p) ? statSync(p).mtime : /* @__PURE__ */ new Date();
      preview = { messageCount: prior.length, lastActive: mtime };
    }
  } else if (sessionName && forceResume) {
    const prefixed = findSessionsByPrefix(`${sessionName}-`);
    if (prefixed.length > 0) {
      resolved = prefixed[0];
    }
  }
  return { resolved, preview };
}
function loadSessionMessages(name) {
  const path = sessionPath(name);
  if (!existsSync(path)) return [];
  const live = readSessionMessages(path);
  if (live && (live.messages.length > 0 || !live.hadContent)) return live.messages;
  const backup = readSessionMessages(sessionBackupPath(path));
  return backup?.messages ?? live?.messages ?? [];
}
function readSessionMessages(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed);
      if (msg && typeof msg === "object" && "role" in msg) out.push(msg);
    } catch {
    }
  }
  return { messages: out, hadContent: raw.trim().length > 0 };
}
var READ_CHUNK_SIZE = 65536;
function readTailMessages(path, count) {
  try {
    const fd = openSync(path, "r");
    try {
      const { size } = fstatSync(fd);
      if (size === 0) return [];
      const out = [];
      let pos = size;
      let leftover = "";
      while (pos > 0 && out.length < count) {
        const chunkSize = Math.min(READ_CHUNK_SIZE, pos);
        pos -= chunkSize;
        const buf = Buffer.alloc(chunkSize);
        readSync(fd, buf, 0, chunkSize, pos);
        const chunk = buf.toString("utf8") + leftover;
        const lines = chunk.split("\n");
        leftover = lines[0];
        for (let i = lines.length - 1; i >= 1 && out.length < count; i--) {
          const trimmed = lines[i].trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            if (msg && typeof msg === "object" && "role" in msg) out.push(msg);
          } catch {
          }
        }
      }
      if (out.length < count && leftover.trim()) {
        try {
          const msg = JSON.parse(leftover.trim());
          if (msg && typeof msg === "object" && "role" in msg) out.push(msg);
        } catch {
        }
      }
      return out.reverse();
    } finally {
      closeSync(fd);
    }
  } catch {
    return loadSessionMessagesFromPath(path);
  }
}
function loadSessionMessagesFromPath(path) {
  const raw = readSessionMessages(path);
  return raw?.messages ?? [];
}
function appendSessionMessage(name, message) {
  const path = sessionPath(name);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(message)}
`, "utf8");
  try {
    chmodSync(path, 384);
  } catch {
  }
  invalidatePromptHistoryCache();
}
function listSessions(opts) {
  const dir = sessionsDir();
  if (!existsSync(dir)) return [];
  const want = opts?.workspaceFilter ? normalizeWorkspace(opts.workspaceFilter) : null;
  const legacyPrefix = want && opts?.includeLegacyWorkspaceMatches ? legacySessionPrefixForWorkspace(opts.workspaceFilter) : null;
  try {
    const files = readdirSync(dir).filter(
      (f) => f.endsWith(".jsonl") && !f.endsWith(".events.jsonl")
    );
    return files.flatMap((file) => {
      const path = join(dir, file);
      const name = file.replace(/\.jsonl$/, "");
      const meta = loadSessionMeta(name);
      let workspaceStatus;
      if (want !== null) {
        if (typeof meta.workspace === "string") {
          if (normalizeWorkspace(meta.workspace) !== want) return [];
          workspaceStatus = "matched";
        } else if (legacyPrefix && name.startsWith(legacyPrefix)) {
          workspaceStatus = "legacy_missing_meta";
        } else {
          return [];
        }
      }
      const stat2 = statSync(path);
      const messageCount = countLines(path);
      return [
        { name, path, size: stat2.size, messageCount, mtime: stat2.mtime, meta, workspaceStatus }
      ];
    }).sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  } catch {
    return [];
  }
}
function normalizeWorkspace(p, platform = process.platform) {
  if (typeof p !== "string" || p.length === 0) return "";
  if (platform === "win32") {
    const resolved = win32Path.resolve(p);
    return resolved.replace(/\\/g, "/").replace(/^([A-Z]):/i, (_, d) => `${d.toLowerCase()}:`);
  }
  return posixPath.resolve(p);
}
function listSessionsForWorkspace(workspace) {
  return listSessions({ workspaceFilter: workspace, includeLegacyWorkspaceMatches: true });
}
var globalPromptHistoryCache = null;
var CACHE_TTL_MS = 5e3;
function invalidatePromptHistoryCache() {
  globalPromptHistoryCache = null;
}
function listSessionsForPromptHistory(workspace) {
  const dir = sessionsDir();
  if (!existsSync(dir)) return [];
  let sessions = [];
  const now = Date.now();
  if (globalPromptHistoryCache && now - globalPromptHistoryCache.lastUpdated < CACHE_TTL_MS) {
    sessions = globalPromptHistoryCache.sessions;
  } else {
    try {
      const files = readdirSync(dir).filter(
        (f) => f.endsWith(".jsonl") && !f.endsWith(".events.jsonl")
      );
      sessions = files.flatMap((file) => {
        const path = join(dir, file);
        const name = file.replace(/\.jsonl$/, "");
        const meta = loadSessionMeta(name);
        const stat2 = statSync(path);
        return [
          {
            name,
            path,
            mtime: stat2.mtime,
            workspace: meta.workspace
          }
        ];
      });
      sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      globalPromptHistoryCache = {
        sessions,
        lastUpdated: now
      };
    } catch {
      return [];
    }
  }
  if (workspace) {
    const want = normalizeWorkspace(workspace);
    return sessions.filter((s) => {
      if (typeof s.workspace === "string") {
        return normalizeWorkspace(s.workspace) === want;
      }
      const legacyPrefix = legacySessionPrefixForWorkspace(workspace);
      return s.name.startsWith(legacyPrefix);
    });
  }
  return sessions;
}
function promptHistoryStep(opts) {
  const sessions = listSessionsForPromptHistory(opts.workspace);
  if (sessions.length === 0) return null;
  if (opts.direction === "newer" && !opts.cursor) return null;
  const cursorSession = opts.cursor?.sessionName;
  const startSession = cursorSession ?? opts.startSessionName ?? null;
  const foundStart = startSession ? sessions.findIndex((session) => session.name === sanitizeName(startSession)) : -1;
  const startIndex = foundStart >= 0 ? foundStart : opts.direction === "older" ? 0 : sessions.length - 1;
  const stopIndex = opts.stopSessionName ? sessions.findIndex((session) => session.name === sanitizeName(opts.stopSessionName)) : -1;
  for (let offset = 0; offset < sessions.length; offset++) {
    const sessionIndex = opts.direction === "older" ? startIndex + offset : startIndex - offset;
    if (sessionIndex < 0 || sessionIndex >= sessions.length) break;
    if (opts.direction === "newer" && stopIndex >= 0 && sessionIndex < stopIndex) break;
    const session = sessions[sessionIndex];
    if (!session) continue;
    const messages = loadSessionMessages(session.name);
    const cursorIndex = offset === 0 && opts.cursor?.sessionName === session.name ? opts.cursor.messageIndex : void 0;
    const entry = findPromptHistoryEntryInMessages({
      sessionName: session.name,
      messages,
      direction: opts.direction,
      cursorIndex
    });
    if (entry) return entry;
  }
  return null;
}
function findPromptHistoryEntryInMessages({
  sessionName,
  messages,
  direction,
  cursorIndex
}) {
  if (direction === "older") {
    const start2 = cursorIndex === void 0 ? messages.length - 1 : Math.min(cursorIndex - 1, messages.length - 1);
    for (let i = start2; i >= 0; i--) {
      const value = promptHistoryValue(messages[i]);
      if (!value) continue;
      return { value, cursor: { sessionName, messageIndex: i } };
    }
    return null;
  }
  const start = cursorIndex === void 0 ? 0 : Math.max(0, Math.min(cursorIndex + 1, messages.length));
  for (let i = start; i < messages.length; i++) {
    const value = promptHistoryValue(messages[i]);
    if (!value) continue;
    return { value, cursor: { sessionName, messageIndex: i } };
  }
  return null;
}
function promptHistoryValue(message) {
  if (!message || message.role !== "user") return null;
  const value = typeof message.content === "string" ? message.content.trim() : "";
  return value || null;
}
function legacySessionPrefixForWorkspace(workspace) {
  const normalized = normalizeWorkspace(workspace);
  const base = process.platform === "win32" ? win32Path.basename(normalized) : posixPath.basename(normalized);
  return `${sanitizeName(`code-${base}`)}-`;
}
function patchSessionWorkspaceIfMissing(name, workspace) {
  const meta = loadSessionMeta(name);
  if (typeof meta.workspace === "string") return false;
  const prefix = legacySessionPrefixForWorkspace(workspace);
  if (!sanitizeName(name).startsWith(prefix)) return false;
  patchSessionMeta(name, { workspace });
  return true;
}
function metaPath(name) {
  return join(sessionsDir(), `${sanitizeName(name)}.meta.json`);
}
function loadSessionMeta(name) {
  const p = metaPath(name);
  if (!existsSync(p)) return {};
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}
function patchSessionMeta(name, patch) {
  const cur = loadSessionMeta(name);
  const next = { ...cur, ...patch };
  const p = metaPath(name);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(next), "utf8");
  try {
    chmodSync(p, 384);
  } catch {
  }
  invalidatePromptHistoryCache();
  return next;
}
function hashSystemPrompt(system) {
  return createHash("sha256").update(system).digest("hex").slice(0, 16);
}
function renameSession(oldName, newName) {
  const safeOld = sanitizeName(oldName);
  const safeNew = sanitizeName(newName);
  if (safeOld === safeNew) return false;
  const oldJsonl = sessionPath(oldName);
  const newJsonl = sessionPath(newName);
  if (!existsSync(oldJsonl) || existsSync(newJsonl)) return false;
  renameSync(oldJsonl, newJsonl);
  for (const ext of SESSION_SIDECAR_EXTS) {
    const oldP = oldJsonl.replace(/\.jsonl$/, ext);
    const newP = newJsonl.replace(/\.jsonl$/, ext);
    if (existsSync(oldP)) {
      try {
        renameSync(oldP, newP);
      } catch {
      }
    }
  }
  invalidatePromptHistoryCache();
  return true;
}
function pruneStaleSessions(daysOld = 90) {
  const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1e3;
  const deleted = [];
  for (const s of listSessions()) {
    if (s.mtime.getTime() < cutoff) {
      if (deleteSession(s.name)) deleted.push(s.name);
    }
  }
  return deleted;
}
function deleteSession(name) {
  const path = sessionPath(name);
  try {
    unlinkSync(path);
    for (const ext of SESSION_SIDECAR_EXTS) {
      const sidecar = path.replace(/\.jsonl$/, ext);
      try {
        unlinkSync(sidecar);
      } catch {
      }
    }
    invalidatePromptHistoryCache();
    return true;
  } catch {
    return false;
  }
}
function rewriteSession(name, messages) {
  const path = sessionPath(name);
  mkdirSync(dirname(path), { recursive: true });
  const body = messages.map((m) => JSON.stringify(m)).join("\n");
  const tmp = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  if (existsSync(path) && statSync(path).size > 0) {
    const backup = sessionBackupPath(path);
    copyFileSync(path, backup);
    chmodPrivate(backup);
  }
  atomicWriteSync(path, body ? `${body}
` : "", tmp);
  invalidatePromptHistoryCache();
}
function archiveSession(name) {
  const path = sessionPath(name);
  if (!existsSync(path)) return null;
  try {
    if (statSync(path).size === 0) return null;
  } catch {
    return null;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const target = `${name}__archive_${timestampSuffix()}${attempt > 0 ? `_${attempt}` : ""}`;
    if (renameSession(name, target)) return target;
  }
  return null;
}
function countLines(path) {
  try {
    const buf = readFileSync(path);
    let count = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 10) count++;
    }
    if (buf.length > 0 && buf[buf.length - 1] !== 10) count++;
    return count;
  } catch {
    return 0;
  }
}
function sessionBackupPath(path) {
  return `${path}.bak`;
}
function chmodPrivate(path) {
  try {
    chmodSync(path, 384);
  } catch {
  }
}
async function countLinesAsync(path) {
  try {
    const buf = await readFile(path);
    let count = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 10) count++;
    }
    if (buf.length > 0 && buf[buf.length - 1] !== 10) count++;
    return count;
  } catch {
    return 0;
  }
}
async function loadSessionMetaAsync(name) {
  const p = metaPath(name);
  try {
    const raw = JSON.parse(await readFile(p, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}
async function deleteSessionAsync(name) {
  const path = sessionPath(name);
  try {
    await unlink(path);
    for (const ext of SESSION_SIDECAR_EXTS) {
      const sidecar = path.replace(/\.jsonl$/, ext);
      try {
        await unlink(sidecar);
      } catch {
      }
    }
    return true;
  } catch {
    return false;
  }
}
async function listSessionsAsync(opts) {
  const dir = sessionsDir();
  const want = opts?.workspaceFilter ? normalizeWorkspace(opts.workspaceFilter) : null;
  const legacyPrefix = want && opts?.includeLegacyWorkspaceMatches ? legacySessionPrefixForWorkspace(opts.workspaceFilter) : null;
  try {
    const files = (await readdir(dir)).filter(
      (f) => f.endsWith(".jsonl") && !f.endsWith(".events.jsonl")
    );
    const results = await Promise.all(
      files.flatMap(async (file) => {
        const path = join(dir, file);
        const name = file.replace(/\.jsonl$/, "");
        const meta = await loadSessionMetaAsync(name);
        let workspaceStatus;
        if (want !== null) {
          if (typeof meta.workspace === "string") {
            if (normalizeWorkspace(meta.workspace) !== want) return [];
            workspaceStatus = "matched";
          } else if (legacyPrefix && name.startsWith(legacyPrefix)) {
            workspaceStatus = "legacy_missing_meta";
          } else {
            return [];
          }
        }
        const s = await stat(path);
        const messageCount = await countLinesAsync(path);
        return [
          {
            name,
            path,
            size: s.size,
            messageCount,
            mtime: s.mtime,
            meta,
            workspaceStatus
          }
        ];
      })
    );
    return results.flat().sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  } catch {
    return [];
  }
}
async function listSessionsForWorkspaceAsync(workspace) {
  return listSessionsAsync({
    workspaceFilter: workspace,
    includeLegacyWorkspaceMatches: true
  });
}

export {
  detectGitBranch,
  sessionsDir,
  sessionPath,
  sanitizeName,
  timestampSuffix,
  freshSessionName,
  resolveSession,
  loadSessionMessages,
  readTailMessages,
  appendSessionMessage,
  listSessions,
  normalizeWorkspace,
  listSessionsForWorkspace,
  promptHistoryStep,
  patchSessionWorkspaceIfMissing,
  loadSessionMeta,
  patchSessionMeta,
  hashSystemPrompt,
  renameSession,
  pruneStaleSessions,
  deleteSession,
  rewriteSession,
  archiveSession,
  deleteSessionAsync,
  listSessionsAsync,
  listSessionsForWorkspaceAsync
};
//# sourceMappingURL=chunk-O5EHJ5L2.js.map