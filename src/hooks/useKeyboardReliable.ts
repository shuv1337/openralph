/**
 * Reliable keyboard handler hook for Windows compatibility.
 * 
 * On Windows, the `onMount` lifecycle hook in `@opentui/solid` does NOT fire reliably.
 * Since the standard `useKeyboard` hook registers its handler inside `onMount`,
 * keyboard events may not work when dialogs or overlays are opened.
 * 
 * This hook uses `createEffect` with immediate execution instead of `onMount`,
 * ensuring the keyboard handler is registered reliably on all platforms.
 */
import { useRenderer } from "@opentui/solid";
import type { KeyEvent } from "@opentui/core";
import { createEffect, onCleanup } from "solid-js";
import { log } from "../util/log";

export interface UseKeyboardReliableOptions {
  /** Include release events - callback receives events with eventType: "release" */
  release?: boolean;
  /** Debug label for logging (optional) */
  debugLabel?: string;
}

// Global counter to track keyboard handler registrations
let handlerIdCounter = 0;

/**
 * Subscribe to keyboard events with reliable registration on Windows.
 * 
 * Unlike the standard `useKeyboard` from `@opentui/solid`, this hook:
 * - Uses `createEffect` instead of `onMount` for immediate registration
 * - Works reliably on Windows where `onMount` may not fire
 * - Provides optional debug logging for troubleshooting
 * 
 * @param callback - Function called when a key event occurs
 * @param options - Optional configuration
 * 
 * @example
 * ```tsx
 * useKeyboardReliable((e) => {
 *   if (e.name === "escape") handleClose();
 *   if (e.name === "up") moveUp();
 *   if (e.name === "down") moveDown();
 * }, { debugLabel: "DialogSelect" });
 * ```
 */
export function useKeyboardReliable(
  callback: (key: KeyEvent) => void,
  options?: UseKeyboardReliableOptions
): void {
  const renderer = useRenderer();
  const keyHandler = renderer.keyInput;
  const debugLabel = options?.debugLabel || "useKeyboardReliable";
  const handlerId = ++handlerIdCounter;
  
  // Track whether we've registered to avoid double-registration
  let registered = false;
  
  // Store the callback reference to ensure we remove the same one we added
  const wrappedCallback = (key: KeyEvent) => {
    callback(key);
  };
  
  // Use createEffect for immediate execution on component creation
  // Unlike onMount, createEffect runs synchronously during first render
  createEffect(() => {
    if (registered) return;
    registered = true;
    
    log("keyboard", `${debugLabel}[${handlerId}]: Registering keyboard handler`);
    
    keyHandler.on("keypress", wrappedCallback);
    
    if (options?.release) {
      keyHandler.on("keyrelease", wrappedCallback);
    }
  });
  
  // Cleanup on component unmount
  onCleanup(() => {
    if (registered) {
      log("keyboard", `${debugLabel}[${handlerId}]: Unregistering keyboard handler`);
      
      keyHandler.off("keypress", wrappedCallback);
      
      if (options?.release) {
        keyHandler.off("keyrelease", wrappedCallback);
      }
      
      registered = false;
    }
  });
}
