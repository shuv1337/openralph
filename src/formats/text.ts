import type { HeadlessEvent, HeadlessFormatter, HeadlessSummary } from "../headless/types";
import {
  createTextRenderer,
  type TextRenderer,
  type TextRenderMode,
  detectRenderMode,
  colorize,
  type SessionStats,
} from "../lib/text-renderer";

/**
 * Options for creating a text formatter.
 */
export type TextFormatterOptions = {
  timestamps: boolean;
  write?: (text: string) => void;
  /** Optional pre-configured text renderer */
  textRenderer?: TextRenderer;
};

/**
 * Tool name to color mapping for semantic highlighting.
 * Each major tool has a DISTINCT color for easy visual identification.
 * 
 * Color palette:
 * - read: teal (file reading)
 * - write: lime (file creation)
 * - edit: gold (file modification)
 * - bash: coral (command execution)
 * - glob: yellow (file finding)
 * - grep: magenta (content searching)
 * - task/todo: violet (task management)
 * - thought: warning/orange (reasoning)
 * - lsp: textMuted (background tool)
 * - web tools: sky (external resources)
 * - github: secondary/purple (version control)
 * - mcp: primary/blue (plugins)
 */
const TOOL_COLORS: Record<string, "info" | "success" | "warning" | "error" | "primary" | "secondary" | "textMuted" | "yellow" | "magenta" | "teal" | "lime" | "coral" | "sky" | "violet" | "gold"> = {
  // File operations - each distinct
  read: "teal",        // Teal - reading files
  write: "lime",       // Lime green - creating files
  edit: "gold",        // Gold - modifying files
  
  // Execution - stands out
  bash: "coral",       // Coral/salmon - command execution
  
  // Search operations - distinct from each other
  glob: "yellow",      // Yellow - finding files by pattern
  grep: "magenta",     // Magenta - searching content
  codesearch: "violet", // Violet - code-specific search
  
  // Task management - grouped
  task: "violet",
  todowrite: "violet",
  todoread: "violet",
  
  // Thinking/reasoning
  thought: "warning",  // Orange - thinking/reasoning
  
  // Code intelligence
  lsp: "textMuted",    // Gray - background tool
  
  // Web/external resources - grouped by purpose
  websearch: "sky",    // Sky blue - web search
  webfetch: "sky",     // Sky blue - web fetch
  tavily: "info",      // Cyan - Tavily search
  context7: "info",    // Cyan - Context7 docs
  exa: "info",         // Cyan - Exa search
  brave: "sky",        // Sky blue - Brave search
  
  // Version control
  gh: "secondary",     // Purple - GitHub
  github: "secondary", // Purple - GitHub
  
  // Plugin/MCP tools
  mcp: "primary",      // Blue - MCP plugins
  skill: "primary",    // Blue - Skills
  
  // Status indicators
  error: "error",
  success: "success",
  running: "primary",
  custom: "textMuted",
};

/**
 * Format timestamp as ISO string.
 */
const formatTimestamp = (timestamp: number): string => {
  return new Date(timestamp).toISOString();
};

/**
 * Human-readable display names for tools.
 * Maps internal tool identifiers to user-friendly names.
 */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  bash: "Bash",
  glob: "Glob",
  grep: "Grep",
  task: "Task",
  todowrite: "TodoWrite",
  todoread: "TodoRead",
  thought: "Thinking",
  lsp: "LSP",
  websearch: "Web Search",
  webfetch: "Web Fetch",
  codesearch: "Code Search",
  mcp: "MCP Tool",
  tavily: "Tavily",
  context7: "Context7",
  exa: "Exa",
  gh: "GitHub",
  github: "GitHub",
  brave: "Brave",
  skill: "Skill",
  custom: "Tool",
};

/**
 * Format a tool name for human-readable display.
 * 
 * @param toolName - Internal tool identifier (e.g., "read", "tavily_search")
 * @returns Human-readable display name (e.g., "Read", "Tavily Search")
 */
