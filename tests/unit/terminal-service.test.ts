import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { TerminalService } from "../../src/lib/terminal-service";
import * as ansi from "../../src/lib/ansi";
import * as terminalCapabilities from "../../src/lib/terminal-capabilities";
import * as windowsConsole from "../../src/lib/windows-console";

describe("TerminalService", () => {
  let mockWrite: any;
  let capturedOutput: string[];

  beforeEach(() => {
    capturedOutput = [];
    mockWrite = mock((text: string) => {
      capturedOutput.push(text);
    });
  });

  describe("clearBuffer", () => {
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

    it("should call clearTerminal when VT is supported and interactive", () => {
      capsSpy.mockReturnValue({ isInteractive: true, isCI: false } as any);
      vtSpy.mockReturnValue(true);
      
      const service = new TerminalService(mockWrite);
      service.clearBuffer(true);
      
      expect(clearTerminalSpy).toHaveBeenCalledWith(true);
    });

    it("should use fallback newlines when VT is NOT supported but interactive", () => {
      capsSpy.mockReturnValue({ isInteractive: true, isCI: false } as any);
      vtSpy.mockReturnValue(false);
      
      const service = new TerminalService(mockWrite);
      service.clearBuffer(true);
      
      expect(clearTerminalSpy).not.toHaveBeenCalled();
      expect(capturedOutput.join("")).toContain("\n\n\n");
    });

    it("should do nothing when NOT interactive", () => {
      capsSpy.mockReturnValue({ isInteractive: false, isCI: false } as any);
      vtSpy.mockReturnValue(true);
      
      const service = new TerminalService(mockWrite);
      service.clearBuffer(true);
      
      expect(clearTerminalSpy).not.toHaveBeenCalled();
      expect(capturedOutput.length).toBe(0);
    });

    it("should do nothing when in CI", () => {
      capsSpy.mockReturnValue({ isInteractive: true, isCI: true } as any);
      vtSpy.mockReturnValue(true);
      
      const service = new TerminalService(mockWrite);
      service.clearBuffer(true);
      
      expect(clearTerminalSpy).not.toHaveBeenCalled();
      expect(capturedOutput.length).toBe(0);
    });

    it("should handle errors gracefully", () => {
      capsSpy.mockReturnValue({ isInteractive: true, isCI: false } as any);
      vtSpy.mockReturnValue(true);
      clearTerminalSpy.mockImplementation(() => {
        throw new Error("Terminal clear failed");
      });
      
      const service = new TerminalService(mockWrite);
      // Should not throw
      expect(() => service.clearBuffer(true)).not.toThrow();
    });
  });

  describe("setTitle", () => {
    let vtSpy: any;

    beforeEach(() => {
      vtSpy = spyOn(windowsConsole, "isVTSupported");
    });

    afterEach(() => {
      vtSpy.mockRestore();
    });

    it("should set terminal title when VT is supported", () => {
      vtSpy.mockReturnValue(true);
      
      const service = new TerminalService(mockWrite);
      service.setTitle("Test Title");
      
      expect(capturedOutput.join("")).toContain("\x1b]0;Test Title\x07");
    });

    it("should NOT set terminal title when VT is NOT supported", () => {
      vtSpy.mockReturnValue(false);
      
      const service = new TerminalService(mockWrite);
      service.setTitle("Test Title");
      
      expect(capturedOutput.length).toBe(0);
    });
  });
});
