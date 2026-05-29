/** Summarize today's captured conversation chunks and persist as project memory. */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const MEM_SESSIONS_DIR = join(homedir(), ".reasonix", "mem", "sessions");
const SUMMARY_MODEL = "deepseek-chat";

export interface SummarizeSessionOpts {
	/** Absolute project root directory. */
	cwd: string;
}

/**
 * Read all of today's JSONL chunks for the given project, generate an AI
 * summary via the DeepSeek API, and write it to
 * `~/.reasonix/memory/<hash>/reasonix-mem-latest.md`.
 *
 * No-op if DEEPSEEK_API_KEY is not set or no chunks exist for today.
 */
export async function summarizeSession(
	opts: SummarizeSessionOpts,
): Promise<void> {
	const apiKey = process.env.DEEPSEEK_API_KEY;
	if (!apiKey) return;

	const hash = createHash("sha1")
		.update(resolve(opts.cwd))
		.digest("hex")
		.slice(0, 16);
	const dateStr = todayCompact();
	const chunksDir = join(MEM_SESSIONS_DIR, hash, dateStr);

	if (!existsSync(chunksDir)) return;

	const chunkFiles = readdirSync(chunksDir)
		.filter((f) => f.endsWith(".jsonl"))
		.sort()
		.map((f) => join(chunksDir, f));

	if (chunkFiles.length === 0) return;

	// Parse all records from all chunks.
	const records: unknown[] = [];
	for (const file of chunkFiles) {
		const raw = readFileSync(file, "utf8");
		for (const line of raw.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				records.push(JSON.parse(trimmed));
			} catch {
				// Skip malformed lines.
			}
		}
	}

	if (records.length === 0) return;

	const summary = await generateSummary(records, apiKey);
	if (!summary) return;

	// Persist the summary as a project memory entry.
	const memDir = join(homedir(), ".reasonix", "memory", hash);
	mkdirSync(memDir, { recursive: true });
	const memPath = join(memDir, "reasonix-mem-latest.md");

	const body = [
		"---",
		"name: reasonix-mem-latest",
		`description: Auto-generated session summary — ${records.length} turns captured on ${dateStr}`,
		"type: project",
		"scope: project",
		`created: ${new Date().toISOString().slice(0, 10)}`,
		"---",
		"",
		summary,
	].join("\n");

	writeFileSync(memPath, body, "utf8");
}

/** YYYYMMDD — matches the directory naming convention in mem-capture.ts. */
function todayCompact(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}${m}${day}`;
}

/** Call the DeepSeek chat-completions API to produce a prose summary. */
async function generateSummary(
	records: unknown[],
	apiKey: string,
): Promise<string | null> {
	// Build a compact representation — full text of first + last few turns, counts for the rest.
	const turnCount = records.length;
	const sampleRecords =
		records.length <= 6
			? records
			: [
					...records.slice(0, 3),
					{ _note: `… ${records.length - 6} turns omitted …` },
					...records.slice(-3),
				];

	const systemPrompt =
		"You are a session-summary generator. Read the conversation turns below and produce a concise " +
		"Markdown summary covering: key decisions made, files modified, tools used, and unresolved " +
		"questions. Write in the style of project memory notes (bullet points preferred). " +
		"Output ONLY the summary body — no frontmatter, no meta commentary.";

	const userPrompt =
		`Summarize these ${turnCount} conversation turns (captured ${todayCompact()}):\n\n` +
		`${JSON.stringify(sampleRecords, null, 2)}`;

	try {
		const response = await fetch("https://api.deepseek.com/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: SUMMARY_MODEL,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: userPrompt },
				],
				max_tokens: 1024,
				temperature: 0.3,
			}),
			signal: AbortSignal.timeout(30_000),
		});

		if (!response.ok) {
			const errorBody = await response.text().catch(() => "unknown");
			console.error(
				`[mem-summarize] API error ${response.status}: ${errorBody}`,
			);
			return null;
		}

		const data = (await response.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		return data?.choices?.[0]?.message?.content?.trim() ?? null;
	} catch (err) {
		console.error("[mem-summarize] fetch failed:", err);
		return null;
	}
}
