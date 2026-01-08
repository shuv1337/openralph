# Plan: Multi-Agent Adapter System

## Overview

Add support for running multiple coding agents headlessly (codex exec, claude --print, gemini -p, opencode run) alongside the existing OpenCode SDK server mode. This requires a typed adapter system with unified configuration, PTY-based subprocess execution, and TUI integration via ghostty-opentui.

## Goals

1. **Agent Agnosticism**: Support multiple coding agents through a unified interface
2. **Backward Compatibility**: Keep existing OpenCode server mode as default
3. **Minimal Config**: Agent type, model (if applicable), prompt
4. **Interactive Steering**: Allow user input that appends to loop prompt for future iterations
5. **Dual TUI Modes**: Event log for server mode, terminal view for headless mode

---

## Codebase Alignment Notes (Must Follow)

These constraints come from the current codebase and related plans:

- **External server connection**: Current `loop.ts` has `connectToExternalServer()`, `checkServerHealth()`, and `getOrCreateOpencodeServer()` with timeout handling. The OpenCode server adapter MUST preserve this logic, not replace it with a stub.
- **Steering key conflict**: The feature-consolidation plan uses `:` for steering. This plan should NOT use a conflicting key. Either share the `:` key handler or use a different approach (e.g., only available via command palette in headless mode).
- **Agent CLI flag**: The feature-consolidation plan also adds `--agent`/`-a`. Ensure the semantics are compatible: feature-consolidation uses it for OpenCode agent selection (e.g., `code`, `plan`), while this plan uses it for adapter selection (e.g., `opencode-server`, `codex`). Consider renaming this plan's flag to `--adapter` to avoid confusion.
- **Windows PTY limitations**: AGENTS.md documents that `onMount` is unreliable on Windows. Any keyboard handling for headless mode must have a fallback similar to the existing stdin handler in `src/index.ts`.
- **Config merging**: Global config lives at `~/.config/ralph/config.json`. Any new fields (`adapter`) must merge with existing fields (`model`, `plan`, `prompt`, `server`, `serverTimeout`).
- **Test requirements**: Run `bun test` before committing. Tests live in `tests/` directory.

---

## Dependencies and Version Requirements

### Required Dependencies

```json
{
  "dependencies": {
    "ghostty-opentui": "TBD"
  }
}
```

**NOTE**: `ghostty-opentui` package availability must be verified before implementation. If unavailable, headless mode will not support terminal rendering and should fall back to raw text output.

### Bun Version Requirement

- Bun >= 1.0.0 required for PTY support via `Bun.spawn` with `stdin: "pty"`
- Windows users need Bun >= 1.1.0 for ConPTY support

---

## Architecture

```
src/
├── adapters/
│   ├── types.ts              # AgentAdapter interface, AgentSession, events
│   ├── registry.ts           # Adapter registry and factory
│   ├── opencode-server.ts    # Current SDK-based implementation (default)
│   ├── opencode-run.ts       # opencode run --print
│   ├── codex.ts              # codex exec
│   ├── claude.ts             # claude --print (future)
│   └── gemini.ts             # gemini -p (future)
├── pty/
│   ├── spawn.ts              # Bun PTY wrapper
│   └── types.ts              # PtyProcess interface
├── components/
│   ├── terminal-pane.tsx     # ghostty-terminal wrapper (new)
│   └── ...existing...
├── loop.ts                   # Updated to use adapters
├── app.tsx                   # Updated with dual view support
└── index.ts                  # Updated CLI args
```

---

## Phase 1: Core Adapter Infrastructure

### Task 1.1: Create Adapter Type Definitions
**File**: `src/adapters/types.ts`

