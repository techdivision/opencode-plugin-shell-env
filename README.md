# opencode-plugin-shell-env

Loads `.opencode/.env` variables into OpenCode's shell environment and MCP server processes.

## Problem

OpenCode's `opencode.json` supports environment variable references like `{env:N8N_MCP_BEARER_TOKEN}`, but these only resolve **OS-level environment variables** (i.e., variables exported in the shell). An `.opencode/.env` file is **not** read by default.

## Solution

This plugin hooks into OpenCode's `shell.env` lifecycle event and injects variables from `<projectRoot>/.opencode/.env` into every shell command and MCP server process spawned by OpenCode.

### Behavior

- Reads `<projectRoot>/.opencode/.env` on every shell invocation
- **Does NOT overwrite** variables already present in the environment
- Silently skips if `.opencode/.env` is missing or unreadable
- Parses standard `.env` syntax

### Supported `.env` Syntax

```bash
# Comments (lines starting with #)
KEY=VALUE
KEY="quoted value"
KEY='single quoted value'
export KEY=VALUE          # Optional export prefix
KEY=value # inline comment
```

## Installation

Add the plugin to your `.opencode/package.json`:

```json
{
  "dependencies": {
    "@techdivision/opencode-plugin-shell-env": "github:techdivision/opencode-plugin-shell-env"
  }
}
```

Then install and link:

```bash
cd .opencode && npm install
npx opencode-link shell-env
```

## Contents

| Name | Type | Description |
|------|------|-------------|
| `shell-env.ts` | Plugin | Hooks into `shell.env` lifecycle to inject `.opencode/.env` variables |

## Example: n8n MCP Server with `.env`

**`.opencode/.env`**:

```bash
N8N_MCP_BEARER_TOKEN=n8n_api_abc123
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

Without the `shell-env` plugin, `{env:N8N_MCP_BEARER_TOKEN}` would only resolve if the variable is exported in the shell (`export N8N_MCP_BEARER_TOKEN=...`). With the plugin, it resolves from `.opencode/.env` automatically.

## License

MIT
