import { Component, For, Match, Show, Switch, createEffect, createMemo, onCleanup, createSignal } from "solid-js";
import { useTheme } from "../context/ThemeContext";
import { getExtendedTheme, type ExtendedTheme } from "../lib/enhanced-themes";
import { useTerminalDimensions } from "@opentui/solid";
import { ToolDisplay } from "./tool-display";
import { Spinner } from "./animated/primitives";
import { formatDuration } from "../lib/time";
import type { ToolEvent } from "../state";
import type { RalphStatus } from "./tui-types";

// Braille spinner frames
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface EnhancedLogProps {
  events: ToolEvent[];
  status: RalphStatus;
  isIdle: boolean;
  showToolIcons?: boolean;
  showExecutionStates?: boolean;
  showDurations?: boolean;
  errorRetryAt?: number;
}

/**
 * Get the descriptive label for the current status.
 */
function getStatusLabel(status: RalphStatus, isIdle: boolean): string {
  if (isIdle && status === 'running') return "Waiting for response...";
  
  switch (status) {
    case 'running':
    case 'executing':
      return "Looping...";
    case 'selecting':
      return "Selecting task...";
    case 'pausing':
      return "Pausing...";
    case 'paused':
      return "Paused";
    case 'starting':
      return "Starting...";
    case 'ready':
      return "Ready";
    default:
      return "Processing...";
  }
}

export const EnhancedLog: Component<EnhancedLogProps> = (props) => {
  const { theme, themeName } = useTheme();
  const t = createMemo(() => getExtendedTheme(theme(), themeName()));
  const terminalDimensions = useTerminalDimensions();

  const availableWidth = createMemo(() => 
    Math.max(40, (terminalDimensions().width || 80) - 10)
  );

  const groupedEvents = createMemo(() => {
    const groups: Map<number, ToolEvent[]> = new Map();
    
    for (const event of props.events) {
      // Explicitly ignore spinner events in the list to prevent duplicates
      if (event.type === 'spinner') continue;
      
      if (!groups.has(event.iteration)) {
        groups.set(event.iteration, []);
      }
      groups.get(event.iteration)!.push(event);
    }
    
    return Array.from(groups.entries());
  });

  const statusLabel = createMemo(() => getStatusLabel(props.status, props.isIdle));
  
  // Only show active indicator when actually active and not in a static terminal state
  const showActiveIndicator = createMemo(() => 
    props.status !== 'complete' && 
    props.status !== 'error' && 
    props.status !== 'stopped' &&
    props.status !== 'idle'
  );

  return (
    <scrollbox
      flexGrow={1}
      stickyScroll={true}
      stickyStart="bottom"
      rootOptions={{ backgroundColor: t().background }}
      viewportOptions={{ backgroundColor: t().backgroundPanel }}
      verticalScrollbarOptions={{
        visible: true,
        trackOptions: { backgroundColor: t().border }
      }}
    ><For each={groupedEvents()}>{(item) => { const iteration = item[0]; const events = item[1]; const separator = events.find(e => e.type === 'separator'); return (<IterationGroup iteration={iteration} events={events} stats={separator ? { duration: separator.duration, commitCount: separator.commitCount || 0 } : undefined} availableWidth={availableWidth()} showExecutionStates={props.showExecutionStates} showDurations={props.showDurations} theme={t()}/>); }}</For><Show when={showActiveIndicator()}><box width="100%" flexDirection="row" paddingTop={1} paddingBottom={1}><Spinner frames={SPINNER_FRAMES} color={t().secondary} /><text fg={t().textMuted}> {statusLabel()}</text></box></Show><Show when={props.errorRetryAt !== undefined}><RetryCountdown retryAt={props.errorRetryAt!} theme={t()} /></Show></scrollbox>
  );
};

const IterationGroup: Component<{
  iteration: number;
  events: ToolEvent[];
  stats?: { duration?: number; commitCount: number };
  availableWidth: number;
  showExecutionStates?: boolean;
  showDurations?: boolean;
  theme: ExtendedTheme;
}> = (props) => {
  const t = () => props.theme;

  const durationText = createMemo(() => 
    props.stats?.duration ? formatDuration(props.stats.duration) : 'running'
  );

  const commitText = createMemo(() => 
    `${props.stats?.commitCount || 0} commit${props.stats?.commitCount !== 1 ? 's' : ''}`
  );

  return (
    <box width="100%" flexDirection="column"><box width="100%" paddingTop={1} paddingBottom={1} flexDirection="row"><text fg={t().textMuted}>── </text><text fg={t().iteration}>iteration {props.iteration}</text><text fg={t().textMuted}> ────────────── </text><text fg={t().duration}>{durationText()}</text><text fg={t().textMuted}> · </text><text fg={t().commit}>{commitText()}</text><text fg={t().textMuted}> ──</text></box><For each={props.events}>{(event) => (<Switch><Match when={event.type === 'tool'}><ToolDisplay event={event} showState={props.showExecutionStates} showDuration={props.showDurations} maxWidth={props.availableWidth} theme={props.theme}/></Match><Match when={event.type === 'reasoning'}><ReasoningEvent event={event} theme={props.theme} /></Match></Switch>)}</For></box>
  );
};

const ReasoningEvent: Component<{ event: ToolEvent; theme: ExtendedTheme }> = (props) => {
  const t = () => props.theme;
  const truncatedText = createMemo(() => props.event.text.slice(0, 100));

  return (
    <box width="100%" flexDirection="row"><text fg={t().toolReasoning || t().warning}>💭</text><text fg={t().textMuted}> </text><text fg={t().textMuted}>{truncatedText()}{props.event.text.length > 100 ? '...' : ''}</text></box>
  );
};

const RetryCountdown: Component<{ retryAt: number; theme: ExtendedTheme }> = (props) => {
  const t = () => props.theme;
  const [remaining, setRemaining] = createSignal(Math.max(0, Math.ceil((props.retryAt - Date.now()) / 1000)));

  createEffect(() => {
    const interval = setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((props.retryAt - Date.now()) / 1000)));
    }, 1000);
    onCleanup(() => clearInterval(interval));
  });

  return (
    <box width="100%" flexDirection="row" paddingTop={1}><text fg={t().warning}>⏳</text><text fg={t().textMuted}> Retrying in </text><text fg={t().warning}>{remaining()}s</text><text fg={t().textMuted}>...</text></box>
  );
};
