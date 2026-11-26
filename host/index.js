/**
 * Host half of the Kylin desktop notifier bundle.
 *
 * Watches durable session events and asks a small Python/DBus bridge process to
 * raise a freedesktop notification (the same service Kylin's notification
 * daemon implements). Notifications carry an authenticated URL with a
 * `#session=<id>` deep link; clicking one focuses the conversation in the
 * client-side half of this bundle.
 *
 * This plugin never imports @deepseek-ai/* runtime packages: it only uses the
 * Cordis context services declared in `inject`.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { existsSync, realpathSync, readdirSync, appendFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import * as os from 'node:os';
import { sep } from 'node:path';

const name = 'kylin-notifier';

const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE_SCRIPT = resolve(HERE, 'bridge', 'notify_bridge.py');
// Self-drawn macOS-style card. Same stdin protocol as the DBus bridge, so the
// two backends are interchangeable and neither one knows about the other.
const TOAST_SCRIPT = resolve(HERE, 'bridge', 'toast_window.py');

// The bundle lives outside the profile, so a plain `import` of a host package
// resolves relative to this directory and fails.
//
// The DSH web service starts with `DSH_HOME` unset (its launcher unsets it), so
// the profile cannot be discovered from the environment alone: fall back to
// `$HOME/.dsh`, which is where the service's own launcher puts it, and keep the
// Host kernel's own install as a last resort.
function dshHomeCandidates() {
  const homes = [];
  const add = (value) => {
    // An empty string is not "unset": the service can be started with HOME=""
    // and then os.homedir() returns "" too, so guard on truthiness of the
    // trimmed value instead of mere presence.
    if (typeof value === 'string' && value.trim() !== '') homes.push(value);
  };
  add(process.env.DSH_HOME);
  if (process.env.HOME && process.env.HOME.trim() !== '') {
    add(resolve(process.env.HOME, '.dsh'));
  } else {
    // HOME is unset or blank, so ask the OS directly; homedir() falls back to
    // the passwd entry only when HOME is absent or empty, which is exactly the
    // case we are repairing here.
    try {
      const home = homedir();
      if (typeof home === 'string' && home.trim() !== '') add(resolve(home, '.dsh'));
    } catch { /* no home dir */ }
  }
  return [...new Set(homes)];
}

function loadSchemastery() {
  // 1. The loader's own resolution context: works whenever the Host kernel
  //    itself depends on schemastery.
  try {
    return createRequire(import.meta.url)('@deepseek-ai/schemastery');
  } catch { /* fall through to the profile below */ }
  // 2. This bundle's location inside the active profile. The link is
  //    <profile>/node_modules/@local/kylin-notifier, so probing upward from the
  //    real path lands on the profile's node_modules.
  const candidates = [];
  try {
    const real = realpathSync(HERE);
    const at = real.lastIndexOf(`${sep}node_modules${sep}`);
    if (at > 0) candidates.push(real.slice(0, at));
  } catch { /* keep the home fallbacks */ }
  // 3. Every profile under each plausible DSH home. `DSH_HOME` is unset for the
  //    installed service, so `$HOME/.dsh` carries this case.
  for (const home of dshHomeCandidates()) {
    try {
      for (const entry of readdirSync(resolve(home, 'profiles'), { withFileTypes: true })) {
        if (entry.isDirectory()) candidates.push(resolve(home, 'profiles', entry.name));
      }
    } catch { /* this home has no profiles directory */ }
  }
  // 4. The Host kernel itself. This bundle is only ever loaded by the DSH
  //    kernel, so the kernel's own module tree is guaranteed to carry
  //    schemastery (the loader validates every plugin's Config with it).
  //    Resolve the kernel through the process's own main module rather than
  //    through $HOME, which the service may leave blank.
  const hostRoots = [];
  const addHostRoot = (value) => {
    if (typeof value !== 'string' || value === '') return;
    hostRoots.push(value);
  };
  try {
    addHostRoot(dirname(dirname(realpathSync(process.argv[1]))));
  } catch { /* argv[1] may be absent */ }
  addHostRoot(dirname(dirname(realpathSync(process.execPath))));
  //    The npm global tree is the conventional install the launcher wires up.
  for (const guess of ['/opt/npm-global/lib/node_modules/@deepseek-ai/dsh',
    '/usr/lib/node_modules/@deepseek-ai/dsh',
    '/usr/local/lib/node_modules/@deepseek-ai/dsh']) {
    try { addHostRoot(realpathSync(guess)); } catch { /* not installed there */ }
  }
  candidates.push(...hostRoots);
  // 5. Probe every candidate root, plus the profile's own directory.
  for (const base of candidates) {
    try {
      return createRequire(resolve(base, 'noop.js'))('@deepseek-ai/schemastery');
    } catch { /* keep probing */ }
  }
  return undefined;
}

const schemaLib = loadSchemastery();
const schema = schemaLib && typeof schemaLib.object === 'function' ? schemaLib : undefined;

const DEFAULT_APP_NAME = 'DeepSeek Harness';
const DEFAULT_ICON = 'dialog-information';
// Blank labels are intentional: UKUI's notification already ships a close
// control, and the open action is drawn as an icon-only arrow button.
const DEFAULT_ACTION_LABEL = '↗';
const DEFAULT_DISMISS_LABEL = '';
const DEFAULT_TIMEOUT = 10000;
// The desktop's notification daemon force-collapses popups after ~6 s and
// strips action labels when it moves them into the sidebar, so the default is
// our own card, drawn by bridge/toast_window.py.
const DEFAULT_RENDERER = 'toast';
const DEFAULT_THEME = 'light';
const DEFAULT_POSITION = 'top-center';
const DEFAULT_ANIMATION = 'elastic';
const DEFAULT_SOUND_NAME = 'glass';
const DEFAULT_MAX_PER_SESSION = 3;
const DEFAULT_MIN_INTERVAL = 0;
const DEFAULT_WEB_APP_NAME = 'webApp';
/** JSON endpoint the client half reads and writes settings through. */
const SETTINGS_PATH = '/api/kylin-notifier/settings';

