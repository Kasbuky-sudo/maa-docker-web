/* MAA for NAS — web UI
   Components: windows-ui (official dist) only. Shell = topbar + icon rail +
   workbench columns + live panel + statusbar.
   Feature data: /api/features/parity (same JSON as the READMEs). */
'use strict';

const $page = document.getElementById('page');
const api = {
  async get(p) { const r = await fetch(p); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status); return r.json(); },
  async send(p, method, body) {
    const r = await fetch(p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    return j;
  },
};

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function pill(status) {
  const cls = status === 'ready' || status === 'healthy' ? 'ok' : status === 'error' ? 'bad' : '';
  return `<span class="mdw-pill ${cls}">${esc(status)}</span>`;
}
function alertBar(kind, msg, id) {
  return `<div class="app-alert-bar ${kind}" ${id ? `id="${id}"` : ''}><span>${esc(msg)}</span></div>`;
}
function accordion(title, inner, open) {
  return `<div class="app-accordion">
    <button type="button" class="app-accordion-header" aria-expanded="${open ? 'true' : 'false'}">
      <div class="app-accordion-title">${esc(title)}</div>
    </button>
    <div class="app-accordion-panel ${open ? 'show' : ''}"><div class="mdw-acc-body">${inner}</div></div>
  </div>`;
}
function bindAccordions(root) {
  root.querySelectorAll('.app-accordion-header').forEach((h) => {
    h.addEventListener('click', () => {
      const open = h.getAttribute('aria-expanded') === 'true';
      h.setAttribute('aria-expanded', String(!open));
      h.parentElement.querySelector('.app-accordion-panel').classList.toggle('show', !open);
    });
  });
}
function switchCtl(id, checked, on = '已启用', off = '未启用') {
  return `<label class="app-switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}/><span class="app-switch-view"></span><span class="app-switch-label" data-on="${on}" data-off="${off}"></span></label>`;
}
function selectCtl(id, choices, value) {
  return `<div class="app-select-menu mdw-row-ctl"><select id="${id}">${choices.map((c) =>
    `<option value="${esc(String(c.value))}" ${String(c.value) === String(value) ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>`;
}
// MaaCore 内置连接配置的中文名（MAA 桌面端命名）
const CONN_PROFILES = [
  ['General', '通用配置'], ['BlueStacks', '蓝叠模拟器'], ['MuMuEmulator12', 'MuMu 模拟器 12'],
  ['LDPlayer', '雷电模拟器'], ['Nox', '夜神模拟器'], ['XYAZ', '逍遥模拟器'],
  ['WSA', 'Windows 子系统'], ['Androws', 'Android 容器'],
];
const connProfileChoices = () => CONN_PROFILES.map(([value, label]) => ({ value, label }));

function stdRow(label, desc, ctl) {
  return `<div class="mdw-row"><div class="mdw-row-l"><div class="mdw-row-label">${esc(label)}</div>${desc ? `<div class="mdw-row-desc">${esc(desc)}</div>` : ''}</div><div class="mdw-row-r">${ctl}</div></div>`;
}

// ----------------------------------------------------------- shell (topbar / statusbar / live stats)
const SHELL = { version: {}, runner: { phase: 'idle', detail: '' }, connection: {} };
const LOGS = [];
let liveFollow = true;

const PHASE_LABEL = {
  idle: '空闲 · 等待执行', loading: '加载资源中', connecting: '连接设备中',
  running: '执行中', stopping: '停止中', done: '已完成', error: '出错',
};

function renderShell() {
  const v = SHELL.version; const st = SHELL.runner || {};
  const tb = document.getElementById('tb-version');
  if (tb) tb.textContent = v.serviceVersion ? `v${v.serviceVersion} · MAA ${v.maaVersion || '—'}` : '';
  const chip = document.getElementById('tb-device');
  if (chip) {
    const addr = (st.connection && st.connection.address) || '';
    const ok = !!st.connected;
    chip.className = `app-btn mdw-chip ${ok ? 'mdw-chip-ok' : ''}`;
    chip.innerHTML = `<span class="mdw-dot ${ok ? 'ok' : ''}"></span>${ok ? '设备已连接' : (addr ? '设备未连接' : '未配置设备')}`;
  }
  const sbL = document.getElementById('sb-left');
  if (sbL) {
    const addr = (st.connection && st.connection.address) || '未填写设备地址';
    sbL.innerHTML = `<span class="mdw-dot ${st.connected ? 'ok' : ''}"></span>${st.connected ? '设备已连接' : '设备未连接'} <span class="mdw-muted">${esc(addr)}</span>`;
  }
  const sbR = document.getElementById('sb-right');
  if (sbR) sbR.textContent = `${PHASE_LABEL[st.phase] || st.phase}${st.detail ? ' · ' + st.detail : ''}`;
  // MAA 式「开始 / 停止」按钮状态
  const startBtn = document.getElementById('q-run');
  if (startBtn) startBtn.textContent = ['loading', 'connecting', 'running', 'stopping'].includes(st.phase) ? '停止' : '开始';
  const live = document.querySelector('.mdw-live');
  if (live) {
    const set = (sel, text) => { const el = live.querySelector(sel); if (el) el.textContent = text; };
    set('[data-live="state"]', PHASE_LABEL[st.phase] || st.phase || '—');
    set('[data-live="device"]', (st.connection && st.connection.address) || '—');
    set('[data-live="maa"]', st.maaVersion || (st.maa && st.maa.ok ? '已就绪' : '未就绪'));
  }
  // keep the workbench "ready" card in sync (it is re-rendered only on interaction)
  const ready = document.querySelector('.mdw-ready');
  if (ready) {
    const addr = (st.connection && st.connection.address) || '';
    const ok = !!(addr && st.maa && st.maa.ok);
    ready.classList.toggle('ok', ok);
    ready.classList.toggle('warn', !ok);
    const state = ready.querySelector('.mdw-ready-state');
    if (state) state.textContent = PHASE_LABEL[st.phase] || st.phase || '—';
    const title = ready.querySelector('.mdw-ready-title');
    if (title) title.textContent = ok ? '准备就绪' : '尚未就绪';
    const sub = ready.querySelector('.mdw-ready-sub');
    if (sub) {
      const n = document.querySelectorAll('.mdw-qi-check:checked').length;
      sub.textContent = `${addr || '未配置设备'} · ${n} 个任务已启用 · MAA ${st.maaVersion || '—'}`;
    }
  }
}

async function refreshShell() {
  try { SHELL.runner = await api.get('/api/runner/status'); } catch { /* keep last */ }
  renderShell();
}

function timelineItem(entry) {
  const t = String(entry.timestamp || '').slice(11, 19);
  return `<div class="mdw-tl-item lv-${esc(entry.level)}"><span class="mdw-tl-dot"></span><div class="mdw-tl-body">
    <div class="mdw-tl-time">${esc(t)}</div>
    <div class="mdw-tl-text">${esc(entry.message)}</div>
    <div class="mdw-tl-src">${esc(entry.source || '')}</div></div></div>`;
}

function pushLog(entry) {
  LOGS.push(entry);
  if (LOGS.length > 500) LOGS.shift();
  const tl = document.getElementById('timeline');
  if (!tl) return;
  tl.insertAdjacentHTML('beforeend', timelineItem(entry));
  while (tl.children.length > 200) tl.removeChild(tl.firstChild);
  if (liveFollow) tl.scrollTop = tl.scrollHeight;
}

function connectLogStream() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let retry = 0;
  const open = () => {
    const ws = new WebSocket(`${proto}://${location.host}/api/ws`);
    ws.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data);
        if (e.type === 'log') pushLog(e);
      } catch { /* ignore */ }
    };
    ws.onopen = () => { retry = 0; };
    ws.onclose = () => { retry = Math.min(retry + 1, 6); setTimeout(open, 1000 * 2 ** retry); };
  };
  open();
}

