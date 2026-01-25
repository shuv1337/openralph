import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  createTextRenderer,
  getTextRenderer,
  resetTextRenderer,
  detectRenderMode,
  shouldDisableColors,
  colorize,
  TOOL_TEXT_MAP,
  TOOL_UNICODE_MAP,
  STATUS_TEXT_MAP,
  STATUS_UNICODE_MAP,
  TASK_STATUS_TEXT_MAP,
  TASK_STATUS_UNICODE_MAP,
  EVENT_TEXT_MAP,
  EVENT_UNICODE_MAP,
  OUTCOME_TEXT_MAP,
  OUTCOME_UNICODE_MAP,
  ANSI_COLORS,
  type TextRenderMode,
  type RalphStatus,
  type TaskStatus,
  type ActivityEventType,
  type OutcomeType,
  type SessionStats,
} from "../../src/lib/text-renderer";
import { resetCapabilitiesCache } from "../../src/lib/terminal-capabilities";

describe("Text Renderer - Icon Mappings", () => {
  describe("TOOL_TEXT_MAP", () => {
    it("should have all 21+ tool mappings", () => {
      const requiredTools = [
        "read", "write", "edit", "bash", "glob", "grep", "task",
        "todowrite", "todoread", "thought", "lsp", "websearch", "webfetch",
        "codesearch", "mcp", "tavily", "context7", "exa", "gh", "github",
        "brave", "custom"
      ];

      for (const tool of requiredTools) {
        expect(TOOL_TEXT_MAP[tool]).toBeDefined();
      }
    });

    it("should have consistent uppercase format", () => {
      for (const [name, text] of Object.entries(TOOL_TEXT_MAP)) {
        expect(text).toMatch(/^[A-Z0-9\-]+$/);
      }
    });
  });

  describe("TOOL_UNICODE_MAP", () => {
    it("should have matching entries for all ASCII tools", () => {
      for (const toolName of Object.keys(TOOL_TEXT_MAP)) {
        expect(TOOL_UNICODE_MAP[toolName]).toBeDefined();
      }
    });
  });

  describe("STATUS_TEXT_MAP", () => {
    it("should have all status mappings", () => {
      const statuses: RalphStatus[] = [
        "starting", "ready", "running", "selecting", "executing",
        "pausing", "paused", "stopped", "complete", "idle", "error"
      ];

      for (const status of statuses) {
        expect(STATUS_TEXT_MAP[status]).toBeDefined();
        expect(STATUS_TEXT_MAP[status]).toMatch(/^[A-Z]+$/);
      }
    });
  });

  describe("STATUS_UNICODE_MAP", () => {
    it("should have matching entries for all statuses", () => {
      for (const status of Object.keys(STATUS_TEXT_MAP) as RalphStatus[]) {
        expect(STATUS_UNICODE_MAP[status]).toBeDefined();
      }
    });
  });

  describe("TASK_STATUS_TEXT_MAP", () => {
    it("should have all task status mappings", () => {
      const statuses: TaskStatus[] = [
        "done", "active", "actionable", "pending", "blocked", "error", "closed"
      ];

      for (const status of statuses) {
        expect(TASK_STATUS_TEXT_MAP[status]).toBeDefined();
      }
    });
  });

  describe("EVENT_TEXT_MAP", () => {
    it("should have all activity event mappings", () => {
      const events: ActivityEventType[] = [
        "session_start", "session_idle", "task", "file_edit", "file_read",
        "error", "user_message", "assistant_message", "reasoning", "tool_use", "info"
      ];

      for (const event of events) {
        expect(EVENT_TEXT_MAP[event]).toBeDefined();
        expect(EVENT_TEXT_MAP[event]).toMatch(/^[A-Z]+$/);
      }
    });
  });

  describe("OUTCOME_TEXT_MAP", () => {
    it("should have all outcome mappings", () => {
      const outcomes: OutcomeType[] = ["success", "error", "running", "warning"];

      for (const outcome of outcomes) {
        expect(OUTCOME_TEXT_MAP[outcome]).toBeDefined();
      }
    });
  });
});

