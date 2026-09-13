# Direct Bluetooth control

The included macOS BLE Mesh daemon controls already-provisioned amaran 200x / 200x S and 150c lights without the desktop application or its Python SDK. It continues the protocol investigation in `wesbos/amaran-BLE-control`, but replaces random sequence numbers, unverified writes, and fixed capability assumptions with an independently tested implementation.

## Supported controls

| Fixture | CCT range | Dimming | Color | State |
| --- | --- | --- | --- | --- |
| 200x / 200x S | 2700-6500 K, 100-K steps | 0-100%, 1% steps | CCT only | Power, brightness, mode, CCT |
| 150c | 2500-7500 K, 100-K steps | 0-100%, 1% steps | CCT G/M (-100 to +100, steps of 10), basic HSI | Power, brightness, mode, CCT/G/M or HSI |

On, off and toggle are supported for each fixture or all configured lights. Zero brightness is not sleep: the fixture can report awake with its LEDs dark. CCT and HSI wake the fixture. Requests are rounded to the fixture resolution before transmission and verified against those applied values. A CCT request without brightness first reads and preserves actual brightness.

Additional controls include relative brightness/CCT, named or hex colors converted to HSI, native effects and trigger requests, fan profiles, batched control, CCT/HSI/scene transitions, persistent local groups/scenes/presets/quickshots with fan profiles, and manual overrides for circadian control.

Neither fixture advertises native RGB/XY; the 150c does not advertise advanced HSI CCT/G/M. Native mesh subscriptions, Desktop effect-preset/quickshot/workspace import, and host-driven timeline/audio/camera programs are implemented. Provisioning discovery and key-refresh phase inspection are read-only; joining/re-keying a mesh is not implemented. OTA/firmware updates are intentionally excluded. Extended CCT and unverified dimming-curve writes remain unavailable. Hardware validation uses two 200x S fixtures and one 150c; an original non-S 200x was not available.

### Tint, colors and relative adjustments

```sh
amaran-cli ble gm back 30
amaran-cli ble gm back -- -30
amaran-cli intensity --backend ble --relative -- -1 all
amaran-cli cct 100 all --relative --backend ble
amaran-cli color '#00ff00' back -i 1 --backend ble
```

G/M is signed: negative is magenta, positive green, zero neutral. Ordinary CCT updates preserve actual 150c tint. Relative adjustments read current settings and clamp to each model's range; relative CCT requires CCT mode. Color names/hex express hue and saturation; brightness remains independently controlled. No RGB mode is implied.

### Native effects

The 200x S exposes paparazzi, fireworks, faulty-bulb, lightning, TV, pulsing, strobe, explosion and fire. The 150c exposes paparazzi, fireworks, faulty-bulb, lightning, TV, pulsing, fire, cop-car and party-lights. The 150c's pulsing and faulty-bulb also support HSI variants.

```sh
amaran-cli effect list --backend ble
amaran-cli effect custom desk pulsing --backend ble \
  --params '{"brightness":1,"frequency":1,"kelvin":3200}'
amaran-cli effect custom back pulsing --backend ble \
  --params '{"brightness":1,"frequency":1,"hue":120,"saturation":100}'
amaran-cli effect animation-speed back 4 --backend ble
amaran-cli effect stop all --backend ble
```

`frequency` is 1-10. The separate native animation-speed field is 0-10 and is encoded only by Lightning,
Faulty Bulb and Pulsing; the command requires matching readback and rejects other effects. `effect speed` retains its
legacy meaning and changes frequency. CCT-capable effects accept `kelvin` and 150c `gm`; HSI variants instead accept
`hue` and `saturation`. TV/fire/fireworks/cop-car use native `palette` indices (0-2), not Kelvin. Party-lights accepts
saturation. Parameters that do not apply to an effect are rejected, not ignored. The legacy `effect intensity`
command uses 0-1000 API units, whereas `--params` brightness and `effect set -i` use percent.

Starting an effect saves its preceding steady state persistently. `effect stop` restores that CCT/HSI setting, brightness and power, including after daemon restart. An effect started by another controller without saved history needs an explicit CCT/HSI setting to stop. Avoid strobe and other rapid flashing around photosensitive people; hardware diagnostics deliberately exclude rapid flashing.

