import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { colors, TOOL_ICONS } from "./colors";
import { formatDuration } from "../util/time";
import type { ToolEvent } from "../state";

// Braille spinner frames for smooth animation
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Default icon when tool type is unknown
 */
const DEFAULT_ICON = "\u2699"; // ⚙

/**
 * Generates a stable key for an event item.
 * Uses iteration number and timestamp for uniqueness.
 * This ensures consistent identity across re-renders.
 */
export function getEventKey(event: ToolEvent): string {
  return `${event.iteration}-${event.timestamp}`;
}

/**
 * Maps tool types to their display colors.
 * - Blue: read operations (read)
 * - Green: write operations (write, edit)
 * - Yellow: search operations (glob, grep)
 * - Purple: task/delegation (task)
 * - Cyan: web operations (webfetch, websearch, codesearch)
 * - Muted: shell commands (bash)
 * - Default (fg): todo operations and unknown
 */
function getToolColor(icon: string | undefined): string {
  if (!icon) return colors.fg;

  // Map icons back to their semantic colors
  if (icon === TOOL_ICONS.read) return colors.blue;
  if (icon === TOOL_ICONS.write || icon === TOOL_ICONS.edit) return colors.green;
  if (icon === TOOL_ICONS.glob || icon === TOOL_ICONS.grep) return colors.yellow;
  if (icon === TOOL_ICONS.task) return colors.purple;
  if (
    icon === TOOL_ICONS.webfetch ||
    icon === TOOL_ICONS.websearch ||
    icon === TOOL_ICONS.codesearch
  )
    return colors.cyan;
  if (icon === TOOL_ICONS.bash) return colors.fgMuted;
  // todowrite and todoread use default fg color
  return colors.fg;
}

export type LogProps = {
  events: ToolEvent[];
  isRunning: boolean;
  isIdle: boolean;
};

/**
 * Animated spinner component using braille characters.
 * Only animates when isIdle is false (tool events are arriving).
 * Shows static spinner when idle to reduce unnecessary re-renders.
 */
function Spinner(props: { isIdle: boolean }) {
  const [frame, setFrame] = createSignal(0);
  let intervalRef: ReturnType<typeof setInterval> | null = null;

  // Start/stop animation based on isIdle state
  const startAnimation = () => {
    if (intervalRef) return;
    intervalRef = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 120);
  };

  const stopAnimation = () => {
    if (intervalRef) {
      clearInterval(intervalRef);
      intervalRef = null;
    }
  };

  onMount(() => {
    // Only start animation if not idle
    if (!props.isIdle) {
      startAnimation();
    }

    onCleanup(() => stopAnimation());
  });

  // React to isIdle changes
  createMemo(() => {
    if (props.isIdle) {
      stopAnimation();
    } else {
      startAnimation();
    }
  });

  return (
    <box width="100%" flexDirection="row" paddingTop={1}>
      <text fg={colors.cyan}>{SPINNER_FRAMES[frame()]}</text>
      <text fg={colors.fgMuted}> looping...</text>
    </box>
  );
}

/**
 * Renders an iteration separator line.
 * Format: ── iteration {n} ──────────── {duration} · {commits} commit(s) ──
 * 
 * Memoized to prevent re-computation of duration and commit text on every reactive update.
 */
function SeparatorEvent(props: { event: ToolEvent }) {
  const durationText = createMemo(() =>
    props.event.duration !== undefined
      ? formatDuration(props.event.duration)
      : "running"
  );
  const commitCount = createMemo(() => props.event.commitCount ?? 0);
  const commitText = createMemo(() =>
    `${commitCount()} commit${commitCount() !== 1 ? "s" : ""}`
  );

  return (
    <box width="100%" paddingTop={1} paddingBottom={1} flexDirection="row">
      <text fg={colors.fgMuted}>{"── "}</text>
      <text fg={colors.fg}>iteration {props.event.iteration}</text>
      <text fg={colors.fgMuted}>{" ────────────── "}</text>
      <text fg={colors.fg}>{durationText()}</text>
      <text fg={colors.fgMuted}>{" · "}</text>
      <text fg={colors.fg}>{commitText()}</text>
      <text fg={colors.fgMuted}>{" ──"}</text>
    </box>
  );
}

/**
 * Renders a tool event line.
 * Format: {icon} {text}
 * Icon color is based on tool type (blue for read, green for write/edit, etc.)
 * 
 * Memoized to prevent re-computation of icon and color on every reactive update.
 */
function ToolEventItem(props: { event: ToolEvent }) {
  const icon = createMemo(() => props.event.icon || DEFAULT_ICON);
  const iconColor = createMemo(() => getToolColor(props.event.icon));

  return (
    <box width="100%" flexDirection="row">
      <text fg={iconColor()}>{icon()}</text>
      <text fg={colors.fg}> {props.event.text}</text>
    </box>
  );
}

/**
 * Scrollable event log component displaying tool events and iteration separators.
 * Uses stickyScroll to keep the view at the bottom as new events arrive.
 * 
 * PERF: Uses <For> directly on props.events to avoid allocating wrapper objects.
 * Spinner is rendered conditionally outside the loop to avoid array allocations.
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
          <Show
            when={event.type === "separator"}
            fallback={<ToolEventItem event={event} />}
          >
            <SeparatorEvent event={event} />
          </Show>
        )}
      </For>
      <Show when={props.isRunning}>
        <Spinner isIdle={props.isIdle} />
      </Show>
    </scrollbox>
  );
}