describe("Text Renderer - ANSI Colors", () => {
  describe("ANSI_COLORS", () => {
    it("should have all required color codes", () => {
      expect(ANSI_COLORS.primary).toBeDefined();
      expect(ANSI_COLORS.secondary).toBeDefined();
      expect(ANSI_COLORS.accent).toBeDefined();
      expect(ANSI_COLORS.success).toBeDefined();
      expect(ANSI_COLORS.warning).toBeDefined();
      expect(ANSI_COLORS.error).toBeDefined();
      expect(ANSI_COLORS.info).toBeDefined();
      expect(ANSI_COLORS.text).toBeDefined();
      expect(ANSI_COLORS.textMuted).toBeDefined();
    });

    it("should have style codes", () => {
      expect(ANSI_COLORS.reset).toBe("\x1b[0m");
      expect(ANSI_COLORS.bold).toBe("\x1b[1m");
      expect(ANSI_COLORS.dim).toBe("\x1b[2m");
    });

    it("should use 256-color format", () => {
      expect(ANSI_COLORS.primary).toMatch(/^\x1b\[38;5;\d+m$/);
      expect(ANSI_COLORS.success).toMatch(/^\x1b\[38;5;\d+m$/);
    });
  });

  describe("colorize", () => {
    it("should return plain text for minimal mode", () => {
      const result = colorize("test", "success", { mode: "minimal" });
      expect(result).toBe("test");
    });

    it("should return plain text for ascii mode", () => {
      const result = colorize("test", "success", { mode: "ascii" });
      expect(result).toBe("test");
    });

    it("should return colored text for full mode", () => {
      const result = colorize("test", "success", { mode: "full", colors: true });
      expect(result).toContain("\x1b[");
      expect(result).toContain("test");
      expect(result).toContain(ANSI_COLORS.reset);
    });

    it("should add bold style when requested", () => {
      const result = colorize("test", "primary", { mode: "full", colors: true, bold: true });
      expect(result).toContain(ANSI_COLORS.bold);
    });

    it("should add dim style when requested", () => {
      const result = colorize("test", "primary", { mode: "full", colors: true, dim: true });
      expect(result).toContain(ANSI_COLORS.dim);
    });
  });
});

describe("Text Renderer - Mode Detection", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetCapabilitiesCache();
    resetTextRenderer();
  });

  afterEach(() => {
    // Restore environment
    process.env = { ...originalEnv };
    resetCapabilitiesCache();
    resetTextRenderer();
  });

  describe("shouldDisableColors", () => {
    it("should return true when NO_COLOR is set", () => {
      process.env.NO_COLOR = "1";
      expect(shouldDisableColors()).toBe(true);
    });

    it("should return true when FORCE_COLOR is 0", () => {
      delete process.env.NO_COLOR;
      process.env.FORCE_COLOR = "0";
      expect(shouldDisableColors()).toBe(true);
    });

    it("should return false when no env vars are set and TTY", () => {
      delete process.env.NO_COLOR;
      delete process.env.FORCE_COLOR;
      // Note: This depends on actual TTY state
      const result = shouldDisableColors();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("detectRenderMode", () => {
    it("should return ascii when NO_COLOR is set", () => {
      process.env.NO_COLOR = "1";
      resetCapabilitiesCache();
      expect(detectRenderMode()).toBe("ascii");
    });
  });
});

describe("Text Renderer - createTextRenderer", () => {
  let renderer: ReturnType<typeof createTextRenderer>;

  beforeEach(() => {
    resetCapabilitiesCache();
    resetTextRenderer();
    renderer = createTextRenderer({ mode: "ascii", colors: false });
  });

  afterEach(() => {
    resetCapabilitiesCache();
    resetTextRenderer();
  });

  describe("renderToolIcon", () => {
    it("should return ASCII text for known tools", () => {
      expect(renderer.renderToolIcon("read")).toBe("READ");
      expect(renderer.renderToolIcon("bash")).toBe("BASH");
      expect(renderer.renderToolIcon("thought")).toBe("USER");
    });

    it("should be case-insensitive", () => {
      expect(renderer.renderToolIcon("READ")).toBe("READ");
      expect(renderer.renderToolIcon("Bash")).toBe("BASH");
    });

    it("should return uppercase fallback for unknown tools", () => {
      expect(renderer.renderToolIcon("myCustomTool")).toBe("MYCUSTOMTOOL");
    });

    it("should handle MCP tool patterns", () => {
      expect(renderer.renderToolIcon("tavily_search")).toBe("TAVILY");
      expect(renderer.renderToolIcon("context7_query")).toBe("C7");
    });
  });

  describe("renderStatus", () => {
    it("should return ASCII status indicators", () => {
      expect(renderer.renderStatus("ready")).toBe("READY");
      expect(renderer.renderStatus("running")).toBe("RUN");
      expect(renderer.renderStatus("paused")).toBe("PAUSED");
      expect(renderer.renderStatus("complete")).toBe("DONE");
      expect(renderer.renderStatus("error")).toBe("ERROR");
    });
  });

  describe("renderTaskStatus", () => {
    it("should return ASCII task status indicators", () => {
      expect(renderer.renderTaskStatus("done")).toBe("X");
      expect(renderer.renderTaskStatus("active")).toBe(">");
      expect(renderer.renderTaskStatus("pending")).toBe(" ");
      expect(renderer.renderTaskStatus("blocked")).toBe("-");
      expect(renderer.renderTaskStatus("error")).toBe("!");
    });
  });

  describe("renderEvent", () => {
    it("should return ASCII event indicators", () => {
      expect(renderer.renderEvent("session_start")).toBe("START");
      expect(renderer.renderEvent("reasoning")).toBe("USER");
      expect(renderer.renderEvent("error")).toBe("ERROR");
      expect(renderer.renderEvent("user_message")).toBe("USER");
    });
  });

  describe("renderOutcome", () => {
    it("should return ASCII outcome indicators", () => {
      expect(renderer.renderOutcome("success")).toBe("OK");
      expect(renderer.renderOutcome("error")).toBe("ERR");
      expect(renderer.renderOutcome("running")).toBe("...");
      expect(renderer.renderOutcome("warning")).toBe("WARN");
    });
  });

  describe("renderSeparator", () => {
    it("should return separator line without text", () => {
      const sep = renderer.renderSeparator();
      expect(sep.length).toBeGreaterThan(0);
      expect(sep).toMatch(/^-+$/);
    });

    it("should include text in separator", () => {
      const sep = renderer.renderSeparator("Iteration 1");
      expect(sep).toContain("Iteration 1");
      expect(sep).toContain("-");
    });
  });

  describe("renderProgress", () => {
    it("should show progress bar", () => {
      const progress = renderer.renderProgress(3, 10);
      expect(progress).toContain("3/10");
      expect(progress).toContain("[");
      expect(progress).toContain("]");
      expect(progress).toContain("30%");
    });

    it("should handle 0 total", () => {
      const progress = renderer.renderProgress(0, 0);
      expect(progress).toContain("0/0");
      expect(progress).toContain("0%");
    });

    it("should handle 100%", () => {
      const progress = renderer.renderProgress(10, 10);
      expect(progress).toContain("10/10");
      expect(progress).toContain("100%");
    });
  });

  describe("renderHeader", () => {
    it("should include title", () => {
      const header = renderer.renderHeader("RALPH - AI Coding Agent");
      expect(header).toContain("RALPH - AI Coding Agent");
    });

    it("should include metadata", () => {
      const header = renderer.renderHeader("Title", {
        Model: "claude-opus-4",
        Plan: "plan.md"
      });
      expect(header).toContain("Model:");
      expect(header).toContain("claude-opus-4");
      expect(header).toContain("Plan:");
      expect(header).toContain("plan.md");
    });

    it("should have border lines", () => {
      const header = renderer.renderHeader("Title");
      const lines = header.split("\n");
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(lines[0]).toMatch(/^=+$/);
    });
  });

  describe("renderFooter", () => {
    it("should include all stats", () => {
      const stats: SessionStats = {
        iterations: 3,
        commits: 2,
        linesAdded: 142,
        linesRemoved: 38,
        tasksComplete: 5,
        totalTasks: 10,
        durationMs: 154000,
        exitCode: 0
      };

      const footer = renderer.renderFooter(stats);
      expect(footer).toContain("Summary");
      expect(footer).toContain("Iterations: 3");
      expect(footer).toContain("Commits:    2");
      expect(footer).toContain("+142");
      expect(footer).toContain("-38");
      expect(footer).toContain("5/10 complete");
      expect(footer).toContain("2m 34s");
      expect(footer).toContain("DONE");
      expect(footer).toContain("exit code: 0");
    });

    it("should show FAILED for non-zero exit code", () => {
      const stats: SessionStats = {
        iterations: 1,
        commits: 0,
        linesAdded: 0,
        linesRemoved: 0,
        tasksComplete: 0,
        totalTasks: 5,
        durationMs: 1000,
        exitCode: 1
      };

      const footer = renderer.renderFooter(stats);
      expect(footer).toContain("FAILED");
      expect(footer).toContain("exit code: 1");
    });
  });

  describe("renderLogEntry", () => {
    it("should format log entry with level", () => {
      const entry = {
        level: "info",
        message: "Test message"
      };

      const log = renderer.renderLogEntry(entry);
      expect(log).toContain("[INFO]");
      expect(log).toContain("Test message");
    });

    it("should include timestamp when provided", () => {
      const entry = {
        timestamp: Date.now(),
        level: "error",
        message: "Error occurred"
      };

      const log = renderer.renderLogEntry(entry);
      expect(log).toContain("[ERROR]");
      expect(log).toContain("Error occurred");
      expect(log).toMatch(/\d{4}-\d{2}-\d{2}T/); // ISO date format
    });

    it("should include iteration number when provided", () => {
      const entry = {
        level: "info",
        message: "Iteration work",
        iteration: 3
      };

      const log = renderer.renderLogEntry(entry);
      expect(log).toContain("#3");
    });
  });

  describe("getMode", () => {
    it("should return the configured mode", () => {
      expect(renderer.getMode()).toBe("ascii");
    });

    it("should return full mode when configured", () => {
      const fullRenderer = createTextRenderer({ mode: "full" });
      expect(fullRenderer.getMode()).toBe("full");
    });

    it("should return minimal mode when configured", () => {
      const minRenderer = createTextRenderer({ mode: "minimal" });
      expect(minRenderer.getMode()).toBe("minimal");
    });
  });
});

describe("Text Renderer - Unicode Mode", () => {
  let renderer: ReturnType<typeof createTextRenderer>;

  beforeEach(() => {
    renderer = createTextRenderer({ mode: "unicode", colors: false });
  });

  describe("renderToolIcon", () => {
    it("should return Unicode symbols for known tools", () => {
      expect(renderer.renderToolIcon("read")).toBe("◀");
      expect(renderer.renderToolIcon("bash")).toBe("$");
      expect(renderer.renderToolIcon("thought")).toBe("◈");
    });
  });

  describe("renderStatus", () => {
    it("should return Unicode status symbols", () => {
      expect(renderer.renderStatus("complete")).toBe("✓");
      expect(renderer.renderStatus("error")).toBe("✗");
      expect(renderer.renderStatus("running")).toBe("▶");
    });
  });

  describe("renderTaskStatus", () => {
    it("should return Unicode task status symbols", () => {
      expect(renderer.renderTaskStatus("done")).toBe("✓");
      expect(renderer.renderTaskStatus("active")).toBe("▶");
      expect(renderer.renderTaskStatus("pending")).toBe("○");
    });
  });
});

describe("Text Renderer - Minimal Mode", () => {
  let renderer: ReturnType<typeof createTextRenderer>;

  beforeEach(() => {
    renderer = createTextRenderer({ mode: "minimal" });
  });

  describe("renderSeparator", () => {
    it("should return simplified separator", () => {
      const sep = renderer.renderSeparator("Iteration 1");
      expect(sep).toBe("--- Iteration 1 ---");
    });

    it("should return minimal separator without text", () => {
      const sep = renderer.renderSeparator();
      expect(sep).toBe("---");
    });
  });

  describe("renderProgress", () => {
    it("should return compact progress format", () => {
      const progress = renderer.renderProgress(3, 10);
      expect(progress).toBe("3/10 (30%)");
    });
  });
});

describe("Text Renderer - Default Renderer", () => {
  beforeEach(() => {
    resetCapabilitiesCache();
    resetTextRenderer();
  });

  afterEach(() => {
    resetCapabilitiesCache();
    resetTextRenderer();
  });

  it("should create default renderer on first access", () => {
    const renderer = getTextRenderer();
    expect(renderer).toBeDefined();
    expect(typeof renderer.renderToolIcon).toBe("function");
  });

  it("should return same instance on subsequent calls", () => {
    const renderer1 = getTextRenderer();
    const renderer2 = getTextRenderer();
    expect(renderer1).toBe(renderer2);
  });

  it("should reset correctly", () => {
    const renderer1 = getTextRenderer();
    resetTextRenderer();
    const renderer2 = getTextRenderer();
    expect(renderer1).not.toBe(renderer2);
  });
});

describe("Text Renderer - Custom ASCII Symbols", () => {
  it("should use custom symbols when provided", () => {
    const renderer = createTextRenderer({
      mode: "ascii",
      colors: false,
      asciiSymbols: {
        progressFill: "#",
        progressEmpty: "_",
        progressOpen: "(",
        progressClose: ")",
      }
    });

    const progress = renderer.renderProgress(5, 10);
    expect(progress).toContain("(");
    expect(progress).toContain(")");
    expect(progress).toContain("#");
    expect(progress).toContain("_");
  });
});

describe("Text Renderer - Duration Formatting", () => {
  it("should format milliseconds correctly", () => {
    const renderer = createTextRenderer({ mode: "ascii", colors: false });
    
    // Test various durations through footer
    const msStats: SessionStats = {
      iterations: 1, commits: 0, linesAdded: 0, linesRemoved: 0,
      tasksComplete: 0, totalTasks: 0, durationMs: 500, exitCode: 0
    };
    expect(renderer.renderFooter(msStats)).toContain("500ms");

    const secondsStats: SessionStats = {
      iterations: 1, commits: 0, linesAdded: 0, linesRemoved: 0,
      tasksComplete: 0, totalTasks: 0, durationMs: 45000, exitCode: 0
    };
    expect(renderer.renderFooter(secondsStats)).toContain("45s");

    const minutesStats: SessionStats = {
      iterations: 1, commits: 0, linesAdded: 0, linesRemoved: 0,
      tasksComplete: 0, totalTasks: 0, durationMs: 180000, exitCode: 0
    };
    expect(renderer.renderFooter(minutesStats)).toContain("3m");

    const hoursStats: SessionStats = {
      iterations: 1, commits: 0, linesAdded: 0, linesRemoved: 0,
      tasksComplete: 0, totalTasks: 0, durationMs: 7260000, exitCode: 0
    };
    expect(renderer.renderFooter(hoursStats)).toContain("2h 1m");
  });
});
