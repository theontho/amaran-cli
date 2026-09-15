import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { MaxLuxCalibration } from '../config.js';
import { interpolateMaxLux } from '../daylightSimulation/mathUtil.js';
import { inferSimulatedKelvin } from './colors.js';
import { FanStateSchema } from './fan.js';
import { SavedStateSchema } from './library.js';
import { atomicJson } from './storage.js';
import type { FixtureState } from './telink.js';

export const DashboardSettingsSchema = z
  .object({
    version: z.literal(1),
    title: z.string().trim().min(1).max(80),
    refreshSeconds: z.number().int().min(5).max(300),
    defaultTransitionSeconds: z.number().min(0.5).max(20),
    fixtureOrder: z.array(z.string()).max(128),
    fixtureLabels: z.record(z.string().trim().min(1).max(80)),
    maxBrightness: z.number().min(0).max(100).optional(),
  })
  .strict()
  .transform(({ maxBrightness: _legacyMaxBrightness, ...settings }) => settings);

export const DashboardStatusSchema = z
  .object({
    version: z.literal(1),
    updatedAt: z.string().datetime(),
    connected: z.boolean(),
    lighting: z.record(SavedStateSchema),
    fans: z.record(FanStateSchema),
    simulatedCct: z.record(z.number().int().min(1000).max(20000).nullable()).default({}),
    estimatedLux: z.record(z.number().nonnegative().nullable()).default({}),
  })
  .strict();

export type DashboardSettings = z.infer<typeof DashboardSettingsSchema>;
export type DashboardStatus = z.infer<typeof DashboardStatusSchema>;

export function fullOutputLux(calibration: MaxLuxCalibration | undefined, kelvin: number): number | null {
  if (calibration === undefined) return null;
  return typeof calibration === 'number' ? calibration : interpolateMaxLux(kelvin, calibration);
}

export function brightnessForLux(
  calibration: MaxLuxCalibration | undefined,
  kelvin: number,
  targetLux: number
): number | null {
  const fullOutput = fullOutputLux(calibration, kelvin);
  if (fullOutput === null || fullOutput <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((targetLux / fullOutput) * 100)));
}

export function estimateLux(
  calibration: MaxLuxCalibration | undefined,
  state: FixtureState,
  simulatedCct?: number
): number | null {
  if (state.sleep) return 0;
  const kelvin = state.mode === 'cct' ? state.cct : state.mode === 'hsi' ? simulatedCct : undefined;
  if (kelvin === undefined) return null;
  const fullOutput = fullOutputLux(calibration, kelvin);
  if (fullOutput === null) return null;
  return Math.round((fullOutput * state.intensity) / 1000);
}

export function simulatedCctForState(state: FixtureState, nativeMin: number, nativeMax: number): number | undefined {
  return state.mode === 'hsi' ? inferSimulatedKelvin(state.hue, state.sat, nativeMin, nativeMax) : undefined;
}

const defaults = (keys: string[]): DashboardSettings => ({
  version: 1,
  title: 'Amaran Control',
  refreshSeconds: 10,
  defaultTransitionSeconds: 2,
  fixtureOrder: keys,
  fixtureLabels: {},
});

export class DashboardStore {
  private settings: DashboardSettings;
  private status?: DashboardStatus;
  private readonly settingsFile?: string;
  private readonly statusFile?: string;

  constructor(directory?: string, fixtureKeys: string[] = []) {
    this.settingsFile = directory ? path.join(directory, 'dashboard-settings.json') : undefined;
    this.statusFile = directory ? path.join(directory, 'dashboard-status.json') : undefined;
    const settingsExisted = !!this.settingsFile && existsSync(this.settingsFile);
    const persistedSettings =
      settingsExisted && this.settingsFile
        ? (JSON.parse(readFileSync(this.settingsFile, 'utf8')) as unknown)
        : undefined;
    this.settings =
      persistedSettings === undefined ? defaults(fixtureKeys) : DashboardSettingsSchema.parse(persistedSettings);
    if (this.statusFile && existsSync(this.statusFile))
      this.status = DashboardStatusSchema.parse(JSON.parse(readFileSync(this.statusFile, 'utf8')));
    this.settings = this.normalizeOrder(this.settings, fixtureKeys);
    if (this.settingsFile && (!settingsExisted || JSON.stringify(persistedSettings) !== JSON.stringify(this.settings)))
      atomicJson(this.settingsFile, this.settings);
  }

  getSettings(): DashboardSettings {
    return structuredClone(this.settings);
  }

  updateSettings(value: unknown, fixtureKeys: string[]): DashboardSettings {
    const next = DashboardSettingsSchema.parse({ ...this.settings, ...(value as object), version: 1 });
    const allowed = new Set(fixtureKeys);
    if (next.fixtureOrder.some((key) => !allowed.has(key))) throw new Error('Fixture order contains an unknown key');
    if (new Set(next.fixtureOrder).size !== next.fixtureOrder.length)
      throw new Error('Fixture order contains duplicate keys');
    for (const key of Object.keys(next.fixtureLabels))
      if (!allowed.has(key)) throw new Error(`Fixture label contains unknown key: ${key}`);
    this.settings = this.normalizeOrder(next, fixtureKeys);
    if (this.settingsFile) atomicJson(this.settingsFile, this.settings);
    return this.getSettings();
  }

  getStatus(): DashboardStatus | undefined {
    return this.status ? structuredClone(this.status) : undefined;
  }

  saveStatus(value: DashboardStatus): DashboardStatus {
    this.status = DashboardStatusSchema.parse(value);
    if (this.statusFile) atomicJson(this.statusFile, this.status);
    return structuredClone(this.status);
  }

  private normalizeOrder(settings: DashboardSettings, fixtureKeys: string[]): DashboardSettings {
    const allowed = new Set(fixtureKeys);
    return {
      ...settings,
      fixtureOrder: [
        ...settings.fixtureOrder.filter((key) => allowed.has(key)),
        ...fixtureKeys.filter((key) => !settings.fixtureOrder.includes(key)),
      ],
      fixtureLabels: Object.fromEntries(Object.entries(settings.fixtureLabels).filter(([key]) => allowed.has(key))),
    };
  }
}

