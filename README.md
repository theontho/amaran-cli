# Amaran Light CLI

A command line tool for controlling Aputure Amaran lights via WebSocket connection to the Amaran Desktop application.  Not an offical Amaran command line tool.

Also has a circadian lighting command called `auto-cct` that will set the CCT & intensity according to the time of day it is currently at your location, and a service that will run the command every minute to automate it.

Written with AI mostly, including this documentation.  Thanks to [Zac for his core websocket gist that enabled this](https://gist.github.com/zsprackett/29334b9be1e2bd90c1737bd0ba0eaf5c).

## Installation

1. Clone this repository or download the files
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```
4. Optionally, install globally:
   ```bash
   npm install -g .
   ```

## Prerequisites

- Aputure Amaran Desktop application must be running
- WebSocket server should be accessible (default: ws://localhost:60124)

## Configuration

Configure the WebSocket URL and other settings:

```bash
# Set WebSocket URL
amaran-cli config -u ws://localhost:60124

# Set client ID
amaran-cli config -c my-cli-client

# Enable debug mode
amaran-cli config -d

# Set default location for auto-cct (overrides geoip)
amaran-cli config --lat 40.7128 --lon -74.0060

# Show current configuration
amaran-cli config --show
```

Configuration is stored in `~/.amaran-cli.json`.

## Discovery

The CLI can automatically discover the WebSocket endpoint from a running Amaran Desktop application:

```bash
# Discover and save WebSocket URL
amaran-cli discover

# Discover with debug output
amaran-cli discover -d
```

This command uses `lsof` to find the WebSocket port that the Amaran Desktop application is listening on, then saves it to your configuration file for future use.

## Usage

### List all available lights
```bash
amaran-cli list
# or
amaran-cli ls
```

### Control lights
```bash
# Turn light on
amaran-cli on "Light Name"
amaran-cli on node_id_123

# Turn on ALL lights
amaran-cli on

# Turn light off  
amaran-cli off "Light Name"

# Turn off ALL lights
amaran-cli off

# Toggle light on/off
amaran-cli toggle "Light Name"

# Toggle ALL lights
amaran-cli toggle
```

### Set light properties
```bash
# Set intensity (0-100%)
amaran-cli intensity 75 "Light Name"

# Set intensity for ALL lights
amaran-cli intensity 75

# Set color temperature (2000-6500K)
amaran-cli cct 5600 "Light Name"

# Set CCT for ALL lights
amaran-cli cct 5600

# Set color temperature with intensity
amaran-cli cct 3200 "Light Name" -i 80

# Set CCT with intensity for ALL lights
amaran-cli cct 3200 -i 80

# Set HSI color
amaran-cli hsi 240 100 75 "Light Name"  # Blue at full saturation, 75% intensity

# Set HSI for ALL lights
amaran-cli hsi 240 100 75

# Set color by name or hex
amaran-cli color red "Light Name"
amaran-cli color "#ff0000" "Light Name"
amaran-cli color blue "Light Name" -i 50

# Set color for ALL lights
amaran-cli color red
amaran-cli color "#ff0000"
amaran-cli color blue -i 50
```

**Note:** For all commands that support device names, you can omit the device name or use `all` to apply the command to all lights. Commands are throttled with 250ms delay between each device to prevent overwhelming the server.

### Auto CCT (Circadian Lighting)
```bash
# Set CCT for all lights based on current time and location (auto-detected via geoip)
amaran-cli auto-cct

# Override IP address for geolocation lookup
amaran-cli auto-cct --ip 8.8.8.8

# Manual latitude and longitude
amaran-cli auto-cct --lat 40.7128 --lon -74.0060

# Manual time (ISO 8601 format)
amaran-cli auto-cct --time 2025-10-26T14:30:00

# Combine manual location and time
amaran-cli auto-cct --lat 40.7128 --lon -74.0060 --time 2025-10-26T06:00:00

# Use with debug mode to see calculated values
amaran-cli auto-cct -d
```

The `auto-cct` command automatically adjusts color temperature based on sunrise/sunset times for your location. By default, it maps the circadian curve to:
- **Before sunrise / After sunset**: 2000K at 5% intensity (warm, dim night lighting)
- **Solar noon**: 6500K at 100% intensity (cool, bright daylight)
- **Between sunrise and sunset**: Smooth bell curve transition from 2000K/5% → 6500K/100% → 2000K/5%

This mimics natural daylight changes throughout the day for more comfortable, circadian-friendly lighting. Both color temperature and brightness follow the same curve, providing natural dimming at dawn/dusk.

**Location Priority:**
1. Command-line `--lat` and `--lon` arguments (highest priority)
2. Config file defaults (set with `amaran-cli config --lat <lat> --lon <lon>`)
3. GeoIP lookup based on public IP address (fallback)

**Bounds (optional):**
You can constrain the auto-cct curve to your preferred ranges via config:

```bash
# CCT bounds in Kelvin (defaults 2000–6500)
amaran-cli config --cct-min 2500 --cct-max 6000

# Intensity bounds in percent (defaults 5–100)
amaran-cli config --intensity-min 10 --intensity-max 80

# Show the saved configuration
amaran-cli config --show
```
If a bound is not set, the default is used. When both min and max are set, min must be <= max.

### Running Auto-CCT as a Circadian Lighting Service

You can set up auto-cct to run automatically every minute as a circadian lighting background service. The service works with both global and local installations:

```bash
# For global installation (recommended for production use)
npm install -g .

# Install and start the circadian lighting service (runs every 60 seconds by default)
amaran-cli circadian-service install

# Install with custom interval (minimum 10 seconds)
amaran-cli circadian-service install --interval 120

# Check service status
amaran-cli circadian-service status

# View logs
amaran-cli circadian-service logs

# Follow logs in real-time
amaran-cli circadian-service logs -f

# View error logs
amaran-cli circadian-service logs -e

# Stop the service temporarily
amaran-cli circadian-service stop

# Start the service
amaran-cli circadian-service start

# Uninstall the service completely
amaran-cli circadian-service uninstall
```

**Backward Compatibility:**
The `service` command is still available as an alias to `circadian-service`:
```bash
# These commands work the same way
amaran-cli service install
amaran-cli circadian-service install
```

**Installation Detection:**
- The service automatically detects if amaran-cli is installed globally (via `npm install -g`) or running from a local development build
- Global installations run the executable directly for better performance
- Local development builds use Node.js to run the built JavaScript files

The service uses macOS launchd and will automatically start on login. Logs are stored in `~/Library/Logs/amaran-circadian-service.log`.

**Alternative: Using Cron**

If you prefer using cron instead of launchd, the included script handles both global and local installations:

```bash
# Make the script executable
chmod +x scripts/run-auto-cct.sh

# Add to crontab (runs every minute)
crontab -e
# Add this line:
# * * * * * /absolute/path/to/amaran-cli/scripts/run-auto-cct.sh

# View logs
tail -f ~/.amaran-circadian-service.log
```

**Manual launchd Setup:**

For advanced users who want to create the service manually:

```bash
chmod +x scripts/create-launchd-service.sh
./scripts/create-launchd-service.sh
```

### Preview Auto-CCT Schedule

View how color temperature and intensity will change throughout the day:

```console
# Preview schedule for today at your current location
$ amaran-cli schedule

═══════════════════════════════════════════════════════════
               Auto-CCT Schedule Preview
═══════════════════════════════════════════════════════════

Location: 37.7852°, -122.3874° (manual San Francisco, CA)
Date: Monday, October 27, 2025
Interval: Every 30 minutes

Sunrise:     07:31 AM
Solar Noon:  12:54 PM
Sunset:      06:17 PM

───────────────────────────────────────────────────────────
Time           CCT         Intensity
───────────────────────────────────────────────────────────
07:01 AM       2000K       5%
07:31 AM 🌅    2000K       5%
08:01 AM       2095K       7%
08:31 AM       2372K       13%
09:01 AM       2807K       22%
09:31 AM       3363K       34%
10:01 AM       3995K       47%
10:31 AM       4648K       61%
11:01 AM       5268K       74%
11:31 AM       5801K       85%
12:01 PM       6204K       94%
12:31 PM       6442K       99%
01:01 PM 🌞    6495K       100%
01:31 PM       6359K       97%
02:01 PM       6045K       90%
02:31 PM       5580K       81%
03:01 PM       5002K       68%
03:31 PM       4361K       55%
04:01 PM       3711K       41%
04:31 PM       3106K       28%
05:01 PM       2597K       18%
05:31 PM       2228K       10%
06:01 PM       2030K       6%
06:31 PM 🌇    2000K       5%
───────────────────────────────────────────────────────────

Legend: 🌅 Sunrise | 🌞 Solar Noon | 🌇 Sunset

# Preview with manual location
amaran-cli schedule --lat 40.7128 --lon -74.0060

# Preview for a specific date
amaran-cli schedule --date 2025-12-21

# Change time interval (default: 30 minutes)
amaran-cli schedule --interval 15

# Combine options
amaran-cli schedule --lat 51.5074 --lon -0.1278 --date 2025-06-21 --interval 60
```

The schedule shows CCT and intensity values from 30 minutes before sunrise to 30 minutes after sunset, with special highlighting for:
- **Sunrise** (yellow)
- **Solar Noon** (green, bold)
- **Sunset** (magenta)

This helps you visualize and plan your automated lighting schedule before implementing it.

Note: The schedule respects any configured bounds set via `amaran-cli config --cct-min/--cct-max` and `--intensity-min/--intensity-max`. If no bounds are set, it uses the default curve from `calculateCCT`.

### Get light status
```bash
amaran-cli status "Light Name"
```

### Global options
All commands support these options:
- `-u, --url <url>`: Override WebSocket URL
- `-c, --client-id <id>`: Override client ID  
- `-d, --debug`: Enable debug mode

Example:
```bash
amaran-cli list -u ws://192.168.1.100:60124 -d
```

## Examples

```bash
# Configure for remote Amaran Desktop
amaran-cli config -u ws://192.168.1.100:60124

# List all lights
amaran-cli list

# Turn on all lights
amaran-cli on

# Turn on the main key light
amaran-cli on "Key Light"

# Set all lights to 5600K at 80% intensity
amaran-cli cct 5600 -i 80

# Set key light to 5600K at 80% intensity
amaran-cli cct 5600 "Key Light" -i 80

# Set all lights to warm white at 60%
amaran-cli cct 3200 -i 60

# Set background light to blue at 40%
amaran-cli color blue "Background" -i 40

# Set all lights to 50% intensity
amaran-cli intensity 50

# Check status of key light
amaran-cli status "Key Light"

# Turn off all lights
amaran-cli off
```

## Development

```bash
# Run in development mode
npm run dev

# Build the project
npm run build

# Clean build artifacts
npm run clean
```

## Device Identification

Devices can be identified by:
- **Device name**: Case-insensitive partial matching (e.g., "key" matches "Key Light")
- **Node ID**: Exact match of the device's node_id


## License

MIT License - see the [LICENSE](LICENSE) file for details.

## Changelog

### v1.1.0
- More curves for auto-cct!
- Print all curves in one schedule table!
- Better range for start / stop times for curves
- Simulate a full day curve in seconds with one of your amaran lights!
- Autostarts the desktop app if it's closed
- More special times printed in the schedule, like Nautical Dawn!
Tests, refactoring ,etc

### v1.0.3
- Initial stable release with full CLI functionality
- WebSocket control for Aputure Amaran lights
- Auto-CCT circadian lighting feature
- Service automation for continuous lighting adjustment

## Credits

- Original WebSocket control implementation by S. Zachariah Sprackett
- CLI, auto-CCT, and additional features by Mahyar McDonald
- Built for use with Aputure Amaran lights and the Amaran Desktop application. This is not an official Amaran app and is not built by them. This was built as a quick hobby utility.

