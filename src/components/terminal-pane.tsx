import { createMemo } from "solid-js";
import { stripAnsiCodes } from "../lib/text-utils";

interface TerminalPaneProps {
  buffer: string;
  cols: number;
  rows: number;
  showCursor?: boolean;
}

export function TerminalPane(props: TerminalPaneProps) {
  // Strip ANSI codes from buffer before passing to ghostty-terminal
  // This prevents rendering artifacts in some terminals and layouts
  const sanitizedBuffer = createMemo(() => stripAnsiCodes(props.buffer));

  return (
    <ghostty-terminal
      ansi={sanitizedBuffer()}
      cols={props.cols}
      rows={props.rows}
      showCursor={props.showCursor ?? true}
    />
  );
}

