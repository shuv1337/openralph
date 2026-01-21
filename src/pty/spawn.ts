import type { PtyProcess, PtyOptions } from "./types";
import { log } from "../lib/log";

export function spawnPty(command: string[], options: PtyOptions = {}): PtyProcess {
  const { cols = 80, rows = 24, cwd = process.cwd(), env = {} } = options;

  const dataCallbacks: Array<(data: string) => void> = [];
  const exitCallbacks: Array<(info: { exitCode: number; signal?: number }) => void> = [];
  let isCleanedUp = false;

  /**
   * Platform-specific environment variables for PTY spawning.
   * These ensure child processes have proper terminal context.
   */
  function getPlatformEnv(): Record<string, string> {
    const platform = process.platform;

    if (platform === "win32") {
      return {
        TERM: "xterm-256color",
        WT_SESSION: process.env.WT_SESSION || "",
        FORCE_COLOR: "1",
      };
    }

    if (platform === "darwin") {
      return {
        // Preserve macOS terminal program detection for child processes
        TERM_PROGRAM: process.env.TERM_PROGRAM || "",
        TERM_PROGRAM_VERSION: process.env.TERM_PROGRAM_VERSION || "",
        // Ensure UTF-8 encoding (macOS default, but be explicit)
        LANG: process.env.LANG || "en_US.UTF-8",
        LC_ALL: process.env.LC_ALL || "",
        // Force color output in child processes
        FORCE_COLOR: "1",
        // Preserve Ghostty detection if present
        GHOSTTY_RESOURCES_DIR: process.env.GHOSTTY_RESOURCES_DIR || "",
      };
    }

    // Linux - minimal additions
    return {
      FORCE_COLOR: "1",
    };
  }

  const platformEnv = getPlatformEnv();

  const combinedEnv = {
    ...process.env,
    ...platformEnv,
    ...env,
    TERM: "xterm-256color",
    COLUMNS: String(cols),
    LINES: String(rows),
  };

  const pushData = (data: string) => {
    if (isCleanedUp) return;
    for (const cb of dataCallbacks) {
      cb(data);
    }
  };

  let proc: ReturnType<typeof Bun.spawn>;
  let terminal: { write: (data: string) => void; resize?: (c: number, r: number) => void; close?: () => void } | null =
    null;

  const readStream = async (stream: ReadableStream<Uint8Array> | null | undefined, label: string) => {
    if (!stream) return;
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        if (text) {
          pushData(text);
        }
      }
    } catch (error) {
      log("pty", `${label} read error`, { error: String(error) });
    }
  };

  const decoder = new TextDecoder();

  try {
    proc = Bun.spawn(command, {
      cwd,
      env: combinedEnv,
      terminal: {
        cols,
        rows,
        data: (_terminal, data) => {
          // data is Uint8Array, decode to string
          pushData(decoder.decode(data, { stream: true }));
        },
      },
    });
    terminal = proc.terminal ?? null;
  } catch (error) {
    log("pty", "terminal spawn failed, falling back to pipe mode", { error: String(error) });
    // Fallback to pipe mode (not PTY, but better than nothing)
    proc = Bun.spawn(command, {
      cwd,
      env: combinedEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Only read streams if they are ReadableStream (not number)
    if (proc.stdout && typeof proc.stdout !== "number") {
      readStream(proc.stdout, "stdout");
    }
    if (proc.stderr && typeof proc.stderr !== "number") {
      readStream(proc.stderr, "stderr");
    }
  }

  proc.exited.then((exitCode) => {
    for (const cb of exitCallbacks) {
      cb({ exitCode });
    }
  });

  return {
    write: (data: string) => {
      if (isCleanedUp) return;
      try {
        if (terminal) {
          terminal.write(data);
        } else if (proc.stdin && typeof proc.stdin !== "number") {
          proc.stdin.write(data);
        }
      } catch (error) {
        log("pty", "stdin write error", { error: String(error) });
      }
    },
    resize: (newCols: number, newRows: number) => {
      if (terminal?.resize) {
        terminal.resize(newCols, newRows);
        return;
      }
      const stdinAny = proc.stdin as unknown as { resize?: (c: number, r: number) => void };
      if (typeof stdinAny.resize === "function") {
        stdinAny.resize(newCols, newRows);
      } else {
        log("pty", "resize requested but not supported", { cols: newCols, rows: newRows });
      }
    },
    kill: () => {
      if (isCleanedUp) return;
      try {
        if (process.platform === "win32") {
          // Use taskkill /F /T for recursive termination on Windows
          Bun.spawn(["taskkill", "/F", "/T", "/PID", String(proc.pid)], {
            stdout: "ignore",
            stderr: "ignore"
          });
        } else {
          proc.kill();
        }
      } catch (error) {
        log("pty", "kill error", { error: String(error) });
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
      if (terminal?.close) {
        try {
          terminal.close();
        } catch {
          // Ignore terminal close errors
        }
      }
      try {
        if (process.platform === "win32") {
          // Use taskkill /F /T for recursive termination on Windows
          Bun.spawn(["taskkill", "/F", "/T", "/PID", String(proc.pid)], {
            stdout: "ignore",
            stderr: "ignore"
          });
        } else {
          proc.kill();
        }
      } catch {
        // Process may already be dead
      }
    },
  };
}