```typescript
/**
 * Unified event type for all adapters.
 * Server mode produces structured events, headless mode produces raw output.
 */
export type AdapterEvent =
  | { type: "output"; data: string }           // Raw terminal output (headless)
  | { type: "tool"; name: string; title: string; timestamp: number }  // Tool call (server)
  | { type: "reasoning"; text: string; timestamp: number }  // LLM reasoning (server)
  | { type: "idle" }                           // Session became idle
  | { type: "error"; message: string }         // Error occurred
  | { type: "exit"; code: number }             // Process exited (headless)

/**
 * Options passed to adapter.execute()
 */
export interface ExecuteOptions {
  prompt: string;              // The prompt to send
  model?: string;              // Model identifier (adapter-specific format)
  cwd: string;                 // Working directory
  signal: AbortSignal;         // Cancellation signal
  cols: number;                // Terminal columns (for PTY)
  rows: number;                // Terminal rows (for PTY)
}

/**
 * Active agent session returned by adapter.execute()
 */
export interface AgentSession {
  /** Async iterator of events from the agent */
  events: AsyncIterable<AdapterEvent>;
  
  /** Send input to the agent (for interactive steering) */
  send(input: string): void;
  
  /** Abort the current execution */
  abort(): void;
  
  /** Promise that resolves when the session ends */
  done: Promise<{ exitCode?: number }>;
}

/**
 * Agent adapter interface - each agent implementation must satisfy this.
 */
export interface AgentAdapter {
  /** Unique identifier for this adapter */
  readonly name: string;
  
  /** Human-readable display name */
  readonly displayName: string;
  
  /** Whether this adapter uses PTY (headless) or SDK (server) */
  readonly mode: "pty" | "sdk";
  
  /** Check if this adapter is available (CLI exists, server reachable, etc.) */
  isAvailable(): Promise<boolean>;
  
  /** Execute a prompt and return a session */
  execute(options: ExecuteOptions): Promise<AgentSession>;
}

/**
 * Configuration for an adapter (stored in config file)
 */
export interface AdapterConfig {
  /** Adapter name (e.g., "opencode-server", "codex", "opencode-run") */
  adapter: string;  // NOTE: renamed from 'agent' to avoid conflict with feature-consolidation plan
  
  /** Model to use (format depends on adapter) */
  model?: string;
  
  /** Additional adapter-specific options */
  options?: Record<string, unknown>;
}
```

### Task 1.2: Create Adapter Registry
**File**: `src/adapters/registry.ts`

```typescript
import type { AgentAdapter } from "./types";

const adapters = new Map<string, AgentAdapter>();

export function registerAdapter(adapter: AgentAdapter): void {
  if (adapters.has(adapter.name)) {
    throw new Error(`Adapter "${adapter.name}" already registered`);
  }
  adapters.set(adapter.name, adapter);
}

export function getAdapter(name: string): AgentAdapter | undefined {
  return adapters.get(name);
}

export function listAdapters(): AgentAdapter[] {
  return Array.from(adapters.values());
}

export function getDefaultAdapter(): AgentAdapter {
  const adapter = adapters.get("opencode-server");
  if (!adapter) {
    throw new Error("Default adapter (opencode-server) not registered");
  }
  return adapter;
}

/**
 * Initialize all built-in adapters.
 * Call this explicitly instead of relying on side-effect imports.
 */
export async function initializeAdapters(options?: {
  serverUrl?: string;
  serverTimeoutMs?: number;
}): Promise<void> {
  // Import and register adapters explicitly
  const { OpencodeServerAdapter } = await import("./opencode-server");
  const { OpencodeRunAdapter } = await import("./opencode-run");
  const { CodexAdapter } = await import("./codex");
  
  registerAdapter(new OpencodeServerAdapter(options));
  registerAdapter(new OpencodeRunAdapter());
  registerAdapter(new CodexAdapter());
}
```

### Task 1.3: Create PTY Spawn Utility
**File**: `src/pty/types.ts`

```typescript
export interface PtyOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export interface PtyProcess {
  /** Write data to the PTY stdin */
  write: (data: string) => void;
  
  /** Resize the PTY */
  resize: (cols: number, rows: number) => void;
  
  /** Kill the PTY process */
  kill: () => void;
  
  /** Register callback for stdout data */
  onData: (callback: (data: string) => void) => void;
  
  /** Register callback for process exit */
  onExit: (callback: (info: { exitCode: number; signal?: number }) => void) => void;
  
  /** Process ID */
  pid: number;
  
  /** Clean up resources (call on abort/completion) */
  cleanup: () => void;
}
```

**File**: `src/pty/spawn.ts`

