---
name: shell-env-usage
description: This skill should be used when the user asks to "configure environment variables", "set up .env for plugins", "share secrets between plugins", "load .env into process.env", or needs guidance on how the shell-env plugin provides environment variables to other plugins and shell processes.
version: 1.0.0
last_updated: 2026-03-01
compatibility: opencode
metadata:
  audience: developers
  category: shell-env
  deprecated: false
---

# Shell Environment Plugin

## Overview

The `shell-env` plugin loads environment variables from `.opencode/.env` and makes them available in two ways:

1. **`process.env`** (at plugin init) — for all plugins loaded after `shell-env`
2. **`shell.env` hook** (on every shell invocation) — for shell commands and MCP server processes

This eliminates the need for each plugin to implement its own `.env` file parsing.

## When to Use This Skill

- Setting up a new OpenCode project that uses secrets (API keys, tokens)
- Configuring MCP servers that need environment variables
- Understanding why a plugin can or cannot read `.env` variables
- Debugging missing environment variables in plugins or MCP servers
- Removing redundant `.env` loading logic from a plugin

## How It Works

### Phase 1: Plugin Initialization (`process.env`)

When OpenCode loads the `shell-env` plugin, it reads `.opencode/.env` and injects all variables into `process.env` **before** subsequent plugins are initialized.

```
Plugin loading order (.opencode/package.json dependencies):
  1. shell-env        ← reads .env, sets process.env
  2. time-tracking    ← can read process.env.OPENCODE_USER_EMAIL
  3. other-plugin     ← can read process.env.MY_SECRET
```

**Rules:**
- Existing `process.env` values are **never overwritten** (OS-level exports take precedence)
- If `.opencode/.env` is missing or unreadable, the plugin silently continues
- Variables are available immediately after plugin init — no async delay

### Phase 2: Shell Execution (`shell.env` hook)

On every shell command or MCP server process, the plugin re-reads `.opencode/.env` and injects variables into the shell environment.

```
Shell command execution:
  1. OpenCode calls "shell.env" hook
  2. shell-env injects .env variables into output.env
  3. Shell command runs with merged environment
```

**Rules:**
- Re-reads `.env` on every invocation (picks up changes without restart)
- Existing shell environment variables are **never overwritten**
- MCP servers configured in `opencode.json` see the variables via `{env:KEY}`

## Configuration

### Prerequisites

Add the plugin to `.opencode/package.json`:

```json
{
  "dependencies": {
    "@techdivision/opencode-plugin-shell-env": "github:techdivision/opencode-plugin-shell-env"
  }
}
```

Install and link:

```bash
cd .opencode && npm install
npx opencode-link shell-env
```

### Plugin Order (Critical!)

In `.opencode/package.json`, `shell-env` **must** be listed before any plugin that depends on `.env` variables. OpenCode loads plugins in dependency order:

```json
{
  "dependencies": {
    "@techdivision/opencode-plugin-shell-env": "github:techdivision/opencode-plugin-shell-env",
    "@techdivision/opencode-time-tracking": "github:techdivision/opencode-time-tracking",
    "@opencode-ai/plugin": "1.2.15"
  }
}
```

If `shell-env` is loaded **after** another plugin, that plugin will NOT see the `.env` variables in `process.env` during its initialization.

### `.opencode/.env` File Format

```bash
# Comments (lines starting with #)
KEY=VALUE
KEY="quoted value with spaces"
KEY='single quoted value'
export KEY=VALUE          # Optional export prefix
KEY=value # inline comment (stripped for unquoted values)

# Empty lines are skipped
```

## Impact on Other Plugins

### What Changes for Downstream Plugins

| Before shell-env | After shell-env |
|------------------|-----------------|
| Each plugin reads `.env` itself | Plugins read `process.env` directly |
| Custom `loadEnvValue()` functions needed | Standard `process.env.KEY` access |
| Duplicate `.env` parsing logic | Single source of truth |
| Inconsistent parsing behavior | Consistent parsing via `parseDotenv()` |

### Example: time-tracking Plugin

**Before** (plugin has its own `.env` reader):

