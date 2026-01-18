import { Component, createMemo } from "solid-js";
import { useTheme } from "../context/ThemeContext";
import { DialogSelect, type SelectOption } from "../ui/DialogSelect";
import type { CommandOption } from "../context/CommandContext";

interface EnhancedCommandPaletteProps {
  title: string;
  placeholder: string;
  options: CommandOption[];
  onSelect: (option: SelectOption) => void;
  onCancel: () => void;
  borderColor?: string;
}

/**
 * Enhanced command palette with category grouping and icons.
 */
export const EnhancedCommandPalette: Component<EnhancedCommandPaletteProps> = (props) => {
  const { theme } = useTheme();
  const t = () => theme();

  // Group commands by category
  const groupedOptions = createMemo(() => {
    const groups: Map<string, CommandOption[]> = new Map();
    
    for (const option of props.options) {
      // Skip disabled options
      if (option.disabled) continue;
      
      // Use explicit category or derive from keybind/name
      let category = option.category || 'General';
      
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)!.push(option);
    }
    
    return groups;
  });

  // Convert to flat options with category headers for DialogSelect
  const flatOptions = createMemo(() => {
    const options: SelectOption[] = [];
    const sortedCategories = Array.from(groupedOptions().keys()).sort();
    
    for (const category of sortedCategories) {
      const commands = groupedOptions().get(category)!;
      
      // Add category header (disabled item)
      options.push({
        title: `── ${category.toUpperCase()} ──`,
        value: `__category_${category}__`,
        description: undefined,
        disabled: true,
      });
      
      // Add commands in this category
      for (const cmd of commands) {
        options.push({
          title: cmd.title,
          value: cmd.value,
          description: cmd.description,
          keybind: cmd.keybind,
          disabled: cmd.disabled,
        });
      }
    }
    
    return options;
  });

  return (
    <DialogSelect
      title={props.title}
      placeholder={props.placeholder}
      options={flatOptions()}
      onSelect={props.onSelect}
      onCancel={props.onCancel}
      borderColor={props.borderColor || t().accent}
      showCategories={true}
    />
  );
};