```typescript
import type { PtyProcess, PtyOptions } from "./types";
import { log } from "../util/log";

/**
 * Terminal query patterns to strip from output.
 * These are escape sequences that terminals use to query capabilities.
 */
const TERMINAL_QUERY_PATTERN = /\x1b\][^\x07]*\x07|\x1b\[\?[0-9;]*[a-zA-Z]/g;

/**
 * Spawn a PTY for a command using Bun's native PTY support.
 * 
 * PLATFORM NOTE:
 * - Linux/macOS: Uses Unix PTY via Bun.spawn with stdin: "pty"
 * - Windows: Uses ConPTY (requires Bun >= 1.1.0)
 * 
 * @throws Error if PTY spawn fails
 */
export function spawnPty(
  command: string[],
  options: PtyOptions = {}
): PtyProcess {
  const { cols = 80, rows = 24, cwd = process.cwd(), env = {} } = options;
  
  const dataCallbacks: Array<(data: string) => void> = [];
  const exitCallbacks: Array<(info: { exitCode: number; signal?: number }) => void> = [];
  let outputBuffer = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let isCleanedUp = false;
  
  // Spawn with PTY
  const proc = Bun.spawn(command, {
    cwd,
    env: { ...process.env, ...env, TERM: "xterm-256color" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  
  // NOTE: Bun's PTY API may vary by version. This is a simplified implementation.
  // For full PTY support, consider using the pattern from tuidoscope which wraps
  // the command with `script` on Unix for proper TTY allocation.
  
  const flushOutput = () => {
    if (outputBuffer.length > 0 && !isCleanedUp) {
      // Strip terminal queries before emitting
      const cleaned = outputBuffer.replace(TERMINAL_QUERY_PATTERN, "");
      for (const cb of dataCallbacks) {
        cb(cleaned);
      }
      outputBuffer = "";
    }
    flushTimer = null;
  };
  
  // Read stdout
  (async () => {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        outputBuffer += decoder.decode(value, { stream: true });
        // Batch output with 50ms window for performance
        if (!flushTimer && !isCleanedUp) {
          flushTimer = setTimeout(flushOutput, 50);
        }
      }
    } catch (e) {
      log("pty", "stdout read error", { error: String(e) });
    }
  })();
  
  // Handle exit
  proc.exited.then((exitCode) => {
    // Flush any remaining output
    flushOutput();
    for (const cb of exitCallbacks) {
      cb({ exitCode });
    }
  });
  
  const ptyProcess: PtyProcess = {
    write: (data: string) => {
      if (!isCleanedUp) {
        proc.stdin.write(data);
      }
    },
    resize: (newCols: number, newRows: number) => {
      // NOTE: Bun PTY resize API may not be available in all versions
      // This is a placeholder for future implementation
      log("pty", "resize requested", { cols: newCols, rows: newRows });
    },
    kill: () => {
      if (!isCleanedUp) {
        proc.kill();
      }
    },
    onData: (callback) => {
      dataCallbacks.push(callback);
    },
    onExit: (callback) => {
      exitCallbacks.push(callback);
    },
    pid: proc.pid,
    cleanup: () => {
      if (isCleanedUp) return;
      isCleanedUp = true;
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      try {
        proc.kill();
      } catch {
        // Process may already be dead
      }
    },
  };
  
  return ptyProcess;
}
```

---

## Phase 2: Implement Adapters

### Task 2.1: Refactor OpenCode Server Adapter
**File**: `src/adapters/opencode-server.ts`

Extract current `loop.ts` OpenCode SDK logic into an adapter while **preserving** external server connection logic:

