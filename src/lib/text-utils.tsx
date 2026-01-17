/**
 * Text parsing utilities for markdown-style formatting in the TUI.
 * Re-exports pure functions from markdown.ts and adds JSX rendering.
 */
import type { JSX } from "solid-js";
import { parseMarkdownSegments } from "./markdown";

// Re-export pure functions for convenience
export { parseMarkdownSegments, stripMarkdownBold, hasMarkdownBold } from "./markdown";
export type { TextSegment } from "./markdown";

/**
 * Parse text containing **bold** markdown syntax and [tag] patterns and render as a single JSX text element.
 * 
 * OpenTUI Rendering Note:
 * Using a single <text> element as a container for <span> and <b> elements ensures
 * that the segments are rendered inline on a single line, rather than being treated
 * as separate block-level elements.
 * 
 * @param text - The text to parse
 * @param normalColor - Color for normal text
 * @param boldColor - Color for bold/emphasized text
 * @param tagColor - Color for [tag] patterns (defaults to boldColor if not provided)
 * @returns A single JSX <text> element containing styled spans
 */
export function renderMarkdownBold(
  text: string,
  normalColor: string,
  boldColor: string,
  tagColor?: string
): JSX.Element {
  const segments = parseMarkdownSegments(text);
  
  if (segments.length === 0) {
    return <text fg={normalColor}>{text}</text>;
  }

  const effectiveTagColor = tagColor || boldColor;

  return (
    <text fg={normalColor}>
      {segments.map((segment) => {
        if (segment.tag) {
          // @ts-ignore - OpenTUI span supports fg but types might be missing it
          return <span fg={effectiveTagColor}>{segment.text}</span>;
        }
        if (segment.bold) {
          // @ts-ignore - OpenTUI b supports fg but types might be missing it
          return <b fg={boldColor}>{segment.text}</b>;
        }
        return <span>{segment.text}</span>;
      })}
    </text>
  );
}

/**
 * Render text with markdown bold using a single color.
 * 
 * @param text - The text to parse
 * @param color - Color for all text
 * @returns A single JSX <text> element
 */
export function renderMarkdownBoldSingleColor(
  text: string,
  color: string
): JSX.Element {
  return renderMarkdownBold(text, color, color, color);
}