/**
 * Every user-facing field is declared here so the Plugins page can render a
 * settings form for this entry automatically. Defaults double as the values
 * used when the plugin runs without the settings service.
 */
function buildConfig(rawDefaults) {
  if (!schema) return undefined;
  return schema.object({
    enabled: schema.boolean()
      .description('总开关：关闭后不再弹出任何通知。')
      .default(rawDefaults.enabled).volatile(),
    notifyOnComplete: schema.boolean()
      .description('对话结束（完成、中止或出错）时弹窗提醒。')
      .default(rawDefaults.notifyOnComplete).volatile(),
    notifyOnApproval: schema.boolean()
      .description('需要你确认操作（审批）时弹窗提醒。')
      .default(rawDefaults.notifyOnApproval).volatile(),
    notifyOnQuestion: schema.boolean()
      .description('需要你回答问题（提问）时弹窗提醒。')
      .default(rawDefaults.notifyOnQuestion).volatile(),
    maxPerSession: schema.number()
      .step(1)
      .min(1)
      .max(50)
      .description('同一条对话最多同时保留几条通知，超出的自动关闭最早那条。')
      .default(rawDefaults.maxPerSession).volatile(),
    minIntervalSeconds: schema.number()
      .step(1)
      .min(0)
      .max(3600)
      .description('弹窗频率下限（秒）：同一对话在这么短时间内重复结束只提醒一次，0 表示不限。')
      .default(rawDefaults.minIntervalSeconds).volatile(),
    appName: schema.string()
      .description('通知第一行显示的来源名称。')
      .default(rawDefaults.appName).volatile(),
    timeoutMs: schema.number()
      .step(500)
      .min(1000)
      .max(120000)
      .description('弹窗停留时间（毫秒），0 表示由桌面环境决定。')
      .default(rawDefaults.timeoutMs).volatile(),
    sound: schema.boolean()
      .description('弹窗时播放提示音。')
      .default(rawDefaults.sound).volatile(),
    renderer: schema.string()
      .description('通知渲染方式：toast = 自绘 macOS 风格弹窗（不经过系统通知服务）；native = 交给桌面系统的通知中心。')
      .default(rawDefaults.renderer).volatile(),
    theme: schema.string()
      .description('自绘弹窗的配色：light = 始终浅色；dark = 始终深色；auto = 跟随系统深浅色。')
      .default(rawDefaults.theme).volatile(),
    position: schema.string()
      .description('自绘弹窗的弹出位置：top-center = 顶部居中；top-right = 右上角横幅；bottom-right = 右下角。')
      .default(rawDefaults.position).volatile(),
    animation: schema.string()
      .description('自绘弹窗的入场动效：elastic = 弹性回弹；crisp = 干脆滑入；soft = 柔和淡入。')
      .default(rawDefaults.animation).volatile(),
    soundName: schema.string()
      .description('自绘弹窗的提示音：macOS / iOS / 微信 共 18 种合成音，none 表示静音。')
      .default(rawDefaults.soundName).volatile(),
    icon: schema.string()
      .description('通知图标名（系统图标主题里的名字）。')
      .default(rawDefaults.icon).volatile(),
    actionIcon: schema.boolean()
      .description('把「打开对话」显示成图标按钮。')
      .default(rawDefaults.actionIcon).volatile(),
    actionLabel: schema.string()
      .description('弹窗上「打开对话」按钮的文字；留空则只显示箭头图标。')
      .default(rawDefaults.actionLabel).volatile(),
    dismissLabel: schema.string()
      .description('弹窗上「关闭」按钮的文字；留空则不添加关闭按钮（通知面板自带关闭）。只关掉当前这一条提醒，不影响后续提醒。')
      .default(rawDefaults.dismissLabel).volatile(),
    bridgePath: schema.string()
      .description('通知桥接脚本路径（通常不用改）。')
      .default(rawDefaults.bridgePath).volatile(),
    pythonPath: schema.string()
      .description('运行桥接脚本的 Python 解释器。')
      .default(rawDefaults.pythonPath).volatile(),
    webAppService: schema.string()
      .description('提供 Web 地址的 Cordis 服务名（通常不用改）。')
      .default(rawDefaults.webAppService).volatile(),
    debug: schema.boolean()
      .description('在日志中输出通知发送细节，用于排查“为什么没弹窗”。')
      .default(rawDefaults.debug).volatile(),
  });
}

const DEFAULTS = Object.freeze({
  enabled: true,
  notifyOnComplete: true,
  notifyOnApproval: true,
  notifyOnQuestion: true,
  maxPerSession: DEFAULT_MAX_PER_SESSION,
  minIntervalSeconds: DEFAULT_MIN_INTERVAL,
  renderer: DEFAULT_RENDERER,
  theme: DEFAULT_THEME,
  position: DEFAULT_POSITION,
  animation: DEFAULT_ANIMATION,
  bridgePath: BRIDGE_SCRIPT,
  pythonPath: 'python3',
  appName: DEFAULT_APP_NAME,
  icon: DEFAULT_ICON,
  actionIcon: true,
  actionLabel: DEFAULT_ACTION_LABEL,
  dismissLabel: DEFAULT_DISMISS_LABEL,
  timeoutMs: DEFAULT_TIMEOUT,
  sound: false,
  soundName: DEFAULT_SOUND_NAME,
  webAppService: DEFAULT_WEB_APP_NAME,
  debug: false,
});