export const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Amaran Control</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/dashboard.css">
</head>
<body>
  <header>
    <div><p class="eyebrow">DIRECT BLUETOOTH MESH</p><h1 id="title">Amaran Control</h1></div>
    <div class="connection"><span id="connection-dot"></span><strong id="connection">Connecting</strong><small id="updated"></small></div>
  </header>
  <nav>
    <label>Target <select id="target"></select></label>
    <button id="refresh">Refresh state</button>
    <a href="/health" target="_blank" rel="noreferrer">Raw API</a>
  </nav>
  <main>
    <section class="wide"><div class="section-head"><h2>Live status</h2><span>Readback, not assumed state</span></div><div id="fixture-cards" class="cards"></div></section>

    <section class="wide"><div class="section-head"><h2>Circadian service</h2><span id="circadian-generated">Loading schedule</span></div>
      <div class="circadian-summary">
        <div class="metric"><small>Service</small><strong id="circadian-active">Checking</strong><span id="circadian-last-run"></span></div>
        <div class="metric"><small>Latest target</small><strong id="circadian-target">—</strong><span id="circadian-applied"></span></div>
        <div class="metric"><small>Schedule</small><strong id="circadian-curve">—</strong><span id="circadian-bounds"></span></div>
        <div class="metric"><small>Weather</small><strong id="circadian-weather">—</strong><span id="circadian-weather-detail"></span></div>
      </div>
      <div class="circadian-controls grid compact">
        <label>Curve <select id="circadian-setting-curve"><option value="cie-daylight">CIE Daylight</option><option value="sun-altitude">Sun Altitude</option><option value="perez-daylight">Perez Daylight</option><option value="physics">Physics</option><option value="blackbody">Blackbody</option><option value="hazy">Hazy</option><option value="hann">Hann</option><option value="wider-middle-small">Wider Middle (Small)</option><option value="wider-middle-medium">Wider Middle (Medium)</option><option value="wider-middle-large">Wider Middle (Large)</option></select></label>
        <label><span>Service enabled</span><input id="circadian-setting-enabled" type="checkbox"></label>
        <label><span>Use live weather</span><input id="circadian-setting-weather" type="checkbox"></label>
        <label>Update interval seconds <input id="circadian-setting-interval" type="number" min="10" max="86400" step="1"></label>
        <label>Minimum Kelvin <input id="circadian-setting-cct-min" type="number" min="1000" max="20000" step="100"></label>
        <label>Maximum Kelvin <input id="circadian-setting-cct-max" type="number" min="1000" max="20000" step="100"></label>
        <label><span>Go below fixture Kelvin range</span><input id="circadian-setting-extend-below" type="checkbox"></label>
        <label><span>Go above fixture Kelvin range</span><input id="circadian-setting-extend-above" type="checkbox"></label>
        <label>Minimum intensity % <input id="circadian-setting-intensity-min" type="number" min="0" max="100" step="1"></label>
        <label>Maximum intensity % <input id="circadian-setting-intensity-max" type="number" min="0" max="100" step="1"></label>
        <label>Latitude <input id="circadian-setting-latitude" type="number" min="-90" max="90" step="0.0001" placeholder="Automatic"></label>
        <label>Longitude <input id="circadian-setting-longitude" type="number" min="-180" max="180" step="0.0001" placeholder="Automatic"></label>
      </div>
      <div class="button-row"><button id="circadian-save-settings">Save circadian settings</button><span id="circadian-settings-state"></span></div>
      <div class="graph-wrap">
        <svg id="circadian-graph" viewBox="0 0 1100 300" role="img" aria-label="Circadian Kelvin, intensity, and sunlight lux schedule"></svg>
        <div id="circadian-tooltip" class="graph-tooltip" hidden></div>
      </div>
      <div class="graph-legend"><span class="kelvin-key">Kelvin</span><span class="intensity-key">Natural intensity</span><span class="sunlight-key">Actual sunlight lux (modeled)</span><span class="capacity-key">System lux capacity</span><span>Hover or slide over the graph for exact values</span></div>
    </section>

    <section><h2>Power & brightness</h2><div class="button-row"><button data-power="on">On</button><button data-power="off">Off</button><button data-power="toggle">Toggle</button></div>
      <label>Brightness <output id="brightness-value">5%</output><input id="brightness" type="range" min="0" max="100" value="5"></label>
      <div class="button-row"><button id="set-brightness">Set</button><label>Fade seconds <input id="fade-seconds" type="number" min=".5" max="20" step=".5" value="2"></label><button id="fade">Fade</button></div>
    </section>

    <section><h2>White light</h2><label>Kelvin <input id="kelvin" type="number" min="2500" max="7500" step="100" value="3200"></label>
      <label>G/M (-100 magenta, +100 green) <input id="gm" type="number" min="-100" max="100" step="10" value="0"></label>
      <label>Brightness % <input id="cct-brightness" type="number" min="0" max="100" value="5"></label>
      <div class="button-row"><button id="set-cct">Set CCT</button><label>Transition <input id="cct-seconds" type="number" min=".5" max="20" step=".5" value="2"></label><button id="transition-cct">Transition</button></div>
    </section>

    <section><h2>Color / HSI</h2><label>Hue <input id="hue" type="number" min="0" max="360" value="0"></label>
      <label>Saturation % <input id="saturation" type="number" min="0" max="100" value="100"></label>
      <label>Brightness % <input id="hsi-brightness" type="number" min="0" max="100" value="5"></label>
      <div class="button-row"><button id="set-hsi">Set HSI</button><button id="transition-hsi">Transition</button></div>
      <label>Named or hex color <input id="color" value="#ff6b35"></label><button id="set-color">Set color</button>
    </section>

    <section class="wide"><h2>Native effects</h2><div class="grid compact">
      <label>Effect <select id="effect"></select></label><label>Brightness % <input id="effect-brightness" type="number" min="0" max="100" value="5"></label>
      <label>Frequency 1-10 <input id="effect-frequency" type="number" min="1" max="10" value="5"></label><label>Animation speed 0-10 <input id="effect-speed" type="number" min="0" max="10" value="0"></label>
      <label>Kelvin <input id="effect-kelvin" type="number" min="2500" max="7500" step="100" value="3200"></label><label>G/M <input id="effect-gm" type="number" min="-100" max="100" step="10" value="0"></label>
      <label>Palette 0-2 <input id="effect-palette" type="number" min="0" max="2" value="0"></label><label>Hue <input id="effect-hue" type="number" min="0" max="360" value="0"></label>
      <label>Saturation % <input id="effect-saturation" type="number" min="0" max="100" value="100"></label><label><input id="effect-hsi" type="checkbox"> Use 150c HSI variant</label>
    </div><div class="button-row"><button id="set-effect">Apply effect</button><button id="effect-animation">Update animation speed</button><button id="trigger-effect">Trigger</button><button id="stop-effect">Stop & restore</button></div></section>

    <section><h2>Fan & thermal state</h2><label>Mode <select id="fan-mode"><option>manual</option><option selected>smart</option><option>max</option><option>off</option><option>high</option><option>medium</option><option>low</option><option>silent</option></select></label>
      <label>Manual RPM <input id="fan-rpm" type="number" min="0" max="65535" value="1500"></label><div class="button-row"><button id="set-fan">Set fan</button><button id="fan-info">Read fan state</button></div>
    </section>

    <section><h2>Circadian override</h2><label>Hold minutes <input id="hold-minutes" type="number" min="1" max="1440" value="30"></label>
      <div class="button-row"><button id="hold">Hold</button><button id="resume">Resume</button><button id="override-status">Status</button></div>
    </section>

    <section class="wide"><h2>Advanced verified control</h2><div class="grid compact"><label>Action <input id="advanced-action" value="increment-brightness"></label><label>Arguments JSON <input id="advanced-args" value='{"delta":1}'></label><label>Automatic CCT brightness % <input id="automatic-brightness" type="number" min="0" max="100" value="5"></label></div>
      <div class="button-row"><button id="advanced-run">Run on target</button><button id="advanced-batch">Verified batch</button><button id="advanced-broadcast">Mesh broadcast</button><button id="automatic-cct">Automatic CCT</button><button id="product-info">Product info</button></div>
    </section>

    <section class="wide"><h2>Groups</h2><div class="grid compact"><label>Group ID/name <input id="group-id"></label><label>New name <input id="group-name"></label><label>Fixture key <input id="group-member"></label><label>Native address (optional) <input id="group-address" placeholder="0xc100"></label></div>
      <div class="button-row"><button id="group-list">List/show</button><button id="group-create">Create</button><button id="group-rename">Rename</button><button id="group-add">Add member</button><button id="group-remove">Remove member</button><button id="group-native-enable">Native enable</button><button id="group-native-sync">Native sync</button><button id="group-native-disable">Native disable</button><button id="group-delete">Delete</button></div>
    </section>

    <section class="wide"><h2>Scenes, presets & quickshots</h2><div class="grid compact"><label>Collection <select id="collection"><option>scenes</option><option>presets</option><option>quickshots</option></select></label><label>Name / ID <input id="saved-key"></label><label>Transition seconds (optional) <input id="saved-seconds" type="number" min=".5" max="20" step=".5"></label></div>
      <div class="button-row"><button id="saved-list">List</button><button id="saved-show">Show</button><button id="saved-save">Save selected target</button><button id="saved-update">Update</button><button id="saved-recall">Recall</button><button id="saved-delete">Delete</button></div>
    </section>

    <section class="wide"><h2>Timeline & media programs</h2><label>Timeline JSON <textarea id="program-json" rows="5">{"kind":"timeline","duration":3,"restore":true,"steps":[{"at":0,"action":"brightness","args":{"value":1}},{"at":1,"action":"cct","args":{"kelvin":3200,"brightness":2}}]}</textarea></label>
      <div class="button-row"><button id="program-start">Start timeline</button><button id="jobs-list">List jobs</button><input id="job-id" placeholder="Job ID"><button id="job-stop">Stop job</button></div>
      <div class="grid compact"><label>Local audio path <input id="audio-path"></label><label>Local image path <input id="image-path"></label><label>Duration seconds <input id="media-seconds" type="number" min="1" max="1200" value="30"></label><label>Max brightness % <input id="media-max" type="number" min="0" max="100" value="100"></label></div>
      <div class="button-row"><button id="audio-start">Run audio file</button><button id="image-start">Run image file</button><button id="camera-start">Use browser camera</button><button id="microphone-start">Use browser microphone</button><button id="capture-stop">Stop live capture</button></div>
      <video id="camera-preview" muted playsinline></video><canvas id="camera-canvas" hidden></canvas>
    </section>

    <section><h2>Mesh diagnostics</h2><div class="button-row"><button id="mesh-inspect">Inspect mesh</button><button id="mesh-discover">Discover unprovisioned</button></div>
      <label>Desktop database path <input id="database-path"></label><div class="button-row"><button id="desktop-preview">Preview Desktop import</button><button id="desktop-apply">Apply Desktop import</button><button id="mesh-import-keys">Import Device Keys</button></div>
    </section>

    <section><h2>Dashboard settings</h2><label>Title <input id="setting-title"></label><label>Refresh seconds <input id="setting-refresh" type="number" min="5" max="300"></label><label>Default transition seconds <input id="setting-transition" type="number" min=".5" max="20" step=".5"></label><label>Fixture order (comma-separated keys) <input id="setting-order"></label><label>Fixture labels JSON <input id="setting-labels" value="{}"></label><button id="save-settings">Save settings</button></section>

    <section class="wide"><div class="section-head"><h2>Activity</h2><button id="clear-log">Clear</button></div><pre id="log">Ready.</pre></section>
  </main>
  <script src="/dashboard.js"></script>
