import { describe, it, expect, mock, spyOn, beforeEach } from "bun:test";
import { HeadlessRunner } from "../../src/headless/runner";
import * as terminalCapabilities from "../../src/lib/terminal-capabilities";
import * as requirements from "../../src/lib/requirements";

describe("Keybind Hints Regression", () => {
  let mockWrite: any;
  let capturedOutput: string[];

  beforeEach(() => {
    capturedOutput = [];
    mockWrite = mock((text: string) => {
      capturedOutput.push(text);
    });
  });

  it("should display keybind hints in the start prompt", async () => {
    // Simulate interactive terminal
    spyOn(terminalCapabilities, "getCapabilities").mockReturnValue({
      isInteractive: true,
      isCI: false,
      supportsColor: false,
      supportsUnicode: false,
      tier: "basic_ansi",
    } as any);

    // Mock stdin.isTTY to true
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true
    });

    // Mock requirements as valid so we reach the start prompt
    spyOn(requirements, "validateRequirements").mockResolvedValue({
      valid: true,
      missing: [],
      message: "Success"
    });

    const config = {
      format: "text" as const,
      timestamps: false,
      limits: {},
      autoStart: false, // We want it to wait so we can see the prompt
      write: mockWrite,
      banner: { enabled: false }
    };

    const runner = new HeadlessRunner(config);

    // We only want to test the waitForStart part, but runner.run calls it.
    // Since waitForStart is private and returns a Promise that waits for stdin,
    // we need to mock stdin.on to simulate a keypress.
    
    const stdinOnSpy = spyOn(process.stdin, "on");
    let dataCallback: ((data: Buffer) => void) | undefined;

    stdinOnSpy.mockImplementation((event: string, callback: any) => {
      if (event === "data") {
        dataCallback = callback;
      }
      return process.stdin;
    });

    // Run the runner in the background
    const runPromise = runner.run({
      loopOptions: { planFile: "prd.json" } as any,
      persistedState: { iterationTimes: [] } as any,
      runLoop: (async () => {}) as any,
    });

    // Wait a bit for the prompt to be written
    await new Promise(resolve => setTimeout(resolve, 50));

    const fullOutput = capturedOutput.join("");
    
    // Verify the prompt contains our new keybind hints
    expect(fullOutput).toContain("Interrupt");
    expect(fullOutput).toContain("Terminal");
    expect(fullOutput).toContain("Force Quit");
    
    // Verify it doesn't contain Pause/Quit in the hints section (they are in the main prompt)
    // The hints section is expected to be separate.
    // Our startup hints exclude "pause" and "quit".
    expect(fullOutput).toContain("[P] to start");
    expect(fullOutput).toContain("[Q] to quit");
    
    // Simulate 'p' keypress to start and let the runner finish
    if (dataCallback) {
      dataCallback(Buffer.from("p"));
    }

    await runPromise;
  });
});