const Config = buildConfig(DEFAULTS);

const BOOL_KEYS = ['enabled', 'notifyOnComplete', 'notifyOnApproval', 'notifyOnQuestion', 'sound', 'debug', 'actionIcon'];
const STRING_KEYS = ['renderer', 'theme', 'position', 'animation', 'soundName', 'bridgePath', 'pythonPath', 'appName', 'icon', 'actionLabel', 'dismissLabel', 'webAppService'];
const INT_KEYS = {
  maxPerSession: [1, 50, DEFAULT_MAX_PER_SESSION],
  minIntervalSeconds: [0, 3600, DEFAULT_MIN_INTERVAL],
  timeoutMs: [1000, 120000, DEFAULT_TIMEOUT],
};

/**
 * Loader hands volatile fields over as immutable references whose get() is the
 * live value; a settings edit updates the reference in place, so reading
 * through it here is what makes the form take effect without a restart.
 */
function unref(value) {
  return value && typeof value === 'object' && typeof value.get === 'function' && typeof value.set !== 'function'
    ? value.get()
    : value;
}

/** Merge user config over defaults with per-field type coercion. */
function normalizeConfig(input) {
  const raw = input && typeof input === 'object' && unref(input) !== input ? unref(input) : input;
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { ...DEFAULTS };
  for (const key of BOOL_KEYS) {
    const value = unref(src[key]);
    if (typeof value === 'boolean') out[key] = value;
  }
  for (const key of STRING_KEYS) {
    const value = unref(src[key]);
    if (typeof value === 'string' && value) out[key] = value;
  }
  for (const [key, [min, max, fallback]] of Object.entries(INT_KEYS)) {
    const value = unref(src[key]);
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = Math.min(max, Math.max(min, Math.trunc(value)));
    } else {
      out[key] = fallback;
    }
  }
  return out;
}

const inject = ['subprocess'];

/** Extract the first textual block from a content array. */
function firstText(content) {
  if (!Array.isArray(content)) return '';
  for (const block of content) {
    if (block && typeof block === 'object') {
      if (typeof block.text === 'string' && block.text) return block.text;
      if (typeof block.content === 'string' && block.content) return block.content;
    }
  }
  return '';
}

function clip(text, limit) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > limit ? s.slice(0, Math.max(0, limit - 1)) + '…' : s;
}

/**
 * Turn the authenticated web URL into a deep link. The auth token is a query
 * parameter consumed (and stripped) by the web app's authorizeIndex redirect,
 * so the session id must travel in the URL hash, which survives the redirect.
 */
function withSessionHash(url, sessionId) {
  try {
    const u = new URL(url);
    u.hash = `session=${encodeURIComponent(sessionId)}`;
    return u.href;
  } catch {
    const base = String(url || '').split('#')[0];
    return `${base}#session=${encodeURIComponent(sessionId)}`;
  }
}

/**
 * Manage one long-lived bridge process. Commands are newline-delimited JSON on
 * stdin; stdout is reserved for ping replies, stderr for diagnostics only.
 */
class BridgeClient {
  constructor(ctx, config) {
    this.ctx = ctx;
    this.config = config;
    this.handle = undefined;
    this.pending = [];
    this.starting = undefined;
    this.stderrTail = '';
    this.lifetime = new AbortController();
    this.closed = false;
    // Identity of the child, so a stale client can be reaped by the registry.
    this.childPid = undefined;
    this.exited = false;
  }

  log(...args) {
    if (!this.config.debug) return;
    try { this.ctx.logger.info('[kylin-notifier]', ...args); } catch { /* logger optional */ }
  }

  async ensure() {
    // `handle.done` is a Promise, so `!this.handle.done` is always false: the
    // old guard never fired and every notification respawned a renderer,
    // leaving the previous one alive forever. Track liveness explicitly.
    if (this.handle && !this.exited) return this.handle;
    if (this.starting) return this.starting;
    this.starting = this._start().finally(() => { this.starting = undefined; });
    return this.starting;
  }

  /**
   * Environment for the renderer process.
   *
   * dsh-web runs from systemd, which has no DISPLAY. GTK does not fail loudly
   * in that case: it falls back to a headless display and every window simply
   * never maps, so the card is created and drawn but never seen. Fill the
   * session's display variables in when they are missing.
   */
  desktopEnv() {
    const env = {};
    if (!process.env.DISPLAY) {
      // :0 is the seat's primary X display on Kylin/UKUI desktops.
      env.DISPLAY = ':0';
    }
    if (!process.env.XAUTHORITY) {
      const auth = `${process.env.XDG_RUNTIME_DIR || '/run/user/' + process.getuid()}/gdm/Xauthority`;
      if (existsSync(auth)) env.XAUTHORITY = auth;
      else {
        const home = `${process.env.HOME || ''}/.Xauthority`;
        if (home && existsSync(home)) env.XAUTHORITY = home;
      }
    }
    if (!process.env.XDG_RUNTIME_DIR) {
      env.XDG_RUNTIME_DIR = `/run/user/${process.getuid()}`;
    }
    return env;
  }

  /** The script this client runs: the self-drawn card, or the DBus bridge. */
  resolveScript() {
    if (this.config.renderer === 'native') return { path: this.config.bridgePath, kind: 'native' };
    return { path: TOAST_SCRIPT, kind: 'toast' };
  }

