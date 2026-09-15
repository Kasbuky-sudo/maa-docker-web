'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { logger } = require('./logger');

/**
 * Official MAA Linux runtime management.
 * We never ship MAA binaries in this repository or in our Docker images.
 * The runtime archive is downloaded at runtime from the official GitHub
 * release, checksum-verified and extracted into a persistent data volume.
 * Upstream project: https://github.com/MaaAssistantArknights/MaaAssistantArknights (AGPL-3.0)
 */

const MAA_VERSION = 'v6.17.5';
const RELEASE_BASE = `https://github.com/MaaAssistantArknights/MaaAssistantArknights/releases/download/${MAA_VERSION}`;

const ASSETS = Object.freeze({
  x64: Object.freeze({
    file: `MAA-${MAA_VERSION}-linux-x86_64.tar.gz`,
    url: `${RELEASE_BASE}/MAA-${MAA_VERSION}-linux-x86_64.tar.gz`,
    sha256: 'b2f472bb016621a0e0be080953ad4d88ac6735f605ddf6921e8ba4d2b68395bb',
  }),
  arm64: Object.freeze({
    file: `MAA-${MAA_VERSION}-linux-aarch64.tar.gz`,
    url: `${RELEASE_BASE}/MAA-${MAA_VERSION}-linux-aarch64.tar.gz`,
    sha256: 'dda6bf0a3941b876db597399e7d727575b40a8e0fd4a538ccc38d7e498d67809',
  }),
});

const DATA_DIR = () => process.env.DATA_DIR || path.join(__dirname, '..', '..', '..', 'data');
const RUNTIME_DIR = () => process.env.RUNTIME_DIR || path.join(DATA_DIR(), 'runtime');
const RESOURCE_DIR = () => process.env.RESOURCE_DIR || path.join(DATA_DIR(), 'resource');
const MARKER_FILE = '.maa-docker-web-runtime.json';

const state = {
  status: 'uninitialized', // uninitialized | downloading | verifying | extracting | ready | error
  maaVersion: MAA_VERSION,
  arch: process.arch === 'arm64' ? 'arm64' : 'x64',
  asset: null,
  error: null,
  fetchedAt: null,
  busy: false,
};

function assetFor(arch) {
  return ASSETS[arch] || ASSETS.x64;
}

function markerPath() {
  return path.join(RUNTIME_DIR(), MARKER_FILE);
}

function readMarker() {
  try {
    return JSON.parse(fs.readFileSync(markerPath(), 'utf8'));
  } catch {
    return null;
  }
}

