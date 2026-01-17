import { createOpencodeServer, createOpencodeClient } from "@opencode-ai/sdk";
import { getAdapter, initializeAdapters } from "./adapters/registry.js";
import type { LoopOptions, PersistedState, SessionInfo, ToolEvent } from "./state.js";
import { getHeadHash, getCommitsSince, getDiffStats } from "./git.js";
import { parsePlan, validatePlanCompletion } from "./plan.js";
import { log } from "./lib/log";

import { ErrorHandler, ErrorContext } from "./lib/error-handler";

const DEFAULT_PROMPT = `READ all of {plan} and {progress}. Pick ONE task with passes=false (prefer highest-risk/highest-impact). Keep changes small: one logical change per commit. Update {plan} by setting passes=true and adding notes or steps as needed. Append a brief entry to {progress} with what changed and why. Run feedback loops before committing: bun run typecheck, bun test, bun run lint (if missing, note it in {progress} and continue). Commit change (update {plan} in the same commit). ONLY do one task unless GLARINGLY OBVIOUS steps should run together. Quality bar: production code, maintainable, tests when appropriate. If you learn a critical operational detail, update AGENTS.md. When ALL tasks complete, create .ralph-done and output <promise>COMPLETE</promise>. NEVER GIT PUSH. ONLY COMMIT.`;


const steeringContext: string[] = [];

export function addSteeringContext(message: string): void {
  const trimmed = message.trim();
  if (!trimmed) return;
  steeringContext.push(trimmed);
}

function applySteeringContext(prompt: string): string {
  if (steeringContext.length === 0) return prompt;
  return `${prompt}\n\nAdditional context from user:\n${steeringContext.join("\n")}`;
}

const DEFAULT_PORT = 4190;

// Backoff configuration
const BACKOFF_BASE_MS = 5000; // 5 seconds
const BACKOFF_MAX_MS = 300000; // 5 minutes

/**
 * Calculate exponential backoff delay with jitter.
 * Formula: base * 2^(attempt-1) with 10% jitter, capped at max.
 * @param attempt - The attempt number (1-based)
 * @returns Delay in milliseconds
 */
export function calculateBackoffMs(attempt: number): number {
  if (attempt <= 0) return 0;
  
  // Exponential growth: base * 2^(attempt-1)
  const exponentialDelay = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
  
  // Cap at maximum delay
  const cappedDelay = Math.min(exponentialDelay, BACKOFF_MAX_MS);
  
  // Add 10% jitter to prevent synchronized retries
  const jitter = cappedDelay * 0.1 * Math.random();
  
  return Math.round(cappedDelay + jitter);
}

/**
 * Check if .ralph-done exists and handle completion logic.
 * @returns true if valid (should exit), false if invalid (should continue)
 */
async function checkAndHandleDoneFile(
  planFile: string,
  debug: boolean | undefined,
  callbacks: LoopCallbacks
): Promise<boolean> {
  const doneFile = Bun.file(".ralph-done");
  if (await doneFile.exists()) {
    const isValid = await validatePlanCompletion(planFile);
    if (isValid) {
      log("loop", debug ? ".ralph-done validated, completing" : ".ralph-done found, completing");
      await doneFile.delete();
      callbacks.onComplete();
      return true;
    } else {
      if (debug) {
        const { done, total } = await parsePlan(planFile);
        log("loop", `WARNING: Premature .ralph-done detected. Only ${done}/${total} tasks complete. Continuing iteration.`);
      } else {
        log("loop", "Premature .ralph-done detected, continuing iteration");
      }
      await doneFile.delete();
      return false;
    }
  }
  return false;
}

const DEFAULT_HOSTNAME = "127.0.0.1";

/**
 * Validate and normalize a server URL.
 * @returns normalized origin (no trailing slash)
 * @throws Error if URL is invalid or not an origin
 */
export function validateAndNormalizeServerUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL format: ${url}`);
  }
  
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Invalid protocol: ${parsed.protocol}. Must be http or https.`);
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`Server URL must be origin only (no path/query/fragment): ${url}`);
  }
  
  // URL.origin never has trailing slash per WHATWG spec
  return parsed.origin;
}

/**
 * Check if a URL points to localhost.
 */
function isLocalhost(url: string): boolean {
  const parsed = new URL(url);
  return parsed.hostname === "localhost" || 
         parsed.hostname === "127.0.0.1" || 
         parsed.hostname === "::1";
}

/**
 * Result of a server health check.
 */
type ServerHealthResult =
  | { ok: true }
  | { ok: false; reason: "unreachable" | "unhealthy" };

/**
 * Check if a server is healthy.
 * Composes timeout with optional abort signal for user cancellation.
 */