async function testConnection(btn) {
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = '测试中…';
  try {
    const r = await api.send('/api/runner/test-connect', 'POST');
    pushLog({
      timestamp: new Date().toISOString(), level: r.ok ? 'info' : 'warn', source: 'runner',
      message: r.ok ? `连接测试成功 ${r.address}（${r.ms} ms）` : `连接测试失败：${r.error}`,
    });
    flashSaved(r.ok ? `连接成功（${r.ms} ms）` : `连接失败：${r.error}`, !r.ok);
  } catch (e) {
    flashSaved(e.message, true);
  }
  btn.disabled = false; btn.textContent = old;
  refreshShell();
}

async function bootShell() {
  try { SHELL.version = await api.get('/api/version'); } catch { /* ignore */ }
  const conn = await api.get('/api/connection').catch(() => ({ connection: {} }));
  SHELL.connection = conn.connection || {};
  renderShell();
  await refreshShell();
  setInterval(refreshShell, 3000);
  const btn = document.getElementById('tb-connect');
  if (btn) btn.addEventListener('click', () => testConnection(btn));
  const logs = await api.get('/api/logs?limit=80').catch(() => ({ entries: [] }));
  for (const e of logs.entries || []) pushLog(e);
  connectLogStream();
}

// ----------------------------------------------------------- 任务页（一键长草工作台）
let CATALOG = null;
let TASK_UI = null;   // MAA 桌面端界面布局（逐项对照 MaaWpfGui XAML）
let TCONF = {};      // { taskId: {optId: value}, _meta: {postAction} }
let SELECTED = null;
let saveTimer = null;
let activeTab = 'basic';

function defaultsFor(task) {
  const o = {};
  for (const opt of task.options || []) o[opt.id] = opt.choicesFrom ? CATALOG[opt.choicesFrom][0].value : opt.default;
  return o;
}
function optsFor(id) {
  const t = CATALOG.tasks.find((x) => x.id === id);
  return Object.assign(defaultsFor(t), TCONF[id] || {});
}
function saveTasksConfig() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await api.send('/api/tasks/config', 'PUT', TCONF); flashSaved('已自动保存'); }
    catch (e) { flashSaved('保存失败: ' + e.message, true); }
  }, 600);
}
function flashSaved(text, bad) {
  const el = document.getElementById('save-ind');
  if (el) { el.textContent = text; el.className = 'mdw-muted' + (bad ? ' mdw-error' : ''); }
}
function choiceLabel(task, optId, value) {
  const opt = (task.options || []).find((o) => o.id === optId) || {};
  const choices = opt.choices || CATALOG[opt.choicesFrom] || [];
  const hit = choices.find((c) => String(c.value) === String(value));
  return hit ? hit.label : String(value);
}

// 队列条目的一行摘要（对齐桌面端：关卡 · 策略）
function taskSummary(task) {
  const o = optsFor(task.id);
  switch (task.id) {
    case 'fight': {
      const stage = o.stage ? o.stage : '当前/上次';
      const med = Number(o.medicine) > 0 ? `理智药 ${o.medicine}` : '吃完至自然恢复上限';
      return `${stage} · ${med}`;
    }
    case 'infrast': {
      const names = (o.facility || []).map((v) => choiceLabel(task, 'facility', v));
      return names.length ? `${names.slice(0, 3).join('、')}${names.length > 3 ? ' 等' : ''}` : '未选择设施';
    }
    case 'award': {
      const on = ['award', 'mail', 'recruit'].filter((k) => o[k]).length;
      return on ? `日常、邮件及单抽（${on} 项）` : '未启用子项';
    }
    case 'recruit': {
      const conf = (o.confirm || []).map((v) => `${v} 星`).join(' / ');
      return conf ? `仅确认 ${conf} 标签` : '未设置确认星级';
    }
    case 'mall': {
      const first = String(o.buy_first || '').split(/[,，;；]/)[0] || '—';
      const bits = [`优先购买 ${first}`];
      if (o.only_buy_discount) bits.push('只买打折');
      if (o.visit_friends) bits.push('访问好友');
      return bits.join(' · ');
    }
    case 'roguelike':
      return `${choiceLabel(task, 'theme', o.theme)} · ${choiceLabel(task, 'mode', o.mode)}`;
    case 'reclamation':
      return `${choiceLabel(task, 'theme', o.theme)} · ${choiceLabel(task, 'mode', o.mode)}`;
    case 'startup':
      return `${choiceLabel(task, 'client_type', o.client_type)} · ${o.start_game_enabled ? '自动启动客户端' : '不启动客户端'}${o.account_name ? ' · 切换 ' + o.account_name : ''}`;
    case 'depot':
      return '识别仓库材料并供掉落/库存统计使用';
    case 'operbox':
      return '识别当前账号干员列表';
    case 'switchtheme':
      return o.themes ? `切换到 ${o.themes}` : '未填写主题名称';
    case 'custom':
      return (o.task_names && String(o.task_names).trim()) ? `执行 ${o.task_names}` : '未选择 interface.json 任务';
    default:
      return task.description || '';
  }
}

function optionRowHtml(task, opt) {
  const val = optsFor(task.id)[opt.id];
  const id = `o-${task.id}-${opt.id}`;
  const desc = opt.help || opt.placeholder || '';
  let ctl = '';
  if (opt.type === 'switch') {
    ctl = switchCtl(id, !!val);
  } else if (opt.type === 'select') {
    ctl = selectCtl(id, opt.choices || CATALOG[opt.choicesFrom] || [], val);
  } else if (opt.type === 'counter') {
    ctl = `<div class="mdw-stepper"><button type="button" class="app-btn mdw-step" data-step="-1" data-for="${id}">−</button>
      <input type="number" class="app-input-text" id="${id}" value="${esc(String(val))}" min="${opt.min ?? 0}" max="${opt.max ?? 9999}"/>
      <button type="button" class="app-btn mdw-step" data-step="1" data-for="${id}">＋</button></div>`;
  } else if (opt.type === 'multi') {
    const arr = (Array.isArray(val) ? val : []).map(String);
    ctl = `<div class="mdw-multi">${(opt.choices || []).map((c) =>
      `<label class="mdw-check"><input type="checkbox" class="app-checkbox mdw-multi-item" data-task="${task.id}" data-opt="${opt.id}" data-val="${esc(String(c.value))}" ${arr.includes(String(c.value)) ? 'checked' : ''}/><span>${esc(c.label)}</span></label>`).join('')}</div>`;
  } else if (opt.type === 'json') {
    const txt = typeof val === 'string' ? val : JSON.stringify(val ?? (opt.protocol && opt.protocol.type === 'array' ? [] : {}));
    ctl = `<textarea class="app-textarea mdw-row-ctl mdw-json" id="${id}" rows="2" placeholder="${esc(opt.protocol ? opt.protocol.type : 'json')}">${esc(txt)}</textarea>`;
  } else {
    ctl = `<input type="text" class="app-input-text mdw-row-ctl" id="${id}" value="${esc(val ?? '')}" placeholder="${esc(opt.placeholder || '')}"/>`;
  }
  return stdRow(opt.label, desc, ctl);
}

function renderTaskOptions(task, tab) {
  const want = tab === 'advanced' ? 'advanced' : 'basic';
  const opts = (task.options || []).filter((o) => (o.group || 'basic') === want);
  if (!opts.length) {
    return `<div class="mdw-row"><div class="mdw-row-l"><div class="mdw-row-desc">${want === 'advanced' ? '该任务没有额外的高级参数。' : '该任务没有常规参数（仅需启用/禁用）。'}</div></div></div>`;
  }
  return opts.map((o) => optionRowHtml(task, o)).join('');
}

