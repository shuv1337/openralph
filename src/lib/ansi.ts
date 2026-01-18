/**
 * Formatted segment for TUI-native color rendering.
 */
export interface FormattedSegment {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

/**
 * ANSI escape sequence regex pattern.
 * Matches CSI sequences, OSC sequences, and charset switching.
 */
const ANSI_REGEX = /\x1b\[[0-9;]*[mGKHJKfA-D]|[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

/**
 * Strip all ANSI escape codes from text.
 * Critical for preventing TUI rendering artifacts.
 * 
 * @param text - The text containing ANSI codes
 * @returns Text with all ANSI codes removed
 */
export function stripAnsiCodes(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

/**
 * Check if text contains any ANSI escape codes.
 * 
 * @param text - The text to check
 * @returns true if text contains ANSI codes
 */
export function hasAnsiCodes(text: string): boolean {
  return ANSI_REGEX.test(text);
}

/**
 * Strip ANSI codes and truncate for display.
 * 
 * @param text - The text to sanitize
 * @param maxLength - Maximum length including ellipsis
 * @returns Sanitized and potentially truncated text
 */
export function sanitizeForDisplay(
  text: string,
  maxLength: number = 1000
): string {
  const stripped = stripAnsiCodes(text);
  if (stripped.length > maxLength) {
    return stripped.slice(0, maxLength) + "...[truncated]";
  }
  return stripped;
}

/**
 * Parse output text into formatted segments with tool name highlighting.
 * Pattern: [toolname] content → green tool name, white content
 * 
 * @param output - The raw output text
 * @returns Array of FormattedSegment with coloring
 */
export function parseToSegments(output: string): FormattedSegment[] {
  const segments: FormattedSegment[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    if (!line.trim()) {
      segments.push({ text: "\n" });
      continue;
    }

    const toolMatch = line.match(/^(\[[\w-]+\])(.*)/);
    if (toolMatch) {
      segments.push({ text: toolMatch[1], color: "#9ece6a", bold: true }); // Green (success color)
      segments.push({ text: toolMatch[2] });
    } else {
      segments.push({ text: line });
    }
    segments.push({ text: "\n" });
  }

  return segments;
}