function writeMarker(data) {
  fs.writeFileSync(markerPath(), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function runtimeRoot() {
  // The official Linux tarball extracts FLAT into RUNTIME_DIR
  // (libMaaCore.so, resource/, Python/, maa ... at the top level).
  try {
    if (fs.existsSync(path.join(RUNTIME_DIR(), 'libMaaCore.so'))) return RUNTIME_DIR();
    // Defensive fallback: some layouts nest everything under one directory.
    const entries = fs.readdirSync(RUNTIME_DIR(), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'));
    for (const e of entries) {
      if (fs.existsSync(path.join(RUNTIME_DIR(), e.name, 'libMaaCore.so'))) {
        return path.join(RUNTIME_DIR(), e.name);
      }
    }
    return null;
  } catch {
    return null;
  }
}

function setStatus(status, error) {
  state.status = status;
  state.error = error || null;
  logger.info('runtime', `status -> ${status}${error ? `: ${error}` : ''}`);
}

/** Check whether a previously fetched runtime is present and valid. */
function init() {
  fs.mkdirSync(RUNTIME_DIR(), { recursive: true });
  fs.mkdirSync(RESOURCE_DIR(), { recursive: true });
  const marker = readMarker();
  if (marker && marker.maaVersion === MAA_VERSION && marker.sha256 === assetFor(state.arch).sha256 && runtimeRoot()) {
    state.fetchedAt = marker.fetchedAt || null;
    setStatus('ready');
    return true;
  }
  setStatus('uninitialized');
  return false;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function extractTar(file) {
  return new Promise((resolve, reject) => {
    const proc = spawn('tar', ['-xzf', file, '-C', RUNTIME_DIR()], { stdio: 'ignore' });
    proc.on('error', reject);
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited with code ${code}`))));
  });
}

/**
 * Download, verify and extract the official MAA runtime for this architecture.
 * progressCB(downloadedBytes, totalBytes) is invoked while streaming.
 */
async function fetchRuntime(progressCb = () => {}) {
  if (state.busy) throw new Error('runtime fetch already in progress');
  state.busy = true;
  const asset = assetFor(state.arch);
  state.asset = asset.file;
  const tmpFile = path.join(RUNTIME_DIR(), asset.file);
  try {
    fs.mkdirSync(RUNTIME_DIR(), { recursive: true });
    setStatus('downloading');
    logger.info('runtime', `downloading ${asset.url}`);

    // Optional egress proxy (Node fetch ignores HTTP(S)_PROXY env by default)
    const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
      || process.env.HTTP_PROXY || process.env.http_proxy || '';
    const fetchOptions = { redirect: 'follow' };
    if (proxyUrl) {
      const { ProxyAgent } = require('undici');
      fetchOptions.dispatcher = new ProxyAgent(proxyUrl);
      logger.info('runtime', `using proxy ${proxyUrl}`);
    }

    const res = await fetch(asset.url, fetchOptions);
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    let received = 0;
    const out = fs.createWriteStream(tmpFile);
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (!out.write(Buffer.from(value))) {
        await new Promise((r) => out.once('drain', r));
      }
      progressCb(received, total);
    }
    await new Promise((r) => out.end(r));

    setStatus('verifying');
    const digest = await sha256File(tmpFile);
    if (digest !== asset.sha256) {
      fs.rmSync(tmpFile, { force: true });
      throw new Error(`sha256 mismatch: expected ${asset.sha256}, got ${digest}`);
    }
    logger.info('runtime', 'sha256 verified');

    setStatus('extracting');
    await extractTar(tmpFile);
    fs.rmSync(tmpFile, { force: true });

    writeMarker({
      maaVersion: MAA_VERSION,
      sha256: asset.sha256,
      asset: asset.file,
      arch: state.arch,
      fetchedAt: new Date().toISOString(),
    });
    state.fetchedAt = new Date().toISOString();
    setStatus('ready');
    logger.info('runtime', `MAA ${MAA_VERSION} runtime ready at ${runtimeRoot()}`);
    return true;
  } catch (err) {
    setStatus('error', err.message);
    logger.error('runtime', err.message);
    throw err;
  } finally {
    state.busy = false;
  }
}

/** Locate key paths inside the extracted runtime. */
function resourcesInfo() {
  const root = runtimeRoot();
  if (!root) return { present: false, maaVersion: MAA_VERSION };
  const candidates = ['resource', path.join('files', 'resource')];
  let resourceDir = null;
  for (const c of candidates) {
    const p = path.join(root, c);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      resourceDir = p;
      break;
    }
  }
  return {
    present: true,
    maaVersion: MAA_VERSION,
    root,
    resourceDir,
    arch: state.arch,
    fetchedAt: state.fetchedAt,
  };
}

/** Verify the extracted runtime: core libraries and resource directories exist. */
function verify() {
  const info = resourcesInfo();
  if (!info.present) return { ok: false, checks: [], error: 'runtime not fetched' };
  const checks = [];
  try {
    checks.push({ name: 'runtime root', ok: true, path: info.root });
    checks.push({
      name: 'resource directory',
      ok: Boolean(info.resourceDir),
      path: info.resourceDir,
    });
    const libs = fs.readdirSync(info.root).filter((f) => f.startsWith('libMaaCore') || f.startsWith('MaaCore'));
    checks.push({ name: 'MaaCore library', ok: libs.length > 0, found: libs });
    if (info.resourceDir) {
      const res = fs.readdirSync(info.resourceDir).filter((f) => !f.startsWith('.'));
      checks.push({ name: 'resource entries', ok: res.length > 0, count: res.length });
    }
  } catch (err) {
    return { ok: false, checks, error: err.message };
  }
  return { ok: checks.every((c) => c.ok), checks };
}

function status() {
  return {
    status: state.status,
    maaVersion: state.maaVersion,
    arch: state.arch,
    asset: state.asset || assetFor(state.arch).file,
    error: state.error,
    fetchedAt: state.fetchedAt,
    busy: state.busy,
    runtimeDir: RUNTIME_DIR(),
  };
}

module.exports = {
  MAA_VERSION,
  ASSETS,
  init,
  fetchRuntime,
  resourcesInfo,
  verify,
  status,
  // exported for tests only
  _internal: { sha256File, runtimeRoot, markerPath, readMarker, assetFor },
};