// 客户端侧的下发预览（与服务端 buildParams 同样的规则，仅用于展示）
function previewParams(task) {
  if (!task) return {};
  const o = optsFor(task.id);
  const params = { enable: true };
  for (const opt of task.options || []) {
    const v = o[opt.id];
    const t = (opt.protocol && opt.protocol.type) || opt.type;
    if (t === 'boolean') params[opt.id] = !!v;
    else if (t === 'number') params[opt.id] = Number(v) || 0;
    else if (t === 'array') params[opt.id] = Array.isArray(v) ? v : [];
    else if (t === 'object') params[opt.id] = v && typeof v === 'object' ? v : {};
    else if (v !== '' && v != null) params[opt.id] = v;
  }
  return { task: task.taskType, params };
}

// ============ MAA 桌面端样式设置面板（逐项对照 MaaWpfGui XAML） ============
const MAA_WEEKDAYS = [['Sun', '星期日'], ['Mon', '星期一'], ['Tue', '星期二'], ['Wed', '星期三'], ['Thu', '星期四'], ['Fri', '星期五'], ['Sat', '星期六']];

function maaHelp(text) {
  return text ? `<span class="mdw-help" title="${esc(text)}">?</span>` : '';
}
function maaLabel(text, help) {
  return `<div class="mdw-maa-label">${esc(text)}${maaHelp(help)}</div>`;
}
function uiVal(taskId, key, fallback) {
  const t = TCONF[taskId] || {};
  return t[key] === undefined ? fallback : t[key];
}
function uiChoice(list, value) {
  return (list || []).map((c) => `<option value="${esc(String(c.value))}" ${String(c.value) === String(value == null ? '' : value) ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
}

// 单个控件的 HTML（MAA：勾选框在左，数值/下拉紧跟其后）
function maaControl(ctl, taskId) {
  const id = `u-${taskId}-${ctl.id}`;
  const off = uiVal(taskId, ctl.id, ctl.kind === 'check' || ctl.kind.startsWith('check-') ? false : ctl.default);
  const choices = ctl.choices || (ctl.choicesFrom ? TASK_UI[ctl.choicesFrom] : null);
  const num = ctl.number || { min: 0, max: 9999, default: 0 };
  const shown = ctl.showWhen ? !!uiVal(taskId, ctl.showWhen, false) : true;
  const wrap = (inner, cls = '') => `<div class="mdw-maa-row ${cls}" data-showwhen="${ctl.showWhen || ''}" ${shown ? '' : 'hidden'}>${inner}</div>`;

  if (ctl.kind === 'check') {
    return wrap(`<label class="mdw-maa-check"><input type="checkbox" class="app-checkbox" id="${id}" ${off ? 'checked' : ''}/><span>${esc(ctl.label)}</span></label>${maaHelp(ctl.help)}`);
  }
  if (ctl.kind === 'check-number') {
    const v = uiVal(taskId, ctl.id + 'Value', num.default);
    return wrap(`<label class="mdw-maa-check"><input type="checkbox" class="app-checkbox" id="${id}" ${off ? 'checked' : ''}/><span>${esc(ctl.label)}</span></label>${maaHelp(ctl.help)}
      <input type="number" class="app-input-text mdw-num" id="${id}-v" value="${esc(String(v))}" min="${num.min}" max="${num.max}"/>`);
  }
  if (ctl.kind === 'check-select') {
    const v = uiVal(taskId, ctl.id + 'Value', (choices && choices[0]) ? choices[0].value : '');
    return wrap(`<label class="mdw-maa-check"><input type="checkbox" class="app-checkbox" id="${id}" ${off ? 'checked' : ''}/><span>${esc(ctl.label)}</span></label>${maaHelp(ctl.help)}
      <div class="app-select-menu mdw-maa-select"><select id="${id}-v">${uiChoice(choices, v)}</select></div>`);
  }
  if (ctl.kind === 'select') {
    const v = uiVal(taskId, ctl.id, ctl.default);
    return wrap(`${maaLabel(ctl.label, ctl.help)}<div class="app-select-menu mdw-maa-select"><select id="${id}">${uiChoice(choices, v)}</select></div>`, 'mdw-col');
  }
  if (ctl.kind === 'text') {
    const v = uiVal(taskId, ctl.id, ctl.default || '');
    return wrap(`${ctl.label ? maaLabel(ctl.label, ctl.help) : maaHelp(ctl.help)}
      <input type="text" class="app-input-text mdw-maa-text" id="${id}" value="${esc(String(v))}" placeholder="${esc(ctl.placeholder || '')}"/>${ctl.browse ? '<button type="button" class="app-btn" disabled title="服务端容器内路径需手填">选择</button>' : ''}`,
      ctl.label ? 'mdw-col' : '');
  }
  if (ctl.kind === 'weekdays') {
    const week = uiVal(taskId, ctl.id, {}) || {};
    return `<div class="mdw-maa-week" data-showwhen="${ctl.showWhen || ''}" ${shown ? '' : 'hidden'}>
      ${MAA_WEEKDAYS.map(([k, label]) => `<div class="mdw-maa-weekrow"><span>${label}</span>
        <div class="app-select-menu"><select data-weekday="${k}">${uiChoice(TASK_UI.stages, week[k] === undefined ? '1-7' : week[k])}</select></div></div>`).join('')}
    </div>`;
  }
  return '';
}

function maaSharedBlock(taskId) {
  const conn = SHELL.connection || {};
  const list = TASK_UI.shared || [];
  const pick = (id) => list.find((c) => c.id === id);
  return `
    <div class="mdw-maa-heading">以下选项为多任务共享</div>
    ${maaControl({ id: 'StartGame', kind: 'check', label: '是否启动客户端', bind: 'start_game_enabled', help: '作用于整队任务。' }, taskId)}
    <div class="mdw-maa-row mdw-col">${maaLabel('客户端类型', 'MAA 会根据客户端类型选择对应的资源与任务参数。')}
      <div class="app-select-menu mdw-maa-select"><select id="c-clientType">${uiChoice(pick('clientType').choices, conn.clientType || 'Official')}</select></div></div>
    <div class="mdw-maa-row mdw-col">${maaLabel('连接配置', pick('config').help)}
      <div class="app-select-menu mdw-maa-select"><select id="c-config">${uiChoice(pick('config').choices, conn.config || 'General')}</select></div></div>
    <div class="mdw-maa-row mdw-col">${maaLabel('ADB 路径', pick('adbPath').help)}
      <input type="text" class="app-input-text mdw-maa-text" id="c-adbPath" value="${esc(conn.adbPath || '')}" placeholder="${esc(pick('adbPath').placeholder || '')}"/></div>
    <div class="mdw-maa-row mdw-col">${maaLabel('连接地址', pick('address').help)}
      <input type="text" class="app-input-text mdw-maa-text" id="c-address" value="${esc(conn.address || '')}" placeholder="${esc(pick('address').placeholder || '')}"/></div>
    <div class="mdw-maa-row mdw-col">${maaLabel('触控模式', pick('touchMode').help)}
      <div class="app-select-menu mdw-maa-select"><select id="c-touchMode">${uiChoice(pick('touchMode').choices, conn.touchMode || 'minitouch')}</select></div></div>
    <div class="mdw-maa-row"><button type="button" class="app-btn" id="btn-shot-test" title="当前以连接测试代替（MaaCore AsstAsyncConnect 探活）">截图测试</button></div>`;
}

function renderMaaSettings(task, tab) {
  const ui = TASK_UI.tasks[task.taskType];
  const key = tab === 'adv' ? 'advanced' : 'basic';
  const controls = (ui[key] || []).map((c) => maaControl(c, task.id)).join('');
  const shared = (task.taskType === 'StartUp' && key === 'basic') ? maaSharedBlock(task.id) : '';
  const empty = `<div class="mdw-maa-empty">${key === 'advanced' ? '该任务没有高级参数。' : '该任务没有常规参数。'}</div>`;
  return `<div class="mdw-maa-scroll">${controls || (shared ? '' : empty)}${shared}</div>
    <div class="mdw-maa-tabs">
      <button type="button" class="mdw-maatab ${tab === 'basic' ? 'active' : ''}" data-tab="basic">常规设置</button>
      <button type="button" class="mdw-maatab ${tab === 'advanced' ? 'active' : ''}" data-tab="adv">高级设置</button>
    </div>`;
}

function bindMaaSettings(wrap, task) {
  const ui = TASK_UI.tasks[task.taskType];
  const store = (key, v) => {
    TCONF[task.id] = TCONF[task.id] || {};
    TCONF[task.id][key] = v;
    saveTasksConfig();
    refreshQueueSummary(task.id);
  };
  const applyVisibility = () => {
    wrap.querySelectorAll('[data-showwhen]').forEach((node) => {
      const key = node.getAttribute('data-showwhen');
      if (!key) return;
      node.hidden = !uiVal(task.id, key, false);
    });
  };
  for (const ctl of [...(ui.basic || []), ...(ui.advanced || [])]) {
    const id = `u-${task.id}-${ctl.id}`;
    const box = wrap.querySelector(`#${id}`);
    if (ctl.kind === 'check' && box) box.addEventListener('change', () => { store(ctl.id, box.checked); applyVisibility(); });
    else if (ctl.kind === 'check-number' && box) {
      box.addEventListener('change', () => { store(ctl.id, box.checked); applyVisibility(); });
      const num = wrap.querySelector(`#${id}-v`);
      if (num) num.addEventListener('change', () => store(ctl.id + 'Value', Number(num.value) || 0));
    } else if (ctl.kind === 'check-select' && box) {
      box.addEventListener('change', () => { store(ctl.id, box.checked); applyVisibility(); });
      const sel = wrap.querySelector(`#${id}-v`);
      if (sel) sel.addEventListener('change', () => store(ctl.id + 'Value', sel.value));
    } else if (ctl.kind === 'select' && box) {
      box.addEventListener('change', () => store(ctl.id, box.value));
    } else if (ctl.kind === 'text' && box) {
      box.addEventListener('input', () => store(ctl.id, box.value));
    }
  }
  wrap.querySelectorAll('[data-weekday]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const week = Object.assign({}, uiVal(task.id, 'WeeklySchedule', {}));
      week[sel.dataset.weekday] = sel.value;
      store('WeeklySchedule', week);
    });
  });
  // 多任务共享项
  const conn = (key, v) => api.send('/api/connection', 'PUT', Object.assign({}, SHELL.connection, { [key]: v }))
    .then(() => { SHELL.connection[key] = v; flashSaved('已保存'); refreshShell(); })
    .catch((e) => flashSaved(e.message, true));
  const bindConn = (id, key) => { const n = wrap.querySelector(`#${id}`); if (n) n.addEventListener('change', () => conn(key, n.value.trim ? n.value.trim() : n.value)); };
  bindConn('c-clientType', 'clientType');
  bindConn('c-config', 'config');
  bindConn('c-adbPath', 'adbPath');
  bindConn('c-address', 'address');
  bindConn('c-touchMode', 'touchMode');
  const shot = wrap.querySelector('#btn-shot-test');
  if (shot) shot.addEventListener('click', () => testConnection(shot));
  applyVisibility();
}

