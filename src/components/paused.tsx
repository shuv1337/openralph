import { Show } from "solid-js";
import { colors } from "./colors";

export type PausedOverlayProps = {
  visible: boolean;
};

/**
 * Pause overlay component that displays a centered "PAUSED" message
 * when the loop is paused. Uses absolute positioning to cover the screen.
 */
export function PausedOverlay(props: PausedOverlayProps) {
  return (
    <Show when={props.visible}>
      {/* Outer box: absolute positioning, full width/height, centered content */}
      <box
        position="absolute"
        width="100%"
        height="100%"
        justifyContent="center"
        alignItems="center"
        backgroundColor={colors.bgHighlight}
      >
        {/* Inner box: panel with padding and border */}
        <box
          padding={2}
          borderStyle="single"
          borderColor={colors.border}
          backgroundColor={colors.bgPanel}
          flexDirection="column"
          alignItems="center"
        >
          {/* Large PAUSED text in yellow */}
          <text fg={colors.yellow}>{"\u23F8"} PAUSED</text>
          {/* Smaller hint in muted color */}
          <text fg={colors.fgMuted}>press p to resume</text>
        </box>
      </box>
    </Show>
  );
}
