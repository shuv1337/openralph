import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { TOOL_ICONS } from "../lib/theme-colors";
import { formatDuration } from "../util/time";
import type { ToolEvent } from "../state";
import { useTheme } from "../context/ThemeContext";
import type { Theme } from "../lib/theme-resolver";

// Braille spinner frames for smooth animation
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Default icon when tool type is unknown
 */
const DEFAULT_ICON = "⚙"; // ⚙

/**
 * Generates a stable key for an event item.
 * Uses iteration number and timestamp for uniqueness.
 * This ensures consistent identity across re-renders.
 */
export function getEventKey(event: ToolEvent): string {
  return `${event.iteration}-${event.timestamp}`;
}

/**
 * Maps tool types to their display colors using theme.
 * - Blue (info): read operations (read)
 * - Green (success): write operations (write, edit)
 * - Yellow (warning): search operations (glob, grep)
 * - Purple (accent): task/delegation (task)
 * - Cyan (secondary): web operations (webfetch, websearch, codesearch)
 * - Muted (textMuted): shell commands (bash)
 * - Orange (warning): reasoning/thought
 * - Default (text): todo operations and unknown
 */
function getToolColor(icon: string | undefined, theme: Theme): string {
  if (!icon) return theme.text;

  // Map icons back to their semantic colors
  if (icon === TOOL_ICONS.read) return theme.info;
  if (icon === TOOL_ICONS.write || icon === TOOL_ICONS.edit) return theme.success;
  if (icon === TOOL_ICONS.glob || icon === TOOL_ICONS.grep) return theme.warning;
  if (icon === TOOL_ICONS.task) return theme.accent;
  if (
    icon === TOOL_ICONS.webfetch ||
    icon === TOOL_ICONS.websearch ||
    icon === TOOL_ICONS.codesearch
  )
    return theme.secondary;
  if (icon === TOOL_ICONS.bash) return theme.textMuted;
  if (icon === TOOL_ICONS.thought) return theme.warning;
  // todowrite and todoread use default text color
  return theme.text;
}

export type LogProps = {
  events: ToolEvent[];
  isIdle: boolean;
  /** Timestamp (epoch ms) when next retry will occur, undefined when no backoff active */
  errorRetryAt?: number;
};

/**
 * Retry countdown component displaying "Retrying in Xs..." during error backoff.
 * Updates every second to show accurate countdown.
 */
function RetryCountdown(props: { retryAt: number; theme: Theme }) {
  const [remaining, setRemaining] = createSignal(
    Math.max(0, Math.ceil((props.retryAt - Date.now()) / 1000))
  );

  // Update countdown every second
  const intervalRef = setInterval(() => {
    const secs = Math.max(0, Math.ceil((props.retryAt - Date.now()) / 1000));
    setRemaining(secs);
  }, 1000);

  onCleanup(() => {
    clearInterval(intervalRef);
  });

  return (
    <box width="100%" flexDirection="row" paddingTop={1}>
      <text fg={props.theme.warning}>⏳</text>
      <text fg={props.theme.textMuted}> Retrying in </text>
      <text fg={props.theme.warning}>{remaining()}s</text>
      <text fg={props.theme.textMuted}>...</text>
    </box>
  );
}

/**
 * Animated spinner component using braille characters.
 * Only animates when isIdle is false (tool events are arriving).
 * Shows static spinner when idle to reduce unnecessary re-renders.
 * 
 * PERF: Uses a single createEffect for start/stop logic. The effect runs
 * once on mount and whenever isIdle changes. The intervalRef guard ensures
 * only one interval is ever active.
 */
