'use strict';

// Task execution pipeline: drives libMaaCore via maa-core.js.
// One MaaCore session at a time (single Arknights client per container).

const fs = require('node:fs');
const path = require('node:path');
const { logger } = require('./logger');
const runtime = require('./runtime');
const maaCore = require('./maa-core');
const config = require('./config');

// AsstMsgId values — 依据运行包内 Python 绑定（resource/Python/asst/utils.py 的
// Message 枚举）核对，切勿凭记忆写：0=InternalError 1=InitFailed 2=ConnectionInfo
// 3=AllTasksCompleted 4=AsyncCallInfo 5=Destroyed
const MSG_INTERNAL_ERROR = 0;
const MSG_INIT_FAILED = 1;
const MSG_CONNECTION_INFO = 2;
const MSG_ALL_TASKS_COMPLETED = 3;
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

// 连接测试：异步执行，进度通过 /api/runner/status 暴露，避免长请求被反代掐断（504）
let connectTest = {
  running: false,
  ok: null,        // null=未跑过 / true / false
  detail: '',
  address: '',
  ms: null,
  startedAt: null,
  finishedAt: null,
};
let session = null; // { handle, cbRef, address }
let seq = 0;
let resourceKey = null;        // 已加载进 MaaCore 的 runtime（目录#版本），避免重复 loadResource
let connectedNotifiedAt = 0;   // 最近一次 MaaCore 报 Connected 的时间

// 运行包被下载/更新替换后：作废资源缓存并断开旧会话（否则会继续用旧资源）
runtime.onRuntimeReplaced(() => {
  resourceKey = null;
  teardown(0);
  logger.info('runner', '运行包已更新，MaaCore 资源缓存与会话已重置');
});

/** 资源只需加载一次（AsstLoadResource 是同步阻塞调用，重复调用会卡住整个事件循环） */
function ensureResource(f, dir) {
  const key = `${dir}#${(runtime.status() || {}).installed || 'unknown'}`;
  if (resourceKey === key) return false;
  state.phase = 'loading';
  state.detail = '加载资源中';
  f.setUserDir(dir);
  if (!f.loadResource(dir)) throw new Error('AsstLoadResource 失败：运行包资源不完整？');
  resourceKey = key;
  logger.info('runner', `MaaCore 资源已加载（${key}）`);
  return true;
}

/**
 * 取得一个「已连接」的 MaaCore 会话：能用就复用，不能用才重建。
 * 复用可以让「连接测试」的成功状态延续到「开始任务」，省掉重复的 60s 握手。
 */
async function ensureSession(f, dir, conn, adbPath, waitMs = 90000) {
  if (session && session.address === conn.address) {
    let ok = false;
    try { ok = !!f.connected(session.handle); } catch { ok = false; }
    if (ok) {
      logger.info('runner', `复用已连接会话: ${conn.address}`);
      return session;
    }
  }
  if (session) teardown(0);

  ensureResource(f, dir);
  const cbRef = maaCore.registerCallback((msg, details, arg) => onCallback(msg, details, arg));
  const handle = f.createEx(cbRef, null);
  if (!handle) {
    try { require('koffi').unregister(cbRef); } catch { /* ignore */ }
    throw new Error('AsstCreateEx 失败：无法创建 MaaCore 实例');
  }
  session = { handle, cbRef, address: conn.address };
  logger.info('runner', `MaaCore 实例已创建（MAA ${f.getVersion()}），开始连接 ${conn.address}`);

  try {
    if (conn.touchMode && f.setInstanceOption) {
      const ok = f.setInstanceOption(handle, 2, String(conn.touchMode));
      logger.info('runner', `触控模式设为 ${conn.touchMode}（${ok ? '成功' : '未接受'}）`);
    }
    if (conn.clientType && f.setInstanceOption) {
      f.setInstanceOption(handle, 6, String(conn.clientType));
    }
  } catch (e) {
    logger.warn('runner', `设置实例选项失败: ${e.message}`);
  }

  const startedAt = Date.now();
  f.asyncConnect(handle, adbPath, conn.address, conn.config || 'General', 0);
  for (let i = 0; i < Math.ceil(waitMs / 500); i++) {
    await sleep(500);
    if (session === null || session.handle !== handle) throw new Error('会话已重置');
    if (state.phase === 'error') throw new Error(state.detail || '连接失败');
    if (connectedNotifiedAt > startedAt || f.connected(handle)) {
      logger.info('runner', `设备已连接: ${conn.address}（${Date.now() - startedAt} ms）`);
      return session;
    }
  }
  teardown(0);
  throw new Error(`连接设备超时（${conn.address}），请检查 ADB 地址与网络`);
}

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
    connectTest: { ...connectTest },
  };
}

