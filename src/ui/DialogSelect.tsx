import { TextAttributes } from "@opentui/core";
import type { KeyEvent } from "@opentui/core";
import { createSignal, createMemo, For, Show } from "solid-js";
import fuzzysort from "fuzzysort";
import { Dialog } from "./Dialog";
import { useDialog } from "../context/DialogContext";
import { useTheme } from "../context/ThemeContext";
import { useKeyboardReliable } from "../hooks/useKeyboardReliable";

export interface SelectOption {
  title: string;
  value: string;
  description?: string;
  keybind?: string;
  disabled?: boolean;
}

export type DialogSelectProps = {
  title?: string;
  placeholder?: string;
  options: SelectOption[];
  onSelect: (option: SelectOption) => void;
  onCancel: () => void;
  borderColor?: string;
  maxVisible?: number;
  showCategories?: boolean;
};

interface HighlightedPart {
  text: string;
  highlighted: boolean;
}

export function DialogSelect(props: DialogSelectProps) {
  const { pop } = useDialog();
  const { theme } = useTheme();
  const [query, setQuery] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  const maxVisible = () => props.maxVisible ?? 8;

  const filteredOptions = createMemo(() => {
    const q = query();
    if (!q) {
      return props.options
        .filter((opt) => props.showCategories || !opt.disabled)
        .map((opt) => ({
          option: opt,
          highlighted: null as HighlightedPart[] | null,
        }));
    }

    const results = fuzzysort.go(q, props.options.filter(opt => !opt.value.startsWith('__category_')), {
      key: "title",
      threshold: 0.2,
    });

    return results.map((result) => ({
      option: result.obj,
      highlighted: buildHighlightedParts(result.target, result.indexes),
    }));
  });

  const clampedIndex = createMemo(() => {
    const len = filteredOptions().length;
    if (len === 0) return 0;
    return Math.max(0, Math.min(selectedIndex(), len - 1));
  });

  const scrollOffset = createMemo(() => Math.max(0, clampedIndex() - maxVisible() + 1));

  const visibleOptions = createMemo(() => {
    const offset = scrollOffset();
    return filteredOptions().slice(offset, offset + maxVisible());
  });

  const handleSelect = () => {
    const options = filteredOptions();
    const idx = clampedIndex();
    if (options[idx] && !options[idx].option.disabled) {
      props.onSelect(options[idx].option);
      pop();
    }
  };

  const handleCancel = () => {
    props.onCancel();
    pop();
  };

  useKeyboardReliable((e: KeyEvent) => {
    if (e.name === "return" || e.name === "enter") {
      handleSelect();
      return;
    }

    if (e.name === "up") {
      setSelectedIndex((prev) => {
        let next = Math.max(0, prev - 1);
        const options = filteredOptions();
        while (next > 0 && options[next]?.option.disabled) next--;
        return options[next]?.option.disabled ? prev : next;
      });
      return;
    }

    if (e.name === "down") {
      setSelectedIndex((prev) => {
        let next = Math.min(filteredOptions().length - 1, prev + 1);
        const options = filteredOptions();
        while (next < options.length - 1 && options[next]?.option.disabled) next++;
        return options[next]?.option.disabled ? prev : next;
      });
      return;
    }

    if (e.name === "tab") {
      if (e.shift) {
        setSelectedIndex((prev) => {
          let next = Math.max(0, prev - 1);
          const options = filteredOptions();
          while (next > 0 && options[next]?.option.disabled) next--;
          return options[next]?.option.disabled ? prev : next;
        });
      } else {
        setSelectedIndex((prev) => {
          let next = Math.min(filteredOptions().length - 1, prev + 1);
          const options = filteredOptions();
          while (next < options.length - 1 && options[next]?.option.disabled) next++;
          return options[next]?.option.disabled ? prev : next;
        });
      }
      return;
    }

    if (e.name === "backspace") {
      setQuery((prev) => prev.slice(0, -1));
      setSelectedIndex(0);
      return;
    }

    if (e.raw && e.raw.length === 1 && !e.ctrl && !e.meta) {
      setQuery((prev) => prev + e.raw);
      setSelectedIndex(0);
    }
  }, { debugLabel: "DialogSelect" });

  const t = theme();

  return (
    <Dialog borderColor={props.borderColor || t.primary} onClose={handleCancel} width="70%"><Show when={props.title}><box marginBottom={1}><text fg={t.primary} attributes={TextAttributes.BOLD}>{props.title}</text></box></Show><box marginBottom={1} paddingLeft={1} paddingRight={1} borderStyle="single" borderColor={t.border} backgroundColor={t.background}><text fg={t.textMuted}>❯ </text><text fg={query() ? t.text : t.textMuted}>{query() || props.placeholder || "Type to search..."}</text></box><box flexDirection="column"><Show when={filteredOptions().length > 0} fallback={<box padding={1}><text fg={t.textMuted}>No matching results</text></box>}><For each={visibleOptions()}>{(item, index) => { const isSelected = () => (scrollOffset() + index()) === clampedIndex(); return (<box flexDirection="row" paddingLeft={1} paddingRight={1} backgroundColor={isSelected() ? t.backgroundElement : undefined}><text fg={isSelected() ? t.primary : t.textMuted}>{isSelected() ? "❯ " : "  "}</text><box flexGrow={1} flexDirection="column"><box flexDirection="row"><Show when={item.highlighted} fallback={<text fg={item.option.disabled ? t.textMuted : t.text}>{item.option.title}</text>}><For each={item.highlighted!}>{(part) => (<text fg={part.highlighted ? t.warning : item.option.disabled ? t.textMuted : t.text} attributes={part.highlighted ? TextAttributes.BOLD : undefined}>{part.text}</text>)}</For></Show></box><Show when={item.option.description}><text fg={t.borderSubtle}>{item.option.description}</text></Show></box><Show when={item.option.keybind}><box marginLeft={2}><text fg={t.borderSubtle}>[{item.option.keybind}]</text></box></Show></box>); }}</For></Show></box><box flexDirection="row" justifyContent="flex-end" gap={2} marginTop={1}><box flexDirection="row"><text fg={t.textMuted}>[</text><text fg={t.success}>↑↓</text><text fg={t.textMuted}>] Navigate</text></box><box flexDirection="row"><text fg={t.textMuted}>[</text><text fg={t.success}>Enter</text><text fg={t.textMuted}>] Select</text></box><box flexDirection="row"><text fg={t.textMuted}>[</text><text fg={t.error}>Esc</text><text fg={t.textMuted}>] Cancel</text></box></box></Dialog>
  );
}

function buildHighlightedParts(target: string, indexes: ReadonlyArray<number>): HighlightedPart[] {
  if (indexes.length === 0) return [{ text: target, highlighted: false }];
  const parts: HighlightedPart[] = [];
  const indexSet = new Set(indexes);
  let currentPart = "";
  let currentHighlighted = indexSet.has(0);
  for (let i = 0; i < target.length; i++) {
    const isHighlighted = indexSet.has(i);
    if (isHighlighted !== currentHighlighted) {
      if (currentPart) parts.push({ text: currentPart, highlighted: currentHighlighted });
      currentPart = target[i];
      currentHighlighted = isHighlighted;
    } else {
      currentPart += target[i];
    }
  }
  if (currentPart) parts.push({ text: currentPart, highlighted: currentHighlighted });
  return parts;
}