```typescript
import { createOpencodeServer, createOpencodeClient } from "@opencode-ai/sdk";
import type { AgentAdapter, AgentSession, ExecuteOptions, AdapterEvent } from "./types";
import { 
  validateAndNormalizeServerUrl, 
  checkServerHealth, 
  connectToExternalServer 
} from "../loop"; // Re-export these from loop.ts
import { log } from "../util/log";

const DEFAULT_PORT = 4190;
const DEFAULT_HOSTNAME = "127.0.0.1";

export class OpencodeServerAdapter implements AgentAdapter {
  readonly name = "opencode-server";
  readonly displayName = "OpenCode (Server)";
  readonly mode = "sdk" as const;
  
  private serverUrl?: string;
  private serverTimeoutMs: number;
  
  constructor(options?: { serverUrl?: string; serverTimeoutMs?: number }) {
    this.serverUrl = options?.serverUrl;
    this.serverTimeoutMs = options?.serverTimeoutMs ?? 5000;
  }
  
  async isAvailable(): Promise<boolean> {
    if (this.serverUrl) {
      try {
        const health = await checkServerHealth(this.serverUrl, this.serverTimeoutMs);
        return health.ok;
      } catch {
        return false;
      }
    }
    // Assume we can start an embedded server
    return true;
  }
  
  async execute(options: ExecuteOptions): Promise<AgentSession> {
    const { prompt, model, signal } = options;
    
    // Get or create server (preserving existing logic from loop.ts)
    const server = await this.getOrCreateServer(signal);
    
    // Create client with timeoutless fetch
    const client = createOpencodeClient({
      baseUrl: server.url,
      fetch: (req: any) => {
        req.timeout = false;
        return fetch(req);
      },
    } as any);
    
    // Create session
    const sessionResult = await client.session.create();
    if (!sessionResult.data) {
      throw new Error("Failed to create session");
    }
    const sessionId = sessionResult.data.id;
    
    // Subscribe to events
    const events = await client.event.subscribe();
    
    // Parse model
    const { providerID, modelID } = this.parseModel(model || "opencode/claude-opus-4-5");
    
    // Create event generator
    const eventGenerator = this.createEventGenerator(
      client, sessionId, events, prompt, providerID, modelID, signal
    );
    
    return {
      events: eventGenerator,
      send: async (input: string) => {
        await client.session.prompt({
          path: { id: sessionId },
          body: {
            parts: [{ type: "text", text: input }],
            model: { providerID, modelID },
          },
        });
      },
      abort: () => {
        signal.dispatchEvent(new Event("abort"));
      },
      done: new Promise((resolve) => {
        // Resolved when eventGenerator completes
        (async () => {
          for await (const _ of eventGenerator) {
            // Consume events
          }
          resolve({});
        })();
      }),
    };
  }
  
  private async getOrCreateServer(signal: AbortSignal): Promise<{ url: string; close(): void }> {
    if (this.serverUrl) {
      return connectToExternalServer(this.serverUrl, {
        timeoutMs: this.serverTimeoutMs,
        signal,
      });
    }
    
    const hostname = DEFAULT_HOSTNAME;
    const port = DEFAULT_PORT;
    const url = `http://${hostname}:${port}`;
    
    // Try to attach to existing server first
    const health = await checkServerHealth(url, 1000);
    if (health.ok) {
      log("adapter", "Attached to existing server", { url });
      return { url, close: () => {} };
    }
    
    // Start new server
    log("adapter", "Starting new server...");
    const server = await createOpencodeServer({ signal, port });
    return server;
  }
  
  private parseModel(model: string): { providerID: string; modelID: string } {
    const slashIndex = model.indexOf("/");
    if (slashIndex === -1) {
      throw new Error(`Invalid model format: "${model}". Expected "provider/model"`);
    }
    return {
      providerID: model.slice(0, slashIndex),
      modelID: model.slice(slashIndex + 1),
    };
  }
  
  private async *createEventGenerator(
    client: any,
    sessionId: string,
    events: any,
    prompt: string,
    providerID: string,
    modelID: string,
    signal: AbortSignal
  ): AsyncGenerator<AdapterEvent> {
    let promptSent = false;
    
    for await (const event of events.stream) {
      if (signal.aborted) break;
      
      // Send prompt on connection
      if (event.type === "server.connected" && !promptSent) {
        promptSent = true;
        client.session.prompt({
          path: { id: sessionId },
          body: {
            parts: [{ type: "text", text: prompt }],
            model: { providerID, modelID },
          },
        }).catch((e: Error) => {
          log("adapter", "Prompt error", { error: e.message });
        });
        continue;
      }
      
      // Map SDK events to adapter events
      if (event.type === "message.part.updated") {
        const part = event.properties.part;
        if (part.sessionID !== sessionId) continue;
        
        if (part.type === "tool" && part.state.status === "completed") {
          yield {
            type: "tool",
            name: part.tool,
            title: part.state.title || JSON.stringify(part.state.input),
            timestamp: part.state.time.end,
          };
        }
        
        if (part.type === "text" && part.text) {
          const firstLine = part.text.split("\n")[0];
          const truncated = firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine;
          if (truncated.trim()) {
            yield {
              type: "reasoning",
              text: truncated,
              timestamp: Date.now(),
            };
          }
        }
      }
      
      if (event.type === "session.idle" && event.properties.sessionID === sessionId) {
        yield { type: "idle" };
        break;
      }
      
      if (event.type === "session.error" && event.properties.sessionID === sessionId) {
        const errorMessage = event.properties.error?.data?.message || String(event.properties.error?.name);
        yield { type: "error", message: errorMessage };
        break;
      }
    }
  }
}
```

### Task 2.2: Implement OpenCode Run Adapter
**File**: `src/adapters/opencode-run.ts`

```typescript
import type { AgentAdapter, AgentSession, ExecuteOptions, AdapterEvent } from "./types";
import { spawnPty } from "../pty/spawn";
import { log } from "../util/log";

export class OpencodeRunAdapter implements AgentAdapter {
  readonly name = "opencode-run";
  readonly displayName = "OpenCode (Headless)";
  readonly mode = "pty" as const;
  