function safeVersion() {
  try { return maaCore.funcs().getVersion(); } catch { return null; }
}

function busy() {
  return ['loading', 'connecting', 'running', 'stopping'].includes(state.phase);
}

/* 回调订阅：其它模块（如 tools.js 捕获识别结果）可订阅全部回调 */
const messageSubscribers = new Set();
function onMessage(fn) {
  messageSubscribers.add(fn);
  return () => messageSubscribers.delete(fn);
}

function onCallback(msg, detailsJson) {
  let parsedForSub = null;
  try { parsedForSub = JSON.parse(detailsJson || '{}'); } catch { parsedForSub = {}; }
  for (const fn of messageSubscribers) {
    try { fn(msg, parsedForSub); } catch { /* 订阅者出错不影响主流程 */ }
  }
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
      case MSG_INIT_FAILED:
        // 实例初始化失败（资源缺失、连接不可用等），之前被误当成「全部完成」
        state.phase = 'error';
        state.detail = `初始化失败: ${d.what || ''} ${d.why || ''}`.trim();
        state.finishedAt = Date.now();
        logger.error('runner', `MaaCore 初始化失败: ${d.what || ''} ${d.why || ''}`);
        teardown(2000);
        break;
      case MSG_CONNECTION_INFO:
        logger.info('runner', `连接信息: ${d.what || ''} ${d.why || ''}`.trim());
        if (d.what) state.detail = String(d.what);
        if (String(d.what).toLowerCase() === 'connected') connectedNotifiedAt = Date.now();
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

// catalog option values -> MAA integration-protocol task params.
// The field list and types come from maa-task-spec.json, which is generated from
// the official protocol document (scripts/gen-task-catalog.py) — so params stay
// in sync with MAA instead of being hand-mapped here.
const SPEC = require('./maa-task-spec.json');
const TASK_UI = require('./task-ui.json');

// GUI 控件（task-ui.json，逐项对照 MaaWpfGui XAML）-> 协议字段取值
function controlValue(ctl, opts) {
  const v = opts[ctl.id];
  switch (ctl.kind) {
    case 'check':
      return ctl.bind ? !!v : undefined;
    case 'check-number':
      return ctl.bind ? (v ? Number(opts[ctl.id + 'Value'] ?? ctl.number.default) : ctl.number.valueWhenOff) : undefined;
    case 'check-select':
      return ctl.bind ? (v ? opts[ctl.id + 'Value'] : undefined) : undefined;
    case 'select':
    case 'text':
      return ctl.bind ? v : undefined;
    default:
      return undefined;
  }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Fight 的关卡来源优先级：自定义剿灭 > 周计划（按当天） > 手动输入 > 关卡指定
function resolveStage(opts, params) {
  if (opts.UseCustomAnnihilation && opts.AnnihilationStage) return opts.AnnihilationStage;
  if (opts.UseWeeklySchedule && opts.WeeklySchedule && typeof opts.WeeklySchedule === 'object') {
    const day = WEEKDAYS[new Date().getDay()];
    if (opts.WeeklySchedule[day]) return opts.WeeklySchedule[day];
  }
  if (opts.CustomStageCode && opts.StageCode) return String(opts.StageCode);
  return opts.Stage !== undefined ? opts.Stage : params.stage;
}

function buildParams(taskType, opts, extra) {
  const o = opts || {};
  const spec = SPEC.tasks[taskType];
  const params = { enable: true };
  const ui = TASK_UI.tasks[taskType];

  // 1) 界面控件显式绑定的字段（MAA 桌面端同一套语义）
  if (ui) {
    for (const ctl of [...ui.basic, ...ui.advanced]) {
      if (!ctl.bind) continue;
      const v = controlValue(ctl, o);
      if (v !== undefined && v !== '' && v !== null) params[ctl.bind] = v;
    }
  }
  if (taskType === 'Fight') {
    const stage = resolveStage(o, params);
    if (stage !== undefined && stage !== '') params.stage = stage; else delete params.stage;
    // 活动结束前 48H 吃当周过期理智药：近似为 2 天窗口（MAA 内部按活动剩余天数动态计算）
    if (o.UseExpireMedicineForActivity) {
      params.medicine_expire_days = Math.max(Number(params.medicine_expire_days) || 0, 2);
    }
  }

  // 2) 其余协议字段（未出现在界面布局里的，按 spec 类型强转）
  for (const f of (spec ? spec.fields : [])) {
    if (f.name === 'enable' || params[f.name] !== undefined) continue;
    if (!(f.name in o)) continue;
    const v = o[f.name];
    switch (f.type) {
      case 'boolean':
        params[f.name] = !!v;
        break;
      case 'number': {
        const n = Number(v);
        if (Number.isFinite(n)) params[f.name] = n;
        break;
      }
      case 'array':
        params[f.name] = Array.isArray(v) ? v
          : (v === '' || v == null ? [] : String(v).split(/[,，;；]/).map((s) => s.trim()).filter(Boolean));
        break;
      case 'object':
        if (v && typeof v === 'object' && !Array.isArray(v)) params[f.name] = v;
        else if (typeof v === 'string' && v.trim()) {
          try { params[f.name] = JSON.parse(v); } catch { /* skip malformed */ }
        }
        break;
      default:
        if (v !== '' && v != null) params[f.name] = String(v);
    }
  }

  // 3) 多任务共享项
  const conn = (extra && extra.connection) || readConnection();
  if (['StartUp', 'Fight', 'Recruit'].includes(taskType) && !params.client_type) {
    params.client_type = conn.clientType || 'Official';
  }
  if (taskType === 'StartUp') {
    if (o.AccountSwitchEnabled && o.AccountName) params.account_name = String(o.AccountName);
    else delete params.account_name;
  }
  return params;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 把任务追加到实例上；jobs = [{taskType, params, label}] */
function appendJobs(f, handle, jobs) {
  const ids = [];
  for (const j of jobs) {
    const type = j.taskType || (j.task && j.task.taskType);
    const label = j.label || (j.task && j.task.name) || type;
    const id = f.appendTask(handle, type, JSON.stringify(j.params || {}));
    if (!id || id < 0) throw new Error(`追加任务失败: ${label}`);
    ids.push(id);
    logger.info('runner', `追加任务 ${label} (#${id}) type=${type} params=${JSON.stringify(j.params || {})}`);
  }
  return ids;
}

/**
 * 执行一组「一次性」任务（小工具识别、自动战斗作业等）。
 * 复用 ensureSession，因此刚做过的连接测试可以直接接着用。
 * jobs = [{taskType, params, label}]
 */
async function runTask(jobs, opts = {}) {
  if (busy()) throw Object.assign(new Error('已有任务在执行中'), { statusCode: 409 });
  const conn = readConnection();
  if (!conn.address) {
    throw Object.assign(new Error('尚未配置设备连接地址（设置 → 连接设置）'), { statusCode: 409 });
  }
  const dir = runtime._internal.runtimeRoot();
  if (!dir) throw Object.assign(new Error('MAA 运行包未就绪（请先在首页检查更新里下载）'), { statusCode: 409 });
  const f = maaCore.funcs();

  state = {
    phase: 'connecting',
    detail: opts.detail || '准备执行',
    tasks: jobs.map((j) => j.label || j.taskType),
    startedAt: Date.now(),
    finishedAt: null,
  };
  seq += 1;

  const s = await ensureSession(f, dir, conn, conn.adbPath || '/usr/bin/adb');
  const handle = s.handle;

  if (opts.postAction && opts.postAction !== 'None') {
    const post = { client_type: conn.clientType || 'Official' };
    if (['Sleep', 'Hibernate', 'Shutdown'].includes(opts.postAction)) post.shutdown = opts.postAction;
    if (opts.postAction === 'ExitGame') post.exit_game = true;
    if (opts.postAction === 'ExitEmulator') post.exit_emulator = true;
    jobs = jobs.slice();
    jobs.push({ taskType: 'CloseDown', params: post, label: '完成后动作' });
  }

  appendJobs(f, handle, jobs);
  if (!f.start(handle)) throw new Error('AsstStart 失败');
  state.phase = 'running';
  state.detail = opts.detail || `执行中（${jobs.length} 项）`;
  logger.info('runner', `开始执行: ${state.tasks.join(', ')}`);
  return snapshot();
}

/** 周计划：按今天星期取关卡列表（weekly_plan: {enabled, mon..sun: [关卡]}） */
function weeklyStagesFor(plan, date) {
  const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const list = plan[keys[date.getDay()]];
  if (!Array.isArray(list)) return [];
  return list.map((x) => String(x).trim()).filter(Boolean);
}

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
  let jobs = ids.map((id) => {
    const t = byId.get(id);
    const defaults = {};
    for (const opt of t.options || []) {
      defaults[opt.id] = opt.choicesFrom ? catalog[opt.choicesFrom][0].value : opt.default;
    }
    const opts = Object.assign(defaults, saved[id] || {});
    return { task: t, params: buildParams(t.taskType, opts, { connection: conn }), opts };
  });

  // 理智作战「周计划」：桌面端是 GUI 概念（协议无对应字段），
  // 这里在服务端实现——启用后按当天星期取计划里的关卡，展开成多个 Fight 任务。
  jobs = jobs.flatMap((j) => {
    if (j.task.taskType !== 'Fight') return [j];
    const plan = j.opts && j.opts.weekly_plan;
    if (!plan || !plan.enabled) return [j];
    const stages = weeklyStagesFor(plan, new Date());
    if (!stages.length) {
      logger.info('runner', `周计划已启用，但今天（周${'日一二三四五六'[new Date().getDay()]}）没有安排关卡，按原关卡执行`);
      return [j];
    }
    logger.info('runner', `周计划命中：今天执行 ${stages.join(', ')}`);
    return stages.map((stage, i) => ({
      task: j.task,
      params: Object.assign({}, j.params, { stage }),
      label: `理智作战 ${stage}（周计划 ${i + 1}/${stages.length}）`,
      opts: j.opts,
    }));
  });

  state = { phase: 'loading', detail: '加载资源中', tasks: ids, startedAt: Date.now(), finishedAt: null };
  seq += 1;

  state.phase = 'connecting';
  state.detail = '连接设备中';
  // 若刚做过连接测试，这里直接复用那个已连接的会话，不再重复握手
  const s2 = await ensureSession(f, dir, conn, adbPath);
  const handle = s2.handle;

  const taskIds = appendJobs(f, handle, jobs);

  // 任务完成后的动作 —— MaaCore 的 CloseDown 任务。
  // 只有 shutdown 取值有协议文档（None/Sleep/Hibernate/Shutdown）；
  // 退出游戏/模拟器为附加字段（MAA 对未知字段容错）。
  const postAction = (saved._meta && saved._meta.postAction) || 'None';
  if (postAction === 'BackToHome') {
    logger.info('runner', '完成后动作「返回模拟器主屏幕」：由 MaaCore 在任务结束时自动处理');
  } else if (postAction === 'ExitMAA') {
    logger.warn('runner', '完成后动作「退出 MAA」在 Web 版中无对应行为（服务端常驻），已忽略');
  } else if (postAction !== 'None') {
    const post = { client_type: conn.clientType || 'Official' };
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
  if (!session) {
    // 没有会话可停：把连接测试的状态也清掉（用户点「断开」）
    connectTest = { running: false, ok: null, detail: '', address: connectTest.address, ms: null, startedAt: null, finishedAt: null };
    return snapshot();
  }
  try { maaCore.funcs().stop(session.handle); } catch { /* ignore */ }
  state.phase = 'stopping';
  state.detail = '停止中';
  logger.info('runner', '收到停止指令');
  return snapshot();
}

// Probe an ADB device without appending tasks: load resources, connect, disconnect.
/**
 * 设备分辨率探测（adb shell wm size）。
 * MAA 的硬性要求是 16:9（会内部缩放到 1280×720 做模板匹配）；
 * 720p 只是推荐下限，高于 720p 也能用（只是截图/缩放更耗资源）。
 */
function probeResolution(adbPath, address) {
  return new Promise((resolve) => {
    const { spawn } = require('node:child_process');
    const p = spawn(adbPath, ['-s', address, 'shell', 'wm', 'size'], { timeout: 10000 });
    let out = '';
    p.stdout.on('data', (c) => { out += String(c); });
    p.stderr.on('data', (c) => { out += String(c); });
    p.on('error', (e) => resolve({ error: 'adb 启动失败: ' + e.message }));
    p.on('close', () => {
      const override = /Override size:\s*(\d+)x(\d+)/.exec(out);
      const physical = /Physical size:\s*(\d+)x(\d+)/.exec(out);
      let w = null, h = null, source = 'physical';
      if (override) { w = +override[1]; h = +override[2]; source = 'override'; }
      else if (physical) { w = +physical[1]; h = +physical[2]; }
      if (!w || !h) { resolve({ error: '无法解析 wm size 输出', raw: out.slice(0, 120) }); return; }
      const ratioOk = Math.abs(w / h - 16 / 9) < 0.02;
      let warning = null;
      if (!ratioOk) {
        warning = `分辨率 ${w}x${h} 不是 16:9，MAA 模板识别会失败。` +
          `可执行 adb shell wm size ${h}x${Math.round(h * 16 / 9)} 设置覆盖分辨率`;
      } else if (h < 720) {
        warning = `分辨率 ${w}x${h} 低于 720p，识别可能不稳定`;
      }
      resolve({ width: w, height: h, source, ratioOk, warning });
    });
  });
}

/* 立即返回（{started:true}），真正的连接在后台跑，结果看 status.connectTest */
function testConnect() {
  if (connectTest.running) return { started: true, alreadyRunning: true, address: connectTest.address };
  connectTest = {
    running: true, ok: null, detail: '连接测试中', address: '', ms: null,
    startedAt: Date.now(), finishedAt: null,
  };
  runConnectTest().catch((e) => {
    connectTest = {
      ...connectTest, running: false, ok: false, detail: e.message,
      finishedAt: Date.now(),
    };
  });
  return { started: true, address: connectTest.address };
}

async function runConnectTest() {
  if (busy()) throw Object.assign(new Error('任务执行中，无法测试连接'), { statusCode: 409 });
  const conn = readConnection();
  connectTest.address = conn.address || '';
  if (!conn.address) throw Object.assign(new Error('尚未填写设备地址'), { statusCode: 400 });
  const dir = runtime._internal.runtimeRoot();
  if (!dir) throw Object.assign(new Error('MAA 运行包未就绪'), { statusCode: 409 });
  const f = maaCore.funcs();
  const started = Date.now();
  const iv = setInterval(() => {
    if (connectTest.running) {
      connectTest.detail = `连接测试中（${Math.round((Date.now() - started) / 1000)}s）`;
    }
  }, 1000);
  try {
    // 复用会话：连接测试成功后会话会保留，随后「开始任务」可直接复用
    await ensureSession(f, dir, conn, conn.adbPath || '/usr/bin/adb');
    const ms = Date.now() - started;
    logger.info('runner', `连接测试成功: ${conn.address} (${ms} ms)`);
    // 分辨率体检：非 16:9 会在识别环节翻车，趁连接还在时提醒
    let resolution = null;
    try {
      resolution = await probeResolution(conn.adbPath || '/usr/bin/adb', conn.address);
      if (resolution.warning) {
        logger.warn('runner', `分辨率提示: ${resolution.warning}`);
        connectTest.detail = `连接成功（${ms} ms）· ${resolution.warning}`;
      }
    } catch { /* 探测失败不影响连接结果 */ }
    connectTest = {
      running: false, ok: true, detail: `连接成功（${ms} ms）· 会话已保持` +
        (resolution && resolution.warning ? ' · ' + resolution.warning : ''),
      address: conn.address, ms, startedAt: connectTest.startedAt, finishedAt: Date.now(),
      resolution,
    };
    return { ok: true, address: conn.address, ms, maaVersion: f.getVersion(), resolution };
  } catch (e) {
    logger.warn('runner', `连接测试失败: ${e.message}`);
    connectTest = {
      running: false, ok: false, detail: e.message,
      address: conn.address, ms: Date.now() - started,
      startedAt: connectTest.startedAt, finishedAt: Date.now(),
    };
    return { ok: false, address: conn.address, error: e.message };
  } finally {
    clearInterval(iv);
  }
}

function stop() {
  if (!session) {
    // 没有会话可停：把连接测试的状态也清掉（用户点「断开」）
    connectTest = { running: false, ok: null, detail: '', address: connectTest.address, ms: null, startedAt: null, finishedAt: null };
    return snapshot();
  }
  try { maaCore.funcs().stop(session.handle); } catch { /* ignore */ }
  state.phase = 'stopping';
  state.detail = '停止中';
  logger.info('runner', '收到停止指令');
  return snapshot();
}

// Probe an ADB device without appending tasks: load resources, connect, disconnect.
/* 立即返回（{started:true}），真正的连接在后台跑，结果看 status.connectTest */
function testConnect() {
  if (connectTest.running) return { started: true, alreadyRunning: true, address: connectTest.address };
  connectTest = {
    running: true, ok: null, detail: '连接测试中', address: '', ms: null,
    startedAt: Date.now(), finishedAt: null,
  };
  runConnectTest().catch((e) => {
    connectTest = {
      ...connectTest, running: false, ok: false, detail: e.message,
      finishedAt: Date.now(),
    };
  });
  return { started: true, address: connectTest.address };
}

async function runConnectTest() {
  if (busy()) throw Object.assign(new Error('任务执行中，无法测试连接'), { statusCode: 409 });
  const conn = readConnection();
  connectTest.address = conn.address || '';
  if (!conn.address) throw Object.assign(new Error('尚未填写设备地址'), { statusCode: 400 });
  const dir = runtime._internal.runtimeRoot();
  if (!dir) throw Object.assign(new Error('MAA 运行包未就绪'), { statusCode: 409 });
  const f = maaCore.funcs();
  const notes = [];
  let connectedByMsg = false;
  const cbRef = maaCore.registerCallback((msg, detailsJson) => {
    let d = {};
    try { d = JSON.parse(detailsJson || '{}'); } catch { /* ignore */ }
    const what = d.what || '';
    const why = d.why || '';
    if (msg === MSG_CONNECTION_INFO) {
      notes.push(`连接信息: ${what}${why ? '（' + why + '）' : ''}`);
      if (String(what).toLowerCase() === 'connected') connectedByMsg = true;
    } else if (msg === MSG_INIT_FAILED) {
      notes.push(`初始化失败: ${what}${why ? '（' + why + '）' : ''}`);
    } else if (msg === MSG_SUBTASK_ERROR) {
      notes.push(`子任务错误: ${what}${why ? '（' + why + '）' : ''}`);
    }
    if (notes.length) {
      logger.info('runner', `连接测试回调 msg=${msg} ${what} ${why}`);
      connectTest.detail = notes.slice(-3).join(' / ');
    }
  });
  const started = Date.now();
  let handle = null;
  try {
    f.setUserDir(dir);
    if (!f.loadResource(dir)) throw new Error('资源加载失败');
    handle = f.createEx(cbRef, null);
    if (!handle) throw new Error('创建 MaaCore 实例失败');
    f.asyncConnect(handle, conn.adbPath || '/usr/bin/adb', conn.address, conn.config || 'General', 0);
    // 手机 / 模拟器握手可能较慢（截图确认 + 分辨率校验），这里放宽到 90s；
    // /api/runner/test-connect 已改为立即返回，等待不再占用 HTTP 连接。
    for (let i = 0; i < 180; i++) {
      await sleep(500);
      if (i % 4 === 0 && !connectedByMsg) {
        connectTest.detail = `连接测试中（${Math.round((Date.now() - started) / 1000)}s）` +
          (notes.length ? ' · ' + notes.slice(-1)[0] : '');
      }
      if (connectedByMsg || f.connected(handle)) {
        const ms = Date.now() - started;
        logger.info('runner', `连接测试成功: ${conn.address} (${ms} ms)`);
        connectTest = {
          running: false, ok: true, detail: `连接成功（${ms} ms）`,
          address: conn.address, ms, startedAt: connectTest.startedAt, finishedAt: Date.now(),
        };
        return { ok: true, address: conn.address, ms, maaVersion: f.getVersion() };
      }
    }
    throw new Error(`连接超时（${conn.address}）` +
      (notes.length ? ' — MaaCore 反馈: ' + notes.slice(-2).join(' / ') : ' — 未收到 MaaCore 连接信息'));
  } catch (e) {
    logger.warn('runner', `连接测试失败: ${e.message}`);
    connectTest = {
      running: false, ok: false, detail: e.message,
      address: conn.address, ms: Date.now() - started,
      startedAt: connectTest.startedAt, finishedAt: Date.now(),
    };
    return { ok: false, address: conn.address, error: e.message };
  } finally {
    try { if (handle) f.destroy(handle); } catch { /* ignore */ }
    try { require('koffi').unregister(cbRef); } catch { /* ignore */ }
  }
}

module.exports = { snapshot, start, stop, testConnect, runTask, onMessage, probeResolution, connectTestState: () => ({ ...connectTest }), busy, buildParams, _resetForTest: () => { state = { phase: 'idle', detail: '', tasks: [], startedAt: null, finishedAt: null }; } };
