# Changelog

## 1.2.0

- **BREAKING:** Switch from "never overwrite" to "last wins" merge strategy
  - `.env` values now override existing OS environment variables
  - This matches the opencode-cli convention (local overrides user)
- Add multi-location `.env` loading with cascading merge:
  1. `~/.config/opencode/.env` — global defaults (user email, shared API keys)
  2. `<projectDir>/.opencode/.env` — project-specific overrides (wins)
- Refactor `loadEnvFile()` → `loadEnvFromPath()` + `loadMergedEnv()` + `getGlobalConfigDir()`
- Update AGENTS.md, README.md, and skill document with new behavior

## 1.1.1

- Fix skills directory structure for plugin linker compatibility
  - The linker expects `skills/<group>/<skill-name>/` but the skill was at `skills/<skill-name>/` directly
  - The skill was silently never linked because the linker treated the skill directory as a group directory

## 1.1.0

- Inject `.env` variables into `process.env` at plugin init time (Phase 1)
  - Downstream plugins can now read `.env` values via `process.env.KEY`
  - Eliminates the need for each plugin to implement its own `.env` parsing
- Add `shell-env-usage` skill document
- Add `AGENTS.md` with build commands and code style guidelines
- Add GitHub Actions workflow for automated npm publishing on tag push
- Move source code from `plugins/` to `src/` to avoid opencode-link symlinker collision
- Extract `loadEnvFile()` helper function (DRY)

## 1.0.0

- Initial release
- Shell environment loader plugin for OpenCode
- Loads `.opencode/.env` variables into shell commands and MCP server processes
- Supports standard `.env` syntax (comments, quoted values, export prefix, inline comments)
- Does not overwrite existing environment variables
