# Changelog

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
