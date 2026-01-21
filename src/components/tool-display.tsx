import { Component, createMemo, createSignal, Show, createEffect, onCleanup } from "solid-js";
import { useTheme } from "../context/ThemeContext";
import { getExtendedTheme, type ExtendedTheme } from "../lib/enhanced-themes";
import { getToolClassification } from "../lib/tool-classification";
import { EXECUTION_STATE_STYLES, type ExecutionState } from "../lib/tool-states";
import { truncateText, stripAnsiCodes } from "../lib/text-utils";
import { formatDuration } from "../lib/time";
import type { ToolEvent } from "../state";

interface ToolDisplayProps {
  event: ToolEvent;
  showState?: boolean;
  showDuration?: boolean;
  maxWidth?: number;
  theme?: ExtendedTheme;
}

/**
 * Enhanced tool display with icons, colors, and execution states.
 * 
 * CRITICAL: Minimized whitespace between tags in <box> to avoid "Orphan text error"
 * in OpenTUI's Solid renderer.
 */
export const ToolDisplay: Component<ToolDisplayProps> = (props) => {
  const { theme, themeName } = useTheme();
  
  // Use passed theme or derive from context
  const t = createMemo(() => props.theme || getExtendedTheme(theme(), themeName()));

  // Get tool classification
  const classification = createMemo(() => 
    getToolClassification(props.event.icon || 'unknown')
  );

  // Get state style if showing execution state
  const stateStyle = createMemo(() => {
    if (!props.showState) return null;
    // @ts-ignore - state might be added to ToolEvent later
    const state = props.event.state || 'completed';
    return EXECUTION_STATE_STYLES[state as ExecutionState];
  });

  // Calculate colors
  const iconColor = createMemo(() => {
    // @ts-ignore
    if (props.event.error) return t().error;
    
    // Map categories to semantic colors
    const cat = classification().category;
    if (cat === 'file') {
      const tool = props.event.icon?.toLowerCase();
      if (tool === 'write' || tool === 'edit') return t().toolWrite;
      return t().toolRead;
    }
    
    switch (cat) {
      case 'search': return t().toolSearch;
      case 'execute': return t().toolExecute;
      case 'web': return t().toolWeb;
      case 'reasoning': return t().toolReasoning;
      case 'planning': return t().toolPlanning;
      case 'system': return t().toolSystem;
      case 'mcp': return t().toolMcp;
      case 'custom': return t().text;
      default: return t().text;
    }
  });

  const textColor = createMemo(() => 
    props.event.verbose ? t().textMuted : t().text
  );

  // Truncate text
  const truncatedText = createMemo(() => {
    const max = props.maxWidth || 60;
    const sanitized = stripAnsiCodes(props.event.text);
    return truncateText(sanitized, max);
  });

  const truncatedDetail = createMemo(() => {
    if (!props.event.detail) return undefined;
    const max = Math.floor((props.maxWidth || 60) * 0.4);
    const sanitized = stripAnsiCodes(props.event.detail);
    return truncateText(sanitized, max);
  });

  return (
    <box width="100%" flexDirection="row"><box width={2}><Show when={stateStyle()?.pulse} fallback={<text fg={iconColor()}>{classification().icon}</text>}><AnimatedPulse color={iconColor()} icon={classification().icon}/></Show></box><text><b style={{ fg: iconColor() }}>[{classification().displayName}]</b></text><text fg={textColor()}> </text><text fg={textColor()}>{truncatedText()}</text><Show when={truncatedDetail()}><text fg={t().textMuted}> </text><text fg={t().textMuted}>{truncatedDetail()}</text></Show><Show when={props.showDuration && props.event.duration}><text fg={t().textMuted}> </text><text fg={t().secondary}>({formatDuration(props.event.duration!)})</text></Show></box>
  );
};

/**
 * Animated pulse component for running tools.
 */
const AnimatedPulse: Component<{ color: string; icon: string }> = (props) => {
  const [frame, setFrame] = createSignal(0);
  const [opacity, setOpacity] = createSignal(1);

  // Pulse animation frames
  const pulseFrames = ['◉', '◐', '○', '◑'];

  createEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % pulseFrames.length);
      // Fade in/out effect
      setOpacity((o) => o === 1 ? 0.5 : 1);
    }, 500);
    onCleanup(() => clearInterval(interval));
  });

  return (
    <text fg={props.color} style={{ opacity: opacity() }}>{pulseFrames[frame()]}</text>
  );
};
