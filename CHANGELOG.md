## [1.4.0] - 2025-12-15

- **Feature**: Added `graph-schedule` command to generate visual graphs of the lighting schedule.

## [1.3.6] - 2025-12-14

- **Fix**: Updated workflow to use latest `npm` version for better OIDC support.

## [1.3.5] - 2025-12-14

- **Fix**: Re-applied `registry-url` configuration fix (previous attempt in v1.3.4 failed to update workflow).

## [1.3.4] - 2025-12-14

- **Fix**: Restored `registry-url` configuration (required for OIDC `ENEEDAUTH` fix).

## [1.3.3] - 2025-12-14

- **Fix**: Removed conflicting `registry-url` configuration to enable OIDC authentication.

## [1.3.2] - 2025-12-14

- **Fix**: Updated release workflow to use NPM Trusted Publishing (OIDC) instead of auth tokens.

## [1.3.1] - 2025-12-14

- **Fix**: Resolved timezone issue in integration tests causing CI failures.

## [1.3.0] - 2025-12-14

- **Breaking**: Migrated project to ESM (`type: module`).
- **Breaking**: Migrated testing framework from Jest to Vitest.
- **Feature**: Added `intensityMultiplier` support to `auto-cct`.
- **Feature**: `auto-cct` command now accepts a device argument (defaults to 'all').
- **Refactor**: Renamed `schedule` command to `print-schedule`.
- **Fix**: Resolved `suncalc` import issues.
- **Fix**: Improved CLI output styling for light mode terminals.
- **Chore**: Comprehensive linting and formatting fixes.

## [1.1.4] - 2025-11-02

- test token config

## [1.1.3] - 2025-11-02

- curve config and refactors

## [1.1.2] - 2025-11-01

- Enhanced CLI help output and documentation

## [1.1.0] - 2025-10-31

- Added more curves for auto-cct
- Improved schedule table display with all curves
- Better range for start/stop times for curves
- Added simulation of full day curve in seconds
- Added auto-start for the desktop app if closed
- Added more special times in schedule (e.g., Nautical Dawn)
- Various tests and refactoring

## [1.0.3] - 2025-10-30

- Initial stable release with full CLI functionality
- WebSocket control for Aputure Amaran lights
- Auto-CCT circadian lighting feature
- Service automation for continuous lighting adjustment
