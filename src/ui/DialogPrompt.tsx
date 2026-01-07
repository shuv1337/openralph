import { useKeyboard } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import type { KeyEvent } from "@opentui/core";
import { createSignal } from "solid-js";
import { Dialog } from "./Dialog";
import { useDialog } from "../context/DialogContext";
import { colors } from "../components/colors";

export type DialogPromptProps = {
  /** Dialog title displayed at the top */
  title: string;
  /** Placeholder text shown when input is empty */
  placeholder?: string;
  /** Initial value for the input field */
  initialValue?: string;
  /** Callback when user submits (Enter key or Submit button) */
  onSubmit: (value: string) => void;
  /** Callback when user cancels (Escape key or Cancel button) */
  onCancel: () => void;
  /** Optional custom border color */
  borderColor?: string;
};

/**
 * Prompt dialog with text input field.
 * Displays a title, text input with placeholder, and Submit/Cancel buttons.
 * Enter key submits, Escape key cancels.
 */
export function DialogPrompt(props: DialogPromptProps) {
  const { pop } = useDialog();
  const [input, setInput] = createSignal(props.initialValue || "");

  const handleSubmit = () => {
    const value = input().trim();
    props.onSubmit(value);
    pop();
  };

  const handleCancel = () => {
    props.onCancel();
    pop();
  };

  // Handle keyboard input
  useKeyboard((e: KeyEvent) => {
    // Enter: submit
    if (e.name === "return" || e.name === "enter" || e.name === "Enter") {
      handleSubmit();
      return;
    }

    // Escape is handled by the base Dialog component, but we also handle it
    // here to ensure onCancel is called
    if (e.name === "escape" || e.name === "Escape") {
      handleCancel();
      return;
    }

    // Backspace: delete last character
    if (e.name === "backspace" || e.name === "Backspace") {
      setInput((prev) => prev.slice(0, -1));
      return;
    }

    // Regular character input (single printable characters)
    if (e.raw && e.raw.length === 1 && !e.ctrl && !e.meta) {
      setInput((prev) => prev + e.raw);
    }
  });

  return (
    <Dialog
      borderColor={props.borderColor || colors.cyan}
      onClose={handleCancel}
      width="60%"
    >
      {/* Title */}
      <box marginBottom={1}>
        <text fg={colors.cyan} attributes={TextAttributes.BOLD}>
          {props.title}
        </text>
      </box>

      {/* Input box */}
      <box
        marginBottom={1}
        padding={1}
        borderStyle="single"
        borderColor={colors.border}
        backgroundColor={colors.bgDark}
      >
        <text fg={input() ? colors.fg : colors.fgMuted}>
          {input() || props.placeholder || "Enter text..."}
        </text>
      </box>

      {/* Buttons row */}
      <box flexDirection="row" justifyContent="flex-end" gap={2}>
        <box flexDirection="row">
          <text fg={colors.fgMuted}>[</text>
          <text fg={colors.green}>Enter</text>
          <text fg={colors.fgMuted}>] Submit</text>
        </box>
        <box flexDirection="row">
          <text fg={colors.fgMuted}>[</text>
          <text fg={colors.red}>Esc</text>
          <text fg={colors.fgMuted}>] Cancel</text>
        </box>
      </box>
    </Dialog>
  );
}