</body>
</html>`;

export const dashboardFavicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="glow" x1="12" y1="8" x2="52" y2="56" gradientUnits="userSpaceOnUse">
      <stop stop-color="#fff3a6"/>
      <stop offset=".48" stop-color="#ffbb55"/>
      <stop offset="1" stop-color="#ff6b35"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="15" fill="#101312"/>
  <circle cx="32" cy="27" r="15" fill="url(#glow)"/>
  <path d="M25 43h14v4H25zm2 6h10v4H27z" fill="#79f2a7"/>
  <path d="M32 5v5M12 27H7m50 0h-5M17.9 12.9l3.5 3.5m25.2-3.5-3.5 3.5" fill="none" stroke="#fff3a6" stroke-linecap="round" stroke-width="3"/>
</svg>`;

export const dashboardCss = `:root{color-scheme:dark;--bg:#101312;--panel:#191e1c;--line:#303934;--text:#eef5f0;--muted:#9ca9a1;--green:#79f2a7;--amber:#ffbb55;--red:#ff6b6b;--sun:#62c6ff;--capacity:#c99cff;font:14px/1.35 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 15% -10%,#284032 0,transparent 28rem),var(--bg);color:var(--text)}header,nav,main{max-width:1500px;margin:auto}header{display:flex;justify-content:space-between;align-items:center;padding:16px 20px 9px}h1{font-size:clamp(1.7rem,3vw,2.8rem);line-height:1;margin:.1rem 0}.eyebrow{color:var(--green);font-size:.75rem;font-weight:800;letter-spacing:.16em;margin:0}.connection{display:grid;grid-template-columns:auto auto;gap:1px 7px;align-items:center}.connection small{grid-column:2;color:var(--muted)}#connection-dot{width:10px;height:10px;border-radius:50%;background:var(--amber);box-shadow:0 0 12px currentColor}nav{position:sticky;top:0;z-index:4;display:flex;gap:9px;align-items:end;padding:8px 20px;background:#101312ed;backdrop-filter:blur(14px);border-block:1px solid var(--line)}nav label{display:flex;align-items:center;gap:7px;margin:0}nav select{min-width:180px}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:12px 20px 36px}section{background:linear-gradient(145deg,#1b211e,#151917);border:1px solid var(--line);border-radius:12px;padding:13px;box-shadow:0 10px 28px #0003}.wide{grid-column:1/-1}h2{margin:0 0 9px;font-size:1.05rem}.section-head{display:flex;justify-content:space-between;gap:10px;align-items:center}.section-head span,label{color:var(--muted)}label{display:grid;gap:3px;margin:7px 0}input,select,textarea,button,a{font:inherit}input,select,textarea{width:100%;border:1px solid var(--line);border-radius:7px;padding:6px 8px;background:#0e1210;color:var(--text)}input[type=range]{padding:0;accent-color:var(--green)}textarea{resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}button,a{border:1px solid #46534b;border-radius:7px;padding:6px 9px;background:#263029;color:var(--text);font-weight:700;text-decoration:none;cursor:pointer}button:hover,a:hover{border-color:var(--green);color:var(--green)}button:active{transform:translateY(1px)}.button-row{display:flex;gap:6px;flex-wrap:wrap;align-items:end;margin-top:8px}.button-row label{margin:0;min-width:105px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.grid label{margin:0}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:8px}.card{border:1px solid var(--line);background:#101512;border-radius:10px;padding:11px}.card-head{display:flex;justify-content:space-between;align-items:start;gap:8px}.card h3{margin:0 0 2px}.card p{margin:2px 0;color:var(--muted)}.card .on{color:var(--green)}.card .off{color:var(--muted)}.card-controls{display:grid;gap:5px;margin-top:8px}.card-controls label{grid-template-columns:76px 1fr minmax(48px,auto);align-items:center;margin:0}.card-controls output{text-align:right;color:var(--text);font-variant-numeric:tabular-nums;white-space:nowrap}.card-controls input{min-width:0}.circadian-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:10px}.metric{display:grid;gap:2px;background:#101512;border:1px solid var(--line);border-radius:9px;padding:9px}.metric small,.metric span{color:var(--muted)}.metric strong{font-size:1.08rem}.metric .good{color:var(--green)}.metric .bad{color:var(--red)}.metric .warn{color:var(--amber)}.graph-wrap{position:relative;min-height:260px;border:1px solid var(--line);border-radius:10px;background:#0d110f;overflow:hidden}.graph-wrap svg{display:block;width:100%;height:auto;min-height:260px;touch-action:none}.graph-tooltip{position:absolute;z-index:2;pointer-events:none;min-width:170px;padding:7px 9px;border:1px solid #536159;border-radius:7px;background:#090c0af2;color:var(--text);box-shadow:0 8px 20px #0008;font-variant-numeric:tabular-nums}.graph-tip-row{display:block}.graph-tip-row:before{content:"";display:inline-block;width:8px;height:8px;margin-right:6px;border-radius:50%}.graph-tip-kelvin:before{background:var(--green)}.graph-tip-intensity:before,.graph-tip-applied:before{background:var(--amber)}.graph-tip-sunlight:before{background:var(--sun)}.graph-tip-capacity:before{background:var(--capacity)}.graph-legend{display:flex;gap:16px;flex-wrap:wrap;color:var(--muted);margin-top:7px}.graph-legend span:before{content:"";display:inline-block;width:16px;height:3px;margin-right:6px;vertical-align:middle;border-radius:2px}.graph-legend .kelvin-key:before{background:var(--green)}.graph-legend .intensity-key:before{background:var(--amber)}.graph-legend .sunlight-key:before{background:var(--sun)}.graph-legend .capacity-key:before{background:repeating-linear-gradient(90deg,var(--capacity) 0 5px,transparent 5px 8px)}.graph-legend span:last-child:before{display:none}pre{max-height:300px;overflow:auto;background:#090c0a;border-radius:8px;padding:10px;white-space:pre-wrap;word-break:break-word;color:#cce7d6}video{display:none;max-width:320px;margin-top:8px;border-radius:8px}video.active{display:block}@media(max-width:1050px){main{grid-template-columns:repeat(2,minmax(0,1fr))}.circadian-summary{grid-template-columns:1fr 1fr}}@media(max-width:720px){header{align-items:flex-start;gap:12px}.connection{margin-top:6px}main{grid-template-columns:1fr}.wide{grid-column:auto}.grid{grid-template-columns:1fr 1fr}nav{align-items:center;flex-wrap:wrap}}@media(max-width:520px){header{display:block}.grid,.circadian-summary{grid-template-columns:1fr}.button-row>*{flex:1 1 auto}}`;

