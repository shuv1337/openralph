import { createMemo } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { useTheme } from "../context/ThemeContext";
import { renderMarkdownBold, stripMarkdownBold, truncateText } from "../lib/text-utils";
import { formatElapsedTime, layout, statusIndicators } from "./tui-theme";
import type { RalphStatus, UiTask, RateLimitState, ActiveAgentState, SandboxConfig } from "./tui-types";
import { StatusIndicator } from "./animated/status-indicator";
import { formatEta } from "../lib/time";

// =====================================================
// ENHANCED HEADER PROPS (With Ralph TUI Features)
// =====================================================

export type HeaderProps = {
  status: RalphStatus;
  iteration: number;
  tasksComplete: number;
  totalTasks: number;
  elapsedMs: number;
  eta: number | null;
  planError?: string;
  selectedTask?: UiTask | null;
  agentName?: string;
  adapterName?: string;
  debug?: boolean;
  // NEW PROPERTIES from Ralph TUI
  /** Current model in provider/model format (e.g., "anthropic/claude-opus-4") */
  currentModel?: string;
  /** Active tracker plugin name */
  trackerName?: string;
  /** Sandbox configuration for display */
  sandboxConfig?: SandboxConfig;
  /** Active agent state (includes fallback info) */
  activeAgentState?: ActiveAgentState;
  /** Rate limit state for fallback display */
  rateLimitState?: RateLimitState;
  /** Maximum iterations (for iteration counter display) */
  maxIterations?: number;
};

// =====================================================
// STATUS DISPLAY HELPERS
// =====================================================


/**
 * Get compact status display for the current Ralph status.
 * Returns a short, scannable label optimized for the compact header.
 * Supports all enhanced status types from Ralph TUI.
 */
function getStatusDisplay(status: RalphStatus, theme: ReturnType<typeof useTheme>["theme"]) {
  const t = theme();
  
  // Status configuration with indicator, color, and label for each state
  const statusConfig: Record<RalphStatus, { indicator: string; color: string; label: string }> = {
    ready: { indicator: statusIndicators.ready, color: t.info, label: "Ready" },
    running: { indicator: statusIndicators.running, color: t.success, label: "Running" },
    selecting: { indicator: statusIndicators.selecting, color: t.info, label: "Selecting" },
    executing: { indicator: statusIndicators.executing, color: t.success, label: "Executing" },
    pausing: { indicator: statusIndicators.pausing, color: t.warning, label: "Pausing" },
    paused: { indicator: statusIndicators.paused, color: t.warning, label: "Paused" },
    stopped: { indicator: statusIndicators.stopped, color: t.textMuted, label: "Stopped" },
    complete: { indicator: statusIndicators.complete, color: t.success, label: "Complete" },
    idle: { indicator: statusIndicators.idle, color: t.textMuted, label: "Idle" },
    error: { indicator: statusIndicators.error, color: t.error, label: "Error" },
    starting: { indicator: statusIndicators.starting, color: t.textMuted, label: "Starting" },
  };
  
  return statusConfig[status] || statusConfig.starting;
}

/**
 * Get the display name and styling for the active agent.
 * Shows fallback indicator when on fallback agent with different color.
 */
function getAgentDisplay(
  agentName: string | undefined,
  activeAgentState: ActiveAgentState | undefined,
  rateLimitState: RateLimitState | undefined,
  theme: ReturnType<typeof useTheme>["theme"]
): { displayName: string; color: string; showRateLimitIcon: boolean; statusLine: string | null } {
  const t = theme();
  
  // Use active agent from engine state if available, otherwise fall back to config
  const activeAgent = agentName || activeAgentState?.plugin;
  const isOnFallback = activeAgentState?.reason === "fallback";
  const isPrimaryRateLimited = rateLimitState?.limitedAt !== undefined;
  const primaryAgent = rateLimitState?.primaryAgent;

  if (!activeAgent) {
    return { displayName: "", color: t.secondary, showRateLimitIcon: false, statusLine: null };
  }

  if (isOnFallback && isPrimaryRateLimited && primaryAgent) {
    // On fallback agent due to rate limit - show with indicator and status message
    return {
      displayName: `agent: ${activeAgent} (fallback)`,
      color: t.warning,
      showRateLimitIcon: true,
      statusLine: `Primary (${primaryAgent}) rate limited, using fallback`,
    };
  }

  if (isOnFallback) {
    // On fallback agent for other reasons
    return {
      displayName: `agent: ${activeAgent} (fallback)`,
      color: t.warning,
      showRateLimitIcon: false,
      statusLine: null,
    };
  }

  return {
    displayName: `agent: ${activeAgent}`,
    color: t.accent,
    showRateLimitIcon: false,
    statusLine: null,
  };
}

/**
 * Get the sandbox display string.
 * Returns null if sandbox is disabled, otherwise returns mode with optional (no-net) suffix.
 */
