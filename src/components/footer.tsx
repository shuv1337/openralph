import { useTheme } from "../context/ThemeContext";
import { formatDuration, formatNumber } from "../lib/time";
import type { TokenUsage } from "../state";
import { keyboardShortcuts, layout } from "./tui-theme";
import type { RateLimitState } from "./tui-types";

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

  const shortcuts = () => {
    const list = [...keyboardShortcuts];
    if (props.sessionActive) {
      list.splice(3, 0, { key: ":", description: "Steer" });
    }
    // Show rate limit warning in shortcuts if rate limited
    if (props.rateLimitState?.limitedAt) {
      list.push({ key: "⏳", description: "Rate Limited" });
    }
    return list;
  };

  // Mode indicator: [SDK] or [PTY]
  const modeIndicator = () => {
    if (!props.adapterMode) return null;
    return props.adapterMode === "pty" ? "[PTY]" : "[SDK]";
  };

  const shortcutText = () =>
    shortcuts()
      .map(({ key, description }) => `${key}:${description}`)
      .join("  ");

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

      <box flexDirection="row" gap={1}>
        {props.tokens && (props.tokens.input > 0 || props.tokens.output > 0) && (
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
        <text fg={t().textMuted}>Diff:</text>
        <text fg={t().success}>+{props.linesAdded}</text>
        <text fg={t().textMuted}>/</text>
        <text fg={t().error}>-{props.linesRemoved}</text>
        <text fg={t().textMuted}> │ </text>
        <text fg={t().textMuted}>Commits:</text>
        <text fg={t().primary}>{props.commits}</text>
      </box>
    </box>
  );
}
