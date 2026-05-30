/**
 * Memory API — serves reasonix-mem session data from ~/.reasonix/mem/sessions/
 * Directory layout: sessions/<hash>/<YYYYMMDD>/<sessionName>/chunk-*.jsonl
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { DashboardContext } from "../context.js";
import type { ApiResult } from "../router.js";

const MEM_SESSIONS = join(homedir(), ".reasonix", "mem", "sessions");

export async function handleMem(
  method: string,
  rest: string[],
  _body: string,
  ctx: DashboardContext,
  _query: URLSearchParams = new URLSearchParams(),
): Promise<ApiResult> {
  if (method !== "GET") {
    return { status: 405, body: { error: "GET only" } };
  }

  const cwd = ctx.getCurrentCwd();
  const hash = createHash("sha1").update(resolve(cwd)).digest("hex").slice(0, 16);

  // GET /api/mem/projects
  if (rest.length === 1 && rest[0] === "projects") {
    return handleGetProjects();
  }

  // GET /api/mem/projects/:hash/sessions
  if (rest.length === 3 && rest[0] === "projects" && rest[2] === "sessions") {
    return handleGetSessions(rest[1]);
  }

  // GET /api/mem/projects/:hash/sessions/:dateRaw/:sessionDir?
  // If rest[4] is undefined/empty, treat as old flat format (no session dir)
  if (rest.length >= 4 && rest[0] === "projects" && rest[2] === "sessions") {
    const dateRaw = decodeURIComponent(rest[3]);
    const sessionDir = rest[4] ? decodeURIComponent(rest.slice(4).join("/")) : "";
    return handleGetSession(rest[1], dateRaw, sessionDir);
  }

  // Default: return current project hash + cwd
  return { status: 200, body: { hash, cwd } };
}

// ── Projects ─────────────────────────────────────────────────

function handleGetProjects(): ApiResult {
  const projects: Record<string, { name: string }> = {};
  if (!existsSync(MEM_SESSIONS)) return { status: 200, body: projects };

  for (const hash of readdirSync(MEM_SESSIONS)) {
    const hashDir = join(MEM_SESSIONS, hash);
    if (!statSync(hashDir).isDirectory()) continue;

    let projectName = hash;
    // 1. Check meta.json first (written by captureTurn with the cwd)
    const metaPath = join(hashDir, "meta.json");
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf8"));
        if (meta.cwd) projectName = meta.cwd;
      } catch { /* fallthrough */ }
    }

    // 2. Fallback: derive from session records
    if (projectName === hash) {
      const dates = readdirSync(hashDir).filter(d => /^\d{8}$/.test(d)).sort().reverse();
      if (dates.length > 0) {
        outer:
        for (const date of dates) {
          const dateDir = join(hashDir, date);
          for (const sessionDir of readdirSync(dateDir)) {
            const sDir = join(dateDir, sessionDir);
            if (!statSync(sDir).isDirectory()) continue;
            const chunks = readdirSync(sDir).filter(f => f.endsWith(".jsonl")).sort();
            for (const ch of chunks) {
              try {
                const raw = readFileSync(join(sDir, ch), "utf8");
                const lines = raw.trim().split("\n").filter(l => l.trim());
                for (const line of lines) {
                  const rec = JSON.parse(line);
                  if (rec.sessionName && !rec.sessionName.startsWith("default-")) {
                    projectName = rec.sessionName.replace(/__archive_\d+.*$/, "");
                    break outer;
                  }
                }
              } catch { /* skip */ }
            }
          }
        }
      }
    }

    projects[hash] = { name: projectName };
  }

  return { status: 200, body: projects };
}

// ── Sessions (list all sessions grouped by date) ─────────────

function handleGetSessions(hash: string): ApiResult {
  const hashDir = join(MEM_SESSIONS, hash);
  if (!existsSync(hashDir)) return { status: 200, body: [] };

  const sessions: Array<Record<string, unknown>> = [];

  for (const date of readdirSync(hashDir).sort().reverse()) {
    const dateDir = join(hashDir, date);
    if (!statSync(dateDir).isDirectory() || !/^\d{8}$/.test(date)) continue;

    const formattedDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;

    for (const sessionDir of readdirSync(dateDir)) {
      const sDir = join(dateDir, sessionDir);
      if (!statSync(sDir).isDirectory()) continue;

      let total = 0;
      let mtimeMs = 0;
      const chunks = readdirSync(sDir).filter(f => f.startsWith("chunk-") && f.endsWith(".jsonl")).sort();
      for (const chunk of chunks) {
        try {
          const cp = join(sDir, chunk);
          mtimeMs = Math.max(mtimeMs, statSync(cp).mtimeMs);
          const raw = readFileSync(cp, "utf8");
          total += raw.trim().split("\n").filter(Boolean).length;
        } catch { /* skip */ }
      }
      if (total === 0) continue;
      sessions.push({
        name: sessionDir,
        date: formattedDate,
        dateRaw: date,
        sessionDir,
        recordCount: total,
        mtimeMs,
        hash,
      });
    }
  }

  return { status: 200, body: sessions };
}

// ── Session Detail ───────────────────────────────────────────

function handleGetSession(hash: string, dateRaw: string, sessionDir: string): ApiResult {
  const dateDir = join(MEM_SESSIONS, hash, dateRaw, sessionDir);
  if (!existsSync(dateDir)) return { status: 404, body: { error: "Session not found" } };

  const filePattern = readdirSync(dateDir).filter(f => f.startsWith("chunk-") && f.endsWith(".jsonl")).sort();
  if (filePattern.length === 0) return { status: 404, body: { error: "No data files found" } };
  const records: Array<Record<string, unknown>> = [];

  for (const chunk of filePattern) {
    const filePath = join(dateDir, chunk);
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const rec = JSON.parse(trimmed);
        // Skip completely empty records
        const hasText = rec.text?.length > 0;
        const hasAsst = rec.lastAssistantText?.length > 0;
        const hasTools = rec.toolCalls?.length > 0;
        if (!hasText && !hasAsst && !hasTools) continue;

        // Backfill type
        if (!rec.type) {
          rec.type = hasTools ? "tool_call"
            : hasText ? "user_message"
            : "assistant_message";
        }
        records.push(rec);
      } catch { /* skip */ }
    }
  }

  // Reverse so newest records appear first
  const sorted = records.slice().reverse().map(r => ({
    ...r,
    content: r.text || "",
    toolResult: typeof r.toolResult === "string" ? r.toolResult.slice(0, 2000) : r.toolResult,
  }));

  return {
    status: 200,
    body: {
      name: sessionDir,
      date: dateRaw,
      sessionDir,
      total: records.length,
      offset: 0,
      limit: records.length,
      records: sorted,
    },
  };
}