function getSandboxDisplay(sandboxConfig: SandboxConfig | undefined): string | null {
  if (!sandboxConfig?.enabled) return null;
  
  const mode = sandboxConfig.mode ?? "auto";
  if (mode === "off") return null;
  
  const networkSuffix = sandboxConfig.network === false ? " (no-net)" : "";
  return `${mode}${networkSuffix}`;
}

/**
 * Parse model info for display (provider/model format).
 */
function parseModelDisplay(model: string | undefined): { provider: string; model: string; display: string } | null {
  if (!model) return null;
  const parts = model.split("/");
  if (parts.length >= 2) {
    const [provider, ...rest] = parts;
    const modelName = rest.join("/");
    return { provider, model: modelName, display: `${provider}/${modelName}` };
  }
  return { provider: "", model, display: model };
}

function MiniProgressBar(props: {
  completed: number;
  total: number;
  width: number;
  filledColor: string;
  emptyColor: string;
}) {
  const percentage = () => (props.total > 0 ? Math.round((props.completed / props.total) * 100) : 0);
  const filledWidth = () => Math.floor((percentage() / 100) * props.width);
  const emptyWidth = () => props.width - filledWidth();

  return (
    <box flexDirection="row"><text fg={props.filledColor}>{"▓".repeat(filledWidth())}</text><text fg={props.emptyColor}>{"░".repeat(emptyWidth())}</text></box>
  );
}