  async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["opencode", "--version"], { stdout: "pipe" });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }
  
  async execute(options: ExecuteOptions): Promise<AgentSession> {
    const { prompt, model, cwd, signal, cols, rows } = options;
    
    // Build command: opencode run --print --model <model> "<prompt>"
    const args = ["opencode", "run", "--print"];
    if (model) {
      // OpenCode run expects provider/model format
      args.push("--model", model);
    }
    args.push(prompt);
    
    const pty = spawnPty(args, { cols, rows, cwd });
    
    // Handle abort
    const onAbort = () => {
      pty.cleanup();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    
    // Create async event generator with proper cleanup
    async function* eventGenerator(): AsyncGenerator<AdapterEvent> {
      const pendingEvents: AdapterEvent[] = [];
      let resolveNext: ((value: IteratorResult<AdapterEvent>) => void) | null = null;
      let done = false;
      
      const pushEvent = (event: AdapterEvent) => {
        if (done) return;
        if (resolveNext) {
          resolveNext({ value: event, done: false });
          resolveNext = null;
        } else {
          pendingEvents.push(event);
        }
      };
      
      pty.onData((data) => {
        pushEvent({ type: "output", data });
      });
      
      pty.onExit(({ exitCode }) => {
        pushEvent({ type: "exit", code: exitCode });
        done = true;
        if (resolveNext) {
          resolveNext({ value: undefined as any, done: true });
        }
      });
      
      try {
        while (!done) {
          if (pendingEvents.length > 0) {
            yield pendingEvents.shift()!;
          } else {
            const result = await new Promise<IteratorResult<AdapterEvent>>((resolve) => {
              resolveNext = resolve;
            });
            if (result.done) break;
            yield result.value;
          }
        }
      } finally {
        // Cleanup on generator completion
        signal.removeEventListener("abort", onAbort);
        pty.cleanup();
      }
    }
    
    return {
      events: eventGenerator(),
      send: (input) => pty.write(input + "\n"),
      abort: () => pty.kill(),
      done: new Promise((resolve) => {
        pty.onExit(({ exitCode }) => resolve({ exitCode }));
      }),
    };
  }
}
```

### Task 2.3: Implement Codex Adapter
**File**: `src/adapters/codex.ts`

```typescript
import type { AgentAdapter, AgentSession, ExecuteOptions, AdapterEvent } from "./types";
import { spawnPty } from "../pty/spawn";

export class CodexAdapter implements AgentAdapter {
  readonly name = "codex";
  readonly displayName = "Codex CLI";
  readonly mode = "pty" as const;
  
  async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn(["codex", "--version"], { stdout: "pipe" });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }
  
  async execute(options: ExecuteOptions): Promise<AgentSession> {
    const { prompt, model, cwd, signal, cols, rows } = options;
    
    // Build command: codex exec --model <model> "<prompt>"
    // NOTE: Codex uses model name only (no provider prefix)
    const args = ["codex", "exec"];
    if (model) {
      // Strip provider prefix if present (codex doesn't use it)
      const modelName = model.includes("/") ? model.split("/")[1] : model;
      args.push("--model", modelName);
    }
    args.push(prompt);
    
    const pty = spawnPty(args, { cols, rows, cwd });
    
    // Same pattern as opencode-run adapter
    // ... (identical event generator implementation)
    
    // For brevity, reuse the same pattern from OpencodeRunAdapter
    const onAbort = () => pty.cleanup();
    signal.addEventListener("abort", onAbort, { once: true });
    
    async function* eventGenerator(): AsyncGenerator<AdapterEvent> {
      // ... same implementation as opencode-run
    }
    
    return {
      events: eventGenerator(),
      send: (input) => pty.write(input + "\n"),
      abort: () => pty.kill(),
      done: new Promise((resolve) => {
        pty.onExit(({ exitCode }) => resolve({ exitCode }));
      }),
    };
  }
}
```

---

## Phase 3: Update Loop to Use Adapters

### Task 3.1: Refactor loop.ts
**File**: `src/loop.ts`

Key changes:
- Keep existing `validateAndNormalizeServerUrl`, `checkServerHealth`, `connectToExternalServer` as exports (used by adapter)
- Add adapter-based execution path
- Preserve backward compatibility with existing LoopOptions

```typescript
import type { AgentAdapter, AdapterEvent } from "./adapters/types";
import { getAdapter, getDefaultAdapter, initializeAdapters } from "./adapters/registry";
import type { LoopOptions, PersistedState, ToolEvent } from "./state";
import { getHeadHash, getCommitsSince, getDiffStats } from "./git";
import { parsePlan } from "./plan";
import { log } from "./util/log";

// Keep existing exports for adapter use
export { validateAndNormalizeServerUrl, checkServerHealth, connectToExternalServer };