  async _start() {
    const script = this.resolveScript();
    const path = script.path;
    if (!existsSync(path)) {
      this.log('bridge script not found:', path);
      return undefined;
    }
    let handle;
    try {
      handle = await this.ctx.subprocess.spawn({
        argv: [this.config.pythonPath, path],
        cwd: dirname(path),
        stdio: {
          stdin: 'pipe',
          // stdout is reserved for ping replies (unused) — collect and bound it.
          stdout: { maxBytes: 4096 },
          // stderr is a raw pipe so we can keep a bounded diagnostic tail. The
          // bridge is quiet here, so there is no backpressure risk.
          stderr: 'pipe',
        },
        graceMs: 3000,
        signal: this.lifetime.signal,
        env: { ...this.desktopEnv(), ...(this.config.debug ? { KYLIN_TOAST_LOG: '/tmp/kylin-toast.log' } : {}) },
      });
    } catch (err) {
      this.log('bridge spawn failed:', String(err));
      return undefined;
    }
    this.handle = handle;
    this.kind = script.kind;
    this.childPid = handle.pid;

    // Drain stderr into a bounded tail for diagnostics; never treat it as a
    // command channel.
    if (handle.stderr) {
      handle.stderr.setEncoding('utf8');
      handle.stderr.on('data', (chunk) => {
        this.stderrTail = (this.stderrTail + chunk).slice(-2048);
      });
    }

    // If the bridge dies, clear the handle so the next notification respawns
    // it, and flush any queued writes harmlessly.
    handle.done.then(
      (outcome) => {
        this.log('bridge exited', JSON.stringify(outcome), this.stderrTail);
        this.exited = true;
        if (this.handle === handle) this.handle = undefined;
        this.pending.length = 0;
      },
      (err) => {
        this.log('bridge failed', String(err), this.stderrTail);
        if (this.handle === handle) this.handle = undefined;
        this.pending.length = 0;
      },
    );
    return handle;
  }

  write(obj) {
    if (this.closed) return;
    const line = JSON.stringify(obj) + '\n';
    const handle = this.handle;
    if (handle && handle.stdin && !this.lifetime.signal.aborted) {
      try {
        handle.stdin.write(line);
        return;
      } catch {
        // fall through to queue
      }
    }
    this.pending.push(line);
    if (this.pending.length > 64) this.pending.shift();
  }

  flushPending() {
    const handle = this.handle;
    if (!handle || !handle.stdin) return;
    const queued = this.pending.splice(0);
    for (const line of queued) {
      try { handle.stdin.write(line); } catch { /* dropped on shutdown */ }
    }
  }

  send(obj) {
    this.write(obj);
    // Queue immediately before the process is ready; flush once spawned.
    this.ensure().then((handle) => {
      if (handle) this.flushPending();
    });
  }

  notify(command) {
    this.send({ op: 'notify', ...command });
  }

  // Withdraw a notification we sent earlier (by its replace key), so the
  // popup does not ask for something that has already been answered.
  close(key) {
    if (!key) return;
    this.send({ op: 'close', replaceKey: key });
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.lifetime.abort();
    const handle = this.handle;
    if (handle) {
      try { handle.terminate(); } catch { /* best effort */ }
    }
    this.handle = undefined;
    this.pending.length = 0;
  }
}

/** Coerce one raw field to the type the form expects, or drop it. */
function coerceField(key, value) {
  if (BOOL_KEYS.includes(key)) return typeof value === 'boolean' ? value : undefined;
  if (STRING_KEYS.includes(key)) return typeof value === 'string' && value ? value : undefined;
  const range = INT_KEYS[key];
  if (range) {
    const n = typeof value === 'string' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
    return Math.min(range[1], Math.max(range[0], Math.trunc(n)));
  }
  return undefined;
}

/**
 * Write one field back to the plugin's own profile entry.
 *
 * The settings page writes through the settings service, but a short inline
 * control (the per-card switches) has no form model to go through, so this is
 * the plugin's own path: it edits the same Loader entry through configEditor,
 * with the same validation and the same live-apply behaviour.
 */
async function persistSetting(ctx, key, value) {
  const editor = typeof ctx.get === 'function' ? ctx.get('configEditor') : undefined;
  if (!editor || typeof editor.edit !== 'function') throw new Error('configEditor service unavailable');
  const entryId = ctx.fiber && ctx.fiber.entry && ctx.fiber.entry.options ? ctx.fiber.entry.options.id : undefined;
  const entry = entryId ? editor.entries().find((row) => row.options && row.options.id === entryId) : undefined;
  if (!entry) throw new Error('plugin entry not found');
  await editor.edit(entry, (current) => {
    const next = { ...(current && typeof current === 'object' ? current : {}) };
    const coerced = coerceField(key, value);
    if (coerced === undefined) delete next[key];
    else next[key] = coerced;
    return next;
  });
}

/**
 * Expose a tiny host-side surface for the client half: read the current
 * settings, and flip one of them.
 *
 * This is a plain web-server route rather than a connection fetch route: the
 * /api carrier only serves exact routes keyed on the full pathname, and DSH's
 * own plugins (host-open-in-app) use `webServer.register` + requestRejection
 * for this kind of small JSON endpoint, so the fence stays identical while the
 * path is an ordinary one the browser can call.
 */
/**
 * Answer "will the settings page show this plugin?" from inside the running
 * process.
 *
 * `SettingsForms.describe()` silently drops an entry when `fiber.runtime`
 * is missing or `Config` is not a schema with `toJSON`, and nothing about that
 * decision reaches the service log. Returning the same facts over the existing
 * endpoint turns a blind restart into one HTTP request.
 */