export function Header(props: HeaderProps) {
  const { theme } = useTheme();
  const t = () => theme();
  const terminalDimensions = useTerminalDimensions();

  const statusDisplay = () => getStatusDisplay(props.status, theme);
  const elapsedSeconds = createMemo(() => Math.floor(props.elapsedMs / 1000));
  const formattedTime = createMemo(() => formatElapsedTime(elapsedSeconds()));
  const formattedEta = createMemo(() => formatEta(props.eta));
  const percentage = createMemo(() => 
    props.totalTasks > 0 ? Math.round((props.tasksComplete / props.totalTasks) * 100) : 0
  );

  // NEW: Iteration counter display with max iterations support
  const iterationDisplay = createMemo(() => {
    if (props.maxIterations !== undefined && props.maxIterations > 0) {
      return `iter: [${props.iteration}/${props.maxIterations}]`;
    }
    return `iter: [${props.iteration}/∞]`;
  });

  // NEW: Agent display with fallback status
  const agentDisplay = createMemo(() => 
    getAgentDisplay(props.agentName, props.activeAgentState, props.rateLimitState, theme)
  );

  // NEW: Model display parsing
  const modelDisplay = createMemo(() => parseModelDisplay(props.currentModel));

  // NEW: Check if agent display is just a duplicate of model display
  // Only hide if agent name was NOT explicitly provided and it matches the model
  const showAgentDisplay = createMemo(() => {
    if (!agentDisplay().displayName) return false;
    if (props.agentName) return true; // Always show if explicitly named
    if (props.activeAgentState?.reason === "fallback") return true; // Always show if fallback
    
    // Otherwise, check if it's just repeating the model name
    const model = modelDisplay()?.display;
    if (!model) return true;
    return !agentDisplay().displayName.includes(model);
  });

  // NEW: Sandbox display
  const sandboxDisplay = createMemo(() => getSandboxDisplay(props.sandboxConfig));

  // NEW: Check if header should be 2 rows (rate limit warning)
  const headerHeight = createMemo(() => 
    agentDisplay().statusLine ? 2 : layout.header.height
  );

  // NEW: Calculate dynamic layout metrics for truncation and hiding
  const layoutMetrics = createMemo(() => {
    const width = terminalDimensions().width;
    
    // 1. Define priority hiding based on terminal width
    const hideEta = width < 110;
    const hideTime = width < 100;
    const hideIteration = width < 90;
    const hideProgressText = width < 80;
    const hideStatusLabel = width < 70;
    const isCompact = width < 120;

    // 2. Calculate essential widths of fixed components
    // Left: "◆ OpenRalph " (12) + "│ " (2) + "[DEBUG] " (8) + Indicator (2) + Label
    const statusPart = getStatusDisplay(props.status, theme);
    const leftEssential = 12 + (props.debug ? 8 : 0) + 2 + 2 + (hideStatusLabel ? 0 : statusPart.label.length);
    
    // 3. Calculate actual right-side width based on what's visible
    let rightUsed = 6; // base gaps and padding
    if (props.planError) {
      rightUsed += 13; // "⚠️ Plan Error"
    } else {
      rightUsed += isCompact ? 4 : 8; // MiniProgressBar
      if (!hideProgressText) rightUsed += 14; // " XX/XX (100%)"
    }
    if (!hideIteration) rightUsed += 16;
    if (!hideTime) rightUsed += 11;
    if (!hideEta) rightUsed += 11;

    // 4. Determine available space for Task and Metadata
    // Subtract essential parts and common separators (like "│" and "→")
    const available = Math.max(0, width - leftEssential - rightUsed - 8);
    
    // 5. Distribute available space between Task Title and Metadata (Agent/Model)
    // We prioritize Metadata (Agent/Model) more than before to ensure critical info is visible
    // In wide terminals, we allow metadata to grow significantly.
    const taskWeight = 0.4;
    const metaWeight = 0.6;
    
    const taskMax = Math.floor(available * taskWeight);
    const metaMax = Math.floor(available * metaWeight);

    return {
      taskMaxWidth: Math.max(10, Math.min(taskMax, 150)),
      metadataMaxWidth: Math.max(15, Math.min(metaMax, 120)), // Significantly increased from 40
      hideEta,
      hideTime,
      hideIteration,
      hideStatusLabel,
      hideProgressText,
      isCompact
    };
  });

  const taskDisplay = createMemo(() => {
    if (!props.selectedTask) return null;
    // Show task for more status states (including new ones)
    const showTaskStatuses = ["running", "paused", "executing", "selecting"];
    if (!showTaskStatuses.includes(props.status)) return null;
    return truncateText(props.selectedTask.title, layoutMetrics().taskMaxWidth);
  });

  const taskLabel = createMemo(() => taskDisplay());

  // Render task label with markdown bold parsing
  const renderedTaskLabel = createMemo(() => {
    const label = taskLabel();
    if (!label) return null;
    return renderMarkdownBold(
      label, 
      t().secondary, 
      t().accent,
      t().info // Use info color for tags in header
    );
  });

  return (
    <box width="100%" height={headerHeight()} flexDirection="column" backgroundColor={t().backgroundPanel}><box width="100%" height={1} flexDirection="row" justifyContent="space-between" alignItems="center" paddingLeft={1} paddingRight={1}><box flexDirection="row" gap={1} flexShrink={1}><text fg={t().primary}>◆ OpenRalph</text><text fg={t().textMuted}>│</text>{props.debug && <><text fg={t().warning}>[DEBUG]</text><text fg={t().textMuted}> </text></>}<StatusIndicator status={props.status} type="ralph" animated={true} />{!layoutMetrics().hideStatusLabel && <text fg={statusDisplay().color}> {statusDisplay().label}</text>}{taskLabel() && <><text fg={t().textMuted}> → </text>{renderedTaskLabel()}</>}</box><box flexDirection="row" gap={1} alignItems="center" flexShrink={0}>{showAgentDisplay() && <text fg={agentDisplay().color}>{agentDisplay().showRateLimitIcon && <span>⏳ </span>}{truncateText(agentDisplay().displayName, layoutMetrics().metadataMaxWidth)}</text>}{showAgentDisplay() && modelDisplay() && <text fg={t().textMuted}>│</text>}{modelDisplay() && <text fg={t().accent}>{truncateText(modelDisplay()!.display, layoutMetrics().metadataMaxWidth)}</text>}{props.trackerName && !layoutMetrics().isCompact && <text fg={t().secondary}>{props.trackerName}</text>}{sandboxDisplay() && !layoutMetrics().isCompact && <text fg={t().info}>🔒 {sandboxDisplay()}</text>}{!agentDisplay().displayName && (props.agentName || props.adapterName) && <box flexDirection="row" gap={1}>{props.agentName && <text fg={t().secondary}>{truncateText(props.agentName, layoutMetrics().metadataMaxWidth)}</text>}{props.agentName && props.adapterName && <text fg={t().textMuted}>/</text>}{props.adapterName && <text fg={t().primary}>{truncateText(props.adapterName, layoutMetrics().metadataMaxWidth)}</text>}</box>}<box flexDirection="row" gap={1} alignItems="center">{props.planError ? <text fg={t().error}>⚠️ Plan Error</text> : <><MiniProgressBar completed={props.tasksComplete} total={props.totalTasks} width={layoutMetrics().isCompact ? 4 : 8} filledColor={t().success} emptyColor={t().textMuted} />{!layoutMetrics().hideProgressText && <text fg={t().text}>{props.tasksComplete}/{props.totalTasks} ({percentage()}%)</text>}</>}</box>{!layoutMetrics().hideIteration && <text fg={t().textMuted}>{iterationDisplay()}</text>}{!layoutMetrics().hideTime && <box flexDirection="row" gap={1} alignItems="center"><text fg={t().textMuted}>⏱</text><text fg={t().text}>{formattedTime()}</text></box>}{!layoutMetrics().hideEta && <text fg={t().textMuted}>{formattedEta()}</text>}</box></box>{agentDisplay().statusLine && <box width="100%" height={1} flexDirection="row" justifyContent="center" alignItems="center" paddingLeft={1} paddingRight={1}><text fg={t().warning}><span>⏳ </span><span>{truncateText(agentDisplay().statusLine!, terminalDimensions().width - 6)}</span></text></box>}</box>
  );
}
