#!/bin/bash

# Simple script to run auto-cct via cron
# Add this to your crontab with: * * * * * /path/to/this/script

# Check if amaran-cli is globally installed first
if command -v amaran-cli >/dev/null 2>&1; then
    AMARAN_CLI=$(which amaran-cli)
    IS_GLOBAL=true
else
    # Fall back to local development build
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
    AMARAN_CLI="$PROJECT_DIR/dist/cli.js"
    IS_GLOBAL=false
fi

# Log file
LOG_FILE="$HOME/.amaran-circadian-service.log"

# Check if CLI exists
if [ ! -f "$AMARAN_CLI" ] && [ "$IS_GLOBAL" = false ]; then
    echo "$(date): Error: amaran-cli not found at $AMARAN_CLI" >> "$LOG_FILE"
    exit 1
fi

# Run auto-cct and log output
echo "$(date): Running circadian auto-cct ($([ "$IS_GLOBAL" = true ] && echo "global" || echo "local"))" >> "$LOG_FILE"

if [ "$IS_GLOBAL" = true ]; then
    # Run global installation directly
    "$AMARAN_CLI" auto-cct >> "$LOG_FILE" 2>&1
else
    # Run local development build with node
    cd "$PROJECT_DIR"
    /usr/local/bin/node "$AMARAN_CLI" auto-cct >> "$LOG_FILE" 2>&1
fi

# Keep log file under 10MB by truncating if needed
if [ -f "$LOG_FILE" ] && [ $(stat -f%z "$LOG_FILE" 2>/dev/null || echo 0) -gt 10485760 ]; then
    tail -n 1000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
    echo "$(date): Circadian lighting log file truncated" >> "$LOG_FILE"
fi