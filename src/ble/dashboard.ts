import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { MaxLuxCalibration } from '../config.js';
import { interpolateMaxLux } from '../daylightSimulation/mathUtil.js';
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
    estimatedLux: z.record(z.number().nonnegative().nullable()).default({}),
  })
  .strict();

export type DashboardSettings = z.infer<typeof DashboardSettingsSchema>;
export type DashboardStatus = z.infer<typeof DashboardStatusSchema>;

export function estimateLux(calibration: MaxLuxCalibration | undefined, state: FixtureState): number | null {
  if (state.sleep) return 0;
  if (state.mode !== 'cct' || state.cct === undefined || calibration === undefined) return null;
  const fullOutput = typeof calibration === 'number' ? calibration : interpolateMaxLux(state.cct, calibration);
  return Math.round((fullOutput * state.intensity) / 1000);
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

export const dashboardCss = `:root{color-scheme:dark;--bg:#101312;--panel:#191e1c;--line:#303934;--text:#eef5f0;--muted:#9ca9a1;--green:#79f2a7;--amber:#ffbb55;--red:#ff6b6b;font:14px/1.35 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 15% -10%,#284032 0,transparent 28rem),var(--bg);color:var(--text)}header,nav,main{max-width:1500px;margin:auto}header{display:flex;justify-content:space-between;align-items:center;padding:16px 20px 9px}h1{font-size:clamp(1.7rem,3vw,2.8rem);line-height:1;margin:.1rem 0}.eyebrow{color:var(--green);font-size:.75rem;font-weight:800;letter-spacing:.16em;margin:0}.connection{display:grid;grid-template-columns:auto auto;gap:1px 7px;align-items:center}.connection small{grid-column:2;color:var(--muted)}#connection-dot{width:10px;height:10px;border-radius:50%;background:var(--amber);box-shadow:0 0 12px currentColor}nav{position:sticky;top:0;z-index:4;display:flex;gap:9px;align-items:end;padding:8px 20px;background:#101312ed;backdrop-filter:blur(14px);border-block:1px solid var(--line)}nav label{display:flex;align-items:center;gap:7px;margin:0}nav select{min-width:180px}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:12px 20px 36px}section{background:linear-gradient(145deg,#1b211e,#151917);border:1px solid var(--line);border-radius:12px;padding:13px;box-shadow:0 10px 28px #0003}.wide{grid-column:1/-1}h2{margin:0 0 9px;font-size:1.05rem}.section-head{display:flex;justify-content:space-between;gap:10px;align-items:center}.section-head span,label{color:var(--muted)}label{display:grid;gap:3px;margin:7px 0}input,select,textarea,button,a{font:inherit}input,select,textarea{width:100%;border:1px solid var(--line);border-radius:7px;padding:6px 8px;background:#0e1210;color:var(--text)}input[type=range]{padding:0;accent-color:var(--green)}textarea{resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}button,a{border:1px solid #46534b;border-radius:7px;padding:6px 9px;background:#263029;color:var(--text);font-weight:700;text-decoration:none;cursor:pointer}button:hover,a:hover{border-color:var(--green);color:var(--green)}button:active{transform:translateY(1px)}.button-row{display:flex;gap:6px;flex-wrap:wrap;align-items:end;margin-top:8px}.button-row label{margin:0;min-width:105px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.grid label{margin:0}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:8px}.card{border:1px solid var(--line);background:#101512;border-radius:10px;padding:11px}.card-head{display:flex;justify-content:space-between;align-items:start;gap:8px}.card h3{margin:0 0 2px}.card p{margin:2px 0;color:var(--muted)}.card .on{color:var(--green)}.card .off{color:var(--muted)}.card-controls{display:grid;gap:5px;margin-top:8px}.card-controls label{grid-template-columns:76px 1fr 48px;align-items:center;margin:0}.card-controls output{text-align:right;color:var(--text);font-variant-numeric:tabular-nums}.card-controls input{min-width:0}pre{max-height:300px;overflow:auto;background:#090c0a;border-radius:8px;padding:10px;white-space:pre-wrap;word-break:break-word;color:#cce7d6}video{display:none;max-width:320px;margin-top:8px;border-radius:8px}video.active{display:block}@media(max-width:1050px){main{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:720px){header{align-items:flex-start;gap:12px}.connection{margin-top:6px}main{grid-template-columns:1fr}.wide{grid-column:auto}.grid{grid-template-columns:1fr 1fr}nav{align-items:center;flex-wrap:wrap}}@media(max-width:520px){header{display:block}.grid{grid-template-columns:1fr}.button-row>*{flex:1 1 auto}}`;

export const dashboardJs = String.raw`const $=id=>document.getElementById(id);const esc=value=>String(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));let health,settings,status,capture;
const log=(label,value)=>{$('log').textContent=new Date().toLocaleTimeString()+' '+label+'\n'+(value===undefined?'':JSON.stringify(value,null,2))+'\n\n'+$('log').textContent};
async function api(path,options={}){const response=await fetch(path,{headers:{'content-type':'application/json'},...options});const data=await response.json();if(!response.ok||data.ok===false)throw new Error(data.error||response.statusText);return data.result??data.data??data}
const selected=()=>$('target').value;const targets=()=>selected()==='all'?'all':[selected()];
async function lightAction(action,args={}){return selected()==='all'?api('/batch',{method:'POST',body:JSON.stringify({targets:'all',action,args})}):api('/lights/'+encodeURIComponent(selected())+'/'+action,{method:'POST',body:JSON.stringify(args)})}
async function act(label,fn){try{const value=await fn();log(label,value);await refreshStatus()}catch(error){log('ERROR: '+label,{error:error.message})}}
function fixtureName(key){return settings?.fixtureLabels?.[key]||health?.lights?.find(light=>light.key===key)?.name||key}
function interpolateLux(calibration,kelvin){if(typeof calibration==='number')return calibration;const points=Object.entries(calibration||{}).map(([cct,lux])=>({cct:+cct,lux:+lux})).filter(point=>Number.isFinite(point.cct)&&Number.isFinite(point.lux)).sort((a,b)=>a.cct-b.cct);if(!points.length)return null;if(kelvin<=points[0].cct)return points[0].lux;if(kelvin>=points.at(-1).cct)return points.at(-1).lux;for(let index=0;index<points.length-1;index++){const left=points[index],right=points[index+1];if(kelvin>=left.cct&&kelvin<=right.cct)return left.lux+(kelvin-left.cct)*(right.lux-left.lux)/(right.cct-left.cct)}return null}
function cardLux(light,state,kelvin,brightness){if(state?.sleep)return 0;if(state?.mode!=='cct'||!light.luxCalibration)return null;const full=interpolateLux(light.luxCalibration,kelvin);return full===null?null:Math.round(full*brightness/100)}
function luxLabel(value){return value===null?'Est. lux —':'Est. '+value.toLocaleString()+' lx'}
function renderStatus(){const root=$('fixture-cards');root.textContent='';for(const light of health?.lights||[]){const state=status?.lighting?.[light.key];const fan=status?.fans?.[light.key];const brightness=state?state.intensity/10:0;const kelvin=state?.cct??Math.max(light.capabilities.cct_min,Math.min(light.capabilities.cct_max,3200));const lux=status?.estimatedLux?.[light.key]??cardLux(light,state,kelvin,brightness);const card=document.createElement('article');card.className='card';const details=state?state.mode==='cct'?(state.gm!==undefined?'G/M '+state.gm:'CCT'):state.mode==='hsi'?'H '+state.hue+'° S '+state.sat+'%':state.effect+' · F'+state.frequency:'No live readback';card.innerHTML='<div class="card-head"><div><h3>'+esc(fixtureName(light.key))+'</h3><p>'+esc(light.model)+' · '+esc(light.key)+'</p></div><button data-card-power>'+esc(state?.sleep?'Turn on':'Turn off')+'</button></div><p class="'+(state?.sleep?'off':'on')+'">'+(state?.sleep?'OFF':'ON')+' · '+brightness+'% · '+kelvin+'K · '+esc(details)+'</p><p><strong data-card-lux>'+esc(luxLabel(lux))+'</strong> · Fan '+esc(fan?.modeName??'unknown')+' · '+esc(fan?.speed??'—')+' RPM · '+esc(fan?.temperature??'—')+'°</p><div class="card-controls"><label>Brightness <input data-card-brightness type="range" min="0" max="100" step="1" value="'+brightness+'"><output data-card-brightness-output>'+brightness+'%</output></label><label>Kelvin <input data-card-kelvin type="range" min="'+light.capabilities.cct_min+'" max="'+light.capabilities.cct_max+'" step="'+light.capabilities.cct_step+'" value="'+kelvin+'"><output data-card-kelvin-output>'+kelvin+'K</output></label></div>';const brightnessInput=card.querySelector('[data-card-brightness]'),brightnessOutput=card.querySelector('[data-card-brightness-output]'),kelvinInput=card.querySelector('[data-card-kelvin]'),kelvinOutput=card.querySelector('[data-card-kelvin-output]'),luxOutput=card.querySelector('[data-card-lux]');const updateEstimate=()=>{luxOutput.textContent=luxLabel(cardLux(light,state,+kelvinInput.value,+brightnessInput.value))};brightnessInput.oninput=()=>{brightnessOutput.value=brightnessInput.value+'%';updateEstimate()};brightnessInput.onchange=()=>act('Set '+fixtureName(light.key)+' brightness',()=>api('/lights/'+encodeURIComponent(light.key)+'/brightness',{method:'POST',body:JSON.stringify({value:+brightnessInput.value})}));kelvinInput.oninput=()=>{kelvinOutput.value=kelvinInput.value+'K';updateEstimate()};kelvinInput.onchange=()=>act('Set '+fixtureName(light.key)+' Kelvin',()=>api('/lights/'+encodeURIComponent(light.key)+'/cct',{method:'POST',body:JSON.stringify({kelvin:+kelvinInput.value})}));card.querySelector('[data-card-power]').onclick=()=>act((state?.sleep?'Turn on ':'Turn off ')+fixtureName(light.key),()=>api('/lights/'+encodeURIComponent(light.key)+'/'+(state?.sleep?'on':'off'),{method:'POST',body:'{}'}));root.append(card)}$('updated').textContent=status?'Updated '+new Date(status.updatedAt).toLocaleTimeString():'No cached state'}
async function refreshStatus(){try{status=await api('/dashboard/status');$('connection').textContent='Connected';$('connection-dot').style.background='#79f2a7';renderStatus()}catch(error){$('connection').textContent='Disconnected';$('connection-dot').style.background='#ff6b6b';log('Status refresh failed',{error:error.message})}}
function rebuildTargets(){const previous=selected();const order=[...settings.fixtureOrder,...health.lights.map(x=>x.key).filter(x=>!settings.fixtureOrder.includes(x))];$('target').innerHTML='<option value="all">All fixtures</option>'+order.map(key=>'<option value="'+esc(key)+'">'+esc(fixtureName(key))+'</option>').join('')+(health.groups||[]).map(group=>'<option value="'+esc(group.id)+'">Group: '+esc(group.name)+'</option>').join('');if([...$('target').options].some(option=>option.value===previous))$('target').value=previous}
async function refreshMetadata(){health=await api('/health');rebuildTargets()}
async function boot(){settings=await api('/dashboard/settings');document.title=settings.title;$('title').textContent=settings.title;$('setting-title').value=settings.title;$('setting-refresh').value=settings.refreshSeconds;$('setting-transition').value=settings.defaultTransitionSeconds;$('setting-order').value=settings.fixtureOrder.join(',');$('setting-labels').value=JSON.stringify(settings.fixtureLabels);for(const id of ['fade-seconds','cct-seconds'])$(id).value=settings.defaultTransitionSeconds;await refreshMetadata();const effects=[...new Set(health.lights.flatMap(x=>x.capabilities.effects))];$('effect').innerHTML=effects.map(x=>'<option>'+esc(x)+'</option>').join('');try{status=await api('/dashboard/status-cache');renderStatus()}catch{}await refreshStatus();setInterval(refreshStatus,settings.refreshSeconds*1000)}
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
