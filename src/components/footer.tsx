import { useTerminalDimensions } from "@opentui/solid";
import { useTheme } from "../context/ThemeContext";
import { formatDuration, formatNumber } from "../lib/time";
import { truncateText } from "../lib/text-utils";
import type { TokenUsage } from "../state";
import { keyboardShortcuts, layout } from "./tui-theme";
import type { RateLimitState } from "./tui-types";
import { createMemo } from "solid-js";

export type FooterProps = {
  commits: number;
  elapsed: number;
  status: "running" | "paused" | "ready" | "starting" | "complete" | "error";
  linesAdded: number;
  linesRemoved: number;
  sessionActive?: boolean;
  tokens?: TokenUsage;
  /** Current adapter mode - SDK (Claude SDK) or PTY (pseudo-terminal) */
  adapterMode?: "sdk" | "pty";
  /** Rate limit state for warning display */
  rateLimitState?: RateLimitState;
};

export function Footer(props: FooterProps) {
  const { theme } = useTheme();
  const t = () => theme();
  const terminalDimensions = useTerminalDimensions();

  const layoutMetrics = createMemo(() => {
    const width = terminalDimensions().width;
    const isCompact = width < 80;
    const hideTokens = width < 100;
    const hideDiff = width < 70;
    
    // Available width for shortcuts (total - stats - padding)
    const statsWidth = (hideTokens ? 0 : 25) + (hideDiff ? 0 : 15) + 10;
    const availableShortcuts = width - statsWidth - 4;
    
    return {
      isCompact,
      hideTokens,
      hideDiff,
      availableShortcuts
    };
  });

  const shortcuts = () => {
    const list = [...keyboardShortcuts];
    if (props.sessionActive) {
      list.splice(3, 0, { key: ":", description: "Steer" });
    }
    // Show rate limit warning in shortcuts if rate limited
    if (props.rateLimitState?.limitedAt) {
      list.push({ key: "⏳", description: "Rate Limited" });
    }
    
    // In compact mode, only show essential shortcuts
    if (layoutMetrics().isCompact) {
      return list.filter(s => ["q", "p", "c", "?"].includes(s.key));
    }
    
    return list;
  };

  // Mode indicator: [SDK] or [PTY]
  const modeIndicator = () => {
    if (!props.adapterMode) return null;
    return props.adapterMode === "pty" ? "[PTY]" : "[SDK]";
  };

  const shortcutText = () => {
    let text = shortcuts()
      .map(({ key, description }) => `${key}:${description}`)
      .join("  ");
      
    if (text.length > layoutMetrics().availableShortcuts) {
      // If still too long, try removing descriptions for some
      text = shortcuts()
        .map(({ key, description }) => layoutMetrics().isCompact ? key : `${key}:${description}`)
        .join(" ");
    }
    
    if (text.length > layoutMetrics().availableShortcuts) {
      return text.slice(0, layoutMetrics().availableShortcuts - 1) + "…";
    }
    return text;
  };

  return (
    <box
      width="100%"
      height={layout.footer.height}
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      backgroundColor={t().backgroundPanel}
      paddingLeft={1}
      paddingRight={1}
      border
      borderColor={t().border}
    >
      <box flexShrink={1} overflow="hidden">
        <text fg={t().textMuted}>{shortcutText()}</text>
      </box>

      <box flexGrow={1} />

      <box flexDirection="row" gap={1} flexShrink={0}>
        {props.tokens && (props.tokens.input > 0 || props.tokens.output > 0) && !layoutMetrics().hideTokens && (
          <>
            <text fg={t().textMuted}>Tokens:</text>
            <text fg={t().secondary}>{formatNumber(props.tokens.input)}in</text>
            <text fg={t().textMuted}>/</text>
            <text fg={t().secondary}>{formatNumber(props.tokens.output)}out</text>
            {/* Use optional chaining to guard against SolidJS reactivity race:
                tokens may become undefined mid-render when onSessionEnded fires */}
            {props.tokens?.reasoning != null && props.tokens.reasoning > 0 && (
              <>
                <text fg={t().textMuted}>/</text>
                <text fg={t().secondary}>{formatNumber(props.tokens.reasoning)}r</text>
              </>
            )}
            <text fg={t().textMuted}> │ </text>
          </>
        )}
        
        {!layoutMetrics().hideDiff && (
          <>
            <text fg={t().textMuted}>Diff:</text>
            <text fg={t().success}>+{props.linesAdded}</text>
            <text fg={t().textMuted}>/</text>
            <text fg={t().error}>-{props.linesRemoved}</text>
            <text fg={t().textMuted}> │ </text>
          </>
        )}
        
        <text fg={t().textMuted}>Commits:</text>
        <text fg={t().primary}>{props.commits}</text>
      </box>
    </box>
  );
}

