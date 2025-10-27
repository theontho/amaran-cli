#!/bin/bash

# Script to create a launchd service for auto-cct
# Usage: ./scripts/create-launchd-service.sh

set -e

# Check if amaran-cli is globally installed first
if command -v amaran-cli >/dev/null 2>&1; then
    AMARAN_CLI=$(which amaran-cli)
    IS_GLOBAL=true
    echo "Found global installation: $AMARAN_CLI"
else
    # Fall back to local development build
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
    AMARAN_CLI="$PROJECT_DIR/dist/cli.js"
    IS_GLOBAL=false
    
    # Check if the CLI is built
    if [ ! -f "$AMARAN_CLI" ]; then
        echo "Error: amaran-cli not found at $AMARAN_CLI"
        echo "Please either:"
        echo "  1. Install globally: npm install -g ."
        echo "  2. Or build locally: npm run build"
        exit 1
    fi
    echo "Using local development build: $AMARAN_CLI"
fi

# Plist file path
PLIST_NAME="com.hmmfn.amaran.circadian-service"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

# Create the plist content
if [ "$IS_GLOBAL" = true ]; then
    # For global installation, use the executable directly
    cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>$AMARAN_CLI</string>
        <string>auto-cct</string>
    </array>
    <key>StartInterval</key>
    <integer>60</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/amaran-circadian-service.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/amaran-circadian-service-error.log</string>
</dict>
</plist>
EOF
else
    # For local development, use node to run the script
    cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>$AMARAN_CLI</string>
        <string>auto-cct</string>
    </array>
    <key>StartInterval</key>
    <integer>60</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/amaran-circadian-service.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/amaran-circadian-service-error.log</string>
    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>
</dict>
</plist>
EOF
fi

echo "Created launchd plist at: $PLIST_PATH"
echo "Installation type: $([ "$IS_GLOBAL" = true ] && echo "Global" || echo "Local development")"
echo "CLI path: $AMARAN_CLI"

# Load the service
launchctl load "$PLIST_PATH"
echo "Loaded launchd circadian lighting service: $PLIST_NAME"

echo ""
echo "Circadian lighting service commands:"
echo "  Start:   launchctl start $PLIST_NAME"
echo "  Stop:    launchctl stop $PLIST_NAME"
echo "  Unload:  launchctl unload $PLIST_PATH"
echo "  Status:  launchctl list | grep $PLIST_NAME"
echo ""
echo "Logs:"
echo "  Output:  tail -f $HOME/Library/Logs/amaran-circadian-service.log"
echo "  Errors:  tail -f $HOME/Library/Logs/amaran-circadian-service-error.log"

chmod +x /Users/mac/Documents/src/amaran-cli/scripts/create-launchd-service.sh