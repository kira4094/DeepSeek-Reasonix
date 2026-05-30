/** Capture conversation turns to disk as chunked JSONL, with periodic checkpoint summaries. */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MEM_DIR = join(homedir(), ".reasonix", "mem", "sessions");
const CHUNK_SIZE = 50;
const CHECKPOINT_INTERVAL = 10;
const TOOL_RESULT_MAX_CHARS = 2000;

export interface ToolCallCapture {
	name: string;
	args?: unknown;
	/** Truncated result string (≤ TOOL_RESULT_MAX_CHARS). */
	result?: string;
}

export interface CaptureTurnOpts {
	/** The user's current text input, or the assistant's final response text. */
	text: string;
	/** The assistant's text from the prior turn (empty on turn 1). */
	lastAssistantText: string;
	/** 1-based user-turn counter. */
	turn: number;
	/** Session name (the .jsonl filename stem). */
	sessionName: string;
	/** Absolute project root directory. */
	cwd: string;
	/** Tool calls that occurred in this turn (optional). */
	toolCalls?: ToolCallCapture[];
}

/**
 * Append one turn record to the chunked JSONL for today.
 * Every CHECKPOINT_INTERVAL (10) turns, spawn a detached child process
 * that runs the summarizer on today's accumulated data.
 */
export function captureTurn(opts: CaptureTurnOpts): void {
	const hash = createHash("sha1").update(opts.cwd).digest("hex").slice(0, 16);
	const dateStr = todayCompact();
	const dir = join(MEM_DIR, hash, dateStr);
	mkdirSync(dir, { recursive: true });

	const chunkIndex = resolveChunkIndex(dir);
	const filePath = join(
		dir,
		`chunk-${String(chunkIndex).padStart(3, "0")}.jsonl`,
	);

	// Skip recording if there's nothing meaningful to store.
	const hasText = opts.text?.trim().length > 0;
	const hasAssistant = opts.lastAssistantText?.trim().length > 0;
	if (!hasText && !hasAssistant) return;

	const entry: Record<string, unknown> = {
		t: opts.turn ?? 0,
		ts: new Date().toISOString(),
		text: opts.text || "",
		lastAssistantText: opts.lastAssistantText || "",
		sessionName: opts.sessionName,
	};

	if (opts.toolCalls && opts.toolCalls.length > 0) {
		entry.toolCalls = opts.toolCalls.map((tc) => ({
			name: tc.name,
			args: tc.args,
			result: truncateOutput(tc.result),
		}));
	}

	appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8");

	// Every CHECKPOINT_INTERVAL user messages, kick off a background summary.
	const turn = opts.turn ?? 0;
	if (turn > 0 && turn % CHECKPOINT_INTERVAL === 0) {
		spawnSummaryChild(opts.cwd);
	}
}

/** YYYYMMDD — no dashes, matches the path convention. */
function todayCompact(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}${m}${day}`;
}

function truncateOutput(output: string | undefined): string | undefined {
	if (!output) return undefined;
	if (output.length <= TOOL_RESULT_MAX_CHARS) return output;
	return `${output.slice(0, TOOL_RESULT_MAX_CHARS)}\n… (truncated ${output.length - TOOL_RESULT_MAX_CHARS} chars)`;
}

/**
 * Find the highest existing chunk number in `dir`, then decide whether to
 * start a new chunk or reuse the current one (based on line count).
 */
function resolveChunkIndex(dir: string): number {
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
		// Directory doesn't exist yet — start at chunk 0.
		return 0;
	}

	if (maxChunk < 0) return 0;

	const currentPath = join(
		dir,
		`chunk-${String(maxChunk).padStart(3, "0")}.jsonl`,
	);
	if (existsSync(currentPath)) {
		const content = readFileSync(currentPath, "utf8");
		const lines = content.trim().split("\n").filter(Boolean);
		if (lines.length < CHUNK_SIZE) return maxChunk;
	}

	return maxChunk + 1;
}

/**
 * Spawn a detached, unreffed child process that runs the summarizer
 * module. The child runs independently and its output is discarded.
 */
function spawnSummaryChild(cwd: string): void {
	const currentDir = dirname(fileURLToPath(import.meta.url));
	// At runtime the compiled JS sits next to this file under dist/memory/.
	// In dev (tsx) the .ts extension still works because tsx handles both.
	const summarizerPath = join(currentDir, "mem-summarize.js");

	// Use --input-type=module so the -e string can use dynamic import().
	const code = `import(${JSON.stringify(`file://${summarizerPath}`)}).then(m => m.summarizeSession(${JSON.stringify({ cwd })})).catch(() => {})`;

	const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	});
	child.unref();
}
