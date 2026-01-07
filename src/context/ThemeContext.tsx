import {
  createContext,
  useContext,
  createSignal,
  createMemo,
  createEffect,
  onMount,
  JSX,
} from "solid-js";
import type { Accessor } from "solid-js";
import { resolveTheme, type Theme, type ThemeMode } from "../lib/theme-resolver";
import { themeNames, defaultTheme } from "../lib/themes/index";
import { setCurrentTheme } from "../lib/theme-colors";
import { log } from "../util/log";

/**
 * OpenCode state from kv.json
 */
interface OpenCodeState {
  theme?: string;
  theme_mode?: ThemeMode;
}

/**
 * Context value interface defining theme access.
 */
export interface ThemeContextValue {
  /** Current resolved theme with all color values */
  theme: Accessor<Theme>;
  /** Current theme name */
  themeName: Accessor<string>;
  /** Current theme mode (dark/light) */
  themeMode: Accessor<ThemeMode>;
  /** List of all available theme names */
  themeNames: readonly string[];
}

// Create the context with undefined default (must be used within provider)
const ThemeContext = createContext<ThemeContextValue>();

/**
 * Props for the ThemeProvider component.
 */
export interface ThemeProviderProps {
  children: JSX.Element;
}

/**
 * Read OpenCode state from ~/.local/state/opencode/kv.json
 */
async function readOpenCodeState(): Promise<OpenCodeState> {
  try {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    const kvPath = `${homeDir}/.local/state/opencode/kv.json`;
    
    const file = Bun.file(kvPath);
    if (await file.exists()) {
      const content = await file.text();
      return JSON.parse(content) as OpenCodeState;
    }
  } catch (error) {
    log("theme", "Failed to read OpenCode state", { error });
  }
  return {};
}

/**
 * ThemeProvider component that manages theme state.
 * Reads theme preference from OpenCode's state file.
 */
export function ThemeProvider(props: ThemeProviderProps) {
  // Theme state signals
  const [themeName, setThemeName] = createSignal<string>(defaultTheme);
  const [themeMode, setThemeMode] = createSignal<ThemeMode>("dark");

  // Derived resolved theme - recomputes when name or mode changes
  const theme = createMemo(() => {
    return resolveTheme(themeName(), themeMode());
  });

  // Sync theme state with color accessor module for non-reactive usage
  createEffect(() => {
    setCurrentTheme(themeName(), themeMode());
  });

  // Read theme preference from OpenCode state on mount
  onMount(async () => {
    const state = await readOpenCodeState();
    
    if (state.theme && themeNames.includes(state.theme)) {
      setThemeName(state.theme);
      log("theme", "Loaded theme from OpenCode state", { theme: state.theme });
    }
    
    if (state.theme_mode && (state.theme_mode === "dark" || state.theme_mode === "light")) {
      setThemeMode(state.theme_mode);
      log("theme", "Loaded theme mode from OpenCode state", { mode: state.theme_mode });
    }
  });

  const themeValue: ThemeContextValue = {
    theme,
    themeName,
    themeMode,
    themeNames,
  };

  return (
    <ThemeContext.Provider value={themeValue}>
      {props.children}
    </ThemeContext.Provider>
  );
}

/**
 * Hook to access the theme context.
 * Must be used within a ThemeProvider.
 *
 * @throws Error if used outside of ThemeProvider
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
