'use strict';

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { WebSocketServer } = require('ws');

const config = require('./config');
const { logger, LOG_DIR } = require('./logger');
const runtime = require('./runtime');
const runner = require('./runner');
const tools = require('./tools');
const scheduler = require('./scheduler');

const PORT = Number(process.env.PORT || 3000);
const PACKAGE_VERSION = require('../package.json').version;
const STARTED_AT = Date.now();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('invalid JSON body');
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const routes = {
  'GET /api/health': () => ({
    status: 'healthy',
    uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
  }),

  'GET /api/version': () => ({
    serviceVersion: PACKAGE_VERSION,
    maaVersion: runtime.MAA_VERSION,
    nodeVersion: process.version,
  }),

  'GET /api/system/info': () => ({
    serviceVersion: PACKAGE_VERSION,
    maaVersion: runtime.MAA_VERSION,
    architecture: process.arch,
    platform: `${os.type()} ${os.release()}`,
    hostname: os.hostname(),
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    cpus: os.cpus().length,
    uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
  }),

  'GET /api/config': () => config.load(),

  async 'PUT /api/config'(req) {
    const body = await readJson(req);
    const { valid, errors } = config.validate(body);
    if (!valid) throw Object.assign(new Error(errors.join('; ')), { statusCode: 400 });
    const saved = config.save(body);
    if (body.logLevel) logger.setLevel(body.logLevel);
    logger.info('config', 'configuration updated');
    return saved;
  },

  async 'POST /api/config/validate'(req) {
    const body = await readJson(req);
    return config.validate(body);
  },

  'GET /api/runtime/status': () => runtime.status(),

  // 与 GitHub 最新 release 对比（带 5 分钟缓存），前端据此决定是否提示更新
  'GET /api/runtime/check-update': (req, url) =>
    runtime.checkUpdate({ force: url.searchParams.get('force') === '1' }),

  async 'POST /api/runtime/fetch'(req) {
    if (runtime.status().busy) {
      throw Object.assign(new Error('runtime fetch already in progress'), { statusCode: 409 });
    }
    let body = {};
    try { body = await readJson(req) || {}; } catch { body = {}; }
    const version = typeof body.version === 'string' && /^v?[\w.\-]+$/.test(body.version) ? body.version : null;
    // Fire and forget; progress is observable via /api/runtime/status and logs.
    runtime.fetchRuntime((received, total) => {
      if (total && received % (20 * 1024 * 1024) < 512 * 1024) {
        logger.info('runtime', `download progress ${Math.floor((received / total) * 100)}%`);
      }
    }, version).catch(() => {}); // status/log already record the failure
    return { started: true, version: version || 'latest', installed: runtime.status().installed };
  },

  'GET /api/resources/info': () => runtime.resourcesInfo(),

  'POST /api/resources/verify': () => runtime.verify(),

  // MAA desktop-style task catalog (drives the web UI)
  'GET /api/tasks/catalog': () => {
    const catalog = require('./task-catalog.json');
    return catalog;
  },

  // MAA desktop UI layout (per-control, matches MaaWpfGui XAML)
  'GET /api/tasks/ui': () => require('./task-ui.json'),

  // Per-task user configuration (persisted, keyed by task id)
  'GET /api/tasks/config': () => {
    const file = path.join(config.CONFIG_DIR(), 'tasks.json');
    try {
      return { config: JSON.parse(require('node:fs').readFileSync(file, 'utf8')) };
    } catch {
      return { config: {} };
    }
  },

  async 'PUT /api/tasks/config'(req) {
    const body = await readJson(req);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw Object.assign(new Error('body must be a JSON object'), { statusCode: 400 });
    }
    const catalog = require('./task-catalog.json');
    const validIds = new Set(catalog.tasks.map((t) => t.id));
    const clean = {};
    for (const [taskId, opts] of Object.entries(body)) {
      if (taskId === '_meta') continue;
      if (!validIds.has(taskId) || typeof opts !== 'object' || Array.isArray(opts)) continue;
      if (taskId === 'fight' && opts.weekly_plan && typeof opts.weekly_plan === 'object') {
        // 理智作战「周计划」：桌面端是 GUI 概念，协议无对应字段，由服务端在
        // 下发 Fight 任务时按当天星期展开成 stage。这里白名单放行并做清洗。
        const wp = { enabled: !!opts.weekly_plan.enabled };
        for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
          const list = Array.isArray(opts.weekly_plan[day]) ? opts.weekly_plan[day] : [];
          wp[day] = list.map((x) => String(x).slice(0, 32)).filter(Boolean).slice(0, 12);
        }
        clean.fight = { ...opts, weekly_plan: wp };
        continue;
      }
      clean[taskId] = opts;
    }
    // queue-level options (post action, etc.)
    if (body._meta && typeof body._meta === 'object' && !Array.isArray(body._meta)) {
      const meta = {};
      const postActions = ['None', 'BackToHome', 'ExitGame', 'ExitEmulator', 'ExitMAA', 'Shutdown', 'Sleep', 'Hibernate'];
      if (postActions.includes(body._meta.postAction)) meta.postAction = body._meta.postAction;
      if (Object.keys(meta).length) clean._meta = meta;
    }
    const file = path.join(config.CONFIG_DIR(), 'tasks.json');
    require('node:fs').writeFileSync(file, JSON.stringify(clean, null, 2) + '\n', 'utf8');
    logger.info('tasks', 'task configuration saved');
    return { config: clean };
  },

  async 'POST /api/tasks/execute'(req) {
    const body = await readJson(req);
    const ids = Array.isArray(body.tasks) ? body.tasks : [];
    return runner.start(ids);
  },

  'GET /api/runner/status': () => runner.snapshot(),

  /* ---- 小工具（识别类）：真实调用 MaaCore 的 Recruit / Depot / OperBox ---- */
  'GET /api/tools/results': () => tools.snapshot(),

  async 'POST /api/tools/run'(req) {
    const body = await readJson(req);
    if (!body || typeof body.kind !== 'string') {
      throw Object.assign(new Error('body.kind is required'), { statusCode: 400 });
    }
    return tools.runRecognition(body.kind);
  },

  /* ---- 自动战斗：运行包自带的官方作业 ---- */
  'GET /api/copilot/list': (req, url) => {
    const list = tools.listCopilot({ force: url.searchParams.get('force') === '1' });
    return {
      count: list.length,
      byType: {
        main: list.filter((x) => x.type === 'main').length,
        sss: list.filter((x) => x.type === 'sss').length,
        paradox: list.filter((x) => x.type === 'paradox').length,
      },
      jobs: list,
    };
  },

  /* ---- 设备截图：ADB screencap，直接返回 PNG（监控 / 实时画面用） ---- */
  'GET /api/device/screenshot': (req, url, res) => {
    const conn = readConnection();
    const address = conn.address;
    if (!address) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '尚未配置设备地址' }));
      return true;
    }
    const adbPath = conn.adbPath || '/usr/bin/adb';
    const { spawn } = require('node:child_process');
    const proc = spawn(adbPath, ['-s', address, 'exec-out', 'screencap', '-p'], { timeout: 15000 });
    const chunks = [];
    let failed = null;
    proc.stdout.on('data', (c) => chunks.push(c));
    proc.stderr.on('data', (c) => { failed = String(c); });
    proc.on('error', (e) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `adb 启动失败: ${e.message}` }));
      }
    });
    proc.on('close', (code) => {
      if (res.headersSent) return;
      const buf = Buffer.concat(chunks);
      if (code !== 0 || !buf.length) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `screencap 失败（exit ${code}）${failed ? ': ' + failed.slice(0, 120) : ''}` }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
    return true; // 已手工接管响应
  },

  async 'POST /api/copilot/start'(req) {
    const body = await readJson(req);
    return tools.runCopilot(body || {});
  },

  'POST /api/runner/stop': () => runner.stop(),

  'POST /api/runner/test-connect': () => runner.testConnect(),

  // Connection settings (connection.json, consumed by the execution pipeline)
  'GET /api/connection': () => {
    const file = path.join(config.CONFIG_DIR(), 'connection.json');
    try {
      return { connection: JSON.parse(require('node:fs').readFileSync(file, 'utf8')) };
    } catch {
      return { connection: {} };
    }
  },

  async 'PUT /api/connection'(req) {
    const body = await readJson(req);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw Object.assign(new Error('body must be a JSON object'), { statusCode: 400 });
    }
    const clean = {};
    for (const key of ['address', 'addressType', 'config', 'sn', 'clientType', 'adbPath', 'touchMode', 'autoDetect', 'alwaysAutoDetect']) {
      if (typeof body[key] === 'string') clean[key] = body[key].slice(0, 256);
    }
    const file = path.join(config.CONFIG_DIR(), 'connection.json');
    require('node:fs').writeFileSync(file, JSON.stringify(clean, null, 2) + '\n', 'utf8');
    logger.info('tasks', 'connection settings saved');
    return { connection: clean };
  },

  // Scheduled executions (schedule.json)
  'GET /api/tasks/schedule': () => {
    const state = scheduler.status();
    return {
      schedule: state.entries.map((e) => ({
        id: e.id, time: e.time, enabled: e.enabled, tasks: e.tasks,
        repeat: e.repeat, lastRun: e.lastRun, lastResult: e.lastResult, nextRun: e.nextRun,
      })),
      scheduler: { running: state.running, lastTickAt: state.lastTickAt },
    };
  },

  async 'PUT /api/tasks/schedule'(req) {
    const body = await readJson(req);
    if (!Array.isArray(body.schedule)) {
      throw Object.assign(new Error('body.schedule must be an array'), { statusCode: 400 });
    }
    const catalog = require('./task-catalog.json');
    const validIds = new Set(catalog.tasks.map((t) => t.id));
    const clean = body.schedule
      .filter((e) => e && typeof e === 'object')
      .map((e) => ({
        id: String(e.id || `s${Date.now()}${Math.floor(Math.random() * 1000)}`).slice(0, 40),
        time: /^\d{2}:\d{2}$/.test(String(e.time)) ? String(e.time) : '04:00',
        enabled: e.enabled !== false,
        tasks: Array.isArray(e.tasks) ? e.tasks.filter((t) => validIds.has(t)) : [],
        // 重复规则由服务端调度器使用（daily/weekdays/weekends/mon..sun）
        repeat: scheduler.REPEATS.includes(e.repeat) ? e.repeat : 'daily',
        lastRun: typeof e.lastRun === 'string' ? e.lastRun.slice(0, 40) : null,
        lastResult: typeof e.lastResult === 'string' ? e.lastResult.slice(0, 120) : null,
      }))
      .slice(0, 64);
    const file = path.join(config.CONFIG_DIR(), 'schedule.json');
    require('node:fs').writeFileSync(file, JSON.stringify(clean, null, 2) + '\n', 'utf8');
    logger.info('tasks', `schedule saved (${clean.length} entries)`);
    return { schedule: clean };
  },

  'GET /api/features/parity': () => require('./feature-parity.json'),

  'GET /api/logs': (req, url) => {
    const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 2000);
    return { entries: logger.recent(limit), files: logger.logFiles(), logDir: LOG_DIR };
  },

  'GET /api/logs/download'(req, url, res) {
    const name = url.searchParams.get('file') || logger.logFiles()[0];
    if (!name || !/^maa-server-\d{8}\.log$/.test(name)) {
      throw Object.assign(new Error('log file not found'), { statusCode: 404 });
    }
    const file = path.join(LOG_DIR, name);
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
    });
    require('node:fs').createReadStream(file).pipe(res);
    return undefined; // streamed
  },
};

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

