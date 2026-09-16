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
const MSG_TASK_CHAIN_EXTRA_INFO = 10003;
const MSG_TASK_CHAIN_STOPPED = 10004;
const MSG_SUBTASK_ERROR = 20000;
const MSG_SUBTASK_START = 20001;
const MSG_SUBTASK_COMPLETED = 20002;
const MSG_SUBTASK_EXTRA_INFO = 20003;

let state = {
  phase: 'idle', // idle|loading|connecting|running|stopping|done|error
  detail: '',
  tasks: [],
  startedAt: null,
  finishedAt: null,
  lastChainError: null,
};

/* 停止看门狗：AsstStop 之后没有收到 TaskChainStopped 时的兜底定时器 */
let stopWatchdog = null;

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
  // 加载期间借用 loading 态，但必须还原：phase 停在 loading 会让 busy() 永远
  // 为真，之后每一次连接测试/开始任务都会被「任务执行中」挡掉（真机反馈：
  // 右上角点了连接从来没成功过）。
  const prev = state.phase;
  state.phase = 'loading';
  state.detail = '加载资源中';
  try {
    f.setUserDir(dir);
    if (!f.loadResource(dir)) throw new Error('AsstLoadResource 失败：运行包资源不完整？');
  } catch (e) {
    state.phase = prev === 'loading' ? 'idle' : prev;
    if (state.phase === 'idle') state.detail = '';
    throw e;
  }
  state.phase = prev === 'loading' ? 'idle' : prev;
  if (state.phase === 'idle') state.detail = '';
  resourceKey = key;
  logger.info('runner', `MaaCore 资源已加载（${key}）`);
  return true;
}

/**
 * 取得一个「已连接」的 MaaCore 会话：能用就复用，不能用才重建。
 * 复用可以让「连接测试」的成功状态延续到「开始任务」，省掉重复的 60s 握手。
 */
/**
 * 幂等的 adb connect（容器重启后设备未注册 / adb server 冷启动时必需）。
 * 返回 {connected, out}；失败不抛，交给 MaaCore 自己报错。
 */
function adbPreconnect(adbPath, address) {
  return new Promise((resolve) => {
    if (!address) { resolve({ connected: false, out: 'no address' }); return; }
    const { spawn } = require('node:child_process');
    const run = (args, ms) => new Promise((done) => {
      const p = spawn(adbPath, args, { timeout: ms });
      let out = '';
      p.stdout.on('data', (c) => { out += String(c); });
      p.stderr.on('data', (c) => { out += String(c); });
      p.on('error', (e) => done({ out: out || e.message }));
      p.on('close', () => done({ out }));
    });
    (async () => {
      const t0 = Date.now();
      const boot = await run(['start-server'], 10000);
      if (boot && boot.code === -1) {
        // adb 二进制不存在/无法执行：后面的轮询永远等不到 device，别白等 45s
        const why = (boot.out || '').trim().slice(0, 120) || 'adb 不可用';
        logger.warn('runner', `adb 预连跳过：${why}`);
        resolve({ connected: false, out: why });
        return;
      }
      await run(['connect', address], 10000);
      // 冷启动时 adb/设备要几十秒才响应；轮询确认设备真的进入 device 状态再
      // 交棒给 MaaCore —— 否则 MaaCore 会自己干等到 60s 超时才发 Connected。
      const esc = address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const isDevice = (s) => new RegExp('^' + esc + '\\s+device\\s*$', 'm').test(s || '');
      let r = await run(['devices'], 10000);
      let ok = isDevice(r.out);
      let waited = Date.now() - t0;
      while (!ok && waited < 45000) {
        await sleep(2000);
        if (waited % 10000 < 2500) await run(['connect', address], 10000);
        r = await run(['devices'], 10000);
        ok = isDevice(r.out);
        waited = Date.now() - t0;
      }
      logger.info('runner', `adb 预连 ${address}: ${ok ? '设备已就绪' : '未就绪（交给 MaaCore）'}（${waited} ms）`);
      resolve({ connected: ok, out: (r.out || '').trim().slice(0, 200) });
    })();
  });
}

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

  // MAA 的异步握手不会自己 adb connect：容器重启或长时间空闲后，容器内 adb
  // 设备表是空的，MaaCore 会干等到 60s 超时才转而成功（实测 61s vs 1.1s）。
  // 先做一次幂等的 adb connect，握手就能稳定在 1~2 秒。
  await adbPreconnect(adbPath, conn.address);

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
    // 注意：ClientType 不是实例级参数（InstanceOptionKey 里没有它），
    // 它是任务参数，由 buildParams 下发到 StartUp/Fight/CloseDown。
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

