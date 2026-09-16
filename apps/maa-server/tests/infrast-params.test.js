'use strict';

/**
 * 协议归一化回归测试。
 *
 * 真机踩过：界面用的是给人看的语义值（manufacture / manu_gold / "normal" /
 * 百分比阈值），MaaCore 的 InfrastTask::set_params 认的是另一套（Mfg / PureGold /
 * 0 / 0.3）。取值非法时 set_params 返回 false，AsstAppendTask 随之返回 0，
 * 表现为「追加任务失败: 基建换班」，而 MaaCore 不会告诉你是哪个字段。
 *
 * 这里同样用桩件驱动，不加载真正的 libMaaCore。
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Module = require('node:module');

const SRC = path.join(__dirname, '..', 'src');

function stub(rel, exports) {
  const p = path.join(SRC, rel.endsWith('.js') ? rel : rel + '.js');
  const m = new Module(p, module);
  m.filename = p; m.paths = []; m.exports = exports; m.loaded = true;
  require.cache[p] = m;
}

function loadRunner() {
  for (const k of Object.keys(require.cache)) {
    if (k.startsWith(SRC)) delete require.cache[k];
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maa-norm-'));
  fs.writeFileSync(path.join(dir, 'connection.json'), JSON.stringify({ address: '127.0.0.1:5555' }));
  stub('maa-core', { funcs: () => ({}), available: () => ({ ok: true }), registerCallback: () => ({}) });
  stub('runtime', { _internal: { runtimeRoot: () => '/tmp' }, status: () => ({}), onRuntimeReplaced: () => () => {} });
  stub('config', { CONFIG_DIR: () => dir });
  const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  log.logger = log;
  stub('logger', log);
  return require(path.join(SRC, 'runner.js'));
}

test('基建换班：界面语义值归一化为协议值', () => {
  const runner = loadRunner();
  const p = runner.buildParams('Infrast', {
    mode: 'normal',
    drones: 'manu_gold',
    threshold: 30,
    facility: ['power', 'office', 'control', 'manufacture', 'trade', 'reception', 'dormitory', 'workshop', 'training'],
  }, { connection: {} });

  assert.deepEqual(p.facility, ['Power', 'Office', 'Control', 'Mfg', 'Trade', 'Reception', 'Dorm', 'Processing', 'Training']);
  assert.equal(p.drones, 'PureGold');
  assert.equal(p.threshold, 0.3);
  assert.strictEqual(p.mode, 0, 'mode 必须是数字，字符串会被 MaaCore 拒绝');
});

test('基建换班：自定义模式 / 队列轮换不被 Number() 吃掉', () => {
  const runner = loadRunner();
  assert.strictEqual(runner.buildParams('Infrast', { mode: 'custom' }, { connection: {} }).mode, 10000);
  assert.strictEqual(runner.buildParams('Infrast', { mode: 'queue' }, { connection: {} }).mode, 20000);
  const r = runner.buildParams('Infrast', {}, { connection: {} });
  assert.strictEqual(r.mode, 0);
  assert.deepEqual(r.facility, ['Mfg', 'Trade', 'Power', 'Control', 'Reception', 'Office', 'Dorm'],
    '设施为空时回落到默认集，不能下发空数组');
});

test('协议声明为 array 的字段：字符串自动切成数组（菲亚梅塔目标等）', () => {
  const runner = loadRunner();
  assert.deepEqual(runner.buildParams('Infrast', { fiammetta_targets: '清流' }, { connection: {} }).fiammetta_targets, ['清流']);
  assert.deepEqual(runner.buildParams('Infrast', { fiammetta_targets: '清流；可露希尔' }, { connection: {} }).fiammetta_targets,
    ['清流', '可露希尔']);
});

test('基建换班：无人机未知取值回落到 _NotUse（协议枚举）', () => {
  const runner = loadRunner();
  assert.equal(runner.buildParams('Infrast', { drones: 'manu_gold' }, { connection: {} }).drones, 'PureGold');
  assert.equal(runner.buildParams('Infrast', { drones: 'trade_order' }, { connection: {} }).drones, 'Money');
  assert.equal(runner.buildParams('Infrast', { drones: '乱写的' }, { connection: {} }).drones, '_NotUse');
  assert.equal(runner.buildParams('Infrast', { drones: 'none' }, { connection: {} }).drones, '_NotUse');
});
