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
      expect(keymap.copyAttach).toBeDefined();
      expect(keymap.terminalConfig).toBeDefined();
      expect(keymap.toggleTasks).toBeDefined();
      expect(keymap.togglePause).toBeDefined();
      expect(keymap.quit).toBeDefined();
      expect(keymap.steer).toBeDefined();
      expect(keymap.commandPalette).toBeDefined();
      expect(keymap.toggleCompleted).toBeDefined();
    });

    it("should have toggleCompleted as Shift+C", () => {
      expect(keymap.toggleCompleted.key).toBe("c");
      expect(keymap.toggleCompleted.shift).toBe(true);
      expect(keymap.toggleCompleted.label).toBe("Shift+C");
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
      it("should match Shift+C for toggleCompleted", () => {
        // Standard terminal: Shift+C sends uppercase C, parsed as name="c", shift=true
        const event = { name: "c", ctrl: false, shift: true, meta: false };
        expect(matchesKeybind(event, keymap.toggleCompleted)).toBe(true);
      });

      it("should NOT match plain 'c' for toggleCompleted", () => {
        const event = { name: "c", ctrl: false, shift: false, meta: false };
        expect(matchesKeybind(event, keymap.toggleCompleted)).toBe(false);
      });

      it("should match Shift+T for toggleTasks", () => {
        const event = { name: "t", ctrl: false, shift: true, meta: false };
        expect(matchesKeybind(event, keymap.toggleTasks)).toBe(true);
      });

      it("should NOT match plain 't' for toggleTasks", () => {
        const event = { name: "t", ctrl: false, shift: false, meta: false };
        expect(matchesKeybind(event, keymap.toggleTasks)).toBe(false);
      });

      it("should match Shift+C for copyAttach", () => {
        const event = { name: "c", ctrl: false, shift: true, meta: false };
        expect(matchesKeybind(event, keymap.copyAttach)).toBe(true);
      });
    });

    describe("case insensitivity", () => {
      it("should match regardless of case in key name", () => {
        const eventLower = { name: "c", ctrl: false, shift: true, meta: false };
        const eventUpper = { name: "C", ctrl: false, shift: true, meta: false };
        
        expect(matchesKeybind(eventLower, keymap.toggleCompleted)).toBe(true);
        expect(matchesKeybind(eventUpper, keymap.toggleCompleted)).toBe(true);
      });
    });

    describe("cross-platform keyboard scenarios", () => {
      it("should handle undefined modifiers (treated as false)", () => {
        // Some events may have undefined modifiers
        const event = { name: "q" } as { name: string; ctrl?: boolean; shift?: boolean; meta?: boolean };
        expect(matchesKeybind(event, keymap.quit)).toBe(true);
      });

      it("should distinguish Shift+C from plain C", () => {
        const shiftC = { name: "c", ctrl: false, shift: true, meta: false };
        const plainC = { name: "c", ctrl: false, shift: false, meta: false };
        
        // Shift+C should match toggleCompleted but not commandPalette
        expect(matchesKeybind(shiftC, keymap.toggleCompleted)).toBe(true);
        expect(matchesKeybind(shiftC, keymap.commandPalette)).toBe(false);
        
        // Plain C should match commandPalette but not toggleCompleted
        expect(matchesKeybind(plainC, keymap.commandPalette)).toBe(true);
        expect(matchesKeybind(plainC, keymap.toggleCompleted)).toBe(false);
      });

      it("should handle Kitty keyboard protocol style events", () => {
        // Kitty protocol sends key.name as lowercase with shift modifier
        const kittyShiftC = { name: "c", ctrl: false, shift: true, meta: false };
        expect(matchesKeybind(kittyShiftC, keymap.toggleCompleted)).toBe(true);
      });

      it("should handle legacy terminal style events (uppercase letter)", () => {
        // Legacy terminals might send uppercase C with shift=true
        const legacyShiftC = { name: "C", ctrl: false, shift: true, meta: false };
        expect(matchesKeybind(legacyShiftC, keymap.toggleCompleted)).toBe(true);
      });
    });
  });

  describe("formatKeybind", () => {
    it("should return the label string", () => {
      expect(formatKeybind(keymap.toggleCompleted)).toBe("Shift+C");
      expect(formatKeybind(keymap.quit)).toBe("Q");
      expect(formatKeybind(keymap.toggleTasks)).toBe("Shift+T");
    });
  });
});