function formatToolDisplayName(toolName: string): string {
  const normalized = toolName.toLowerCase();
  
  // Check for MCP tool pattern (server_tool format like "tavily_search")
  const mcpMatch = normalized.match(/^(\w+)_(\w+)$/);
  if (mcpMatch) {
    const [, serverName, actionName] = mcpMatch;
    // Get server display name or capitalize first letter
    const serverDisplay = TOOL_DISPLAY_NAMES[serverName] ?? 
      serverName.charAt(0).toUpperCase() + serverName.slice(1);
    // Capitalize action name and replace underscores with spaces
    const actionDisplay = actionName
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return `${serverDisplay} ${actionDisplay}`;
  }
  
  // Direct lookup or capitalize first letter
  return TOOL_DISPLAY_NAMES[normalized] ?? 
    toolName.charAt(0).toUpperCase() + toolName.slice(1);
}

/**
 * Create a text formatter for headless output.
 * 
 * Uses the text renderer from lib/text-renderer.ts for consistent formatting
 * across all text-based output modes.
 * 
 * @param options - Formatter configuration
 * @returns HeadlessFormatter implementation
 */
export function createTextFormatter(options: TextFormatterOptions): HeadlessFormatter {
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  
  // Use provided text renderer or create a new one
  const renderer = options.textRenderer ?? createTextRenderer();
  const mode = renderer.getMode();

  // Track state to suppress repetitive emissions
  // Model is only emitted once (at start or on change)
  let lastModel: string | undefined;
  // Token stats are accumulated and shown only in the footer
  let accumulatedTokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  // Deduplicate error messages within a short window
  let lastErrorMessage: string | undefined;
  let lastErrorTime = 0;
  const ERROR_DEDUP_WINDOW_MS = 1000; // 1 second window for deduplication

  const lineWithTimestamp = (event: HeadlessEvent, line: string): string => {
    if (!options.timestamps || !event.timestamp) {
      return line;
    }
    return `[${formatTimestamp(event.timestamp)}] ${line}`;
  };

  const emit = (event: HeadlessEvent): void => {
    let line = "";
    const margin = renderer.getMargin();
    
    // Helper to apply margin to multi-line strings
    const withMargin = (text: string) => {
      if (!text) return "";
      return text.split("\n")
        .map(l => l.length > 0 ? margin + l : l)
        .join("\n");
    };

    switch (event.type) {
      case "start":
        // Skip renderer.renderHeader as the ASCII banner is already shown by the runner
        return;
        
      case "iteration_start":
        line = "\n" + renderer.renderSeparator(`Iteration ${event.iteration}`);
        break;
        
      case "iteration_end":
        line = colorize("|", "success", { mode }) + " " + colorize("FINISH  ", "text", { dim: true, mode }) +
          colorize(`Iteration ${event.iteration} complete`, "success", { mode }) + 
          colorize(` | ${event.durationMs}ms | ${event.commits} commit${event.commits !== 1 ? "s" : ""}`, "text", { dim: true, mode });
        break;
        
      case "tool": {
        const colorKey = TOOL_COLORS[event.name.toLowerCase()] ?? "textMuted";
        const coloredBar = colorize("|", colorKey, { mode });
        
        // Human-readable tool name - dimmed and padded to align with opencode style
        const toolDisplayName = formatToolDisplayName(event.name);
        const dimmedToolName = colorize(toolDisplayName.padEnd(8, " "), "text", { dim: true, mode });
        
        const detail = event.detail 
          ? ` ${colorize(event.detail, "textMuted", { dim: true, mode })}` 
          : "";
        
        // Format: | ToolName Title detail (aligns with opencode style)
        const title = event.title || "";
        line = title 
          ? `${coloredBar} ${dimmedToolName} ${colorize(title, "text", { mode })}${detail}`
          : `${coloredBar} ${dimmedToolName}${detail}`;
        break;
      }
        
      case "reasoning": {
        const coloredBar = colorize("|", "warning", { mode });
        const dimmedToolName = colorize("User    ".padEnd(8, " "), "text", { dim: true, mode });
        line = `${coloredBar} ${dimmedToolName} ${colorize(event.text, "text", { dim: true, mode })}`;
        break;
      }
        
      case "output":
        // Raw output, write directly without processing
        write(event.data);
        return;
        
      case "progress":
        line = colorize("|", "info", { mode }) + " " + colorize("STEP    ", "text", { dim: true, mode }) + renderer.renderProgress(event.done, event.total);
        break;
        
      case "stats":
        line = colorize("|", "info", { mode }) + " " + colorize("STATS   ", "text", { dim: true, mode }) + 
          colorize(`${event.commits} commit${event.commits !== 1 ? "s" : ""}`, "text", { mode }) +
          colorize(` +${event.linesAdded}`, "success", { mode }) +
          colorize(` -${event.linesRemoved}`, "error", { mode });
        break;
        
      case "pause":
        line = colorize("|", "warning", { mode }) + " " + colorize("PAUSED  ", "text", { dim: true, mode });
        break;
        
      case "resume":
        line = colorize("|", "success", { mode }) + " " + colorize("RUNNING ", "text", { dim: true, mode });
        break;
        
      case "idle":
        line = event.isIdle 
          ? colorize("|", "warning", { mode }) + " " + colorize("IDLE    ", "text", { dim: true, mode }) + colorize("Waiting for input...", "text", { dim: true, mode })
          : colorize("|", "info", { mode }) + " " + colorize("BUSY    ", "text", { dim: true, mode }) + colorize("Processing...", "text", { dim: true, mode });
        break;
        
      case "error":
        // Deduplicate identical errors within a short window
        const now = Date.now();
        if (event.message === lastErrorMessage && (now - lastErrorTime) < ERROR_DEDUP_WINDOW_MS) {
          return; // Suppress duplicate error
        }
        lastErrorMessage = event.message;
        lastErrorTime = now;
        line = colorize("|", "error", { mode }) + " " + colorize("ERROR   ", "text", { dim: true, mode }) + colorize(event.message, "error", { mode });
        break;
        
      case "complete":
        // Complete event marks completion; actual summary in finalize
        line = colorize("|", "success", { mode }) + " " + colorize("DONE    ", "text", { dim: true, mode }) + colorize("Task completed successfully", "success", { bold: true, mode });
        break;
        
      case "model":
        // Only emit model info when it changes, not on every occurrence
        if (event.model !== lastModel) {
          lastModel = event.model;
          // Model uses cyan (info) for the value, bold dim for the label
          const modelLabel = colorize("Model:", "text", { bold: true, dim: true, mode });
          const modelValue = colorize(event.model, "info", { mode });
          line = `${modelLabel} ${modelValue}`;
        } else {
          // Suppress duplicate model emissions
          return;
        }
        break;
        
      case "sandbox":
        // Sandbox uses yellow for values, bold dim for labels
        const sandboxLabel = colorize("sandbox:", "text", { bold: true, dim: true, mode });
        const sandboxEnabled = colorize(
          event.enabled ? "enabled" : "disabled",
          event.enabled ? "success" : "textMuted",
          { mode }
        );
        const sandboxMode = colorize(event.mode ?? "unknown", "yellow", { mode });
        line = `${sandboxLabel} ${sandboxEnabled} mode=${sandboxMode}`;
        break;
        
      case "rate_limit":
        // Rate limit uses warning color, bold dim for labels
        const rateLimitLabel = colorize("rate_limit:", "text", { bold: true, dim: true, mode });
        const fallbackValue = colorize(event.fallbackAgent, "warning", { mode });
        line = `${rateLimitLabel} fallback=${fallbackValue}`;
        break;
        
      case "active_agent":
        // Agent uses green for the value, bold dim for labels
        const agentLabel = colorize("agent:", "text", { bold: true, dim: true, mode });
        const agentPlugin = colorize(event.plugin, "success", { mode });
        const agentReason = colorize(`(${event.reason})`, "textMuted", { dim: true, mode });
        line = `${agentLabel} ${agentPlugin} ${agentReason}`;
        break;
        
      case "tokens":
        // Accumulate token usage for the footer summary instead of spamming per-line
        // This reduces visual noise while still tracking total usage
        accumulatedTokens.input += event.input;
        accumulatedTokens.output += event.output;
        accumulatedTokens.reasoning += event.reasoning;
        accumulatedTokens.cacheRead += event.cacheRead ?? 0;
        accumulatedTokens.cacheWrite += event.cacheWrite ?? 0;
        // Suppress per-line token output - will be shown in footer
        return;
        
      case "backoff":
        line = colorize(
          `backoff: ${event.backoffMs}ms, retry at ${new Date(event.retryAt).toISOString()}`,
          "warning",
          { mode }
        );
        break;
        
      case "backoff_cleared":
        line = colorize("backoff cleared, retrying...", "info", { mode });
        break;
        
      case "session":
        // Session uses secondary (purple) for the session ID, bold dim for labels
        const sessionLabel = colorize(`session ${event.action}:`, "text", { bold: true, dim: true, mode });
        const sessionId = colorize(event.sessionId, "secondary", { mode });
        line = `${sessionLabel} ${sessionId}`;
        break;
        
      case "prompt":
        // Prompt events are typically verbose/debug
        line = colorize("[PROMPT] " + event.prompt.substring(0, 100) + "...", "textMuted", { dim: true, mode });
        break;
        
      case "plan_modified": {
        const coloredBar = colorize("|", "violet", { mode });
        const dimmedToolName = colorize("Plan".padEnd(8, " "), "text", { dim: true, mode });
        line = `${coloredBar} ${dimmedToolName} ${colorize("modified", "text", { mode })}`;
        break;
      }
        
      case "adapter_mode":
        // Adapter mode uses magenta for the value, bold dim for labels
        const adapterLabel = colorize("adapter mode:", "text", { bold: true, dim: true, mode });
        const adapterValue = colorize(event.mode, "magenta", { mode });
        line = `${adapterLabel} ${adapterValue}`;
        break;
        
      default:
        // Unknown event type - skip
        return;
    }

    if (!line) return;

    write(withMargin(lineWithTimestamp(event, line)) + "\n");
  };

  const finalize = (summary: HeadlessSummary): void => {
    const margin = renderer.getMargin();
    const withMargin = (text: string) => {
      if (!text) return "";
      return text.split("\n")
        .map(l => l.length > 0 ? margin + l : l)
        .join("\n");
    };
    
    // Convert HeadlessSummary to SessionStats format
    const stats: SessionStats = {
      iterations: 0, // Not tracked in summary
      commits: summary.commits,
      linesAdded: summary.linesAdded,
      linesRemoved: summary.linesRemoved,
      tasksComplete: summary.tasksComplete,
      totalTasks: summary.totalTasks,
      durationMs: summary.durationMs,
      exitCode: summary.exitCode,
    };
    
    const footer = renderer.renderFooter(stats);
    write(withMargin(footer) + "\n");
    
    // Display accumulated token usage in the footer (consolidated, not per-line)
    const hasTokens = accumulatedTokens.input > 0 || accumulatedTokens.output > 0;
    if (hasTokens) {
      const tokenLine = colorize(
        `Tokens: in=${accumulatedTokens.input} out=${accumulatedTokens.output} reasoning=${accumulatedTokens.reasoning}`,
        "textMuted",
        { mode }
      );
      write(withMargin(tokenLine) + "\n");
    }
    
    // Display model info if captured (shown once in footer, not per-line)
    if (lastModel) {
      const modelLine = colorize(`Model: ${lastModel}`, "textMuted", { mode });
      write(withMargin(modelLine) + "\n");
    }
  };

  return { emit, finalize };
}

// Re-export TextRenderMode for backward compatibility
export type { TextRenderMode };
