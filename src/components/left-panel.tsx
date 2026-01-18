import { For, Show, createEffect, createMemo } from "solid-js";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useTheme } from "../context/ThemeContext";
import { RenderMarkdownSegments, stripMarkdownBold, stripMarkdownLinks, getCompactTag } from "../lib/text-utils";
import { taskStatusIndicators, getTaskStatusColor } from "./tui-theme";
import { StatusIndicator } from "./animated/status-indicator";
import type { TaskStatus, UiTask } from "./tui-types";

// =====================================================
// LEFT PANEL PROPS WITH HIERARCHY SUPPORT
// =====================================================

export type LeftPanelProps = {
  tasks: UiTask[];
  selectedIndex: number;
  width: number;
  /** Panel height - used to trigger scroll recalculation on terminal resize */
  height: number;
  /** Total number of tasks (including completed) - used to show "all completed" message */
  totalTasks?: number;
  /** Whether completed tasks are currently being shown */
  showingCompleted?: boolean;
  /** Whether to use a more compact single-line layout */
  compactMode?: boolean;
  /** Callback when a task is clicked/selected */
  onSelect?: (index: number) => void;
};

// =====================================================
// HIERARCHY SUPPORT UTILITIES
// =====================================================

/**
 * Build a map of parent IDs to determine indentation levels.
 * Tasks with a parentId that exists in the task list are indented.
 */
function buildIndentMap(tasks: UiTask[]): Map<string, number> {
  // Create a set of all task IDs for quick lookup
  const taskIds = new Set(tasks.map((t) => t.id));
  const indentMap = new Map<string, number>();

  for (const task of tasks) {
    // If task has a parent that exists in our list, it's indented
    if (task.parentId && taskIds.has(task.parentId)) {
      indentMap.set(task.id, 1);
    } else {
      indentMap.set(task.id, 0);
    }
  }

  return indentMap;
}

function truncateText(text: string, maxWidth: number): string {
  // Use plain text for length calculation to handle markdown properly
  // Strip both bold markers and links for accurate length calculation
  const plainText = stripMarkdownBold(stripMarkdownLinks(text));
  if (plainText.length <= maxWidth) return text;
  
  if (maxWidth <= 3) return plainText.slice(0, maxWidth);
  
  // For simplicity and to avoid broken markdown markers, 
  // we return truncated plain text when truncation is necessary.
  const targetLength = maxWidth - 1; // Leave room for ellipsis
  return plainText.slice(0, targetLength) + "…";
}

// Fixed gutter width for dense mode (indent + status + ID + tags)
const GUTTER_WIDTH = 24;

/**
 * Abbreviate a tag/category to its first initial in brackets.
 * e.g. "functional" -> "[F]"
 */
function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  
  const words = text.split(/(\s+)/); // Preserve whitespace between words
  const lines: string[] = [];
  let currentLine = "";

  for (const segment of words) {
    // If segment is whitespace and we're at start of line, skip it
    if (segment.trim() === "" && currentLine === "") continue;

    if ((currentLine + segment).length <= width) {
      currentLine += segment;
    } else {
      // Current segment doesn't fit. Push current line if not empty.
      if (currentLine !== "") {
        lines.push(currentLine.trimEnd());
        currentLine = "";
      }

      // If segment is just whitespace, skip it as it would be at start of next line
      if (segment.trim() === "") continue;

      // Handle long word or segment
      let remaining = segment;
      while (remaining.length > width) {
        lines.push(remaining.slice(0, width));
        remaining = remaining.slice(width);
      }
      currentLine = remaining;
    }
  }
  
  if (currentLine.trim() !== "") {
    lines.push(currentLine.trimEnd());
  }
  
  return lines.length === 0 ? [""] : lines;
}

/**
 * Calculate the required height for a task row based on layout and text wrapping.
 */
function calculateTaskHeight(task: UiTask, availableContentWidth: number, compactMode: boolean): number {
  if (compactMode) return 1;
  
  const plainText = stripMarkdownBold(stripMarkdownLinks(task.title));
  const lines = wrapText(plainText, availableContentWidth);

  // Add 1 extra line of padding for each task to increase gap spacing by ~50-100%
  return Math.max(1, lines.length) + 1; 
}


/**
 * Get status color from theme using the new semantic color mappings.
 * Falls back to textMuted for unknown statuses.
 */
