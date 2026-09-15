# Amaran Light CLI

A command line tool for controlling Aputure Amaran lights via WebSocket connection to the Amaran Desktop application, or directly over Bluetooth Mesh using the included local BLE daemon. The legacy HTTP daemon from [wesbos/amaran-BLE-control](https://github.com/wesbos/amaran-BLE-control) is also supported. Not an official Amaran command line tool.

Also has a circadian lighting command called `auto-cct` that will set the CCT & intensity according to the time of day it is currently at your location, and a service that will run the command every minute to automate it.

Written with AI mostly, including this documentation.  Thanks to [Zac for his core websocket gist that enabled this](https://gist.github.com/zsprackett/29334b9be1e2bd90c1737bd0ba0eaf5c).

See [DEVELOPMENT](docs/DEVELOPMENT.md) on how to help with development.  See [KNOWN BUGS](docs/KNOWN_BUGS.md) for known issues.

It's not as obvious, but this repo is published on npm too: https://www.npmjs.com/package/amaran-light-cli 

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

- Default direct BLE backend: macOS with Bluetooth permission for Node and a private mesh configuration imported from the previous BLE project. The included daemon listens on `http://127.0.0.1:2708`; Amaran Desktop is not required at runtime.
- Explicit Desktop backend: Aputure Amaran Desktop must be running with its WebSocket server accessible (default: `ws://localhost:60124`). Select it with `--backend desktop`; `websocket` remains a compatibility alias.

## Library Usage

This package can also be imported from Node.js ESM projects. The root export exposes the device controller and common helpers:

```ts
import { LightController, discoverLocalWebSocket } from 'amaran-light-cli';

const discovered = await discoverLocalWebSocket();
const controller = new LightController(discovered?.url ?? 'ws://localhost:60124');

controller.getDeviceList((success, message, devices) => {
  if (!success) throw new Error(message);
  console.log(devices);
});
```

Device-control APIs are also available from a focused submodule:

```ts
import { LightController, type Device } from 'amaran-light-cli/device-control';
```

Circadian rhythm, sun simulation, weather, and scheduling utilities live in their own submodule:

```ts
import { calculateCCT, CurveType, ScheduleMaker, textSchedule } from 'amaran-light-cli/circadian';

const current = calculateCCT(40.7128, -74.006, new Date(), undefined, CurveType.CIE_DAYLIGHT);

const maker = new ScheduleMaker();
const schedule = await maker.makeSchedule({ lat: '40.7128', lon: '-74.0060', curves: 'hann,cie-daylight' });
console.log(textSchedule(schedule, { stripAnsi: true }));
```

Commander command registration functions are available for embedding the CLI in another program:

```ts
import { Command } from 'commander';
import { registerCommands } from 'amaran-light-cli/commands';

const program = new Command();
registerCommands(program, deps);
```

## Configuration

Configure the light control backend and other settings:

```bash
# Use the default direct BLE backend
amaran-cli config --backend ble --ble-url http://localhost:2708

# Explicitly use Amaran Desktop
amaran-cli config --backend desktop

# Set the Desktop WebSocket URL
amaran-cli config -u ws://localhost:60124

# If the BLE daemon has http.apiKey configured
amaran-cli config --ble-api-key my-secret

# Set client ID
amaran-cli config -c my-cli-client

# Enable debug mode
amaran-cli config -d

# Set default location for auto-cct (overrides geoip)
amaran-cli config --lat 40.7128 --lon -74.0060

# Show current configuration
amaran-cli config --show
```

Configuration is stored in the platform config directory used by the CLI; legacy `~/.amaran-cli.json` is still read when no new config exists.

You can also select the backend per command without changing config:

```bash
amaran-cli list --url http://localhost:2708
amaran-cli cct 5600 -i 80
amaran-cli list --backend desktop
```

When `--url` is used with `--backend`, it overrides the endpoint for that backend: an HTTP base URL for `ble`, or a WebSocket URL for `desktop`/`websocket`.

Direct BLE is the default when neither the command nor configuration selects a backend. Use `--backend desktop` for Amaran Desktop; the legacy name `--backend websocket` remains accepted. The included daemon supports power, brightness, CCT, 150c G/M and HSI, native effects/trigger requests, fan profiles, named/hex colors through HSI, relative adjustments, local groups/scenes/presets/quickshots with fan settings, and CCT/HSI/scene transitions. Manual lighting changes create a persistent 30-minute circadian override; use `ble override resume` to hand control back sooner. Hardware settings require matching authenticated readback; transient trigger events explicitly lack event confirmation, and library operations confirm local persistence instead.

Neither model has native RGB/XY or advanced HSI CCT/G/M. The BLE stack implements all eight native fan modes, including explicit manual RPM control, for individual fixtures, groups and all lights. Every mode requires advertised device support: the tested 150c and 200x S fixtures currently advertise only Smart and Medium. Mode changes are verified by readback; zero reported RPM is not treated as a fault. Active thermal protection blocks changes without restarting the fixture, and stopped-cooling requests require LEDs off or at zero brightness.

Optional native mesh groups use verified subscriptions after private Device Key import. Desktop effect presets, quickshots, and workspaces can be previewed and imported without applying lighting. Bounded timelines, local audio-driven brightness and image/camera HSI picking run as cancellable daemon jobs and restore initial settings by default. Provisioning discovery and key-refresh inspection are read-only; full joining/re-keying is not implemented. OTA/firmware updates are intentionally excluded, and unverified dimming-curve writes remain unavailable.

### Direct Bluetooth setup

```bash
npm ci
npm run build

# One-time import; mesh keys remain in the private platform config directory.
node dist/cli.js ble import ../amaran-BLE-control/lights.json

# Quit Amaran Desktop and pause other lighting automation before initial testing.
node dist/cli.js ble serve

# Alternatively, install a persistent macOS user service.
node dist/cli.js ble service install
node dist/cli.js ble service status

node dist/cli.js status
node dist/cli.js cct 3200 desk -i 5
node dist/cli.js hsi 240 100 5 back
node dist/cli.js ble gm back 20
node dist/cli.js ble health
node dist/cli.js ble dashboard --open
node dist/cli.js ble import-desktop "/path/to/amaran.db"
node dist/cli.js intensity 5 all
node dist/cli.js ble batch brightness --args '{"value":5}' --broadcast
node dist/cli.js scene save Evening
node dist/cli.js scene show Evening
node dist/cli.js fan info all
node dist/cli.js off
```

The daemon also serves a local control dashboard at `http://127.0.0.1:2708/dashboard`. It uses the same verified
BLE API as the CLI for fixtures, groups, power, CCT/G/M, HSI, effects, fans, saved states, transitions, circadian
overrides, timelines, local media paths, browser camera/microphone sampling, Desktop-library import and mesh
diagnostics. It is loopback-only, loads no remote code, and does not expose mesh credentials. The dashboard exposes
the fixtures' full 0-100% brightness range without an artificial output cap. Fixture cards show estimated lux from
the configured Kelvin-dependent `maxLux` calibration, scaled by verified brightness, and provide a linked lux-target
slider that converts the requested output back to the nearest supported brightness. Optional
`maxLuxByModel` entries for `200x`, `200x-s`, and `150c` override the shared curve per fixture model. Dashboard
fixture sliders keep native CCT limits for bi-color lights, while the 150c spans 1000-20000K and labels values
outside its native 2500-7500K range as simulated before applying the corresponding camera-calibrated HSI color.
Simulated-CCT lux estimates require calibration points for those Kelvin values in the 150c model curve. Dashboard
preferences and the last timestamped observed status are stored beside the private BLE configuration as
`dashboard-settings.json` and `dashboard-status.json`. A circadian panel shows whether the LaunchAgent is loaded and
recently updating, its latest requested target, current verified fixture output, active curve, weather adjustment
state, and a hover/touch daily graph of Kelvin, intensity, and estimated lux. The graph uses the same configured
CCT/intensity bounds as `auto-cct`, while keeping the intensity axis fixed at 0–100% and marking the configured
maximum with a dotted limit line. The natural intensity curve continues above that line; tooltips show both the
uncapped schedule and the value the service will actually apply. A separate **Actual sunlight lux (modeled)** curve
continues beyond the fixtures' measured lux capacity, which is shown as its own dashed reference. The same panel can
persistently enable or disable the service and edit its curve, live-weather adjustment, interval, location, Kelvin
bounds, and intensity bounds. Saving immediately recalculates the graph; active weather shows cloud/precipitation
details and its current intensity, Kelvin, and sunlight-lux difference from clear-sky output.

Desktop import previews by default and never changes fixture output. With `--apply`, Desktop quickshots become local
quickshots, explicit workspace membership becomes local groups, and all eleven supported legacy effect types become
retargetable local presets. Effect frequency, animation speed, trigger mode, CCT/HSI variants, palettes, saturation,
brightness, and 150c G/M are converted and validated against the configured fixtures before anything is persisted.
Use `--allow-partial` only when intentionally accepting a report that contains unsupported or malformed records.

These fixtures use whole-percent brightness, 100-K CCT steps, and (150c only) G/M steps of 10. Requests are rounded and verified against the applied values. Omitting CCT brightness or tint preserves the fixture's actual setting, never an 80% brightness default or full-magenta tint. CCT/HSI commands wake the fixture, matching its native behavior; use `off` to put it back to sleep.

See [Direct BLE operation and verification](docs/DIRECT_BLE.md) for restart behavior, permissions, protocol findings, webcam checks, and limitations.

## Amaran Desktop compatibility

Desktop-only utilities are isolated under the explicit `desktop` namespace. The CLI can discover and save the
WebSocket endpoint from a running Amaran Desktop application:

```bash
# Discover and save WebSocket URL
amaran-cli desktop discover

# Discover with debug output
amaran-cli desktop discover -d

# Start a vendor firmware update through Amaran Desktop
amaran-cli desktop firmware update desk
```

Discovery uses `lsof` to find the WebSocket port and saves it for explicit Desktop-backend use. Firmware updates are
not implemented by the direct BLE daemon. The previous `firmware check` command was removed because it did not query
update availability and could incorrectly claim that firmware was current.

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
Direct BLE automation handles targets outside each fixture's native range independently. Above the maximum it clamps
to the fixture maximum. Below the minimum, color-capable fixtures simulate the blackbody color in HSI mode, while
fixtures without color control turn off. Automatically turned-off fixtures wake when the schedule returns to their
native range; lights turned off manually remain off.

#### Location Priority

1. Command-line `--lat` and `--lon` arguments (highest priority)
2. Config file defaults (set with `amaran-cli config --lat <lat> --lon <lon>`)
3. GeoIP lookup based on public IP address (fallback)

#### Bounds (optional)

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

#### Max Lux Output (Advanced)

If you have measured the maximum lux output of your lighting setup, you can provide this value to `auto-cct` to enable more accurate intensity scaling.

By default, `auto-cct` maps the daylight curve's `lightOutput` directly to intensity percentage (e.g. max curve value = 100% intensity). With Max Lux mode, it uses your specific setup's capability as the reference.

You can provide:
1. **A Single Number**: If your setup has a constant max lux.
2. **A CCT Map**: If max lux varies by color temperature (common with bi-color lights).

```bash
# Option 1: Constant Max Lux (e.g. 10000 lux)
amaran-cli auto-cct --max-lux 10000

# Option 2: CCT to Lux Map (2700K=8000lux, 5600K=10000lux)
# The system linearly interpolates for values in between.
amaran-cli auto-cct --max-lux "2700:8000, 5600:10000, 6500:9000"

# Configure permanently
amaran-cli config --max-lux "2700:8000, 5600:10000"
```

**How it works:**
1. The system determines the effective max lux for the current target CCT (interpolating if necessary).
2. It calculates intensity as: `(Target Lux / Effective Max Lux) * 100`.
3. If the target lux exceeds the capability, lights are clamped to 100%.

#### Weather Modifiers (Advanced)

You can simulate weather conditions to adjust the calculated CCT and intensity. This is useful if you want your lights to reflect the current outdoor weather (or simulate a specific mood).

- **Cloud Cover**: Reduces intensity and shifts CCT towards neutral daylight (6500K).
- **Precipitation**: Further reduces intensity and slightly cools the CCT (rain/snow).

```bash
# Simulate 50% cloud cover
amaran-cli auto-cct --cloud-cover 0.5

# Simulate overcast (100% clouds)
amaran-cli auto-cct --cloud-cover 1

# Simulate rain (reduces intensity further)
amaran-cli auto-cct --precipitation rain

# Simulate snow
amaran-cli auto-cct --precipitation snow
```

These options also work with `schedule simulate`, `schedule print`, and `schedule graph`.

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

#### Backward Compatibility

The `service` command is still available as an alias to `circadian-service`:

```bash
# These commands work the same way
amaran-cli service install
amaran-cli circadian-service install
```

#### Installation Detection

- The service automatically detects if amaran-cli is installed globally (via `npm install -g`) or running from a local development build
- Global installations run the executable directly for better performance
- Local development builds use Node.js to run the built JavaScript files

The built-in installer uses macOS launchd and automatically starts on login. Logs are stored in `~/Library/Logs/amaran-circadian-service.log`. Linux deployments can run `auto-cct` from a user systemd timer using `OnActiveSec` plus `OnUnitActiveSec`; the dashboard recognizes and controls `~/.config/systemd/user/amaran-circadian.{service,timer}` and reads `~/.config/amaran-cli/circadian.log`.

#### Alternative: Using Cron

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

#### Manual launchd Setup

For advanced users who want to create the service manually:

```bash
chmod +x scripts/create-launchd-service.sh
./scripts/create-launchd-service.sh
```

### Preview Auto-CCT Schedule

View how color temperature and intensity will change throughout the day:

```console
# Preview schedule for today at your current location
$ amaran-cli schedule print

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
Time         HANN        WM_SML      WM_MED      WM_LRG      CIE         SUN_ALT     PEREZ
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
amaran-cli schedule print --lat 40.7128 --lon -74.0060

# Preview for a specific date
amaran-cli schedule print --date 2025-12-21

# Change time interval (default: 30 minutes)
amaran-cli schedule print --interval 15

# Specify which curves to show (default: "cie-daylight")
amaran-cli schedule print --curve "hann, cie-daylight"

# Output as CSV
amaran-cli schedule print --csv

# Save output to a file (strips ANSI color codes for text files)
amaran-cli schedule print --output schedule.txt

# Combine options
amaran-cli schedule print --lat 51.5074 --lon -0.1278 --date 2025-06-21 --interval 60
```

The schedule shows CCT and intensity values from 30 minutes before sunrise to 30 minutes after sunset, with special highlighting for:

- **Sunrise** (yellow)
- **Solar Noon** (green, bold)
- **Sunset** (magenta)

This helps you visualize and plan your automated lighting schedule before implementing it.

Note: The schedule respects any configured bounds set via `amaran-cli config --cct-min/--cct-max` and `--intensity-min/--intensity-max`. If no bounds are set, it uses the default curve from `calculateCCT`.

### Generate Schedule Graph

Generate a visual graph of your auto-cct schedule over the day:

```bash
# Generate graph for today (saved as schedule-YYYY-MM-DD.png)
amaran-cli schedule graph

# Specify output filename
amaran-cli schedule graph -o my-schedule.png

# Customize graph dimensions
amaran-cli schedule graph -W 1920 -H 1080

# Graph specific curves
amaran-cli schedule graph --curve cie-daylight
amaran-cli schedule graph --curve "perez-daylight, sun-altitude"

# View all available curves on one graph
amaran-cli schedule graph --curve all

# Preview for a specific date and location
amaran-cli schedule graph --date 2025-06-21 --lat 64.1466 --lon -21.9426
```

This creates a PNG image showing the CCT and/or intensity curves, which is great for visualizing how different algorithms behave.

### Simulate Schedule

Run the current schedule in high speed (1 second per 30 minutes) to verify your settings on your physical lights:

```bash
# Simulate full day on all lights
amaran-cli schedule simulate

# Simulate on a specific device
amaran-cli schedule simulate "Key Light"

# Simulate for a specific date or location
amaran-cli schedule simulate --date 2025-06-21 --lat 40.7128 --lon -74.0060

# Adjust simulation speed (seconds per interval)
amaran-cli schedule simulate --speed 0.5
```

The simulation will automatically turn on the lights before starting and restore their state afterwards (if possible).

### Get light status

```bash
amaran-cli status "Light Name"
```

### Group Management

```bash
# List all groups
amaran-cli list-groups

# Create a new group
amaran-cli create-group "My Group"

# Delete a group
amaran-cli delete-group "My Group"

# Control a group (turn on)
amaran-cli group-control "My Group" on

# Control a group (set CCT)
amaran-cli group-control "My Group" cct 5600
```

### Quickshots

```bash
# List all quickshots
amaran-cli list-quickshots

# Save current state as a quickshot
amaran-cli save-quickshot "My Scene"

# Recall a quickshot
amaran-cli quickshot "My Scene"

# Delete a quickshot
amaran-cli delete-quickshot "My Scene"
```

### Global options

All commands support these options:

- `-b, --backend <backend>`: Select `ble` (default) or `desktop`; `websocket` is a compatibility alias
- `-u, --url <url>`: Override the backend endpoint (BLE HTTP URL or Desktop WebSocket URL)
- `-c, --client-id <id>`: Override client ID  
- `-d, --debug`: Enable debug mode

Example:

```bash
amaran-cli list -u ws://192.168.1.100:60124 -d
```

## Usage Examples

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
