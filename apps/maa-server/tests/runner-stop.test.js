'use strict';

/**
 * 停止状态机回归测试。
 *
 * 背景（真机踩过）：MaaCore 只有在有任务链在跑时才回 TaskChainStopped。
 * 以前 stop() 一律把 phase 设成 'stopping' 就等回调，而 busy() 把 stopping
 * 算作忙 —— 用户在「没有任务在跑」时点一下顶栏「断开」，服务端就永久卡在
 * stopping，之后所有连接测试 / 开始任务都被「任务执行中」拒绝，只能重启容器。
 *
 * 这里故意不加载真正的 libMaaCore（koffi 绑定在 CI/Windows 上都不可用），
 * 用桩件驱动 runner 的状态机。
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Module = require('node:module');

const SRC = path.join(__dirname, '..', 'src');

/** 把 runner.js 的依赖换成桩件（必须在 require runner 之前调用） */
function stub(rel, exports) {
  const p = path.join(SRC, rel.endsWith('.js') ? rel : rel + '.js');
  const m = new Module(p, module);
  m.filename = p;
  m.paths = [];
  m.exports = exports;
  m.loaded = true;
  require.cache[p] = m;
  return m.exports;
}

function makeHarness() {
  // 每个用例都要一份干净的 runner 实例（state / session 是模块级变量）
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(SRC)) delete require.cache[k];
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maa-stop-'));
  fs.writeFileSync(path.join(dir, 'connection.json'), JSON.stringify({
    address: '127.0.0.1:5555', config: 'General', adbPath: '/usr/bin/adb',
  }));

  const calls = { stop: 0, destroy: 0, create: 0 };
  const F = {
    setUserDir: () => true,
    loadResource: () => true,
    createEx: () => { calls.create += 1; return { handle: 1 }; },
    asyncConnect: () => true,
    connected: () => true,
    stop: () => { calls.stop += 1; return 1; },
    destroy: () => { calls.destroy += 1; },
    getVersion: () => 'v6.17.5',
  };
  stub('maa-core', { funcs: () => F, available: () => ({ ok: true }), registerCallback: () => ({ cb: true }) });
  stub('runtime', {
    _internal: { runtimeRoot: () => '/tmp/maa-runtime' },
    status: () => ({ installed: 'v6.17.5' }),
    onRuntimeReplaced: () => () => {},
  });
  stub('config', { CONFIG_DIR: () => dir });
  const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  log.logger = log; // 两种写法都支持：require('./logger').logger / { logger }
  stub('logger', log);

  // adb 桩件：真机/Windows 上都没有 adb，adbPreconnect 的轮询会白等 45s
  const cp = require('node:child_process');
  const { EventEmitter } = require('node:events');
  cp.spawn = () => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    setImmediate(() => {
      p.stdout.emit('data', Buffer.from('List of devices attached\n127.0.0.1:5555\tdevice\n'));
      p.emit('close', 0);
    });
    return p;
  };

  const runner = require(path.join(SRC, 'runner.js'));
  return { runner, calls, dir };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('没有任务在跑时点停止：立即收尾并释放会话，不能卡在 stopping', async () => {
  const { runner, calls } = makeHarness();

  // warmup 会建出一个「已连接但没有任务」的会话 —— 正是卡死现场
  runner.warmup(0);
  await sleep(1000); // ensureSession 首次判定在 500ms 之后
  assert.equal(runner.snapshot().connected, true, '预热后应当已连接');
  assert.equal(runner.busy(), false, '空闲会话不应算作忙');

  const after = runner.stop();
  assert.equal(after.phase, 'done', '停止后必须离开 busy 集合');
  assert.equal(runner.busy(), false, 'busy() 仍为真 → 之后所有操作都会被「任务执行中」拒绝');
  assert.equal(after.connected, false, '停止（断开）后不应再显示已连接');
  assert.equal(calls.stop, 1, '应当真的调用了 AsstStop');

  // 会话释放后仍可再次停止，且不改状态
  const again = runner.stop();
  assert.equal(again.phase, 'done');

  // 关键：停完之后连接测试必须能跑（以前这里会被 busy() 直接拒绝）
  runner.testConnect();
  await sleep(100);
  assert.notEqual(
    (runner.connectTestState().detail || '').indexOf('任务执行中'), 0,
    'stopping 残留会让连接测试被「任务执行中」拒绝');
});

test('停止后 watchdog 不会把已经完成的阶段改回去', async () => {
  const { runner } = makeHarness();
  runner.warmup(0);
  await sleep(1000); // ensureSession 首次判定在 500ms 之后
  runner.stop();
  assert.equal(runner.snapshot().phase, 'done');
  await sleep(300);
  assert.equal(runner.snapshot().phase, 'done');
});
