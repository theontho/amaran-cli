# Repository Notes

## Commands

- Install dependencies with `npm ci`.
- Run formatting and lint checks with `npm run check`.
- Run deprecation linting with `npm run lint:deprecations`.
- Type-check with `npm run typecheck`.
- Build with `npm run build`.
- Run tests with `npm test`.
- Run the full local gate with `npm run verify`.

## CLI Config

- Runtime config is stored at the platform config path returned by `src/config.ts`.
- Set `AMARAN_CLI_CONFIG_DIR` for tests or isolated manual runs.
- The legacy `~/.amaran-cli.json` file is still read when no new config file exists, but writes go to the platform config path.

## Development Notes

- Keep CLI behavior testable without touching real user config.
- Prefer small, focused changes and preserve the existing Commander command structure.
- Do not remove legacy config support unless a migration plan is explicitly requested.