// Live wiring facts for the `?probe=1` HTTP endpoint: lets a running service
// answer "did the event handler fire?" without a restart or journald access.
// Permanent per-event ledger. journald passes our lines through a filter that
// mangles non-ASCII, and the reason a turn ended used to be invisible after a
// restart; this file keeps the decision for every turn so "why did it not pop
// up" can be answered by reading data instead of guessing.
const AUDIT_DIR = process.env.DSH_HOME && process.env.DSH_HOME.trim()
  ? process.env.DSH_HOME
  : resolve(os.homedir() || '/tmp', '.dsh');
const AUDIT_PATH = resolve(AUDIT_DIR, 'kylin-notifier', 'audit.jsonl');
const AUDIT_LIMIT = 2000;

function audit(record) {
  try {
    mkdirSync(dirname(AUDIT_PATH), { recursive: true });
    appendFileSync(AUDIT_PATH, `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`);
    trimAudit();
  } catch { /* auditing must never break a notification */ }
}

let auditLines = -1;
function trimAudit() {
  try {
    auditLines += 1;
    if (auditLines < AUDIT_LIMIT) return;
    auditLines = 0;
    const text = readFileSync(AUDIT_PATH, 'utf8');
    const kept = text.split('\n').filter(Boolean).slice(-Math.floor(AUDIT_LIMIT / 2));
    writeFileSync(AUDIT_PATH, `${kept.join('\n')}\n`);
  } catch { /* ignore */ }
}

const liveFacts = {
  applyRan: false,
  handlerRegistered: false,
  eventsSeen: 0,
  lastEventType: '',
  turnEnds: 0,
  lastTurnEndKind: '',
  notifiesSent: 0,
  bridgeStarted: 0,
  lastError: '',
};

function inspectSettingsEntry(ctx) {
  const facts = {
    exportedConfig: typeof Config,
    exportedHasToJSON: Config !== undefined && Config !== null && 'toJSON' in Config,
    fields: 0,
    entry: 'no-entry',
  };
  try {
    const meta = Config && typeof Config === 'object' ? Config.meta : undefined;
    const dict = (Config && Config.dict) || (meta && meta.dict) || {};
    facts.fields = Object.keys(dict).length;
  } catch {}
  try {
    const editor = typeof ctx.get === 'function' ? ctx.get('configEditor') : undefined;
    const rows = editor && typeof editor.entries === 'function' ? editor.entries() : [];
    const row = rows.find((item) => item.options && String(item.options.id).endsWith('kylin-notifier'));
    if (row) {
      const runtime = row.fiber && row.fiber.runtime;
      const schema = runtime && runtime.Config;
      facts.entry = {
        id: row.options.id,
        fiberState: row.fiber ? row.fiber.state : null,
        hasRuntime: runtime !== undefined && runtime !== null,
        configType: typeof schema,
        configHasToJSON: schema !== undefined && schema !== null && 'toJSON' in schema,
        parentId: row.parent && row.parent.tree && row.parent.tree.ctx && row.parent.tree.ctx.fiber
          ? row.parent.tree.ctx.fiber.entry && row.parent.tree.ctx.fiber.entry.id
          : null,
      };
    }
    facts.entryCount = rows.length;
  } catch (error) {
    facts.entryError = String((error && error.message) || error);
  }
  try {
    const settings = typeof ctx.get === 'function' ? ctx.get('settings') : undefined;
    facts.settingsService = settings === undefined ? 'missing' : typeof settings;
    if (settings && typeof settings.describe === 'function') {
      const listed = settings.describe();
      facts.describedNamespaces = listed.length;
      facts.describedHasKylin = listed.some((item) => String(item.ns).includes('kylin'));
    }
  } catch (error) {
    facts.describeError = String((error && error.message) || error);
  }
  return facts;
}

/**
 * Ask the Loader to re-read this plugin's module without restarting the whole
 * service. The settings page reads `fiber.runtime.Config`, which only refreshes
 * when the entry is reloaded, so this is what makes a code fix visible.
 */
async function reloadSelf(ctx) {
  const editor = typeof ctx.get === 'function' ? ctx.get('configEditor') : undefined;
  if (editor && typeof editor.reload === 'function') {
    const entry = editor.entries().find((row) => row.options && String(row.options.id).endsWith('kylin-notifier'));
    if (entry) {
      await editor.reload(entry);
      return;
    }
  }
  const loader = typeof ctx.get === 'function' ? ctx.get('loader') : undefined;
  if (loader && typeof loader.reload === 'function') {
    await loader.reload();
    return;
  }
  throw new Error('no reload interface available');
}

