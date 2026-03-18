import type { Plugin } from "@opencode-ai/plugin"
import fs from "fs"
import os from "os"
import path from "path"

/**
 * ShellEnvPlugin - Loads .env variables into OpenCode's process and shell environment.
 *
 * This plugin provides environment variables from `.env` files to:
 *
 * 1. **process.env** (at plugin init) — so that subsequent plugins loaded after
 *    this one can read the variables via `process.env.KEY`. This eliminates the
 *    need for each plugin to implement its own `.env` file parsing.
 *
 * 2. **shell.env hook** (on every shell invocation) — so that all shell commands
 *    and MCP server processes spawned by OpenCode see the variables.
 *
 * Primary use case: Provide secrets (API keys, bearer tokens) to MCP servers
 * and other plugins without hardcoding them in opencode.json. For example, the
 * time-tracking plugin reads OPENCODE_USER_EMAIL from process.env, and the n8n
 * MCP server reads N8N_MCP_BEARER_TOKEN via the shell.env hook.
 *
 * ## .env Loading Order (Last Wins)
 *
 * The plugin reads `.env` files from two locations and merges them with a
 * "last wins" strategy — more specific sources override less specific ones:
 *
 * | Priority | Source                          | Purpose                              |
 * |----------|---------------------------------|--------------------------------------|
 * | 1 (base) | `~/.config/opencode/.env`       | Global defaults (user email, shared keys) |
 * | 2 (wins) | `<projectDir>/.opencode/.env`   | Project-specific overrides           |
 *
 * Both layers override existing OS environment variables. If a key appears in
 * both files, the project-level value wins. This matches the "last wins"
 * convention used by the opencode-cli plugin discovery (local overrides user).
 *
 * ## Behavior
 *
 * - Reads both `.env` files once at init and on every shell invocation
 * - Last Wins: project `.env` overrides global `.env` overrides OS env
 * - Silently skips missing or unreadable `.env` files
 *
 * **Important:** This plugin must be listed BEFORE other plugins in the OpenCode
 * configuration so that `process.env` is populated before they initialize.
 *
 * Dependencies: @opencode-ai/plugin (see .opencode/package.json)
 *
 * @see opencode.json - MCP server config referencing env vars
 * @see .env.example - Template with all supported variables
 */

/**
 * Parses a .env file content string and returns a Record of key-value pairs.
 *
 * Supports:
 * - KEY=VALUE
 * - KEY="quoted value"
 * - KEY='single quoted value'
 * - Comments (lines starting with #)
 * - Inline comments (KEY=value # comment)
 * - Empty lines (skipped)
 * - Lines with export prefix (export KEY=VALUE)
 */
function parseDotenv(content: string): Record<string, string> {
  const env: Record<string, string> = {}

  for (const line of content.split("\n")) {
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }

    // Remove optional "export " prefix
    const normalized = trimmed.startsWith("export ")
      ? trimmed.slice(7)
      : trimmed

    // Find the first '=' to split key and value
    const eqIndex = normalized.indexOf("=")
    if (eqIndex === -1) {
      continue
    }

    const key = normalized.slice(0, eqIndex).trim()
    let value = normalized.slice(eqIndex + 1).trim()

    // Skip keys that are commented out (e.g. "# KEY=value" already caught above,
    // but handle edge case of key starting with #)
    if (key.startsWith("#")) {
      continue
    }

    // Handle quoted values
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      // Remove surrounding quotes
      value = value.slice(1, -1)
    } else {
      // Remove inline comments (only for unquoted values)
      // e.g. VALUE=foo # this is a comment
      const commentIndex = value.indexOf(" #")
      if (commentIndex !== -1) {
        value = value.slice(0, commentIndex).trim()
      }
    }

    if (key) {
      env[key] = value
    }
  }

  return env
}

/**
 * Reads a .env file from the given path and returns the parsed variables.
 * Returns an empty record if the file is missing or unreadable.
 */
function loadEnvFromPath(envPath: string): Record<string, string> {
  if (!fs.existsSync(envPath)) {
    return {}
  }

  try {
    const content = fs.readFileSync(envPath, "utf-8")
    return parseDotenv(content)
  } catch {
    // Silently ignore read errors (permission denied, etc.)
    return {}
  }
}

/**
 * Returns the global OpenCode config directory path.
 *
 * Uses the same convention as opencode-cli:
 *   os.homedir() + "/.config/opencode"
 *
 * No XDG_CONFIG_HOME or platform-specific logic — consistent with opencode-cli.
 */
function getGlobalConfigDir(): string {
  return path.join(os.homedir(), ".config", "opencode")
}

/**
 * Merges .env variables from global and project locations using "last wins".
 *
 * Loading order (later entries override earlier ones):
 *   1. ~/.config/opencode/.env         (global defaults)
 *   2. <projectDir>/.opencode/.env     (project overrides)
 *
 * @param projectDir - The project working directory (input.directory)
 * @returns Merged key-value record with project values winning over global
 */
function loadMergedEnv(projectDir: string): Record<string, string> {
  const globalEnvPath = path.join(getGlobalConfigDir(), ".env")
  const projectEnvPath = path.join(projectDir, ".opencode", ".env")

  const globalEnv = loadEnvFromPath(globalEnvPath)
  const projectEnv = loadEnvFromPath(projectEnvPath)

  // Spread merge: project values override global values (last wins)
  return { ...globalEnv, ...projectEnv }
}

export const ShellEnvPlugin: Plugin = async (input) => {
  const projectDir = input.directory

  // Phase 1: Inject merged .env variables into process.env at plugin init time.
  // This makes them available to all plugins loaded AFTER this one via
  // process.env, eliminating the need for each plugin to parse .env itself.
  //
  // Last Wins: .env values OVERRIDE existing OS environment variables.
  // This is intentional — explicit .env configuration takes precedence
  // over inherited shell environment, matching the opencode-cli convention.
  const merged = loadMergedEnv(projectDir)
  for (const [key, value] of Object.entries(merged)) {
    process.env[key] = value
  }

  return {
    // Phase 2: Inject merged .env variables into shell execution environment.
    // This makes them available to shell commands and MCP server processes.
    // Re-reads .env files on every invocation to pick up changes without restart.
    "shell.env": async (_input, output) => {
      const envVars = loadMergedEnv(projectDir)
      for (const [key, value] of Object.entries(envVars)) {
        output.env[key] = value
      }
    },
  }
}
