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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const key = `${req.method} ${url.pathname}`;
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
