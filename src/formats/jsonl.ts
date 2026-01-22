/**
 * @file JSONL (JSON Lines) Formatter
 * @description Outputs headless events as newline-delimited JSON.
 *
 * Format: One JSON object per line (NDJSON/JSONL format)
 * - Supports all 24 HeadlessEventType values from src/headless/types.ts
 * - Timestamps use ISO 8601 format when enabled
 * - Streaming-friendly: events emitted immediately without buffering
 *
 * @see https://jsonlines.org/
 */

import type {
  HeadlessEvent,
  HeadlessEventType,
  HeadlessFormatter,
  HeadlessSummary,
  FormatterOptions,
} from "../headless/types";

/**
 * All supported event types for documentation and validation.
 * This ensures we handle the complete HeadlessEventType union.
 */
const SUPPORTED_EVENT_TYPES: readonly HeadlessEventType[] = [
  "start",
  "iteration_start",
  "iteration_end",
  "tool",
  "reasoning",
  "output",
  "progress",
  "stats",
  "pause",
  "resume",
  "idle",
  "error",
  "complete",
  "model",
  "sandbox",
  "tokens",
  "rate_limit",
  "active_agent",
  "backoff",
  "backoff_cleared",
  "session",
  "prompt",
  "plan_modified",
  "adapter_mode",
] as const;

/**
 * Converts a Unix timestamp (milliseconds) to ISO 8601 format.
 *
 * @param epochMs - Unix timestamp in milliseconds
 * @returns ISO 8601 formatted date string
 *
 * @example
 * toIso8601(1706054400000) // "2024-01-24T00:00:00.000Z"
 */
function toIso8601(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/**
 * Formats an event for JSONL output, handling timestamp conversion.
 *
 * @param event - The headless event to format
 * @param includeTimestamps - Whether to include timestamps in output
 * @returns The formatted event object ready for JSON serialization
 */
function formatEvent(
  event: HeadlessEvent,
  includeTimestamps: boolean
): Record<string, unknown> {
  // If timestamps disabled, strip the timestamp field
  if (!includeTimestamps) {
    if ("timestamp" in event && event.timestamp !== undefined) {
      const { timestamp: _ignored, ...rest } = event;
      return rest as Record<string, unknown>;
    }
    return event as unknown as Record<string, unknown>;
  }

  // If timestamps enabled, ensure we have one and convert to ISO 8601
  const timestamp = event.timestamp ?? Date.now();
  return {
    ...event,
    timestamp: toIso8601(timestamp),
  } as Record<string, unknown>;
}

/**
 * Creates a JSONL (JSON Lines) formatter for headless mode output.
 *
 * The JSONL format outputs one JSON object per line, making it ideal for:
 * - Streaming to log aggregators (e.g., CloudWatch, Datadog)
 * - Processing with command-line tools (jq, grep)
 * - CI/CD pipeline consumption
 *
 * @param options - Formatter configuration options
 * @returns A HeadlessFormatter implementation for JSONL output
 *
 * @example
 * ```typescript
 * const formatter = createJsonlFormatter({ timestamps: true });
 * formatter.emit({ type: "start" });
 * // Output: {"type":"start","timestamp":"2024-01-24T00:00:00.000Z"}
 *
 * formatter.emit({ type: "tool", iteration: 1, name: "bash", title: "Run tests" });
 * // Output: {"type":"tool","iteration":1,"name":"bash","title":"Run tests","timestamp":"..."}
 * ```
 */
export function createJsonlFormatter(options: FormatterOptions): HeadlessFormatter {
  const write = options.write ?? ((text: string) => process.stdout.write(text));

  /**
   * Emit a single event as a JSON line.
   * All 24 event types are supported through the discriminated union.
   */
  const emit = (event: HeadlessEvent): void => {
    const formatted = formatEvent(event, options.timestamps);
    write(JSON.stringify(formatted) + "\n");
  };

  /**
   * Finalize output with summary.
   * For JSONL format, we emit the summary as a final "summary" event.
   */
  const finalize = (summary: HeadlessSummary): void => {
    const summaryEvent = {
      type: "summary" as const,
      ...summary,
      ...(options.timestamps ? { timestamp: toIso8601(Date.now()) } : {}),
    };
    write(JSON.stringify(summaryEvent) + "\n");
  };

  /**
   * Flush is a no-op for JSONL since we write immediately.
   */
  const flush = (): void => {
    // JSONL writes are immediate, no buffering to flush
  };

  return { emit, finalize, flush };
}

// Export for documentation/testing purposes
export { SUPPORTED_EVENT_TYPES };