function getStatusColorFromTheme(status: TaskStatus, theme: ReturnType<typeof useTheme>["theme"]): string {
  const t = theme();
  switch (status) {
    case "done":
      return t.success;      // green
    case "active":
      return t.primary;      // blue (currently working)
    case "actionable":
      return t.primary;      // blue (ready to work)
    case "pending":
      return t.textMuted;    // gray
    case "blocked":
      return t.error;        // red
    case "error":
      return t.error;        // red
    case "closed":
      return t.textMuted;    // greyed out
    default:
      return t.textMuted;
  }
}

// =====================================================
// ENHANCED TASK ROW WITH HIERARCHY AND CLOSED STYLING
// =====================================================

/**
 * Single task item row with hierarchy support.
 * 
 * In compact mode (default):
 * Shows: [indent][status indicator] [task ID] [task title (truncated)]
 * 
 * In dense mode (compactMode=false):
 * Line 1: [indent][status indicator] [task title (bold/high density)]
 * Line 2: [indent]  [task ID] [priority] (dimmed metadata)
 */
function TaskRow(props: {
  task: UiTask;
  isSelected: boolean;
  maxWidth: number;
  index: number;
  /** Indentation level (0 = root, 1 = child of root) */
  indentLevel?: number;
  compactMode?: boolean;
  onSelect?: () => void;
}) {
  const { theme } = useTheme();
  const t = () => theme();

  const indentLevel = () => props.indentLevel ?? 0;
  const indent = () => "  ".repeat(indentLevel());

  const abbreviatedTag = () => getCompactTag(props.task.category);

  // Title width calculation depends on mode
  const titleWidth = () => {
    const internalPadding = 2; // paddingLeft(1) + paddingRight(1) in TaskRow box
    if (props.compactMode) {
      // Compact: Indent + Status(1) + space(1) + ID + (space(1) + [T])? + space(1) + title
      const idLen = props.task.id.length;
      const tagLen = abbreviatedTag().length;
      const prefixLen = (indentLevel() * 2) + 1 + 1 + idLen + (tagLen > 0 ? 1 + tagLen : 0) + 1;
      return Math.max(10, props.maxWidth - prefixLen - internalPadding);
    } else {
      // Dense: Indent + Title (indented by 2 more spaces)
      return Math.max(10, props.maxWidth - 4 - (indentLevel() * 2) - internalPadding);
    }
  };

  const rowBg = () => {
    if (props.isSelected) return t().primary;
    return props.index % 2 === 0 ? t().background : t().backgroundPanel;
  };

  const isClosed = () => props.task.status === "closed";

  const textColor = () => {
    if (props.isSelected) return t().background;
    if (props.task.status === "done" || isClosed()) return t().textMuted;
    return t().text;
  };

  const boldColor = () => {
    if (props.isSelected) return t().background;
    return t().accent;
  };

  const idColor = () => {
    if (props.isSelected) return t().background;
    return t().textMuted;
  };

  const priorityTag = () => {
    if (props.task.priority === undefined) return "";
    const p = props.task.priority;
    if (p === 0) return "[P0]";
    if (p === 1) return "[P1]";
    if (p === 2) return "[P2]";
    if (p === 3) return "[P3]";
    return "[P4]";
  };

  const categoryTag = () => {
    if (!props.task.category) return "";
    return `[${props.task.category}]`;
  };

  const categoryColor = () => {
    if (props.isSelected) return t().background;
    return t().secondary; // Use theme's secondary color (Cyan/Blue-ish) for tags
  };

  // Content width available for description text after gutter and padding
  const availableContentWidth = () => Math.max(10, props.maxWidth - (GUTTER_WIDTH + (indentLevel() * 2)));

  const rowHeight = () => 
    calculateTaskHeight(props.task, availableContentWidth(), !!props.compactMode);

  const wrappedLines = createMemo(() => {
    const plainText = stripMarkdownBold(stripMarkdownLinks(props.task.title));
    return wrapText(plainText, availableContentWidth());
  });

  return (
    <box width="100%" height={rowHeight()} flexDirection="column" paddingLeft={1} paddingRight={1} backgroundColor={rowBg()} onMouseDown={props.onSelect}><Show when={props.compactMode} fallback={<box flexDirection="column" width="100%" height={rowHeight()}><For each={wrappedLines()}>{(line, lineIdx) => (<box height={1} width="100%"><text><Show when={lineIdx() === 0} fallback={<span style={{ fg: t().textMuted }}>{" ".repeat((indentLevel() * 2) + 2 + (GUTTER_WIDTH - 2) + 1)}</span>}><span style={{ fg: t().textMuted }}>{indent()}</span><StatusIndicator status={props.task.status} type="task" animated={props.isSelected} wrap={false} /><span style={{ fg: idColor() }}> {props.task.id} </span><span style={{ fg: categoryColor() }}>{categoryTag()}</span><span style={{ fg: idColor() }}>{priorityTag()} </span><span style={{ fg: textColor() }}> </span></Show><RenderMarkdownSegments text={line} normalColor={textColor()} boldColor={boldColor()} tagColor={t().secondary}/></text></box>)}</For></box>}><text><span style={{ fg: t().textMuted }}>{indent()}</span><StatusIndicator status={props.task.status} type="task" animated={props.isSelected} wrap={false} /><span style={{ fg: idColor() }}> {props.task.id}</span><Show when={abbreviatedTag()}><span style={{ fg: categoryColor() }}> {abbreviatedTag()}</span></Show><span style={{ fg: textColor() }}> </span><RenderMarkdownSegments text={truncateText(stripMarkdownLinks(props.task.title), titleWidth())} normalColor={textColor()} boldColor={boldColor()} tagColor={t().secondary}/></text></Show></box>
  );
}

