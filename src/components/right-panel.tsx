import { Show, For, createMemo, Switch, Match } from "solid-js";
import { useTheme } from "../context/ThemeContext";
import { RenderMarkdownSegments, renderMarkdownBold } from "../lib/text-utils";
import { formatViewMode, taskStatusIndicators, getTaskStatusColor } from "./tui-theme";
import type { DetailsViewMode, TaskStatus, UiTask, RalphStatus } from "./tui-types";
import type { ToolEvent } from "../state";
import { EnhancedLog } from "./enhanced-log";
import { StatusIndicator } from "./animated/status-indicator";
import { TerminalPane } from "./terminal-pane";

// =====================================================
// ACCEPTANCE CRITERIA PARSING
// =====================================================

export type AcceptanceCriteriaItem = {
  text: string;
  checked: boolean;
};

/**
 * Parse acceptance criteria from description, dedicated field, or metadata array.
 * Looks for markdown checklist items (- [ ] or - [x])
 */
function parseAcceptanceCriteria(
  description?: string,
  acceptanceCriteria?: string
): AcceptanceCriteriaItem[] {
  const content = acceptanceCriteria || description || "";
  const lines = content.split("\n");
  const criteria: AcceptanceCriteriaItem[] = [];

  let inCriteriaSection = false;

  for (const line of lines) {
    // Check for section header
    if (line.toLowerCase().includes("acceptance criteria")) {
      inCriteriaSection = true;
      continue;
    }

    // Parse checklist items
    const checkboxMatch = line.match(/^\s*-\s*\[([ xX])\]\s*(.+)$/);
    if (checkboxMatch) {
      criteria.push({
        checked: checkboxMatch[1].toLowerCase() === "x",
        text: checkboxMatch[2].trim(),
      });
    }

    // Accept bullet points in criteria section
    if (inCriteriaSection) {
      const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
      if (bulletMatch && !checkboxMatch) {
        criteria.push({
          checked: false,
          text: bulletMatch[1].trim(),
        });
      }
    }
  }

  return criteria;
}

// =====================================================
// PRIORITY DISPLAY
// =====================================================

const priorityLabels: Record<number, string> = {
  0: "P0 - Critical",
  1: "P1 - High",
  2: "P2 - Medium",
  3: "P3 - Low",
  4: "P4 - Backlog",
};

function getPriorityColor(priority: number, theme: ReturnType<typeof useTheme>["theme"]): string {
  const t = theme();
  switch (priority) {
    case 0: return t.error;      // Critical - red
    case 1: return t.warning;    // High - orange
    case 2: return t.primary;    // Medium - blue
    case 3: return t.secondary;  // Low - purple
    case 4: return t.textMuted;  // Backlog - gray
    default: return t.textMuted;
  }
}

export type RightPanelProps = {
  selectedTask: UiTask | null;
  viewMode: DetailsViewMode;
  status: RalphStatus;
  adapterMode: "sdk" | "pty";
  events: ToolEvent[];
  isIdle: boolean;
  errorRetryAt?: number;
  terminalBuffer?: string;
  terminalCols: number;
  terminalRows: number;
  promptText?: string;
};


// =====================================================
// STATUS COLOR WITH FULL STATUS SUPPORT
// =====================================================

function getStatusColorFromTheme(status: TaskStatus, theme: ReturnType<typeof useTheme>["theme"]): string {
  const t = theme();
  switch (status) {
    case "done":
      return t.success;
    case "active":
      return t.primary;
    case "actionable":
      return t.success;
    case "blocked":
      return t.error;
    case "error":
      return t.error;
    case "closed":
      return t.textMuted;
    case "pending":
    default:
      return t.textMuted;
  }
}

function NoSelection() {
  const { theme } = useTheme();
  const t = () => theme();

  return (
    <box flexGrow={1} flexDirection="column" padding={2}><box marginBottom={1}><text fg={t().text}>Getting Started</text></box><box marginBottom={2}><text fg={t().textMuted}>No tasks available. Run `ralph init` or add tasks to your plan.</text></box><text fg={t().textMuted}>Press q to quit</text></box>
  );
}

// =====================================================
// ACCEPTANCE CRITERIA LIST COMPONENT
// =====================================================

function AcceptanceCriteriaList(props: { 
  task: UiTask; 
}) {
  const { theme } = useTheme();
  const t = () => theme();
  
  const criteria = createMemo(() => 
    parseAcceptanceCriteria(
      props.task.description, 
      props.task.acceptanceCriteria
    )
  );

  return (
    <Show when={criteria().length > 0}>
      <box flexDirection="column" marginTop={1}><box marginBottom={1}><text fg={t().primary}>Acceptance Criteria</text></box><For each={criteria()}>{(item) => (<box flexDirection="row" paddingLeft={1}><text fg={item.checked ? t().success : t().textMuted}>{item.checked ? "✓" : "○"}</text><text fg={item.checked ? t().textMuted : t().text}><RenderMarkdownSegments text={" " + item.text} normalColor={item.checked ? t().textMuted : t().text} boldColor={t().accent} tagColor={t().secondary}/></text></box>)}</For></box>
    </Show>
  );
}

// =====================================================
// PRIORITY DISPLAY COMPONENT
// =====================================================