// Static frontend (local/dev convenience; production Docker serves via nginx)
const STATIC_DIR = path.join(__dirname, '..', '..', 'maa-web', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json',
};
function serveStatic(url, res) {
  if (url.pathname.startsWith('/api/')) return false;
  let rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  rel = path.normalize(rel).replace(/^([.][.][\\/])+/, '');
  const file = path.join(STATIC_DIR, rel);
  if (!file.startsWith(STATIC_DIR)) { sendJson(res, 403, { error: 'forbidden' }); return true; }
  try {
    const data = require('node:fs').readFileSync(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const key = `${req.method} ${url.pathname}`;
  // CORS: allow LAN/dev origins (static preview server hitting the API directly)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
    });
    res.end();
    return;
  }
  if (req.headers.origin) res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  if (serveStatic(url, res)) return;
  try {
    const handler = routes[key];
    if (!handler) return sendJson(res, 404, { error: `no route: ${key}` });
    const result = await handler(req, url, res);
    if (result !== undefined) sendJson(res, 200, result);
  } catch (err) {
    const code = err.statusCode || 500;
    if (code >= 500) logger.error('http', `${key} -> ${err.message}`);
    else logger.warn('http', `${key} -> ${err.message}`);
    sendJson(res, code, { error: err.message });
  }
});

