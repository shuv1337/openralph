import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  createHeadlessInputController,
  KEY_CODES,
  type HeadlessInputController,
  type InputEvent,
  type InputEventType,
} from "../../src/lib/headless-input";
import { resetCapabilitiesCache } from "../../src/lib/terminal-capabilities";

describe("Headless Input - Key Codes", () => {
  it("should define Ctrl+C key code", () => {
    expect(KEY_CODES.CTRL_C).toBe("\x03");
  });

  it("should define Ctrl+D key code", () => {
    expect(KEY_CODES.CTRL_D).toBe("\x04");
  });

  it("should define Ctrl+\\ key code", () => {
    expect(KEY_CODES.CTRL_BACKSLASH).toBe("\x1c");
  });

  it("should define Ctrl+Z key code", () => {
    expect(KEY_CODES.CTRL_Z).toBe("\x1a");
  });

  it("should define Escape key code", () => {
    expect(KEY_CODES.ESCAPE).toBe("\x1b");
  });

  it("should define Enter key code", () => {
    expect(KEY_CODES.ENTER).toBe("\r");
  });

  it("should define Newline key code", () => {
    expect(KEY_CODES.NEWLINE).toBe("\n");
  });
});

describe("Headless Input - Controller Creation", () => {
  let controller: HeadlessInputController;
  let output: string[];

  beforeEach(() => {
    resetCapabilitiesCache();
    output = [];
    controller = createHeadlessInputController({
      write: (text: string) => { output.push(text); },
      showFeedback: true,
      handleSignals: false, // Don't register real signal handlers in tests
    });
  });

  afterEach(() => {
    if (controller.isListening()) {
      controller.stop();
    }
    resetCapabilitiesCache();
  });

  it("should create a controller with default options", () => {
    const defaultController = createHeadlessInputController();
    expect(defaultController).toBeDefined();
    expect(typeof defaultController.start).toBe("function");
    expect(typeof defaultController.stop).toBe("function");
    expect(typeof defaultController.onInput).toBe("function");
    expect(typeof defaultController.offInput).toBe("function");
    expect(typeof defaultController.isListening).toBe("function");
    expect(typeof defaultController.showTerminationFeedback).toBe("function");
  });

  it("should start in non-listening state", () => {
    expect(controller.isListening()).toBe(false);
  });

  it("should start and stop correctly", () => {
    expect(controller.isListening()).toBe(false);
    controller.start();
    expect(controller.isListening()).toBe(true);
    controller.stop();
    expect(controller.isListening()).toBe(false);
  });

  it("should not start twice", () => {
    controller.start();
    controller.start(); // Should be a no-op
    expect(controller.isListening()).toBe(true);
    controller.stop();
  });

  it("should not stop when not listening", () => {
    controller.stop(); // Should be a no-op
    expect(controller.isListening()).toBe(false);
  });
});

describe("Headless Input - Event Handlers", () => {
  let controller: HeadlessInputController;
  let output: string[];
  let events: InputEvent[];

  beforeEach(() => {
    resetCapabilitiesCache();
    output = [];
    events = [];
    controller = createHeadlessInputController({
      write: (text: string) => { output.push(text); },
      showFeedback: false,
      handleSignals: false,
    });
  });

  afterEach(() => {
    if (controller.isListening()) {
      controller.stop();
    }
    resetCapabilitiesCache();
  });

  it("should allow registering event handlers", () => {
    const handler = (event: InputEvent) => { events.push(event); };
    controller.onInput(handler);
    // No error should be thrown
  });

  it("should allow unregistering event handlers", () => {
    const handler = (event: InputEvent) => { events.push(event); };
    controller.onInput(handler);
    controller.offInput(handler);
    // No error should be thrown
  });

  it("should allow multiple handlers", () => {
    const handler1 = (event: InputEvent) => { events.push(event); };
    const handler2 = (event: InputEvent) => { events.push(event); };
    controller.onInput(handler1);
    controller.onInput(handler2);
    // No error should be thrown
  });
});

describe("Headless Input - Termination Feedback", () => {
  let controller: HeadlessInputController;
  let output: string[];

  beforeEach(() => {
    resetCapabilitiesCache();
    output = [];
    controller = createHeadlessInputController({
      write: (text: string) => { output.push(text); },
      showFeedback: true,
      handleSignals: false,
    });
  });

  afterEach(() => {
    if (controller.isListening()) {
      controller.stop();
    }
    resetCapabilitiesCache();
  });

  it("should show termination feedback with default message", () => {
    controller.showTerminationFeedback();
    expect(output.length).toBeGreaterThan(0);
    expect(output.join("")).toContain("Goodbye");
  });

  it("should show termination feedback with custom message", () => {
    controller.showTerminationFeedback("Custom message");
    expect(output.length).toBeGreaterThan(0);
    expect(output.join("")).toContain("Custom message");
  });
});

describe("Headless Input - Event Types", () => {
  it("should have expected event type values", () => {
    const expectedTypes: InputEventType[] = [
      "exit",
      "pause",
      "resume",
      "terminal",
      "interrupt",
      "force_quit",
      "eof",
      "command",
      "key",
    ];

    // This test just ensures the types are valid
    for (const type of expectedTypes) {
      expect(typeof type).toBe("string");
    }
  });
});

describe("Headless Input - Shortcut Keys", () => {
  let controller: HeadlessInputController;
  let events: InputEvent[];
  let originalIsTTY: any;
  let originalSetRawMode: any;
  let originalResume: any;
  let originalPause: any;

  beforeEach(() => {
    resetCapabilitiesCache();
    events = [];

    // Mock process.stdin properties to allow startRawInput to succeed
    originalIsTTY = process.stdin.isTTY;
    originalSetRawMode = process.stdin.setRawMode;
    originalResume = process.stdin.resume;
    originalPause = process.stdin.pause;

    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    process.stdin.setRawMode = (process.stdin.setRawMode || (() => {})) as any;
    process.stdin.resume = (process.stdin.resume || (() => {})) as any;
    process.stdin.pause = (process.stdin.pause || (() => {})) as any;

    controller = createHeadlessInputController({
      showFeedback: false,
      handleSignals: false,
    });
    controller.onInput((e) => events.push(e));
    controller.start();
  });

  afterEach(() => {
    controller.stop();

    // Restore original process.stdin properties
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    process.stdin.setRawMode = originalSetRawMode;
    process.stdin.resume = originalResume;
    process.stdin.pause = originalPause;

    resetCapabilitiesCache();
  });

  it("should emit 'terminal' event when 't' is pressed", () => {
    process.stdin.emit("data", Buffer.from("t"));
    expect(events.some(e => e.type === "terminal" && e.key === "t")).toBe(true);
  });

  it("should emit 'terminal' event when 'T' is pressed", () => {
    process.stdin.emit("data", Buffer.from("T"));
    expect(events.some(e => e.type === "terminal" && e.key === "T")).toBe(true);
  });

  it("should emit 'pause' event when 'p' is pressed", () => {
    process.stdin.emit("data", Buffer.from("p"));
    expect(events.some(e => e.type === "pause" && e.key === "p")).toBe(true);
  });

  it("should emit 'resume' event when 'r' is pressed", () => {
    process.stdin.emit("data", Buffer.from("r"));
    expect(events.some(e => e.type === "resume" && e.key === "r")).toBe(true);
  });

  it("should emit 'exit' event when 'q' is pressed", () => {
    process.stdin.emit("data", Buffer.from("q"));
    expect(events.some(e => e.type === "exit" && e.key === "q")).toBe(true);
  });
});