export async function checkServerHealth(
  url: string,
  timeoutMs: number,
  abortSignal?: AbortSignal
): Promise<ServerHealthResult> {
  try {
    const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
    if (abortSignal) {
      signals.push(abortSignal);
    }
    
    const response = await fetch(`${url}/global/health`, {
      signal: AbortSignal.any(signals),
    });
    
    if (!response.ok) {
      return { ok: false, reason: "unhealthy" };
    }
    
    const data = await response.json();
    return data.healthy === true 
      ? { ok: true } 
      : { ok: false, reason: "unhealthy" };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

/**
 * Connect to an external OpenCode server at the specified URL.
 * Validates the URL format and server health before returning.
 * 
 * NOTE: This function only returns connection info. The actual client
 * is created by runLoop() using createOpencodeClient() with createTimeoutlessFetch().
 * 
 * @throws Error if URL is invalid or server is not healthy
 */
export async function connectToExternalServer(
  url: string,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<{ url: string; close(): void; attached: boolean }> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  
  const normalizedUrl = validateAndNormalizeServerUrl(url);
  
  // Warn about non-HTTPS for non-localhost (logged to .ralph-log for debugging)
  if (!normalizedUrl.startsWith("https://") && !isLocalhost(normalizedUrl)) {
    log("loop", "WARNING: Using insecure HTTP connection to non-localhost server", { 
      url: normalizedUrl 
    });
  }
  
  // Check server health with timeout (and optional user abort signal)
  const health = await checkServerHealth(normalizedUrl, timeoutMs, options?.signal);
  if (!health.ok) {
    const message = health.reason === "unreachable" 
      ? `Cannot connect to server at ${normalizedUrl}` 
      : `Server unhealthy at ${normalizedUrl}`;
    throw new Error(message);
  }
  
  log("loop", "Connected to external server", { url: normalizedUrl });
  
  return {
    url: normalizedUrl,
    close: () => {}, // No-op - we don't manage external servers
    attached: true,
  };
}

/**
 * Check if an opencode server is already running at the given URL.
 * Uses the /global/health endpoint.
 */
async function tryConnectToExistingServer(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/global/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (response.ok) {
      const data = await response.json();
      return data.healthy === true;
    }
  } catch {
    // Server not running or not responding
  }
  return false;
}

/**
 * Get or create an opencode server.
 * First tries to attach to an existing server, then starts a new one if needed.
 * If serverUrl is provided, connects to that external server directly.
 */
async function getOrCreateOpencodeServer(options: {
  signal?: AbortSignal;
  port?: number;
  hostname?: string;
  serverUrl?: string;
  serverTimeoutMs?: number;
}): Promise<{ url: string; close(): void; attached: boolean }> {
  // If explicit server URL provided, connect to it directly
  if (options.serverUrl) {
    return connectToExternalServer(options.serverUrl, {
      timeoutMs: options.serverTimeoutMs,
      signal: options.signal,
    });
  }

  const hostname = options.hostname || DEFAULT_HOSTNAME;
  const port = options.port || DEFAULT_PORT;
  const url = `http://${hostname}:${port}`;

  // Try to attach to existing server first
  if (await tryConnectToExistingServer(url)) {
    log("loop", "Attached to existing server", { url });
    return {
      url,
      close: () => {}, // No-op - we didn't start it
      attached: true,
    };
  }

  // Start new server
  log("loop", "Starting new server...");
  const server = await createOpencodeServer(options);
  return {
    ...server,
    attached: false,
  };
}

/**
 * Debug session state - holds server and client for debug mode.
 * Cached across createDebugSession calls to avoid recreating server.
 */
let debugServer: { url: string; close(): void; attached: boolean } | null = null;
let debugClient: ReturnType<typeof createOpencodeClient> | null = null;

/**
 * Create a new session in debug mode.
 * Initializes server/client on first call, then creates a session.
 * Returns session info for use in the TUI.
 */
export async function createDebugSession(options: {
  serverUrl?: string;
  serverTimeoutMs?: number;
  model: string;
  agent?: string;
}): Promise<{
  sessionId: string;
  serverUrl: string;
  attached: boolean;
  sendMessage: (message: string) => Promise<void>;
}> {
  // Initialize server and client if not already created
  if (!debugServer || !debugClient) {
    log("loop", "Debug mode: initializing server/client...");
    debugServer = await getOrCreateOpencodeServer({
      port: DEFAULT_PORT,
      serverUrl: options.serverUrl,
      serverTimeoutMs: options.serverTimeoutMs,
    });
    
    const createTimeoutlessFetch = () => {
      return (req: any) => {
        req.timeout = false;
        return fetch(req);
      };
    };
    
    debugClient = createOpencodeClient({ 
      baseUrl: debugServer.url, 
      fetch: createTimeoutlessFetch() 
    } as any);
    
    log("loop", "Debug mode: server/client ready", { url: debugServer.url });
  }

  // Create a new session
  log("loop", "Debug mode: creating session...");
  const sessionResult = await debugClient.session.create();
  if (!sessionResult.data) {
    throw new Error("Failed to create debug session");
  }
  
  const sessionId = sessionResult.data.id;
  log("loop", "Debug mode: session created", { sessionId });

  // Parse model for sendMessage
  const { providerID, modelID } = parseModel(options.model);
  const client = debugClient;

  // Create sendMessage function
  const sendMessage = async (message: string): Promise<void> => {
    log("loop", "Debug mode: sending message", { sessionId, message: message.slice(0, 50) });
    await client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: "text", text: message }],
        model: { providerID, modelID },
        ...(options.agent && { agent: options.agent }),
      },
    });
  };

  return {
    sessionId,
    serverUrl: debugServer.url,
    attached: debugServer.attached,
    sendMessage,
  };
}

