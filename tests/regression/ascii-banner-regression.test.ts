import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { HeadlessRunner } from "../../src/headless/runner";
import * as ansi from "../../src/lib/ansi";
import * as terminalCapabilities from "../../src/lib/terminal-capabilities";
import * as windowsConsole from "../../src/lib/windows-console";

describe("ASCII Banner Regression", () => {
  let mockWrite: any;
  let capturedOutput: string[];

  beforeEach(() => {
    capturedOutput = [];
    mockWrite = mock((text: string) => {
      capturedOutput.push(text);
    });
  });

  describe("Banner Re-rendering", () => {
    let clearTerminalSpy: any;
    let capsSpy: any;
    let vtSpy: any;

    beforeEach(() => {
      clearTerminalSpy = spyOn(ansi, "clearTerminal");
      capsSpy = spyOn(terminalCapabilities, "getCapabilities");
      vtSpy = spyOn(windowsConsole, "isVTSupported");
    });

    afterEach(() => {
      clearTerminalSpy.mockRestore();
      capsSpy.mockRestore();
      vtSpy.mockRestore();
    });

    it("should show banner after every iteration rebuffer", async () => {
      capsSpy.mockReturnValue({ isInteractive: true, isCI: false } as any);
      vtSpy.mockReturnValue(true);
      
      let clearCount = 0;
      clearTerminalSpy.mockImplementation(() => {
        clearCount++;
        mockWrite(`[CLEAR_${clearCount}]`);
      });

      const runner = new HeadlessRunner({
        format: "text",
        timestamps: false,
        limits: { maxIterations: 2 },
        autoStart: true,
        write: mockWrite,
        banner: { enabled: true, text: "OpenRalph" }
      });

      const mockRunLoop = mock(async (_opts: any, _state: any, callbacks: any) => {
        // Iteration 1
        callbacks.onIterationStart(1);
        callbacks.onIterationComplete(1, 100, 1);
        
        // Iteration 2
        callbacks.onIterationStart(2);
        callbacks.onIterationComplete(2, 100, 1);
        
        callbacks.onComplete();
      });

      await runner.run({
        loopOptions: {} as any,
        persistedState: { iterationTimes: [] } as any,
        runLoop: mockRunLoop as any,
      });

      const output = capturedOutput.join("");
      
      // We expect 3 clears: 1 at start, 1 after iteration 1, 1 after iteration 2
      expect(clearCount).toBe(3);
      
      // We expect "OpenRalph" to appear after each clear
      const clear1Idx = output.indexOf("[CLEAR_1]");
      const clear2Idx = output.indexOf("[CLEAR_2]");
      const clear3Idx = output.indexOf("[CLEAR_3]");
      
      const banner1Idx = output.indexOf("OpenRalph", clear1Idx);
      const banner2Idx = output.indexOf("OpenRalph", clear2Idx);
      const banner3Idx = output.indexOf("OpenRalph", clear3Idx);
      
      expect(clear1Idx).not.toBe(-1);
      expect(clear2Idx).not.toBe(-1);
      expect(clear3Idx).not.toBe(-1);
      
      expect(banner1Idx).toBeGreaterThan(clear1Idx);
      expect(banner2Idx).toBeGreaterThan(clear2Idx);
      expect(banner3Idx).toBeGreaterThan(clear3Idx);
      
      expect(banner1Idx).toBeLessThan(clear2Idx);
      expect(banner2Idx).toBeLessThan(clear3Idx);
    });
  });
});
