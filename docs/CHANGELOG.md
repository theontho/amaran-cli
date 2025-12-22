## [1.8.0] - 2025-12-22

- **Feature**: Added global timestamp logging for service runs to improve traceability.
- **Refactor**: Centralized curve data and metadata for better consistency across the CLI.
- **Breaking Change**: Removed `intensityMultiplier` per-light configuration (superseded by `maxLux` mapping).
- **Cleanup**: General codebase refactoring and type safety improvements.

## [1.7.0] - 2025-12-21

- **Feature**: Added Weather Modifiers (`--cloud-cover`, `--precipitation`) to `auto-cct` and schedule commands for realistic simulation of weather conditions.
- **Feature**: Enhanced Max Lux Mapping to support CCT-dependent values and interpolation (e.g., `--max-lux "2700:8000, 5600:10000"`).
- **Doc**: Comprehensive README updates including new weather and advanced max lux features.

## [1.6.0] - 2025-12-21

- **Feature**: Implemented Group Management commands (`create-group`, `delete-group`, `list-groups`, `group-control`).
- **Feature**: Added Quickshot functionality (`quickshot`, `save-quickshot`, `delete-quickshot`, `list-quickshots`).
- **Feature**: Added `lightOutput` parameter to sunlight curves for seasonal lux variation.
- **Improvement**: Added `intensity` control to more device commands.
- **Refactor**: Major refactoring of `lightControl` module for better maintainability.
- **Refactor**: Moved `graphSchedule` logic to `daylightSimulation` directory.
- **Fix**: Resolved CLI hang issues after device commands.
- **Doc**: Updated API documentation and usage guides.

## [1.5.0] - 2025-12-21

- **Refactor**: Major architectural improvements and code reorganization.
    - Centralized daylight simulation logic into `ScheduleMaker` and `Schedule` objects.
    - Modularized CCT utilities into specialized sub-modules for better maintainability.
    - Separated rendering logic into dedicated `textSchedule` and `graphSchedule` modules.
    - Standardized device control commands using a shared execution utility.
- **Feature**: Added `-C, --curves` option to specify subsets of curves in `print-schedule` and `graph-schedule`.
- **Feature**: Added CSV export support to the `print-schedule` command.
- **Improvement**: Optimized `graph-schedule` by automatically trimming inactive periods for cleaner visualization.
- **Improvement**: Enhanced `print-schedule` table with shortened headers and better formatting for small terminals.
- **Fix**: Resolved issue where the CLI would hang after executing device control commands.
- **Fix**: Improved WebSocket connection management and closing logic.
- **Chore**: Migrated to Biome for faster linting and formatting.
- **Chore**: Integrated ESLint for better deprecation tracking in TypeScript.

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