/**
 * Clean up debug mode resources.
 * Call this when exiting debug mode.
 */
export async function cleanupDebugSession(): Promise<void> {
  if (debugServer) {
    log("loop", "Debug mode: cleaning up server");
    const shouldForceCleanup = !debugServer.attached;
    
    try {
      debugServer.close();
      log("loop", "Debug mode: server close called");
    } catch (error) {
      log("loop", "Debug mode: error closing server", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    
    // Wait briefly for graceful shutdown
    await Bun.sleep(500);
    
    // On Windows, force terminate any remaining processes (only if we started the server)
    if (process.platform === "win32" && shouldForceCleanup) {
      log("loop", "Debug mode: Windows force cleanup");
      await forceTerminateOpencodeProcesses();
    }
    
    debugServer = null;
  }
  debugClient = null;
}

/**
 * Strip YAML frontmatter from content if present.
 * Frontmatter is defined as content between --- delimiters at the start of the file.
 */
export function stripFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) {
    return content;
  }
  
  // Find the closing ---
  const endIndex = content.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    return content;
  }
  
  // Return content after the closing ---\n
  return content.slice(endIndex + 5);
}

/**
 * Build the prompt string with precedence: --prompt > --prompt-file > DEFAULT_PROMPT.
 * Replaces {plan}, {{PLAN_FILE}}, {progress}, and {{PROGRESS_FILE}} placeholders.
 * Strips YAML frontmatter from prompt files (used to mark generated files).
 */
export async function buildPrompt(options: LoopOptions): Promise<string> {
  let template: string;

  // Precedence 1: --prompt CLI option (explicit string)
  if (options.prompt && options.prompt.trim()) {
    template = options.prompt;
  }
  // Precedence 2: --prompt-file (read from file if it exists)
  else if (options.promptFile) {
    const file = Bun.file(options.promptFile);
    if (await file.exists()) {
      template = await file.text();
      // Strip frontmatter (used to mark generated files)
      template = stripFrontmatter(template);
      log("loop", "Loaded prompt from file", { path: options.promptFile });
    } else {
      // File doesn't exist, fall through to default
      template = DEFAULT_PROMPT;
    }
  }
  // Precedence 3: DEFAULT_PROMPT fallback
  else {
    template = DEFAULT_PROMPT;
  }

  const progressFile = options.progressFile || "progress.txt";

  // Replace both {plan} and {{PLAN_FILE}} placeholders
  return template
    .replace(/\{plan\}/g, options.planFile)
    .replace(/\{\{PLAN_FILE\}\}/g, options.planFile)
    .replace(/\{progress\}/g, progressFile)
    .replace(/\{\{PROGRESS_FILE\}\}/g, progressFile);
}

/**
 * Parse a model string into provider and model IDs.
 * @param model - Model string in format "provider/model" (e.g., "anthropic/claude-opus-4")
 * @throws Error if model string doesn't contain a slash separator
 */
export function parseModel(model: string): { providerID: string; modelID: string } {
  const slashIndex = model.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(
      `Invalid model format: "${model}". Expected "provider/model" (e.g., "anthropic/claude-opus-4")`
    );
  }
  return {
    providerID: model.slice(0, slashIndex),
    modelID: model.slice(slashIndex + 1),
  };
}

/**
 * Token usage data from step-finish events.
 * Maps to StepFinishPart.tokens structure from the SDK.
 */
export type TokenUsage = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
};

export type LoopCallbacks = {
  onIterationStart: (iteration: number) => void;
  onEvent: (event: ToolEvent) => void;
  onRawOutput?: (data: string) => void;
  onIterationComplete: (
    iteration: number,
    duration: number,
    commits: number,
  ) => void;
  onTasksUpdated: (done: number, total: number) => void;
  onCommitsUpdated: (commits: number) => void;
  onDiffUpdated: (added: number, removed: number) => void;
  onPause: () => void;
  onResume: () => void;
  onComplete: () => void;
  onError: (error: string) => void;
  onIdleChanged: (isIdle: boolean) => void;
  onAdapterModeChanged?: (mode: "sdk" | "pty") => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionEnded?: (sessionId: string) => void;
  onBackoff?: (backoffMs: number, retryAt: number) => void;
  onBackoffCleared?: () => void;
  /** Called when token usage data is received from step-finish events */
  onTokens?: (tokens: TokenUsage) => void;
  /** Called when the plan file is modified (for real-time task list updates) */
  onPlanFileModified?: () => void;
};

type PauseState = {
  value: boolean;
};

const PAUSE_POLL_INTERVAL_MS = 1000;