const DEFAULT_PROMPT = `READ all of {plan}. Pick ONE task...`; // unchanged

export type LoopCallbacks = {
  onIterationStart: (iteration: number) => void;
  onEvent: (event: ToolEvent) => void;
  onRawOutput?: (data: string) => void;  // NEW: for headless mode terminal output
  onIterationComplete: (iteration: number, duration: number, commits: number) => void;
  onTasksUpdated: (done: number, total: number) => void;
  onCommitsUpdated: (commits: number) => void;
  onDiffUpdated: (added: number, removed: number) => void;
  onPause: () => void;
  onResume: () => void;
  onComplete: () => void;
  onError: (error: string) => void;
  onIdleChanged: (isIdle: boolean) => void;
  onAdapterModeChanged?: (mode: "sdk" | "pty") => void;  // NEW: notify TUI of mode
};

export async function runLoop(
  options: LoopOptions,
  persistedState: PersistedState,
  callbacks: LoopCallbacks,
  signal: AbortSignal,
): Promise<void> {
  // Initialize adapters with server options
  await initializeAdapters({
    serverUrl: options.serverUrl,
    serverTimeoutMs: options.serverTimeoutMs,
  });
  
  // Get adapter based on options
  const adapter = options.adapter 
    ? getAdapter(options.adapter) 
    : getDefaultAdapter();
  
  if (!adapter) {
    callbacks.onError(`Unknown adapter: ${options.adapter}`);
    return;
  }
  
  // Check if adapter is available
  if (!await adapter.isAvailable()) {
    callbacks.onError(`Adapter "${adapter.displayName}" is not available`);
    return;
  }
  
  log("loop", "Using adapter", { name: adapter.name, mode: adapter.mode });
  callbacks.onAdapterModeChanged?.(adapter.mode);
  
  let iteration = persistedState.iterationTimes.length;
  let isPaused = false;
  let previousCommitCount = await getCommitsSince(persistedState.initialCommitHash);
  let errorCount = 0;  // For exponential backoff (from feature-consolidation plan)
  
  // User steering context (appended to prompt for future iterations)
  let steeringContext = "";
  
  // Main loop
  while (!signal.aborted) {
    // Check for .ralph-done file
    const doneFile = Bun.file(".ralph-done");
    if (await doneFile.exists()) {
      log("loop", ".ralph-done found, completing");
      await doneFile.delete();
      callbacks.onComplete();
      break;
    }

    // Check for .ralph-pause file
    const pauseFile = Bun.file(".ralph-pause");
    if (await pauseFile.exists()) {
      if (!isPaused) {
        isPaused = true;
        log("loop", "Pausing");
        callbacks.onPause();
      }
      await Bun.sleep(1000);
      continue;
    } else if (isPaused) {
      isPaused = false;
      log("loop", "Resuming");
      callbacks.onResume();
    }
    
    // Apply backoff if there were previous errors
    if (errorCount > 0) {
      const backoffMs = calculateBackoffMs(errorCount);
      log("loop", "Error backoff", { errorCount, backoffMs });
      await Bun.sleep(backoffMs);
    }
    
    iteration++;
    const iterationStartTime = Date.now();
    callbacks.onIterationStart(iteration);
    
    // Add separator event
    callbacks.onEvent({
      iteration,
      type: "separator",
      text: `iteration ${iteration}`,
      timestamp: iterationStartTime,
    });
    
    // Add spinner event
    callbacks.onEvent({
      iteration,
      type: "spinner",
      text: "looping...",
      timestamp: iterationStartTime,
    });
    
    try {
      // Parse plan
      const { done, total } = await parsePlan(options.planFile);
      callbacks.onTasksUpdated(done, total);
      
      // Build prompt with steering context
      const basePrompt = buildPrompt(options);
      const fullPrompt = steeringContext 
        ? `${basePrompt}\n\nAdditional context from user:\n${steeringContext}`
        : basePrompt;
      
      // Execute via adapter
      const session = await adapter.execute({
        prompt: fullPrompt,
        model: options.model,
        cwd: process.cwd(),
        signal,
        cols: process.stdout.columns || 80,
        rows: process.stdout.rows || 24,
      });
      
      callbacks.onIdleChanged(true);
      
      // Process events from adapter
      for await (const event of session.events) {
        if (signal.aborted) break;
        
        switch (event.type) {
          case "output":
            callbacks.onRawOutput?.(event.data);
            callbacks.onIdleChanged(false);
            break;
            
          case "tool":
            callbacks.onEvent({
              iteration,
              type: "tool",
              icon: event.name,
              text: event.title,
              timestamp: event.timestamp,
            });
            callbacks.onIdleChanged(false);
            break;
            
          case "reasoning":
            callbacks.onEvent({
              iteration,
              type: "reasoning",
              icon: "thought",
              text: event.text,
              timestamp: event.timestamp,
            });
            callbacks.onIdleChanged(false);
            break;
            
          case "idle":
          case "exit":
            // Iteration complete
            break;
            
          case "error":
            callbacks.onError(event.message);
            throw new Error(event.message);  // Will be caught for backoff
        }
      }
      
      // Iteration completed successfully - reset error count
      errorCount = 0;
      
    } catch (error) {
      errorCount++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("loop", "Iteration error", { iteration, errorCount, error: errorMessage });
      callbacks.onError(errorMessage);
      // Continue to next iteration with backoff
      continue;
    }
    
    // Iteration completion
    const iterationDuration = Date.now() - iterationStartTime;
    const totalCommits = await getCommitsSince(persistedState.initialCommitHash);
    const commitsThisIteration = totalCommits - previousCommitCount;
    previousCommitCount = totalCommits;
    
    const diffStats = await getDiffStats(persistedState.initialCommitHash);
    
    callbacks.onIterationComplete(iteration, iterationDuration, commitsThisIteration);
    callbacks.onCommitsUpdated(totalCommits);
    callbacks.onDiffUpdated(diffStats.added, diffStats.removed);
  }
}