function installSettingsService(ctx, read, persist, onTest) {
  ctx.inject(['webServer', 'connection'], (webCtx) => {
    const connection = webCtx.connection;
    const sendJson = (res, status, payload) => {
      const body = JSON.stringify(payload);
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
      });
      res.end(body);
    };
    const rejected = (req, res) => {
      const rejection = connection && typeof connection.requestRejection === 'function'
        ? connection.requestRejection(req)
        : undefined;
      if (rejection === undefined) return false;
      res.writeHead(rejection);
      res.end();
      return true;
    };
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: SETTINGS_PATH,
      handler: async (req, res) => {
        if (rejected(req, res)) return;
        const method = String(req.method || 'GET').toUpperCase();
        if (method !== 'GET' && method !== 'POST') {
          res.writeHead(405, { allow: 'GET, POST' });
          res.end();
          return;
        }
        const url = new URL(String(req.url || '/'), 'http://127.0.0.1');
        if (method === 'GET') {
          if (url.searchParams.get('probe') === '1') {
            const want = Number(url.searchParams.get('audit') || 0) || 0;
            let recent = [];
            if (want > 0) {
              try {
                recent = readFileSync(AUDIT_PATH, 'utf8').split('\n').filter(Boolean).slice(-Math.min(want, 200))
                  .map((line) => { try { return JSON.parse(line); } catch { return { raw: line }; } });
              } catch (error) {
                recent = [{ error: String(error && error.message || error) }];
              }
            }
            sendJson(res, 200, {
              ok: true,
              probe: inspectSettingsEntry(ctx),
              live: { ...liveFacts },
              auditPath: AUDIT_PATH,
              audit: recent,
            });
            return;
          }
          sendJson(res, 200, { ok: true, settings: read() });
          return;
        }
        if (url.searchParams.get('action') === 'reload') {
          try {
            await reloadSelf(ctx);
            sendJson(res, 200, { ok: true, reloaded: true });
          } catch (error) {
            sendJson(res, 500, { ok: false, error: String((error && error.message) || error) });
          }
          return;
        }
        if (url.searchParams.get('action') === 'test') {
          // The settings page asks us to fire one real notification so the
          // "Try it" buttons can demonstrate the actual desktop popup.
          const chunks = [];
          try {
            for await (const chunk of req) chunks.push(chunk);
          } catch {
            sendJson(res, 400, { ok: false, error: 'unreadable body' });
            return;
          }
          let payload;
          try {
            payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          } catch {
            sendJson(res, 400, { ok: false, error: 'invalid json' });
            return;
          }
          try {
            const summary = typeof payload.summary === 'string' && payload.summary.trim()
              ? payload.summary.trim() : 'Test notification';
            const body = typeof payload.body === 'string' && payload.body.trim()
              ? payload.body.trim() : 'This is a test from the settings page.';
            if (typeof onTest === 'function') onTest(summary, body);
            sendJson(res, 200, { ok: true, sent: true });
          } catch (error) {
            sendJson(res, 500, { ok: false, error: String((error && error.message) || error) });
          }
          return;
        }
        const chunks = [];
        try {
          for await (const chunk of req) chunks.push(chunk);
        } catch {
          sendJson(res, 400, { ok: false, error: 'unreadable body' });
          return;
        }
        let payload;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid json' });
          return;
        }
        const key = payload && typeof payload.key === 'string' ? payload.key : '';
        if (!key) {
          sendJson(res, 400, { ok: false, error: 'missing key' });
          return;
        }
        try {
          await persist(key, payload.value);
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String((error && error.message) || error) });
          return;
        }
        sendJson(res, 200, { ok: true, settings: read() });
      },
    }), `kylin-notifier: ${SETTINGS_PATH}`);
  });
}

