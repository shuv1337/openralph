import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnPty } from "../../src/pty/spawn";

describe("spawnPty", () => {
  let originalSpawn: typeof Bun.spawn;

  beforeEach(() => {
    originalSpawn = Bun.spawn;
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
  });

  it("spawns with PTY settings and drains output", async () => {
    let capturedOptions: any;
    const outputChunks: string[] = [];
    let terminalData: ((terminal: unknown, data: Uint8Array) => void) | undefined;

    Bun.spawn = ((command: string[], options: any) => {
      capturedOptions = options;
      terminalData = options.terminal?.data;
      return {
        terminal: {
          write: (_data: string) => {},
          resize: (_cols: number, _rows: number) => {},
          close: () => {},
        },
        stdout: null,
        stderr: null,
        stdin: null,
        pid: 123,
        kill: () => {},
        exited: Promise.resolve(0),
      } as any;
    }) as any;

    const pty = spawnPty(["echo", "hi"], {
      cols: 100,
      rows: 40,
      cwd: "/tmp",
      env: { FOO: "bar" },
    });

    pty.onData((data) => outputChunks.push(data));

    // The data callback now receives Uint8Array, which spawnPty decodes to string
    const encoder = new TextEncoder();
    terminalData?.({} as any, encoder.encode("out"));
    terminalData?.({} as any, encoder.encode("err"));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(capturedOptions.terminal.cols).toBe(100);
    expect(capturedOptions.terminal.rows).toBe(40);
    expect(capturedOptions.env.TERM).toBe("xterm-256color");
    expect(capturedOptions.env.COLUMNS).toBe("100");
    expect(capturedOptions.env.LINES).toBe("40");
    expect(outputChunks.join("")).toBe("outerr");
  });
});

describe("spawnPty environment variables", () => {
  let originalSpawn: typeof Bun.spawn;
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalSpawn = Bun.spawn;
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it("should set TERM to xterm-256color", async () => {
    let capturedEnv: any;

    Bun.spawn = ((command: string[], options: any) => {
      capturedEnv = options.env;
      return {
        terminal: { write: () => {}, resize: () => {}, close: () => {} },
        stdout: null,
        stderr: null,
        stdin: null,
        pid: 123,
        kill: () => {},
        exited: Promise.resolve(0),
      } as any;
    }) as any;

    spawnPty(["test"], {});

    expect(capturedEnv.TERM).toBe("xterm-256color");
  });

  it("should set COLUMNS and LINES from cols/rows options", async () => {
    let capturedEnv: any;

    Bun.spawn = ((command: string[], options: any) => {
      capturedEnv = options.env;
      return {
        terminal: { write: () => {}, resize: () => {}, close: () => {} },
        stdout: null,
        stderr: null,
        stdin: null,
        pid: 123,
        kill: () => {},
        exited: Promise.resolve(0),
      } as any;
    }) as any;

    spawnPty(["test"], { cols: 120, rows: 30 });

    expect(capturedEnv.COLUMNS).toBe("120");
    expect(capturedEnv.LINES).toBe("30");
  });

  it("should use default cols/rows when not specified", async () => {
    let capturedEnv: any;

    Bun.spawn = ((command: string[], options: any) => {
      capturedEnv = options.env;
      return {
        terminal: { write: () => {}, resize: () => {}, close: () => {} },
        stdout: null,
        stderr: null,
        stdin: null,
        pid: 123,
        kill: () => {},
        exited: Promise.resolve(0),
      } as any;
    }) as any;

    spawnPty(["test"], {});

    expect(capturedEnv.COLUMNS).toBe("80"); // default cols
    expect(capturedEnv.LINES).toBe("24"); // default rows
  });

  it("should merge custom env variables", async () => {
    let capturedEnv: any;

    Bun.spawn = ((command: string[], options: any) => {
      capturedEnv = options.env;
      return {
        terminal: { write: () => {}, resize: () => {}, close: () => {} },
        stdout: null,
        stderr: null,
        stdin: null,
        pid: 123,
        kill: () => {},
        exited: Promise.resolve(0),
      } as any;
    }) as any;

    spawnPty(["test"], { env: { CUSTOM_VAR: "custom_value" } });

    expect(capturedEnv.CUSTOM_VAR).toBe("custom_value");
    expect(capturedEnv.TERM).toBe("xterm-256color"); // Still set
  });
});

