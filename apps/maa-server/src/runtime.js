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

/* 引导版本：首次下载用的兜底版本（真正的「已安装版本」以 marker 为准，
 * 更新则通过 GitHub releases API 对比 + 用官方 assets[].digest 校验，无需硬编码哈希）。 */
const MAA_VERSION = 'v6.17.5';
const RELEASE_BASE = `https://github.com/MaaAssistantArknights/MaaAssistantArknights/releases/download/${MAA_VERSION}`;
const RELEASES_API = 'https://api.github.com/repos/MaaAssistantArknights/MaaAssistantArknights/releases';
const UPDATE_CACHE_MS = 5 * 60 * 1000;
// 预发布（beta）过滤：默认只看正式版，前端可显式要求包含预发布。
// 站点配置：includePrerelease 为 true 时把 beta 也算作候选更新。
const PRE_RELEASE_RE = /-(beta|alpha|rc|pre|dev)[.\-]?\d*/i;

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
  installed: null,        // 磁盘上实际安装的版本（marker.maaVersion）
  latest: null,           // GitHub 上的最新版本（checkUpdate 后填充）
  latestPrerelease: false,// 该最新版本是否为预发布
  latestPublishedAt: null,
  updateCheckedAt: null,
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
  // 只要 marker 记录了版本、归档名与架构对得上，且 runtime 根目录存在，就算就绪。
  // （不再要求等于引导版本——否则升级到新版本后会被判定为未就绪。）
  if (marker && marker.maaVersion && marker.asset && marker.arch === state.arch && runtimeRoot()) {
    state.fetchedAt = marker.fetchedAt || null;
    state.installed = marker.maaVersion;
    state.maaVersion = marker.maaVersion;
    setStatus('ready');
    return true;
  }
  state.installed = null;
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
async function fetchRuntime(progressCb = () => {}, targetVersion = null) {
  if (state.busy) throw new Error('runtime fetch already in progress');
  state.busy = true;

  // 解析目标版本：显式指定 > 最新 release > 引导版本（内置 sha256）
  let asset;
  let version = targetVersion;
  const info = await checkUpdate({ force: !!targetVersion });
  if (!version && info.latest && info.asset) {
    version = info.latest;
    asset = {
      file: info.asset.name,
      url: info.asset.url,
      sha256: info.asset.digest ? String(info.asset.digest).replace(/^sha256:/, '') : null,
    };
  } else if (version && info.latest === version && info.asset) {
    asset = {
      file: info.asset.name,
      url: info.asset.url,
      sha256: info.asset.digest ? String(info.asset.digest).replace(/^sha256:/, '') : null,
    };
  } else if (version && version === MAA_VERSION) {
    asset = assetFor(state.arch);
  } else {
    // 未知版本：按约定拼 URL，无 sha256（仅记录，提示未校验）
    const suffix = archSuffix(state.arch);
    asset = {
      file: `MAA-${version || MAA_VERSION}-${suffix}.tar.gz`,
      url: `https://github.com/MaaAssistantArknights/MaaAssistantArknights/releases/download/${version || MAA_VERSION}/MAA-${version || MAA_VERSION}-${suffix}.tar.gz`,
      sha256: null,
    };
  }
  logger.info('runtime', `准备下载 ${asset.file}${asset.sha256 ? '（将校验 sha256）' : '（无官方摘要，跳过校验）'}`);
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
    if (asset.sha256) {
      if (digest !== asset.sha256) {
        fs.rmSync(tmpFile, { force: true });
        throw new Error(`sha256 mismatch: expected ${asset.sha256}, got ${digest}`);
      }
      logger.info('runtime', 'sha256 verified');
    } else {
      logger.warn('runtime', `跳过 sha256 校验（官方未提供摘要），实际摘要 ${digest}`);
    }

    setStatus('extracting');
    await extractTar(tmpFile);
    fs.rmSync(tmpFile, { force: true });

    const installedVersion = version || MAA_VERSION;
    writeMarker({
      maaVersion: installedVersion,
      sha256: asset.sha256 || digest,
      asset: asset.file,
      arch: state.arch,
      fetchedAt: new Date().toISOString(),
    });
    state.fetchedAt = new Date().toISOString();
    state.installed = installedVersion;
    state.maaVersion = installedVersion;
    setStatus('ready');
    logger.info('runtime', `MAA ${installedVersion} runtime ready at ${runtimeRoot()}`);
    // 运行包被替换：通知 runner 清掉已加载的 MaaCore 资源缓存
    try { if (onReplacedFn) onReplacedFn(installedVersion); } catch { /* ignore */ }
    return true;
  } catch (err) {
    setStatus('error', err.message);
    logger.error('runtime', err.message);
    throw err;
  } finally {
    state.busy = false;
  }
}

