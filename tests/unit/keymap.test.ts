import { describe, it, expect } from "bun:test";
import { keymap, matchesKeybind, formatKeybind, type KeybindDef } from "../../src/lib/keymap";

/**
 * Tests for keymap definitions and keybind matching.
 * These tests verify that keybinds work correctly across different
 * terminal emulators and platforms.
 */
describe("keymap", () => {
  describe("keymap definitions", () => {
    it("should have all required keybinds defined", () => {
      expect(keymap.terminalConfig).toBeDefined();
      expect(keymap.toggleTasks).toBeDefined();
      expect(keymap.togglePause).toBeDefined();
      expect(keymap.quit).toBeDefined();
      expect(keymap.steer).toBeDefined();
      expect(keymap.commandPalette).toBeDefined();
    });

    it("should have commandPalette as plain C (no modifiers)", () => {
      expect(keymap.commandPalette.key).toBe("c");
      expect(keymap.commandPalette.shift).toBeUndefined();
      expect(keymap.commandPalette.ctrl).toBeUndefined();
    });
  });

  describe("matchesKeybind", () => {
    describe("simple keys (no modifiers)", () => {
      it("should match plain 'q' key", () => {
        const event = { name: "q", ctrl: false, shift: false, meta: false };
        expect(matchesKeybind(event, keymap.quit)).toBe(true);
      });

      it("should NOT match 'q' with shift", () => {
        const event = { name: "q", ctrl: false, shift: true, meta: false };
        expect(matchesKeybind(event, keymap.quit)).toBe(false);
      });

      it("should NOT match 'q' with ctrl", () => {
        const event = { name: "q", ctrl: true, shift: false, meta: false };
        expect(matchesKeybind(event, keymap.quit)).toBe(false);
      });

      it("should match plain 'c' for command palette", () => {
        const event = { name: "c", ctrl: false, shift: false, meta: false };
        expect(matchesKeybind(event, keymap.commandPalette)).toBe(true);
      });
    });

    describe("shift modifier keys", () => {
      it("should match Shift+T for toggleTasks", () => {
        const event = { name: "t", ctrl: false, shift: true, meta: false };
        expect(matchesKeybind(event, keymap.toggleTasks)).toBe(true);
      });

      it("should NOT match plain 't' for toggleTasks", () => {
        const event = { name: "t", ctrl: false, shift: false, meta: false };
        expect(matchesKeybind(event, keymap.toggleTasks)).toBe(false);
      });
    });

    describe("case insensitivity", () => {
      it("should match regardless of case in key name", () => {
        const eventLower = { name: "q", ctrl: false, shift: false, meta: false };
        const eventUpper = { name: "Q", ctrl: false, shift: false, meta: false };
        
        expect(matchesKeybind(eventLower, keymap.quit)).toBe(true);
        expect(matchesKeybind(eventUpper, keymap.quit)).toBe(true);
      });
    });

    describe("cross-platform keyboard scenarios", () => {
      it("should handle undefined modifiers (treated as false)", () => {
        // Some events may have undefined modifiers
        const event = { name: "q" } as { name: string; ctrl?: boolean; shift?: boolean; meta?: boolean };
        expect(matchesKeybind(event, keymap.quit)).toBe(true);
      });

      it("should distinguish Shift+T from plain T", () => {
        const shiftT = { name: "t", ctrl: false, shift: true, meta: false };
        const plainT = { name: "t", ctrl: false, shift: false, meta: false };
        
        // Shift+T should match toggleTasks but not terminalConfig
        expect(matchesKeybind(shiftT, keymap.toggleTasks)).toBe(true);
        expect(matchesKeybind(shiftT, keymap.terminalConfig)).toBe(false);
        
        // Plain T should match terminalConfig but not toggleTasks
        expect(matchesKeybind(plainT, keymap.terminalConfig)).toBe(true);
        expect(matchesKeybind(plainT, keymap.toggleTasks)).toBe(false);
      });
    });
  });

  describe("formatKeybind", () => {
    it("should return the label string", () => {
      expect(formatKeybind(keymap.quit)).toBe("Q");
      expect(formatKeybind(keymap.toggleTasks)).toBe("Shift+T");
    });
  });
});
