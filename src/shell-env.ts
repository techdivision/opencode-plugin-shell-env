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

/**
 * Reads the "plugin" array from an opencode.json file.
 *
 * Returns an empty array if the file is missing, unreadable, not valid JSON,
 * or does not contain a "plugin" array.
 */
function readJsonPluginArray(jsonPath: string): string[] {
  if (!fs.existsSync(jsonPath)) {
    return []
  }

  try {
    const content = fs.readFileSync(jsonPath, "utf-8")
    const parsed = JSON.parse(content)
    if (!Array.isArray(parsed.plugin)) {
      return []
    }
    return parsed.plugin.filter((entry: unknown) => typeof entry === "string")
  } catch {
    // Silently ignore read/parse errors
    return []
  }
}

/**
 * Merges the "plugin" arrays from the global and project opencode.json files.
 *
 * Reads:
 *   1. ~/.config/opencode/opencode.json   (global)
 *   2. <projectDir>/.opencode/opencode.json (project)
 *
 * The two arrays are concatenated and deduplicated (order preserved, first wins).
 *
 * @param projectDir - The project working directory (input.directory)
 * @returns Deduplicated list of plugin package names
 */
function getMergedPluginList(projectDir: string): string[] {
  const globalConfigPath = path.join(getGlobalConfigDir(), "opencode.json")
  const projectConfigPath = path.join(projectDir, ".opencode", "opencode.json")

  const merged = [
    ...readJsonPluginArray(globalConfigPath),
    ...readJsonPluginArray(projectConfigPath),
  ]

  return [...new Set(merged)]
}

/**
 * Resolves a plugin package name to its installed package directory in the
 * OpenCode package cache.
 *
 * Cache layout: ~/.cache/opencode/packages/<name>@<version>/node_modules/<name>
 *
 * The plugin name in opencode.json has no version suffix, while the cache
 * directory does (e.g. "opencode-plugin-magento@latest"). This function matches
 * the cache directory by prefix (<name>@*) and returns the inner package path.
 *
 * @param pluginName - Plugin package name (e.g. "@techdivision/opencode-plugin-magento")
 * @returns Absolute path to the installed package, or null if not found
 */
function resolvePackageCacheDir(pluginName: string): string | null {
  const packagesDir = path.join(os.homedir(), ".cache", "opencode", "packages")

  // Split scoped names: "@scope/name" -> ["@scope", "name"]
  const lastSlash = pluginName.lastIndexOf("/")
  const scope = lastSlash === -1 ? "" : pluginName.slice(0, lastSlash)
  const bareName = lastSlash === -1 ? pluginName : pluginName.slice(lastSlash + 1)

  const searchDir = scope ? path.join(packagesDir, scope) : packagesDir

  try {
    const entries = fs.readdirSync(searchDir)
    const match = entries.find((entry) => entry.startsWith(bareName + "@"))
    if (!match) {
      return null
    }

    const packagePath = path.join(
      searchDir,
      match,
      "node_modules",
      pluginName,
    )
    if (!fs.existsSync(packagePath)) {
      return null
    }
    return packagePath
  } catch {
    // Silently ignore read errors
    return null
  }
}

/**
 * Recursively finds all directories that directly contain a SKILL.md file.
 *
 * Skill folders are nested at varying depths within a package's skills/ dir,
 * so each directory holding a SKILL.md is treated as one skill unit.
 *
 * @param skillsRoot - Directory to search (e.g. <package>/skills)
 * @returns List of absolute paths to skill leaf directories
 */
function findSkillLeafDirs(skillsRoot: string): string[] {
  const results: string[] = []

  try {
    const entries = fs.readdirSync(skillsRoot, { withFileTypes: true })

    const hasSkillMd = entries.some(
      (entry) => entry.isFile() && entry.name === "SKILL.md",
    )
    if (hasSkillMd) {
      results.push(skillsRoot)
      return results
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        results.push(...findSkillLeafDirs(path.join(skillsRoot, entry.name)))
      }
    }
  } catch {
    // Silently ignore unreadable directories
  }

  return results
}

/**
 * Removes all existing symlinks in the given directory.
 *
 * Only symbolic links are removed — real files and directories are left
 * untouched to avoid data loss. Runs before fresh symlinks are created so the
 * skills directory always reflects the currently installed plugins.
 *
 * @param targetDir - Directory whose symlinks should be cleared
 */
function clearSkillSymlinks(targetDir: string): void {
  if (!fs.existsSync(targetDir)) {
    return
  }

  try {
    for (const entry of fs.readdirSync(targetDir)) {
      const entryPath = path.join(targetDir, entry)
      try {
        if (fs.lstatSync(entryPath).isSymbolicLink()) {
          fs.unlinkSync(entryPath)
        }
      } catch {
        // Silently ignore individual entry errors
      }
    }
  } catch {
    // Silently ignore directory read errors
  }
}

/**
 * Creates a symlink for a single skill leaf directory.
 *
 * The link name is prefixed with the plugin's short name to guarantee
 * uniqueness across plugins (e.g. "opencode-plugin-magento-magento-eav-attributes").
 *
 * @param skillDir - Absolute path to the skill leaf directory (the link target)
 * @param targetDir - Directory where the symlink is created (.opencode/skills)
 * @param pluginShortName - Basename of the plugin, used as link name prefix
 */
function createSkillSymlink(
  skillDir: string,
  targetDir: string,
  pluginShortName: string,
): void {
  try {
    const linkName = pluginShortName + "-" + path.basename(skillDir)
    const linkPath = path.join(targetDir, linkName)
    fs.symlinkSync(skillDir, linkPath, "dir")
  } catch {
    // Silently ignore symlink creation errors (e.g. already exists)
  }
}

/**
 * Links the skills of all configured plugins into .opencode/skills.
 *
 * Workflow:
 *   1. Only run if a ".opencode" directory exists in the project.
 *   2. Clear all existing symlinks in .opencode/skills.
 *   3. Merge the "plugin" arrays from global + project opencode.json.
 *   4. For each plugin, resolve its installed package in the cache and find
 *      every skill leaf directory (a folder containing SKILL.md).
 *   5. Create a prefixed symlink for each skill into .opencode/skills.
 *
 * Never throws — all errors are silently ignored.
 *
 * @param projectDir - The project working directory (input.directory)
 */
function linkPluginSkills(projectDir: string): void {
  const opencodeDir = path.join(projectDir, ".opencode")
  if (!fs.existsSync(opencodeDir)) {
    return
  }

  const skillsTargetDir = path.join(opencodeDir, "skills")
  clearSkillSymlinks(skillsTargetDir)

  const pluginNames = getMergedPluginList(projectDir)
  if (pluginNames.length === 0) {
    return
  }

  try {
    fs.mkdirSync(skillsTargetDir, { recursive: true })
  } catch {
    return
  }

  for (const pluginName of pluginNames) {
    const packageDir = resolvePackageCacheDir(pluginName)
    if (!packageDir) {
      continue
    }

    const skillsRoot = path.join(packageDir, "skills")
    if (!fs.existsSync(skillsRoot)) {
      continue
    }

    const pluginShortName = path.basename(pluginName)
    for (const skillDir of findSkillLeafDirs(skillsRoot)) {
      createSkillSymlink(skillDir, skillsTargetDir, pluginShortName)
    }
  }
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

  // Link plugin skills into .opencode/skills (clears stale symlinks first).
  // Guarded so a failure here can never block OpenCode startup.
  try {
    linkPluginSkills(projectDir)
  } catch {
    // Silently ignore — skill linking is best-effort
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
