/**
 * Debug logging utility for ralph
 * 
 * Logs are written to XDG state directory for persistence and central monitoring.
 * Default: ~/.local/state/ralph/logs/ralph-YYYY-MM-DD.log
 * Override: RALPH_LOG_DIR environment variable
 */
import { appendFileSync, writeFileSync, existsSync } from "node:fs";
import { getRollingLogPath, ensureLogDir } from "./paths.js";

/**
 * Get the current log file path.
 * Uses rolling dated logs in XDG state directory.
 */
function getLogFile(): string {
  ensureLogDir();
  return getRollingLogPath();
}

/** @deprecated Use getLogFile() - kept for backward compatibility */
export const LOG_FILE = ".ralph.log";

let initialized = false;
let currentLogFile: string | null = null;
let memoryLogInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize the log file. Call with reset=true to clear existing logs.
 */
export function initLog(reset: boolean = false): void {
  currentLogFile = getLogFile();
  
  if (reset || !existsSync(currentLogFile)) {
    writeFileSync(
      currentLogFile,
      `=== Ralph Log Started: ${new Date().toISOString()} ===\n` +
      `=== Log Location: ${currentLogFile} ===\n`
    );
  } else {
    appendFileSync(
      currentLogFile,
      `\n=== Ralph Session Resumed: ${new Date().toISOString()} ===\n`
    );
  }
  initialized = true;
}

/**
 * Log a message with timestamp
 */
export function log(category: string, message: string, data?: unknown): void {
  if (!initialized) {
    initLog(false);
  }

  // Check if date rolled over (new day = new log file)
  const newLogFile = getLogFile();
  if (currentLogFile !== newLogFile) {
    currentLogFile = newLogFile;
    appendFileSync(
      currentLogFile,
      `\n=== Ralph Log Continued: ${new Date().toISOString()} ===\n`
    );
  }

  const timestamp = new Date().toISOString();
  let line = `[${timestamp}] [${category}] ${message}`;
  if (data !== undefined) {
    try {
      line += ` ${JSON.stringify(data)}`;
    } catch {
      line += ` [unstringifiable data]`;
    }
  }

  try {
    appendFileSync(currentLogFile!, line + "\n");
  } catch {
    // Silently fail if we can't write logs
  }
}

/**
 * Format bytes into human readable string (e.g., "123.4 MB")
 */
function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

/**
 * Log current memory usage
 * Logs heap used, heap total, RSS, and external memory.
 */
export function logMemory(label?: string): void {
  const mem = process.memoryUsage();
  const data = {
    heapUsed: formatBytes(mem.heapUsed),
    heapTotal: formatBytes(mem.heapTotal),
    rss: formatBytes(mem.rss),
    external: formatBytes(mem.external),
  };
  log("memory", label || "Memory usage", data);
}

/**
 * Start periodic memory logging at the specified interval.
 * @param intervalMs Interval in milliseconds between logs (default: 30000 = 30 seconds)
 */
export function startMemoryLogging(intervalMs: number = 30000): void {
  if (memoryLogInterval !== null) {
    return; // Already running
  }
  
  logMemory("Periodic memory logging started");
  memoryLogInterval = setInterval(() => {
    logMemory("Periodic snapshot");
  }, intervalMs);
}

/**
 * Stop periodic memory logging.
 */
export function stopMemoryLogging(): void {
  if (memoryLogInterval !== null) {
    clearInterval(memoryLogInterval);
    memoryLogInterval = null;
    logMemory("Periodic memory logging stopped");
  }
}

/**
 * Get the current log file path (for external monitoring tools)
 */
export function getCurrentLogPath(): string {
  return currentLogFile || getLogFile();
}