/**
 * 后台预热：容器启动后先建好会话。
 * MaaCore 在 adb/设备冷启动时会耗掉自己 60s 的等待才发 Connected（实测重启后
 * 首次 61s、之后 1.2s），与其让用户第一次点「连接」干等，不如启动时就把这一
 * 分钟花掉——之后 testConnect / start 都直接复用会话。失败静默，不影响启动。
 */
function warmup(delayMs = 8000) {
  setTimeout(() => {
    (async () => {
      try {
        const conn = readConnection();
        if (!conn.address || busy()) return;
        const dir = runtime._internal.runtimeRoot();
        if (!dir) return;
        const f = maaCore.funcs();
        logger.info('runner', `启动预热：提前建立到 ${conn.address} 的会话`);
        await ensureSession(f, dir, conn, conn.adbPath || '/usr/bin/adb');
        logger.info('runner', '启动预热完成，后续连接将复用会话');
      } catch (e) {
        logger.warn('runner', `启动预热未成功（不影响使用）: ${e.message}`);
      }
    })();
  }, delayMs);
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

// 基建设施英文键 → 中文（MAA 桌面端「当前设施: 贸易站 02」同款）
const FACILITY_CN = {
  Manufacture: '制造站', Mfg: '制造站',
  Trade: '贸易站',
  Power: '发电站',
  Office: '办公室',
  Reception: '会客室',
  Dorm: '宿舍', Dormitory: '宿舍',
  Training: '训练室', Train: '训练室',
  Processing: '加工站',
  Control: '控制中枢',
};

/**
 * 把 SubTaskExtraInfo 的 details 翻成 MAA 桌面端那种中文实况。
 * 字段取自真机 asst.log 里 MaaCore 实际下发的回调样本（v6.17.5）。
 * 返回 null 表示这条不值得占用运行实况（内部噪声）。
 */
function describeSubTaskExtra(d) {
  const what = d.what || '';
  const det = d.details || {};
  switch (what) {
    case 'SanityBeforeStage':
      return `理智 ${det.current_sanity}/${det.max_sanity}`;
    case 'FightTimes':
      return `已完成 ${det.times_finished} 次 · 本次消耗理智 ${det.sanity_cost} · 代理 ${det.series} 倍`;
    case 'StageDrops': {
      const code = (det.stage && det.stage.stageCode) || '';
      const drops = (det.drops || []).map((x) => `${x.itemName}×${x.quantity}`).join('、');
      return `关卡 ${code} ${det.stars}星${drops ? ' · 掉落：' + drops : ''}`;
    }
    case 'EnterFacility': {
      const name = FACILITY_CN[det.facility] || det.facility || '';
      const idx = det.index != null ? String(det.index).padStart(2, '0') : '';
      return `当前设施：${name}${idx ? ' ' + idx : ''}`;
    }
    case 'ExceededLimit':
      // 每次 ProcessTask 达到上限都会发，纯内部噪声
      return null;
    default:
      // 未识别的也留痕（便于下次采集真机样本后补全翻译）
      return Object.keys(det).length ? `${what} ${JSON.stringify(det).slice(0, 160)}` : what;
  }
}

/* 用时：MAA 桌面端「任务已全部完成! 用时 0h46m」同款 */
function fmtDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function onCallback(msg, detailsJson) {
  let parsedForSub = null;
  try { parsedForSub = JSON.parse(detailsJson || '{}'); } catch { parsedForSub = {}; }
  for (const fn of messageSubscribers) {
    try { fn(msg, parsedForSub); } catch { /* 订阅者出错不影响主流程 */ }
  }
  let d = {};
  try { d = JSON.parse(detailsJson || '{}'); } catch { /* ignore */ }
  // MAA 的 details JSON 里任务链名是 details.taskchain；旧代码读 d.chain 恒为空，
  // 导致「任务链开始/出错」日志全部丢名字。
  const chain = (d.details && (d.details.taskchain || d.details.chain)) || d.taskchain || '';
  try {
    switch (msg) {
      case MSG_ALL_TASKS_COMPLETED: {
        // MAA 桌面端收尾文案：任务已全部完成! 用时 0h46m
        const used = state.startedAt ? fmtDuration(Date.now() - state.startedAt) : '';
        state.phase = state.lastChainError ? 'error' : 'done';
        state.detail = state.lastChainError
          ? `全部任务结束（有任务链失败: ${state.lastChainError}）${used ? ' · 用时 ' + used : ''}`
          : `任务已全部完成!${used ? ' 用时 ' + used : ''}`;
        state.finishedAt = Date.now();
        logger.info('runner', state.detail);
        teardown(2000);
        break;
      }
      case MSG_INIT_FAILED:
        // 实例初始化失败（资源缺失、连接不可用等），之前被误当成「全部完成」
        state.phase = 'error';
        state.detail = `初始化失败: ${d.what || ''} ${d.why || ''}`.trim();
        state.finishedAt = Date.now();
        logger.error('runner', `MaaCore 初始化失败: ${d.what || ''} ${d.why || ''}`);
        teardown(2000);
        break;
      case MSG_CONNECTION_INFO: {
        // MAA 桌面端也不会把 ScreencapCost / EmulatorFPS 这类心跳刷进运行实况，
        // 只保留有信息量的连接里程碑。
        const noisy = ['ScreencapCost', 'EmulatorFPS'];
        if (noisy.includes(String(d.what))) {
          logger.debug('runner', `连接信息（心跳）: ${d.what}`);
          break;
        }
        logger.info('runner', `连接信息: ${d.what || ''} ${d.why || ''}`.trim());
        if (d.what) state.detail = String(d.what);
        if (String(d.what).toLowerCase() === 'connected') connectedNotifiedAt = Date.now();
        break;
      }
      case MSG_TASK_CHAIN_ERROR:
        // 一条链失败不代表全部失败：MaaCore 会继续执行后续链（真机实测
        // StartUp 失败后 Fight 照常开始）。这里只记录，不 teardown；
        // 等 MSG_ALL_TASKS_COMPLETED 统一收尾，避免把还没跑的任务杀掉。
        state.lastChainError = chain || d.what || '未知';
        state.detail = `任务链出错: ${state.lastChainError}（继续后续任务）`;
        // details 全量落日志：TaskChainError 的原因常在 details.what/why 里
        logger.error('runner', `任务链出错: ${chain || d.what || ''} · details=${detailsJson}`);
        break;
      case MSG_TASK_CHAIN_START:
        logger.info('runner', `任务链开始: ${chain}`);
        break;
      case MSG_TASK_CHAIN_COMPLETED:
        logger.info('runner', `任务链完成: ${chain}`);
        break;
      case MSG_TASK_CHAIN_STOPPED:
        if (stopWatchdog) { clearTimeout(stopWatchdog); stopWatchdog = null; }
        state.phase = 'done';
        state.detail = '已停止';
        state.finishedAt = Date.now();
        logger.info('runner', '任务已停止');
        teardown(1500);
        break;
      case MSG_SUBTASK_ERROR: {
        // SubTaskError 的错误名在 details.subtask / details.what，原因在 why；
        // 只读顶层 d.what 会打印出空串（真机踩过）。
        const sd = d.details || {};
        logger.warn('runner',
          `子任务出错: ${sd.subtask || sd.what || d.what || '?'} · ${sd.why || d.why || ''} chain=${chain} · details=${detailsJson}`);
        break;
      }
      case MSG_SUBTASK_START:
        // ProcessTask 每次点击都会发，进运行实况会刷屏 → 只进详细日志
        logger.debug('runner', `子任务开始: ${(d.details && d.details.task) || d.subtask || ''} (${d.subtask || ''})`);
        break;
      case MSG_SUBTASK_COMPLETED:
        logger.debug('runner', `子任务完成: ${(d.details && d.details.task) || d.subtask || ''} (${d.subtask || ''})`);
        break;
      case MSG_SUBTASK_EXTRA_INFO: {
        // 运行实况的主体：理智、刷关次数、掉落、当前设施等
        const text = describeSubTaskExtra(d);
        if (text) {
          logger.info('runner', text);
          state.detail = text;
        } else {
          logger.debug('runner', `子任务额外信息: ${d.what || ''}`);
        }
        break;
      }
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
  // 键名解析：存储层用 catalog option id（snake_case，如 start_game_enabled / times），
  // UI 绑定层用 MAA 桌面控件 id（PascalCase，如 StartGame / HasTimesLimited）。
  // 只读 ctl.id 会永远拿到 undefined → 勾选框全变 false、check-number 落到
  // valueWhenOff（真机踩过：times=1 被下发成 2147483647）。两套键都查。
  const direct = opts[ctl.id];
  const v = direct !== undefined ? direct : opts[ctl.bind];
  switch (ctl.kind) {
    case 'check':
      return ctl.bind ? !!v : undefined;
    case 'check-number': {
      if (!ctl.bind) return undefined;
      // 存储直接给了数字（如 fight.times=1）→ 透传；0 的语义与 valueWhenOff 一致
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      return v ? Number(opts[ctl.id + 'Value'] ?? ctl.number.default) : ctl.number.valueWhenOff;
    }
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

  // 2b) 按协议 spec 归一化已写入的字段：UI 绑定层透传的值可能是字符串
  // （如 tasks.json 里 series:"0"），而 MAA 协议要 number。
  for (const f of (spec ? spec.fields : [])) {
    const cur = params[f.name];
    if (cur === undefined) continue;
    if (f.type === 'number' && typeof cur === 'string' && cur.trim() !== '' && Number.isFinite(Number(cur))) {
      params[f.name] = Number(cur);
    } else if (f.type === 'boolean' && typeof cur === 'string') {
      params[f.name] = cur === 'true' || cur === '1';
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
    lastChainError: null,
  };
  seq += 1;

  try {
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
  } catch (e) {
    // 同 start()：失败要把 phase 挪出 busy 集合，否则 busy() 永远为真
    state.phase = 'error';
    state.detail = `启动失败: ${e.message}`;
    state.finishedAt = Date.now();
    logger.error('runner', `任务启动失败: ${e.message}`);
    throw e;
  }
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

  // Fight 任务没有 stage 时 MaaCore 无事可做（这正是「流程跑不动」的原因），明确跳过
  const droppedFight = jobs.filter((j) => j.task.taskType === 'Fight' && !j.params.stage);
  for (const j of droppedFight) {
    logger.warn('runner', `理智作战未配置关卡（stage 为空），该任务已跳过。请在界面选择关卡或启用周计划`);
  }
  jobs = jobs.filter((j) => j.task.taskType !== 'Fight' || j.params.stage);
  if (!jobs.length) {
    throw Object.assign(
      new Error('所选任务没有可执行内容：理智作战未配置关卡（请在理智作战面板选择「当前关卡」，或启用周计划）'),
      { statusCode: 400 });
  }

  state = { phase: 'loading', detail: '加载资源中', tasks: ids, startedAt: Date.now(), finishedAt: null, lastChainError: null };
  seq += 1;

  state.phase = 'connecting';
  state.detail = '连接设备中';
  try {
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
  } catch (e) {
    // 连接/下发/启动失败必须把 phase 挪出 busy 集合：停在 connecting 会让 busy()
    // 永远为真，之后每次开始任务、连接测试都被「已有任务在执行中」顶掉。
    // 会话保留（连接可能已经成功），下次直接复用，不用再等一次握手。
    state.phase = 'error';
    state.detail = `启动失败: ${e.message}`;
    state.finishedAt = Date.now();
    logger.error('runner', `任务启动失败: ${e.message}`);
    throw e;
  }
  state.phase = 'running';
  state.detail = `执行中（${jobs.length} 项任务）`;
  logger.info('runner', `任务开始执行: ${ids.join(', ')}`);
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
    const run = (args, timeout) => new Promise((resolve2) => {
      const p = spawn(adbPath, args, { timeout: timeout || 10000 });
      let out = '';
      p.stdout.on('data', (c) => { out += String(c); });
      p.stderr.on('data', (c) => { out += String(c); });
      p.on('error', (e) => resolve2({ code: -1, out: out || e.message }));
      p.on('close', (code) => resolve2({ code, out }));
    });

    (async () => {
      // 容器重启后 adb server 冷启动 + 设备未注册：先 connect（幂等）再查询
      await run(['connect', address], 8000);
      let r = await run(['-s', address, 'shell', 'wm', 'size'], 10000);
      if (!/size:\s*\d+x\d+/.test(r.out)) {              // daemon 冷启动或设备掉了 → 重试一轮
        await run(['connect', address], 8000);
        r = await run(['-s', address, 'shell', 'wm', 'size'], 10000);
      }
      const override = /Override size:\s*(\d+)x(\d+)/.exec(r.out);
      const physical = /Physical size:\s*(\d+)x(\d+)/.exec(r.out);
      let w = null, h = null, source = 'physical';
      if (override) { w = +override[1]; h = +override[2]; source = 'override'; }
      else if (physical) { w = +physical[1]; h = +physical[2]; }
      if (!w || !h) { resolve({ error: '无法读取设备分辨率（设备未连接？）', raw: r.out.slice(0, 120) }); return; }
      // 设备可能报竖屏尺寸（如 1080x1920），MAA 只关心长短边比是否 16:9
      const long = Math.max(w, h), short = Math.min(w, h);
      const ratioOk = Math.abs(long / short - 16 / 9) < 0.02;
      let warning = null;
      if (!ratioOk) {
        const fixW = Math.round(short * 16 / 9);
        warning = `分辨率 ${w}x${h} 不是 16:9，MAA 模板识别会失败。` +
          `可执行 adb shell wm size ${fixW}x${short} 设置覆盖分辨率`;
      } else if (short < 720) {
        warning = `分辨率 ${w}x${h} 低于 720p，识别可能不稳定`;
      }
      resolve({ width: w, height: h, source, ratioOk, warning });
    })();
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

/**
 * 收尾：把 phase 挪出 busy 集合，必要时释放会话。
 * teardown() 会立刻把 session 置空（destroy 延迟执行），所以 snapshot().connected
 * 在返回给前端时已经是 false。
 */
function finishStop(detail, releaseSession) {
  if (stopWatchdog) { clearTimeout(stopWatchdog); stopWatchdog = null; }
  state.phase = 'done';
  state.detail = detail || '已停止';
  state.finishedAt = Date.now();
  if (releaseSession) teardown(300);
}

/**
 * 停止。这里踩过大坑，改动前务必读完：
 *
 * MaaCore 只有在「确实有任务链在跑」时才会回调 TaskChainStopped(10004)。
 * 用户点顶栏「断开」时往往只是想释放会话（会话很可能来自启动预热 warmup，
 * 并没有任务在跑），此时 AsstStop 不会触发任何回调 —— 旧实现把 phase 直接
 * 设成 'stopping' 就干等着，结果 phase 永久停在 stopping，而 busy() 把
 * stopping 算作忙：之后每一次「连接测试 / 开始任务」都被「任务执行中」拒绝。
 * 真机表现就是「点了停止停不下来」「右上角点连接从来没成功过」，只能重启容器。
 *
 * 现在的策略：
 *   - 没有任务链在跑（idle/done/error）→ 立即收尾 + 释放会话（真断开）
 *   - 有任务链在跑（loading/connecting/running）→ 交给回调收尾，挂 15s 看门狗兜底
 *   - 再次点击（phase 已是 stopping）→ 视为「强制停止」，立即 destroy
 */
function stop() {
  if (!session) {
    // 没有会话可停：把连接测试的状态也清掉（用户点「断开」）
    connectTest = { running: false, ok: null, detail: '', address: connectTest.address, ms: null, startedAt: null, finishedAt: null };
    // 兜底：会话已销毁却残留 stopping 态（旧版本卡死过的进程）在这里一并清掉
    if (state.phase === 'stopping') finishStop('已停止', false);
    return snapshot();
  }
  const active = ['loading', 'connecting', 'running'].includes(state.phase);
  const repeated = state.phase === 'stopping';
  try { maaCore.funcs().stop(session.handle); } catch { /* ignore */ }
  logger.info('runner', `收到停止指令（当前阶段 ${state.phase}）`);

  if (!active || repeated) {
    finishStop(repeated ? '已强制停止' : '已停止', true);
    return snapshot();
  }

  state.phase = 'stopping';
  state.detail = '停止中（等待当前任务收尾）';
  if (stopWatchdog) clearTimeout(stopWatchdog);
  stopWatchdog = setTimeout(() => {
    stopWatchdog = null;
    if (state.phase !== 'stopping') return;
    logger.warn('runner', '停止指令 15s 内未收到 MaaCore 的任务链停止回调，强制释放会话');
    finishStop('已停止（强制释放会话）', true);
  }, 15000);
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

module.exports = { snapshot, start, stop, testConnect, runTask, onMessage, probeResolution, warmup, connectTestState: () => ({ ...connectTest }), busy, buildParams, _resetForTest: () => { state = { phase: 'idle', detail: '', tasks: [], startedAt: null, finishedAt: null }; } };