// 协议字段面板（用于 MAA 界面未覆盖的任务）
function bindTaskOptions(root, task) {
  const write = (opt, v) => {
    TCONF[task.id] = TCONF[task.id] || {};
    TCONF[task.id][opt.id] = v;
    saveTasksConfig();
    refreshQueueSummary(task.id);
    const pv = root.querySelector('#params-preview');
    if (pv) pv.textContent = JSON.stringify(previewParams(task), null, 2);
  };
  for (const opt of task.options || []) {
    const id = `o-${task.id}-${opt.id}`;
    const node = root.querySelector(`#${id}`);
    if (!node) continue;
    if (opt.type === 'switch') node.addEventListener('change', () => write(opt, node.checked));
    else if (opt.type === 'select') node.addEventListener('change', () => {
      const hit = (opt.choices || CATALOG[opt.choicesFrom] || []).find((c) => String(c.value) === node.value);
      write(opt, hit ? hit.value : node.value);
    });
    else if (opt.type === 'counter') node.addEventListener('change', () => write(opt, Number(node.value) || 0));
    else if (opt.type === 'text') node.addEventListener('input', () => write(opt, node.value));
    else if (opt.type === 'json') node.addEventListener('change', () => {
      const raw = node.value.trim();
      if (!raw) { write(opt, opt.protocol && opt.protocol.type === 'array' ? [] : {}); return; }
      try { write(opt, JSON.parse(raw)); }
      catch { flashSaved(`「${opt.label}」不是合法 JSON，已保留原值`, true); }
    });
  }
  root.querySelectorAll('.mdw-step').forEach((b) => b.addEventListener('click', () => {
    const input = root.querySelector(`#${b.dataset.for}`);
    const opt = (task.options || []).find((o) => `o-${task.id}-${o.id}` === input.id);
    if (!opt) return;
    let v = (Number(input.value) || 0) + Number(b.dataset.step);
    if (opt.min != null) v = Math.max(opt.min, v);
    if (opt.max != null) v = Math.min(opt.max, v);
    input.value = v;
    write(opt, v);
  }));
  root.querySelectorAll('.mdw-multi-item').forEach((cb) => cb.addEventListener('change', () => {
    const opt = (task.options || []).find((o) => o.id === cb.dataset.opt);
    if (!opt) return;
    const cur = new Set((optsFor(task.id)[opt.id] || []).map(String));
    if (cb.checked) cur.add(cb.dataset.val); else cur.delete(cb.dataset.val);
    write(opt, (opt.choices || []).filter((c) => cur.has(String(c.value))).map((c) => c.value));
  }));
}

function refreshQueueSummary(taskId) {
  const el = document.querySelector(`.mdw-qi[data-task="${taskId}"] .mdw-qi-sub`);
  const task = CATALOG.tasks.find((t) => t.id === taskId);
  if (el && task) el.textContent = taskSummary(task);
}