function calculateBackoffMs(attempt: number, maxMs: number = 300000): number {
  const baseMs = 5000;
  const exponential = Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
  const jitter = Math.random() * 0.1 * exponential;
  return Math.floor(exponential + jitter);
}

// Function to add steering context (called from TUI)
let steeringContextSetter: ((context: string) => void) | null = null;
export function setSteeringContextSetter(setter: (context: string) => void): void {
  steeringContextSetter = setter;
}
export function addSteeringContext(context: string): void {
  steeringContextSetter?.(context);
}
```

---

## Phase 4: TUI Updates

### Task 4.1: Verify ghostty-opentui Dependency

**BLOCKING**: Before implementing terminal pane, verify:
1. Package `ghostty-opentui` exists on npm
2. Correct version number
3. API matches expected usage

If unavailable, implement fallback:
```typescript
// Fallback: render raw ANSI as text lines (no terminal emulation)
function FallbackTerminalPane(props: { buffer: string }) {
  const lines = props.buffer.split("\n").slice(-100);
  return (
    <scrollbox flexGrow={1} stickyScroll={true}>
      <For each={lines}>
        {(line) => <text>{line}</text>}
      </For>
    </scrollbox>
  );
}
```

### Task 4.2: Create Terminal Pane Component
**File**: `src/components/terminal-pane.tsx`

```typescript
import { createSignal, onCleanup, Show } from "solid-js";

interface TerminalPaneProps {
  buffer: string;
  cols: number;
  rows: number;
  showCursor?: boolean;
}

// Check if ghostty-terminal is available
let ghosttyAvailable = false;
try {
  // This will be set by the registration in index.ts
  ghosttyAvailable = typeof customElements !== "undefined" && 
    customElements.get("ghostty-terminal") !== undefined;
} catch {
  // Not available
}

export function TerminalPane(props: TerminalPaneProps) {
  if (!ghosttyAvailable) {
    // Fallback rendering
    const lines = () => props.buffer.split("\n").slice(-props.rows);
    return (
      <scrollbox flexGrow={1} stickyScroll={true} stickyStart="bottom">
        <For each={lines()}>
          {(line) => <text>{line}</text>}
        </For>
      </scrollbox>
    );
  }
  
  return (
    <ghostty-terminal
      ansi={props.buffer}
      cols={props.cols}
      rows={props.rows}
      showCursor={props.showCursor ?? true}
    />
  );
}
```

### Task 4.3: Update App Component for Dual View
**File**: `src/app.tsx`

Add conditional rendering based on adapter mode. See feature-consolidation plan for steering UI integration.

### Task 4.4: Steering Input Integration

**DECISION REQUIRED**: Consolidate with feature-consolidation plan's `:` steering key.

Options:
1. Use `:` key for both modes (shared handler)
2. Use `i` in headless mode only (different UX)
3. Move to command palette only

Recommend: Option 1 (shared `:` handler) for consistency.

---

## Phase 5: CLI Updates

### Task 5.1: Update CLI Arguments
**File**: `src/index.ts`

```typescript
const argv = await yargs(hideBin(process.argv))
  .option("adapter", {
    type: "string",
    description: "Adapter to use (opencode-server, opencode-run, codex)",
    default: globalConfig.adapter || "opencode-server",
  })
  // Keep --agent for OpenCode agent selection (from feature-consolidation plan)
  .option("agent", {
    alias: "a",
    type: "string",
    description: "OpenCode agent to use (code, plan, build)",
  })
  // ... existing options ...
  .parse();
