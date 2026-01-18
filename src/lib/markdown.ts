/**
 * Pure text parsing utilities for markdown-style formatting.
 * These functions don't depend on JSX and can be tested independently.
 */

/**
 * Represents a segment of parsed text with formatting info.
 */
export type TextSegment = {
  text: string;
  bold: boolean;
  tag?: boolean;  // For [tag] patterns like [functional], [enhancement]
};

/**
 * Parse text containing **bold** markdown syntax and [tag] patterns into segments.
 * 
 * @param text - The text to parse
 * @returns Array of text segments with formatting flags
 * 
 * @example
 * parseMarkdownSegments("[functional] Hello **world**!")
 * // Returns: [
 * //   { text: "[functional]", bold: false, tag: true },
 * //   { text: " Hello ", bold: false },
 * //   { text: "world", bold: true },
 * //   { text: "!", bold: false }
 * // ]
 */
export function parseMarkdownSegments(text: string): TextSegment[] {
  const result: TextSegment[] = [];
  
  // Combined pattern: match either [tag] or **bold**
  // [tag] = square brackets with content inside (excluding ])
  // **bold** = double asterisks with content inside (excluding *)
  const pattern = /(\[[^\]]+\])|\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      result.push({ text: text.slice(lastIndex, match.index), bold: false });
    }
    
    if (match[1]) {
      // [tag] pattern matched - keep the brackets in display
      result.push({ text: match[1], bold: false, tag: true });
    } else if (match[2]) {
      // **bold** pattern matched - remove the ** markers
      result.push({ text: match[2], bold: true });
    }
    
    lastIndex = pattern.lastIndex;
  }

  // Add remaining text after last match
  if (lastIndex < text.length) {
    result.push({ text: text.slice(lastIndex), bold: false });
  }

  // If no content parsed but text exists, return it as plain
  if (result.length === 0 && text.length > 0) {
    result.push({ text, bold: false });
  }

  return result;
}

/**
 * Strip markdown links [text](url) from text, returning just the text.
 * 
 * @param text - The text with potential markdown links
 * @returns Text with links stripped to just their label
 */
export function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

/**
 * Strip **bold** markers from text, returning display text.
 * [tags] are kept as-is since they display with brackets.
 * 
 * @param text - The text with potential markdown
 * @returns Text with ** markers removed but [tags] kept
 */
export function stripMarkdownBold(text: string): string {
  // Strip links first to avoid conflicting with bold markers inside links (though rare)
  const noLinks = stripMarkdownLinks(text);
  return noLinks.replace(/\*\*([^*]+)\*\*/g, "$1");
}

/**
 * Check if text contains any **bold** markdown syntax.
 * 
 * @param text - The text to check
 * @returns True if text contains **bold** patterns
 */
export function hasMarkdownBold(text: string): boolean {
  return /\*\*([^*]+)\*\*/.test(text);
}

/**
 * Check if text contains any [tag] patterns.
 * 
 * @param text - The text to check
 * @returns True if text contains [tag] patterns
 */
export function hasTagPattern(text: string): boolean {
  return /\[[^\]]+\]/.test(text);
}