function renderMain(wrap) {
  const task = CATALOG.tasks.find((t) => t.id === SELECTED);
  const st = SHELL.runner || {};
  const maaUi = TASK_UI && task && TASK_UI.tasks[task.taskType];
  const statusLine = `${esc((st.connection && st.connection.address) || '未配置设备')} · MAA ${esc(st.maaVersion || '—')} · ${esc(PHASE_LABEL[st.phase] || st.phase)}`;

  if (maaUi) {
    wrap.innerHTML = `
      <div class="mdw-maa-status">${statusLine}</div>
      ${renderMaaSettings(task, activeTab)}
      <div class="mdw-footline"><span class="mdw-muted" id="save-ind"></span></div>`;
    wrap.querySelectorAll('.mdw-maatab').forEach((t) => t.addEventListener('click', () => { activeTab = t.dataset.tab; renderMain(wrap); }));
    bindMaaSettings(wrap, task);
    return;
  }

  const selected = [...wrap.closest('.mdw-workbench').querySelectorAll('.mdw-qi-check:checked')].map((c) => c.dataset.task);
  const ready = !!((st.connection && st.connection.address) && st.maa && st.maa.ok);
  wrap.innerHTML = `
    <div class="mdw-crumb">首页 / 一键长草</div>
    <h1 class="mdw-h1">一键长草</h1>
    <div class="mdw-ready ${ready ? 'ok' : 'warn'}">
      <div class="mdw-ready-l">
        <div class="mdw-ready-state">${esc(PHASE_LABEL[st.phase] || st.phase)}</div>
        <div class="mdw-ready-title">${ready ? '准备就绪' : '尚未就绪'}</div>
        <div class="mdw-ready-sub">${esc((st.connection && st.connection.address) || '未配置设备')} · ${selected.length} 个任务已启用 · MAA ${esc(st.maaVersion || '—')}</div>
      </div>
      <div class="mdw-ready-r"><button type="button" class="app-btn mdw-btn-primary" id="btn-run2">立即执行</button></div>
    </div>
    <div class="mdw-tabs">
      <button type="button" class="mdw-tab ${activeTab === 'basic' ? 'active' : ''}" data-tab="basic">常规设置</button>
      <button type="button" class="mdw-tab ${activeTab === 'adv' ? 'active' : ''}" data-tab="adv">高级设置</button>
    </div>
    ${activeTab === 'basic' ? `
      <div class="mdw-group">
        <div class="mdw-group-head"><div class="mdw-group-title">客户端</div><div class="mdw-group-desc">该组配置会应用到本次任务队列。</div></div>
        ${stdRow('客户端类型', '与当前账号和资源包保持一致', selectCtl('g-client', CATALOG.clients, SHELL.connection.clientType || CATALOG.clients[0].value))}
      </div>
      <div class="mdw-group">
        <div class="mdw-group-head"><div class="mdw-group-title">设备连接</div><div class="mdw-group-desc">MAA 真正需要的是一个可用的 ADB 地址。</div></div>
        ${stdRow('连接地址', '通过 ADB TCP 连接设备', `<input type="text" class="app-input-text mdw-row-ctl" id="g-addr" value="${esc(SHELL.connection.address || '')}" placeholder="192.168.31.190:5555"/>`)}
        ${stdRow('连接配置', 'MAA Core 内置识别与截图策略', selectCtl('g-config', connProfileChoices(), SHELL.connection.config || 'General'))}
        ${stdRow('ADB 路径', '留空使用容器内 /usr/bin/adb', `<input type="text" class="app-input-text mdw-row-ctl" id="g-adbpath" value="${esc(SHELL.connection.adbPath || '')}" placeholder="/usr/bin/adb"/>`)}
        <div class="mdw-row"><div class="mdw-row-l"><div class="mdw-row-label">连接测试</div><div class="mdw-row-desc">加载资源并尝试连接设备</div></div>
          <div class="mdw-row-r"><button type="button" class="app-btn" id="btn-test">测试连接</button></div></div>
      </div>
      <div class="mdw-group">
        <div class="mdw-group-head"><div class="mdw-group-title">任务设置 · ${esc(task ? task.name : '未选择')}</div><div class="mdw-group-desc">${esc(task ? (task.description || '') : '在左侧队列中选择任务')}</div></div>
        ${task ? renderTaskOptions(task, activeTab) : '<div class="mdw-row"><div class="mdw-row-l"><div class="mdw-row-desc">未选择任务</div></div></div>'}
      </div>` : `
      <div class="mdw-group">
        <div class="mdw-group-head"><div class="mdw-group-title">任务设置 · ${esc(task ? task.name : '未选择')}</div><div class="mdw-group-desc">高级设置：低频与细节参数（与常规设置同源，保存后一并下发）。</div></div>
        ${task ? renderTaskOptions(task, 'advanced') : '<div class="mdw-row"><div class="mdw-row-l"><div class="mdw-row-desc">未选择任务</div></div></div>'}
      </div>
      <div class="mdw-group">
        <div class="mdw-group-head"><div class="mdw-group-title">任务参数（下发预览）</div><div class="mdw-group-desc">服务端按 MAA 集成协议字段生成，等价于 AsstAppendTask 的 params。</div></div>
        <pre class="mdw-pre" id="params-preview">${esc(JSON.stringify(previewParams(task), null, 2))}</pre>
      </div>`}
    <div class="mdw-footline">
      <span class="mdw-muted" id="save-ind"></span>
      <span class="mdw-muted" id="run-count"></span>
    </div>`;

  wrap.querySelectorAll('.mdw-tab').forEach((t) => t.addEventListener('click', () => { activeTab = t.dataset.tab; renderMain(wrap); }));
  const g = (id) => wrap.querySelector(`#${id}`);
  const saveConn = async (patch) => {
    try {
      SHELL.connection = Object.assign({}, SHELL.connection, patch);
      await api.send('/api/connection', 'PUT', SHELL.connection);
      flashSaved('连接设置已保存');
      refreshShell();
    } catch (e) { flashSaved(e.message, true); }
  };
  if (g('g-client')) g('g-client').addEventListener('change', () => saveConn({ clientType: g('g-client').value }));
  if (g('g-config')) g('g-config').addEventListener('change', () => saveConn({ config: g('g-config').value }));
  if (g('g-addr')) g('g-addr').addEventListener('change', () => saveConn({ address: g('g-addr').value.trim() }));
  if (g('g-adbpath')) g('g-adbpath').addEventListener('change', () => saveConn({ adbPath: g('g-adbpath').value.trim() }));
  if (g('btn-test')) g('btn-test').addEventListener('click', () => testConnection(g('btn-test')));
  if (task) bindTaskOptions(wrap, task);
  if (g('btn-run2')) g('btn-run2').addEventListener('click', runQueue);
  const n = wrap.closest('.mdw-workbench').querySelectorAll('.mdw-qi-check:checked').length;
  if (g('run-count')) g('run-count').textContent = `已勾选 ${n} 项任务`;
}

async function runQueue() {
  const boxes = [...document.querySelectorAll('.mdw-qi-check:checked')];
  if (!boxes.length) { flashSaved('请先勾选要执行的任务', true); return; }
  flashSaved('已下发，执行中…');
  pushLog({ timestamp: new Date().toISOString(), level: 'info', source: 'web', message: `下发任务: ${boxes.map((c) => c.dataset.task).join(', ')}` });
  try {
    await api.send('/api/tasks/execute', 'POST', { tasks: boxes.map((c) => c.dataset.task) });
  } catch (e) {
    flashSaved(e.message, true);
    pushLog({ timestamp: new Date().toISOString(), level: 'warn', source: 'web', message: e.message });
  }
  refreshShell();
}

