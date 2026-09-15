'use strict';

/**
 * 小工具 / 自动战斗 的服务端实现。
 *
 * 设计：真正调用 MaaCore，而不是在界面上模拟。
 *  - 识别类（公招 / 仓库 / 干员）就是 MaaCore 的 Recruit / Depot / OperBox 任务，
 *    结果通过 SubTaskExtraInfo 回调（RecruitResult / DepotInfo / OperBoxInfo）拿，
 *    字段含义照抄 docs/zh-cn/protocol/callback-schema.md。
 *  - 自动战斗读取运行包自带的 resource/copilot 作业文件（MAA 官方随包分发），
 *    按 Copilot / SSSCopilot / ParadoxCopilot 三种协议字段下发。
 */

const fs = require('node:fs');
const path = require('node:path');
const { logger } = require('./logger');
const runtime = require('./runtime');
const runner = require('./runner');

const MSG_SUBTASK_EXTRA_INFO = 20003;

/* ------------------------------------------------------------------ *
 * 结果缓存：由 MaaCore 回调填充
 * ------------------------------------------------------------------ */
const results = {
  recruit: null,
  depot: null,
  operbox: null,
  lastError: null,
  lastTask: null,
  updatedAt: null,
};

let itemIndexCache = null;
function itemIndex() {
  if (itemIndexCache) return itemIndexCache;
  const root = runtime._internal.runtimeRoot();
  if (!root) return {};
  try {
    itemIndexCache = JSON.parse(fs.readFileSync(path.join(root, 'resource', 'item_index.json'), 'utf8'));
  } catch {
    itemIndexCache = {};
  }
  return itemIndexCache;
}
function itemName(id) {
  const it = itemIndex()[id];
  return it && it.name ? it.name : String(id);
}

runner.onMessage((msg, details) => {
  if (msg !== MSG_SUBTASK_EXTRA_INFO) return;
  const what = details.what;
  try {
    if (what === 'RecruitResult') {
      results.recruit = {
        at: Date.now(),
        tags: details.tags || [],
        level: details.level || 0,
        groups: (details.result || []).map((g) => ({
          tags: g.tags || [],
          level: g.level,
          opers: (g.opers || []).map((o) => ({ id: o.id, name: o.name, level: o.level })),
        })),
      };
      results.updatedAt = Date.now();
      logger.info('tools', `公招识别结果: ${results.recruit.tags.join('/')} 最高 ${results.recruit.level}★`);
    } else if (what === 'DepotInfo') {
      let data = {};
      try { data = JSON.parse(details.data || '{}'); } catch { data = {}; }
      results.depot = {
        at: Date.now(),
        done: !!details.done,
        items: Object.entries(data)
          .map(([id, count]) => ({ id, name: itemName(id), count }))
          .sort((a, b) => (b.count || 0) - (a.count || 0)),
      };
      results.updatedAt = Date.now();
      logger.info('tools', `仓库识别${results.depot.done ? '完成' : '进行中'}: ${results.depot.items.length} 项`);
    } else if (what === 'OperBoxInfo') {
      const own = details.own_opers || [];
      const all = details.all_opers || [];
      results.operbox = {
        at: Date.now(),
        done: !!details.done,
        total: all.length,
        ownedCount: all.filter((o) => o.own).length || own.length,
        owned: own.map((o) => ({
          id: o.id, name: o.name, rarity: o.rarity,
          elite: o.elite, level: o.level, potential: o.potential,
        })),
        all: all.map((o) => ({ id: o.id, name: o.name, rarity: o.rarity, own: !!o.own })),
      };
      results.updatedAt = Date.now();
      logger.info('tools', `干员识别${results.operbox.done ? '完成' : '进行中'}: 已拥有 ${results.operbox.ownedCount}/${results.operbox.total}`);
    }
  } catch (err) {
    logger.warn('tools', `解析识别结果失败: ${err.message}`);
  }
});

function snapshot() {
  return { ...results, busy: runner.busy() };
}

/* ------------------------------------------------------------------ *
 * 识别类：公招 / 仓库 / 干员
 * ------------------------------------------------------------------ */
const TASKS = {
  recruit: { taskType: 'Recruit', label: '公招识别', resultKey: 'recruit' },
  depot: { taskType: 'Depot', label: '仓库识别', resultKey: 'depot' },
  operbox: { taskType: 'OperBox', label: '干员识别', resultKey: 'operbox' },
};

/** 读取「自动公招」保存的配置，让识别用的参数和用户设置一致 */
function savedTaskConfig(taskId) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'tasks.json'), 'utf8'));
    return (cfg && cfg[taskId]) || {};
  } catch {
    return {};
  }
}
function configDir() {
  const config = require('./config');
  return config.CONFIG_DIR();
}

async function runRecognition(kind) {
  const spec = TASKS[kind];
  if (!spec) throw Object.assign(new Error(`未知的识别类型: ${kind}`), { statusCode: 400 });
  if (runner.busy()) throw Object.assign(new Error('已有任务在执行中'), { statusCode: 409 });

  // 参数：catalog 默认值 + 用户已保存的配置（仅公招有可配项）
  const catalog = require('./task-catalog.json');
  const entry = (catalog.tasks || []).find((t) => t.taskType === spec.taskType);
  const defaults = {};
  for (const opt of (entry && entry.options) || []) {
    defaults[opt.id] = opt.choicesFrom ? catalog[opt.choicesFrom][0].value : opt.default;
  }
  const opts = kind === 'recruit'
    ? Object.assign(defaults, savedTaskConfig('recruit'))
    : {};
  const params = runner.buildParams(spec.taskType, opts, {});

  results[spec.resultKey] = null;
  results.lastError = null;
  results.lastTask = kind;
  logger.info('tools', `开始${spec.label}（${spec.taskType}）params=${JSON.stringify(params)}`);
  try {
    await runner.runTask([{ taskType: spec.taskType, params, label: spec.label }], {
      detail: `${spec.label}中`,
    });
  } catch (err) {
    results.lastError = err.message;
    throw err;
  }
  return { started: true, kind, resultKey: spec.resultKey };
}

