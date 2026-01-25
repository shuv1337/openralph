import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { HeadlessRunner } from "../../src/headless/runner";
import { HeadlessExitCodes } from "../../src/headless/types";
import * as terminalCapabilities from "../../src/lib/terminal-capabilities";
import * as windowsConsole from "../../src/lib/windows-console";
import * as ansi from "../../src/lib/ansi";

describe("Headless Mode E2E Simulation", () => {
  let mockWrite: any;
  let capturedOutput: string[];

  beforeEach(() => {
    capturedOutput = [];
    mockWrite = mock((text: string) => {
      capturedOutput.push(text);
    });
  });

  it("should complete a full execution loop with banner re-renders", async () => {
    // Simulate interactive terminal with VT support
    spyOn(terminalCapabilities, "getCapabilities").mockReturnValue({
      isInteractive: true,
      isCI: false,
      tier: "truecolor",
    } as any);
    spyOn(windowsConsole, "isVTSupported").mockReturnValue(true);
    
    let clearCount = 0;
    spyOn(ansi, "clearTerminal").mockImplementation(() => {
      clearCount++;
      mockWrite(`[CLEAR_${clearCount}]`);
    });

    const config = {
      format: "text" as const,
      timestamps: false,
      limits: { maxIterations: 2 },
      autoStart: true,
      write: mockWrite,
      banner: { enabled: true, style: "plain" as const, text: "OpenRalph" }
    };

    const runner = new HeadlessRunner(config);

    const mockRunLoop = async (_opts: any, _state: any, callbacks: any) => {
      // Start
      callbacks.onIterationStart(1);
      callbacks.onEvent({ type: "tool", iteration: 1, text: "Tool 1", icon: "🛠️" });
      callbacks.onIterationComplete(1, 50, 1);
      
      // Next iteration
      callbacks.onIterationStart(2);
      callbacks.onEvent({ type: "tool", iteration: 2, text: "Tool 2", icon: "🛠️" });
      callbacks.onIterationComplete(2, 50, 2);
      
      // End
      callbacks.onComplete();
    };

    const exitCode = await runner.run({
      loopOptions: { planFile: "prd.json" } as any,
      persistedState: { iterationTimes: [] } as any,
      runLoop: mockRunLoop as any,
    });

    expect(exitCode).toBe(HeadlessExitCodes.SUCCESS);
    
    const fullOutput = capturedOutput.join("");
    
    // Verify clears happened
    expect(clearCount).toBe(3); // Start + 2 iteration completes
    
    // Verify banner appears after each clear
    const lines = fullOutput.split("[CLEAR_");
    expect(lines.length).toBe(4); // "" before CLEAR_1, then 3 sections
    
    expect(lines[1]).toContain("OpenRalph");
    expect(lines[2]).toContain("OpenRalph");
    expect(lines[3]).toContain("OpenRalph");
    
    // Verify tool events were rendered
    expect(fullOutput).toContain("Tool 1");
    expect(fullOutput).toContain("Tool 2");
    
    // Verify completion
    expect(fullOutput).toContain("DONE");
  });
});
