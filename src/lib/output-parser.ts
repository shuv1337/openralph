import { stripAnsiCodes, type FormattedSegment } from "./ansi";

/**
 * Maximum size for the parsed output buffer (in characters).
 * 100KB should be plenty for display while preventing memory issues.
 */
const DEFAULT_MAX_SIZE = 100_000;

export interface OutputParserOptions {
  agentPlugin?: string;
  maxSize?: number;
  stripAnsi?: boolean;
}

/**
 * Streaming output parser for real-time JSONL processing.
 * Extracts readable content from chunks as they arrive.
 */
export class OutputParser {
  private buffer = "";
  private parsedOutput = "";
  private parsedSegments: FormattedSegment[] = [];
  private lastResultText = "";
  private isDroid: boolean;
  private maxSize: number;

  constructor(options: OutputParserOptions = {}) {
    this.isDroid = options.agentPlugin?.toLowerCase().includes("droid") ?? false;
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
  }

  /**
   * Push a chunk of raw output data.
   * Parses complete lines and extracts readable content if it's JSONL or plain text.
   * @returns The newly extracted readable text (if any)
   */
  push(chunk: string): string {
    this.buffer += chunk;
    let newContent = "";
    const newSegments: FormattedSegment[] = [];

    // Process complete lines
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      const extracted = this.extractReadableContent(line);
      if (extracted) {
        newContent += extracted.replace(/\n+$/, "") + "\n";
      }

      const extractedSegments = this.extractReadableSegments(line);
      if (extractedSegments.length > 0) {
        newSegments.push(...extractedSegments);
        newSegments.push({ text: "\n" });
      }
    }

    // Append new content and trim if exceeding max size
    if (newContent) {
      this.parsedOutput += newContent;
      if (this.parsedOutput.length > this.maxSize) {
        const trimPoint = this.parsedOutput.length - this.maxSize + 1000;
        this.parsedOutput = "[...output trimmed...]\n" + this.parsedOutput.slice(trimPoint);
      }
    }

    // Append new segments with trimming
    if (newSegments.length > 0) {
      this.parsedSegments.push(...newSegments);
      const totalLength = this.parsedSegments.reduce((acc, s) => acc + s.text.length, 0);
      if (totalLength > this.maxSize) {
        // Keep last segments until we are under maxSize
        let currentTotal = totalLength;
        while (this.parsedSegments.length > 0 && currentTotal > this.maxSize - 1000) {
          const removed = this.parsedSegments.shift();
          if (removed) currentTotal -= removed.text.length;
        }
        this.parsedSegments = [
          { text: "[...output trimmed...]\n", dim: true },
          ...this.parsedSegments,
        ];
      }
    }

    return newContent;
  }

  private extractReadableContent(line: string): string | undefined {
    const trimmed = line.trim();
    if (!trimmed) return undefined;

    // Try JSONL parsing for agent events
    if (trimmed.startsWith("{")) {
      try {
        const event = JSON.parse(trimmed);

        // Result event
        if (event.type === "result" && event.result) {
          this.lastResultText = event.result;
          return undefined; // Don't show yet, will show at end
        }

        // Assistant message
        if (event.type === "assistant" && event.message?.content) {
          const content = event.message.content;
          if (typeof content === "string") return content;
          if (Array.isArray(content)) {
            const textParts = content
              .filter((c: any) => c.type === "text" && c.text)
              .map((c: any) => c.text);
            return textParts.join("");
          }
        }

        // Error event
        if (event.type === "error" && event.message) {
          return `Error: ${event.message}`;
        }

        return undefined;
      } catch {
        // Not valid JSON
      }
    }

    // Plain text
    if (trimmed.length > 0 && !trimmed.startsWith("{")) {
      return trimmed;
    }

    return undefined;
  }

  private extractReadableSegments(line: string): FormattedSegment[] {
    const trimmed = line.trim();
    if (!trimmed) return [];

    // Try JSONL parsing
    if (trimmed.startsWith("{")) {
      try {
        const event = JSON.parse(trimmed);

        if (event.type === "result" || event.type === "user" || event.type === "system") {
          return []; // Skip these
        }

        if (event.type === "assistant" && event.message?.content) {
          const content = event.message.content;
          let text = "";
          if (typeof content === "string") text = content;
          else if (Array.isArray(content)) {
            text = content
              .filter((c: any) => c.type === "text" && c.text)
              .map((c: any) => c.text)
              .join("");
          }
          if (text) return [{ text: stripAnsiCodes(text) }];
        }

        return [];
      } catch {
        // Not valid JSON
      }
    }

    // Plain text - check for tool name pattern [tool]
    const toolMatch = trimmed.match(/^(\[[\w-]+\])(.*)/);
    if (toolMatch) {
      return [
        { text: toolMatch[1], color: "#9ece6a", bold: true }, // Green for tool name
        { text: toolMatch[2] }, // Default color for rest
      ];
    }

    // Plain text without tool pattern
    if (trimmed.length > 0) {
      return [{ text: stripAnsiCodes(trimmed) }];
    }

    return [];
  }

  getOutput(): string {
    return this.parsedOutput;
  }

  getSegments(): FormattedSegment[] {
    return this.parsedSegments;
  }

  getResultText(): string {
    return this.lastResultText;
  }

  reset(): void {
    this.buffer = "";
    this.parsedOutput = "";
    this.parsedSegments = [];
    this.lastResultText = "";
  }
}