```

### Task 5.2: Update Config Interface
**File**: `src/index.ts`

```typescript
interface RalphConfig {
  adapter?: string;    // NEW: which adapter to use
  agent?: string;      // OpenCode agent (from feature-consolidation plan)
  model?: string;
  plan?: string;
  prompt?: string;
  server?: string;
  serverTimeout?: number;
}
```

### Task 5.3: Update LoopOptions
**File**: `src/state.ts`

```typescript
export type LoopOptions = {
  planFile: string;
  model: string;
  prompt: string;
  adapter?: string;      // NEW
  agent?: string;        // OpenCode agent
  serverUrl?: string;
  serverTimeoutMs?: number;
};
```

### Task 5.4: Register ghostty-terminal (Conditional)
**File**: `src/index.ts`

```typescript
import { extend } from "@opentui/core";

async function registerGhosttyTerminal(): Promise<boolean> {
  try {
    const { GhosttyTerminalRenderable } = await import("ghostty-opentui/terminal-buffer");
    extend({ "ghostty-terminal": GhosttyTerminalRenderable });
    log("main", "ghostty-terminal registered");
    return true;
  } catch (error) {
    log("main", "ghostty-opentui not available, using fallback", { error: String(error) });
    return false;
  }
}
```

---

## Phase 6: Testing

### Task 6.1: Unit Tests for Adapter Types
**File**: `tests/unit/adapters.test.ts`

### Task 6.2: Unit Tests for PTY Spawn
**File**: `tests/unit/pty.test.ts`

### Task 6.3: Integration Tests for Adapters
**File**: `tests/integration/adapters.test.ts`

---

## Implementation Order

### Phase 1: Core Infrastructure (Priority: High)
- [ ] Task 1.1: Create adapter type definitions
- [ ] Task 1.2: Create adapter registry
- [ ] Task 1.3: Create PTY spawn utility

### Phase 2: Implement Adapters (Priority: High)
- [ ] Task 2.1: Refactor OpenCode server adapter (preserve external server logic)
- [ ] Task 2.2: Implement OpenCode run adapter
- [ ] Task 2.3: Implement Codex adapter

### Phase 3: Loop Refactor (Priority: High)
- [ ] Task 3.1: Refactor loop.ts to use adapters

### Phase 4: TUI Updates (Priority: Medium)
- [ ] Task 4.1: Verify ghostty-opentui dependency availability
- [ ] Task 4.2: Create terminal pane component (with fallback)
- [ ] Task 4.3: Update app component for dual view
- [ ] Task 4.4: Integrate steering (coordinate with feature-consolidation plan)

### Phase 5: CLI Updates (Priority: Medium)
- [ ] Task 5.1: Update CLI arguments (use --adapter, not --agent)
- [ ] Task 5.2: Update config interface
- [ ] Task 5.3: Update LoopOptions
- [ ] Task 5.4: Register ghostty-terminal conditionally

### Phase 6: Testing (Priority: High)
- [ ] Task 6.1: Unit tests for adapter types
- [ ] Task 6.2: Unit tests for PTY spawn
- [ ] Task 6.3: Integration tests for adapters

---

## Model Format Normalization (Resolved)

Each adapter handles model format internally:
- **opencode-server**: Expects `provider/model` (e.g., `anthropic/claude-opus-4`)
- **opencode-run**: Expects `provider/model` (same as server)
- **codex**: Expects model name only; adapter strips provider prefix if present
- **claude**: Will expect model name only
- **gemini**: Will expect model name only

---

## Future Adapters (Not in initial scope)

- Claude CLI (`claude --print`)
- Gemini CLI (`gemini -p`)
- Aider (`aider --yes --message`)

---

## Risk Mitigation

### Risk: ghostty-opentui unavailable
**Mitigation**: Implement fallback text-based terminal rendering

### Risk: PTY not available on platform
**Mitigation**: Check Bun version and PTY availability at startup; error clearly if headless adapter selected but PTY unavailable

### Risk: Conflicts with feature-consolidation plan
**Mitigation**: Use `--adapter` for adapter selection, `--agent` for OpenCode agent selection; share `:` steering key handler

### Risk: Windows PTY issues
**Mitigation**: Document Bun version requirement; test on Windows before release