function Spinner(props: { isIdle: boolean; theme: Theme }) {
  const [frame, setFrame] = createSignal(0);
  let intervalRef: ReturnType<typeof setInterval> | null = null;

  // Single effect handles both initial state and reactive updates.
  // Guards ensure interval is created only once.
  createEffect(() => {
    if (props.isIdle) {
      // Stop animation when idle
      if (intervalRef) {
        clearInterval(intervalRef);
        intervalRef = null;
      }
    } else {
      // Start animation when not idle (guard prevents multiple intervals)
      if (!intervalRef) {
        intervalRef = setInterval(() => {
          setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
        }, 120);
      }
    }
  });

  // Cleanup on unmount
  onCleanup(() => {
    if (intervalRef) {
      clearInterval(intervalRef);
      intervalRef = null;
    }
  });

  return (
    <box width="100%" flexDirection="row" paddingTop={1}>
      <text fg={props.theme.secondary}>{SPINNER_FRAMES[frame()]}</text>
      <text fg={props.theme.textMuted}> looping...</text>
    </box>
  );
}

/**
 * Renders an iteration separator line.
 * Format: ── iteration {n} ──────────── {duration} · {commits} commit(s) ──
 * 
 * Memoized to prevent re-computation of duration and commit text on every reactive update.
 */
function SeparatorEvent(props: { event: ToolEvent; theme: Theme }) {
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
      <text fg={props.theme.textMuted}>{"── "}</text>
      <text fg={props.theme.text}>iteration {props.event.iteration}</text>
      <text fg={props.theme.textMuted}>{" ────────────── "}</text>
      <text fg={props.theme.text}>{durationText()}</text>
      <text fg={props.theme.textMuted}>{" · "}</text>
      <text fg={props.theme.text}>{commitText()}</text>
      <text fg={props.theme.textMuted}>{" ──"}</text>
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
function ToolEventItem(props: { event: ToolEvent; theme: Theme }) {
  const icon = createMemo(() => props.event.icon || DEFAULT_ICON);
  const iconColor = createMemo(() => getToolColor(props.event.icon, props.theme));

  return (
    <box width="100%" flexDirection="row">
      <text fg={iconColor()}>{icon()}</text>
      <text fg={props.theme.text}> {props.event.text}</text>
    </box>
  );
}

/**
 * Renders a reasoning/thought event line.
 * Format: {icon} {text}
 * Uses warning color (orange-like) to distinguish from tool events.
 */
function ReasoningEventItem(props: { event: ToolEvent; theme: Theme }) {
  const icon = TOOL_ICONS.thought;

  return (
    <box width="100%" flexDirection="row">
      <text fg={props.theme.warning}>{icon}</text>
      <text fg={props.theme.textMuted}> {props.event.text}</text>
    </box>
  );
}

/**
 * Scrollable event log component displaying tool events and iteration separators.
 * Uses stickyScroll to keep the view at the bottom as new events arrive.
 * 
 * PERF: Uses <For> directly on props.events to avoid allocating wrapper objects.
 * Spinner is managed as an event in the array, always kept at the end to ensure
 * it renders at the bottom of the scrollable content.
 */
export function Log(props: LogProps) {
  const { theme } = useTheme();
  const t = theme();

  return (
    <scrollbox
      flexGrow={1}
      stickyScroll={true}
      stickyStart="bottom"
      rootOptions={{
        backgroundColor: t.background,
      }}
      viewportOptions={{
        backgroundColor: t.backgroundPanel,
      }}
      verticalScrollbarOptions={{
        visible: true,
        trackOptions: {
          backgroundColor: t.border,
        },
      }}
    >
      <For each={props.events}>
        {(event) => (
          <Switch>
            <Match when={event.type === "spinner"}>
              <Spinner isIdle={props.isIdle} theme={t} />
            </Match>
            <Match when={event.type === "separator"}>
              <SeparatorEvent event={event} theme={t} />
            </Match>
            <Match when={event.type === "tool"}>
              <ToolEventItem event={event} theme={t} />
            </Match>
            <Match when={event.type === "reasoning"}>
              <ReasoningEventItem event={event} theme={t} />
            </Match>
          </Switch>
        )}
      </For>
      <Show when={props.errorRetryAt !== undefined}>
        <RetryCountdown retryAt={props.errorRetryAt!} theme={t} />
      </Show>
    </scrollbox>
  );
}