async function waitWhilePaused(
  pauseState: PauseState,
  callbacks: LoopCallbacks,
  signal: AbortSignal
): Promise<boolean> {
  const pauseFilePath = ".ralph-pause";
  if (!(await Bun.file(pauseFilePath).exists())) {
    if (pauseState.value) {
      pauseState.value = false;
      log("loop", "Resuming");
      callbacks.onResume();
    }
    return false;
  }

  if (!pauseState.value) {
    pauseState.value = true;
    log("loop", "Pausing");
    callbacks.onPause();
  }

  while (!signal.aborted && (await Bun.file(pauseFilePath).exists())) {
    await Bun.sleep(PAUSE_POLL_INTERVAL_MS);
  }

  if (!signal.aborted && pauseState.value) {
    pauseState.value = false;
    log("loop", "Resuming");
    callbacks.onResume();
  }

  return true;
}

/**
 * Force terminate any remaining opencode child processes on Windows.
 * This is a fallback when graceful shutdown doesn't complete in time.
 */
async function forceTerminateOpencodeProcesses(): Promise<void> {
  if (process.platform !== "win32") {
    return;
  }

  try {
    // Get list of all processes with ID, ParentID, Name using PowerShell
    // Win32_Process is faster than Get-Process for parent/child relationships
    const cmd = [
      "powershell",
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Depth 1"
    ];

    const proc = Bun.spawn(cmd, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    // Wait for process to exit
    await proc.exited;

    if (proc.exitCode !== 0) {
       // Log but don't throw - this is best-effort cleanup
       const error = await new Response(proc.stderr).text();
       log("loop", "Failed to get process list for cleanup", { error });
       return;
    }

    let processes: any[];
    try {
      processes = JSON.parse(output);
      // ConvertTo-Json returns single object if only one result
      if (!Array.isArray(processes)) {
        processes = [processes];
      }
    } catch (e) {
       log("loop", "Failed to parse process list JSON", { error: String(e) });
       return;
    }

    const myPid = process.pid;
    const parentMap = new Map<number, number>();
    const opencodePids: number[] = [];

    // Build process tree map and find targets
    for (const p of processes) {
      if (p && typeof p.ProcessId === 'number') {
        parentMap.set(p.ProcessId, p.ParentProcessId);
        // Case-insensitive check for opencode.exe
        if (p.Name && typeof p.Name === 'string' && p.Name.toLowerCase() === 'opencode.exe') {
          opencodePids.push(p.ProcessId);
        }
      }
    }

    const pidsToKill: number[] = [];

    // Filter for descendants of current process
    for (const pid of opencodePids) {
      let current = pid;
      let isDescendant = false;
      const visited = new Set<number>(); // Prevent infinite loops

      // Traverse up the parent chain
      while (current && current !== 0 && !visited.has(current)) {
        visited.add(current);
        const parent = parentMap.get(current);
        if (!parent) break;

        if (parent === myPid) {
          isDescendant = true;
          break;
        }
        current = parent;
      }

      if (isDescendant) {
        pidsToKill.push(pid);
      }
    }

    if (pidsToKill.length > 0) {
      log("loop", `Terminating ${pidsToKill.length} opencode.exe descendants`, { pids: pidsToKill });
      
      // Kill each identified descendant
      for (const pid of pidsToKill) {
        try {
           // Use taskkill for robust termination on Windows
           const killProc = Bun.spawn(["taskkill", "/F", "/PID", String(pid)], {
             stdout: "ignore",
             stderr: "ignore"
           });
           await killProc.exited;
        } catch (e) {
           log("loop", `Failed to kill PID ${pid}`, { error: String(e) });
        }
      }
    }

  } catch (error) {
    log("loop", "Error during process cleanup", { 
      error: error instanceof Error ? error.message : String(error) 
    });
  }
}

/**
 * Wait for a promise with a timeout.
 * Returns true if the promise resolved within the timeout, false otherwise.
 */
async function waitWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  description: string
): Promise<{ completed: boolean; result?: T }> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  
  const timeoutPromise = new Promise<{ completed: false }>((resolve) => {
    timeoutId = setTimeout(() => {
      log("loop", `${description} timed out after ${timeoutMs}ms`);
      resolve({ completed: false });
    }, timeoutMs);
  });
  
  try {
    const result = await Promise.race([
      promise.then(r => ({ completed: true as const, result: r })),
      timeoutPromise,
    ]);
    
    if (timeoutId) clearTimeout(timeoutId);
    return result;
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    throw error;
  }
}

