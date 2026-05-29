import type { MemoryRow } from '@/db/queries/memories';

/**
 * Approximate token count using 4 chars-per-token heuristic.
 * Used to enforce the ~800-token cap on injected memory context.
 */
const APPROX_CHARS_PER_TOKEN = 4;
const MEMORY_TOKEN_CAP = 800;
const MEMORY_CHAR_CAP = MEMORY_TOKEN_CAP * APPROX_CHARS_PER_TOKEN; // 3200
/** Truncate a single memory's text to this length to keep entries readable. */
const MEMORY_TEXT_MAX_CHARS = 250;

/**
 * Format a list of memories into a `### Relevant Context` system-prompt block.
 *
 * Rules:
 * - Returns empty string when the list is empty (no section is injected).
 * - Truncates individual memory text at MEMORY_TEXT_MAX_CHARS.
 * - Stops adding entries once the total character count reaches MEMORY_CHAR_CAP
 *   (~800 tokens) to bound prompt cost.
 */
export function buildMemoryContext(memories: readonly MemoryRow[]): string {
  if (memories.length === 0) return '';

  const lines: string[] = [];
  let charCount = 0;

  for (const m of memories) {
    const text = m.text.length > MEMORY_TEXT_MAX_CHARS
      ? `${m.text.slice(0, MEMORY_TEXT_MAX_CHARS)}…`
      : m.text;
    const line = `- [${m.kind}] ${text}`;
    if (charCount + line.length > MEMORY_CHAR_CAP) break;
    lines.push(line);
    charCount += line.length;
  }

  if (lines.length === 0) return '';

  return `\n\n### Relevant Context\nThe following preferences and rules have been remembered about this user:\n${lines.join('\n')}\nWhen relevant, cite these with "Based on your preference, …" or "Based on your household rule, …".`;
}
