import { For } from "solid-js";
import { colors } from "./colors";
import type { ToolEvent } from "../state";

export type LogProps = {
  events: ToolEvent[];
};

/**
 * Scrollable event log component displaying tool events and iteration separators.
 * Uses stickyScroll to keep the view at the bottom as new events arrive.
 */
export function Log(props: LogProps) {
  return (
    <scrollbox
      flexGrow={1}
      stickyScroll={true}
      stickyStart="bottom"
      rootOptions={{
        backgroundColor: colors.bg,
      }}
      viewportOptions={{
        backgroundColor: colors.bgDark,
      }}
      verticalScrollbarOptions={{
        visible: true,
        trackOptions: {
          backgroundColor: colors.border,
        },
      }}
    >
      <For each={props.events}>
        {(event) => (
          <box width="100%">
            <text fg={colors.fg}>{event.text}</text>
          </box>
        )}
      </For>
    </scrollbox>
  );
}
