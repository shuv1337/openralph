import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  InterruptMenuChoice,
  createInterruptMenu,
  formatMenuChoice,
  type InterruptMenuController,
} from "../../src/lib/interrupt-menu";
import { resetCapabilitiesCache } from "../../src/lib/terminal-capabilities";

describe("Interrupt Menu - Choice Enum", () => {
  it("should have correct choice values", () => {
    expect(InterruptMenuChoice.FORCE_QUIT as string).toBe("FORCE_QUIT");
    expect(InterruptMenuChoice.PAUSE as string).toBe("PAUSE");
    expect(InterruptMenuChoice.RESUME as string).toBe("RESUME");
  });
});

describe("Interrupt Menu - formatMenuChoice", () => {
  it("should format FORCE_QUIT correctly", () => {
    expect(formatMenuChoice(InterruptMenuChoice.FORCE_QUIT)).toBe("Force Quit");
  });

  it("should format PAUSE correctly", () => {
    expect(formatMenuChoice(InterruptMenuChoice.PAUSE)).toBe("Pause");
  });

  it("should format RESUME correctly", () => {
    expect(formatMenuChoice(InterruptMenuChoice.RESUME)).toBe("Resume");
  });
});

describe("Interrupt Menu - Controller", () => {
  let controller: InterruptMenuController;
  let output: string[];

  beforeEach(() => {
    resetCapabilitiesCache();
    output = [];
    controller = createInterruptMenu({
      write: (text: string) => {
        output.push(text);
      },
      colors: false, // Disable colors for predictable output
    });
  });

  afterEach(() => {
    controller.destroy();
    resetCapabilitiesCache();
  });

  it("should create a controller with expected methods", () => {
    expect(controller).toBeDefined();
    expect(typeof controller.show).toBe("function");
    expect(typeof controller.dismiss).toBe("function");
    expect(typeof controller.isVisible).toBe("function");
    expect(typeof controller.destroy).toBe("function");
  });

  it("should start in not-visible state", () => {
    expect(controller.isVisible()).toBe(false);
  });

  it("should become visible when show is called", () => {
    // We don't await show() because it waits for user input
    controller.show();
    expect(controller.isVisible()).toBe(true);
  });

  it("should resolve show() when dismiss() is called", async () => {
    const showPromise = controller.show();
    controller.dismiss(InterruptMenuChoice.PAUSE);
    
    const choice = await showPromise;
    expect(choice).toBe(InterruptMenuChoice.PAUSE);
    expect(controller.isVisible()).toBe(false);
  });

  it("should resolve with RESUME if show() is called twice", async () => {
    const firstShowPromise = controller.show();
    const secondShowPromise = controller.show();
    
    // Second call should resolve immediately with RESUME
    const secondChoice = await secondShowPromise;
    expect(secondChoice).toBe(InterruptMenuChoice.RESUME);
    
    // First call is still pending
    expect(controller.isVisible()).toBe(true);
    
    controller.dismiss(InterruptMenuChoice.FORCE_QUIT);
    const firstChoice = await firstShowPromise;
    expect(firstChoice).toBe(InterruptMenuChoice.FORCE_QUIT);
  });

  it("should clear visibility on destroy", () => {
    controller.show();
    expect(controller.isVisible()).toBe(true);
    controller.destroy();
    expect(controller.isVisible()).toBe(false);
  });

  it("should respect custom prompt message", () => {
    const customPrompt = "What should we do?";
    const customController = createInterruptMenu({
      write: (text: string) => {
        output.push(text);
      },
      promptMessage: customPrompt,
      colors: false,
    });

    customController.show();
    const combinedOutput = output.join("");
    expect(combinedOutput).toContain(customPrompt);
    customController.destroy();
  });

  it("should resolve with RESUME on timeout", async () => {
    const timeoutController = createInterruptMenu({
      write: (text: string) => {
        output.push(text);
      },
      timeout: 10, // 10ms timeout
      colors: false,
    });

    const choice = await timeoutController.show();
    expect(choice).toBe(InterruptMenuChoice.RESUME);
    expect(timeoutController.isVisible()).toBe(false);
    timeoutController.destroy();
  });

  it("should include all menu options in output", () => {
    controller.show();
    const combinedOutput = output.join("");
    
    expect(combinedOutput).toContain("Force Quit");
    expect(combinedOutput).toContain("Pause");
    expect(combinedOutput).toContain("Resume");
    expect(combinedOutput).toContain("[Q]");
    expect(combinedOutput).toContain("[P]");
    expect(combinedOutput).toContain("[R]");
  });
});