export function LeftPanel(props: LeftPanelProps) {
  const { theme } = useTheme();
  const t = () => theme();
  let scrollboxRef: ScrollBoxRenderable | undefined;

  const maxRowWidth = () => Math.max(20, props.width - 2);

  const indentMap = createMemo(() => buildIndentMap(props.tasks));

  const emptyMessage = createMemo(() => {
    const totalTasks = props.totalTasks ?? 0;
    const showingCompleted = props.showingCompleted ?? false;
    
    if (totalTasks > 0 && !showingCompleted) {
      return `All ${totalTasks} tasks completed! 🎉`;
    }
    
    return "No tasks loaded";
  });

  const taskCount = createMemo(() => props.tasks.length);

  const itemHeights = createMemo(() => 
    props.tasks.map(task => {
      const indentLevel = indentMap().get(task.id) ?? 0;
      const maxWidth = maxRowWidth();
      const availableContentWidth = Math.max(10, maxWidth - (GUTTER_WIDTH + indentLevel * 2));
      return calculateTaskHeight(task, availableContentWidth, !!props.compactMode);
    })
  );

  createEffect(() => {
    const selectedIndex = props.selectedIndex;
    const count = taskCount();

    if (!scrollboxRef || count === 0) {
      if (scrollboxRef) {
        scrollboxRef.scrollTop = 0;
      }
      return;
    }

    // Jump Scrolling Logic:
    // Instead of scrolling 1-to-1, we implement a significant "jump" when the selection 
    // hits the edges of the visible viewport. 
    const updateScroll = () => {
      if (!scrollboxRef) return;

      const currentTop = scrollboxRef.scrollTop;
      const heights = itemHeights();
      
      // Calculate cumulative offset of selected index
      const selectedOffset = heights.slice(0, selectedIndex).reduce((sum, h) => sum + h, 0);
      const selectedHeight = heights[selectedIndex] || 1;
      
      // Estimated viewport height (Total panel height minus title and borders)
      const viewportHeight = Math.max(5, props.height - 2);
      const bottomThreshold = viewportHeight - selectedHeight;

      if (selectedOffset >= currentTop + bottomThreshold) {
        // Selection hit bottom edge -> jump down
        scrollboxRef.scrollTop = selectedOffset - viewportHeight + selectedHeight;
        scrollboxRef.requestRender();
      } else if (selectedOffset < currentTop) {
        // Selection hit top edge -> jump up
        scrollboxRef.scrollTop = Math.max(0, selectedOffset - 2);
        scrollboxRef.requestRender();
      }
    };

    queueMicrotask(() => updateScroll());
  });

  return (
    <box title="Tasks" width={props.width} flexShrink={0} flexDirection="column" backgroundColor={t().background} border borderColor={t().primary}><scrollbox ref={(el) => { scrollboxRef = el; }} flexGrow={1} width="100%" stickyScroll={false} rootOptions={{ backgroundColor: t().background, }} viewportOptions={{ backgroundColor: t().background, }} verticalScrollbarOptions={{ visible: true, trackOptions: { backgroundColor: t().border, }, }}><Show when={taskCount() > 0} fallback={<box padding={1} flexDirection="column"><text fg={t().success}>{emptyMessage()}</text></box>}><For each={props.tasks}>{(task, index) => (<TaskRow task={task} isSelected={index() === props.selectedIndex} maxWidth={maxRowWidth()} index={index()} indentLevel={indentMap().get(task.id) ?? 0} compactMode={props.compactMode} onSelect={() => props.onSelect?.(index())}/>)}</For></Show></scrollbox></box>
  );
}
