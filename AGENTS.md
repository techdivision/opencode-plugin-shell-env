# AGENTS.md — opencode-plugin-shell-env

## Project Overview

OpenCode plugin that loads `.opencode/.env` variables into `process.env` (for downstream plugins)
and into the `shell.env` hook (for shell commands and MCP server processes).

- **Package:** `@techdivision/opencode-plugin-shell-env`
- **Runtime:** Bun (peer dependency)
- **Language:** TypeScript (ESNext, strict mode, no build step — loaded directly as `.ts`)
- **Plugin API:** `@opencode-ai/plugin` (OpenCode plugin SDK)
- **Entry point:** `src/shell-env.ts`

## Build & Check Commands

```bash
# Type-check (no emit — Bun loads .ts directly, no compilation)
npx tsc --noEmit

# Install dependencies
npm install
```

There is no build step, no linter configured, and no test framework set up yet.
The TypeScript source is loaded directly by the Bun runtime at plugin load time.

### If Adding Tests

Use Bun's built-in test runner (`bun test`). Place test files as `src/*.test.ts` or `tests/*.test.ts`.
Run a single test file: `bun test src/shell-env.test.ts`

## Repository Structure

```
opencode-plugin-shell-env/
├── src/
│   └── shell-env.ts          # Plugin source (single file)
├── skills/
│   └── shell-env-usage/
│       └── SKILL.md           # Skill doc for OpenCode agents
├── package.json               # NPM package with opencode.plugin: true
├── plugin.json                # Plugin metadata (name, category, version)
├── tsconfig.json              # TypeScript config (strict, ESNext, noEmit)
├── README.md
├── CHANGELOG.md
└── .gitignore                 # Ignores .opencode/, node_modules/, etc.
```

### Directory Conventions

- `src/` — TypeScript source code. Do NOT put source in `plugins/` (conflicts with the opencode-link symlinker).
- `skills/` — OpenCode skill documents (SKILL.md with YAML frontmatter). Linked into `.opencode/skills/` by the plugin system.
- `.opencode/` — Local workspace (gitignored). Never commit.

## Code Style

### TypeScript Configuration

- **Target:** ESNext
- **Module:** ESNext with bundler resolution
- **Strict mode:** enabled (`"strict": true`)
- **No emit:** TypeScript is used for type-checking only; Bun loads `.ts` directly
- **Types:** `["bun-types", "node"]`

### Imports

```typescript
// Type-only imports use the `type` keyword
import type { Plugin } from "@opencode-ai/plugin"

// Node.js built-ins: use bare specifiers
import fs from "fs"
import path from "path"
```

- Use `import type` for types that are not needed at runtime.
- Node.js built-ins (`fs`, `path`, `os`, etc.) are imported as default imports.
- No file extensions on imports (bundler resolution).
- No barrel files — this is a single-file plugin.

### Formatting

- 2-space indentation
- No semicolons
- Double quotes for strings
- Trailing commas in multi-line structures
- Blank line between function declarations
- Blank line between logical sections within functions

### Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Functions | camelCase | `parseDotenv`, `loadEnvFile` |
| Variables | camelCase | `projectDir`, `envPath` |
| Constants | UPPER_SNAKE_CASE | `ENV_USER_EMAIL` |
| Types/Interfaces | PascalCase | `Plugin`, `Record<string, string>` |
| Exported plugin | PascalCase | `ShellEnvPlugin` |

### Functions

- Small, focused functions with a single responsibility.
- JSDoc comments on all exported and module-level functions.
- Use `Record<string, string>` for key-value maps (not `Map` or custom types).
- Prefer `for...of` loops over `.forEach()`.
- Use early returns to reduce nesting.

### Error Handling

- **Silent failures:** This plugin silently ignores errors (missing files, read errors, parse errors).
  This is intentional — the plugin must never crash or block OpenCode startup.
- Use empty `catch {}` blocks (no error variable needed).
- Return empty objects/records on failure, not `null` or `undefined`.
- Never overwrite existing environment variables (`if (!(key in target))`).

```typescript
// Correct pattern for this plugin
try {
  const content = fs.readFileSync(envPath, "utf-8")
  return parseDotenv(content)
} catch {
  return {}
}
```

### Plugin Architecture

The plugin has two phases, both in a single file:

1. **Init phase** (runs once at plugin load): Reads `.env` → sets `process.env`
2. **Hook phase** (runs on every shell invocation): Reads `.env` → sets `output.env`

```typescript
export const ShellEnvPlugin: Plugin = async (input) => {
  // Phase 1: Init-time injection into process.env
  const parsed = loadEnvFile(input.directory)
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }

  return {
    // Phase 2: Shell-time injection via hook
    "shell.env": async (_input, output) => {
      const envVars = loadEnvFile(input.directory)
      for (const [key, value] of Object.entries(envVars)) {
        if (!(key in output.env)) {
          output.env[key] = value
        }
      }
    },
  }
}
```

### Key Design Rules

1. **Never overwrite** existing env vars — OS-level exports always take precedence.
2. **Never throw** — all errors are silently caught and ignored.
3. **No external dependencies** beyond `@opencode-ai/plugin` and Node.js built-ins.
4. **Re-read `.env` on every shell invocation** — picks up changes without restart.
5. **Read `.env` once at init** — populates `process.env` for downstream plugins.
6. **Source lives in `src/`**, not `plugins/` — avoids conflicts with the opencode-link symlinker.

### Skill Documents

Skills use YAML frontmatter with this structure:

```yaml
---
name: skill-name
description: This skill should be used when the user asks to "trigger phrase"...
version: 1.0.0
last_updated: 2026-03-01
compatibility: opencode
metadata:
  audience: developers
  category: shell-env
  deprecated: false
---
```

The `description` field contains trigger phrases that OpenCode uses for skill matching.

## Version Management

- Version tracked in both `package.json` and `plugin.json` — keep them in sync.
- Follow semantic versioning. Update `CHANGELOG.md` with each release.
- The `"opencode": { "plugin": true, "category": "optional" }` field in `package.json`
  marks this as an OpenCode plugin that must be explicitly linked.
