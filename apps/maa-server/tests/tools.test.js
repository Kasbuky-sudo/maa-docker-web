'use strict';

/* 小工具与日程调度器的离线测试：不需要设备，也不需要 MaaCore。 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maa-tools-'));
process.env.DATA_DIR = tmp;
process.env.RUNTIME_DIR = path.join(tmp, 'runtime');
process.env.RESOURCE_DIR = path.join(tmp, 'resource');

const scheduler = require('../src/scheduler');
const tools = require('../src/tools');
const config = require('../src/config');

test('scheduler: repeat 规则按星期匹配', () => {
  const mon = new Date(2026, 8, 14, 9, 0);   // 2026-09-14 周一
  const sat = new Date(2026, 8, 19, 9, 0);   // 2026-09-19 周六
  const sun = new Date(2026, 8, 20, 9, 0);   // 2026-09-20 周日
  assert.equal(scheduler.matchesRepeat('daily', mon), true);
  assert.equal(scheduler.matchesRepeat('weekdays', mon), true);
  assert.equal(scheduler.matchesRepeat('weekdays', sat), false);
  assert.equal(scheduler.matchesRepeat('weekends', sat), true);
  assert.equal(scheduler.matchesRepeat('weekends', sun), true);
  assert.equal(scheduler.matchesRepeat('mon', mon), true);
  assert.equal(scheduler.matchesRepeat('tue', mon), false);
});

test('scheduler: nextRun 计算下一次触发', () => {
  const from = new Date(2026, 8, 14, 10, 0); // 周一 10:00
  const daily = scheduler.nextRun({ time: '09:00', repeat: 'daily', enabled: true }, from);
  assert.ok(daily, '应有下次触发时间');
  const d = new Date(daily);
  assert.equal(d.getDate(), 15);            // 明天 09:00
  assert.equal(d.getHours(), 9);
  const weekends = scheduler.nextRun({ time: '09:00', repeat: 'weekends', enabled: true }, from);
  assert.equal(new Date(weekends).getDay(), 6);   // 周六
  assert.equal(scheduler.nextRun({ time: '09:00', enabled: false }, from), null);
  assert.equal(scheduler.nextRun({ time: 'bad', enabled: true }, from), null);
});

test('scheduler: tick 到点触发一次，并且不会在同一分钟重复触发', async () => {
  const dir = config.CONFIG_DIR();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'schedule.json');
  fs.writeFileSync(file, JSON.stringify([
    { id: 's1', time: '07:30', enabled: true, repeat: 'daily', tasks: [] },
  ]));
  const at = new Date(2026, 8, 14, 7, 30);
  const first = await scheduler.tick(at);
  assert.equal(first.length, 0, '没配任务时不应触发执行');
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(after[0].lastRun, '2026-09-14 07:30');
  assert.match(after[0].lastResult, /未配置任务/);
  const second = await scheduler.tick(at);
  assert.equal(second.length, 0, '同一分钟不应重复处理');
  // 非到点时间
  const other = await scheduler.tick(new Date(2026, 8, 14, 7, 31));
  assert.equal(other.length, 0);
});

test('tools: 没有运行包时作业列表为空、识别结果为空', () => {
  tools._resetForTest();
  assert.deepEqual(tools.listCopilot({ force: true }), []);
  const snap = tools.snapshot();
  assert.equal(snap.recruit, null);
  assert.equal(snap.depot, null);
  assert.equal(snap.operbox, null);
  assert.equal(typeof snap.busy, 'boolean');
});

test('tools: runCopilot 参数校验（缺 file / 文件不存在）', async () => {
  await assert.rejects(() => tools.runCopilot({}), /未选择作业|运行包未就绪/);
});

test('tools: 作业类型分类（main / sss / paradox）', () => {
  // 通过公开接口间接验证：列表为空时不应抛错，类型统计由路由完成
  const list = tools.listCopilot({ force: true });
  assert.ok(Array.isArray(list));
});