export const dashboardJs = String.raw`const $=id=>document.getElementById(id);const esc=value=>String(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));let health,settings,status,circadian,capture,circadianSettingsDirty=false;const simulatedKelvin={};
const log=(label,value)=>{$('log').textContent=new Date().toLocaleTimeString()+' '+label+'\n'+(value===undefined?'':JSON.stringify(value,null,2))+'\n\n'+$('log').textContent};
async function api(path,options={}){const {timeoutMs=15000,...request}=options;const response=await fetch(path,{headers:{'content-type':'application/json'},...request,signal:request.signal??AbortSignal.timeout(timeoutMs)});const data=await response.json();if(!response.ok||data.ok===false)throw new Error(data.error||response.statusText);return data.result??data.data??data}
const selected=()=>$('target').value;const targets=()=>selected()==='all'?'all':[selected()];
async function lightAction(action,args={}){return selected()==='all'?api('/batch',{method:'POST',body:JSON.stringify({targets:'all',action,args})}):api('/lights/'+encodeURIComponent(selected())+'/'+action,{method:'POST',body:JSON.stringify(args)})}
async function act(label,fn){try{const value=await fn();log(label,value);await refreshStatus()}catch(error){log('ERROR: '+label,{error:error.message})}}
function fixtureName(key){return settings?.fixtureLabels?.[key]||health?.lights?.find(light=>light.key===key)?.name||key}
function interpolateLux(calibration,kelvin){if(typeof calibration==='number')return calibration;const points=Object.entries(calibration||{}).map(([cct,lux])=>({cct:+cct,lux:+lux})).filter(point=>Number.isFinite(point.cct)&&Number.isFinite(point.lux)).sort((a,b)=>a.cct-b.cct);if(!points.length)return null;if(kelvin<=points[0].cct)return points[0].lux;if(kelvin>=points.at(-1).cct)return points.at(-1).lux;for(let index=0;index<points.length-1;index++){const left=points[index],right=points[index+1];if(kelvin>=left.cct&&kelvin<=right.cct)return left.lux+(kelvin-left.cct)*(right.lux-left.lux)/(right.cct-left.cct)}return null}
function cardLux(light,state,kelvin,brightness,simulated=false){if(state?.sleep)return 0;if(state?.mode!=='cct'&&!simulated)return null;const full=interpolateLux(light.luxCalibration,kelvin);return full===null?null:Math.round(full*brightness/100)}
function brightnessFromLux(light,kelvin,lux){const full=interpolateLux(light.luxCalibration,kelvin);return full===null?null:Math.max(0,Math.min(100,Math.round(lux/full*100)))}
function luxLabel(value){return value===null?'Est. lux —':'Est. '+value.toLocaleString()+' lx'}
function statusClass(element,value){element.className=value}
const shortLux=value=>value>=1000?(Math.round(value/100)/10)+'k lx':Math.round(value)+' lx';
function renderCircadian(){if(!circadian)return;const service=circadian.service,current=circadian.current,schedule=circadian.schedule;$('circadian-generated').textContent='Updated '+new Date(circadian.generatedAt).toLocaleTimeString();$('circadian-active').textContent=service.healthy?'Active':service.active?'Loaded, waiting':'Inactive';statusClass($('circadian-active'),service.healthy?'good':service.active?'warn':'bad');$('circadian-last-run').textContent=service.lastRunAt?'Last run '+new Date(service.lastRunAt).toLocaleTimeString():'No recorded run';const target=service.lastTarget||current;$('circadian-target').textContent=target?Math.round(target.cct)+' K · '+target.intensity+'%':'—';const applied=status?.lighting?Object.values(status.lighting)[0]:undefined;$('circadian-applied').textContent=applied?.cct!==undefined?'Applied '+applied.cct+' K · '+applied.intensity/10+'%':'No fixture readback';$('circadian-curve').textContent=(current?.curve||service.curve||'Unknown').replaceAll('-',' ');if(schedule?.points?.length){const intensities=schedule.points.map(point=>point.intensity),ccts=schedule.points.map(point=>point.cct),sunlight=schedule.points.map(point=>point.sunlightLux||0),capacity=schedule.points.map(point=>point.systemCapacityLux||0);$('circadian-bounds').textContent=Math.min(...ccts)+'–'+Math.max(...ccts)+' K · '+Math.min(...intensities)+'–'+Math.max(...intensities)+'% · Sun '+shortLux(Math.max(...sunlight))+(Math.max(...capacity)>0?' · System '+shortLux(Math.max(...capacity)):'')}else $('circadian-bounds').textContent=circadian.calculationError||'Schedule unavailable';$('circadian-weather').textContent=service.weatherConfigured?(current?.weatherActive?'Active':'Configured, unavailable'):'Off';statusClass($('circadian-weather'),current?.weatherActive?'good':service.weatherConfigured?'warn':'');const weather=[];if(current?.cloudCover!==undefined)weather.push(Math.round(current.cloudCover*100)+'% cloud');if(current?.precipitation)weather.push(current.precipitation);if(current?.weatherDataSource)weather.push(current.weatherDataSource);if(current?.weatherEffect){const effect=current.weatherEffect;weather.push('effect '+(effect.intensityDelta>=0?'+':'')+effect.intensityDelta+'%'+(effect.cctDelta?(effect.cctDelta>=0?' · +':' · ')+effect.cctDelta+' K':'')+(effect.sunlightLuxDelta!==undefined?' · '+(effect.sunlightLuxDelta>=0?'+':'')+effect.sunlightLuxDelta.toLocaleString()+' lx':'')+' vs clear')} $('circadian-weather-detail').textContent=weather.join(' · ')||'No weather adjustment';if(!circadianSettingsDirty&&circadian.settings){const value=circadian.settings;$('circadian-setting-enabled').checked=value.enabled;$('circadian-setting-curve').value=value.curve;$('circadian-setting-weather').checked=value.weather;$('circadian-setting-interval').value=value.intervalSeconds;$('circadian-setting-cct-min').value=value.cctMin;$('circadian-setting-cct-max').value=value.cctMax;$('circadian-setting-extend-below').checked=value.extendCctBelowNative;$('circadian-setting-extend-above').checked=value.extendCctAboveNative;$('circadian-setting-intensity-min').value=value.intensityMin;$('circadian-setting-intensity-max').value=value.intensityMax;$('circadian-setting-latitude').value=value.latitude??'';$('circadian-setting-longitude').value=value.longitude??''}renderCircadianGraph(schedule)}
function renderCircadianGraph(schedule){const svg=$('circadian-graph'),tooltip=$('circadian-tooltip');if(!schedule?.points?.length){svg.innerHTML='<text x="550" y="150" text-anchor="middle" fill="#9ca9a1">Schedule unavailable</text>';return}const points=schedule.points,width=1100,height=300,left=64,right=112,top=22,bottom=42,plotWidth=width-left-right,plotHeight=height-top-bottom,minCct=Math.min(...points.map(point=>point.cct)),maxCct=Math.max(...points.map(point=>point.cct)),cctSpan=Math.max(1,maxCct-minCct),intensityLimit=Math.max(0,Math.min(100,schedule.intensityLimit??100)),sunlightValues=points.map(point=>point.sunlightLux??point.lightOutput??0),capacityValues=points.map(point=>point.systemCapacityLux??0),luxScale=Math.max(10000,Math.ceil(Math.max(...sunlightValues,...capacityValues)/10000)*10000);const x=index=>left+index/(points.length-1)*plotWidth,yCct=value=>top+(maxCct-value)/cctSpan*plotHeight,yIntensity=value=>top+(100-value)/100*plotHeight,yLux=value=>top+(luxScale-value)/luxScale*plotHeight,line=values=>values.map((value,index)=>x(index).toFixed(1)+','+value.toFixed(1)).join(' '),kelvin=line(points.map(point=>yCct(point.cct))),intensity=line(points.map(point=>yIntensity(point.intensity))),sunlight=line(sunlightValues.map(yLux)),capacity=line(capacityValues.map(yLux)),limitY=yIntensity(intensityLimit),now=Date.now(),currentIndex=points.reduce((best,point,index)=>Math.abs(Date.parse(point.time)-now)<Math.abs(Date.parse(points[best].time)-now)?index:best,0),grid=[0,.25,.5,.75,1].map(factor=>{const y=top+factor*plotHeight;return '<line x1="'+left+'" y1="'+y+'" x2="'+(width-right)+'" y2="'+y+'" stroke="#26302b"/>'}).join(''),labels=[0,6,12,18,24].map(hour=>{const index=Math.min(points.length-1,Math.round(hour/24*(points.length-1)));return '<text x="'+x(index)+'" y="'+(height-14)+'" text-anchor="middle" fill="#9ca9a1" font-size="12">'+String(hour).padStart(2,'0')+':00</text>'}).join(''),capacityLine=Math.max(...capacityValues)>0?'<polyline points="'+capacity+'" fill="none" stroke="#c99cff" stroke-width="2" stroke-dasharray="7 5"/>':'';svg.innerHTML=grid+'<text x="10" y="'+(top+5)+'" fill="#79f2a7" font-size="12">'+maxCct+' K</text><text x="10" y="'+(top+plotHeight)+'" fill="#79f2a7" font-size="12">'+minCct+' K</text><text x="'+(width-62)+'" y="'+(top+5)+'" text-anchor="end" fill="#ffbb55" font-size="12">100%</text><text x="'+(width-62)+'" y="'+(top+plotHeight)+'" text-anchor="end" fill="#ffbb55" font-size="12">0%</text><text x="'+(width-5)+'" y="'+(top+5)+'" text-anchor="end" fill="#62c6ff" font-size="12">'+shortLux(luxScale)+'</text><text x="'+(width-5)+'" y="'+(top+plotHeight)+'" text-anchor="end" fill="#62c6ff" font-size="12">0 lx</text>'+labels+'<line x1="'+left+'" y1="'+limitY+'" x2="'+(width-right)+'" y2="'+limitY+'" stroke="#ffbb55" stroke-width="2" stroke-dasharray="6 6" opacity=".75"/><text x="'+(width-right-4)+'" y="'+(limitY-6)+'" text-anchor="end" fill="#ffbb55" font-size="12">'+intensityLimit+'% service limit</text><polyline points="'+sunlight+'" fill="none" stroke="#62c6ff" stroke-width="3"/>'+capacityLine+'<polyline points="'+kelvin+'" fill="none" stroke="#79f2a7" stroke-width="3"/><polyline points="'+intensity+'" fill="none" stroke="#ffbb55" stroke-width="3"/><line x1="'+x(currentIndex)+'" y1="'+top+'" x2="'+x(currentIndex)+'" y2="'+(top+plotHeight)+'" stroke="#eef5f0" stroke-dasharray="5 5" opacity=".65"/><line id="circadian-crosshair" x1="0" y1="'+top+'" x2="0" y2="'+(top+plotHeight)+'" stroke="#eef5f0" opacity="0"/><circle id="circadian-k-dot" r="5" fill="#79f2a7" opacity="0"/><circle id="circadian-i-dot" r="5" fill="#ffbb55" opacity="0"/><circle id="circadian-sun-dot" r="5" fill="#62c6ff" opacity="0"/>';const show=event=>{const box=svg.getBoundingClientRect(),ratio=Math.max(0,Math.min(1,(event.clientX-box.left)/box.width)),index=Math.round(ratio*(points.length-1)),point=points[index],px=x(index),cross=$('circadian-crosshair'),kdot=$('circadian-k-dot'),idot=$('circadian-i-dot'),sdot=$('circadian-sun-dot'),sunLux=point.sunlightLux??point.lightOutput??0;cross.setAttribute('x1',px);cross.setAttribute('x2',px);cross.setAttribute('opacity','1');kdot.setAttribute('cx',px);kdot.setAttribute('cy',yCct(point.cct));kdot.setAttribute('opacity','1');idot.setAttribute('cx',px);idot.setAttribute('cy',yIntensity(point.intensity));idot.setAttribute('opacity','1');sdot.setAttribute('cx',px);sdot.setAttribute('cy',yLux(sunLux));sdot.setAttribute('opacity','1');tooltip.hidden=false;tooltip.innerHTML='<strong>'+new Date(point.time).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+'</strong><span class="graph-tip-row graph-tip-kelvin">'+point.cct+' K</span><span class="graph-tip-row graph-tip-intensity">Natural '+point.intensity+'%</span><span class="graph-tip-row graph-tip-applied">Service applies '+point.appliedIntensity+'%</span><span class="graph-tip-row graph-tip-sunlight">Actual sunlight '+Math.round(sunLux).toLocaleString()+' lx</span>'+(point.systemCapacityLux!==undefined?'<span class="graph-tip-row graph-tip-capacity">System capacity '+Math.round(point.systemCapacityLux).toLocaleString()+' lx</span>':'');tooltip.style.left=Math.min(box.width-210,Math.max(8,event.clientX-box.left+12))+'px';tooltip.style.top=Math.max(8,event.clientY-box.top-112)+'px'};svg.onpointermove=show;svg.onpointerdown=show;svg.onpointerleave=()=>{tooltip.hidden=true;for(const id of ['circadian-crosshair','circadian-k-dot','circadian-i-dot','circadian-sun-dot'])$(id)?.setAttribute('opacity','0')}}
function renderStatus(){const root=$('fixture-cards');root.textContent='';for(const light of health?.lights||[]){const state=status?.lighting?.[light.key];const fan=status?.fans?.[light.key];const brightness=state?state.intensity/10:0;const simulated=state?.mode==='hsi'?(status?.simulatedCct?.[light.key]??simulatedKelvin[light.key]):undefined;const kelvin=simulated??state?.cct??Math.max(light.capabilities.cct_min,Math.min(light.capabilities.cct_max,3200));const temperature=simulated?'Simulated '+simulated+'K':state?.mode==='cct'?kelvin+'K':'HSI';const sliderMin=light.capabilities.hsi_support?1000:light.capabilities.cct_min,sliderMax=light.capabilities.hsi_support?20000:light.capabilities.cct_max;const lux=status?.estimatedLux?.[light.key]??cardLux(light,state,kelvin,brightness,simulated!==undefined);const card=document.createElement('article');card.className='card';const details=state?state.mode==='cct'?(state.gm!==undefined?'G/M '+state.gm:'CCT'):state.mode==='hsi'?'H '+state.hue+'° S '+state.sat+'%':state.effect+' · F'+state.frequency:'No live readback';card.innerHTML='<div class="card-head"><div><h3>'+esc(fixtureName(light.key))+'</h3><p>'+esc(light.model)+' · '+esc(light.key)+'</p></div><button data-card-power>'+esc(state?.sleep?'Turn on':'Turn off')+'</button></div><p class="'+(state?.sleep?'off':'on')+'">'+(state?.sleep?'OFF':'ON')+' · '+brightness+'% · '+temperature+' · '+esc(details)+'</p><p><strong data-card-lux>'+esc(luxLabel(lux))+'</strong> · Fan '+esc(fan?.modeName??'unknown')+' · '+esc(fan?.speed??'—')+' RPM · '+esc(fan?.temperature??'—')+'°</p><div class="card-controls"><label>Brightness <input data-card-brightness type="range" min="0" max="100" step="1" value="'+brightness+'"><output data-card-brightness-output>'+brightness+'%</output></label><label>Lux target <input data-card-lux-target type="range" min="0" max="1" step="1" value="0"><output data-card-lux-output>—</output></label><label>Kelvin <input data-card-kelvin type="range" min="'+sliderMin+'" max="'+sliderMax+'" step="'+light.capabilities.cct_step+'" value="'+kelvin+'"><output data-card-kelvin-output>'+temperature+'</output></label></div>';const brightnessInput=card.querySelector('[data-card-brightness]'),brightnessOutput=card.querySelector('[data-card-brightness-output]'),kelvinInput=card.querySelector('[data-card-kelvin]'),kelvinOutput=card.querySelector('[data-card-kelvin-output]'),luxOutput=card.querySelector('[data-card-lux]'),luxInput=card.querySelector('[data-card-lux-target]'),luxTargetOutput=card.querySelector('[data-card-lux-output]');const updateControls=source=>{const value=+kelvinInput.value,usesSimulation=value<light.capabilities.cct_min||value>light.capabilities.cct_max,full=interpolateLux(light.luxCalibration,value),estimated=full===null?null:Math.round(full*+brightnessInput.value/100);kelvinOutput.value=(usesSimulation?'Simulated ':'')+value+'K';luxOutput.textContent=luxLabel(state?.sleep?0:estimated);luxInput.disabled=full===null;luxInput.max=String(Math.max(1,Math.round(full??1)));if(source!=='lux')luxInput.value=String(Math.min(+luxInput.max,estimated??0));luxTargetOutput.value=full===null?'—':Math.round(+luxInput.value).toLocaleString()+' lx'};brightnessInput.oninput=()=>{brightnessOutput.value=brightnessInput.value+'%';updateControls('brightness')};brightnessInput.onchange=()=>act('Set '+fixtureName(light.key)+' brightness',()=>api('/lights/'+encodeURIComponent(light.key)+'/brightness',{method:'POST',body:JSON.stringify({value:+brightnessInput.value})}));luxInput.oninput=()=>{const value=brightnessFromLux(light,+kelvinInput.value,+luxInput.value);if(value!==null){brightnessInput.value=String(value);brightnessOutput.value=value+'%'}updateControls('lux')};luxInput.onchange=()=>act('Set '+fixtureName(light.key)+' lux target',()=>api('/lights/'+encodeURIComponent(light.key)+'/brightness',{method:'POST',body:JSON.stringify({value:+brightnessInput.value})}));kelvinInput.oninput=()=>updateControls('kelvin');kelvinInput.onchange=()=>{const value=+kelvinInput.value,usesSimulation=value<light.capabilities.cct_min||value>light.capabilities.cct_max;if(usesSimulation)simulatedKelvin[light.key]=value;else delete simulatedKelvin[light.key];return act('Set '+fixtureName(light.key)+' '+(usesSimulation?'simulated ':'')+'Kelvin',()=>api('/lights/'+encodeURIComponent(light.key)+'/'+(usesSimulation?'simulated-cct':'cct'),{method:'POST',body:JSON.stringify({kelvin:value})}))};card.querySelector('[data-card-power]').onclick=()=>act((state?.sleep?'Turn on ':'Turn off ')+fixtureName(light.key),()=>api('/lights/'+encodeURIComponent(light.key)+'/'+(state?.sleep?'on':'off'),{method:'POST',body:'{}'}));updateControls('brightness');root.append(card)}$('updated').textContent=status?'Updated '+new Date(status.updatedAt).toLocaleTimeString():'No cached state'}
async function refreshStatus(){try{status=await api('/dashboard/status',{timeoutMs:8000});$('connection').textContent='Connected';$('connection-dot').style.background='#79f2a7';renderStatus()}catch(error){$('connection').textContent='Disconnected';$('connection-dot').style.background='#ff6b6b';log('Status refresh failed',{error:error.message})}}
async function refreshCircadian(){try{circadian=await api('/dashboard/circadian',{timeoutMs:8000});renderCircadian()}catch(error){$('circadian-active').textContent='Unavailable';statusClass($('circadian-active'),'bad');$('circadian-bounds').textContent=error.message;log('Circadian refresh failed',{error:error.message})}}
const circadianSettingIds=['enabled','curve','weather','interval','cct-min','cct-max','extend-below','extend-above','intensity-min','intensity-max','latitude','longitude'];for(const id of circadianSettingIds)$('circadian-setting-'+id).onchange=()=>{circadianSettingsDirty=true;$('circadian-settings-state').textContent='Unsaved changes'};
$('circadian-save-settings').onclick=async()=>{try{const nullableNumber=id=>$(id).value===''?null:+$(id).value;const body={enabled:$('circadian-setting-enabled').checked,curve:$('circadian-setting-curve').value,weather:$('circadian-setting-weather').checked,intervalSeconds:+$('circadian-setting-interval').value,cctMin:+$('circadian-setting-cct-min').value,cctMax:+$('circadian-setting-cct-max').value,extendCctBelowNative:$('circadian-setting-extend-below').checked,extendCctAboveNative:$('circadian-setting-extend-above').checked,intensityMin:+$('circadian-setting-intensity-min').value,intensityMax:+$('circadian-setting-intensity-max').value,latitude:nullableNumber('circadian-setting-latitude'),longitude:nullableNumber('circadian-setting-longitude')};circadian=await api('/dashboard/circadian/settings',{method:'POST',body:JSON.stringify(body)});circadianSettingsDirty=false;$('circadian-settings-state').textContent='Saved';renderCircadian();log('Saved circadian settings',body)}catch(error){$('circadian-settings-state').textContent='Save failed';log('ERROR: Save circadian settings',{error:error.message})}};
function rebuildTargets(){const previous=selected();const order=[...settings.fixtureOrder,...health.lights.map(x=>x.key).filter(x=>!settings.fixtureOrder.includes(x))];$('target').innerHTML='<option value="all">All fixtures</option>'+order.map(key=>'<option value="'+esc(key)+'">'+esc(fixtureName(key))+'</option>').join('')+(health.groups||[]).map(group=>'<option value="'+esc(group.id)+'">Group: '+esc(group.name)+'</option>').join('');if([...$('target').options].some(option=>option.value===previous))$('target').value=previous}
async function refreshMetadata(){health=await api('/health',{timeoutMs:8000});rebuildTargets()}
async function boot(){settings=await api('/dashboard/settings');document.title=settings.title;$('title').textContent=settings.title;$('setting-title').value=settings.title;$('setting-refresh').value=settings.refreshSeconds;$('setting-transition').value=settings.defaultTransitionSeconds;$('setting-order').value=settings.fixtureOrder.join(',');$('setting-labels').value=JSON.stringify(settings.fixtureLabels);for(const id of ['fade-seconds','cct-seconds'])$(id).value=settings.defaultTransitionSeconds;const circadianRefresh=refreshCircadian();try{await refreshMetadata();const effects=[...new Set(health.lights.flatMap(x=>x.capabilities.effects))];$('effect').innerHTML=effects.map(x=>'<option>'+esc(x)+'</option>').join('')}catch(error){$('connection').textContent='Disconnected';$('connection-dot').style.background='#ff6b6b';log('Metadata refresh failed',{error:error.message})}try{status=await api('/dashboard/status-cache',{timeoutMs:3000});renderStatus()}catch{}await Promise.allSettled([refreshStatus(),circadianRefresh]);setInterval(()=>{refreshMetadata().catch(error=>log('Metadata refresh failed',{error:error.message}));refreshStatus();refreshCircadian()},settings.refreshSeconds*1000)}
$('brightness').oninput=()=>{$('brightness-value').textContent=$('brightness').value+'%'};
document.querySelectorAll('[data-power]').forEach(button=>button.onclick=()=>act('Power '+button.dataset.power,()=>lightAction(button.dataset.power)));
$('set-brightness').onclick=()=>act('Set brightness',()=>lightAction('brightness',{value:+$('brightness').value}));
$('fade').onclick=()=>act('Fade',()=>api('/fade',{method:'POST',body:JSON.stringify({targets:targets(),brightness:+$('brightness').value,seconds:+$('fade-seconds').value})}));
const allTargetsSupport=capability=>targetKeys().every(key=>health.lights.find(light=>light.key===key)?.capabilities?.[capability]===true);
const cctArgs=()=>({kelvin:+$('kelvin').value,brightness:+$('cct-brightness').value,...(allTargetsSupport('gm_support')?{gm:+$('gm').value}:{})});
$('set-cct').onclick=()=>act('Set CCT',()=>lightAction('cct',cctArgs()));
$('transition-cct').onclick=()=>act('Transition CCT',()=>api('/transition',{method:'POST',body:JSON.stringify({targets:targets(),action:'cct',args:cctArgs(),seconds:+$('cct-seconds').value})}));
const hsiArgs=()=>({hue:+$('hue').value,saturation:+$('saturation').value,brightness:+$('hsi-brightness').value});
$('set-hsi').onclick=()=>act('Set HSI',()=>lightAction('hsi',hsiArgs()));
$('transition-hsi').onclick=()=>act('Transition HSI',()=>api('/transition',{method:'POST',body:JSON.stringify({targets:targets(),action:'hsi',args:hsiArgs(),seconds:+$('cct-seconds').value})}));
$('set-color').onclick=()=>act('Set color',()=>lightAction('color',{color:$('color').value,brightness:+$('hsi-brightness').value}));
const effectArgs=()=>{const name=$('effect').value,args={name,brightness:+$('effect-brightness').value,frequency:+$('effect-frequency').value};if(['lightning','faulty-bulb','pulsing'].includes(name))args.speed=+$('effect-speed').value;if(['tv','fire','fireworks','cop-car'].includes(name))args.palette=+$('effect-palette').value;else if(name==='party-lights')args.saturation=+$('effect-saturation').value;else if(['faulty-bulb','pulsing'].includes(name)&&$('effect-hsi').checked){args.hue=+$('effect-hue').value;args.saturation=+$('effect-saturation').value}else if(['paparazzi','lightning','faulty-bulb','pulsing','strobe','explosion'].includes(name)){args.kelvin=+$('effect-kelvin').value;if(allTargetsSupport('gm_support'))args.gm=+$('effect-gm').value}return args};
$('set-effect').onclick=()=>act('Apply effect',()=>lightAction('effect',effectArgs()));$('effect-animation').onclick=()=>act('Effect animation speed',()=>lightAction('effect-animation-speed',{value:+$('effect-speed').value}));$('trigger-effect').onclick=()=>act('Trigger effect',()=>lightAction('effect-trigger'));$('stop-effect').onclick=()=>act('Stop effect',()=>lightAction('effect-stop'));
$('set-fan').onclick=()=>act('Set fan',()=>api('/fans',{method:'POST',body:JSON.stringify({targets:targets(),mode:$('fan-mode').value,...($('fan-mode').value==='manual'?{rpm:+$('fan-rpm').value}:{})})}));$('fan-info').onclick=()=>act('Fan state',()=>api('/fans'));
const override=minutes=>api('/overrides',{method:'POST',body:JSON.stringify({targets:targets(),...(minutes===undefined?{}:{minutes})})});$('hold').onclick=()=>act('Hold automation',()=>override(+$('hold-minutes').value));$('resume').onclick=()=>act('Resume automation',()=>override(0));$('override-status').onclick=()=>act('Override status',()=>override());
const targetKeys=()=>selected()==='all'?health.lights.map(light=>light.key):((health.groups||[]).find(group=>group.id===selected())?.members||[selected()]);const advancedArgs=()=>JSON.parse($('advanced-args').value);$('advanced-run').onclick=()=>act('Advanced action',()=>lightAction($('advanced-action').value,advancedArgs()));$('advanced-batch').onclick=()=>act('Advanced batch',()=>api('/batch',{method:'POST',body:JSON.stringify({targets:targets(),action:$('advanced-action').value,args:advancedArgs()})}));$('advanced-broadcast').onclick=()=>act('Mesh broadcast',()=>api('/batch',{method:'POST',body:JSON.stringify({targets:targets(),action:$('advanced-action').value,args:advancedArgs(),broadcast:true})}));$('automatic-cct').onclick=()=>act('Automatic CCT',()=>Promise.all(targetKeys().map(key=>{const light=health.lights.find(item=>item.key===key);return api('/lights/'+encodeURIComponent(key)+'/auto-cct',{method:'POST',body:JSON.stringify({kelvin:+$('kelvin').value,brightness:+$('automatic-brightness').value,...(light?.capabilities?.gm_support?{gm:+$('gm').value}:{})})})})));$('product-info').onclick=()=>act('Product information',()=>Promise.all(targetKeys().map(key=>api('/lights/'+encodeURIComponent(key)+'/info'))));
const withMetadata=async operation=>{const result=await operation();await refreshMetadata();return result};const gid=()=>encodeURIComponent($('group-id').value);$('group-list').onclick=()=>act('Groups',()=>api($('group-id').value?'/groups/'+gid():'/groups'));$('group-create').onclick=()=>act('Create group',()=>withMetadata(()=>api('/groups',{method:'POST',body:JSON.stringify({name:$('group-name').value})})));$('group-rename').onclick=()=>act('Rename group',()=>withMetadata(()=>api('/groups/'+gid()+'/rename',{method:'POST',body:JSON.stringify({name:$('group-name').value})})));const member=remove=>api('/groups/'+gid()+'/members',{method:'POST',body:JSON.stringify({member:$('group-member').value,remove})});$('group-add').onclick=()=>act('Add group member',()=>withMetadata(()=>member(false)));$('group-remove').onclick=()=>act('Remove group member',()=>withMetadata(()=>member(true)));const native=action=>api('/groups/'+gid()+'/native',{method:'POST',body:JSON.stringify({action,...($('group-address').value?{address:Number($('group-address').value)}:{})})});$('group-native-enable').onclick=()=>act('Enable native group',()=>native('enable'));$('group-native-sync').onclick=()=>act('Sync native group',()=>native('sync'));$('group-native-disable').onclick=()=>act('Disable native group',()=>native('disable'));$('group-delete').onclick=()=>act('Delete group',()=>withMetadata(()=>api('/groups/'+gid(),{method:'DELETE'})));
const collection=()=>$('collection').value,key=()=>encodeURIComponent($('saved-key').value),base=()=>'/library/'+collection();$('saved-list').onclick=()=>act('List '+collection(),()=>api(base()));$('saved-show').onclick=()=>act('Show saved state',()=>api(base()+'/'+key()));$('saved-save').onclick=()=>act('Save state',()=>api(base(),{method:'POST',body:JSON.stringify({name:$('saved-key').value,keys:targets()})}));$('saved-update').onclick=()=>act('Update state',()=>api(base()+'/'+key(),{method:'POST',body:JSON.stringify({name:$('saved-key').value,keys:targets()})}));$('saved-recall').onclick=()=>act('Recall state',()=>api(base()+'/'+key()+'/recall',{method:'POST',body:JSON.stringify({...(collection()==='presets'&&selected()!=='all'?{target:selected()}:{}),...($('saved-seconds').value?{seconds:+$('saved-seconds').value}:{})})}));$('saved-delete').onclick=()=>act('Delete state',()=>api(base()+'/'+key(),{method:'DELETE'}));
const startProgram=body=>api('/programs',{method:'POST',body:JSON.stringify({...body,targets:targets()})});$('program-start').onclick=()=>act('Start timeline',()=>startProgram(JSON.parse($('program-json').value)));$('jobs-list').onclick=()=>act('Jobs',()=>api('/programs'));$('job-stop').onclick=()=>act('Stop job',()=>api('/programs/'+encodeURIComponent($('job-id').value),{method:'DELETE'}));$('audio-start').onclick=()=>act('Start audio file',()=>startProgram({kind:'audio',duration:+$('media-seconds').value,maxBrightness:+$('media-max').value,gain:3,restore:true,source:{kind:'audio-file',file:$('audio-path').value}}));$('image-start').onclick=()=>act('Start image file',()=>startProgram({kind:'picker',duration:+$('media-seconds').value,maxBrightness:+$('media-max').value,restore:true,source:{kind:'image-file',file:$('image-path').value}}));
async function stopCapture(){if(!capture)return;clearInterval(capture.timer);capture.stream.getTracks().forEach(x=>x.stop());if(capture.audio)await capture.audio.close();await api('/programs/'+capture.job,{method:'DELETE'}).catch(()=>{});$('camera-preview').classList.remove('active');capture=undefined;log('Live capture stopped')}
async function startCamera(){await stopCapture();const stream=await navigator.mediaDevices.getUserMedia({video:true});const job=await startProgram({kind:'picker',duration:+$('media-seconds').value,maxBrightness:+$('media-max').value,restore:true,source:{kind:'samples',media:'image'}});const video=$('camera-preview'),canvas=$('camera-canvas');video.srcObject=stream;await video.play();video.classList.add('active');const ctx=canvas.getContext('2d',{willReadFrequently:true});const timer=setInterval(async()=>{canvas.width=64;canvas.height=36;ctx.drawImage(video,0,0,64,36);const data=ctx.getImageData(0,0,64,36).data;let r=0,g=0,b=0,n=0;for(let i=0;i<data.length;i+=16){r+=data[i];g+=data[i+1];b+=data[i+2];n++}await api('/programs/'+job.id+'/sample',{method:'POST',body:JSON.stringify({rgb:[r/n,g/n,b/n]})}).catch(error=>log('Camera sample failed',{error:error.message}))},500);capture={stream,job:job.id,timer}}
async function startMicrophone(){await stopCapture();const stream=await navigator.mediaDevices.getUserMedia({audio:true});const audio=new AudioContext(),source=audio.createMediaStreamSource(stream),analyser=audio.createAnalyser();analyser.fftSize=1024;source.connect(analyser);const samples=new Float32Array(analyser.fftSize);const job=await startProgram({kind:'audio',duration:+$('media-seconds').value,maxBrightness:+$('media-max').value,gain:3,restore:true,source:{kind:'samples',media:'audio'}});const timer=setInterval(async()=>{analyser.getFloatTimeDomainData(samples);let total=0;for(const value of samples)total+=value*value;await api('/programs/'+job.id+'/sample',{method:'POST',body:JSON.stringify({rms:Math.sqrt(total/samples.length)})}).catch(error=>log('Microphone sample failed',{error:error.message}))},250);capture={stream,job:job.id,timer,audio}}
$('camera-start').onclick=()=>act('Start browser camera',startCamera);$('microphone-start').onclick=()=>act('Start browser microphone',startMicrophone);$('capture-stop').onclick=()=>act('Stop live capture',stopCapture);
$('mesh-inspect').onclick=()=>act('Inspect mesh',()=>api('/mesh/inspect'));$('mesh-discover').onclick=()=>act('Discover mesh devices',()=>api('/mesh/discover'));const database=()=>$('database-path').value;$('desktop-preview').onclick=()=>act('Preview Desktop import',()=>api('/desktop/import',{method:'POST',body:JSON.stringify({database:database()})}));$('desktop-apply').onclick=()=>act('Apply Desktop import',()=>api('/desktop/import',{method:'POST',body:JSON.stringify({database:database(),apply:true})}));$('mesh-import-keys').onclick=()=>act('Import Device Keys',()=>api('/mesh/keys',{method:'POST',body:JSON.stringify({database:database()})}));
$('save-settings').onclick=()=>act('Save dashboard settings',async()=>{settings=await api('/dashboard/settings',{method:'POST',body:JSON.stringify({title:$('setting-title').value,refreshSeconds:+$('setting-refresh').value,defaultTransitionSeconds:+$('setting-transition').value,fixtureOrder:$('setting-order').value.split(',').map(value=>value.trim()).filter(Boolean),fixtureLabels:JSON.parse($('setting-labels').value)})});$('title').textContent=settings.title;rebuildTargets();return settings});$('refresh').onclick=refreshStatus;$('clear-log').onclick=()=>{$('log').textContent=''};boot().catch(error=>log('Dashboard failed to start',{error:error.message}));`;
