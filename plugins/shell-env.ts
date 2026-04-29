/**
 * OpenCode Shell Environment Plugin
 *
 * @package     @techdivision/opencode-plugin-shell-env
 * @author      TechDivision GmbH
 * @license     MIT
 * @version     1.3.0
 *
 * @description
 * Loads .env variables from ~/.config/opencode/.env and <projectDir>/.opencode/.env
 * into process.env (at plugin init) and shell.env hook (at every shell invocation).
 *
 * This ensures environment variables like OPENCODE_USER_EMAIL and API keys
 * are available to all plugins and shell commands without hardcoding them.
 */

// Re-export the plugin from the main package
export { plugin } from "../src/shell-env.ts"