/** 运行时被替换后的回调（runner 用它清掉 MaaCore 资源缓存） */
let onReplacedFn = null;
function onRuntimeReplaced(fn) {
  onReplacedFn = fn;
}

function archSuffix(arch) {
  return arch === 'arm64' ? 'linux-aarch64' : 'linux-x86_64';
}

/**
 * 查询 GitHub 最新 release 并与本地已安装版本对比。
 * 返回 { installed, latest, updateAvailable, asset, publishedAt, releaseName, error }。
 *
 * 默认只看正式 release；includePrerelease=true 时把 beta/alpha/rc 也纳入候选
 * （否则上游只发预发布时，这里会一直报「已是最新」，而实际上游已经走在前面）。
 */
async function checkUpdate({ force = false, includePrerelease = false } = {}) {
  if (!force && state.updateCheckedAt && Date.now() - state.updateCheckedAt < UPDATE_CACHE_MS) {
    return {
      installed: state.installed,
      latest: state.latest,
      updateAvailable: !!state.latest && state.latest !== state.installed,
      cached: true,
    };
  }
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy || '';
  const opts = { redirect: 'follow', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'maa-docker-web' } };
  if (proxyUrl) {
    const { ProxyAgent } = require('undici');
    opts.dispatcher = new ProxyAgent(proxyUrl);
  }
  try {
    const res = await fetch(`${RELEASES_API}?per_page=20`, opts);
    if (!res.ok) throw new Error(`releases API HTTP ${res.status}`);
    const list = await res.json();
    if (!Array.isArray(list) || !list.length) throw new Error('releases API 返回为空');
    // 必须在同一个 list 里挑，不能分别查「最新正式版」和「最新预发布版」，
    // 否则无法判断哪个更新（beta 通常更靠前）。
    const useable = list.filter((r) => !r.draft).filter((r) => {
      const name = r.tag_name || r.name || '';
      if (includePrerelease) return true;
      return !r.prerelease && !PRE_RELEASE_RE.test(name);
    });
    const rel = useable[0] || list[0];
    const latest = rel.tag_name || rel.name || null;
    if (!latest) throw new Error('release 缺少 tag_name');
    const want = `MAA-${latest}-${archSuffix(state.arch)}.tar.gz`;
    const asset = (rel.assets || []).find((a) => a.name === want) || null;
    state.latest = latest;
    state.latestPrerelease = !!rel.prerelease || PRE_RELEASE_RE.test(latest);
    state.latestPublishedAt = rel.published_at || null;
    state.updateCheckedAt = Date.now();
    return {
      installed: state.installed || null,
      pinned: MAA_VERSION,
      latest,
      latestPrerelease: state.latestPrerelease,
      includePrerelease,
      updateAvailable: !!latest && latest !== state.installed,
      releaseName: rel.name || '',
      publishedAt: rel.published_at || null,
      asset: asset ? {
        name: asset.name,
        size: asset.size,
        digest: asset.digest || null,
        url: asset.browser_download_url,
      } : null,
    };
  } catch (err) {
    logger.warn('runtime', `检查更新失败: ${err.message}`);
    return { installed: state.installed || null, latest: null, updateAvailable: false, error: err.message };
  }
}

/** Locate key paths inside the extracted runtime. */
function resourcesInfo() {
  const root = runtimeRoot();
  // 必须用磁盘上实际安装的版本（state.installed），不能写死引导版本 MAA_VERSION：
  // 运行包可在应用内独立升级，写死会让首页「资源版本」永远停在引导版本
  // （真机反馈：升到 v6.18.0-beta.1 后仍显示 v6.17.5）。
  const installed = state.installed || MAA_VERSION;
  if (!root) return { present: false, maaVersion: installed, installed };
  const candidates = ['resource', path.join('files', 'resource')];
  let resourceDir = null;
  for (const c of candidates) {
    const p = path.join(root, c);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      resourceDir = p;
      break;
    }
  }
  let entries = 0;
  if (resourceDir) {
    try {
      entries = fs.readdirSync(resourceDir).filter((f) => !f.startsWith('.')).length;
    } catch {
      entries = 0;
    }
  }
  return {
    present: true,
    maaVersion: installed,
    installed,
    pinned: MAA_VERSION,
    root,
    resourceDir,
    entries,
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
    installed: state.installed,
    latest: state.latest,
    latestPrerelease: state.latestPrerelease,
    status: state.status,
    // maaVersion 是引导版本（不会随应用内升级变化），装了什么版本看 installed。
    // 保留该字段仅为兼容既有调用方；前端请优先用 installed。
    maaVersion: state.installed || state.maaVersion,
    pinned: state.maaVersion,
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
  checkUpdate,
  onRuntimeReplaced,
  ASSETS,
  init,
  fetchRuntime,
  resourcesInfo,
  verify,
  status,
  // exported for tests only
  _internal: { sha256File, runtimeRoot, markerPath, readMarker, assetFor },
};
