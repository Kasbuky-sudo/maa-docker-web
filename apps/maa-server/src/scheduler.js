'use strict';

/**
 * 服务端日程调度器。
 *
 * 之前日程只写进 schedule.json 却没有任何执行逻辑；这里补上：
 *  - 每 30 秒 tick 一次，命中「HH:MM + repeat」即调用 runner.start(tasks)
 *  - 触发后把 lastRun 写回条目，避免同一分钟内重复触发，也让容器重启后不会重复补跑
 *  - 任务执行中（runner.busy()）跳过本次并在日志里说明，不排队堆积
 *
 * repeat 取值（对齐桌面端日程页）：daily / weekdays / weekends / mon..sun
 */

const fs = require('node:fs');
const path = require('node:path');
const { logger } = require('./logger');
const config = require('./config');

const TICK_MS = 30 * 1000;
const REPEATS = ['daily', 'weekdays', 'weekends', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

let timer = null;
let lastTickAt = null;

function scheduleFile() {
  return path.join(config.CONFIG_DIR(), 'schedule.json');
}

function readEntries() {
  try {
    const list = JSON.parse(fs.readFileSync(scheduleFile(), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeEntries(entries) {
  fs.mkdirSync(config.CONFIG_DIR(), { recursive: true });
  fs.writeFileSync(scheduleFile(), JSON.stringify(entries, null, 2) + '\n', 'utf8');
}

function matchesRepeat(repeat, date) {
  const key = WEEKDAY_KEYS[date.getDay()];
  switch (repeat) {
    case 'daily': return true;
    case 'weekdays': return key !== 'sat' && key !== 'sun';
    case 'weekends': return key === 'sat' || key === 'sun';
    default: return REPEATS.includes(repeat) && repeat === key;
  }
}

function pad(n) { return (n < 10 ? '0' : '') + n; }
function hhmm(date) { return `${pad(date.getHours())}:${pad(date.getMinutes())}`; }
function dateKey(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${hhmm(date)}`; }

/** 计算下一次触发时间（供界面显示） */
function nextRun(entry, from = new Date()) {
  if (!entry || !entry.enabled || !/^\d{2}:\d{2}$/.test(entry.time || '')) return null;
  const [h, m] = entry.time.split(':').map(Number);
  const repeat = entry.repeat || 'daily';
  for (let i = 0; i < 14; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i, h, m, 0, 0);
    if (d <= from) continue;
    if (!matchesRepeat(repeat, d)) continue;
    return d.toISOString();
  }
  return null;
}

async function tick(now = new Date()) {
  lastTickAt = Date.now();
  const entries = readEntries();
  if (!entries.length) return [];
  const fired = [];
  for (const entry of entries) {
    if (!entry || entry.enabled === false) continue;
    if (!/^\d{2}:\d{2}$/.test(entry.time || '')) continue;
    if (entry.time !== hhmm(now)) continue;
    if ((entry.repeat || 'daily') !== 'daily' && !matchesRepeat(entry.repeat, now)) continue;
    if (entry.lastRun === dateKey(now)) continue;                 // 本分钟已触发过
    if (!Array.isArray(entry.tasks) || !entry.tasks.length) {      // 没配任务，标记以免每分钟刷屏
      entry.lastRun = dateKey(now);
      entry.lastResult = '未配置任务，跳过';
      writeEntries(entries);
      logger.warn('scheduler', `日程 ${entry.id}（${entry.time}）未配置任务，跳过`);
      continue;
    }
    if (require('./runner').busy()) {                              // 正在跑，本次不触发
      logger.warn('scheduler', `日程 ${entry.time} 到点，但已有任务在执行，跳过本次`);
      continue;
    }
    entry.lastRun = dateKey(now);
    entry.lastResult = '已触发';
    writeEntries(entries);
    fired.push(entry);
    logger.info('scheduler', `触发日程 ${entry.time}（${entry.repeat || 'daily'}）: ${entry.tasks.join(', ')}`);
    try {
      await require('./runner').start(entry.tasks);
    } catch (err) {
      entry.lastResult = `触发失败: ${err.message}`;
      writeEntries(readEntries().map((e) => (e.id === entry.id ? { ...e, lastResult: entry.lastResult } : e)));
      logger.error('scheduler', `日程 ${entry.time} 触发失败: ${err.message}`);
    }
  }
  return fired;
}

function start() {
  if (timer) return;
  timer = setInterval(() => { tick().catch((e) => logger.error('scheduler', e.message)); }, TICK_MS);
  logger.info('scheduler', `日程调度器已启动（每 ${TICK_MS / 1000} 秒检查一次）`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

function status() {
  const entries = readEntries();
  return {
    running: !!timer,
    lastTickAt,
    entries: entries.map((e) => ({
      id: e.id,
      time: e.time,
      enabled: e.enabled !== false,
      repeat: e.repeat || 'daily',
      tasks: e.tasks || [],
      lastRun: e.lastRun || null,
      lastResult: e.lastResult || null,
      nextRun: nextRun(e),
    })),
  };
}

module.exports = { start, stop, tick, status, nextRun, matchesRepeat, readEntries, writeEntries, REPEATS };
