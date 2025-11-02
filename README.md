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

## Device Identification

Devices can be identified by:

- **Device name**: Case-insensitive partial matching (e.g., "key" matches "Key Light")
- **Node ID**: Exact match of the device's node_id

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

Location: 38.XXXX°, -122.XXXX° (geoip (XXX.XXX.XXX.157))
Date: Sunday, November 2, 2025
Interval: Every 30 minutes
Curve: All available curves

NE Night End        : 05:08 AM   GH Golden Hour      : 04:34 PM
DN Nautical Dawn    : 05:39 AM   SB Sunset Start     : 05:08 PM
DA Dawn             : 06:10 AM   SS Sunset           : 05:11 PM
SR Sunrise          : 06:37 AM   ND Nautical Dusk    : 06:09 PM
SE Sunrise End      : 06:40 AM   DU Dusk             : 05:38 PM
GE Golden Hour End  : 07:14 AM   NI Night            : 06:40 PM
SN Solar Noon       : 11:54 AM   NA Nadir            : 12:54 AM


─────────────────────────────────────────────────────────────────────────────────────────────────
Time         HANN        WM_SMALL    WM_MEDIUM   WM_LARGE    CIE         SUN_ALT     PEREZ
─────────────────────────────────────────────────────────────────────────────────────────────────
04:38 AM     1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%
05:08 AM NE  1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%
05:38 AM     1764K/6%    2493K/21%   3074K/32%   4333K/57%   1700K/5%    1700K/5%    1700K/5%
05:39 AM DN  1767K/6%    2509K/21%   3102K/33%   4382K/58%   1700K/5%    1700K/5%    1700K/5%
06:08 AM     1954K/10%   3264K/36%   4333K/57%   6103K/92%   1700K/5%    1700K/5%    1700K/5%
06:10 AM DA  1968K/10%   3305K/37%   4398K/58%   6163K/93%   3627K/5%    3175K/5%    3382K/5%
06:37 AM SR  2247K/16%   3966K/50%   5339K/77%   6500K/100%  4435K/7%    4001K/9%    4345K/6%
06:38 AM     2259K/16%   3991K/50%   5372K/78%   6500K/100%  4482K/7%    4033K/9%    4419K/6%
06:40 AM SE  2281K/17%   4032K/51%   5424K/79%   6500K/100%  4559K/8%    4086K/10%   4545K/6%
07:08 AM     2663K/24%   4656K/64%   6103K/92%   6500K/100%  4335K/9%    4346K/17%   4457K/13%
07:14 AM GE  2754K/26%   4781K/66%   6207K/94%   6500K/100%  4290K/9%    4398K/19%   4453K/15%
07:38 AM     3144K/34%   5240K/75%   6466K/99%   6500K/100%  4153K/9%    4602K/25%   4492K/21%
08:08 AM     3677K/44%   5727K/85%   6500K/100%  6500K/100%  4134K/33%   4846K/35%   4818K/26%
08:38 AM     4232K/55%   6103K/92%   6500K/100%  6500K/100%  4440K/66%   5075K/44%   5358K/45%
09:08 AM     4780K/66%   6358K/97%   6500K/100%  6500K/100%  4720K/87%   5285K/52%   5838K/79%
09:38 AM     5291K/76%   6485K/100%  6500K/100%  6500K/100%  4969K/97%   5472K/59%   5437K/97%
10:08 AM     5739K/85%   6500K/100%  6500K/100%  6500K/100%  5180K/100%  5600K/100%  5564K/100%
10:38 AM     6098K/92%   6500K/100%  6500K/100%  6500K/100%  5347K/100%  5684K/100%  5664K/100%
11:08 AM     6351K/97%   6500K/100%  6500K/100%  6500K/100%  5463K/100%  5742K/100%  5734K/100%
11:38 AM     6482K/100%  6500K/100%  6500K/100%  6500K/100%  5522K/100%  5771K/100%  5769K/100%
11:54 AM SN  6500K/100%  6500K/100%  6500K/100%  6500K/100%  5529K/100%  5775K/100%  5774K/100%
12:08 PM     6486K/100%  6500K/100%  6500K/100%  6500K/100%  5522K/100%  5771K/100%  5769K/100%
12:38 PM     6361K/97%   6500K/100%  6500K/100%  6500K/100%  5461K/100%  5741K/100%  5733K/100%
01:08 PM     6115K/92%   6500K/100%  6500K/100%  6500K/100%  5344K/100%  5682K/100%  5663K/100%
01:38 PM     5761K/85%   6500K/100%  6500K/100%  6500K/100%  5177K/100%  5598K/100%  5562K/100%
02:08 PM     5317K/77%   6489K/100%  6500K/100%  6500K/100%  4964K/97%   5468K/59%   5434K/97%
02:38 PM     4808K/67%   6368K/97%   6500K/100%  6500K/100%  4714K/87%   5281K/52%   5830K/79%
03:08 PM     4262K/56%   6120K/93%   6500K/100%  6500K/100%  4434K/66%   5070K/43%   5347K/45%
03:38 PM     3706K/45%   5750K/85%   6500K/100%  6500K/100%  4128K/32%   4841K/34%   4809K/25%
04:08 PM     3172K/34%   5269K/76%   6474K/100%  6500K/100%  4156K/9%    4597K/25%   4489K/21%
04:34 PM GH  2754K/26%   4781K/66%   6207K/94%   6500K/100%  4306K/9%    4378K/18%   4454K/14%
04:38 PM     2687K/25%   4690K/64%   6132K/93%   6500K/100%  4340K/9%    4340K/17%   4458K/13%
05:08 PM SB  2281K/17%   4032K/51%   5424K/79%   6500K/100%  4461K/7%    4019K/9%    4385K/6%
05:11 PM SS  2247K/16%   3966K/50%   5339K/77%   6500K/100%  4341K/7%    3933K/8%    4199K/6%
05:38 PM DU  1968K/10%   3305K/37%   4398K/58%   6163K/93%   1700K/5%    1700K/5%    1700K/5%
06:08 PM     1772K/6%    2535K/22%   3145K/34%   4457K/60%   1700K/5%    1700K/5%    1700K/5%
06:09 PM ND  1767K/6%    2509K/21%   3102K/33%   4382K/58%   1700K/5%    1700K/5%    1700K/5%
06:38 PM     1700K/5%    1743K/6%    1775K/7%    1849K/8%    1700K/5%    1700K/5%    1700K/5%
06:40 PM NI  1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%
07:08 PM     1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%
─────────────────────────────────────────────────────────────────────────────────────────────────

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

The localhost amaran desktop websocket API looks like to be near identical or identical to the Open API Sidus has published at <https://tools.sidus.link/openapi/docs/usage> .   So if `lightControl.ts` is missing any functionality you can probably use the OpenAPI spec to implement the new functionality fairly quickly.  This cli would probably work with the Sidus desktop apps as well, as well as Windows verisons of the Amaran desktop app but I haven't tested it.  If you want to submit PRs for it, feel free!

Extending command line tool to work with their networked Open API would probably be fairly simple to do since the local Websocket API is very similar to the Open API.  

```bash
# Run in development mode
npm run dev

# Build the project
npm run build

# Clean build artifacts
npm run clean
```