`effect stop GROUP` now restores each member independently after validating the complete group. `effect trigger DEVICE` (alias `retrigger`) sends one manual trigger request for an awake lightning, faulty-bulb, pulsing, strobe or explosion effect; groups and `all` are supported. Trigger requests are not retried or repaired, to avoid firing twice after a lost acknowledgement. The response verifies persistent effect settings but explicitly returns `triggerRequest.eventConfirmed:false`: the firmware does not provide a distinct acknowledgement that a transient event fired. This is not an optical trigger guarantee.

### Cooling safety

```sh
amaran-cli fan info all --backend ble
amaran-cli fan mode desk smart --backend ble
amaran-cli fan mode front medium --backend ble
amaran-cli fan mode back medium --backend ble
amaran-cli fan mode all smart --backend ble
amaran-cli fan mode Work medium --backend ble
amaran-cli fan info --backend ble --json
```

All eight native fan modes are implemented. Names are case-insensitive, and numeric codes also work:

| Mode | Code | Additional input |
| --- | --- | --- |
| Manual | 0 | Required `--rpm` |
| Smart | 1 | None |
| Max | 2 | None |
| Off | 3 | LEDs must already be off or at zero brightness |
| High | 4 | None |
| Medium | 5 | None |
| Low | 6 | None |
| Silent | 7 | None |

Every selection still requires the fixture's actual advertised support. Both tested 200x S fixtures and the 150c advertise **Smart and Medium only**. Other modes are implemented in the protocol/API/CLI, not forced onto those fixtures.

On a fixture advertising manual control, use `fan mode DEVICE manual --rpm 2200 --backend ble`, or the equivalent `fan speed DEVICE 2200 --backend ble`. Manual mode never silently defaults to zero RPM. The integer range 0-65535 comes from the SDK's 16-bit wire field, not a manufacturer-rated speed range; a fixture may reject or clamp requests. Manual commands require matching mode and reported RPM readback, and fail explicitly if that cannot be verified. These fixtures cannot physically validate manual control because they do not advertise it.

Off and manual zero-RPM requests check LED state both before batch delivery and immediately before changing the fan. They never turn the LEDs off on the user's behalf. Pause lighting automation before using stopped cooling, and restore an appropriate cooling profile before increasing light output.

`fan info` defaults to all physical fixtures and accepts a fixture or local group. It reports mode/name, RPM, temperature, thermal-protection flag, and `allowedModes`; `--json` returns a keyed `states` object including raw advertised support flags. RPM is observational: `rpmStatus: "zero-reported"` does **not** assert a stopped/failed fan, and a successful Medium selection does not require a positive RPM. The earlier Smart-only restriction and positive-RPM assumption have been removed.

