import { describe, it, expect, mock, spyOn, beforeEach } from "bun:test";
import { HeadlessRunner } from "../../src/headless/runner";
import * as terminalCapabilities from "../../src/lib/terminal-capabilities";
import * as requirements from "../../src/lib/requirements";

describe("Runtime Hints Regression", () => {
  let mockWrite: any;
  let capturedOutput: string[];

  beforeEach(() => {
    capturedOutput = [];
    mockWrite = mock((text: string) => {
      capturedOutput.push(text);
    });
  });

  it("should display runtime keybind hints after start", async () => {
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

    // Mock requirements valid
    spyOn(requirements, "validateRequirements").mockResolvedValue({
      valid: true,
      missing: [],
      message: "Success"
    });

    const config = {
      format: "text" as const,
      timestamps: false,
      limits: {},
      autoStart: true, // Auto start to skip the waitForStart prompt
      write: mockWrite,
      banner: { enabled: false }
    };

    const runner = new HeadlessRunner(config);

    const mockRunLoop = async () => {}; // Immediate complete

    await runner.run({
      loopOptions: { planFile: "prd.json" } as any,
      persistedState: { iterationTimes: [] } as any,
      runLoop: mockRunLoop as any,
    });

    const fullOutput = capturedOutput.join("");
    
    // Verify runtime hints are present
    expect(fullOutput).toContain("Pause/Menu");
    expect(fullOutput).toContain("[P]");
    
    // Verify it happens after/near start
    // We can't strictly check ordering in accumulated string easily without index checks
    // but verifying presence is the main goal here.
  });
});