async function apply(ctx, config) {
  liveFacts.applyRan = true;
  // `config` holds schemastery refs for the volatile fields, so a settings edit
  // is visible on the next get() without remounting the plugin. Re-reading is
  // cheap and always correct, so every notification path reads through here.
  const read = () => normalizeConfig(config);
  let settings = read();
  const logger = ctx.logger;
  // Service stdout/stderr land in journald; ctx.logger does not. Write the
  // trace to stdout so a "why no popup" question can be answered from logs.
  const debug = (...args) => {
    if (!read().debug) return;
    try { logger.info('[kylin-notifier]', ...args); } catch {}
    try { console.log('[kylin-notifier]', ...args.map((a) => String(a)).join(' ')); } catch {}
  };

  // The test-popup callback is resolved lazily: sendForSession is declared
  // later in apply(), so pass a thunk that forwards once it exists.
  let sendTestRef = () => {};
  installSettingsService(ctx, read, (key, value) => persistSetting(ctx, key, value),
    (summary, body) => sendTestRef(summary, body));

  let bridge;
  let authenticatedUrl = (base) => base;
  let advertisedUrl = '';

  // Resolve the web app base URL and the authenticated-URL helper. The webApp
  // service is optional (apps using a different frontend may omit it); the
  // connection service is likewise optional.
  const webApp = ctx.get(settings.webAppService);
  if (webApp && typeof webApp.getAdvertisedUrl === 'function') {
    advertisedUrl = webApp.getAdvertisedUrl();
    debug('advertised web url:', advertisedUrl);
  }
  ctx.inject(['connection'], (connectionCtx) => {
    const connection = connectionCtx.connection;
    if (connection && typeof connection.authenticatedUrl === 'function') {
      authenticatedUrl = (base) => connection.authenticatedUrl(base);
    } else {
      debug('connection.authenticatedUrl unavailable; using raw base url');
    }
  });

  // What the notification needs is "which conversation, and what did it do" —
  // not an app label. Two sources, in order:
  //   1. the log-backed sessionTitle service (authoritative, survives restarts);
  //   2. the last user message of the turn, replayed from the session log.
  // The second is what the user actually recognises, so it doubles as the
  // fallback when a conversation has no title yet.
  const titles = new Map();
  const lastUser = new Map();
  // approval request id -> notification replace key, so a decision can retract
  // the "please confirm" popup no matter where it was answered.
  const approvalKeys = new Map();
  // Two independent policies the user asked for:
  //   sentAt     — "does this conversation qualify to popup right now?" (rate)
  //   liveBySession — "how many popups may this conversation keep at once?" (cap)
  // Every notification is its own object; nothing is silently overwritten.
  const sentAt = new Map();
  const liveBySession = new Map();
  let notificationSeq = 0;
  const titleService = ctx.get('sessionTitle');
  const eventsOf = (session) => {
    try {
      return typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : [];
    } catch {
      return [];
    }
  };
  const titleOf = (session, id) => {
    try {
      if (titleService && typeof titleService.get === 'function') {
        const snap = titleService.get(session);
        if (snap && snap.title) return String(snap.title);
      }
    } catch { /* fall through to the maps and the event log */ }
    const remembered = titles.get(String(id));
    if (remembered) return remembered;
    // A turn that ran before this process started still has a title in the
    // session log — fold it so a restarted service shows real names at once.
    const events = eventsOf(session);
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const ev = events[i];
      if (!ev || ev.type !== 'session/title') continue;
      const data = payloadOf(ev);
      if (data && data.title) return String(data.title);
    }
    return '';
  };
  // The harness injects runtime context (memory, working directory, policies)
  // as user/message events. Those are not something the user typed, so they
  // must never become the conversation's name.
  const isSyntheticMessage = (data) => {
    const source = data && data.source;
    const kind = source && typeof source === 'object' ? source.kind : undefined;
    return kind !== undefined && kind !== 'user';
  };
  const userTextOf = (data) => {
    if (!data || isSyntheticMessage(data)) return '';
    const message = data.message || data;
    if (message && message.role && message.role !== 'user') return '';
    return firstText(message && message.content);
  };
  // The user's last real message in this conversation: the fallback name.
  const lastTopicOf = (session, id) => {
    const remembered = lastUser.get(String(id));
    if (remembered) return remembered;
    const events = eventsOf(session);
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const ev = events[i];
      if (!ev || ev.type !== 'user/message') continue;
      const text = userTextOf(payloadOf(ev));
      if (text) return clip(text, 60);
    }
    return '';
  };
  liveFacts.handlerRegistered = true;

  // One label for the conversation: title, else the last thing the user asked.
  const conversationLabel = (session, id) => titleOf(session, id) || lastTopicOf(session, id) || '';
  // Session events carry their payload under `event.data` (persisted wire
  // shape: {type, seq, time, data}). Fall back to top-level fields for older
  // shapes.
  const payloadOf = (event) => {
    const d = event && event.data;
    return d && typeof d === 'object' ? d : event;
  };
  ctx.on('session/event', (session, event) => {
    liveFacts.eventsSeen += 1;
    liveFacts.lastEventType = String(event && event.type);
    if (!session || !event) return;
    const id = session.id;
    if (!id) return;
    const payload = payloadOf(event);
    if (event.type === 'turn/end' || event.type === 'approval/asked' || event.type === 'user-questions/request') {
      debug('event', event.type, 'session', String(id), 'enabled', String(read().enabled));
    }
    if (event.type === 'session/title' && payload.title) {
      titles.set(String(id), String(payload.title));
      return;
    }
    if (event.type === 'user/message') {
      const text = userTextOf(payload);
      if (text) lastUser.set(String(id), clip(text, 60));
      return;
    }
    settings = read();
    if (!settings.enabled) return;
    if (event.type === 'turn/end') {
      // Some turns never reach a natural end: the window is closed, the turn
      // is disposed, the user stops it. The work is still over and the user is
      // still not looking — silence here is exactly the "no popup" complaint.
      // So: notify on every end, only the wording differs.
      const reason = payload.reason;
      const kind = reason && typeof reason === 'object' && typeof reason.kind === 'string'
        ? reason.kind
        : reason === undefined || reason === null
          ? 'completed'
          : String(reason);
      liveFacts.turnEnds += 1;
      liveFacts.lastTurnEndKind = kind;
      // Every kind of turn end means the user is no longer being served, so
      // every kind pops up. `interrupted` used to be filtered out here and
      // that single line was the "sometimes it does not pop up" complaint.
      if (settings.notifyOnComplete) {
        // Never let a title lookup or a bridge hiccup swallow the event.
        try {
          const topic = conversationLabel(session, id);
          let status;
          if (kind === 'completed') {
            status = '会话已完成，请到 DeepSeek Harness 中查看';
          } else if (kind === 'error') {
            status = '会话出错了，请到 DeepSeek Harness 中查看';
          } else if (kind === 'max-tokens') {
            status = '回复被长度上限截断，请到 DeepSeek Harness 中查看';
          } else if (kind === 'interrupted') {
            status = '会话被中断了，请到 DeepSeek Harness 中查看';
          } else if (kind === 'blocked') {
            status = '会话被阻止了，请到 DeepSeek Harness 中查看';
          } else {
            status = '会话已中止，请到 DeepSeek Harness 中查看';
          }
          const allowed = rateAllowed(String(id));
          audit({ ev: 'turn/end', session: String(id), turn: payload.turn, kind, topic, status, sent: allowed, gate: allowed ? '' : 'minInterval' });
          if (allowed) sendForSession(String(id), topic, status);
        } catch (err) {
          audit({ ev: 'turn/end', session: String(id), kind, sent: false, gate: 'exception', error: String(err && err.stack || err) });
          debug('complete notification failed:', String(err && err.stack || err));
        }
      }
      return;
    }
    if (event.type === 'approval/asked') {
      settings = read();
      if (!settings.notifyOnApproval) return;
      try {
        const topic = conversationLabel(session, id);
        approvalKeys.set(String(payload.id ?? ''), { session: String(id) });
        const allowed = rateAllowed(String(id));
        audit({ ev: 'approval/asked', session: String(id), tool: payload.toolName, topic, sent: allowed, gate: allowed ? '' : 'minInterval' });
        if (allowed) sendForSession(String(id), topic, '请到 DeepSeek Harness 中确认');
      } catch (err) {
        debug('approval notification failed:', String(err && err.stack || err));
      }
      return;
    }
    if (event.type === 'approval/decided') {
      // The decision was made — possibly in the terminal, the mobile remote or
      // another browser tab. The "please confirm" popup is now a lie, so take
      // it back instead of leaving it on screen.
      const record = approvalKeys.get(String(payload.id ?? ''));
      if (!record) return;
      approvalKeys.delete(String(payload.id ?? ''));
      // Withdraw the newest live popup of the conversation that asked: that is
      // the "please confirm" one, and it is now a lie.
      const owner = record.session || String(id);
      const list = liveBySession.get(owner);
      const key = list && list.length ? list[list.length - 1] : undefined;
      try {
        if (key) bridge && bridge.close(key);
      } catch (err) {
        debug('approval close failed:', String(err));
      }
      return;
    }
  });

  // User questions have no session event; notify inside the waterfall before
  // handing the decision to the next provider. We never resolve the decision
  // ourselves: next() is always returned/awaited.
  ctx.on('user-questions/request', async (request, next) => {
    settings = read();
    if (!settings.enabled || !settings.notifyOnQuestion) return next();
    try {
      const agent = request && request.agent;
      const session = agent && agent.session;
      const id = session && session.id;
      const questions = (request && request.questions) || [];
      const first = questions[0];
      const sessionId = id ? String(id) : '';
      const topic = sessionId ? conversationLabel(session, sessionId) : '';
      if (sessionId && rateAllowed(sessionId)) sendForSession(sessionId, topic, '请到 DeepSeek Harness 中回答');
    } catch (err) {
      debug('question notification failed:', String(err));
    }
    return next();
  });

  /**
   * Get the renderer for this apply.
   *
   * Each apply owns exactly one renderer. A module-level registry was tried
   * first and must not come back: `releaseRenderer` tore down whichever client
   * the registry pointed at, so a second apply (or any effect teardown)
   * killed the renderer the first apply was still using. The child died
   * seconds after spawning and no card ever mapped.
   */
  function acquireRenderer(config) {
    const client = new BridgeClient(ctx, config);
    client.kind = config.renderer === 'native' ? 'native' : 'toast';
    return client;
  }

  function releaseRenderer(client) {
    try { client.dispose(); } catch { /* already gone */ }
  }

  function sendForSession(sessionId, summary, body) {
    settings = read();
    if (!bridge) {
      bridge = acquireRenderer(settings);
      ctx.effect(() => () => releaseRenderer(bridge), 'kylin-notifier: bridge lifetime');
    }
    const base = advertisedUrl || (typeof ctx.get('webApp')?.getAdvertisedUrl === 'function'
      ? ctx.get('webApp').getAdvertisedUrl()
      : '');
    const url = sessionId
      ? withSessionHash(authenticatedUrl(base || ''), sessionId)
      : authenticatedUrl(base || '');
    // Each popup owns a unique replace key. Reusing one key (for example the
    // bare session id) makes the desktop replace the previous popup, which is
    // exactly the "sometimes it does not pop up" the user reported.
    const key = `${sessionId || 'session'}:${Date.now().toString(36)}:${(notificationSeq += 1).toString(36)}`;
    const retain = Math.max(1, Math.trunc(settings.maxPerSession));
    const list = liveBySession.get(sessionId) || [];
    // Over the cap: withdraw this conversation's oldest popup first, so the
    // newest alert is the one the user sees.
    while (list.length >= retain) {
      const oldest = list.shift();
      try { bridge.close(oldest); } catch { /* best effort */ }
    }
    list.push(key);
    liveBySession.set(sessionId, list);
    bridge.notify({
      appName: settings.appName,
      icon: settings.icon,
      summary: clip(summary, 100),
      body: clip(body, 200),
      session: sessionId,
      replaceKey: key,
      url,
      timeout: settings.timeoutMs,
      theme: settings.theme,
      position: settings.position,
      animation: settings.animation,
      sound: settings.sound,
      soundName: settings.soundName,
      // The self-drawn card has room for real labels; the desktop notification
      // keeps the icon-only behaviour the user asked for.
      actionLabel: settings.renderer === 'native' && settings.actionIcon
        ? ''
        : (settings.actionLabel || '进入对话'),
      dismissLabel: settings.renderer === 'native' ? settings.dismissLabel : (settings.dismissLabel || '稍后'),
    });
    sentAt.set(sessionId, Date.now());
    liveFacts.notifiesSent += 1;
    audit({ ev: 'sent', session: sessionId, summary, key, url });
    debug('notify', JSON.stringify({ sessionId, summary, key, live: list.length, url }));
  }

  // Hook for the settings page's "Try it" buttons. Uses a synthetic session id
  // so the popup still carries a jump target (opening the app), but never
  // collides with a real conversation's rate-limit / retained-popup state.
  sendTestRef = (summary, body) => {
    const current = read();
    if (!current.enabled) return;
    sendForSession(`test:${Date.now().toString(36)}`, summary, body);
  };

  // "Do not spam one conversation": a completed turn right after another one
  // for the same conversation is not news. 0 disables the gate.
  function rateAllowed(sessionId) {
    settings = read();
    const windowMs = Math.max(0, Math.trunc(settings.minIntervalSeconds)) * 1000;
    if (!windowMs) return true;
    const last = sentAt.get(sessionId) || 0;
    return Date.now() - last >= windowMs;
  }
}

export { Config, apply, inject, name };
