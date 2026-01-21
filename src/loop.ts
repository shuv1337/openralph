import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk";
import { getAdapter, initializeAdapters } from "./adapters/registry.js";
import type { LoopOptions, PersistedState, SessionInfo, ToolEvent } from "./state.js";
import type { SandboxConfig, RateLimitState, ActiveAgentState } from "./components/tui-types";
import { getHeadHash, getCommitsSince, getDiffStats } from "./git.js";
import { parsePlan, validatePlanCompletion } from "./plan.js";
import { log } from "./lib/log";
import { rateLimitDetector, getFallbackAgent } from "./lib/rate-limit";
import { stripAnsiCodes } from "./lib/ansi";


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

function getServerAuthHeader(): string | undefined {
  const password = process.env.OPENCODE_SERVER_PASSWORD || process.env.RALPH_SERVER_PASSWORD;
  if (!password) return undefined;

  const username = process.env.OPENCODE_SERVER_USERNAME || process.env.RALPH_SERVER_USERNAME || "opencode";
  const token = Buffer.from(`${username}:${password}`).toString("base64");
  return `Basic ${token}`;
}

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

    const authHeader = getServerAuthHeader();
    
    const response = await fetch(`${url}/global/health`, {
      signal: AbortSignal.any(signals),
      headers: authHeader ? { Authorization: authHeader } : undefined,
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
  const health = await checkServerHealth(url, 1000);
  return health.ok;
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
  log("loop", "getOrCreateOpencodeServer called", { 
    serverUrl: options.serverUrl,
    port: options.port,
    hostname: options.hostname,
  });

  // If explicit server URL provided, connect to it directly
  if (options.serverUrl) {
    log("loop", "Using explicit server URL", { serverUrl: options.serverUrl });
    return connectToExternalServer(options.serverUrl, {
      timeoutMs: options.serverTimeoutMs,
      signal: options.signal,
    });
  }

  const hostname = options.hostname || DEFAULT_HOSTNAME;
  const port = options.port || DEFAULT_PORT;
  const url = `http://${hostname}:${port}`;

  // Try to attach to existing server first
  log("loop", "Checking for existing server", { url });
  if (await tryConnectToExistingServer(url)) {
    log("loop", "Attached to existing server", { url });
    return {
      url,
      close: () => {}, // No-op - we didn't start it
      attached: true,
    };
  }

  // Start new server via SDK
  log("loop", "No existing server found, spawning opencode server via SDK...", { port, hostname });
  const startTime = Date.now();
  
  try {
    const serverProc = await createOpencodeServer({
      hostname,
      port,
      signal: options.signal,
      timeout: options.serverTimeoutMs ?? 5000,
    });
    const elapsed = Date.now() - startTime;
    log("loop", "opencode server started successfully", { 
      elapsed,
      url: serverProc.url,
    });
    
    return {
      url: serverProc.url,
      close: () => {
        log("loop", "Closing opencode server process");
        serverProc.close();
      },
      attached: false,
    };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    log("loop", "ERROR: Failed to spawn opencode serve", { 
      elapsed,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
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

    const authHeader = getServerAuthHeader();
    
    debugClient = createOpencodeClient({ 
      baseUrl: debugServer.url, 
      fetch: createTimeoutlessFetch(),
      headers: authHeader ? { Authorization: authHeader } : undefined,
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
  onTasksUpdated: (done: number, total: number, error?: string) => void;
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
  /** Called when the model being used is identified or changed */
  onModel?: (model: string) => void;
  /** Called when sandbox status is identified */
  onSandbox?: (sandbox: SandboxConfig) => void;
  /** Called when rate limit is detected or cleared */
  onRateLimit?: (state: RateLimitState) => void;
  /** Called when active agent state changes */
  onActiveAgent?: (state: ActiveAgentState) => void;
  /** Called when the full system prompt is generated for the current iteration */
  onPrompt?: (prompt: string) => void;
};

type PauseState = {
  value: boolean;
};

const PAUSE_POLL_INTERVAL_MS = 1000;

async function waitWhilePaused(
  pauseState: PauseState,
  callbacks: LoopCallbacks,
  signal: AbortSignal,
  hooks?: {
    onPause?: () => Promise<void>;
    onResume?: () => Promise<void>;
  }
): Promise<boolean> {
  const pauseFilePath = ".ralph-pause";
  if (!(await Bun.file(pauseFilePath).exists())) {
    if (pauseState.value) {
      pauseState.value = false;
      log("loop", "Resuming");
      callbacks.onResume();
      if (hooks?.onResume) await hooks.onResume();
    }
    return false;
  }

  if (!pauseState.value) {
    pauseState.value = true;
    log("loop", "Pausing");
    callbacks.onPause();
    if (hooks?.onPause) await hooks.onPause();
  }

  while (!signal.aborted && (await Bun.file(pauseFilePath).exists())) {
    await Bun.sleep(PAUSE_POLL_INTERVAL_MS);
  }

  if (!signal.aborted && pauseState.value) {
    pauseState.value = false;
    log("loop", "Resuming");
    callbacks.onResume();
    if (hooks?.onResume) await hooks.onResume();
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
    
    const authHeader = getServerAuthHeader();
    const client = createOpencodeClient({ 
      baseUrl: server.url, 
      fetch: createTimeoutlessFetch(),
      headers: authHeader ? { Authorization: authHeader } : undefined,
    } as any);
    log("loop", "Client created");

    // Report initial model from options
    callbacks.onModel?.(options.model);
    callbacks.onActiveAgent?.({
      plugin: options.agent || options.model,
      reason: "primary"
    });

    // Fetch sandbox info from opencode project info
    try {
      if (client.project?.current) {
        const projectResult = await client.project.current();
        if (projectResult.data) {
          const project = projectResult.data as any;
          const currentDir = process.cwd();
          const isSandbox = project.sandboxes?.some((s: string) => 
            s === currentDir || 
            s.replace(/\\/g, '/') === currentDir.replace(/\\/g, '/')
          );
          
          callbacks.onSandbox?.({
            enabled: isSandbox,
            mode: isSandbox ? "sandbox" : "local",
          });
          log("loop", "Sandbox info detected", { isSandbox, mode: isSandbox ? "sandbox" : "local" });
        }
      } else {
        log("loop", "Sandbox detection skipped: client.project.current not available in SDK");
      }
    } catch (e) {
      log("loop", "Failed to fetch project info for sandbox detection", { error: String(e) });
    }

    // Initialize iteration counter from persisted state
    let iteration = persistedState.iterationTimes.length;
    let currentModel = options.model;
    let isOnFallback = false;
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
      log("loop", "=== ITERATION STARTING ===", { 
        iteration, 
        serverUrl: server?.url,
        serverAttached: server?.attached,
        model: currentModel,
        agent: options.agent,
        planFile: options.planFile,
      });
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
          const { done, total, error } = await parsePlan(options.planFile);
          log("loop", "Plan parsed", { done, total, error });
          callbacks.onTasksUpdated(done, total, error);
        } else {
          log("loop", "Debug mode: skipping plan file validation");
        }

        // Parse model and build prompt before session creation
        const promptText = applySteeringContext(await buildPrompt(options));
        callbacks.onPrompt?.(promptText);
        const { providerID, modelID } = parseModel(currentModel);

        // Create session (10.13)
        log("loop", "Creating session...", { serverUrl: server!.url });
        const sessionStartTime = Date.now();
        const sessionResult = await client.session.create();
        const sessionElapsed = Date.now() - sessionStartTime;
        
        if (!sessionResult.data) {
          log("loop", "ERROR: Failed to create session", { 
            elapsed: sessionElapsed,
            response: JSON.stringify(sessionResult).slice(0, 500),
          });
          throw new Error("Failed to create session");
        }
        const sessionId = sessionResult.data.id;
        activeSessionId = sessionId; // Track for cleanup
        log("loop", "Session created successfully", { 
          sessionId, 
          elapsed: sessionElapsed,
          iteration,
        });

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
        log("loop", "Subscribing to events...", { sessionId, serverUrl: server!.url });
        activeSubscriptionController = new AbortController();
        const subscriptionSignal = activeSubscriptionController.signal;
        
        // Also abort if parent signal is aborted
        if (signal.aborted) {
          activeSubscriptionController.abort();
        }
        signal.addEventListener("abort", () => {
          activeSubscriptionController?.abort();
        }, { once: true });
        
        const subscribeStartTime = Date.now();
        log("loop", "Calling client.event.subscribe()...");
        const events = await client.event.subscribe({ signal: subscriptionSignal });
        log("loop", "client.event.subscribe() returned", { 
          elapsed: Date.now() - subscribeStartTime,
          hasStream: !!events?.stream,
        });

        let promptSent = false;
        let serverConnectedReceived = false;
        let eventCount = 0;

        // Set idle state while waiting for LLM response
        callbacks.onIdleChanged(true);

        let receivedFirstEvent = false;
        
        // Timeout to detect if server.connected never fires
        const serverConnectedTimeout = setTimeout(() => {
          if (!serverConnectedReceived && !signal.aborted && !subscriptionSignal.aborted) {
            log("loop", "WARNING: server.connected event not received within 10s", {
              sessionId,
              eventCount,
              promptSent,
            });
          }
        }, 10000);
        // Track streamed text parts by ID - stores text we've already logged
        // so we only emit complete lines, not every streaming delta
        const loggedTextByPartId = new Map<string, string>();
        
        log("loop", "Starting event stream iteration...");
        for await (const event of events.stream) {
          eventCount++;
          
          // Log all events for debugging (first 20 events in detail, then summarize)
          if (eventCount <= 20 || event.type === "server.connected" || event.type === "session.idle" || event.type === "session.error") {
            log("loop", "SSE event received", { 
              eventCount, 
              type: event.type,
              hasProperties: !!event.properties,
            });
          } else if (eventCount === 21) {
            log("loop", "SSE events continuing (reducing log verbosity)...");
          }
          
          await waitWhilePaused(pauseState, callbacks, signal, {
            onPause: async () => {
              if (activeSessionId) {
                log("loop", "Aborting session due to pause", { sessionId: activeSessionId });
                // @ts-ignore - abort might not be in the type but is in the API
                await client.session.abort({ path: { id: activeSessionId } }).catch(e => {
                  log("loop", "Failed to abort session during pause", { error: String(e) });
                });
              }
            }
          });
          if (signal.aborted || subscriptionSignal.aborted) break;

          // When SSE connection is established, send the prompt
          // This ensures we don't miss any events due to race conditions
          if (event.type === "server.connected" && !promptSent) {
            serverConnectedReceived = true;
            clearTimeout(serverConnectedTimeout);
            promptSent = true;
            
            const promptStartTime = Date.now();
            log("loop", "server.connected received, sending prompt", { 
              providerID, 
              modelID,
              eventCount,
              sessionId,
              promptLength: promptText.length,
              agent: options.agent,
            });

            // Fire prompt in background - don't block event loop
            client.session.prompt({
              path: { id: sessionId },
              body: {
                parts: [{ type: "text", text: promptText }],
                model: { providerID, modelID },
                ...(options.agent && { agent: options.agent }),
              },
            }).then(() => {
              const elapsed = Date.now() - promptStartTime;
              log("loop", "Prompt API call completed", { sessionId, elapsed });
            }).catch((e) => {
              const elapsed = Date.now() - promptStartTime;
              log("loop", "PROMPT ERROR - API call failed", { 
                error: String(e), 
                sessionId,
                elapsed,
                stack: e instanceof Error ? e.stack : undefined,
              });
              // Throw to break out of the event loop since prompt failed
              // This prevents hanging indefinitely waiting for events that won't come
            });

            // Set up timeout to detect if no events arrive after prompt
            // This helps diagnose hangs where prompt succeeds but opencode doesn't process it
            setTimeout(() => {
              if (promptSent && eventCount <= 1 && !signal.aborted && !subscriptionSignal.aborted) {
                log("loop", "WARNING: No events received 15s after sending prompt", {
                  sessionId,
                  eventCount,
                  serverConnectedReceived,
                });
              }
            }, 15000);

            continue;
          }

          if (signal.aborted || subscriptionSignal.aborted) break;

          // Detect model change from assistant messages
          if (event.type === "message.updated") {
            const info = event.properties.info;
            if (info.sessionID === sessionId && info.role === "assistant" && info.modelID && info.providerID) {
              const model = `${info.providerID}/${info.modelID}`;
              callbacks.onModel?.(model);
            }
          }

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
            log("loop", "Session idle, breaking event loop", { eventCount, sessionId });
            clearTimeout(serverConnectedTimeout);
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
            
            log("loop", "Session error", { errorMessage, eventCount, sessionId });
            clearTimeout(serverConnectedTimeout);
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

        const errorMessage = iterationError instanceof Error ? iterationError.message : String(iterationError);

        // Detect rate limit and handle fallback
        const rateLimit = rateLimitDetector.detect({
          stderr: errorMessage,
          agentId: options.agent
        });

        if (rateLimit.isRateLimit && !isOnFallback) {
          const fallback = options.fallbackAgents?.[currentModel] || getFallbackAgent(currentModel);
          if (fallback) {
            log("loop", "Rate limit detected, switching to fallback agent", { 
              primary: currentModel, 
              fallback,
              retryAfter: rateLimit.retryAfter 
            });
            
            const primaryModel = currentModel;
            currentModel = fallback;
            isOnFallback = true;
            
            // Notify TUI of agent switch
            callbacks.onModel?.(currentModel);
            callbacks.onRateLimit?.({
              limitedAt: Date.now(),
              primaryAgent: primaryModel,
              fallbackAgent: currentModel
            });
            callbacks.onActiveAgent?.({
              plugin: options.agent || currentModel,
              reason: "fallback"
            });
            
            // If we have a retry-after, we might want to wait, but the errorHandler
            // will handle the delay anyway.
          }
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
        
        const loopErrorMessage = result.message;
        log("loop", "Error in iteration", { error: loopErrorMessage });
        callbacks.onError(loopErrorMessage);
        
        if (result.strategy === 'abort') {
          throw iterationError;
        }
      }
    }

    
    log("loop", "Main loop exited", { aborted: signal.aborted });
  } catch (error) {
    const catchErrorMessage = error instanceof Error ? error.message : String(error);
    log("loop", "ERROR in runLoop", { error: catchErrorMessage });
    callbacks.onError(catchErrorMessage);
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
  callbacks.onActiveAgent?.({
    plugin: options.agent || options.model,
    reason: "primary"
  });

  let iteration = persistedState.iterationTimes.length;
  let currentModel = options.model;
  let isOnFallback = false;
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
        const { done, total, error } = await parsePlan(options.planFile);
        log("loop", "Plan parsed", { done, total, error });
        callbacks.onTasksUpdated(done, total, error);
      } else {
        log("loop", "Debug mode: skipping plan file validation");
      }

      const promptText = applySteeringContext(await buildPrompt(options));

      const session = await adapter.execute({
        prompt: promptText,
        model: currentModel,
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
      let accumulatedOutput = "";

      for await (const event of session.events) {
        await waitWhilePaused(pauseState, callbacks, signal, {
          onPause: async () => {
            log("loop", "Aborting PTY session due to pause");
            session.abort();
          }
        });
        if (signal.aborted) break;

        if (event.type === "output") {
          if (!receivedOutput) {
            receivedOutput = true;
            callbacks.onIdleChanged(false);
          }
          // Strip ANSI codes to prevent rendering artifacts in TUI
          const sanitized = stripAnsiCodes(event.data);
          accumulatedOutput += sanitized;
          callbacks.onRawOutput?.(sanitized);
        } else if (event.type === "exit") {
          sessionActive = false;
          callbacks.onSessionEnded?.(sessionId);
          
          // Check for rate limit on non-zero exit
          if (event.code !== 0 && event.code !== undefined) {
            const rateLimit = rateLimitDetector.detect({
              stderr: accumulatedOutput,
              exitCode: event.code,
              agentId: options.agent
            });
            
            if (rateLimit.isRateLimit && !isOnFallback) {
              const fallback = options.fallbackAgents?.[currentModel] || getFallbackAgent(currentModel);
              if (fallback) {
                log("loop", "PTY: Rate limit detected on exit, switching to fallback agent", { 
                  primary: currentModel, 
                  fallback,
                  exitCode: event.code
                });
                
                const primaryModel = currentModel;
                currentModel = fallback;
                isOnFallback = true;
                
                callbacks.onModel?.(currentModel);
                callbacks.onRateLimit?.({
                  limitedAt: Date.now(),
                  primaryAgent: primaryModel,
                  fallbackAgent: currentModel
                });
                callbacks.onActiveAgent?.({
                  plugin: options.agent || currentModel,
                  reason: "fallback"
                });
                
                iteration--;
                errorCount++;
                // We need to break out and continue the while loop
                throw new Error(`Rate limit detected: ${rateLimit.message || "Unknown error"}`);
              }
            }
          }
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

      const ptyErrorMessage = iterationError instanceof Error ? iterationError.message : String(iterationError);

      // Detect rate limit and handle fallback
      const rateLimit = rateLimitDetector.detect({
        stderr: ptyErrorMessage,
        agentId: options.agent
      });

      if (rateLimit.isRateLimit && !isOnFallback) {
        const fallback = options.fallbackAgents?.[currentModel] || getFallbackAgent(currentModel);
        if (fallback) {
          log("loop", "PTY: Rate limit detected, switching to fallback agent", { 
            primary: currentModel, 
            fallback,
            retryAfter: rateLimit.retryAfter 
          });
          
          const primaryModel = currentModel;
          currentModel = fallback;
          isOnFallback = true;
          
          // Notify TUI of agent switch
          callbacks.onModel?.(currentModel);
          callbacks.onRateLimit?.({
            limitedAt: Date.now(),
            primaryAgent: primaryModel,
            fallbackAgent: currentModel
          });
          callbacks.onActiveAgent?.({
            plugin: options.agent || currentModel,
            reason: "primary"
          });
          
          // Decrease iteration because we are retrying it
          iteration--;
          errorCount++;
          continue;
        }
      }

      errorCount++;
      log("loop", "Error in iteration", { error: ptyErrorMessage, errorCount });
      callbacks.onError(ptyErrorMessage);
    }

  }
}