function PriorityDisplay(props: { 
  priority?: number; 
}) {
  const { theme } = useTheme();
  const t = () => theme();
  const priorityValue = () => props.priority ?? 2; // Default to P2

  const priorityLabel = createMemo(() => priorityLabels[priorityValue()] || "P2 - Medium");
  const priorityColor = createMemo(() => getPriorityColor(priorityValue(), theme));

  return (
    <box marginBottom={1}><text><span style={{ fg: t().textMuted }}>Priority: </span><span style={{ fg: priorityColor() }}>{priorityLabel()}</span></text></box>
  );
}

// =====================================================
// ENHANCED TASK DETAILS COMPONENT
// =====================================================

function TaskDetails(props: { task: UiTask }) {
  const { theme } = useTheme();
  const t = () => theme();

  const statusColor = () => getStatusColorFromTheme(props.task.status, theme);

  // Render title and description with markdown bold parsing using RenderMarkdownSegments
  const renderedTitle = () => (
    <text><StatusIndicator status={props.task.status} type="task" wrap={false} /><span> </span><RenderMarkdownSegments text={props.task.title} normalColor={t().text} boldColor={t().accent} tagColor={t().secondary}/><span style={{ fg: t().textMuted }}> ({props.task.id})</span></text>
  );

  const renderedDescription = () => (
    <text fg={t().text} width="100%"><RenderMarkdownSegments text={props.task.description ?? props.task.title} normalColor={t().text} boldColor={t().accent} tagColor={t().secondary}/></text>
  );

  // Check if description contains acceptance criteria
  const hasAcceptanceCriteria = createMemo(() => 
    props.task.description?.toLowerCase().includes("acceptance criteria") ||
    props.task.acceptanceCriteria !== undefined
  );

  return (
    <box flexDirection="column" padding={1} flexGrow={1}><scrollbox flexGrow={1}><box marginBottom={1}>{renderedTitle()}</box><box marginBottom={1}><text><span style={{ fg: t().textMuted }}>Status: </span><span style={{ fg: statusColor() }}>{props.task.status}</span></text></box><Show when={props.task.priority !== undefined}><PriorityDisplay priority={props.task.priority} /></Show><Show when={props.task.line !== undefined}><box marginBottom={1}><text><span style={{ fg: t().textMuted }}>Plan line: </span><span style={{ fg: t().text }}>{props.task.line}</span></text></box></Show><box marginBottom={1}><text fg={t().primary}>Description</text></box><box padding={1} border borderColor={t().borderSubtle} backgroundColor={t().backgroundElement}>{renderedDescription()}</box><Show when={hasAcceptanceCriteria()}><AcceptanceCriteriaList task={props.task} /></Show></scrollbox><box flexDirection="row" gap={2} marginTop={1}><text fg={t().textMuted}>[C] Commands</text><text fg={t().textMuted}>[↑↓] Navigate</text><text fg={t().textMuted}>[?] Help</text></box></box>
  );
}

function OutputView(props: {
  adapterMode: "sdk" | "pty";
  events: ToolEvent[];
  isIdle: boolean;
  status: RalphStatus;
  errorRetryAt?: number;
  terminalBuffer?: string;
  terminalCols: number;
  terminalRows: number;
}) {
  return (
    <box flexGrow={1} flexDirection="column"><Show when={props.adapterMode === "pty"} fallback={<EnhancedLog events={props.events} isIdle={props.isIdle} status={props.status} errorRetryAt={props.errorRetryAt} showToolIcons={true} showExecutionStates={true} showDurations={true}/>}><TerminalPane buffer={props.terminalBuffer || ""} cols={props.terminalCols} rows={props.terminalRows}/></Show></box>
  );
}

function PromptView(props: { promptText?: string; task?: UiTask | null }) {
  const { theme } = useTheme();
  const t = () => theme();

  const lines = createMemo(() => (props.promptText || "No prompt available").split("\n"));

  return (
    <box flexDirection="column" padding={1} flexGrow={1}><box marginBottom={1}><text fg={t().primary}>System Prompt Preview</text></box><Show when={props.task}><box marginBottom={1}><text><span style={{ fg: t().textMuted }}>Target Task: </span><RenderMarkdownSegments text={props.task?.title || ""} normalColor={t().accent} boldColor={t().accent} tagColor={t().secondary}/></text></box></Show><scrollbox flexGrow={1} border borderColor={t().borderSubtle} backgroundColor={t().backgroundElement} padding={1}><For each={lines()}>{(line) => (<box width="100%"><text fg={t().text}>{line}</text></box>)}</For></scrollbox><box marginTop={1}><text fg={t().textMuted}>Note: Prompt includes dynamic context (plan, progress).</text></box></box>
  );
}

export function RightPanel(props: RightPanelProps) {
  const { theme } = useTheme();
  const t = () => theme();

  const title = () => `Details ${formatViewMode(props.viewMode)}`;

  return (
    <box title={title()} flexGrow={2} flexShrink={1} minWidth={40} flexDirection="column" backgroundColor={t().background} border borderColor={t().primary}><Switch fallback={<NoSelection />}><Match when={props.viewMode === "details"}><Show when={props.selectedTask} fallback={<NoSelection />}>{(task) => <TaskDetails task={task()} />}</Show></Match><Match when={props.viewMode === "output"}><OutputView adapterMode={props.adapterMode} events={props.events} isIdle={props.isIdle} status={props.status} errorRetryAt={props.errorRetryAt} terminalBuffer={props.terminalBuffer} terminalCols={props.terminalCols} terminalRows={props.terminalRows}/></Match><Match when={props.viewMode === "prompt"}><PromptView promptText={props.promptText} task={props.selectedTask} /></Match></Switch></box>
  );
}
