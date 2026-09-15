'use strict';

// Task execution pipeline: drives libMaaCore via maa-core.js.
// One MaaCore session at a time (single Arknights client per container).

const fs = require('node:fs');
const path = require('node:path');
const { logger } = require('./logger');
const runtime = require('./runtime');
const maaCore = require('./maa-core');
const config = require('./config');

// AsstMsgId values from the MAA protocol
const MSG_ALL_TASKS_COMPLETED = 1;
const MSG_TASK_CHAIN_ERROR = 10000;
const MSG_TASK_CHAIN_START = 10001;
const MSG_TASK_CHAIN_COMPLETED = 10002;
const MSG_TASK_CHAIN_STOPPED = 10004;
const MSG_SUBTASK_ERROR = 20000;

let state = {
  phase: 'idle', // idle|loading|connecting|running|stopping|done|error
  detail: '',
  tasks: [],
  startedAt: null,
  finishedAt: null,
};
let session = null; // { handle, cbRef }
let seq = 0;

function snapshot() {
  const conn = readConnection();
  let connected = false;
  if (session) {
    try { connected = !!maaCore.funcs().connected(session.handle); } catch { connected = false; }
  }
  return {
    ...state,
    connected,
    connection: { address: conn.address || '', config: conn.config || 'General', adbPath: conn.adbPath || '' },
    maa: maaCore.available(),
    maaVersion: safeVersion(),
  };
}

function safeVersion() {
  try { return maaCore.funcs().getVersion(); } catch { return null; }
}

function busy() {
  return ['loading', 'connecting', 'running', 'stopping'].includes(state.phase);
}

function onCallback(msg, detailsJson) {
  let d = {};
  try { d = JSON.parse(detailsJson || '{}'); } catch { /* ignore */ }
  const chain = (d.details && d.details.chain) || d.chain || '';
  try {
    switch (msg) {
      case MSG_ALL_TASKS_COMPLETED:
        state.phase = 'done';
        state.detail = '全部任务完成';
        state.finishedAt = Date.now();
        logger.info('runner', '全部任务完成');
        teardown(2000);
        break;
      case MSG_TASK_CHAIN_ERROR:
        state.phase = 'error';
        state.detail = `任务链出错: ${chain || d.what || '未知'}`;
        state.finishedAt = Date.now();
        logger.error('runner', `任务链出错: ${chain || d.what || ''}`);
        teardown(2000);
        break;
      case MSG_TASK_CHAIN_START:
        logger.info('runner', `任务链开始: ${chain}`);
        break;
      case MSG_TASK_CHAIN_COMPLETED:
        logger.info('runner', `任务链完成: ${chain}`);
        break;
      case MSG_TASK_CHAIN_STOPPED:
        state.phase = 'done';
        state.detail = '已停止';
        state.finishedAt = Date.now();
        logger.info('runner', '任务已停止');
        teardown(1500);
        break;
      case MSG_SUBTASK_ERROR:
        logger.warn('runner', `子任务出错: ${d.what || ''}`);
        break;
      default:
        if (d.what) logger.debug('runner', `msg=${msg} what=${d.what}`);
    }
  } catch { /* never throw inside the native callback thread */ }
}

function teardown(delayMs) {
  const s = session;
  session = null;
  if (!s) return;
  setTimeout(() => {
    try {
      const f = maaCore.funcs();
      f.destroy(s.handle);
      const koffi = require('koffi');
      koffi.unregister(s.cbRef);
    } catch { /* already gone */ }
  }, delayMs);
}