```typescript
// ConfigLoader.ts — custom loadEnvValue() function
async function loadEnvValue(directory: string, key: string): Promise<string | null> {
  const envPath = `${directory}/.env`
  const file = Bun.file(envPath)
  if (await file.exists()) {
    const content = await file.text()
    const match = content.match(new RegExp(`^${key}=(.*)$`, "m"))
    if (match) return match[1].trim().replace(/^["']|["']$/g, "")
  }
  return null
}

// Usage
const envValue = await loadEnvValue(`${directory}/.opencode`, ENV_USER_EMAIL)
const userEmail = process.env[ENV_USER_EMAIL] || envValue || userInfo().username
```

**After** (shell-env handles `.env` loading):

```typescript
// ConfigLoader.ts — simplified, no custom .env parsing needed
const userEmail = process.env[ENV_USER_EMAIL] || userInfo().username
```

The entire `loadEnvValue()` function can be removed.

### Fallback Behavior

If `shell-env` is **not installed**, plugins that previously had their own `.env` loading will need to keep it. The recommended pattern for backward compatibility:

```typescript
// Works with or without shell-env
const value = process.env.MY_KEY || fallbackValue
```

Since `shell-env` sets `process.env` before other plugins init, `process.env.MY_KEY` will be populated if shell-env is present, and `undefined` if not.

## Example: MCP Server with Secrets

**`.opencode/.env`**:

```bash
N8N_MCP_BEARER_TOKEN=n8n_api_abc123
OPENCODE_USER_EMAIL=user@example.com
TEMPO_API_TOKEN=tempo_xyz789
```

**`.opencode/opencode.json`**:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": [
    "guideline/*.md"
  ],
  "mcp": {
    "n8n-mcp": {
      "type": "local",
      "command": [
        "npx",
        "-y",
        "mcp-remote",
        "https://n8n.example.com/mcp-server/http",
        "--header",
        "Authorization: ${N8N_MCP_BEARER_TOKEN}"
      ],
      "environment": {
        "N8N_MCP_BEARER_TOKEN": "Bearer {env:N8N_MCP_BEARER_TOKEN}"
      }
    }
  }
}
```

Without `shell-env`, `{env:N8N_MCP_BEARER_TOKEN}` only resolves if the variable is exported in the OS shell. With `shell-env`, it resolves from `.opencode/.env` automatically.

## Supported `.env` Syntax

| Syntax | Example | Parsed Value |
|--------|---------|-------------|
| Simple | `KEY=value` | `value` |
| Double-quoted | `KEY="hello world"` | `hello world` |
| Single-quoted | `KEY='hello world'` | `hello world` |
| Export prefix | `export KEY=value` | `value` |
| Inline comment | `KEY=value # comment` | `value` |
| Comment line | `# this is a comment` | *(skipped)* |
| Empty line | *(blank)* | *(skipped)* |

## Troubleshooting

### Variable not available in plugin

| Symptom | Cause | Solution |
|---------|-------|----------|
| `process.env.KEY` is `undefined` | shell-env loaded after the plugin | Move shell-env to first position in `.opencode/package.json` dependencies |
| `process.env.KEY` is `undefined` | `.opencode/.env` file missing | Create `.opencode/.env` with the variable |
| `process.env.KEY` has wrong value | OS-level export overrides `.env` | Remove the OS-level export or update it |
| MCP server doesn't see variable | shell-env not installed | Install and link the plugin |

### Variable not available in MCP server

1. Check that `.opencode/.env` contains the variable
2. Check that `opencode.json` references it as `{env:KEY}`
3. Check that shell-env is installed and linked
4. Restart OpenCode after changes to `.opencode/.env`

## Checklist

- ✅ `shell-env` plugin installed in `.opencode/package.json`
- ✅ `shell-env` plugin linked via `npx opencode-link shell-env`
- ✅ `shell-env` listed **before** dependent plugins in `.opencode/package.json`
- ✅ `.opencode/.env` file exists with correct syntax
- ✅ `.opencode/.env` is in `.gitignore` (contains secrets!)
- ✅ No duplicate `.env` parsing logic in downstream plugins
- ✅ MCP servers reference variables as `{env:KEY}` in `opencode.json`

## References

- [OpenCode Plugin System](../../.opencode/skills/core-plugin-system/SKILL.md)
- [OpenCode Plugin API — `shell.env` hook](https://opencode.ai/docs/plugins)
