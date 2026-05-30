/**
 * Memory API — serves reasonix-mem session data from ~/.reasonix/mem/sessions/
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

  // GET /api/mem/projects/:hash/sessions/:name
  if (rest[0] === "projects" && rest[1] && rest[2] === "sessions" && rest[3]) {
    const name = decodeURIComponent(rest.slice(3).join("/"));
    return handleGetSession(rest[1], name);
  }

  // GET /api/mem/projects/:hash/sessions
  if (rest[0] === "projects" && rest[1] && rest[2] === "sessions") {
    return handleGetSessions(rest[1]);
  }

  // GET /api/mem/projects
  if (rest[0] === "projects") {
    return handleGetProjects();
  }

  // GET /api/mem/search?q=xxx&project=hash
  if (rest[0] === "search") {
    return handleSearch(hash);
  }

  // Default: return project hash
  return { status: 200, body: { hash, cwd } };
}

// ── Projects ─────────────────────────────────────────────────

function handleGetProjects(): ApiResult {
  const projects: Record<string, { name: string }> = {};
  if (!existsSync(MEM_SESSIONS)) return { status: 200, body: projects };

  for (const hash of readdirSync(MEM_SESSIONS)) {
    const hashDir = join(MEM_SESSIONS, hash);
    if (!statSync(hashDir).isDirectory()) continue;

    // Derive a friendly project name from the first session's directory name
    const dates = readdirSync(hashDir).filter(d => /^\d{8}$/.test(d)).sort().reverse();
    const lastActive = dates[0] || "unknown";

    let projectName = hash;
    if (dates.length > 0) {
      // Read the first record from the most recent date's first chunk
      const dateDir = join(hashDir, dates[0]);
      const chunks = readdirSync(dateDir).filter(f => f.endsWith(".jsonl")).sort();
      if (chunks.length > 0) {
        try {
          // Scan all chunks to find the first record with a sessionName
          for (const chunk of chunks) {
            const raw = readFileSync(join(dateDir, chunk), "utf8");
            for (const line of raw.trim().split("\n")) {
              if (!line.trim()) continue;
              try {
                const rec = JSON.parse(line);
                if (rec.sessionName) {
                  projectName = rec.sessionName.replace(/__archive_\d+.*$/, "");
                  break;
                }
              } catch { /* skip bad lines */ }
            }
            if (projectName !== hash) break;
          }
        } catch { /* fallthrough */ }
      }
    }

    projects[hash] = { name: projectName, lastActive };
  }

  return { status: 200, body: projects };
}

// ── Sessions ─────────────────────────────────────────────────

function handleGetSessions(hash: string): ApiResult {
  const hashDir = join(MEM_SESSIONS, hash);
  if (!existsSync(hashDir)) return { status: 200, body: [] };

  const sessions: Array<Record<string, unknown>> = [];

  for (const date of readdirSync(hashDir).sort().reverse()) {
    const dateDir = join(hashDir, date);
    if (!statSync(dateDir).isDirectory()) continue;

    // Read chunks to get record count
    const chunks = readdirSync(dateDir).filter(f => f.startsWith("chunk-") && f.endsWith(".jsonl")).sort();
    let total = 0;
    let mtimeMs = 0;
    for (const chunk of chunks) {
      const cp = join(dateDir, chunk);
      try {
        mtimeMs = Math.max(mtimeMs, statSync(cp).mtimeMs);
        const raw = readFileSync(cp, "utf8");
        total += raw.trim().split("\n").filter(Boolean).length;
      } catch { /* skip */ }
    }

    const formattedDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    sessions.push({
      name: formattedDate,
      date: formattedDate,
      dateRaw: date,
      recordCount: total,
      fileSize: 0,
      hasSummary: false,
      mtimeMs,
      hash,
      isDir: false,
    });
  }

  return { status: 200, body: sessions };
}

// ── Session Detail ───────────────────────────────────────────

function handleGetSession(hash: string, name: string): ApiResult {
  // name is like "2026-05-30"
  const dateRaw = name.replace(/-/g, "");
  const dateDir = join(MEM_SESSIONS, hash, dateRaw);
  if (!existsSync(dateDir)) return { status: 404, body: { error: "Session not found" } };

  const chunks = readdirSync(dateDir).filter(f => f.startsWith("chunk-") && f.endsWith(".jsonl")).sort();
  const records: Array<Record<string, unknown>> = [];

  for (const chunk of chunks) {
    const raw = readFileSync(join(dateDir, chunk), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const rec = JSON.parse(trimmed);
        // Skip completely empty records (no text, no assistant, no tool calls)
        const hasText = rec.text?.length > 0;
        const hasAsst = rec.lastAssistantText?.length > 0;
        const hasTools = rec.toolCalls?.length > 0;
        if (!hasText && !hasAsst && !hasTools) continue;

        // Backfill type for legacy records
        if (!rec.type) {
          rec.type = hasTools ? "tool_call"
            : hasText ? "user_message"
            : "assistant_message";
        }
        records.push(rec);
      } catch { /* skip */ }
    }
  }

  // Reverse so newest records appear first (top of the UI)
  const sorted = records.slice().reverse().map(r => ({
    ...r,
    content: r.text || "",
    toolResult: typeof r.toolResult === "string" ? r.toolResult.slice(0, 2000) : r.toolResult,
  }));

  return {
    status: 200,
    body: {
      name,
      date: name,
      total: records.length,
      offset: 0,
      limit: records.length,
      records: sorted,
      chunks,
      currentChunk: null,
    },
  };
}

// ── Search ───────────────────────────────────────────────────

function handleSearch(hash: string): ApiResult {
  // Simple: search all chunks for matching text
  // Full implementation would parse query params
  const results: Array<Record<string, unknown>> = [];

  if (!existsSync(MEM_SESSIONS)) return { status: 200, body: { results, query: "" } };

  for (const h of readdirSync(MEM_SESSIONS)) {
    if (hash && h !== hash) continue;
    const hashDir = join(MEM_SESSIONS, h);
    for (const date of readdirSync(hashDir)) {
      const dateDir = join(hashDir, date);
      for (const chunk of readdirSync(dateDir).filter(f => f.endsWith(".jsonl"))) {
        const raw = readFileSync(join(dateDir, chunk), "utf8");
        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const r = JSON.parse(trimmed);
            results.push({
              hash: h,
              date,
              sessionName: date,
              record: r,
              recordIndex: 0,
              context: [r],
            });
          } catch { /* skip */ }
        }
      }
    }
  }

  // Limit results
  return { status: 200, body: { results: results.slice(0, 100), query: "" } };
}
