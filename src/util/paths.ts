/**
 * XDG Base Directory Specification support for ralph
 * https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

/**
 * XDG_STATE_HOME for user-specific state files (logs, history, etc).
 * Default: ~/.local/state
 */
export function getXdgStateHome(): string {
  return process.env.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state");
}

/**
 * Central logging directory following XDG spec.
 * Can be overridden via RALPH_LOG_DIR environment variable.
 *
 * Precedence:
 * - RALPH_LOG_DIR (explicit override)
 * - $XDG_STATE_HOME/ralph/logs (XDG compliant)
 * - ~/.local/state/ralph/logs (XDG default)
 */
export function getLogDir(): string {
  const override = process.env.RALPH_LOG_DIR?.trim();
  if (override) return override;
  return join(getXdgStateHome(), "ralph", "logs");
}

/**
 * Ensure the log directory exists, creating it if necessary.
 */
export function ensureLogDir(): string {
  const dir = getLogDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Get the path to the central log file.
 * Logs are stored in XDG state directory for persistence and easy monitoring.
 */
export function getLogFilePath(): string {
  return join(ensureLogDir(), "ralph.log");
}

/**
 * Get the path to a dated rolling log file (YYYY-MM-DD format).
 */
export function getRollingLogPath(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return join(ensureLogDir(), `ralph-${date}.log`);
}
