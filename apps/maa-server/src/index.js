'use strict';

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { WebSocketServer } = require('ws');

const config = require('./config');
const { logger, LOG_DIR } = require('./logger');
const runtime = require('./runtime');

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

  async 'POST /api/runtime/fetch'() {
    if (runtime.status().busy) {
      throw Object.assign(new Error('runtime fetch already in progress'), { statusCode: 409 });
    }
    // Fire and forget; progress is observable via /api/runtime/status and logs.
    runtime.fetchRuntime((received, total) => {
      if (total && received % (20 * 1024 * 1024) < 512 * 1024) {
        logger.info('runtime', `download progress ${Math.floor((received / total) * 100)}%`);
      }
    }).catch(() => {}); // status/log already record the failure
    return { started: true, maaVersion: runtime.MAA_VERSION };
  },

  'GET /api/resources/info': () => runtime.resourcesInfo(),

  'POST /api/resources/verify': () => runtime.verify(),

  // MAA desktop-style task catalog (drives the web UI)
  'GET /api/tasks/catalog': () => {
    const catalog = require('./task-catalog.json');
    return catalog;
  },

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
      if (!validIds.has(taskId) || typeof opts !== 'object' || Array.isArray(opts)) continue;
      clean[taskId] = opts;
    }
    const file = path.join(config.CONFIG_DIR(), 'tasks.json');
    require('node:fs').writeFileSync(file, JSON.stringify(clean, null, 2) + '\n', 'utf8');
    logger.info('tasks', 'task configuration saved');
    return { config: clean };
  },

  async 'POST /api/tasks/execute'() {
    // Execution pipeline (M2) is not wired yet; validate what we can and fail honestly.
    const file = path.join(config.CONFIG_DIR(), 'connection.json');
    let conn = {};
    try {
      conn = JSON.parse(require('node:fs').readFileSync(file, 'utf8'));
    } catch { /* empty */ }
    if (!conn.address) {
      throw Object.assign(new Error('尚未配置设备连接地址（连接设置页）'), { statusCode: 409 });
    }
    throw Object.assign(
      new Error(`任务执行管线尚未接入（设备 ${conn.address} 已知）。M2 将通过运行包内置的 MaaCore C 接口执行。`),
      { statusCode: 501 },
    );
  },

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
    for (const key of ['address', 'addressType', 'config', 'sn', 'clientType']) {
      if (typeof body[key] === 'string') clean[key] = body[key].slice(0, 256);
    }
    const file = path.join(config.CONFIG_DIR(), 'connection.json');
    require('node:fs').writeFileSync(file, JSON.stringify(clean, null, 2) + '\n', 'utf8');
    logger.info('tasks', 'connection settings saved');
    return { connection: clean };
  },

  // Scheduled executions (schedule.json)
  'GET /api/tasks/schedule': () => {
    const file = path.join(config.CONFIG_DIR(), 'schedule.json');
    try {
      return { schedule: JSON.parse(require('node:fs').readFileSync(file, 'utf8')) };
    } catch {
      return { schedule: [] };
    }
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
      }))
      .slice(0, 64);
    const file = path.join(config.CONFIG_DIR(), 'schedule.json');
    require('node:fs').writeFileSync(file, JSON.stringify(clean, null, 2) + '\n', 'utf8');
    logger.info('tasks', `schedule saved (${clean.length} entries)`);
    return { schedule: clean };
  },

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
  logger.info('server', `MAA Docker Web server ${PACKAGE_VERSION} starting`);
  const ok = runtime.init();
  if (ok) {
    logger.info('server', `MAA ${runtime.MAA_VERSION} runtime found in data volume`);
  } else if (config.load().autoFetchRuntime) {
    logger.info('server', 'runtime not found; auto-fetch enabled, downloading official MAA runtime');
    runtime.fetchRuntime().catch(() => {});
  } else {
    logger.info('server', 'runtime not found; use POST /api/runtime/fetch to download it');
  }
  return new Promise((resolve) => server.listen(PORT, '0.0.0.0', () => resolve(PORT)));
}

if (require.main === module) {
  start().then((port) => {
    logger.info('server', `listening on 0.0.0.0:${port}`);
  });
}

module.exports = { server, start, routes };
