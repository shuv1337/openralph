import { Component, createMemo, Show } from "solid-js";
import { useTheme } from "../../context/ThemeContext";
import { Spinner, Pulse, Blink } from "./primitives";
import type { RalphStatus, TaskStatus } from "../tui-types";
import { statusIndicators, taskStatusIndicators } from "../tui-theme";

interface StatusIndicatorProps {
  status: RalphStatus | TaskStatus;
  type: 'ralph' | 'task';
  animated?: boolean;
  wrap?: boolean;
}

/**
 * Rich status indicator with animations.
 */
export const StatusIndicator: Component<StatusIndicatorProps> = (props) => {
  const { theme } = useTheme();
  const t = () => theme();

  const indicator = createMemo(() => 
    props.type === 'ralph' 
      ? statusIndicators[props.status as RalphStatus]
      : taskStatusIndicators[props.status as TaskStatus]
  );

  const color = createMemo(() => {
    const s = props.status;
    switch (s) {
      case 'running':
      case 'executing':
      case 'active':
        return t().info;
      case 'paused':
      case 'pausing':
        return t().warning;
      case 'complete':
      case 'done':
      case 'actionable':
        return t().success;
      case 'error':
      case 'blocked':
        return t().error;
      default:
        return t().textMuted;
    }
  });

  const animationType = createMemo(() => {
    if (!props.animated) return null;
    
    const s = props.status;
    switch (s) {
      case 'running':
      case 'executing':
      case 'active':
        return 'spinner';
      case 'selecting':
        return 'pulse';
      case 'error':
        return 'blink';
      default:
        return null;
    }
  });

  return (
    <Show when={animationType()} fallback={<Show when={props.wrap !== false} fallback={<span style={{ fg: color() }}>{indicator()}</span>}><text fg={color()}>{indicator()}</text></Show>}><Show when={animationType() === 'spinner'}><Spinner color={color()} wrap={props.wrap} /></Show><Show when={animationType() === 'pulse'}><Pulse color={color()} wrap={props.wrap}>{indicator()}</Pulse></Show><Show when={animationType() === 'blink'}><Blink text={indicator() || ''} color={color()} interval={300} wrap={props.wrap} /></Show></Show>
  );
};