describe("spawnPty process lifecycle", () => {
  let originalSpawn: typeof Bun.spawn;

  beforeEach(() => {
    originalSpawn = Bun.spawn;
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
  });

  it("should provide pid from spawned process", () => {
    Bun.spawn = ((_command: string[], _options: any) => {
      return {
        terminal: { write: () => {}, resize: () => {}, close: () => {} },
        stdout: null,
        stderr: null,
        stdin: null,
        pid: 12345,
        kill: () => {},
        exited: Promise.resolve(0),
      } as any;
    }) as any;

    const pty = spawnPty(["test"], {});

    expect(pty.pid).toBe(12345);
  });

  it("should call onExit callbacks when process exits", async () => {
    let exitResolve: (code: number) => void;
    const exitPromise = new Promise<number>((resolve) => {
      exitResolve = resolve;
    });

    Bun.spawn = ((_command: string[], _options: any) => {
      return {
        terminal: { write: () => {}, resize: () => {}, close: () => {} },
        stdout: null,
        stderr: null,
        stdin: null,
        pid: 123,
        kill: () => {},
        exited: exitPromise,
      } as any;
    }) as any;

    const pty = spawnPty(["test"], {});

    let exitInfo: { exitCode: number; signal?: number } | null = null;
    pty.onExit((info) => {
      exitInfo = info;
    });

    exitResolve!(42);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(exitInfo).not.toBeNull();
    expect(exitInfo!.exitCode).toBe(42);
  });

  it("should have cleanup method that can be called multiple times", () => {
    Bun.spawn = ((_command: string[], _options: any) => {
      return {
        terminal: { write: () => {}, resize: () => {}, close: () => {} },
        stdout: null,
        stderr: null,
        stdin: null,
        pid: 123,
        kill: () => {},
        exited: Promise.resolve(0),
      } as any;
    }) as any;

    const pty = spawnPty(["test"], {});

    // Should not throw when called multiple times
    expect(() => {
      pty.cleanup();
      pty.cleanup();
      pty.cleanup();
    }).not.toThrow();
  });

  it("should not send data after cleanup", async () => {
    const dataCallbacks: string[] = [];
    let terminalData: ((terminal: unknown, data: Uint8Array) => void) | undefined;

    Bun.spawn = ((_command: string[], options: any) => {
      terminalData = options.terminal?.data;
      return {
        terminal: { write: () => {}, resize: () => {}, close: () => {} },
        stdout: null,
        stderr: null,
        stdin: null,
        pid: 123,
        kill: () => {},
        exited: Promise.resolve(0),
      } as any;
    }) as any;

    const pty = spawnPty(["test"], {});
    pty.onData((data) => dataCallbacks.push(data));

    // Send data before cleanup
    const encoder = new TextEncoder();
    terminalData?.({} as any, encoder.encode("before"));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dataCallbacks).toContain("before");

    // Cleanup
    pty.cleanup();

    // Send data after cleanup
    terminalData?.({} as any, encoder.encode("after"));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dataCallbacks).not.toContain("after");
  });
});

describe("spawnPty resize", () => {
  let originalSpawn: typeof Bun.spawn;

  beforeEach(() => {
    originalSpawn = Bun.spawn;
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
  });

  it("should call terminal resize when available", () => {
    let resizeCalled = false;
    let resizeCols = 0;
    let resizeRows = 0;

    Bun.spawn = ((_command: string[], _options: any) => {
      return {
        terminal: {
          write: () => {},
          resize: (cols: number, rows: number) => {
            resizeCalled = true;
            resizeCols = cols;
            resizeRows = rows;
          },
          close: () => {},
        },
        stdout: null,
        stderr: null,
        stdin: null,
        pid: 123,
        kill: () => {},
        exited: Promise.resolve(0),
      } as any;
    }) as any;

    const pty = spawnPty(["test"], {});
    pty.resize(200, 50);

    expect(resizeCalled).toBe(true);
    expect(resizeCols).toBe(200);
    expect(resizeRows).toBe(50);
  });
});

describe("spawnPty write", () => {
  let originalSpawn: typeof Bun.spawn;

  beforeEach(() => {
    originalSpawn = Bun.spawn;
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
  });

  it("should write to terminal when available", () => {
    let writtenData = "";

    Bun.spawn = ((_command: string[], _options: any) => {
      return {
        terminal: {
          write: (data: string) => {
            writtenData = data;
          },
          resize: () => {},
          close: () => {},
        },
        stdout: null,
        stderr: null,
        stdin: null,
        pid: 123,
        kill: () => {},
        exited: Promise.resolve(0),
      } as any;
    }) as any;

    const pty = spawnPty(["test"], {});
    pty.write("hello");

    expect(writtenData).toBe("hello");
  });

  it("should not write after cleanup", () => {
    let writeCount = 0;

    Bun.spawn = ((_command: string[], _options: any) => {
      return {
        terminal: {
          write: (_data: string) => {
            writeCount++;
          },
          resize: () => {},
          close: () => {},
        },
        stdout: null,
        stderr: null,
        stdin: null,
        pid: 123,
        kill: () => {},
        exited: Promise.resolve(0),
      } as any;
    }) as any;

    const pty = spawnPty(["test"], {});
    pty.write("before");
    expect(writeCount).toBe(1);

    pty.cleanup();
    pty.write("after");
    expect(writeCount).toBe(1); // Should not increase
  });
});
