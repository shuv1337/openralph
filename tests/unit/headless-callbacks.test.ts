import { describe, it, expect, beforeEach } from "bun:test";
import {
  createHeadlessCallbacks,
  createInitialStats,
  wrapCallbacks,
  isToolEvent,
} from "../../src/headless/callbacks";
import type {
  HeadlessEvent,
  HeadlessFormatter,
  HeadlessStats,
  TokenUsage,
  SessionInfo,
  SandboxConfig,
  RateLimitState,
  ActiveAgentState,
} from "../../src/headless/types";

/**
 * Create a mock formatter that captures emitted events.
 */
function createMockFormatter(): {
  formatter: HeadlessFormatter;
  events: HeadlessEvent[];
  finalized: boolean;
} {
  const events: HeadlessEvent[] = [];
  let finalized = false;

  const formatter: HeadlessFormatter = {
    emit: (event: HeadlessEvent) => {
      events.push(event);
    },
    finalize: () => {
      finalized = true;
    },
  };

  return { formatter, events, get finalized() { return finalized; } };
}

describe("createHeadlessCallbacks", () => {
  let mock: ReturnType<typeof createMockFormatter>;
  let stats: HeadlessStats;

  beforeEach(() => {
    mock = createMockFormatter();
    stats = createInitialStats(1000);
  });

  // ===========================================================================
  // Core Iteration Callbacks
  // ===========================================================================

  describe("onIterationStart", () => {
    it("emits iteration_start event", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onIterationStart(1);

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({ type: "iteration_start", iteration: 1 });
    });

    it("updates stats.iterations", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onIterationStart(5);

      expect(stats.iterations).toBe(5);
    });
  });

  describe("onEvent", () => {
    it("emits tool event for tool type", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onEvent({
        type: "tool",
        iteration: 1,
        icon: "file",
        text: "Reading config.json",
        detail: "/path/to/config.json",
      });

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({
        type: "tool",
        iteration: 1,
        name: "file",
        title: "Reading config.json",
        detail: "/path/to/config.json",
      });
    });

    it("emits reasoning event for reasoning type", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onEvent({
        type: "reasoning",
        iteration: 2,
        text: "Analyzing the codebase structure...",
      });

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({
        type: "reasoning",
        iteration: 2,
        text: "Analyzing the codebase structure...",
      });
    });

    it("filters out spinner events", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onEvent({
        type: "spinner",
        iteration: 1,
        text: "Loading...",
      });

      expect(mock.events).toHaveLength(0);
    });

    it("filters out separator events", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onEvent({
        type: "separator",
        iteration: 1,
        text: "---",
      });

      expect(mock.events).toHaveLength(0);
    });

    it("uses 'tool' as default name when icon is missing", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onEvent({
        type: "tool",
        iteration: 1,
        text: "Executing command",
      });

      expect(mock.events[0]).toMatchObject({
        type: "tool",
        name: "tool",
      });
    });
  });

  describe("onIterationComplete", () => {
    it("emits iteration_end event", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onIterationComplete(3, 5000, 2);

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({
        type: "iteration_end",
        iteration: 3,
        durationMs: 5000,
        commits: 2,
      });
    });
  });

  // ===========================================================================
  // Progress Callbacks
  // ===========================================================================

  describe("onTasksUpdated", () => {
    it("emits progress event", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onTasksUpdated(5, 10);

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({ type: "progress", done: 5, total: 10 });
    });

    it("updates stats", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onTasksUpdated(3, 7);

      expect(stats.tasksComplete).toBe(3);
      expect(stats.totalTasks).toBe(7);
    });
  });

  describe("onCommitsUpdated", () => {
    it("emits stats event", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onCommitsUpdated(3);

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toMatchObject({
        type: "stats",
        commits: 3,
      });
    });

    it("updates stats.commits", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onCommitsUpdated(5);

      expect(stats.commits).toBe(5);
    });
  });

  describe("onDiffUpdated", () => {
    it("emits stats event", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onDiffUpdated(100, 50);

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toMatchObject({
        type: "stats",
        linesAdded: 100,
        linesRemoved: 50,
      });
    });

    it("updates stats.linesAdded and stats.linesRemoved", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onDiffUpdated(200, 75);

      expect(stats.linesAdded).toBe(200);
      expect(stats.linesRemoved).toBe(75);
    });
  });

  // ===========================================================================
  // State Callbacks
  // ===========================================================================

  describe("onPause", () => {
    it("emits pause event", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onPause();

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({ type: "pause" });
    });
  });

  describe("onResume", () => {
    it("emits resume event", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onResume();

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({ type: "resume" });
    });
  });

  describe("onIdleChanged", () => {
    it("emits idle event with isIdle=true", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onIdleChanged(true);

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({ type: "idle", isIdle: true });
    });

    it("emits idle event with isIdle=false", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onIdleChanged(false);

      expect(mock.events[0]).toEqual({ type: "idle", isIdle: false });
    });
  });

  describe("onComplete", () => {
    it("emits complete event", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onComplete();

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({ type: "complete" });
    });
  });

  describe("onError", () => {
    it("emits error event", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onError("Connection failed");

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({
        type: "error",
        message: "Connection failed",
      });
    });
  });

  // ===========================================================================
  // Raw Output Callback
  // ===========================================================================

  describe("onRawOutput", () => {
    it("emits output event", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onRawOutput!("Hello, world!");

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({
        type: "output",
        data: "Hello, world!",
      });
    });
  });

  // ===========================================================================
  // Session Callbacks
  // ===========================================================================

  describe("onSessionCreated", () => {
    it("emits session created event", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      const session: SessionInfo = {
        sessionId: "sess-123",
        serverUrl: "http://localhost:8080",
        attached: true,
        sendMessage: async () => {},
      };

      callbacks.onSessionCreated!(session);

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({
        type: "session",
        action: "created",
        sessionId: "sess-123",
        serverUrl: "http://localhost:8080",
      });
    });
  });

  describe("onSessionEnded", () => {
    it("emits session ended event", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onSessionEnded!("sess-456");

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({
        type: "session",
        action: "ended",
        sessionId: "sess-456",
      });
    });
  });

  // ===========================================================================
  // Rate Limiting / Backoff Callbacks
  // ===========================================================================

  describe("onBackoff", () => {
    it("emits backoff event", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      const retryAt = Date.now() + 5000;
      callbacks.onBackoff!(5000, retryAt);

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({
        type: "backoff",
        backoffMs: 5000,
        retryAt,
      });
    });
  });

  describe("onBackoffCleared", () => {
    it("emits backoff_cleared event", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onBackoffCleared!();

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({ type: "backoff_cleared" });
    });
  });

  // ===========================================================================
  // Token & Model Callbacks
  // ===========================================================================

  describe("onTokens", () => {
    it("emits tokens event", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      const tokens: TokenUsage = {
        input: 1000,
        output: 500,
        reasoning: 200,
        cacheRead: 100,
        cacheWrite: 50,
      };

      callbacks.onTokens!(tokens);

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({
        type: "tokens",
        input: 1000,
        output: 500,
        reasoning: 200,
        cacheRead: 100,
        cacheWrite: 50,
      });
    });
  });

  describe("onModel", () => {
    it("emits model event", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onModel!("claude-3-opus-20240229");

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({
        type: "model",
        model: "claude-3-opus-20240229",
      });
    });
  });

  describe("onSandbox", () => {
    it("emits sandbox event with enabled sandbox", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      const sandbox: SandboxConfig = {
        enabled: true,
        mode: "docker",
        network: false,
      };

      callbacks.onSandbox!(sandbox);

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({
        type: "sandbox",
        enabled: true,
        mode: "docker",
        network: false,
      });
    });

    it("defaults enabled to false when undefined", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onSandbox!({});

      expect(mock.events[0]).toMatchObject({
        type: "sandbox",
        enabled: false,
      });
    });
  });

  describe("onRateLimit", () => {
    it("emits rate_limit event", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      const state: RateLimitState = {
        limitedAt: Date.now(),
        primaryAgent: "claude-3-opus",
        fallbackAgent: "claude-3-sonnet",
      };

      callbacks.onRateLimit!(state);

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({
        type: "rate_limit",
        primaryAgent: "claude-3-opus",
        fallbackAgent: "claude-3-sonnet",
      });
    });

    it("defaults fallbackAgent to 'unknown' when undefined", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onRateLimit!({ primaryAgent: "claude" });

      expect(mock.events[0]).toMatchObject({
        type: "rate_limit",
        fallbackAgent: "unknown",
      });
    });
  });

  describe("onActiveAgent", () => {
    it("emits active_agent event", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      const state: ActiveAgentState = {
        plugin: "anthropic",
        reason: "fallback",
      };

      callbacks.onActiveAgent!(state);

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({
        type: "active_agent",
        plugin: "anthropic",
        reason: "fallback",
      });
    });

    it("defaults reason to 'primary' when undefined", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onActiveAgent!({ plugin: "openai" });

      expect(mock.events[0]).toMatchObject({
        type: "active_agent",
        reason: "primary",
      });
    });
  });

  // ===========================================================================
  // Prompt & Plan Callbacks
  // ===========================================================================

  describe("onPrompt", () => {
    it("emits prompt event", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onPrompt!("You are a helpful coding assistant...");

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({
        type: "prompt",
        prompt: "You are a helpful coding assistant...",
      });
    });
  });

  describe("onPlanFileModified", () => {
    it("emits plan_modified event", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onPlanFileModified!();

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({ type: "plan_modified" });
    });
  });

  // ===========================================================================
  // Mode Callbacks
  // ===========================================================================

  describe("onAdapterModeChanged", () => {
    it("emits adapter_mode event for sdk", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onAdapterModeChanged!("sdk");

      expect(mock.events).toHaveLength(1);
      expect(mock.events[0]).toEqual({
        type: "adapter_mode",
        mode: "sdk",
      });
    });

    it("emits adapter_mode event for pty", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onAdapterModeChanged!("pty");

      expect(mock.events[0]).toEqual({
        type: "adapter_mode",
        mode: "pty",
      });
    });
  });

  // ===========================================================================
  // Timestamp Handling
  // ===========================================================================

  describe("timestamp handling", () => {
    it("includes timestamps when enabled", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: true,
      });

      const before = Date.now();
      callbacks.onIterationStart(1);
      const after = Date.now();

      expect(mock.events[0]).toHaveProperty("timestamp");
      const ts = (mock.events[0] as { timestamp?: number }).timestamp!;
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it("omits timestamps when disabled", () => {
      const callbacks = createHeadlessCallbacks({
        formatter: mock.formatter,
        stats,
        timestamps: false,
      });

      callbacks.onIterationStart(1);

      expect(mock.events[0]).not.toHaveProperty("timestamp");
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe("error handling", () => {
    it("continues even if formatter throws", () => {
      const errorFormatter: HeadlessFormatter = {
        emit: () => {
          throw new Error("Formatter error");
        },
        finalize: () => {},
      };

      const callbacks = createHeadlessCallbacks({
        formatter: errorFormatter,
        stats,
        timestamps: false,
      });

      // Should not throw
      expect(() => callbacks.onIterationStart(1)).not.toThrow();
    });
  });
});

// =============================================================================
// createInitialStats
// =============================================================================

describe("createInitialStats", () => {
  it("creates stats with default start time", () => {
    const before = Date.now();
    const stats = createInitialStats();
    const after = Date.now();

    expect(stats.startTime).toBeGreaterThanOrEqual(before);
    expect(stats.startTime).toBeLessThanOrEqual(after);
    expect(stats.tasksComplete).toBe(0);
    expect(stats.totalTasks).toBe(0);
    expect(stats.commits).toBe(0);
    expect(stats.linesAdded).toBe(0);
    expect(stats.linesRemoved).toBe(0);
    expect(stats.iterations).toBe(0);
  });

  it("creates stats with custom start time", () => {
    const stats = createInitialStats(12345);

    expect(stats.startTime).toBe(12345);
  });
});

// =============================================================================
// wrapCallbacks
// =============================================================================

describe("wrapCallbacks", () => {
  let mock: ReturnType<typeof createMockFormatter>;
  let stats: HeadlessStats;

  beforeEach(() => {
    mock = createMockFormatter();
    stats = createInitialStats(1000);
  });

  it("calls both original and hook callbacks", () => {
    const baseCallbacks = createHeadlessCallbacks({
      formatter: mock.formatter,
      stats,
      timestamps: false,
    });

    let hookCalled = false;
    const wrapped = wrapCallbacks(baseCallbacks, {
      onIterationStart: () => {
        hookCalled = true;
      },
    });

    wrapped.onIterationStart(1);

    expect(mock.events).toHaveLength(1);
    expect(hookCalled).toBe(true);
  });

  it("adds hooks for callbacks not in original", () => {
    const minimal = createHeadlessCallbacks({
      formatter: mock.formatter,
      stats,
      timestamps: false,
    });

    // Temporarily remove a callback
    const { onBackoff: _, ...withoutBackoff } = minimal;
    const base = withoutBackoff as typeof minimal;

    let hookCalled = false;
    const wrapped = wrapCallbacks(base, {
      onBackoff: () => {
        hookCalled = true;
      },
    });

    wrapped.onBackoff?.(1000, Date.now() + 1000);

    expect(hookCalled).toBe(true);
  });
});

// =============================================================================
// isToolEvent
// =============================================================================

describe("isToolEvent", () => {
  it("returns true for valid tool event", () => {
    expect(
      isToolEvent({
        type: "tool",
        iteration: 1,
        text: "Reading file",
      })
    ).toBe(true);
  });

  it("returns true for reasoning event", () => {
    expect(
      isToolEvent({
        type: "reasoning",
        iteration: 1,
        text: "Thinking...",
      })
    ).toBe(true);
  });

  it("returns true for spinner event", () => {
    expect(
      isToolEvent({
        type: "spinner",
        iteration: 1,
        text: "Loading...",
      })
    ).toBe(true);
  });

  it("returns true for separator event", () => {
    expect(
      isToolEvent({
        type: "separator",
        iteration: 1,
        text: "---",
      })
    ).toBe(true);
  });

  it("returns false for null", () => {
    expect(isToolEvent(null)).toBe(false);
  });

  it("returns false for non-object", () => {
    expect(isToolEvent("string")).toBe(false);
    expect(isToolEvent(123)).toBe(false);
  });

  it("returns false for unknown type", () => {
    expect(
      isToolEvent({
        type: "unknown",
        iteration: 1,
        text: "...",
      })
    ).toBe(false);
  });

  it("returns false when iteration is missing", () => {
    expect(
      isToolEvent({
        type: "tool",
        text: "...",
      })
    ).toBe(false);
  });
});
