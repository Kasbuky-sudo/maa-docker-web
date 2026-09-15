'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const config = require('../src/config');
const runtime = require('../src/runtime');

test('config: defaults, save whitelist and validation', () => {
  delete process.env.LOG_LEVEL;
  delete process.env.AUTO_FETCH_RUNTIME;
  delete process.env.TZ;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maa-cfg-'));
  process.env.DATA_DIR = tmp;
  process.env.CONFIG_DIR = path.join(tmp, 'config');
  config.resetForTest();

  const loaded = config.load();
  assert.equal(loaded.serverName, 'MAA for NAS');
  assert.equal(loaded.logLevel, 'info');

  const saved = config.save({ logLevel: 'debug', hackerField: 'nope' });
  assert.equal(saved.logLevel, 'debug');
  assert.equal(saved.hackerField, undefined);

  const bad = config.validate({ logLevel: 'loud' });
  assert.equal(bad.valid, false);

  config.resetForTest();
});

test('runtime: asset selection per architecture', () => {
  const a = runtime._internal.assetFor('x64');
  assert.match(a.file, /linux-x86_64\.tar\.gz$/);
  const b = runtime._internal.assetFor('arm64');
  assert.match(b.file, /linux-aarch64\.tar\.gz$/);
  assert.equal(runtime.ASSETS.x64.sha256.length, 64);
  assert.equal(runtime.ASSETS.arm64.sha256.length, 64);
});

test('runtime: sha256 helper computes correct digest', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maa-sha-'));
  const file = path.join(tmp, 'hello.txt');
  fs.writeFileSync(file, 'hello world\n');
  const digest = await runtime._internal.sha256File(file);
  // well-known sha256 of "hello world\n"
  assert.equal(digest, 'a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447');
});

test('runtime: status reports uninitialized on empty dir', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maa-rt-'));
  process.env.DATA_DIR = tmp;
  process.env.RUNTIME_DIR = path.join(tmp, 'runtime');
  process.env.RESOURCE_DIR = path.join(tmp, 'resource');
  const ok = runtime.init();
  assert.equal(ok, false);
  assert.equal(runtime.status().status, 'uninitialized');
  assert.equal(runtime.resourcesInfo().present, false);
});

test('runtime: flat layout detection (official tarball extracts flat)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maa-flat-'));
  const rtDir = path.join(tmp, 'runtime');
  fs.mkdirSync(path.join(rtDir, 'resource', 'onnx'), { recursive: true });
  fs.mkdirSync(path.join(rtDir, 'Python'), { recursive: true });
  fs.writeFileSync(path.join(rtDir, 'libMaaCore.so'), 'fake');
  process.env.DATA_DIR = tmp;
  process.env.RUNTIME_DIR = rtDir;
  process.env.RESOURCE_DIR = path.join(tmp, 'resource');
  assert.equal(runtime._internal.runtimeRoot(), rtDir);
  const info = runtime.resourcesInfo();
  assert.equal(info.present, true);
  assert.equal(info.resourceDir, path.join(rtDir, 'resource'));
  const v = runtime.verify();
  assert.equal(v.ok, true);
  const nested = v.checks.find((c) => c.name === 'MaaCore library');
  assert.equal(nested.ok, true);
});
