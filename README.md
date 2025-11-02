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

Location: 37.7852°, -122.3874° (geoip (136.24.146.157))
Date: Saturday, November 1, 2025
Interval: Every 30 minutes
Curve: All available curves

NE Night End        : 06:07 AM   GH Golden Hour      : 05:35 PM
DN Nautical Dawn    : 06:38 AM   SB Sunset Start     : 06:09 PM
DA Dawn             : 07:09 AM   SS Sunset           : 06:12 PM
SR Sunrise          : 07:36 AM   ND Nautical Dusk    : 07:10 PM
SE Sunrise End      : 07:39 AM   DU Dusk             : 06:39 PM
GE Golden Hour End  : 08:13 AM   NI Night            : 07:41 PM
SN Solar Noon       : 12:54 PM   NA Nadir            : 12:54 AM


─────────────────────────────────────────────────────────────────────────────────────────────────
Time         HANN        WM_SMALL    WM_MEDIUM   WM_LARGE    CIE         SUN_ALT     PEREZ       
─────────────────────────────────────────────────────────────────────────────────────────────────
05:37 AM     1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%    
06:07 AM NE  1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%    
06:37 AM     1751K/6%    2326K/21%   2785K/32%   3780K/57%   1700K/5%    1700K/5%    1700K/5%    
06:38 AM DN  1753K/6%    2339K/21%   2807K/33%   3817K/58%   1700K/5%    1700K/5%    1700K/5%    
07:07 AM     1900K/10%   2935K/36%   3780K/57%   5182K/92%   1700K/5%    1700K/5%    1700K/5%    
07:09 AM DA  1911K/10%   2967K/37%   3829K/58%   5227K/93%   3225K/5%    2867K/5%    3031K/5%    
07:36 AM SR  2130K/16%   3488K/50%   4573K/77%   5500K/100%  3865K/7%    3521K/9%    3793K/6%    
07:37 AM     2141K/16%   3510K/50%   4602K/78%   5500K/100%  3906K/7%    3550K/9%    3859K/6%    
07:39 AM SE  2156K/16%   3540K/51%   4640K/79%   5500K/100%  3963K/8%    3589K/10%   3952K/6%    
08:07 AM     2459K/24%   4036K/63%   5182K/92%   5500K/100%  3785K/9%    3796K/17%   3883K/13%   
08:13 AM GE  2528K/26%   4130K/66%   5261K/94%   5500K/100%  3750K/9%    3836K/19%   3879K/15%   
08:37 AM     2839K/34%   4498K/75%   5471K/99%   5500K/100%  3641K/9%    3999K/25%   3911K/21%   
09:07 AM     3259K/44%   4883K/85%   5500K/100%  5500K/100%  3631K/33%   4193K/35%   4174K/26%   
09:37 AM     3697K/55%   5182K/92%   5500K/100%  5500K/100%  3874K/66%   4375K/44%   4605K/46%   
10:07 AM     4130K/66%   5385K/97%   5500K/100%  5500K/100%  4097K/87%   4543K/52%   4986K/79%   
10:37 AM     4535K/76%   5487K/100%  5500K/100%  5500K/100%  4296K/97%   4692K/60%   4664K/97%   
11:07 AM     4890K/85%   5500K/100%  5500K/100%  5500K/100%  4465K/100%  4793K/100%  4765K/100%  
11:37 AM     5176K/92%   5500K/100%  5500K/100%  5500K/100%  4599K/100%  4860K/100%  4845K/100%  
12:07 PM     5378K/97%   5500K/100%  5500K/100%  5500K/100%  4693K/100%  4906K/100%  4902K/100%  
12:37 PM     5484K/100%  5500K/100%  5500K/100%  5500K/100%  4741K/100%  4931K/100%  4931K/100%  
12:54 PM SN  5500K/100%  5500K/100%  5500K/100%  5500K/100%  4748K/100%  4934K/100%  4935K/100%  
01:07 PM     5490K/100%  5500K/100%  5500K/100%  5500K/100%  4742K/100%  4931K/100%  4931K/100%  
01:37 PM     5395K/97%   5500K/100%  5500K/100%  5500K/100%  4696K/100%  4908K/100%  4903K/100%  
02:07 PM     5204K/93%   5500K/100%  5500K/100%  5500K/100%  4604K/100%  4862K/100%  4848K/100%  
02:37 PM     4927K/86%   5500K/100%  5500K/100%  5500K/100%  4472K/100%  4796K/100%  4769K/100%  
03:07 PM     4579K/77%   5493K/100%  5500K/100%  5500K/100%  4304K/97%   4698K/60%   4668K/97%   
03:37 PM     4179K/67%   5402K/98%   5500K/100%  5500K/100%  4106K/87%   4550K/53%   5000K/80%   
04:07 PM     3748K/56%   5210K/93%   5500K/100%  5500K/100%  3884K/67%   4383K/44%   4624K/48%   
04:37 PM     3309K/45%   4923K/86%   5500K/100%  5500K/100%  3642K/34%   4201K/35%   4191K/26%   
05:07 PM     2886K/35%   4547K/76%   5485K/100%  5500K/100%  3637K/9%    4008K/25%   3917K/21%   
05:35 PM GH  2528K/26%   4130K/66%   5261K/94%   5500K/100%  3763K/9%    3820K/18%   3881K/14%   
05:37 PM     2501K/25%   4093K/65%   5231K/93%   5500K/100%  3777K/9%    3805K/17%   3882K/14%   
06:07 PM     2174K/17%   3574K/52%   4683K/80%   5500K/100%  3950K/8%    3580K/10%   3930K/6%    
06:09 PM SB  2156K/16%   3540K/51%   4640K/79%   5500K/100%  3886K/7%    3536K/9%    3826K/6%    
06:12 PM SS  2130K/16%   3488K/50%   4573K/77%   5500K/100%  3791K/7%    3468K/8%    3679K/6%    
06:37 PM     1924K/11%   3004K/38%   3886K/60%   5276K/94%   3223K/5%    2859K/5%    3031K/5%    
06:39 PM DU  1911K/10%   2967K/37%   3829K/58%   5227K/93%   1700K/5%    1700K/5%    1700K/5%    
07:07 PM     1763K/7%    2398K/22%   2907K/35%   3989K/62%   1700K/5%    1700K/5%    1700K/5%    
07:10 PM ND  1753K/6%    2339K/21%   2807K/33%   3817K/58%   1700K/5%    1700K/5%    1700K/5%    
07:37 PM     1701K/5%    1773K/7%    1828K/8%    1955K/11%   1700K/5%    1700K/5%    1700K/5%    
07:41 PM NI  1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%    
08:07 PM     1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%    1700K/5%    
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

The localhost amaran desktop websocket API looks like to be near identical or identical to the Open API Sidus has published at https://tools.sidus.link/openapi/docs/usage .   So if `lightControl.ts` is missing any functionality you can probably use the OpenAPI spec to implement the new functionality fairly quickly.  This cli would probably work with the Sidus desktop apps as well, as well as Windows verisons of the Amaran desktop app but I haven't tested it.  If you want to submit PRs for it, feel free!

Extending command line tool to work with their networked Open API would probably be fairly simple to do since the local Websocket API is very similar to the Open API.  

```bash
# Run in development mode
npm run dev

# Build the project
npm run build

# Clean build artifacts
npm run clean
```