async function pageTasks(el) {
  if (!CATALOG) {
    const [catalog, saved, taskUi] = await Promise.all([
      api.get('/api/tasks/catalog'), api.get('/api/tasks/config'), api.get('/api/tasks/ui'),
    ]);
    CATALOG = catalog;
    TCONF = saved.config || {};
    TASK_UI = taskUi;
  }
  if (!SELECTED) SELECTED = CATALOG.tasks[0] && CATALOG.tasks[0].id;
  const postAction = (TCONF._meta && TCONF._meta.postAction) || 'None';
  el.innerHTML = `
    <div class="mdw-workbench">
      <section class="mdw-queue">
        <div class="mdw-queue-head"><div class="mdw-queue-title">任务队列</div><div class="mdw-queue-sub">按任务切换配置顺序</div></div>
        <div class="mdw-queue-list">
          ${CATALOG.tasks.map((t) => `
            <div class="mdw-qi ${t.id === SELECTED ? 'selected' : ''}" data-task="${t.id}" role="button" tabindex="0">
              <input type="checkbox" class="app-checkbox mdw-qi-check" data-task="${t.id}"/>
              <div class="mdw-qi-text"><div class="mdw-qi-name">${esc(t.name)}</div><div class="mdw-qi-sub">${esc(taskSummary(t))}</div></div>
              <button type="button" class="mdw-qi-gear" title="任务设置" aria-label="任务设置"><i class="icons10-settings"></i></button>
            </div>`).join('')}
        </div>
        <div class="mdw-queue-foot">
          <div class="mdw-queue-tools">
            <button type="button" class="app-btn mdw-addbtn" id="q-add" title="添加任务">＋</button>
            <button type="button" class="app-btn" id="q-all">全选</button>
            <button type="button" class="app-btn" id="q-clear">清空</button>
          </div>
          <div class="mdw-queue-post">
            <span>完成后</span>
            <div class="app-select-menu"><select id="q-post">
              ${(TASK_UI && TASK_UI.postActions ? TASK_UI.postActions : [{ value: 'None', label: '无操作' }])
                .map((p) => `<option value="${esc(p.value)}" ${p.value === postAction ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
            </select></div>
          </div>
          <button type="button" class="app-btn mdw-btn-primary mdw-startbtn" id="q-run">${SHELL.runner && SHELL.runner.phase && ['loading', 'connecting', 'running'].includes(SHELL.runner.phase) ? '停止' : '开始'}</button>
        </div>
      </section>
      <section class="mdw-main" id="mdw-main"></section>
      <aside class="mdw-live">
        <div class="mdw-live-head"><div class="mdw-live-title">运行实况</div>
          <label class="mdw-check"><input type="checkbox" class="app-checkbox" id="live-follow" ${liveFollow ? 'checked' : ''}/><span class="mdw-muted">自动跟随</span></label></div>
        <div class="mdw-live-stats">
          <div class="mdw-live-stat"><span>当前状态</span><b data-live="state">—</b></div>
          <div class="mdw-live-stat"><span>设备</span><b data-live="device">—</b></div>
          <div class="mdw-live-stat"><span>MAA Core</span><b data-live="maa">—</b></div>
        </div>
        <div class="mdw-timeline" id="timeline"></div>
        <div class="mdw-live-foot">
          <button type="button" class="app-btn" id="log-copy">复制日志</button>
          <button type="button" class="app-btn" id="log-clear">清空</button>
        </div>
      </aside>
    </div>`;

  const $main = el.querySelector('.mdw-main');
  const redraw = () => {
    el.querySelectorAll('.mdw-qi').forEach((i) => i.classList.toggle('selected', i.dataset.task === SELECTED));
    renderMain($main);
  };
  el.querySelectorAll('.mdw-qi').forEach((item) => {
    const pick = () => { SELECTED = item.dataset.task; redraw(); };
    item.addEventListener('click', pick);
    item.querySelector('.mdw-qi-gear').addEventListener('click', (ev) => { ev.stopPropagation(); pick(); });
    const cb = item.querySelector('.mdw-qi-check');
    cb.addEventListener('click', (ev) => ev.stopPropagation());
    cb.addEventListener('change', () => {
      const n = el.querySelectorAll('.mdw-qi-check:checked').length;
      const rc = document.querySelector('#run-count');
      if (rc) rc.textContent = `已勾选 ${n} 项任务`;
      const rs = $main.querySelector('.mdw-ready-sub');
      if (rs) {
        const st = SHELL.runner || {};
        rs.textContent = `${(st.connection && st.connection.address) || '未配置设备'} · ${n} 个任务已启用 · MAA ${st.maaVersion || '—'}`;
      }
    });
  });
  el.querySelector('#live-follow').addEventListener('change', (ev) => { liveFollow = ev.target.checked; });
  el.querySelector('#q-all').addEventListener('click', () => { el.querySelectorAll('.mdw-qi-check').forEach((c) => { c.checked = true; c.dispatchEvent(new Event('change')); }); });
  el.querySelector('#q-clear').addEventListener('click', () => { el.querySelectorAll('.mdw-qi-check').forEach((c) => { c.checked = false; c.dispatchEvent(new Event('change')); }); });
  el.querySelector('#q-post').addEventListener('change', (ev) => {
    TCONF._meta = Object.assign({}, TCONF._meta, { postAction: ev.target.value });
    saveTasksConfig();
  });
  // ＋：把还没启用的任务加入队列（对齐 MAA 的「添加任务」）
  el.querySelector('#q-add').addEventListener('click', () => {
    const boxes = [...el.querySelectorAll('.mdw-qi-check')];
    const target = boxes.find((c) => !c.checked);
    if (!target) { flashSaved('所有任务都已在队列中'); return; }
    target.checked = true;
    target.dispatchEvent(new Event('change'));
    SELECTED = target.dataset.task;
    redraw();
    flashSaved(`已加入：${(CATALOG.tasks.find((t) => t.id === target.dataset.task) || {}).name || ''}`);
  });
  el.querySelector('#q-run').addEventListener('click', () => {
    const running = ['loading', 'connecting', 'running', 'stopping'].includes((SHELL.runner || {}).phase);
    if (running) { api.send('/api/runner/stop', 'POST').then(refreshShell).catch(() => {}); return; }
    runQueue();
  });
  el.querySelector('#log-copy').addEventListener('click', async () => {
    const text = LOGS.map((e) => `[${e.timestamp}] [${String(e.level).toUpperCase()}] [${e.source}] ${e.message}`).join('\n');
    try { await navigator.clipboard.writeText(text); flashSaved('日志已复制'); } catch { flashSaved('复制失败（浏览器限制）', true); }
  });
  el.querySelector('#log-clear').addEventListener('click', () => {
    LOGS.length = 0;
    el.querySelector('#timeline').innerHTML = '';
  });

  const tl = el.querySelector('#timeline');
  tl.innerHTML = LOGS.slice(-200).map(timelineItem).join('');
  if (liveFollow) tl.scrollTop = tl.scrollHeight;
  redraw();
  renderShell();
}

// ----------------------------------------------------------- 自动战斗（Copilot）
async function pageCopilot(el) {
  el.innerHTML = `
    <h2 class="mdw-h1">自动战斗</h2>
    <p class="mdw-muted">MAA 桌面端的自动战斗页依赖「作业（Copilot）」能力：作业文件解析、干员自动编队、视频识别等。</p>
    <div class="app-alert-bar"><span>本页尚未实现，当前为占位页。进度见「功能对照」页的 Copilot 部分（作业路径识别 / 多作业 / 视频识别 / 自动编队 / 作业分享，均为未实现）。</span></div>
    <div class="mdw-cards">
      <div class="mdw-card"><h3>协议支持</h3><div class="mdw-value" style="font-size:15px">Copilot / SSSCopilot / ParadoxCopilot 三种任务类型已在 spec 中（<code>maa-task-spec.json</code>）</div></div>
      <div class="mdw-card"><h3>缺少</h3><div class="mdw-value" style="font-size:15px">作业文件上传/解析、干员识别结果联动、编队与助战策略、视频识别</div></div>
    </div>`;
}

// ----------------------------------------------------------- 日程页
async function pageSchedule(el) {
  if (!CATALOG) CATALOG = await api.get('/api/tasks/catalog');
  const { schedule } = await api.get('/api/tasks/schedule');
  let rows = schedule.slice();
  el.innerHTML = `
    <h2 class="mdw-h1">日程 · 定时执行</h2>
    <p class="mdw-muted">到点自动执行勾选的任务（服务端调度器尚未接入，当前仅保存日程）。</p>
    <div class="mdw-hstack">
      <input type="time" class="app-input-text" id="s-time" value="04:00"/>
      ${selectCtl('s-task', CATALOG.tasks.map((t) => ({ value: t.id, label: t.name })), CATALOG.tasks[0].id)}
      <button type="button" class="app-btn" id="s-add">添加</button>
      <button type="button" class="app-btn mdw-btn-primary" id="s-save">保存日程</button>
      <span id="s-msg" class="mdw-muted"></span>
    </div>
    <div id="s-table" style="margin-top:14px"></div>`;
  const render = () => {
    el.querySelector('#s-table').innerHTML = rows.length ? `
      <div class="app-table-view-container"><table class="app-table-view">
        <thead><tr><th>时间</th><th>启用</th><th>任务</th><th></th></tr></thead>
        <tbody>${rows.map((r, i) => {
          const names = (r.tasks || []).map((id) => { const t = CATALOG.tasks.find((x) => x.id === id); return t ? t.name : id; });
          return `<tr>
            <td><input type="time" class="app-input-text mdw-time" data-i="${i}" value="${esc(r.time)}"/></td>
            <td>${switchCtl(`s-en-${i}`, r.enabled !== false)}</td>
            <td>${esc(names.join('、') || '（未选择任务）')}</td>
            <td><button type="button" class="app-btn mdw-del" data-i="${i}">删除</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`
      : '<p class="mdw-muted">暂无日程，先在上面添加一条。</p>';
    el.querySelectorAll('.mdw-time').forEach((inp) => inp.addEventListener('change', () => { rows[Number(inp.dataset.i)].time = inp.value || '04:00'; }));
    el.querySelectorAll('.mdw-del').forEach((b) => b.addEventListener('click', () => { rows.splice(Number(b.dataset.i), 1); render(); }));
    rows.forEach((r, i) => {
      const cb = el.querySelector(`#s-en-${i}`);
      if (cb) cb.addEventListener('change', () => { r.enabled = cb.checked; });
    });
  };
  render();
  el.querySelector('#s-add').addEventListener('click', () => {
    const t = el.querySelector('#s-task').value;
    const time = el.querySelector('#s-time').value || '04:00';
    const exist = rows.find((r) => r.time === time);
    if (exist) { if (!exist.tasks.includes(t)) exist.tasks.push(t); }
    else rows.push({ time, enabled: true, tasks: [t] });
    render();
  });
  el.querySelector('#s-save').addEventListener('click', async () => {
    try {
      const res = await api.send('/api/tasks/schedule', 'PUT', { schedule: rows });
      rows = res.schedule; render();
      el.querySelector('#s-msg').textContent = '已保存 ✔';
    } catch (e) { el.querySelector('#s-msg').textContent = '保存失败: ' + e.message; }
  });
}

// ----------------------------------------------------------- 设置页
async function pageSettings(el) {
  if (!CATALOG) CATALOG = await api.get('/api/tasks/catalog');
  const [cfg, conn] = await Promise.all([api.get('/api/config'), api.get('/api/connection')]);
  const c = conn.connection || {};
  el.innerHTML = `
    <h2 class="mdw-h1">设置</h2>
    ${accordion('常规设置', `
      ${stdRow('客户端类型', '与当前账号和资源包保持一致', selectCtl('st-client', CATALOG.clients, c.clientType || CATALOG.clients[0].value))}
      <div class="mdw-actions"><button type="button" class="app-btn mdw-btn-primary" id="st-save1">保存</button><span id="st-msg1" class="mdw-muted"></span></div>`, true)}
    ${accordion('连接设置', `
      ${stdRow('连接地址', '设备/模拟器的 ADB 端口', `<input type="text" class="app-input-text mdw-row-ctl" id="st-addr" value="${esc(c.address || '')}" placeholder="192.168.31.190:5555"/>`)}
      ${stdRow('ADB 路径', '留空使用容器内 /usr/bin/adb', `<input type="text" class="app-input-text mdw-row-ctl" id="st-adbpath" value="${esc(c.adbPath || '')}" placeholder="/usr/bin/adb"/>`)}
      ${stdRow('连接配置', 'MAA Core 内置识别与截图策略', selectCtl('st-conncfg', connProfileChoices(), c.config || 'General'))}
      <div class="mdw-actions"><button type="button" class="app-btn" id="st-test">测试连接</button><button type="button" class="app-btn mdw-btn-primary" id="st-save2">保存</button><span id="st-msg2" class="mdw-muted"></span></div>`, true)}
    ${accordion('启动设置', `
      ${stdRow('自动下载 Runtime', '数据卷中没有运行包时自动从官方 Release 下载', switchCtl('st-auto', !!cfg.autoFetchRuntime))}
      <div class="mdw-actions"><button type="button" class="app-btn mdw-btn-primary" id="st-save3">保存</button><span id="st-msg3" class="mdw-muted"></span></div>`, false)}
    ${accordion('服务设置', `
      ${stdRow('服务名称', '', `<input type="text" class="app-input-text mdw-row-ctl" id="st-name" value="${esc(cfg.serverName)}"/>`)}
      ${stdRow('日志等级', '', selectCtl('st-level', ['debug', 'info', 'warn', 'error'].map((l) => ({ value: l, label: l })), cfg.logLevel))}
      ${stdRow('时区', '', `<input type="text" class="app-input-text mdw-row-ctl" id="st-tz" value="${esc(cfg.timezone)}"/>`)}
      <div class="mdw-actions"><button type="button" class="app-btn mdw-btn-primary" id="st-save4">保存</button><span id="st-msg4" class="mdw-muted"></span></div>`, false)}`;
  bindAccordions(el);
  const g = (id) => el.querySelector(`#${id}`);
  g('st-save1').onclick = async () => {
    try { await api.send('/api/connection', 'PUT', Object.assign({}, c, { clientType: g('st-client').value })); g('st-msg1').textContent = '已保存 ✔'; }
    catch (e) { g('st-msg1').textContent = e.message; }
  };
  g('st-save2').onclick = async () => {
    try {
      await api.send('/api/connection', 'PUT', Object.assign({}, c, {
        address: g('st-addr').value.trim(), adbPath: g('st-adbpath').value.trim(), config: g('st-conncfg').value,
      }));
      g('st-msg2').textContent = '已保存 ✔';
      refreshShell();
    } catch (e) { g('st-msg2').textContent = e.message; }
  };
  g('st-test').onclick = () => testConnection(g('st-test'));
  g('st-save3').onclick = async () => {
    try { await api.send('/api/config', 'PUT', { autoFetchRuntime: g('st-auto').checked }); g('st-msg3').textContent = '已保存 ✔'; }
    catch (e) { g('st-msg3').textContent = e.message; }
  };
  g('st-save4').onclick = async () => {
    try { await api.send('/api/config', 'PUT', { serverName: g('st-name').value, logLevel: g('st-level').value, timezone: g('st-tz').value }); g('st-msg4').textContent = '已保存 ✔'; }
    catch (e) { g('st-msg4').textContent = e.message; }
  };
}

// ----------------------------------------------------------- 功能对照页
async function pageFeatures(el) {
  const data = await api.get('/api/features/parity');
  const badge = { full: ['ok', '已实现'], partial: ['warn', '部分'], none: ['bad', '未实现'], na: ['', '不适用'] };
  const count = { full: 0, partial: 0, none: 0, na: 0 };
  for (const s of data.sections) for (const it of s.items) count[it.status]++;
  el.innerHTML = `
    <h2 class="mdw-h1">功能对照 · MAA 桌面端 vs 本 Web</h2>
    <p class="mdw-muted">对照基准：${esc(data.upstream)}。本页与四语 README 由同一份 feature-parity.json 生成。</p>
    <div class="mdw-cards">
      <div class="mdw-card"><h3>已实现</h3><div class="mdw-value">${count.full}</div></div>
      <div class="mdw-card"><h3>部分实现</h3><div class="mdw-value">${count.partial}</div></div>
      <div class="mdw-card"><h3>未实现</h3><div class="mdw-value">${count.none}</div></div>
      <div class="mdw-card"><h3>桌面端专属</h3><div class="mdw-value">${count.na}</div></div>
    </div>
    ${data.sections.map((sec) => `
      <h3 class="mdw-sec-title">${esc(sec.module)}</h3>
      <div class="app-table-view-container"><table class="app-table-view mdw-feat-table">
        <thead><tr><th>功能</th><th>状态</th><th>说明</th></tr></thead>
        <tbody>${sec.items.map((it) => {
          const [cls, label] = badge[it.status] || ['', it.status];
          return `<tr><td>${esc(it.name)}</td><td><span class="mdw-pill ${cls}">${label}</span></td><td class="mdw-feat-note">${esc(it.note || '')}</td></tr>`;
        }).join('')}</tbody>
      </table></div>`).join('')}`;
}

// ----------------------------------------------------------- Runtime / 日志 / 关于
async function pageRuntime(el) {
  const render = (rt) => {
    el.innerHTML = `
      <h2 class="mdw-h1">MAA Runtime</h2>
      <div class="mdw-cards">
        <div class="mdw-card"><h3>状态</h3><div class="mdw-value">${pill(rt.status)}</div>${rt.error ? `<p class="mdw-error">${esc(rt.error)}</p>` : ''}</div>
        <div class="mdw-card"><h3>MAA 版本</h3><div class="mdw-value">${esc(rt.maaVersion)}</div></div>
        <div class="mdw-card"><h3>安装包</h3><div class="mdw-value" style="font-size:14px">${esc(rt.asset)}</div></div>
        <div class="mdw-card"><h3>获取时间</h3><div class="mdw-value" style="font-size:14px">${rt.fetchedAt ? esc(rt.fetchedAt) : '—'}</div></div>
      </div>
      <p class="mdw-muted">运行包从 MAA 官方 GitHub Release 下载并做 SHA-256 校验后解压到持久卷，本仓库不分发 MAA 二进制。</p>
      <div class="mdw-actions">
        <button id="btn-fetch" class="app-btn mdw-btn-primary" ${rt.busy ? 'disabled' : ''}>下载 / 更新运行包</button>
        <button id="btn-verify" class="app-btn" ${rt.status !== 'ready' ? 'disabled' : ''}>校验完整性</button>
        <button id="btn-resinfo" class="app-btn" ${rt.status !== 'ready' ? 'disabled' : ''}>资源目录信息</button>
      </div>
      <div id="rt-result" style="margin-top:16px"></div>`;
    el.querySelector('#btn-fetch').onclick = async () => {
      try { await api.send('/api/runtime/fetch', 'POST'); poll(); }
      catch (e) { el.querySelector('#rt-result').innerHTML = alertBar('alert-bar-danger', e.message); }
    };
    el.querySelector('#btn-verify').onclick = async () => {
      const v = await api.send('/api/resources/verify', 'POST');
      el.querySelector('#rt-result').innerHTML = `<div class="mdw-card"><h3>校验结果 ${v.ok ? '✔' : '✘'}</h3><div class="mdw-list">${v.checks.map((c) => `<div><b>${esc(c.name)}</b>: ${c.ok ? '通过' : '失败'} ${c.path ? `— ${esc(c.path)}` : ''}</div>`).join('')}</div></div>`;
    };
    el.querySelector('#btn-resinfo').onclick = async () => {
      const i = await api.get('/api/resources/info');
      el.querySelector('#rt-result').innerHTML = `<div class="mdw-card"><h3>资源信息</h3><div class="mdw-list"><div><b>根目录</b>: ${esc(i.root || '—')}</div><div><b>资源目录</b>: ${esc(i.resourceDir || '—')}</div><div><b>架构</b>: ${esc(i.arch || '—')}</div></div></div>`;
    };
  };
  const poll = async () => {
    const rt = await api.get('/api/runtime/status');
    render(rt);
    if (rt.busy) setTimeout(poll, 2000);
  };
  await poll();
}

async function pageLogs(el) {
  el.innerHTML = `
    <h2 class="mdw-h1">日志</h2>
    <div class="mdw-toolbar">
      ${selectCtl('lv', [{ value: '', label: '全部等级' }, { value: 'debug', label: 'debug' }, { value: 'info', label: 'info' }, { value: 'warn', label: 'warn' }, { value: 'error', label: 'error' }], '')}
      <input type="text" class="app-input-text" id="q" placeholder="搜索关键字"/>
      <label class="mdw-check"><input type="checkbox" class="app-checkbox" id="follow" checked/><span>自动滚动</span></label>
      <a class="app-btn" href="/api/logs/download" target="_blank">下载日志</a>
    </div>
    <div class="mdw-log" id="logbox"></div>`;
  const box = el.querySelector('#logbox');
  const renderLog = () => {
    const lv = el.querySelector('#lv').value;
    const q = el.querySelector('#q').value.toLowerCase();
    const html = LOGS
      .filter((e) => (!lv || e.level === lv) && (!q || String(e.message).toLowerCase().includes(q)))
      .map((e) => `<div class="lv-${e.level}">[${esc(e.timestamp)}] [${String(e.level).toUpperCase()}] [${esc(e.source)}] ${esc(e.message)}</div>`)
      .join('');
    const stick = el.querySelector('#follow').checked && box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    box.innerHTML = html || '<div class="mdw-muted">（暂无日志）</div>';
    if (stick) box.scrollTop = box.scrollHeight;
  };
  renderLog();
  el.querySelector('#lv').onchange = renderLog;
  el.querySelector('#q').oninput = renderLog;
  pages._logsTimer = setInterval(renderLog, 2000);
}

async function pageAbout(el) {
  const [version, system] = await Promise.all([api.get('/api/version'), api.get('/api/system/info')]);
  el.innerHTML = `
    <h2 class="mdw-h1">关于</h2>
    <div class="mdw-list">
      <p><b>MAA for NAS</b> v${esc(version.serviceVersion)} — 将 MAA 官方 Linux 运行包封装为可在 x86_64 / arm64 Docker 上运行的 Web 管理服务。</p>
      <p><b>MAA 版本</b>: ${esc(version.maaVersion)}</p>
      <p><b>上游项目</b>: <a href="https://github.com/MaaAssistantArknights/MaaAssistantArknights" target="_blank">MaaAssistantArknights</a>（AGPL-3.0，运行时从官方 Release 下载，本仓库不分发其二进制）</p>
      <p><b>前端组件</b>: <a href="https://github.com/virtualvivek/windows-ui" target="_blank">windows-ui</a>（MIT，官方 dist 本地引入）</p>
      <p><b>本机架构</b>: ${esc(system.architecture)} · ${esc(system.platform)}</p>
      <p><b>许可</b>: 本项目代码以 MIT 许可发布，详见仓库 LICENSE 与 NOTICE。</p>
    </div>`;
}

// ----------------------------------------------------------- router
const pages = {
  tasks: pageTasks, copilot: pageCopilot, schedule: pageSchedule, settings: pageSettings, features: pageFeatures,
  runtime: pageRuntime, logs: pageLogs, about: pageAbout,
};

async function route() {
  if (pages._logsTimer) { clearInterval(pages._logsTimer); pages._logsTimer = null; }
  const hash = location.hash || '#/tasks';
  const name = hash.replace('#/', '').split('?')[0] || 'tasks';
  document.querySelectorAll('#app-navbar-list a').forEach((a) => {
    a.className = a.getAttribute('href') === `#/${name}` ? 'active' : 'unactive';
  });
  document.querySelectorAll('.mdw-navtab').forEach((a) => {
    const own = a.getAttribute('href') === `#/${name}`;
    a.className = `mdw-navtab ${own ? 'active' : 'unactive'}`;
  });
  try {
    await (pages[name] || pages.tasks)($page);
  } catch (e) {
    $page.innerHTML = `<h2 class="mdw-h1">出错</h2><p class="mdw-error">${esc(e.message)}</p><button class="app-btn" onclick="route()">重试</button>`;
  }
}
window.route = route;

// sidebar: official windows-ui spec — the toggler flips .collapsed (icon rail)
// on desktop. Default to the rail on desktop; remember the user's choice.
(function () {
  const wrap = document.getElementById('NavBarMain');
  if (!wrap) return;
  let stored = null;
  try { stored = localStorage.getItem('mdw-nav'); } catch { /* private mode */ }
  const desktop = window.innerWidth >= 760;
  if (stored === 'collapsed' || (stored === null && desktop)) wrap.classList.add('collapsed');
  new MutationObserver(() => {
    try { localStorage.setItem('mdw-nav', wrap.classList.contains('collapsed') ? 'collapsed' : 'open'); } catch { /* ignore */ }
  }).observe(wrap, { attributes: true, attributeFilter: ['class'] });
})();

window.addEventListener('hashchange', route);
bootShell();
route();
