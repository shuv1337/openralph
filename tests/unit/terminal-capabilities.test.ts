import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  detectCapabilities,
  detectTerminalCapabilities,
  getCapabilities,
  resetCapabilitiesCache,
  hasColorSupport,
  getTerminalDescription,
  type TerminalCapabilities,
  type CapabilityLevel,
  type TerminalTier,
} from "../../src/lib/terminal-capabilities";

/**
 * Comprehensive tests for terminal-capabilities module.
 * 
 * Tests cover:
 * - NO_COLOR / FORCE_COLOR environment variable handling (RFC 3972)
 * - CI environment detection
 * - Windows cmd.exe vs Windows Terminal
 * - macOS terminal detection
 * - Linux terminal detection
 * - Memoization with TTL
 */
describe("terminal-capabilities", () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };
  const originalIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    // Reset environment to clean state
    process.env = { ...originalEnv };
    resetCapabilitiesCache();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
    process.env = { ...originalEnv };
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    resetCapabilitiesCache();
  });

  describe("exports", () => {
    it("SHOULD export detectTerminalCapabilities as alias for detectCapabilities", () => {
      expect(detectTerminalCapabilities).toBe(detectCapabilities);
    });

    it("SHOULD export all required types and functions", () => {
      expect(typeof detectCapabilities).toBe("function");
      expect(typeof getCapabilities).toBe("function");
      expect(typeof resetCapabilitiesCache).toBe("function");
      expect(typeof hasColorSupport).toBe("function");
      expect(typeof getTerminalDescription).toBe("function");
    });
  });

  describe("NO_COLOR environment variable (RFC 3972)", () => {
    it("SHOULD respect NO_COLOR and disable all colors", () => {
      process.env.NO_COLOR = "1";
      const caps = detectCapabilities();
      
      expect(caps.supportsColor).toBe(false);
      expect(caps.level).toBe("basic");
      expect(caps.colorLevel).toBe(0);
      expect(caps.supportsTrueColor).toBe(false);
    });

    it("SHOULD respect NO_COLOR even when empty string", () => {
      process.env.NO_COLOR = "";
      const caps = detectCapabilities();
      
      expect(caps.supportsColor).toBe(false);
      expect(caps.level).toBe("basic");
    });

    it("SHOULD respect NO_COLOR over FORCE_COLOR", () => {
      process.env.NO_COLOR = "1";
      process.env.FORCE_COLOR = "3";
      const caps = detectCapabilities();
      
      expect(caps.supportsColor).toBe(false);
      expect(caps.level).toBe("basic");
    });

    it("SHOULD preserve unicode support when NO_COLOR is set (non-legacy)", () => {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      process.env.NO_COLOR = "1";
      delete process.env.WT_SESSION;
      delete process.env.ANSICON;
      delete process.env.ConEmuANSI;
      
      const caps = detectCapabilities();
      
      expect(caps.supportsUnicode).toBe(true); // Unicode still works without color
    });
  });

  describe("FORCE_COLOR environment variable", () => {
    beforeEach(() => {
      delete process.env.NO_COLOR;
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    });

    it("SHOULD force color level 1 (basic colors)", () => {
      process.env.FORCE_COLOR = "1";
      process.env.TERM = "dumb"; // Would normally be no color
      
      const caps = detectCapabilities();
      
      expect(caps.supportsColor).toBe(true);
      expect(caps.level).toBe("colors");
      expect(caps.colorLevel).toBe(1);
    });

    it("SHOULD force color level 2 (256 colors)", () => {
      process.env.FORCE_COLOR = "2";
      process.env.TERM = "dumb";
      
      const caps = detectCapabilities();
      
      expect(caps.supportsColor).toBe(true);
      expect(caps.level).toBe("256");
      expect(caps.colorLevel).toBe(2);
    });

    it("SHOULD force color level 3 (truecolor)", () => {
      process.env.FORCE_COLOR = "3";
      process.env.TERM = "dumb";
      
      const caps = detectCapabilities();
      
      expect(caps.supportsColor).toBe(true);
      expect(caps.level).toBe("truecolor");
      expect(caps.colorLevel).toBe(3);
      expect(caps.supportsTrueColor).toBe(true);
    });

    it("SHOULD disable colors with FORCE_COLOR=0", () => {
      process.env.FORCE_COLOR = "0";
      process.env.COLORTERM = "truecolor"; // Would normally enable truecolor
      
      const caps = detectCapabilities();
      
      expect(caps.supportsColor).toBe(false);
      expect(caps.level).toBe("basic");
      expect(caps.colorLevel).toBe(0);
    });

    it("SHOULD treat FORCE_COLOR=true as level 1", () => {
      process.env.FORCE_COLOR = "true";
      process.env.TERM = "dumb";
      
      const caps = detectCapabilities();
      
      expect(caps.supportsColor).toBe(true);
      expect(caps.colorLevel).toBe(1);
    });
  });

  describe("CI environment detection", () => {
    beforeEach(() => {
      // Clear all CI-related env vars
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      delete process.env.GITLAB_CI;
      delete process.env.CIRCLECI;
      delete process.env.TRAVIS;
      delete process.env.JENKINS_URL;
      delete process.env.TF_BUILD;
      delete process.env.BITBUCKET_BUILD_NUMBER;
      delete process.env.CODEBUILD_BUILD_ID;
      delete process.env.BUILDKITE;
      delete process.env.DRONE;
      delete process.env.CONTINUOUS_INTEGRATION;
    });

    it("SHOULD detect GitHub Actions", () => {
      process.env.GITHUB_ACTIONS = "true";
      const caps = detectCapabilities();
      
      expect(caps.isCI).toBe(true);
      expect(caps.ciPlatform).toBe("github_actions");
    });

    it("SHOULD detect GitLab CI", () => {
      process.env.GITLAB_CI = "true";
      const caps = detectCapabilities();
      
      expect(caps.isCI).toBe(true);
      expect(caps.ciPlatform).toBe("gitlab_ci");
    });

    it("SHOULD detect CircleCI", () => {
      process.env.CIRCLECI = "true";
      const caps = detectCapabilities();
      
      expect(caps.isCI).toBe(true);
      expect(caps.ciPlatform).toBe("circleci");
    });

    it("SHOULD detect Travis CI", () => {
      process.env.TRAVIS = "true";
      const caps = detectCapabilities();
      
      expect(caps.isCI).toBe(true);
      expect(caps.ciPlatform).toBe("travis");
    });

    it("SHOULD detect Jenkins", () => {
      process.env.JENKINS_URL = "http://jenkins.example.com";
      const caps = detectCapabilities();
      
      expect(caps.isCI).toBe(true);
      expect(caps.ciPlatform).toBe("jenkins");
    });

    it("SHOULD detect Azure Pipelines", () => {
      process.env.TF_BUILD = "True";
      const caps = detectCapabilities();
      
      expect(caps.isCI).toBe(true);
      expect(caps.ciPlatform).toBe("azure_pipelines");
    });

    it("SHOULD detect Bitbucket Pipelines", () => {
      process.env.BITBUCKET_BUILD_NUMBER = "123";
      const caps = detectCapabilities();
      
      expect(caps.isCI).toBe(true);
      expect(caps.ciPlatform).toBe("bitbucket");
    });

    it("SHOULD detect AWS CodeBuild", () => {
      process.env.CODEBUILD_BUILD_ID = "build-123";
      const caps = detectCapabilities();
      
      expect(caps.isCI).toBe(true);
      expect(caps.ciPlatform).toBe("codebuild");
    });

    it("SHOULD detect Buildkite", () => {
      process.env.BUILDKITE = "true";
      const caps = detectCapabilities();
      
      expect(caps.isCI).toBe(true);
      expect(caps.ciPlatform).toBe("buildkite");
    });

    it("SHOULD detect Drone CI", () => {
      process.env.DRONE = "true";
      const caps = detectCapabilities();
      
      expect(caps.isCI).toBe(true);
      expect(caps.ciPlatform).toBe("drone");
    });

    it("SHOULD detect generic CI=true", () => {
      process.env.CI = "true";
      const caps = detectCapabilities();
      
      expect(caps.isCI).toBe(true);
      expect(caps.ciPlatform).toBe("unknown");
    });

    it("SHOULD detect CI=1", () => {
      process.env.CI = "1";
      const caps = detectCapabilities();
      
      expect(caps.isCI).toBe(true);
    });

    it("SHOULD NOT be interactive in CI environments", () => {
      process.env.GITHUB_ACTIONS = "true";
      Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
      
      const caps = detectCapabilities();
      
      expect(caps.isCI).toBe(true);
      expect(caps.isInteractive).toBe(false); // CI overrides TTY
    });

    it("SHOULD report isCI=false when no CI env vars are set", () => {
      const caps = detectCapabilities();
      
      expect(caps.isCI).toBe(false);
      expect(caps.ciPlatform).toBeUndefined();
    });
  });

  describe("Windows terminal detection", () => {
    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      delete process.env.WT_SESSION;
      delete process.env.ANSICON;
      delete process.env.ConEmuANSI;
      delete process.env.ConEmuBuild;
      delete process.env.TERM_PROGRAM;
      // Also clear MSYSTEM and TERM to properly simulate legacy Windows cmd.exe
      delete process.env.MSYSTEM;
      delete process.env.TERM;
    });

    it("SHOULD detect Windows Terminal via WT_SESSION", () => {
      process.env.WT_SESSION = "some-guid";
      const caps = detectCapabilities();
      
      expect(caps.isWindows).toBe(true);
      expect(caps.isWindowsTerminal).toBe(true);
      expect(caps.isWindowsLegacy).toBe(false);
      expect(caps.supportsTrueColor).toBe(true);
      expect(caps.tier).not.toBe("legacy_windows");
    });

    it("SHOULD detect Windows 10+ cmd.exe as modern (not legacy)", () => {
      // On Windows 10+, even without WT_SESSION, ANSI is supported natively
      // This test reflects the behavior on modern Windows
      const caps = detectCapabilities();
      
      expect(caps.isWindows).toBe(true);
      // On Windows 10+, this should be false because VT is supported natively
      // The test runs on Windows 10+, so isWindowsLegacy should be false
      expect(caps.isWindowsLegacy).toBe(false);
      expect(caps.isWindowsTerminal).toBe(false);
      // Windows 10+ supports 256 colors natively
      expect(caps.supportsColor).toBe(true);
    });

    it("SHOULD detect ConEmu with ANSI support", () => {
      process.env.ConEmuANSI = "ON";
      const caps = detectCapabilities();
      
      expect(caps.isWindows).toBe(true);
      expect(caps.isConEmu).toBe(true);
      expect(caps.isWindowsLegacy).toBe(false);
      expect(caps.supportsColor).toBe(true);
    });

    it("SHOULD detect ConEmu via ConEmuBuild", () => {
      process.env.ConEmuBuild = "190714";
      const caps = detectCapabilities();
      
      expect(caps.isConEmu).toBe(true);
      expect(caps.isWindowsLegacy).toBe(false);
    });

    it("SHOULD detect ANSICON", () => {
      process.env.ANSICON = "80x25 (80x25)";
      const caps = detectCapabilities();
      
      expect(caps.isWindowsLegacy).toBe(false);
      expect(caps.supportsColor).toBe(true);
    });

    it("SHOULD detect VS Code terminal on Windows", () => {
      process.env.TERM_PROGRAM = "vscode";
      const caps = detectCapabilities();
      
      expect(caps.isVscodeTerminal).toBe(true);
      expect(caps.isWindowsLegacy).toBe(false);
      expect(caps.supportsTrueColor).toBe(true);
    });
  });

  describe("terminal tier classification", () => {
    it("SHOULD classify Windows 10+ without WT_SESSION as ansi_256 tier", () => {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      delete process.env.WT_SESSION;
      delete process.env.ANSICON;
      delete process.env.ConEmuANSI;
      delete process.env.ConEmuBuild;
      delete process.env.TERM_PROGRAM;
      // Also clear MSYSTEM and TERM to properly simulate Windows cmd.exe
      delete process.env.MSYSTEM;
      delete process.env.TERM;
      
      const caps = detectCapabilities();
      
      // On Windows 10+, the tier should be ansi_256 (not legacy_windows)
      // because Windows 10+ supports VT sequences natively
      expect(caps.tier).toBe("ansi_256");
    });

    it("SHOULD classify dumb terminal as basic_ansi tier", () => {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      process.env.TERM = "dumb";
      
      const caps = detectCapabilities();
      
      expect(caps.tier).toBe("basic_ansi");
    });

    it("SHOULD classify 256-color terminal as ansi_256 tier", () => {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      process.env.TERM = "xterm-256color";
      delete process.env.COLORTERM;
      
      const caps = detectCapabilities();
      
      expect(caps.tier).toBe("ansi_256");
    });

    it("SHOULD classify truecolor terminal with animation as full_feature tier", () => {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
      process.env.TERM = "xterm-256color";
      process.env.COLORTERM = "truecolor";
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      
      const caps = detectCapabilities();
      
      expect(caps.tier).toBe("full_feature");
    });

    it("SHOULD classify truecolor without animation as truecolor tier", () => {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
      process.env.COLORTERM = "truecolor";
      // Clear MSYSTEM to ensure no alternative interactive detection
      delete process.env.MSYSTEM;
      delete process.env.WT_SESSION;
      
      const caps = detectCapabilities();
      
      // Non-interactive = no animation support
      expect(caps.supportsAnimation).toBe(false);
      expect(caps.tier).toBe("truecolor");
    });
  });

  describe("block character support", () => {
    it("SHOULD support block characters with unicode + 256 colors", () => {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      process.env.TERM = "xterm-256color";
      
      const caps = detectCapabilities();
      
      expect(caps.supportsUnicode).toBe(true);
      expect(caps.supportsBlockCharacters).toBe(true);
    });

    it("SHOULD support block characters on Windows 10+", () => {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      delete process.env.WT_SESSION;
      delete process.env.ANSICON;
      delete process.env.ConEmuANSI;
      delete process.env.ConEmuBuild;
      delete process.env.TERM_PROGRAM;
      // Also clear MSYSTEM and TERM to properly simulate Windows cmd.exe
      delete process.env.MSYSTEM;
      delete process.env.TERM;
      
      const caps = detectCapabilities();
      
      // Windows 10+ supports Unicode and 256 colors, so block characters should work
      expect(caps.supportsBlockCharacters).toBe(true);
    });

    it("SHOULD NOT support block characters with basic color level", () => {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      process.env.TERM = "dumb";
      
      const caps = detectCapabilities();
      
      expect(caps.supportsBlockCharacters).toBe(false);
    });
  });

  describe("memoization with TTL", () => {
    it("SHOULD cache capabilities on repeated calls", () => {
      const first = getCapabilities();
      const second = getCapabilities();
      
      expect(first).toBe(second); // Same reference
    });

    it("SHOULD return fresh detection after cache reset", () => {
      const first = getCapabilities();
      resetCapabilitiesCache();
      const second = getCapabilities();
      
      expect(first).not.toBe(second); // Different reference
      expect(first).toEqual(second); // Same values (env unchanged)
    });

    it("SHOULD detect environment changes after cache reset", () => {
      // Set up environment with forced colors
      delete process.env.NO_COLOR;
      process.env.FORCE_COLOR = "1";
      resetCapabilitiesCache();
      
      const first = getCapabilities();
      expect(first.supportsColor).toBe(true);
      
      // Change to NO_COLOR
      process.env.NO_COLOR = "1";
      
      // Cache still has old value
      const cached = getCapabilities();
      expect(cached.supportsColor).toBe(true);
      
      // After reset, picks up new env
      resetCapabilitiesCache();
      const fresh = getCapabilities();
      expect(fresh.supportsColor).toBe(false);
    });
  });

  describe("hasColorSupport helper", () => {
    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      delete process.env.NO_COLOR;
    });

    it("SHOULD return true when terminal meets required level", () => {
      process.env.COLORTERM = "truecolor";
      resetCapabilitiesCache();
      
      expect(hasColorSupport("colors")).toBe(true);
      expect(hasColorSupport("256")).toBe(true);
      expect(hasColorSupport("truecolor")).toBe(true);
    });

    it("SHOULD return false when terminal is below required level", () => {
      process.env.FORCE_COLOR = "1"; // Force basic colors only
      resetCapabilitiesCache();
      
      expect(hasColorSupport("colors")).toBe(true);
      expect(hasColorSupport("256")).toBe(false);
      expect(hasColorSupport("truecolor")).toBe(false);
    });

    it("SHOULD default to checking for 'colors' level", () => {
      process.env.FORCE_COLOR = "1";
      resetCapabilitiesCache();
      
      expect(hasColorSupport()).toBe(true);
    });
  });

  describe("getTerminalDescription helper", () => {
    it("SHOULD include platform in description", () => {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      resetCapabilitiesCache();
      
      const desc = getTerminalDescription();
      
      expect(desc).toContain("Linux");
    });

    it("SHOULD include tier in description", () => {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      process.env.TERM = "xterm-256color";
      resetCapabilitiesCache();
      
      const desc = getTerminalDescription();
      
      expect(desc).toMatch(/tier=\w+/);
    });

    it("SHOULD include CI platform when in CI", () => {
      process.env.GITHUB_ACTIONS = "true";
      resetCapabilitiesCache();
      
      const desc = getTerminalDescription();
      
      expect(desc).toContain("CI:github_actions");
    });

    it("SHOULD include terminal name on Windows Terminal", () => {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      process.env.WT_SESSION = "some-guid";
      resetCapabilitiesCache();
      
      const desc = getTerminalDescription();
      
      expect(desc).toContain("Windows");
      expect(desc).toContain("Windows Terminal");
    });
  });

  describe("interactive detection", () => {
    it("SHOULD be interactive when stdout is TTY and not in CI", () => {
      Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
      delete process.env.CI;
      delete process.env.GITHUB_ACTIONS;
      resetCapabilitiesCache();
      
      const caps = detectCapabilities();
      
      expect(caps.isInteractive).toBe(true);
    });

    it("SHOULD NOT be interactive when stdout is not TTY", () => {
      Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
      delete process.env.CI;
      // Clear MSYSTEM and WT_SESSION to ensure no alternative interactive detection
      delete process.env.MSYSTEM;
      delete process.env.WT_SESSION;
      resetCapabilitiesCache();
      
      const caps = detectCapabilities();
      
      expect(caps.isInteractive).toBe(false);
    });

    it("SHOULD NOT be interactive in CI even with TTY", () => {
      Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
      process.env.CI = "true";
      resetCapabilitiesCache();
      
      const caps = detectCapabilities();
      
      expect(caps.isInteractive).toBe(false);
    });
  });

  describe("Kitty terminal detection", () => {
    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    });

    it("SHOULD detect Kitty via TERM_PROGRAM", () => {
      process.env.TERM_PROGRAM = "kitty";
      const caps = detectCapabilities();
      
      expect(caps.supportsTrueColor).toBe(true);
      expect(caps.supportsKeyboardEnhancement).toBe(true);
    });

    it("SHOULD detect Kitty via KITTY_WINDOW_ID", () => {
      process.env.KITTY_WINDOW_ID = "1";
      const caps = detectCapabilities();
      
      expect(caps.supportsTrueColor).toBe(true);
      expect(caps.supportsKeyboardEnhancement).toBe(true);
    });
  });

  describe("keyboard enhancement detection", () => {
    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    });

    it("SHOULD support keyboard enhancement for iTerm2", () => {
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
      process.env.TERM_PROGRAM = "iTerm.app";
      
      const caps = detectCapabilities();
      
      expect(caps.supportsKeyboardEnhancement).toBe(true);
    });

    it("SHOULD NOT support keyboard enhancement for Terminal.app", () => {
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
      process.env.TERM_PROGRAM = "Apple_Terminal";
      
      const caps = detectCapabilities();
      
      expect(caps.supportsKeyboardEnhancement).toBe(false);
    });

    it("SHOULD NOT support keyboard enhancement for dumb terminals", () => {
      process.env.TERM = "dumb";
      
      const caps = detectCapabilities();
      
      expect(caps.supportsKeyboardEnhancement).toBe(false);
    });

    it("SHOULD support keyboard enhancement for xterm-compatible terminals", () => {
      process.env.TERM = "xterm-256color";
      
      const caps = detectCapabilities();
      
      expect(caps.supportsKeyboardEnhancement).toBe(true);
    });
  });
});