export async function runLoop(
  options: LoopOptions,
  persistedState: PersistedState,
  callbacks: LoopCallbacks,
  signal: AbortSignal,
): Promise<void> {
  log("loop", "runLoop started", { planFile: options.planFile, model: options.model });

  const adapterName = options.adapter || "opencode-server";
  if (adapterName !== "opencode-server") {
    try {
      await runPtyLoop(adapterName, options, persistedState, callbacks, signal);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("loop", "ERROR in runLoop (pty)", { error: errorMessage });
      throw error;
    }
    return;
  }

  callbacks.onAdapterModeChanged?.("sdk");
  
  let server: { url: string; close(): void; attached: boolean } | null = null;
  
  // Track active subscription for explicit cleanup
  let activeSubscriptionController: AbortController | null = null;
  let activeSessionId: string | null = null;

  function createTimeoutlessFetch() {
    return (req: any) => {
      // @ts-ignore - Bun Request supports .timeout
      req.timeout = false;
      return fetch(req);
    };
  }
  
  /**
   * Cleanup function for graceful shutdown of sessions and server.
   * Called on completion, error, or abort.
   */
  async function cleanupServerAndSessions(reason: string): Promise<void> {
    log("loop", "Starting cleanup", { reason, hasServer: !!server, hasSession: !!activeSessionId });
    
    // Track whether we started the server (not attached to existing)
    const shouldForceCleanup = server && !server.attached;
    
    // 1. Abort active event subscription first
    if (activeSubscriptionController) {
      log("loop", "Aborting active event subscription");
      activeSubscriptionController.abort();
      activeSubscriptionController = null;
    }
    
    // 2. Give sessions a moment to clean up gracefully (100ms)
    if (activeSessionId) {
      log("loop", "Waiting for session cleanup", { sessionId: activeSessionId });
      await Bun.sleep(100);
      activeSessionId = null;
    }
    
    // 3. Close the server
    if (server) {
      log("loop", "Closing server", { attached: server.attached });
      try {
        server.close();
        log("loop", "Server close called successfully");
      } catch (error) {
        log("loop", "Error closing server", { 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
      
      // 4. Wait briefly for graceful server shutdown (500ms)
      await Bun.sleep(500);
      
      // 5. On Windows, force terminate any remaining processes (only if we started the server)
      if (process.platform === "win32" && shouldForceCleanup) {
        log("loop", "Windows: checking for orphaned opencode processes");
        await forceTerminateOpencodeProcesses();
      }
      
      server = null;
    }
    
    log("loop", "Cleanup complete", { reason });
  }

  try {
    // Get or create opencode server (attach if already running)
    log("loop", "Creating opencode server...");
    server = await getOrCreateOpencodeServer({ 
      signal, 
      port: DEFAULT_PORT,
      serverUrl: options.serverUrl,
      serverTimeoutMs: options.serverTimeoutMs,
    });
    log("loop", "Server ready", { url: server.url, attached: server.attached });
    
    const client = createOpencodeClient({ baseUrl: server.url, fetch: createTimeoutlessFetch() } as any);
    log("loop", "Client created");

    // Initialize iteration counter from persisted state
    let iteration = persistedState.iterationTimes.length;
    // Check if pause file exists at startup - if so, start in paused state
    // to avoid calling onPause() callback (which would override "ready" status)
    const pauseFileExistsAtStart = await Bun.file(".ralph-pause").exists();
    const pauseState: PauseState = { value: pauseFileExistsAtStart };
    let previousCommitCount = await getCommitsSince(persistedState.initialCommitHash);
    
    // Error tracking for exponential backoff (local, not persisted)
    const errorHandler = new ErrorHandler(options.errorHandling || {
      strategy: 'retry',
      maxRetries: 3,
      retryDelayMs: 5000,
      backoffMultiplier: 2,
    });
    
    log("loop", "Initial state", { iteration, previousCommitCount });

    // Main loop
    while (!signal.aborted) {
      // Check for .ralph-done file at start of each iteration
      if (await checkAndHandleDoneFile(options.planFile, options.debug, callbacks)) {
        break;
      }

      // Check for .ralph-pause file
      if (await waitWhilePaused(pauseState, callbacks, signal)) {
        if (signal.aborted) break;
        continue;
      }

      // Iteration start (10.11)
      iteration++;
      const iterationStartTime = Date.now();
      log("loop", "Iteration starting", { iteration });
      callbacks.onIterationStart(iteration);
      if (signal.aborted) break;

      try {
        // Add separator event for new iteration
        callbacks.onEvent({
          iteration,
          type: "separator",
          text: `iteration ${iteration}`,
          timestamp: iterationStartTime,
        });

        // Add spinner event (will be kept at end of array and removed when iteration completes)
        callbacks.onEvent({
          iteration,
          type: "spinner",
          text: "looping...",
          timestamp: iterationStartTime,
        });

        // Parse plan and update task counts (10.12)
        // Skip plan file validation in debug mode - plan file is optional
        if (!options.debug) {
          log("loop", "Parsing plan file");
          const { done, total } = await parsePlan(options.planFile);
          log("loop", "Plan parsed", { done, total });
          callbacks.onTasksUpdated(done, total);
        } else {
          log("loop", "Debug mode: skipping plan file validation");
        }

        // Parse model and build prompt before session creation
        const promptText = applySteeringContext(await buildPrompt(options));
        const { providerID, modelID } = parseModel(options.model);

        // Create session (10.13)
        log("loop", "Creating session...");
        const sessionResult = await client.session.create();
        if (!sessionResult.data) {
          log("loop", "ERROR: Failed to create session");
          throw new Error("Failed to create session");
        }
        const sessionId = sessionResult.data.id;
        activeSessionId = sessionId; // Track for cleanup
        log("loop", "Session created", { sessionId });

        // Track whether current session is active (for steering mode guard)
        let sessionActive = true;

        // Create sendMessage function for steering mode
        const sendMessage = async (message: string): Promise<void> => {
          // Guard: check for active session before sending
          if (!sessionActive) {
            log("loop", "Cannot send steering message: no active session");
            throw new Error("No active session");
          }
          log("loop", "Sending steering message", { sessionId, message: message.slice(0, 50) });
          await client.session.prompt({
            path: { id: sessionId },
            body: {
              parts: [{ type: "text", text: message }],
              model: { providerID, modelID },
              ...(options.agent && { agent: options.agent }),
            },
          });
        };

        // Call onSessionCreated callback with session info
        callbacks.onSessionCreated?.({
          sessionId,
          serverUrl: server!.url,
          attached: server!.attached,
          sendMessage,
        });

        // Subscribe to events - the SSE connection is established when we start iterating
        // Use a local AbortController so we can abort the subscription explicitly on completion
        log("loop", "Subscribing to events...");
        activeSubscriptionController = new AbortController();
        const subscriptionSignal = activeSubscriptionController.signal;
        
        // Also abort if parent signal is aborted
        if (signal.aborted) {
          activeSubscriptionController.abort();
        }
        signal.addEventListener("abort", () => {
          activeSubscriptionController?.abort();
        }, { once: true });
        
        const events = await client.event.subscribe({ signal: subscriptionSignal });

        let promptSent = false;

        // Set idle state while waiting for LLM response
        callbacks.onIdleChanged(true);

        let receivedFirstEvent = false;
        // Track streamed text parts by ID - stores text we've already logged
        // so we only emit complete lines, not every streaming delta
        const loggedTextByPartId = new Map<string, string>();
        
        for await (const event of events.stream) {
          await waitWhilePaused(pauseState, callbacks, signal);
          if (signal.aborted || subscriptionSignal.aborted) break;

          // When SSE connection is established, send the prompt
          // This ensures we don't miss any events due to race conditions
          if (event.type === "server.connected" && !promptSent) {
            promptSent = true;
            log("loop", "Sending prompt", { providerID, modelID });

            // Fire prompt in background - don't block event loop
            client.session.prompt({
              path: { id: sessionId },
              body: {
                parts: [{ type: "text", text: promptText }],
                model: { providerID, modelID },
                ...(options.agent && { agent: options.agent }),
              },
            }).catch((e) => {
              log("loop", "Prompt error", { error: String(e) });
            });

            continue;
          }

          if (signal.aborted || subscriptionSignal.aborted) break;

          // Filter events for current session ID
          if (event.type === "message.part.updated") {
            const part = event.properties.part;
            if (part.sessionID !== sessionId) continue;

            // Tool event mapping (10.16)
            if (part.type === "tool" && part.state.status === "completed") {
              // Set isIdle to false when first tool event arrives
              if (!receivedFirstEvent) {
                receivedFirstEvent = true;
                callbacks.onIdleChanged(false);
              }
              
              const toolName = part.tool;
              const input = part.state.input;
              const title =
                part.state.title ||
                (Object.keys(input).length > 0
                  ? JSON.stringify(input)
                  : "Unknown");

              // Extract detail based on tool type
              // For file tools: use filePath or path
              // For bash: use command
              // For others: compact JSON of args
              let detail: string | undefined;
              if (input.filePath) {
                detail = String(input.filePath);
              } else if (input.path) {
                detail = String(input.path);
              } else if (input.command) {
                detail = String(input.command);
              } else if (Object.keys(input).length > 0) {
                // Compact JSON for other tools with args
                detail = JSON.stringify(input);
              }

              // Mark file read tools as verbose (dimmed display)
              const isFileRead = toolName === "read";

              log("loop", "Tool completed", { toolName, title, detail });
              callbacks.onEvent({
                iteration,
                type: "tool",
                icon: toolName,
                text: title,
                timestamp: part.state.time.end,
                detail,
                verbose: isFileRead,
              });
            }

            // Reasoning/thought event - capture LLM text responses
            // Only emit complete lines to avoid noisy streaming updates
            if (part.type === "text" && part.text) {
              // Set isIdle to false when first event arrives
              if (!receivedFirstEvent) {
                receivedFirstEvent = true;
                callbacks.onIdleChanged(false);
              }

              const partId = part.id;
              const previouslyLogged = loggedTextByPartId.get(partId) || "";
              const fullText = part.text;
              
              // Find new content that hasn't been logged yet
              const newContent = fullText.slice(previouslyLogged.length);
              
              // Split into lines - only emit lines that are complete (have \n after them)
              const lines = newContent.split("\n");
              
              // Process all complete lines (all except the last one which may be partial)
              for (let i = 0; i < lines.length - 1; i++) {
                const line = lines[i].trim();
                if (line) {
                  // Truncate long lines for display
                  const truncated = line.length > 80 
                    ? line.slice(0, 77) + "..." 
                    : line;
                  
                  log("loop", "Reasoning", { text: truncated });
                  callbacks.onEvent({
                    iteration,
                    type: "reasoning",
                    icon: "thought",
                    text: truncated,
                    timestamp: Date.now(),
                    verbose: true,
                  });
                }
              }
              
              // Update tracked position to include all complete lines we've logged
              // Keep partial last line for next update
              const completedLength = previouslyLogged.length + 
                (lines.length > 1 ? newContent.lastIndexOf("\n") + 1 : 0);
              if (completedLength > previouslyLogged.length) {
                loggedTextByPartId.set(partId, fullText.slice(0, completedLength));
              }
            }

            // Step finish event - extract token usage data
            if (part.type === "step-finish" && callbacks.onTokens) {
              const tokens = part.tokens;
              log("loop", "Step finished with tokens", {
                input: tokens.input,
                output: tokens.output,
                reasoning: tokens.reasoning,
                cacheRead: tokens.cache.read,
                cacheWrite: tokens.cache.write,
              });
              callbacks.onTokens({
                input: tokens.input,
                output: tokens.output,
                reasoning: tokens.reasoning,
                cacheRead: tokens.cache.read,
                cacheWrite: tokens.cache.write,
              });
            }
          }

          // Session completion detection (10.17)
          if (event.type === "session.idle" && event.properties.sessionID === sessionId) {
            log("loop", "Session idle, breaking event loop");
            sessionActive = false;
            activeSessionId = null; // Clear tracked session
            activeSubscriptionController = null; // Clear subscription controller
            callbacks.onSessionEnded?.(sessionId);
            break;
          }

          // Session error handling (10.18)
          if (event.type === "session.error") {
            const props = event.properties;
            if (props.sessionID !== sessionId || !props.error) continue;
            
            // Extract error message from error object
            let errorMessage = String(props.error.name);
            if ("data" in props.error && props.error.data && "message" in props.error.data) {
              errorMessage = String(props.error.data.message);
            }
            
            log("loop", "Session error", { errorMessage });
            sessionActive = false;
            activeSessionId = null; // Clear tracked session
            activeSubscriptionController = null; // Clear subscription controller
            callbacks.onSessionEnded?.(sessionId);
            throw new Error(errorMessage);
          }

          // Plan file modification detection (for real-time task updates)
          // Handles both file.edited (agent writes) and file.watcher.updated (external changes)
          if (event.type === "file.edited" || event.type === "file.watcher.updated") {
            const filePath = event.properties.file;
            // Match against plan file - handles both relative and absolute paths
            // Uses endsWith to handle cases where event provides absolute path
            const planFileName = options.planFile.split(/[/\\]/).pop() || options.planFile;
            if (filePath === options.planFile || 
                filePath.endsWith(`/${planFileName}`) || 
                filePath.endsWith(`\\${planFileName}`)) {
              log("loop", "Plan file modified", { filePath, eventType: event.type });
              callbacks.onPlanFileModified?.();
            }
          }
        }

        // Iteration completion (10.19)
        const iterationDuration = Date.now() - iterationStartTime;
        const totalCommits = await getCommitsSince(persistedState.initialCommitHash);
        const commitsThisIteration = totalCommits - previousCommitCount;
        previousCommitCount = totalCommits;
        
        // Get diff stats
        const diffStats = await getDiffStats(persistedState.initialCommitHash);
        
        log("loop", "Iteration completed", { iteration, duration: iterationDuration, commits: commitsThisIteration, diff: diffStats });
        callbacks.onIterationComplete(iteration, iterationDuration, commitsThisIteration);
        callbacks.onCommitsUpdated(totalCommits);
        callbacks.onDiffUpdated(diffStats.added, diffStats.removed);

        // Reset error count on successful iteration
        errorHandler.clearRetryCount();
      } catch (iterationError) {
        // Handle iteration errors with retry logic
        if (signal.aborted) {
          // Don't retry if abort signal is set
          throw iterationError;
        }

        const context: ErrorContext = {
          iteration,
          error: iterationError as Error,
          timestamp: new Date(),
        };
        
        const result = errorHandler.handleError(context);
        log("loop", "Error handled", { result });
        
        if (result.strategy === 'retry' && result.shouldContinue) {
          callbacks.onError(iterationError instanceof Error ? iterationError.message : String(iterationError));
          callbacks.onBackoff?.(result.delayMs, Date.now() + result.delayMs);
          await Bun.sleep(result.delayMs);
          callbacks.onBackoffCleared?.();
          // Decrease iteration because we are retrying it
          iteration--;
          continue;
        }
        
        const errorMessage = result.message;
        log("loop", "Error in iteration", { error: errorMessage });
        callbacks.onError(errorMessage);
        
        if (result.strategy === 'abort') {
          throw iterationError;
        }
      }
    }

    
    log("loop", "Main loop exited", { aborted: signal.aborted });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log("loop", "ERROR in runLoop", { error: errorMessage });
    callbacks.onError(errorMessage);
    throw error;
  } finally {
    // Use the cleanup function for proper session and server termination
    await cleanupServerAndSessions("finally-block");
  }
}

async function runPtyLoop(
  adapterName: string,
  options: LoopOptions,
  persistedState: PersistedState,
  callbacks: LoopCallbacks,
  signal: AbortSignal,
): Promise<void> {
  await initializeAdapters();
  const adapter = getAdapter(adapterName);
  if (!adapter) {
    const message = `Unknown adapter: ${adapterName}`;
    callbacks.onError(message);
    throw new Error(message);
  }

  const available = await adapter.isAvailable();
  if (!available) {
    const message = `Adapter "${adapter.displayName}" is not available`;
    callbacks.onError(message);
    throw new Error(message);
  }

  callbacks.onAdapterModeChanged?.("pty");

  let iteration = persistedState.iterationTimes.length;
  const pauseFileExistsAtStart = await Bun.file(".ralph-pause").exists();
  const pauseState: PauseState = { value: pauseFileExistsAtStart };
  let previousCommitCount = await getCommitsSince(persistedState.initialCommitHash);
  let errorCount = 0;

  while (!signal.aborted) {
    if (await checkAndHandleDoneFile(options.planFile, options.debug, callbacks)) {
      break;
    }


    if (await waitWhilePaused(pauseState, callbacks, signal)) {
      if (signal.aborted) break;
      continue;
    }

    if (errorCount > 0) {
      const backoffMs = calculateBackoffMs(errorCount);
      const retryAt = Date.now() + backoffMs;
      log("loop", "Error backoff", { errorCount, backoffMs, retryAt });
      callbacks.onBackoff?.(backoffMs, retryAt);
      await Bun.sleep(backoffMs);
      callbacks.onBackoffCleared?.();
    }

    iteration++;
    const iterationStartTime = Date.now();
    log("loop", "Iteration starting", { iteration });
    callbacks.onIterationStart(iteration);
    if (signal.aborted) break;

    try {
      callbacks.onEvent({
        iteration,
        type: "separator",
        text: `iteration ${iteration}`,
        timestamp: iterationStartTime,
      });

      callbacks.onEvent({
        iteration,
        type: "spinner",
        text: "looping...",
        timestamp: iterationStartTime,
      });

      if (!options.debug) {
        log("loop", "Parsing plan file");
        const { done, total } = await parsePlan(options.planFile);
        log("loop", "Plan parsed", { done, total });
        callbacks.onTasksUpdated(done, total);
      } else {
        log("loop", "Debug mode: skipping plan file validation");
      }

      const promptText = applySteeringContext(await buildPrompt(options));

      const session = await adapter.execute({
        prompt: promptText,
        model: options.model,
        cwd: process.cwd(),
        signal,
        cols: process.stdout.columns || 80,
        rows: process.stdout.rows || 24,
      });

      let sessionActive = true;
      const sessionId = `pty-${Date.now()}`;
      const sendMessage = async (message: string): Promise<void> => {
        if (!sessionActive) {
          throw new Error("No active session");
        }
        session.send(message);
      };

      callbacks.onSessionCreated?.({
        sessionId,
        serverUrl: "",
        attached: false,
        sendMessage,
      });

      callbacks.onIdleChanged(true);
      let receivedOutput = false;

      for await (const event of session.events) {
        await waitWhilePaused(pauseState, callbacks, signal);
        if (signal.aborted) break;

        if (event.type === "output") {
          if (!receivedOutput) {
            receivedOutput = true;
            callbacks.onIdleChanged(false);
          }
          callbacks.onRawOutput?.(event.data);
        } else if (event.type === "exit") {
          sessionActive = false;
          callbacks.onSessionEnded?.(sessionId);
          break;
        } else if (event.type === "error") {
          sessionActive = false;
          callbacks.onSessionEnded?.(sessionId);
          callbacks.onError(event.message);
          throw new Error(event.message);
        }
      }

      if (sessionActive) {
        sessionActive = false;
        callbacks.onSessionEnded?.(sessionId);
      }

      const iterationDuration = Date.now() - iterationStartTime;
      const totalCommits = await getCommitsSince(persistedState.initialCommitHash);
      const commitsThisIteration = totalCommits - previousCommitCount;
      previousCommitCount = totalCommits;

      const diffStats = await getDiffStats(persistedState.initialCommitHash);

      log("loop", "Iteration completed", { iteration, duration: iterationDuration, commits: commitsThisIteration, diff: diffStats });
      callbacks.onIterationComplete(iteration, iterationDuration, commitsThisIteration);
      callbacks.onCommitsUpdated(totalCommits);
      callbacks.onDiffUpdated(diffStats.added, diffStats.removed);

      errorCount = 0;
    } catch (iterationError) {
      if (signal.aborted) {
        throw iterationError;
      }

      const errorMessage = iterationError instanceof Error ? iterationError.message : String(iterationError);
      errorCount++;
      log("loop", "Error in iteration", { error: errorMessage, errorCount });
      callbacks.onError(errorMessage);
    }
  }
}
