/**
 * Text parsing utilities for markdown-style formatting in the TUI.
 * Re-exports pure functions from markdown.ts and adds JSX rendering.
 */
import type { JSX } from "solid-js";
import { parseMarkdownSegments } from "./markdown";
import { stripAnsiCodes, type FormattedSegment } from "./ansi";

// Re-export pure functions for convenience
export { parseMarkdownSegments, stripMarkdownBold, hasMarkdownBold, stripMarkdownLinks } from "./markdown";
export { stripAnsiCodes, hasAnsiCodes, sanitizeForDisplay, parseToSegments } from "./ansi";
export type { FormattedSegment } from "./ansi";
export type { TextSegment } from "./markdown";

/**
 * Render text segments as JSX spans/bold elements without a container.
 * Useful for embedding in an existing <text> element.
 */
export function RenderMarkdownSegments(props: {
  text: string;
  normalColor: string;
  boldColor: string;
  tagColor?: string;
}): JSX.Element {
  const segments = parseMarkdownSegments(props.text);
  const effectiveTagColor = props.tagColor || props.boldColor;

  if (segments.length === 0) {
    return <span style={{ fg: props.normalColor }}>{props.text}</span>;
  }

  return (
    <>
      {segments.map((segment) => {
        if (segment.tag) {
          return <span style={{ fg: effectiveTagColor }}>{segment.text}</span>;
        }
        if (segment.bold) {
          // OpenTUI's <b> component with style prop for bold text
          return <b style={{ fg: props.boldColor }}>{segment.text}</b>;
        }
        return <span style={{ fg: props.normalColor }}>{segment.text}</span>;
      })}
    </>
  );
}

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
  return (
    <text fg={normalColor}>
      <RenderMarkdownSegments
        text={text}
        normalColor={normalColor}
        boldColor={boldColor}
        tagColor={tagColor}
      />
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