function readConnection() {
  const file = path.join(config.CONFIG_DIR(), 'connection.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function readTaskConfig() {
  const file = path.join(config.CONFIG_DIR(), 'tasks.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

// catalog option values -> MAA integration-protocol task params
function buildParams(taskType, opts) {
  const o = opts || {};
  const arr = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,，;；]/).map((s) => s.trim()).filter(Boolean));
  switch (taskType) {
    case 'Fight':
      return {
        stage: o.stage || '',
        medicine: Number(o.medicine) || 0,
        stone: Number(o.stone) || 0,
        times: Number(o.times) || 10000,
        series: Number(o.series) || 1,
        client_type: o.client_type || 'Official',
        drops: { report_to_penguin: !!o.report_to_penguin },
      };
    case 'Infrast':
      return {
        mode: o.mode === 'custom' ? 10000 : 0,
        facility: arr(o.facility),
        drones: o.drones || '_NotUse',
        threshold: Number(o.threshold) || 0.3,
        replenish: !!o.replenish,
      };
    case 'Award':
      return {
        award: o.award !== false,
        mail: o.mail !== false,
        recruit: !!o.recruit,
        orundum: !!o.orundum,
        mining: !!o.mining,
        specialaccess: !!o.specialaccess,
      };
    case 'Recruit':
      return {
        refresh: !!o.refresh,
        select: arr(o.select).map(Number),
        confirm: arr(o.confirm).map(Number),
        times: Number(o.times) || 4,
        expedite: !!o.expedite,
        skip_robot: o.skip_robot !== false,
      };
    case 'Mall':
      return {
        credit_fight: !!o.credit_fight,
        buy_first: arr(o.buy_first),
        black_list: arr(o.black_list),
      };
    case 'Roguelike':
      return {
        theme: o.theme || 'Sarkaz',
        mode: Number(o.mode) || 0,
        starts_count: Number(o.starts_count) || 99999,
        investment_enabled: o.investment_enabled !== false,
        stops_when_investment_full: !!o.stops_when_investment_full,
        squad: o.squad || '',
        roles: o.roles || '',
        core_char: o.core_char || '',
      };
    case 'ReclamationAlgorithm':
      return { mode: Number(o.mode) || 1 };
    default:
      return {};
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start(selectedTaskIds) {
  if (busy()) throw Object.assign(new Error('已有任务在执行中'), { statusCode: 409 });

  const catalog = require('./task-catalog.json');
  const byId = new Map(catalog.tasks.map((t) => [t.id, t]));
  const ids = [...new Set(selectedTaskIds || [])].filter((id) => byId.has(id));
  if (!ids.length) throw Object.assign(new Error('未选择任何有效任务'), { statusCode: 400 });

  const conn = readConnection();
  if (!conn.address) {
    throw Object.assign(new Error('尚未配置设备连接地址（设置 → 连接设置）'), { statusCode: 409 });
  }
  const adbPath = conn.adbPath || '/usr/bin/adb';

  const dir = runtime._internal.runtimeRoot();
  if (!dir) throw Object.assign(new Error('MAA 运行包未就绪（请先在 Runtime 页下载）'), { statusCode: 409 });

  const f = maaCore.funcs(); // throws if koffi/so unavailable
  const saved = readTaskConfig();

  // merge catalog defaults + user config per task
  const jobs = ids.map((id) => {
    const t = byId.get(id);
    const defaults = {};
    for (const opt of t.options || []) {
      defaults[opt.id] = opt.choicesFrom ? catalog[opt.choicesFrom][0].value : opt.default;
    }
    return { task: t, params: buildParams(t.taskType, { ...defaults, ...(saved[id] || {}) }) };
  });

  const cbRef = maaCore.registerCallback((msg, details, arg) => onCallback(msg, details, arg));

  state = { phase: 'loading', detail: '加载资源中', tasks: ids, startedAt: Date.now(), finishedAt: null };
  seq += 1;

  f.setUserDir(dir);
  if (!f.loadResource(dir)) {
    throw new Error('AsstLoadResource 失败：运行包资源不完整？');
  }
  const handle = f.createEx(cbRef, null);
  if (!handle) throw new Error('AsstCreateEx 失败：无法创建 MaaCore 实例');
  session = { handle, cbRef };
  logger.info('runner', `MaaCore 实例已创建（MAA ${f.getVersion()}），开始连接 ${conn.address}`);

  state.phase = 'connecting';
  state.detail = '连接设备中';
  f.asyncConnect(handle, adbPath, conn.address, conn.config || 'General', 0);
  let connected = false;
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    if (session !== null && session.handle !== handle) throw new Error('会话已重置');
    if (state.phase === 'error') throw new Error(state.detail || '连接失败');
    if (f.connected(handle)) { connected = true; break; }
  }
  if (!connected) throw new Error(`连接设备超时（${conn.address}），请检查 ADB 地址与网络`);
  logger.info('runner', `设备已连接: ${conn.address}`);

  const taskIds = [];
  for (const j of jobs) {
    const id = f.appendTask(handle, j.task.taskType, JSON.stringify(j.params));
    if (!id || id < 0) throw new Error(`追加任务失败: ${j.task.name}`);
    taskIds.push(id);
    logger.info('runner', `追加任务 ${j.task.name} (#${id}) params=${JSON.stringify(j.params)}`);
  }

  // 任务完成后的动作 —— MaaCore 的 CloseDown 任务。
  // 只有 shutdown 取值有协议文档（None/Sleep/Hibernate/Shutdown）；
  // 退出游戏/模拟器为附加字段（MAA 对未知字段容错）。
  const postAction = (saved._meta && saved._meta.postAction) || 'None';
  if (postAction !== 'None') {
    const post = { client_type: 'Official' };
    if (['Sleep', 'Hibernate', 'Shutdown'].includes(postAction)) post.shutdown = postAction;
    if (postAction === 'ExitGame') post.exit_game = true;
    if (postAction === 'ExitEmulator') post.exit_emulator = true;
    const id = f.appendTask(handle, 'CloseDown', JSON.stringify(post));
    if (id > 0) logger.info('runner', `追加完成后动作 CloseDown (#${id}) params=${JSON.stringify(post)}`);
  }

  if (!f.start(handle)) throw new Error('AsstStart 失败');
  state.phase = 'running';
  state.detail = `执行中（${jobs.length} 项任务）`;
  logger.info('runner', `任务开始执行: ${ids.join(', ')}`);
  return snapshot();
}

function stop() {
  if (!session) return snapshot();
  try { maaCore.funcs().stop(session.handle); } catch { /* ignore */ }
  state.phase = 'stopping';
  state.detail = '停止中';
  logger.info('runner', '收到停止指令');
  return snapshot();
}

// Probe an ADB device without appending tasks: load resources, connect, disconnect.
async function testConnect() {
  if (busy()) throw Object.assign(new Error('任务执行中，无法测试连接'), { statusCode: 409 });
  const conn = readConnection();
  if (!conn.address) throw Object.assign(new Error('尚未填写设备地址'), { statusCode: 400 });
  const dir = runtime._internal.runtimeRoot();
  if (!dir) throw Object.assign(new Error('MAA 运行包未就绪'), { statusCode: 409 });
  const f = maaCore.funcs();
  const cbRef = maaCore.registerCallback(() => {});
  const started = Date.now();
  let handle = null;
  try {
    f.setUserDir(dir);
    if (!f.loadResource(dir)) throw new Error('资源加载失败');
    handle = f.createEx(cbRef, null);
    if (!handle) throw new Error('创建 MaaCore 实例失败');
    f.asyncConnect(handle, conn.adbPath || '/usr/bin/adb', conn.address, conn.config || 'General', 0);
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      if (f.connected(handle)) {
        const ms = Date.now() - started;
        logger.info('runner', `连接测试成功: ${conn.address} (${ms} ms)`);
        return { ok: true, address: conn.address, ms, maaVersion: f.getVersion() };
      }
    }
    throw new Error(`连接超时（${conn.address}）`);
  } catch (e) {
    logger.warn('runner', `连接测试失败: ${e.message}`);
    return { ok: false, address: conn.address, error: e.message };
  } finally {
    try { if (handle) f.destroy(handle); } catch { /* ignore */ }
    try { require('koffi').unregister(cbRef); } catch { /* ignore */ }
  }
}

module.exports = { snapshot, start, stop, testConnect, busy, buildParams, _resetForTest: () => { state = { phase: 'idle', detail: '', tasks: [], startedAt: null, finishedAt: null }; } };