// WebSocket: live log tail on /api/ws
const wss = new WebSocketServer({ server, path: '/api/ws' });
wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ type: 'hello', serviceVersion: PACKAGE_VERSION, maaVersion: runtime.MAA_VERSION }));
  for (const entry of logger.recent(100)) socket.send(JSON.stringify(entry));
});
logger.on('entry', (entry) => {
  const data = JSON.stringify(entry);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
});

function start() {
  config.load();
  logger.setLevel(config.load().logLevel);
  logger.info('server', `MAA for NAS server ${PACKAGE_VERSION} starting`);
  const ok = runtime.init();
  if (ok) {
    logger.info('server', `MAA ${runtime.MAA_VERSION} runtime found in data volume`);
  } else if (config.load().autoFetchRuntime) {
    logger.info('server', 'runtime not found; auto-fetch enabled, downloading official MAA runtime');
    runtime.fetchRuntime().catch(() => {});
  } else {
    logger.info('server', 'runtime not found; use POST /api/runtime/fetch to download it');
  }
  scheduler.start();
  return new Promise((resolve) => server.listen(PORT, '0.0.0.0', () => resolve(PORT)));
}

if (require.main === module) {
  start().then((port) => {
    logger.info('server', `listening on 0.0.0.0:${port}`);
  });
}

module.exports = { server, start, routes };