The [manufacturer's 150c settings guide](https://help.amarancreators.com/en/amaran-150c-300c/light-configuration-settings) documents on-fixture over-temperature shutdown and lockout requiring a power cycle. It does not document a mandatory minimum RPM or exact fan-start thresholds; an equivalent shutdown sequence has not been established for the 200x S. Fan control does not invent temperature thresholds or bypass firmware protection. Any reported active thermal protection blocks profile changes, including automatic Smart recovery. The fan-control path never power-cycles or wakes the light.

Fan changes prevalidate every target, recheck immediately before each write, and verify the selected native mode afterward. Already-selected automatic profiles are no-ops. Manual RPM requests always write their explicit setpoint rather than mistaking the current RPM reading for a remembered target. Actual communication failures, mode mismatches and unverified manual RPM remain errors; a readable, non-tripped fixture can be returned to Smart if verification fails, without hiding the original failure. Cancellation may similarly restore Smart after a write. If protection is active or recovery cannot be verified, the error explicitly says so.

Groups and `all` are serialized, deduplicated and verified per fixture, not mesh-broadcast fan commands. Partial failures identify verified members and may leave some profiles changed. Fan control sends no LED power/color/brightness commands; any native firmware output limiting or thermal protection remains in the fixture. The daemon does not reset fan profiles at startup.

### All-light delivery, groups and saved lighting

```sh
amaran-cli intensity 5 all --backend ble
amaran-cli ble batch brightness --targets all --args '{"value":5}' --broadcast
amaran-cli ble fade 1 3 --targets all
amaran-cli group create Work --backend ble
amaran-cli group add Work desk --backend ble
amaran-cli group add Work front --backend ble
amaran-cli group show Work --backend ble
amaran-cli intensity 5 Work --backend ble
amaran-cli status Work --backend ble
amaran-cli scene save Evening --backend ble
amaran-cli scene save Work --targets desk,front --backend ble
amaran-cli scene show Evening --backend ble
amaran-cli scene recall Evening --backend ble
amaran-cli preset save back Portrait --backend ble
amaran-cli preset show Portrait --backend ble
amaran-cli preset recall back Portrait --backend ble
amaran-cli preset recall back Portrait --fade 2 --backend ble
amaran-cli quickshot save Workday --backend ble
amaran-cli quickshot save Portrait --targets back --backend ble
amaran-cli quickshot show Workday --backend ble
amaran-cli quickshot set Workday --backend ble
amaran-cli quickshot set Workday --fade 2 --backend ble
```

Normal bulk commands prevalidate and read all targets before sending a burst of unicast packets, then verify every member. Explicit broadcast sends one mesh packet and verifies each member, repairing mismatches individually. It requires the complete configured target set and identical encoded settings. **Broadcast reaches every provisioned node on that mesh**, including any nodes absent from the configuration; it is not a subset-group operation. Neither method promises atomic or hard-real-time synchronization.

Groups start as local logical membership lists and can optionally be enabled as verified native subscriptions. They accept shared lighting settings; inspection uses `status GROUP` because members may differ. They are excluded from physical-light automation to avoid duplicate commands. Presets hold one fixture's state; scenes and quickshots hold a multi-fixture snapshot, including power, tint, effect parameters and native fan profiles. Manual fan setpoints cannot be inferred from measured RPM, so snapshots refuse an active Manual fan profile. Old saved entries without fan settings remain compatible. Local and imported entries share the same on-disk library, while stable Desktop source IDs keep repeat imports idempotent. Retargeting a preset validates the receiving model before changing it.

`group rename ID NAME` preserves identity/membership. `preset update ID --name NAME` and `quickshot update ID --name NAME` replace their saved states from the original fixture targets, optionally renaming them. Direct BLE is the default backend; `--backend ble` remains accepted when an explicit declaration is useful in automation.
The corresponding `show` commands print the complete persisted record, including per-fixture power, color/effect parameters, fan profile, and native group metadata, without applying it.

`ble fade` provides a host-paced brightness transition over 0.5-20 seconds, at up to two updates per second with whole-percent steps. It preserves power state, rejects active native effects, and verifies final brightness on every target. Interrupting it stops subsequent writes and may leave intermediate brightness. Saved-state recall is serialized, not atomic; failures can leave some fixtures changed.

```sh
amaran-cli ble transition cct 2 --targets all --args '{"kelvin":4500,"brightness":5}'
amaran-cli ble transition hsi 2 --targets back --args '{"hue":120,"saturation":100,"brightness":1}'
amaran-cli scene recall Evening --fade 3 --backend ble
```

CCT transitions interpolate Kelvin/tint; HSI transitions take the shortest hue arc. CCT/HSI mode changes fade through zero output and require at least one second. These are host-paced 0.5-20 second transitions at up to two updates/second, not native timed/atomic fades. Active effects must be stopped first. Final color, brightness, power and saved fan settings are verified; cancellation leaves intermediate settings. Sleeping scene entries are restored with zero emitted output before their remembered brightness is reinstated, avoiding an on/off flash.

## Manual control and testing

### Native groups and read-only mesh discovery

```sh
# Private, same-mesh credentials only; keys are never returned by the HTTP API.
amaran-cli ble mesh import-keys /path/to/amaran.db
amaran-cli ble mesh inspect
amaran-cli ble mesh discover
amaran-cli group native Work enable --backend ble
amaran-cli intensity 5 Work --backend ble
amaran-cli group native Work sync --backend ble
amaran-cli group native Work disable --backend ble
```

Device Key import verifies matching network/application keys, fixture MACs/addresses, and authenticated composition responses before persisting keys under the private mesh config directory. Mesh inspection reads actual device composition, existing application bindings, subscriptions and key-refresh phase. It does not trust Desktop's cached composition, which differed from the live 150c during verification.

Native group setup uses the already-bound primary Generic OnOff model (`0x1000`), verified to route these fixtures' native lighting commands. It allocates an unused `0xc000-0xfeff` address and never replaces other subscriptions. A persistent pending record is written before changes; interrupted operations can be resumed with `sync` or removed with `disable`. Native membership updates are verified, and deleting a native group first removes its owned subscriptions. No reset, application-key rebind or key rotation is performed.

Ready native groups use one group-addressed lighting packet when members need identical encoded settings; otherwise delivery falls back to explicit unicast and reports that choice. Pending groups do not use their native address. `ble mesh discover` lists provisioning-service advertisements only: it does not identify ownership, pair devices, or reset/re-provision existing fixtures. Full provisioning/key refresh remain separate, unimplemented operations; inspection confirms phase but does not change it.

### Desktop library import

```sh
amaran-cli ble import-desktop /path/to/amaran.db
amaran-cli ble import-desktop /path/to/amaran.db --apply
amaran-cli ble import-desktop /path/to/amaran.db --apply --replace
```

The default is a preview with errors/warnings. Import reads SQLite in read-only mode and maps fixture IDs by MAC. Desktop quickshots become local quickshots; Desktop scenes are workspaces and become local groups, not invented lighting snapshots. Desktop effect presets become retargetable local presets for Paparazzi, Lightning, TV, Fire, Strobe, Explosion, Faulty Bulb, Pulsing, Cop Car, Party Lights, and Fireworks. The importer preserves frequency, native animation speed, trigger mode, CCT- or HSI-effect variants, palettes and saturation, converts preset intensity from 0-100 to the direct API's 0-1000 units, and converts Desktop 150c tint from its stored 0-200 range to signed G/M. Each generic Desktop preset is stored against the first configured fixture that can reproduce it; `preset recall DEVICE ID` validates and retargets that state to another compatible fixture. Import never applies lighting or changes native subscriptions/fan modes.

Stable source IDs make repeat imports idempotent. Changed imports require `--replace`; unrelated local-name collisions and imported groups with native subscriptions are protected. Duplicate Desktop preset names receive stable numeric suffixes instead of being dropped. Unmapped, malformed, unsupported-effect, or fixture-incompatible records stop an apply unless `--allow-partial` explicitly permits the valid subset. Non-effect Desktop preset categories remain skipped with a warning. An implicit All group without explicit membership is reported and skipped.

### Timeline and media control

```sh
amaran-cli ble program timeline.json --targets all
amaran-cli ble audio /path/to/music.wav --targets all --seconds 30 --max 5
amaran-cli ble picker --image /path/to/image.png --targets back --seconds 10 --max 1
amaran-cli ble picker --camera 0 --targets back --region 0,0,1280,720 --seconds 10 --max 1
# Microphone capture is explicit, local, and requires macOS permission.
amaran-cli ble microphone 0 --targets all --seconds 30 --max 5
amaran-cli ble jobs list
amaran-cli ble jobs stop JOB_ID
```

Timeline JSON contains `duration` (1-1200 seconds), optional `restore`, and `steps` with `at`, `action`, and `args`. For example:

```json
{"duration":3,"steps":[{"at":0,"action":"brightness","args":{"value":1}},{"at":1,"action":"cct","args":{"kelvin":3200,"brightness":2}}]}
```

These are bounded host-driven programs, not on-fixture timelines. Cues must be ordered at least 0.5 seconds apart. Media uses local `ffmpeg`: audio RMS drives brightness with smoothing; image/camera averages drive HSI. RGB is converted to the fixture's HSI controls, not a native RGB mode. Picker targets must support HSI; media starts require awake fixtures in steady CCT/HSI mode. Media brightness defaults to the fixture's full 100% range; use `--max` when a lower level is wanted. Maximum duration is 20 minutes, and data is not uploaded. Files must be local; media subprocesses cannot fetch network URLs. Camera and microphone capture currently require macOS.

Live camera/microphone capture runs in the foreground CLI, which has the terminal's OS permissions; only validated RGB averages/RMS numbers are sent to the loopback daemon. It does not bypass or modify macOS privacy settings. Live capture cannot use `--background`; local files and timelines can. `ffmpeg` is resolved from standard installation locations or `AMARAN_FFMPEG_PATH`, so a LaunchAgent's minimal PATH does not hide Homebrew installations. Media duration starts with the first usable sample; startup has a separate 10-second deadline.

The daemon owns each job, exposes preparing/running/restoring/terminal status, and keeps only bounded history. `--background` returns its ID; otherwise the CLI waits and Ctrl-C stops it. Input frames use a latest-value slot rather than an unbounded backlog. Default completion/explicit stop restores the original lighting/fan settings and prior override expiry; `--no-restore` keeps the final state. Manual lighting commands cancel overlapping jobs without restoring over the user's new command. A new program supersedes older overlapping programs. Daemon shutdown cancels jobs and does not restart them on boot. Errors and restoration failures are reported explicitly; they are not successful completions.

### Circadian overrides

Manual lighting mutations create a **30-minute per-fixture override**, persisted across daemon restart. This also protects potentially partial/failed manual operations from being overwritten by the next automatic update. `auto-cct` uses the default BLE daemon action that checks overrides inside the same serialized queue as manual commands. It also skips sleeping fixtures, reported thermal protection, and reported stopped-cooling modes. Fan-only changes and read-only queries do not create lighting overrides.

```sh
amaran-cli ble override status --targets all
amaran-cli ble override hold --targets desk,back --minutes 60
amaran-cli ble override resume --targets all
amaran-cli ble info all
amaran-cli ble health
```

Override status reports remaining milliseconds per fixture. Resume clears the hold; the next circadian update takes over. Changes made outside this daemon are not automatically assigned a hold, so explicitly hold before using the desktop app or physical controls for comparisons.

`ble info` reads native product/firmware/protocol identifiers and reported feature bits. Version fields are raw SDK codes, not invented semantic version strings. Read-only dimming-curve queries were attempted on all three fixtures and produced no response; curve writes remain disabled. Provisioning/key rotation are not implemented, and OTA/firmware updates are intentionally excluded.
`ble health` prints daemon connectivity, protocol version, feature flags, configured fixture capabilities, and logical groups without changing hardware state.

### Local web dashboard

```sh
amaran-cli ble dashboard
amaran-cli ble dashboard --open
```

The daemon serves a responsive dashboard at `http://127.0.0.1:2708/dashboard`. It covers the verified runtime
controls exposed by the CLI: individual/all/group power and color, effects and animation speed, fan modes, logical
and native groups, scenes/presets/quickshots with transitions, circadian holds, jobs, local audio/image paths,
browser camera/microphone sampling, Desktop import and mesh diagnostics. Daemon installation and initial private
mesh import remain CLI operations because the web interface does not receive mesh credentials.

The compact live-status cards provide direct per-fixture power, full-range brightness and model-correct Kelvin
sliders. Slider values update locally while dragging and send one verified BLE write when released, avoiding a flood
of intermediate mesh commands. In CCT mode each card also shows estimated lux: the interpolated full-output
calibration at that Kelvin multiplied by verified brightness. Sleeping fixtures show 0 lx; HSI/effect states show no
CCT-based estimate.

The dashboard uses the ordinary `maxLux` number/map as its fallback calibration. Different measured curves can be
assigned by model in `config.json` under `maxLuxByModel`, whose supported keys are `200x`, `200x-s`, and `150c`.
Each value uses the same Kelvin-to-lux map shape as `maxLux`. Use the locally measured curves for the actual setup; a
model-specific entry takes precedence over the shared fallback.

The dashboard is loopback-only and same-origin: it loads no CDN resources, rejects cross-origin browser requests,
and applies a restrictive Content Security Policy. Fixture registration still comes from private `mesh.json`.
UI title, refresh interval and fixture ordering/labels are stored in
`dashboard-settings.json`; the last successful readback is written with an `updatedAt` timestamp to
`dashboard-status.json`. Both live beside the BLE state in the platform config directory. The UI distinguishes the
cached timestamp from live connectivity and refreshes verified fixture/fan readback rather than assuming that a
request succeeded.

## Setup and services

```sh
npm ci
npm run build
node dist/cli.js ble import /path/to/private/lights.json
node dist/cli.js ble serve
```

Import reads the previous project's private `lights.json`. Names must identify the supported model. The dedicated controller source defaults to `32766` (`0x7ffe`); use `--source` only when allocating a different unused unicast address. It must not overlap any fixture element or another controller. The desktop's address `1` is deliberately never reused for transmissions.

Quit Amaran Desktop before connecting. On the first background launch, macOS may separately request **Bluetooth permission for Node**, even if an interactive terminal already works. Approve it in System Settings > Privacy & Security > Bluetooth. The initialization timeout explicitly identifies this requirement; no elevated privileges or changes to the TCC database are needed.

```sh
node dist/cli.js ble service install
node dist/cli.js ble service status
node dist/cli.js ble service stop
node dist/cli.js ble service start
```

The LaunchAgent is `com.amaran-cli.ble`. It uses the current compiled CLI and Node executable, starts at user login, and restarts after crashes. Keep that CLI installation/build path available. Logs are in `~/Library/Logs/amaran-cli/`. `stop` unloads it; `start` loads it again. A Node upgrade that removes its recorded executable path requires updating the LaunchAgent.

The CLI defaults to direct BLE. Use `--backend desktop` to opt into Amaran Desktop; `--backend websocket` remains a compatibility alias. Desktop-only WebSocket discovery and vendor firmware updating are isolated under `desktop discover` and `desktop firmware update`; there is no synthetic firmware-current check. Explicit `--backend ble` is optional but may still be useful in automation:

```sh
node dist/cli.js list --backend ble
node dist/cli.js status --backend ble
node dist/cli.js cct 4500 desk -i 5 --backend ble
node dist/cli.js hsi 120 100 5 back --backend ble
node dist/cli.js auto-cct --backend ble --service-mode
```

Avoid running competing desktop or circadian commands during hardware comparisons. When moving existing automation to BLE, explicitly change its command/backend; importing mesh credentials does not rewrite other services.

## Reliability and private state

`ble/mesh.json`, `ble/sequence.json` and `ble/library.json` live underneath the platform config directory (`AMARAN_CLI_CONFIG_DIR` overrides it). The first contains secrets: do not commit or share it. Back up mesh identity and sequence together. The library uses validated, atomic private JSON writes and also preserves pre-effect steady-state history.

Sequence blocks are written and fsynced before sending. Restarts skip unused reserved values instead of reusing them. Counters never wrap. Missing sequence state, exhausted counters, identity mismatches, or conflicting controller processes fail closed. A lock left by a dead process can be recovered; a live process retains its lock. Do not delete sequence state to troubleshoot Bluetooth.

The connection only selects advertisements matching the configured mesh network. Beacons, proxy filter acknowledgements, network packets and application packets are authenticated. Proxy fragmentation is handled, notifications are subscribed before initialization, and every operation has a deadline. Commands are serialized. State is read before mutation; matching readback is required afterward. Failed writes/mismatches have bounded retries and reconnection. Toggle retries resend the already-calculated power state, not another toggle.

Readback is fixture telemetry, not a photometer. A device can report a setting while a physical emitter is faulty; the webcam loop supplies a separate physical check. BLE link health is exposed as `connected`, not confused with configured device presence.

## HTTP API

The daemon binds only to `127.0.0.1:2708`, does not enable CORS, and rejects browser-origin requests. Do not expose it through a public proxy. Local processes are trusted.

```sh
curl http://127.0.0.1:2708/health
curl http://127.0.0.1:2708/lights/desk/state
curl -X POST http://127.0.0.1:2708/lights/desk/cct \
  -H 'Content-Type: application/json' \
  -d '{"kelvin":3200,"brightness":1}'
```

Light actions are `state`, `on`, `off`, `toggle`, `brightness` (`value` in percent), `cct` (`kelvin`, optional `brightness`/`gm`), `gm` (`value`), `hsi` (`hue`, `saturation`, optional `brightness`), `color`, `increment-brightness`, `increment-cct`, `effect`, `effect-speed`, `effect-intensity`, `effect-stop` and `effect-trigger`. Fan GET/POST uses `/lights/KEY/fan` with optional `mode` and manual `rpm`; a group key returns keyed `states`. `GET /fans` reads all fans. `POST /fans` accepts `{targets:"all"|["desk","group:ID"], mode?, rpm?}`; omitting both mode and RPM is read-only. RPM requires manual mode, and manual mode requires RPM. Group expansion deduplicates members, and all fan bulk results have shape `{states:{fixtureKey:FanState}}`. Feature flags `fanTargets` and `fanManualRpm` identify endpoint/manual-setpoint support separately from each fixture's capability flags.

`POST /transition` takes `{targets, action:"cct"|"hsi"|"brightness", args, seconds}`; saved-state recall accepts optional `seconds` for a scene transition. `POST /overrides` takes `{targets, minutes?}`: omit minutes to inspect, use zero to resume. `POST /lights/KEY/auto-cct` returns either verified applied state or `{skipped:true, reason}` without claiming a hardware write. `GET /lights/KEY/info` reads native product information. Group renaming uses `POST /groups/ID/rename`.

`GET /dashboard/circadian` reports the installed service state, persistent settings, recent target, effective weather mode, and a 15-minute daily schedule used by the interactive dashboard graph. Schedule points distinguish natural intensity, capped service intensity, modeled sunlight lux, and the measured system lux capacity. `POST /dashboard/circadian/settings` validates and persists service enablement, interval, curve, live weather, location, Kelvin bounds, and intensity bounds; installed LaunchAgent arguments are reloaded when required. Weather status includes the current difference from clear-sky output. `POST /programs` starts a validated asynchronous job; `GET /programs[/ID]` reports status and `DELETE /programs/ID` stops it. Acceptance is not completion. Foreground capture uses source `{kind:"samples",media:"image"|"audio"}` and `POST /programs/ID/sample` with `{rgb:[r,g,b]}` or `{rms:0..1}`; this endpoint accepts numeric samples, not image/audio uploads. `POST /desktop/import` previews/applies library metadata. `POST /mesh/keys` imports matching private Device Keys; `GET /mesh/inspect` and `/mesh/discover` are read-only. `POST /groups/ID/native` accepts `enable`, `sync`, or `disable`; regular group membership/deletion routes maintain native subscriptions when enabled. No Device Keys appear in metadata responses.

`POST /batch` takes `{targets:"all"|["desk","front"], action, args, broadcast?:boolean}`. `POST /fade` takes `{targets, brightness, seconds}`. `GET /effects` lists the union of supported effect names; per-fixture capabilities remain authoritative. `/groups` provides local membership CRUD. `/library/scenes`, `/library/presets` and `/library/quickshots` provide list/save, ID-or-name update/delete and `/:id/recall`; preset recall may include a `target` fixture key.

Successful hardware commands return `{ "ok": true, "verified": true, "result": { ... } }`. Fixture states contain `sleep`, `intensity` in 0-1000 API units, `mode` (`cct`, `hsi` or `effect`), applicable parameters and `observedAt`; batch results include delivery type and keyed states. Library saves confirm persistence with `ok:true`, not a misleading hardware-verification flag. Invalid requests and unverified commands return `ok:false` with an error. Queue depth and request size are bounded, and disconnected clients cannot start queued mutations.

The legacy external daemon remains compatible for commands it supports, but it cannot gain verified delivery or live state just by using the new CLI.

## Protocol findings

- Physical controls use access opcode `0x26` and a ten-byte checksummed payload. Standard Generic OnOff/Lightness state is not sufficient to verify the actual LEDs.
- The CCT field at bits 52-61 uses **10-K units** on these fixtures. Writing raw kelvin or the previous guessed flag produces incorrect/clamped colors.
- Actual fixture output quantizes CCT to **100-K steps**, despite that finer wire format. A 4540-K wire command read back as 4500 K on all three fixtures. Normalize requested settings to the supported resolution before checking them, and report the applied value.
- Intensity occupies bits 62-71, but these fixture models quantize to whole percent. They do not support the protocol's nominal tenth-percent precision.
- Legacy G/M in CCT bits 45-51 is an index: **0 means -100 magenta, 10 means neutral, 20 means +100 green**. The earlier all-zero tint field was wrong on the 150c even though its Kelvin/brightness readback matched.
- Effect command `0x87` uses native wire IDs, not the SDK's public effect enum numbers. Compact CCT and HSI effect variants have different bit layouts. Fan query/set commands are `0x09`/`0x89`.
- Menu requests use command byte `0x0e`. Replies are addressed to **the original provisioner `0x0001`**, not the querying controller. The proxy therefore whitelists both that address and the dedicated controller source. Receiving a reply to `1` does not require transmitting as `1`.
- Reply bit 8 is an awake flag: zero means sleeping. Commands and status must not invert this distinction.
- Proxy configuration uses an eight-byte network MIC and an authenticated Filter Status response; write completion alone is not initialization success.

These details were checked against the installed SDK's packet encoder/field accessors, actual decrypted fixture responses, desktop behavior and webcam captures. No SDK binary or private network key is distributed in this repository.

## Hardware feedback loop

The following diagnostics require `ffmpeg` with AVFoundation and explicit camera permission:

```sh
npx tsx scripts/webcam.ts baseline
# Stop the daemon before calibration: it owns the mesh connection/counters.
npx tsx scripts/calibrate-webcam.ts
# Optional desktop comparison, still with the BLE daemon stopped.
npx tsx scripts/desktop-reference.ts reference
# Quit Amaran Desktop, then resume the BLE daemon before API-based checks.
npx tsx scripts/ble-hardware-check.ts
npx tsx scripts/ble-live-extended-check.ts
npx tsx scripts/ble-effects-check.ts
npx tsx scripts/ble-fan-check.ts --restart-service
npx tsx scripts/ble-followup-check.ts
```

Captures and JSON reports stay in the project's gitignored `artifacts/` directory. No images are uploaded. Pixel format `nv12` avoids the corrupted packed-pixel frames observed with the default camera format.

Calibration isolates each fixture at 1%, locates its emitting face against a dark reference, and saves fixture-keyed regions to `artifacts/webcam/regions.json`. Recalibrate after moving either camera or lights; captures without that file are explicitly marked uncalibrated. Inspect isolated frames to distinguish emitters from glare/reflections. `--reuse` recomputes regions from the most recent saved isolation captures without operating lights.

The core check isolates each light, compares warm/cool output, exercises 0/1/2% brightness, and verifies the 150c's red/green/blue channel dominance; it finishes by putting lights to sleep. Color assertions use the emitter's surrounding halo, excluding the clipped white center, rather than mistaking overexposure for incorrect color. The extended check covers tint, allowed cooling profiles, batch/broadcast brightness, fades, saved-state recall and representative slow native effects; it restores initial CCT/power/brightness/tint and fan modes and records restoration failures. A sampled camera sequence measures rising and falling pulsing output after initial exposure settles.

The dedicated effects check verifies every advertised effect, frequency changes and both 150c HSI variants with brightness held at **zero**, then restores initial settings. This exercises real packet/readback behavior without emitting rapid flashes. It is not an optical certification of every flashing pattern.

`npx tsx scripts/ble-cli-check.ts prepare` exercises the real CLI and creates temporary library records, then deliberately leaves a prepared lighting state. Restart the daemon and run `npx tsx scripts/ble-cli-check.ts verify <printed-manifest-path>` to verify persistence, restore initial lighting and remove those temporary records. Keep competing automation paused across both phases.

The fan check requires brightness at 5% or less and never changes LED settings. It verifies individual and grouped Smart/Medium selection, zero-RPM reporting, unsupported-mode rejection, and restoration of the original fan profiles. Its optional `--restart-service` flag checks that profiles survive a restart of the installed BLE LaunchAgent. Keep automation paused during that restart. All eight mode codes and manual setpoint encoding/readback are covered by SDK-derived vectors and simulated advertised capabilities. Thermal trips, missing telemetry and recovery failures are simulated, never induced by overheating real fixtures. Diagnostics refuse an initial Manual profile because its original setpoint cannot be inferred safely from current RPM.

The follow-up check covers product reads, CCT/HSI transitions with camera color feedback, automatic-update suppression, group rename/effect stop, zero-output trigger requests, saved-state updates and scene/fan restoration. It preserves prior override expiry times on success; on failure, protective holds remain in place for investigation. Older lighting diagnostics also generate manual holds; explicitly resume selected fixtures when their checks/restoration are complete.

Automatic exposure, white balance and clipped highlights mean camera values are **not calibrated lux or CCT measurements**. Physical checks establish on/off, color and representative effect response; authenticated telemetry verifies exact applied digital settings. These are low-output checks, not high-output thermal certification or long-duration endurance testing.