/* ------------------------------------------------------------------ *
 * 自动战斗：作业列表 + 启动
 * ------------------------------------------------------------------ */
let copilotCache = { at: 0, list: [] };
const COPILOT_CACHE_MS = 60 * 1000;

/**
 * 作业类型判定。
 * 依据运行包里的实际命名（实测 resource/copilot 下 76 个作业：75 个文件名以
 * `SSS_` 开头，其余是普通关卡），而不是靠目录名——`old/` 里同样混着普通关卡。
 * 悖论模拟的作业前缀为 `Paradox_`（保留判断，当前运行包里没有）。
 */
function classify(filePath, title) {
  const base = path.basename(filePath).toLowerCase();
  const t = title || '';
  if (base.startsWith('sss_') || base.startsWith('sss') || t.includes('保全派驻')) return 'sss';
  if (base.startsWith('paradox') || base.startsWith('pd_') || t.includes('悖论')) return 'paradox';
  return 'main';
}

function walkJson(dir, out, depth = 0) {
  if (depth > 4) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkJson(full, out, depth + 1);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.json')) out.push(full);
  }
  return out;
}

/** 运行包自带的作业文件（MAA 官方随包分发，桌面端列出的就是这些） */
function listCopilot({ force = false } = {}) {
  if (!force && Date.now() - copilotCache.at < COPILOT_CACHE_MS) return copilotCache.list;
  const root = runtime._internal.runtimeRoot();
  const dir = root ? path.join(root, 'resource', 'copilot') : null;
  if (!dir || !fs.existsSync(dir)) return [];
  const files = walkJson(dir, []);
  const list = files.map((f) => {
    let title = '';
    let stage = '';
    let minRequired = '';
    try {
      const raw = fs.readFileSync(f, 'utf8');
      if (raw.length < 4 * 1024 * 1024) {
        const doc = JSON.parse(raw);
        title = (doc.doc && doc.doc.title) || '';
        stage = doc.stage_name || '';
        minRequired = doc.minimum_required || '';
      }
    } catch { /* 单个文件坏掉不影响整体 */ }
    return {
      file: path.relative(dir, f).split(path.sep).join('/'),
      name: path.basename(f, '.json'),
      title,
      stage,
      minRequired,
      type: classify(f, title),
    };
  }).sort((a, b) => a.file.localeCompare(b.file));
  copilotCache = { at: Date.now(), list };
  logger.info('tools', `作业列表已载入: ${list.length} 个（${dir}）`);
  return list;
}

/** 启动自动战斗。type: main | sss | paradox */
async function runCopilot(body = {}) {
  if (runner.busy()) throw Object.assign(new Error('已有任务在执行中'), { statusCode: 409 });
  const root = runtime._internal.runtimeRoot();
  if (!root) throw Object.assign(new Error('MAA 运行包未就绪'), { statusCode: 409 });
  const dir = path.join(root, 'resource', 'copilot');

  const file = String(body.file || '').trim();
  if (!file) throw Object.assign(new Error('未选择作业'), { statusCode: 400 });
  const abs = path.resolve(dir, file);
  if (!abs.startsWith(path.resolve(dir)) || !fs.existsSync(abs)) {
    throw Object.assign(new Error(`作业文件不存在: ${file}`), { statusCode: 400 });
  }

  const type = ['main', 'sss', 'paradox'].includes(body.type) ? body.type : 'main';
  const loopTimes = Number(body.loopTimes) > 0 ? Math.min(Number(body.loopTimes), 999) : undefined;

  let taskType;
  let params;
  if (type === 'sss') {
    taskType = 'SSSCopilot';
    params = { filename: abs, enable: true };
    if (loopTimes) params.loop_times = loopTimes;
  } else if (type === 'paradox') {
    taskType = 'ParadoxCopilot';
    params = { filename: abs, list: [], enable: true };
  } else {
    taskType = 'Copilot';
    params = {
      filename: abs,
      enable: true,
      formation: !!body.formation,
      loop_times: loopTimes || 1,
      use_sanity_potion: !!body.useSanityPotion,
      add_trust: !!body.addTrust,
      ignore_requirements: !!body.ignoreRequirements,
    };
    if (Number(body.formationIndex) > 0) params.formation_index = Number(body.formationIndex);
  }

  const label = `自动战斗 ${path.basename(file)}`;
  logger.info('tools', `启动${label}（${taskType}）params=${JSON.stringify(params)}`);
  await runner.runTask([{ taskType, params, label }], { detail: '自动战斗中' });
  return { started: true, type, file, params };
}

module.exports = {
  snapshot,
  runRecognition,
  listCopilot,
  runCopilot,
  _resetForTest: () => {
    results.recruit = null; results.depot = null; results.operbox = null;
    results.lastError = null; results.lastTask = null; results.updatedAt = null;
    copilotCache = { at: 0, list: [] }; itemIndexCache = null;
  },
};
