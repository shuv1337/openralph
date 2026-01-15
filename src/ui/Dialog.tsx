import type { KeyEvent } from "@opentui/core";
import type { JSX } from "solid-js";
import { useDialog } from "../context/DialogContext";
import { useTheme } from "../context/ThemeContext";
import { useKeyboardReliable } from "../hooks/useKeyboardReliable";

export type DialogProps = {
  /** Dialog content */
  children: JSX.Element;
  /** Optional custom border color (defaults to colors.border) */
  borderColor?: string;
  /** Optional width as percentage (defaults to "60%") */
  width?: `${number}%` | number | "auto";
  /** Optional callback when dialog is closed via Escape */
  onClose?: () => void;
};

/**
 * Base dialog component with dark overlay, centered content box, and Escape key handling.
 * Used as the foundation for all dialog types (confirm, prompt, alert, etc.).
 */
export function Dialog(props: DialogProps) {
  const { pop } = useDialog();
  const { theme } = useTheme();

  // Handle Escape key to close dialog
  // Use reliable keyboard hook that works on Windows (avoids onMount issues)
  // NOTE: Only call pop() if there's no onClose handler - otherwise let the
  // parent component handle cleanup via onClose to avoid double-pop
  useKeyboardReliable((e: KeyEvent) => {
    if (e.name === "escape" || e.name === "Escape") {
      if (props.onClose) {
        props.onClose();
        // Don't call pop() here - onClose is expected to handle it
      } else {
        pop();
      }
    }
  }, { debugLabel: "Dialog" });

  const t = theme();

  return (
    <box
      position="absolute"
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
      backgroundColor={t.backgroundElement}
    >
      <box
        width={props.width || "60%"}
        padding={1}
        borderStyle="single"
        borderColor={props.borderColor || t.border}
        backgroundColor={t.backgroundPanel}
        flexDirection="column"
      >
        {props.children}
      </box>
    </box>
  );
}
