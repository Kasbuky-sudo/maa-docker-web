'use strict';

/* ============================================================
 * MAA for NAS — Web Prototype
 * Pages: home / tasks / copilot / tools / settings
 * ============================================================ */

var $page = document.getElementById('page');

/* ============================================================
 * 后端接入层
 *  - 同源访问 /api/*（生产由 nginx 反代，本地开发由 maa-server 直接托管）
 *  - 后端不可用时进入「离线预览」模式：页面仍可渲染，但状态条会明确提示
 * ============================================================ */
var BACKEND = { online: null, lastError: '' };

function api(method, path, body) {
  var opt = { method: method, headers: {} };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  return fetch(path, opt).then(function (res) {
    return res.text().then(function (text) {
      var data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
      if (!res.ok) {
        var msg = (data && data.error) || ('HTTP ' + res.status);
        throw new Error(msg);
      }
      return data;
    });
  });
}
var GET = function (p) { return api('GET', p); };
var PUT = function (p, b) { return api('PUT', p, b); };
var POST = function (p, b) { return api('POST', p, b); };

function markOnline(ok, err) {
  var was = BACKEND.online;
  BACKEND.online = ok;
  if (!ok) BACKEND.lastError = err ? String(err.message || err) : '';
  if (was !== null && was !== ok) renderOfflineBanner();
  else if (was === null && ok === false) renderOfflineBanner();
}

function renderOfflineBanner() {
  var el = document.getElementById('offline-banner');
  if (!el) return;
  if (BACKEND.online === false) {
    el.className = 'mdw-offline show';
    el.innerHTML = '<i class="icons10 icons10-warning"></i><span>后端未连接，当前为<b>离线预览</b>模式（数据为示例）。启动服务端后自动恢复。</span>';
  } else {
    el.className = 'mdw-offline';
    el.textContent = '';
  }
}

/* ===== 运行时状态（/api/runner/status 驱动，替代原 DEVICE/RUNNING mock） ===== */
var RT = {
  phase: 'idle', detail: '', connected: false, address: '',
  maaVersion: '', maaOk: false, postAction: 'None',
};
var RUNNING_PHASES = ['loading', 'connecting', 'running', 'stopping'];

function isRunning() { return RUNNING_PHASES.indexOf(RT.phase) >= 0; }

/* 兼容旧代码：DEVICE.connected / RUNNING 的语义改为读运行时状态 */
var DEVICE = {
  get connected() { return !!RT.connected; },
  set connected(v) { RT.connected = !!v; },
  address: '192.168.31.190:5555',
  maaVersion: 'v6.17.5',
};
Object.defineProperty(window, 'RUNNING', { get: isRunning });

var PHASE_TEXT = {
  idle: '空闲', loading: '加载资源', connecting: '连接设备', running: '任务执行中',
  stopping: '停止中', done: '已完成', error: '出错',
};

/* 运行状态 → 界面（按钮文案、状态行、首页快捷操作） */
function syncRuntimeUI() {
  var running = isRunning();
  var btn = document.getElementById('q-start');
  if (btn) {
    btn.textContent = running ? '停止' : 'Link Start!';
    btn.classList.toggle('mdw-btn-danger', running);
  }
  var home = document.getElementById('home-run');
  if (home) home.textContent = running ? '运行中…（' + (PHASE_TEXT[RT.phase] || RT.phase) + '）' : '开始一键长草';
  var hc = document.getElementById('home-connect');
  if (hc) hc.textContent = RT.connected ? '断开' : '连接设备';
  var hs = document.getElementById('home-state');
  if (hs) hs.textContent = deviceStatusText(true);
  var sb = document.getElementById('sb-left');
  if (sb) {
    sb.innerHTML = '<span class="mdw-dot' + (RT.connected ? ' ok' : '') + '"></span>' +
      (RT.connected ? '已连接 ' + esc(RT.address) : (RT.address ? '未连接 ' + esc(RT.address) : '设备未配置'));
  }
  var sbr = document.getElementById('sb-right');
  if (sbr) sbr.textContent = (PHASE_TEXT[RT.phase] || RT.phase) + (RT.detail ? ' · ' + RT.detail : '');
  document.querySelectorAll('.mdw-config-status').forEach(function (l) { l.textContent = deviceStatusText(); });
}

function refreshRunnerStatus() {
  return GET('/api/runner/status').then(function (s) {
    markOnline(true);
    RT.phase = s.phase || 'idle';
    RT.detail = s.detail || '';
    RT.connected = !!s.connected;
    RT.address = (s.connection && s.connection.address) || '';
    RT.maaOk = !!(s.maa && s.maa.ok);
    RT.maaVersion = s.maaVersion || RT.maaVersion;
    if (RT.address) DEVICE.address = RT.address;
    updateDeviceChip();
    syncRuntimeUI();
    return s;
  }).catch(function (e) { markOnline(false, e); return null; });
}

function refreshConnection() {
  return GET('/api/connection').then(function (r) {
    var c = (r && r.connection) || {};
    CONNECTION = Object.assign(CONNECTION, c);
    if (c.address) DEVICE.address = c.address;
    return CONNECTION;
  }).catch(function () { return CONNECTION; });
}

function nowTime() {
  var d = new Date();
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

/* ===== 配置持久化（服务端 tasks.json）=====
 * 控件 id → task-catalog.json 的选项 id。catalog 变了要同步这张表。 */
var CONNECTION = { address: '', config: 'General', adbPath: '', touchMode: 'minitouch', clientType: 'Official' };
var TASK_CFG = {};          // 服务端返回的配置
var CATALOG = null;         // /api/tasks/catalog
var saveTimer = null;

var OPT_IDS = {
  // 开始唤醒（含全局共用）
  's-start-game': 'start_game_enabled', 's-client-type': 'client_type', 's-account-name': 'account_name',
  // 理智作战
  'f-medicine-num': 'medicine', 'f-stone-num': 'stone', 'f-times-num': 'times',
  'f-material': 'drops', 'f-proxy': 'series', 'f-stage': 'stage',
  'f-diplomat': 'DrGrandet', 'f-expire-medicine': 'expiring_medicine', 'f-em-hours': 'medicine_expire_days',
  // 基建换班
  'i-mode': 'mode', 'i-plan': 'plan_index', 'i-custom-config': 'filename', 'i-drone': 'drones',
  'i-mood-threshold': 'threshold', 'i-auto-fill': 'replenish',
  'i-clue-exchange': 'reception_clue_exchange', 'i-clue-give': 'reception_send_clue',
  'i-training-continue': 'continue_training', 'i-felyne': 'fiammetta_recovery_enabled',
  'i-redpine': 'use_pinus_sylvestris', 'i-perception': 'use_perception_information',
  'i-human': 'use_worldly_plight', 'i-deepsea': 'use_abyssal_hunter',
  // 自动公招
  'r-max-times': 'times', 'r-expedited': 'expedite', 'r-expedited-max': 'expedite_times',
  'r-confirm-3': 'confirm', 'r-confirm-4': 'confirm', 'r-confirm-5': 'confirm', 'r-confirm-6': 'confirm',
  'r-multi-strategy': 'extra_tags_mode', 'r-refresh-3': 'refresh',
  'r-keep-tags': 'preserve_tags', 'r-keep-tags-select': 'first_tags',
  // 信用收支
  'm-friends': 'visit_friends', 'm-of1': 'credit_fight', 'm-of1-squad-select': 'formation_index',
  'm-auto-buy': 'shopping', 'm-buy-first': 'buy_first', 'm-blacklist': 'blacklist',
  'm-ignore-blacklist': 'force_shopping_if_credit_full', 'm-only-discount': 'only_buy_discount',
  'm-stop-low': 'reserve_max_credit',
  // 领取奖励
  'a-daily': 'award', 'a-mail': 'mail', 'a-free-draw': 'recruit', 'a-lucky-wall': 'orundum',
  'a-mining': 'mining', 'a-monthly-pass': 'specialaccess',
  // 自动肉鸽
  'rg-theme': 'theme', 'rg-difficulty': 'difficulty', 'rg-strategy': 'mode', 'rg-squad': 'squad',
  'rg-class': 'roles', 'rg-operator': 'core_char', 'rg-stop-times': 'starts_count',
  'rg-invest-coin': 'investment_enabled', 'rg-invest-max': 'investments_count',
  'rg-invest-stop': 'stop_when_investment_full', 'rg-assist': 'use_support',
  'rg-assist-nonfriend': 'use_nonfriend_support', 'rg-pause-boss': 'stop_at_final_boss',
  'rg-stop-max': 'stop_at_max_level', 'rg-elite2': 'start_with_elite_two',
  'rg-elite2-only': 'only_start_with_elite_two', 'rg-dice': 'refresh_trader_with_dice',
  'rg-monthly': 'monthly_squad_auto_iterate', 'rg-deep': 'deep_exploration_auto_iterate',
  'rg-use-seed': 'start_with_seed',
  // 生息演算
  'rc-theme': 'theme', 'rc-mode': 'mode', 'rc-craft': 'tools_to_craft',
  'rc-craft-points': 'num_craft_batches', 'rc-increment': 'increment_mode', 'rc-clear-store': 'clear_store',
};

/* 多选控件（同一选项 id 的多个复选框）声明 */
var MULTI_IDS = {
  'i': 'facility',        // data-facility
  'r': 'confirm'          // r-confirm-3/4/5/6
};

function optIdOf(el) {
  var id = el.id || '';
  if (el.dataset && el.dataset.facility) return 'facility';
  return OPT_IDS[id] || null;
}

function collectTaskConfig() {
  var out = {};
  var selected = TASKS.map(function (t) { return baseTaskId(t.id); });
  document.querySelectorAll('#task-config [id], .mdw-config-global [id]').forEach(function (el) {
    var opt = optIdOf(el);
    if (!opt) return;
    var taskId = baseTaskId(selectedTask);
    if (!out[taskId]) out[taskId] = {};
    if (el.type === 'checkbox') {
      if (opt === 'confirm') {
        // 多值：只保留勾选的星级
        out[taskId].confirm = out[taskId].confirm || [];
        var star = (el.id.match(/r-confirm-(\d)/) || [])[1];
        if (el.checked && star) out[taskId].confirm.push(Number(star));
        return;
      }
      out[taskId][opt] = !!el.checked;
      return;
    }
    if (el.dataset && el.dataset.facility) {
      out[taskId].facility = out[taskId].facility || [];
      if (el.checked) out[taskId].facility.push(el.dataset.facility);
      return;
    }
    if (el.tagName === 'SELECT') {
      out[taskId][opt] = el.value;
      return;
    }
    if (el.type === 'number' || el.type === 'range') { out[taskId][opt] = Number(el.value); return; }
    if (el.type === 'text' || el.tagName === 'TEXTAREA') {
      if (opt === 'fiammetta_targets') return;
      out[taskId][opt] = el.value;
    }
  });
  // 菲亚梅塔目标（3 个下拉合成数组）
  var fia = [1, 2, 3].map(function (i) {
    var s = document.getElementById('i-felyne-' + i);
    return s ? s.value : '';
  }).filter(Boolean);
  if (fia.length) {
    out.infrast = out.infrast || {};
    out.infrast.fiammetta_targets = fia;
  }
  // 更换主题（多行文本框 → 数组）
  var themes = switchThemes.map(function (t) { return String(t).trim(); }).filter(Boolean);
  if (themes.length) { out.switchtheme = out.switchtheme || {}; out.switchtheme.themes = themes; }
  // 队列级
  var post = document.getElementById('q-post');
  out._meta = { postAction: post ? post.value : (TASK_CFG._meta && TASK_CFG._meta.postAction) || 'None' };
  // 只保留 catalog 里存在的任务 id
  var valid = {};
  (CATALOG ? CATALOG.tasks : []).forEach(function (t) { if (out[t.id]) valid[t.id] = out[t.id]; });
  if (out._meta) valid._meta = out._meta;
  return valid;
}

function saveTaskConfig() {
  if (BACKEND.online === false) return;
  var current = collectTaskConfig();
  // 服务端 PUT 是整体替换：必须带上其它任务已保存的配置
  var payload = {};
  Object.keys(TASK_CFG || {}).forEach(function (k) {
    if (k === '_meta' || current[k]) return;
    payload[k] = TASK_CFG[k];
  });
  Object.keys(current).forEach(function (k) { payload[k] = current[k]; });
  TASK_CFG = payload;
  PUT('/api/tasks/config', payload).then(function () {
    var ind = document.getElementById('save-ind');
    if (ind) {
      ind.textContent = '已保存 ' + nowTime();
      setTimeout(function () { if (ind.textContent.indexOf('已保存') === 0) ind.textContent = ''; }, 2000);
    }
  }).catch(function (e) { markOnline(false, e); });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveTaskConfig, 600);
}

/* 把服务端配置回填到控件（渲染后调用） */
function applyTaskConfig(root) {
  if (!TASK_CFG || !Object.keys(TASK_CFG).length) return;
  var taskId = baseTaskId(selectedTask);
  var cfg = TASK_CFG[taskId];
  if (!cfg) return;
  // 先应用主题（会重建联动下拉），再回填依赖项
  if (taskId === 'roguelike' && cfg.theme) {
    var rt = document.getElementById('rg-theme');
    if (rt) { rt.value = cfg.theme; refreshRogueDependent(cfg); }
  }
  if (taskId === 'reclamation' && cfg.theme) {
    var ct = document.getElementById('rc-theme');
    if (ct) { ct.value = cfg.theme; refreshReclDependent(cfg.mode); }
  }
  Object.keys(OPT_IDS).forEach(function (domId) {
    var opt = OPT_IDS[domId];
    var el = document.getElementById(domId);
    if (!el || !(opt in cfg)) return;
    var v = cfg[opt];
    if (el.type === 'checkbox') {
      if (opt === 'confirm') { el.checked = Array.isArray(v) && v.indexOf(Number((el.id.match(/-(\d)$/) || [])[1])) >= 0; return; }
      el.checked = !!v;
    } else if (el.tagName === 'SELECT') {
      el.value = String(v);
    } else {
      el.value = v;
    }
  });
  // 菲亚梅塔
  if (taskId === 'infrast' && Array.isArray(cfg.fiammetta_targets)) {
    cfg.fiammetta_targets.forEach(function (name, i) {
      var s = document.getElementById('i-felyne-' + (i + 1));
      if (s) s.value = name;
    });
  }
  // 换主题
  if (taskId === 'switchtheme' && Array.isArray(cfg.themes) && cfg.themes.length) {
    switchThemes = cfg.themes.slice();
  }
  // 队列级
  var post = document.getElementById('q-post');
  if (post && TASK_CFG._meta && TASK_CFG._meta.postAction) post.value = TASK_CFG._meta.postAction;
}

/* 「任何改动 → 防抖保存」
 * 用文档级 **捕获** 监听：不依赖事件冒泡（change 事件在部分情况下不冒泡），
 * 且页面重渲染后依然有效。 */
var AUTOSAVE_BOUND = false;
function bindAutoSave() {
  if (AUTOSAVE_BOUND) return;
  AUTOSAVE_BOUND = true;
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    if (!t.closest('#task-config, .mdw-config-global, .mdw-queue-foot')) return;
    scheduleSave();
  }, true);
  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    if (!t.closest('#task-config, .mdw-config-global')) return;
    if (t.type === 'text' || t.type === 'number' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') scheduleSave();
  }, true);
}
/* 任务实例 id → 基础类型 id（队列里可存在同类型多实例） */
function baseTaskId(id) {
  return String(id || '').replace(/_\d+$/, '');
}

function deviceStatusText(short) {
  if (BACKEND.online === false) return '离线预览 · 未连接后端';
  if (!RT.address) return short ? '未配置设备 · 空闲' : '未配置设备 · 请到「设置 → 连接设置」填写 ADB 地址';
  var bus = isRunning() ? (RT.detail || '运行中') : '空闲 · 等待执行';
  return RT.address + ' · MAA ' + (RT.maaVersion || '—') + ' · ' + bus;
}

function updateDeviceChip() {
  var chip = document.querySelector('.mdw-chip');
  var btn = document.getElementById('btn-connect');
  var ok = !!RT.connected;
  var configured = !!RT.address;
  if (chip) {
    chip.classList.toggle('ok', ok);
    chip.innerHTML = '<span class="mdw-dot"></span>' +
      (ok ? '已连接 ' + esc(RT.address) : (configured ? '未连接 ' + esc(RT.address) : '设备未配置'));
  }
  if (btn) {
    btn.textContent = ok ? '断开' : '连接';
    btn.disabled = false;
  }
}

function bindConnectButton() {
  var btn = document.getElementById('btn-connect');
  if (!btn) return;
  btn.addEventListener('click', function () {
    if (BACKEND.online === false) { openInfoModal('无法连接', '后端未连接：当前是离线预览模式。'); return; }
    if (RT.connected) {
      POST('/api/runner/stop').then(function () { return refreshRunnerStatus(); })
        .catch(function (e) { openInfoModal('停止失败', e.message); });
      return;
    }
    btn.disabled = true;
    btn.textContent = '连接中…';
    POST('/api/runner/test-connect').then(function (r) {
      return refreshRunnerStatus().then(function () {
        var ok = r && (r.ok || r.connected || r.success);
        if (ok === false) openInfoModal('连接测试', (r && r.detail) || '连接失败，请检查 ADB 地址与网络。');
        else if (r && r.detail) openInfoModal('连接测试', r.detail);
      });
    }).catch(function (e) {
      openInfoModal('连接失败', e.message);
    }).then(function () {
      btn.disabled = false;
      refreshRunnerStatus();
    });
  });
}

/* ===== Utilities ===== */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function selectHtml(list, value, id) {
  return '<div class="app-select-menu mdw-ctl"><select' + (id ? ' id="' + id + '"' : '') + '>' +
    list.map(function (c) {
      var v = Array.isArray(c) ? c[0] : c.value;
      var l = Array.isArray(c) ? c[1] : c.label;
      return '<option value="' + esc(String(v)) + '"' + (String(v) === String(value) ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('') + '</select></div>';
}
function checkHtml(label, checked, id, cls) {
  return '<label class="mdw-check' + (cls ? ' ' + cls : '') + '"><input type="checkbox" class="app-checkbox"' +
    (id ? ' id="' + id + '"' : '') + (checked ? ' checked' : '') + '/><span>' + esc(label) + '</span></label>';
}
function helpHtml(text) {
  return text ? '<span class="mdw-help" title="' + esc(text) + '">?</span>' : '';
}
function rowHtml(inner) { return '<div class="mdw-row">' + inner + '</div>'; }
function blockHtml(label, ctl, tip) {
  return '<div class="mdw-row block"><div class="mdw-row-label">' + esc(label) + helpHtml(tip) + '</div>' + ctl + '</div>';
}
function subCheckHtml(label, checked, id) {
  return '<label class="mdw-sub-check"><input type="checkbox" class="app-checkbox"' + (id ? ' id="' + id + '"' : '') + (checked ? ' checked' : '') + '/><span>' + esc(label) + '</span></label>';
}
function sub2CheckHtml(label, checked, id) {
  return '<label class="mdw-sub2-check"><input type="checkbox" class="app-checkbox"' + (id ? ' id="' + id + '"' : '') + (checked ? ' checked' : '') + '/><span>' + esc(label) + '</span></label>';
}
function subRowHtml(inner) { return '<div class="mdw-sub-row">' + inner + '</div>'; }
function headingHtml(text) { return '<div class="mdw-heading">' + esc(text) + '</div>'; }
function numHtml(id, val, min, max) {
  return '<input type="number" class="app-input-text mdw-num" id="' + id + '" value="' + esc(String(val)) + '" min="' + (min || 0) + '" max="' + (max || 9999) + '"/>';
}
function textHtml(id, val, placeholder, readonly) {
  return '<input type="text" class="app-input-text' + (readonly ? ' mdw-input-readonly' : '') + '" id="' + id + '" value="' + esc(String(val || '')) + '" placeholder="' + esc(placeholder || '') + '"' + (readonly ? ' readonly' : '') + '/>';
}

/* ===== Shared Data ===== */
var TASKS = [
  { id: 'startup', name: '开始唤醒', tabs: ['basic'] },
  { id: 'fight', name: '理智作战', tabs: ['basic', 'advanced'] },
  { id: 'infrast', name: '基建换班', tabs: ['basic', 'advanced'] },
  { id: 'recruit', name: '自动公招', tabs: ['basic', 'advanced'] },
  { id: 'mall', name: '信用收支', tabs: ['basic', 'advanced'] },
  { id: 'award', name: '领取奖励', tabs: ['basic'] },
  { id: 'roguelike', name: '自动肉鸽', tabs: ['basic', 'advanced'] },
  { id: 'reclamation', name: '生息演算', tabs: ['basic', 'advanced'] },
  { id: 'update', name: '更新数据', tabs: ['basic'] },
  { id: 'depot', name: '仓库保存', tabs: ['basic'] },
  { id: 'custom', name: '自定义任务', tabs: ['basic'] },
  { id: 'switchtheme', name: '更换主题', tabs: ['basic'] },
];

var CLIENTS = [
  ['Official', '官服'], ['Bilibili', 'Bilibili 服'], ['YostarEN', '国际服 (YostarEN)'],
  ['YostarJP', '日服 (YostarJP)'], ['YostarKR', '韩服 (YostarKR)'], ['txwy', '繁中服 (txwy)']
];
var CONN_CONFIGS = [
  ['General', '通用模式'], ['BlueStacks', '蓝叠模拟器'], ['MuMuEmulator12', 'MuMu 模拟器'],
  ['LDPlayer', '雷电模拟器'], ['Androws', '应用宝模拟器'], ['AVD', 'Android 虚拟设备 (AVD)'],
  ['Nox', '夜神模拟器'], ['XYAZ', '逍遥模拟器'], ['CapMac', '明日方舟 PC 端（社区维护）'],
  ['WSA', 'WSA 旧版本'], ['Compatible', '兼容模式'], ['SecondResolution', '第二分辨率'],
  ['CapWithShell', '通用模式（屏蔽异常输出）']
];
var TOUCH_MODES = [
  ['minitouch', 'Minitouch（默认）'], ['maatouch', 'MaaTouch（实验功能）'],
  ['adb', 'ADB Input（不推荐使用）'], ['MaaFwAdb', 'MaaFwAdb（实验功能）']
];
var STAGES = [
  ['', '当前/上次'], ['1-7', '1-7'], ['SR-5', 'SR-5'], ['R8-11', 'R8-11'], ['12-17-HARD', '12-17-HARD'],
  ['CE-6', '龙门币-6/5'], ['AP-5', '红票-5'], ['CA-5', '技能-5'], ['LS-6', '经验-6/5'],
  ['PR-A-1', '奶/盾芯片'], ['PR-B-1', '术/组芯片'], ['PR-C-1', '先/辅芯片'], ['PR-D-1', '近/特芯片'],
  ['Annihilation', '当期剿灭']
];
/* 指定材料：官方 resource/item_index.json 中 classifyType=MATERIAL 的 95 项 */
var MATERIALS = [['', '不选择']].concat(MAA_ITEMS.materials);
var POST_ACTIONS = [
  ['None', '无操作'], ['BackToHome', '返回 模拟器 主屏幕'], ['ExitGame', '退出 明日方舟'],
  ['ExitEmulator', '退出 模拟器'], ['ExitMAA', '退出 MAA'], ['Sleep', '睡眠'],
  ['Hibernate', '休眠'], ['Shutdown', '关机']
];
var WEEKDAYS = [['Sun', '星期日'], ['Mon', '星期一'], ['Tue', '星期二'], ['Wed', '星期三'], ['Thu', '星期四'], ['Fri', '星期五'], ['Sat', '星期六']];
var ANNIHILATION_STAGES = [
  ['Annihilation', '当期剿灭'], ['Chernobog@Annihilation', '切尔诺伯格'],
  ['LungmenOutskirts@Annihilation', '龙门外环'], ['LungmenDowntown@Annihilation', '龙门市区']
];
/* 肉鸽/生息演算官方选项见 maa-data.js（MAA_DATA） */
var INFRAST_MODES = [
  ['normal', '常规模式'], ['queue', '队列轮换'], ['custom', '自定义基建配置']
];
var INFRAST_DRONE_USES = [
  ['none', '不使用无人机'], ['trade_order', '贸易站 - 龙门币'], ['trade_synthetic', '贸易站 - 合成玉'],
  ['manu_exp', '制造站 - 经验书'], ['manu_gold', '制造站 - 赤金'],
  ['manu_stone', '制造站 - 源石碎片'], ['manu_chip', '制造站 - 芯片组']
];
var INFRAST_FACILITIES = [
  ['power', '发电站'], ['office', '办公室'], ['control', '控制中枢'],
  ['manufacture', '制造站'], ['trade', '贸易站'], ['reception', '会客室'],
  ['dormitory', '宿舍'], ['workshop', '加工站'], ['training', '训练室'], ['deputy', '副手换人']
];
var RECRUIT_TAGS = [
  ['vanguard', '先锋'], ['guard', '近卫'], ['sniper', '狙击'], ['caster', '术师'],
  ['defender', '重装'], ['supporter', '辅助'], ['medic', '医疗'], ['specialist', '特种'],
  ['healing', '治疗'], ['support', '支援'], ['dps', '输出'], ['aoe', '群攻'],
  ['slow', '减速'], ['survival', '生存'], ['defense', '防护'], ['shift', '位移']
];

/* ===== Global Config (shared, fixed at top) ===== */
function renderGlobalConfig() {
  return '<div class="mdw-config-global">' +
    '<div class="mdw-config-global-head">全局共用配置</div>' +
    rowHtml(checkHtml('账号切换', false, 'g-account-switch') + helpHtml('仅支持切换至已登录的账号，用登录名查找即可。')) +
    rowHtml(checkHtml('是否启动客户端', true, 'g-start-game') + helpHtml('作用于整队任务。')) +
    blockHtml('客户端类型', selectHtml(CLIENTS, 'Official', 'g-client-type'), 'MAA 会根据客户端类型选择对应资源与任务参数。') +
    rowHtml(checkHtml('自动检测连接', true, 'g-auto-detect')) +
    blockHtml('连接配置', selectHtml(CONN_CONFIGS, 'General', 'g-conn-config'), 'MAA Core 内置的识别与截图策略。') +
    blockHtml('ADB 路径', '<div style="display:flex;gap:6px;align-items:center">' + textHtml('g-adb-path', '', '留空使用容器内 /usr/bin/adb', true) + '<button type="button" class="app-btn" style="font-size:13px;padding:4px 10px">选择</button></div>', '指定 adb 文件位置。') +
    blockHtml('连接地址', selectHtml([['192.168.31.190:5555', '192.168.31.190:5555'], ['127.0.0.1:7555', '127.0.0.1:7555']], '192.168.31.190:5555', 'g-address'), '设备 IP + 端口。') +
    blockHtml('触控模式', selectHtml(TOUCH_MODES, 'minitouch', 'g-touch-mode'), '实例级参数 AsstSetInstanceOption(TouchMode)。') +
    rowHtml('<button type="button" class="app-btn" id="g-screenshot-test">截图测试</button>') +
    '</div>';
}

/* ===== Task-Specific Config Panels ===== */

/* --- 开始唤醒 --- */
function configStartup(tab) {
  if (tab === 'basic') {
    return headingHtml('开始唤醒') +
      rowHtml(checkHtml('启动客户端', true, 's-start-game') + helpHtml('作用于整队任务。')) +
      blockHtml('客户端类型', selectHtml(CLIENTS, 'Official', 's-client-type')) +
      rowHtml(checkHtml('账号切换', false, 's-account-switch') + helpHtml('仅支持切换至已登录的账号。')) +
      blockHtml('', textHtml('s-account-name', '', '官服：123****4567；B服：张三', true)) +
      rowHtml('<span class="mdw-muted">其余选项请使用全局共用配置。</span>');
  }
  return '<div class="mdw-muted">该任务没有高级参数。</div>';
}

/* --- jaomie removed --- */
var configJaomie = null;

/* --- 理智作战 --- */
function configFight(tab) {
  if (tab === 'basic') {
    return headingHtml('理智作战') +
      rowHtml(checkHtml('使用药剂', true, 'f-medicine') + helpHtml('使用恢复理智的药剂。') + numHtml('f-medicine-num', 999, 0, 999)) +
      rowHtml(checkHtml('使用源石 *', false, 'f-stone') + numHtml('f-stone-num', 0, 0, 999)) +
      rowHtml(checkHtml('指定次数', true, 'f-times') + numHtml('f-times-num', 999, 1, 9999)) +
      blockHtml('指定材料', checkHtml('', false, 'f-material-check') + selectHtml(MATERIALS, '', 'f-material'), '配合关卡按材料刷取。') +
      blockHtml('代理倍率', selectHtml([['0', 'AUTO'], ['10', '10'], ['9', '9'], ['8', '8'], ['7', '7'], ['6', '6'], ['5', '5'], ['4', '4']], '0', 'f-proxy'), 'AUTO 自动切换当前可用最大倍率。') +
      blockHtml('关卡指定', selectHtml(STAGES, '1-7', 'f-stage'), '留空则识别当前/上次关卡。');
  }
  return headingHtml('理智作战 · 高级设置') +
    blockHtml('自定义剿灭关卡', checkHtml('', false, 'f-anni-check') + selectHtml(ANNIHILATION_STAGES, 'Annihilation', 'f-anni')) +
    rowHtml(checkHtml('博朗台模式', false, 'f-diplomat') + helpHtml('先刷已恢复理智，再使用理智药。')) +
    rowHtml(checkHtml('无限吃 N 小时内过期的理智药', false, 'f-expire-medicine') + selectHtml([['24', '24h×1'], ['48', '24h×2'], ['72', '24h×3'], ['96', '24h×4'], ['120', '24h×5'], ['144', '24h×6'], ['168', '24h×7']], '48', 'f-em-hours')) +
    rowHtml(checkHtml('活动结束前 48H 吃当周过期理智药', false, 'f-expire-activity') + helpHtml('需活动剩余天数可识别。')) +
    rowHtml(checkHtml('隐藏代理倍率', false, 'f-hide-proxy')) +
    rowHtml(checkHtml('允许使用源石保存状态', false, 'f-stone-save')) +
    rowHtml(checkHtml('手动输入关卡名', false, 'f-manual-stage')) +
    '<div class="mdw-sub-row" id="f-manual-row" style="display:none">' + textHtml('f-manual-stage-name', '', '例如：BB-8、OF-F3') + '</div>' +
    blockHtml('过期活动关卡重置为', selectHtml([['Current', '当前/上次'], ['NotSwitch', '不切换']], 'Current', 'f-expire-reset')) +
    rowHtml(checkHtml('使用备选关卡', false, 'f-alt-stage')) +
    '<div class="mdw-sub-row" id="f-alt-row" style="display:none"><span class="mdw-muted">备选 1</span>' + selectHtml(STAGES, '', 'f-alt-1') + '<span class="mdw-muted">备选 2</span>' + selectHtml(STAGES, '', 'f-alt-2') + '</div>' +
    rowHtml(checkHtml('下拉框中隐藏当日不开放关卡', true, 'f-hide-closed')) +
    rowHtml(checkHtml('启用周计划', false, 'f-weekly-plan') + helpHtml('展开周日~周六复选框，可指定每周运行日期。')) +
    '<div class="mdw-week-box" id="f-week-box" style="display:none">' +
      WEEKDAYS.map(function (w) {
        return '<div class="mdw-week-row"><span>' + w[1] + '</span>' + selectHtml(STAGES, '1-7') + '</div>';
      }).join('') + '</div>';
}

/* --- 信用收支 --- */
function configMall(tab) {
  if (tab === 'basic') {
    return headingHtml('信用收支') +
      rowHtml(checkHtml('访问好友', true, 'm-friends')) +
      subCheckHtml('一日只执行一次', false, 'm-friends-once') +
      rowHtml(checkHtml('借助战打 OF-1 赚信用', true, 'm-of1')) +
      subCheckHtml('一日只执行一次', false, 'm-of1-once') +
      subRowHtml(checkHtml('使用编队', false, 'm-of1-squad') + selectHtml([['1', '1号编队'], ['2', '2号编队'], ['3', '3号编队'], ['4', '4号编队']], '1', 'm-of1-squad-select')) +
      rowHtml(checkHtml('信用交易所自动购物', true, 'm-auto-buy')) +
      '<div class="mdw-row mdw-muted" style="padding:8px 0">会客室相关功能需在「基建换班」中设置。</div>';
  }
  return headingHtml('信用收支 · 高级设置') +
    blockHtml('购买策略', selectHtml([
      ['all', '买光可买商品'], ['keep', '保留一定信用点'], ['discount', '只买打折商品']
    ], 'all', 'm-strategy'), '信用点不足时的取舍策略。') +
    blockHtml('优先购买', textHtml('m-buy-first', '招聘许可', '分号分隔物品关键词')) +
    blockHtml('黑名单', textHtml('m-blacklist', '', '分号分隔不购买的物品关键词')) +
    blockHtml('单次最大购买次数', numHtml('m-buy-max', 0, 0, 99), '0 表示不限制。') +
    rowHtml(checkHtml('信用溢出时无视黑名单', false, 'm-ignore-blacklist')) +
    rowHtml(checkHtml('只购买打折的信用商品', false, 'm-only-discount')) +
    rowHtml(checkHtml('信用点低于 300 时停止购买商品', false, 'm-stop-low'));
}

/* --- 自动公招 --- */
function configRecruit(tab) {
  if (tab === 'basic') {
    return headingHtml('自动公招') +
      blockHtml('每次执行时最大招募次数', numHtml('r-max-times', 4, 1, 9), '设置单次运行招募次数。') +
      rowHtml(checkHtml('自动使用加急许可 *', false, 'r-expedited')) +
      rowHtml(checkHtml('自动确认 3 星', true, 'r-confirm-3') + selectHtml([['540', '9:00'], ['480', '8:00'], ['420', '7:00'], ['360', '6:00']], '540', 'r-time-3')) +
      rowHtml(checkHtml('自动确认 4 星', true, 'r-confirm-4') + selectHtml([['540', '9:00'], ['480', '8:00']], '540', 'r-time-4')) +
      rowHtml(checkHtml('自动确认 5 星', false, 'r-confirm-5') + selectHtml([['540', '9:00']], '540', 'r-time-5')) +
      rowHtml(checkHtml('自动确认 6 星', false, 'r-confirm-6') + selectHtml([['540', '9:00']], '540', 'r-time-6'));
  }
  return headingHtml('自动公招 · 高级设置') +
    blockHtml('公招多选 Tag 的策略', selectHtml([
      ['default', '默认不选择额外 Tag'],
      ['three_high', '选择高星时总是选择三个 Tag'],
      ['all_high', '尽可能多地选且只选高星 Tag']
    ], 'default', 'r-multi-strategy')) +
    rowHtml(checkHtml('3 星 Tag 时的 Tag 倾向', false, 'r-tag-3-prefer')) +
    subRowHtml(selectHtml(RECRUIT_TAGS, RECRUIT_TAGS[0][0], 'r-tag-3-select')) +
    rowHtml(checkHtml('自动刷新 3 星 Tags', false, 'r-refresh-3')) +
    rowHtml(checkHtml('无招聘许可时继续尝试刷新 Tags', false, 'r-refresh-no-permit')) +
    blockHtml('加急许可使用上限', numHtml('r-expedited-max', 0, 0, 99), '0 表示不限制。') +
    blockHtml('刷新 Tags 最大次数', numHtml('r-refresh-max', 3, 0, 99), '达到次数后不再刷新。') +
    rowHtml(checkHtml('保留指定词条', false, 'r-keep-tags')) +
    subRowHtml(selectHtml(RECRUIT_TAGS, RECRUIT_TAGS[0][0], 'r-keep-tags-select')) +
    rowHtml(checkHtml('识别失败时重试一次', true, 'r-retry'));
}

/* --- 更新数据 --- */
function configUpdate(tab) {
  if (tab === 'basic') {
    return headingHtml('更新数据') +
      rowHtml(checkHtml('干员识别', false, 'u-operbox') + helpHtml('同步干员数据。')) +
      subRowHtml('<span class="mdw-muted">上次同步时间：—</span>') +
      rowHtml(checkHtml('仓库识别', false, 'u-depot') + helpHtml('同步仓库数据。')) +
      subRowHtml('<span class="mdw-muted">上次同步时间：—</span>') +
      blockHtml('触发间隔', selectHtml([
        ['daily', '每日'], ['weekly', '每周'], ['manual', '手动触发']
      ], 'daily', 'u-interval'), '同步触发频率。');
  }
  return '<div class="mdw-muted">该任务没有高级参数。</div>';
}

/* --- 基建换班 --- */
function configInfrast(tab) {
  if (tab === 'basic') {
    return headingHtml('基建换班') +
      blockHtml('基建模式', selectHtml(INFRAST_MODES, 'normal', 'i-mode'), '选择基建运行模式。') +
      '<div id="i-custom-area" style="display:none">' +
        blockHtml('基建计划', selectHtml([['plan1', '计划 1'], ['plan2', '计划 2']], 'plan1', 'i-plan')) +
        rowHtml('<a href="#" class="mdw-muted" style="font-size:13px">自定义基建排班制作器</a>') +
        blockHtml('内置配置', '<div style="display:flex;gap:6px;align-items:center">' + textHtml('i-custom-config', '', '选择内置配置文件', true) + '<button type="button" class="app-btn" style="font-size:13px;padding:4px 10px">选择</button></div>') +
        '</div>' +
      blockHtml('无人机用途', selectHtml(INFRAST_DRONE_USES, 'none', 'i-drone')) +
      blockHtml('换班编队', selectHtml([['1', '1 号编队'], ['2', '2 号编队'], ['3', '3 号编队'], ['4', '4 号编队']], '1', 'i-squad'), '基建换班使用的编队。') +
      rowHtml(checkHtml('优先使用心情最低的干员', true, 'i-low-mood-first')) +
      rowHtml(checkHtml('干员不足时自动补充', true, 'i-auto-fill')) +
      rowHtml(checkHtml('宿舍按心情排序换班', false, 'i-dorm-sort')) +
      '<div class="mdw-row block"><div class="mdw-row-label">基建工作心情阈值' + helpHtml('干员心情低于阈值触发换班。') + '</div>' +
        '<div class="mdw-slider-row"><input type="range" id="i-mood-threshold" min="0" max="100" value="50" oninput="document.getElementById(\'i-mood-val\').textContent=this.value+\'%\'"/><span class="mdw-slider-val" id="i-mood-val">50%</span></div></div>' +
      '<div class="mdw-row block"><div class="mdw-row-label">换班设施</div>' +
        '<div class="mdw-multi-box"><div class="mdw-multi-grid">' +
          INFRAST_FACILITIES.map(function (f) {
            return '<label class="mdw-multi-item"><input type="checkbox" class="app-checkbox" data-facility="' + f[0] + '"' + (['manufacture', 'trade', 'power', 'control', 'dormitory'].indexOf(f[0]) >= 0 ? ' checked' : '') + '/><span>' + f[1] + '</span></label>';
          }).join('') +
        '</div><div class="mdw-multi-foot"><button type="button" class="app-btn" id="i-fac-all">全选</button><button type="button" class="app-btn" id="i-fac-clear">清空</button></div></div></div>';
  }
  return headingHtml('基建换班 · 高级设置') +
    rowHtml(checkHtml('进行线索交流', true, 'i-clue-exchange')) +
    rowHtml(checkHtml('赠送线索', false, 'i-clue-give')) +
    rowHtml(checkHtml('训练完成后继续尝试专精当前技能', false, 'i-training-continue')) +
    rowHtml(checkHtml('启用菲亚梅塔心情恢复', false, 'i-felyne') + helpHtml('需选择恢复心情的目标干员，最多 3 个。')) +
    '<div class="mdw-sub-row" id="i-felyne-row" style="display:none;flex-wrap:wrap;gap:8px">' +
      [1, 2, 3].map(function (i) {
        var list = [['', '不选择（第 ' + i + ' 个）']].concat(MAA_FIAMMETTA_TARGETS.map(function (n) { return [n, n]; }));
        return selectHtml(list, '', 'i-felyne-' + i);
      }).join('') +
    '</div>' +
    rowHtml(checkHtml('使用红松骑士团跨设施组合', false, 'i-redpine')) +
    rowHtml(checkHtml('使用感知信息跨设施组合', false, 'i-perception')) +
    rowHtml(checkHtml('使用人间烟火跨设施组合', false, 'i-human')) +
    rowHtml(checkHtml('使用深海猎人跨设施组合', false, 'i-deepsea'));
}

/* --- 领取奖励 --- */
function configAward(tab) {
  if (tab === 'basic') {
    return headingHtml('领取奖励') +
      rowHtml(checkHtml('领取每日 / 每周任务奖励', true, 'a-daily')) +
      rowHtml(checkHtml('领取所有邮件奖励', true, 'a-mail')) +
      rowHtml(checkHtml('进行限定池赠送的每日免费单抽', true, 'a-free-draw')) +
      rowHtml(checkHtml('领取幸运墙的每日合成玉奖励', false, 'a-lucky-wall')) +
      rowHtml(checkHtml('领取限时开采许可的每日合成玉奖励', false, 'a-mining')) +
      rowHtml(checkHtml('领取周年赠送月卡奖励', false, 'a-monthly-pass'));
  }
  return '<div class="mdw-muted">该任务没有高级参数。</div>';
}

/* --- 自动肉鸽（选项对齐 RoguelikeSettingsUserControlModel.cs） --- */
function rogueSquadList(theme) {
  var rg = MAA_DATA.roguelike;
  var list = (rg.themeSquads[theme] || []).slice();
  list = list.concat(rg.commonSquads);
  if (rg.firstClassSquadThemes.indexOf(theme) >= 0) list.push('高规格分队');
  return list;
}
function rogueRoleList(theme) {
  var rg = MAA_DATA.roguelike.roles;
  var list = rg.common.slice();
  if (theme === 'JieGarden' || theme === 'BlackFlow') list = list.concat(rg.jieOrBlackExtra);
  return list.concat(rg.tail);
}
function rogueDifficultyList(theme) {
  var max = MAA_DATA.roguelike.maxDifficulty[theme] || 20;
  var list = [['-1', '不切换 (-1)'], ['max', 'MAX (' + max + ')']];
  for (var i = max; i >= 0; i--) list.push([String(i), i === 0 ? 'MIN (0)' : String(i)]);
  return list;
}

function rogueCoreCharList(theme) {
  return (MAA_CORE_CHARS[theme] || []).slice();
}

function configRoguelike(tab) {
  var theme = 'Sarkaz';
  var coreChars = rogueCoreCharList(theme);
  if (tab === 'basic') {
    return headingHtml('自动肉鸽') +
      blockHtml('肉鸽主题', selectHtml(MAA_DATA.roguelike.themes, theme, 'rg-theme')) +
      blockHtml('难度', selectHtml(rogueDifficultyList(theme), '-1', 'rg-difficulty'), '随主题联动：各主题难度上限不同。') +
      blockHtml('策略', selectHtml(MAA_DATA.roguelike.modes, '0', 'rg-strategy')) +
      blockHtml('开局分队', selectHtml(rogueSquadList(theme).map(function (s) { return [s, s]; }), MAA_DATA.roguelike.defaultSquad, 'rg-squad')) +
      blockHtml('开局职业组', selectHtml(rogueRoleList(theme).map(function (s) { return [s, s]; }), '稳扎稳打', 'rg-class')) +
      blockHtml('开局干员', selectHtml([['', '不选择']].concat(coreChars.map(function (n) { return [n, n]; })), '', 'rg-operator'), '可输入干员名搜索；使用助战时须为好友干员。');
  }
  return headingHtml('自动肉鸽 · 高级设置') +
    blockHtml('开始探索 N 次后停止任务', numHtml('rg-stop-times', 999, 1, 9999), '设置探索次数上限。') +
    rowHtml(checkHtml('投资源石锭', true, 'rg-invest-coin') + helpHtml('运行中自动投资源石锭。')) +
    blockHtml('投资多少个源石锭后停止', numHtml('rg-invest-max', 999, 0, 9999)) +
    rowHtml(checkHtml('投资满后自动停止任务', false, 'rg-invest-stop')) +
    rowHtml(checkHtml('「开局干员」使用助战', false, 'rg-assist')) +
    rowHtml(checkHtml('允许非好友助战', false, 'rg-assist-nonfriend')) +
    rowHtml(checkHtml('在第五层 BOSS 前暂停', false, 'rg-pause-boss')) +
    rowHtml(checkHtml('满级后自动停止', false, 'rg-stop-max')) +
    rowHtml(checkHtml('凹开局干员直升精二', false, 'rg-elite2')) +
    rowHtml(checkHtml('只凹直升精二，不进行作战', false, 'rg-elite2-only')) +
    rowHtml(checkHtml('刷新商店（指路鳞）', false, 'rg-dice') + helpHtml('萨卡兹肉鸽：使用骰子刷新商店。')) +
    rowHtml(checkHtml('月度小队自动切换', false, 'rg-monthly')) +
    rowHtml(checkHtml('深入调查自动切换', false, 'rg-deep')) +
    rowHtml(checkHtml('使用指定种子开局', false, 'rg-use-seed')) +
    subRowHtml(textHtml('rg-seed', '', '输入地图种子编号')) +
    rowHtml(checkHtml('自动肉鸽在战斗结束前延迟「停止」动作', false, 'rg-delay-stop'));
}

/* --- 生息演算（主题/模式/提示全部来自 MAA_DATA.reclamation） --- */
function reclTipText(theme, mode) {
  var t = MAA_DATA.reclamation.tips;
  if (theme === 'Fire') return t.Fire;
  if (theme === 'Tales') return t.Tales;
  return t['RelaunchAnchor:' + mode] || '';
}

function configReclamation(tab) {
  var theme = 'RelaunchAnchor', mode = 'RA-1';
  var modes = MAA_DATA.reclamation.modes[theme] || [];
  if (tab === 'basic') {
    return headingHtml('生息演算') +
      blockHtml('生息演算主题', selectHtml(MAA_DATA.reclamation.themes, theme, 'rc-theme')) +
      '<div id="rc-dynamic">' +
        '<div class="mdw-row block" id="rc-mode-area">' +
          '<div class="mdw-row-label">模式</div>' +
          selectHtml(modes, mode, 'rc-mode') +
        '</div>' +
        '<pre class="mdw-recl-tip" id="rc-tip">' + esc(reclTipText(theme, mode)) + '</pre>' +
      '</div>';
  }
  return headingHtml('生息演算 · 高级设置') +
    blockHtml('支援道具', textHtml('rc-craft', '荧光棒', '道具名子串，留空不制造'), '仅沙洲遗闻·有存档模式有效。') +
    blockHtml('单次最大组装轮数', numHtml('rc-craft-points', 1, 0, 99)) +
    blockHtml('荧光棒增加方式', selectHtml([['click', '连点'], ['hold', '长按']], 'click', 'rc-increment')) +
    rowHtml(checkHtml('任务完成后购买商店', false, 'rc-clear-store') + helpHtml('仅沙洲遗闻·无存档模式有效。')) +
    '<pre class="mdw-recl-tip">' + esc(reclTipText('Tales', '')) + '</pre>';
}

/* --- 仓库保存 --- */
function configDepot(tab) {
  return headingHtml('仓库保存') +
    rowHtml(checkHtml('启用仓库识别并保存', true, 'dp-enable')) +
    rowHtml('<span class="mdw-muted">识别结果将保存到服务端，供仓库识别/导出使用。</span>');
}

/* --- 自定义任务 --- */
function configCustom(tab) {
  return headingHtml('自定义任务') +
    blockHtml('任务模板', selectHtml([
      ['', 'interface.json 中的任务...'], ['Award', 'Award · 领取奖励'],
      ['Fight', 'Fight · 理智作战'], ['Mall', 'Mall · 信用收支'],
      ['Recruit', 'Recruit · 自动公招'], ['CloseDown', 'CloseDown · 关闭游戏']
    ], '', 'cu-template'), '从 resource/tasks/ 的 interface.json 里取任务名。') +
    blockHtml('自定义任务名', textHtml('cu-name', '', '与 interface.json 中的 task name 一致')) +
    blockHtml('自定义配置 (JSON)', '<textarea class="app-textarea" id="cu-json" rows="6" placeholder=\'{"enable":true,"params":{}}\'></textarea>', '会原样追加到任务参数中，非法 JSON 会在执行前报错。') +
    rowHtml(checkHtml('任务失败时继续下一个', true, 'cu-continue')) +
    rowHtml('<span class="mdw-muted">正式版此处会读取服务端 resource/tasks 目录。</span>');
}

/* --- 更换主题（官方 SwitchThemeTaskUserControl：手填主题名列表 + 添加主题） --- */
var switchThemes = [''];

function configSwitchTheme(tab) {
  return headingHtml('更换主题') +
    '<div id="st-theme-list">' + renderSwitchThemes() + '</div>' +
    rowHtml('<button type="button" class="app-btn" id="st-add">+ 添加主题</button>') +
    rowHtml(checkHtml('仅在主界面执行', true, 'st-onlymain')) +
    '<div class="mdw-recl-tip">' + esc(MAA_DATA.switchTheme.tip) + '</div>';
}

function renderSwitchThemes() {
  var dl = '<datalist id="maa-theme-list">' +
    MAA_DATA.switchTheme.themes.map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('') +
    '</datalist>';
  return dl + switchThemes.map(function (v, i) {
    return '<div class="mdw-theme-row">' +
      textHtml('st-theme-' + i, v, '主题名称（与游戏内显示一致）').replace('class="app-input-text"', 'class="app-input-text" list="maa-theme-list"') +
      '<button type="button" class="app-btn mdw-theme-del" data-i="' + i + '">删除</button>' +
    '</div>';
  }).join('');
}

function bindSwitchThemeEvents(el) {
  var list = el.querySelector('#st-theme-list');
  if (!list) return;
  function rerender() {
    list.innerHTML = renderSwitchThemes();
    el.querySelectorAll('.mdw-theme-del').forEach(function (b) {
      b.addEventListener('click', function () {
        switchThemes.splice(+b.dataset.i, 1);
        if (!switchThemes.length) switchThemes = [''];
        rerender();
      });
    });
    el.querySelectorAll('#st-theme-list input').forEach(function (inp, i) {
      inp.addEventListener('input', function () { switchThemes[i] = inp.value; });
    });
  }
  var add = el.querySelector('#st-add');
  if (add) add.addEventListener('click', function () { switchThemes.push(''); rerender(); });
  rerender();
}

/* ===== Task config dispatcher ===== */
var CONFIG_RENDERERS = {
  startup: configStartup,
  fight: configFight,
  mall: configMall,
  recruit: configRecruit,
  update: configUpdate,
  infrast: configInfrast,
  award: configAward,
  roguelike: configRoguelike,
  reclamation: configReclamation,
  custom: configCustom,
  switchtheme: configSwitchTheme,
  depot: configDepot,
};

/* ===== 旧 mock 日志（仅离线预览时的兜底样式参考，不再渲染） ===== */
var LOGS = [
  { t: '14:32:15', msg: 'AsstLoadResource 完成', src: 'MaaCore', level: 'info' },
  { t: '14:32:18', msg: 'AsstAsyncConnect 192.168.31.190:5555 成功 (238ms)', src: 'runner', level: 'info' },
  { t: '14:32:20', msg: 'AsstAppendTask StartUp', src: 'runner', level: 'info' },
  { t: '14:32:21', msg: '子任务: 启动游戏客户端', src: 'MaaCore', level: 'info' },
  { t: '14:32:35', msg: '截图测试成功，分辨率 1920x1080', src: 'MaaCore', level: 'debug' },
  { t: '14:32:36', msg: 'AsstStart 已下发，任务队列开始执行', src: 'runner', level: 'info' },
  { t: '14:32:40', msg: '识别到明日方舟主界面', src: 'MaaCore', level: 'info' },
  { t: '14:32:42', msg: '开始唤醒 · 完成', src: 'runner', level: 'info' },
];

function renderTimeline() {
  return LOGS.map(function (e) {
    return '<div class="mdw-tl-item lv-' + e.level + '">' +
      '<span class="mdw-tl-dot"></span>' +
      '<div class="mdw-tl-thumb"></div>' +
      '<div class="mdw-tl-body">' +
        '<div class="mdw-tl-time">' + esc(e.t) + '</div>' +
        '<div class="mdw-tl-text">' + esc(e.msg) + '</div>' +
        '<div class="mdw-tl-src">' + esc(e.src) + '</div>' +
      '</div></div>';
  }).join('') + '<div class="mdw-tl-end">— 任务执行完毕 —</div>';
}

/* ===== 自定义弹窗（官方 app-dialog 结构，替代 alert/confirm/prompt） ===== */
var _modalRoot = null;

function ensureModalRoot() {
  if (_modalRoot && document.body.contains(_modalRoot)) return _modalRoot;
  _modalRoot = document.createElement('div');
  _modalRoot.className = 'app-dialog';
  _modalRoot.innerHTML =
    '<div class="app-dialog-modal" role="dialog" aria-modal="true">' +
      '<div class="app-dialog-header"><h3 class="mdw-modal-title"></h3></div>' +
      '<div class="app-dialog-body mdw-modal-body"></div>' +
      '<div class="app-dialog-footer mdw-modal-footer"></div>' +
    '</div>';
  document.body.appendChild(_modalRoot);
  return _modalRoot;
}

function closeModal() {
  if (_modalRoot) _modalRoot.classList.remove('show');
}

/**
 * openModal({ title, body, buttons: [{label, primary, danger, onClick}] })
 * body 为 HTML 字符串；onClick(close) 返回 false 可阻止关闭。
 */
function openModal(opts) {
  var root = ensureModalRoot();
  root.querySelector('.mdw-modal-title').textContent = opts.title || '';
  root.querySelector('.mdw-modal-body').innerHTML = opts.body || '';
  var foot = root.querySelector('.mdw-modal-footer');
  foot.innerHTML = '';
  (opts.buttons || []).forEach(function (b) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'app-btn' + (b.primary ? ' mdw-btn-primary' : '') + (b.danger ? ' mdw-btn-danger' : '');
    btn.textContent = b.label;
    btn.addEventListener('click', function () {
      var keep = b.onClick ? b.onClick() : undefined;
      if (keep !== false) closeModal();
    });
    foot.appendChild(btn);
  });
  if (opts.onOpen) opts.onOpen(root);
  root.classList.add('show');
  var firstInput = root.querySelector('.mdw-modal-body input, .mdw-modal-body select');
  if (firstInput) setTimeout(function () { firstInput.focus(); }, 60);
}

/* 添加任务：任务类型选择弹窗（对齐概念图列表） */
function openAddTaskModal(onPick) {
  var rows = TASK_TYPES.map(function (t, i) {
    return '<div class="mdw-pick-row" data-i="' + i + '" role="button" tabindex="0">' + esc(t[1]) + '</div>';
  }).join('');
  var picked = -1;
  openModal({
    title: '添加任务',
    body: '<div class="mdw-pick-list">' + rows + '</div>',
    buttons: [
      { label: '取消' },
      {
        label: '添加', primary: true,
        onClick: function () {
          if (picked < 0) return false;
          onPick(TASK_TYPES[picked]);
        }
      }
    ],
    onOpen: function (root) {
      root.querySelectorAll('.mdw-pick-row').forEach(function (row) {
        row.addEventListener('click', function () {
          root.querySelectorAll('.mdw-pick-row').forEach(function (x) { x.classList.remove('selected'); });
          row.classList.add('selected');
          picked = +row.dataset.i;
        });
        row.addEventListener('dblclick', function () {
          picked = +row.dataset.i;
          onPick(TASK_TYPES[picked]);
          closeModal();
        });
      });
    }
  });
}

/* 添加定时任务：任务类型多选弹窗 */
function openScheduleAddModal(onPick) {
  var rows = TASK_TYPES.map(function (t, i) {
    return '<label class="mdw-pick-row mdw-pick-multi"><input type="checkbox" class="app-checkbox" data-i="' + i + '"/><span>' + esc(t[1]) + '</span></label>';
  }).join('');
  openModal({
    title: '添加定时任务',
    body: '<div class="mdw-muted" style="margin-bottom:6px">选择该定时任务要执行的任务（可多选）：</div><div class="mdw-pick-list">' + rows + '</div>',
    buttons: [{ label: '取消' }, {
      label: '添加', primary: true,
      onClick: function () {
        var picked = [];
        document.querySelectorAll('.mdw-pick-multi input:checked').forEach(function (c) { picked.push(TASK_TYPES[+c.dataset.i]); });
        if (!picked.length) return false;
        onPick(picked);
      }
    }]
  });
}

/* 信息提示弹窗（替代 alert） */
function openInfoModal(title, message) {
  openModal({
    title: title,
    body: '<p class="mdw-modal-text">' + esc(message) + '</p>',
    buttons: [{ label: '确定', primary: true }]
  });
}

/* 删除任务确认弹窗 */
function openConfirmModal(title, message, onOk) {
  openModal({
    title: title,
    body: '<p class="mdw-modal-text">' + esc(message) + '</p>',
    buttons: [{ label: '取消' }, { label: '删除', danger: true, onClick: onOk }]
  });
}

/* 重命名弹窗 */
function openRenameModal(currentName, onOk) {
  openModal({
    title: '重命名任务',
    body: '<input type="text" class="app-input-text mdw-modal-input" id="modal-rename-input" value="' + esc(currentName) + '"/>',
    buttons: [{ label: '取消' }, {
      label: '确定', primary: true,
      onClick: function () {
        var v = document.getElementById('modal-rename-input').value.trim();
        if (!v) return false;
        onOk(v);
      }
    }],
    onOpen: function (root) {
      var inp = document.getElementById('modal-rename-input');
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          var v = inp.value.trim();
          if (v) { onOk(v); closeModal(); }
        }
      });
    }
  });
}

/* ===== Page: Home ===== */
function pageHome(el) {
  el.innerHTML =
    '<div class="mdw-home-banner">' +
      '<div class="mdw-home-banner-text">' +
        '<div class="mdw-home-banner-title">MAA For NAS</div>' +
      '</div>' +
      '<div class="mdw-home-banner-deco"></div>' +
    '</div>' +
    '<div class="mdw-home-actions">' +
      '<button type="button" class="app-btn mdw-btn-primary" id="home-connect">连接设备</button>' +
      '<button type="button" class="app-btn" id="home-run">开始一键长草</button>' +
      '<button type="button" class="app-btn" id="home-stop">停止</button>' +
      '<span class="mdw-muted" id="home-state">未连接 · 空闲</span>' +
    '</div>' +
    '<div class="mdw-home-grid">' +
      '<div class="mdw-home-card">' +
        '<div class="mdw-home-card-label">MAA Core 版本</div>' +
        '<div class="mdw-home-card-value" id="home-maa-version">—</div>' +
        '<button type="button" class="app-btn mdw-btn-primary mdw-home-card-btn" id="home-runtime-fetch">检查更新</button>' +
      '</div>' +
      '<div class="mdw-home-card">' +
        '<div class="mdw-home-card-label">资源版本</div>' +
        '<div class="mdw-home-card-value" id="home-res-version">—</div>' +
        '<button type="button" class="app-btn mdw-btn-primary mdw-home-card-btn" id="home-res-verify">校验资源</button>' +
      '</div>' +
      '<div class="mdw-home-card">' +
        '<div class="mdw-home-card-label">MAA For NAS</div>' +
        '<div class="mdw-home-card-value" id="home-service-version">—</div>' +
        '<button type="button" class="app-btn mdw-btn-primary mdw-home-card-btn" id="home-reload">刷新</button>' +
      '</div>' +
      '<div class="mdw-home-card mdw-home-nas">' +
        '<div class="mdw-home-card-label">NAS 运行情况</div>' +
        '<div class="mdw-nas-metrics">' +
          '<div class="mdw-nas-metric"><div class="mdw-nas-m-label">内存占用</div><div class="mdw-nas-m-value" id="nas-mem">—</div><div class="mdw-nas-m-bar"><div id="nas-mem-bar" style="width:0%"></div></div></div>' +
          '<div class="mdw-nas-metric"><div class="mdw-nas-m-label">CPU 核心</div><div class="mdw-nas-m-value" id="nas-cpus">—</div><div class="mdw-nas-m-bar"><div style="width:0%"></div></div></div>' +
          '<div class="mdw-nas-metric"><div class="mdw-nas-m-label">架构</div><div class="mdw-nas-m-value" id="nas-arch">—</div><div class="mdw-nas-m-bar"><div style="width:0%"></div></div></div>' +
          '<div class="mdw-nas-metric"><div class="mdw-nas-m-label">主机名</div><div class="mdw-nas-m-value" id="nas-host">—</div><div class="mdw-nas-m-bar"><div style="width:0%"></div></div></div>' +
          '<div class="mdw-nas-metric"><div class="mdw-nas-m-label">服务运行时间</div><div class="mdw-nas-m-value" id="nas-uptime">—</div><div class="mdw-nas-m-bar"><div style="width:0%"></div></div></div>' +
          '<div class="mdw-nas-metric"><div class="mdw-nas-m-label">当前阶段</div><div class="mdw-nas-m-value" id="nas-phase">—</div><div class="mdw-nas-m-bar"><div style="width:0%"></div></div></div>' +
        '</div>' +
      '</div>' +
      '<div class="mdw-home-card">' +
        '<div class="mdw-home-card-label">下次定时任务</div>' +
        '<div class="mdw-home-card-value mdw-home-accent" id="home-next-sched">—</div>' +
        '<div class="mdw-home-card-sub" id="home-next-sched-sub">来自服务端日程</div>' +
      '</div>' +
      '<div class="mdw-home-card">' +
        '<div class="mdw-home-card-label">当前任务</div>' +
        '<div class="mdw-home-card-value mdw-home-idle">' + (isRunning() ? (PHASE_TEXT[RT.phase] || '执行中') + (RT.detail ? ' · ' + esc(RT.detail) : '') : '牛牛还没开始任务哦') + '</div>' +
      '</div>' +
    '</div>';

  bindHomeActions(el);
  loadHomeData();
}

function fmtBytes(n) {
  if (!n || n < 0) return '—';
  var gb = n / (1024 * 1024 * 1024);
  return (gb >= 1 ? gb.toFixed(1) + ' GB' : (n / (1024 * 1024)).toFixed(0) + ' MB');
}
function fmtUptime(sec) {
  if (sec == null) return '—';
  var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return (h > 0 ? h + ' 小时 ' : '') + m + ' 分';
}
function setText(id, v) { var e = document.getElementById(id); if (e) e.textContent = v == null ? '—' : v; }

function loadHomeData() {
  GET('/api/system/info').then(function (i) {
    markOnline(true);
    setText('nas-mem', fmtBytes(i.totalMemoryBytes - i.freeMemoryBytes) + ' / ' + fmtBytes(i.totalMemoryBytes));
    var pct = i.totalMemoryBytes ? Math.round((1 - i.freeMemoryBytes / i.totalMemoryBytes) * 100) : 0;
    var bar = document.getElementById('nas-mem-bar');
    if (bar) bar.style.width = pct + '%';
    setText('nas-cpus', (i.cpus || '—') + ' 核');
    setText('nas-arch', i.architecture || '—');
    setText('nas-host', i.hostname || '—');
    setText('nas-uptime', fmtUptime(i.uptimeSeconds));
    setServiceVersion(i);
    setText('home-maa-version', i.maaVersion || '—');
    setText('home-service-version', 'v' + (i.serviceVersion || '—'));
  }).catch(function () {});
  GET('/api/runtime/status').then(function (r) {
    setText('home-res-version', r.ready ? (r.maaVersion || '已就绪') : (r.phase || '未就绪'));
    setText('home-maa-version', r.maaVersion || document.getElementById('home-maa-version').textContent);
  }).catch(function () {});
  GET('/api/resources/info').then(function (r) {
    var n = (r && r.count) || (r && r.entries && r.entries.length) || (r && r.ok != null ? '' : '');
    setText('home-res-version', (n ? n + ' 项资源' : (r && r.version) || '已就绪'));
  }).catch(function () {});
  loadSchedule().then(function () {
    var next = SCHEDULES.filter(function (s) { return s.enabled; }).sort(function (a, b) { return a.time < b.time ? -1 : 1; })[0];
    setText('home-next-sched', next ? next.time : '未设置');
    setText('home-next-sched-sub', next ? taskNamesOf(next.tasks) : '到「日程」页添加');
  });
  setText('nas-phase', PHASE_TEXT[RT.phase] || RT.phase);
}

function bindHomeActions(el) {
  function sync() { syncRuntimeUI(); }
  var rf = el.querySelector('#home-runtime-fetch');
  if (rf) rf.addEventListener('click', function () {
    if (BACKEND.online === false) { openInfoModal('无法操作', '后端未连接（离线预览）。'); return; }
    rf.disabled = true;
    POST('/api/runtime/fetch').then(function (r) {
      openInfoModal('运行包下载', '已开始下载 MAA ' + ((r && r.maaVersion) || '') + '，进度见日志页。');
    }).catch(function (e) { openInfoModal('下载失败', e.message); })
      .then(function () { rf.disabled = false; });
  });
  var rv = el.querySelector('#home-res-verify');
  if (rv) rv.addEventListener('click', function () {
    rv.disabled = true;
    POST('/api/resources/verify').then(function (r) {
      openInfoModal('资源校验', JSON.stringify(r, null, 2).slice(0, 600));
    }).catch(function (e) { openInfoModal('校验失败', e.message); })
      .then(function () { rv.disabled = false; });
  });
  var rl = el.querySelector('#home-reload');
  if (rl) rl.addEventListener('click', function () { loadHomeData(); refreshRunnerStatus(); });
  var conn = el.querySelector('#home-connect');
  if (conn) conn.addEventListener('click', function () {
    var btn = document.getElementById('btn-connect');
    if (btn) btn.click();
  });
  var run = el.querySelector('#home-run');
  if (run) run.addEventListener('click', function () { location.hash = '#/tasks'; });
  var stop = el.querySelector('#home-stop');
  if (stop) stop.addEventListener('click', function () {
    if (BACKEND.online === false) { openInfoModal('无法停止', '后端未连接（离线预览）。'); return; }
    POST('/api/runner/stop').then(refreshRunnerStatus).catch(function (e) { openInfoModal('停止失败', e.message); });
  });
  syncRuntimeUI();
}

/* ===== Page: Tasks (one-click weed) ===== */
var selectedTask = 'fight';
var activeConfigTab = 'basic';

var TASK_TYPES = [
  ['startup', '开始唤醒'], ['fight', '理智作战'], ['infrast', '基建换班'],
  ['recruit', '自动公招'], ['mall', '信用收支'], ['award', '领取奖励'],
  ['roguelike', '自动肉鸽'], ['reclamation', '生息演算'], ['update', '更新数据'],
  ['depot', '仓库保存'], ['switchtheme', '更换主题'], ['custom', '自定义任务']
];


function pageTasks(el) {
  el.innerHTML =
    '<div class="mdw-workbench">' +
      '<section class="mdw-queue">' +
        '<div class="mdw-queue-head"><div class="mdw-queue-title">任务队列</div><div class="mdw-queue-sub" id="q-count">勾选要执行的任务</div></div>' +
        '<div class="mdw-queue-list" id="task-list">' + renderTaskList() + '</div>' +
        '<div class="mdw-queue-foot">' +
          '<button type="button" class="app-btn mdw-queue-add" id="q-add">+ 添加任务</button>' +
          '<div class="mdw-queue-tools">' +
            '<button type="button" class="app-btn" id="q-all">全选</button>' +
            '<button type="button" class="app-btn" id="q-clear">清空</button>' +
            '<button type="button" class="app-btn" id="q-save">保存配置</button>' +
          '</div>' +
          '<div class="mdw-queue-post"><span>完成后</span>' + selectHtml(POST_ACTIONS, 'None', 'q-post') + '</div>' +
          '<button type="button" class="app-btn mdw-btn-primary mdw-startbtn" id="q-start">Link Start!</button>' +
        '</div>' +
      '</section>' +
      '<section class="mdw-config">' +
        '<div class="mdw-config-status">' + esc(deviceStatusText()) + '</div>' +
        (selectedTask === 'startup' ? renderGlobalConfig() : '') +
        '<div class="mdw-config-task" id="task-config">' + renderTaskConfig() + '</div>' +
      '</section>' +
      '<aside class="mdw-live">' +
        '<div class="mdw-live-head"><div class="mdw-live-title" id="live-task-name">运行实况</div><button type="button" class="app-btn" style="font-size:12px;padding:2px 8px" title="刷新">刷新</button></div>' +
        '<div class="mdw-timeline" id="timeline">' + renderTimeline() + '</div>' +
      '</aside>' +
    '</div>';

  bindTaskEvents(el);
  applyTaskConfig(el);
  bindAutoSave(el, { queue: true });
}

function renderTaskList() {
  var defaultChecked = ['startup', 'fight', 'infrast', 'award', 'recruit'];
  return TASKS.map(function (t) {
    return '<div class="mdw-qi' + (t.id === selectedTask ? ' selected' : '') + '" data-task="' + t.id + '" role="button" tabindex="0">' +
      '<button type="button" class="mdw-qi-drag" data-task="' + t.id + '" title="拖拽排序"></button>' +
      '<input type="checkbox" class="app-checkbox mdw-qi-check" data-task="' + t.id + '"' + (defaultChecked.indexOf(t.id) >= 0 ? ' checked' : '') + '/>' +
      '<span class="mdw-qi-name" data-task="' + t.id + '">' + esc(t.name) + '</span>' +
      '<button type="button" class="mdw-qi-rename" data-task="' + t.id + '" title="重命名"></button>' +
      '<button type="button" class="mdw-qi-del" data-task="' + t.id + '" title="删除"></button>' +
    '</div>';
  }).join('');
}

function renderTaskConfig() {
  var task = TASKS.find(function (t) { return t.id === selectedTask; });
  if (!task) return '';
  var renderer = CONFIG_RENDERERS[task.id] || function () { return '<div class="mdw-muted">该任务暂无可配置项。</div>'; };
  var tabs = task.tabs || ['basic'];
  var hasAdvanced = tabs.indexOf('advanced') >= 0;
  var content = renderer(activeConfigTab);

  return '<div class="mdw-config-task-head">' + esc(task.name) + ' · 配置</div>' +
    '<div class="mdw-tabs">' +
      '<button type="button" class="mdw-tab' + (activeConfigTab === 'basic' ? ' active' : '') + '" data-tab="basic">常规设置</button>' +
      '<button type="button" class="mdw-tab' + (activeConfigTab === 'advanced' ? ' active' : '') + (hasAdvanced ? '' : ' disabled') + '" data-tab="advanced"' + (hasAdvanced ? '' : ' disabled') + '>高级设置</button>' +
    '</div>' +
    '<div class="mdw-config-task-body">' + content + '</div>';
}

function updateQueueCount(el) {
  var span = el.querySelector('#q-count');
  if (!span) return;
  var checks = el.querySelectorAll('.mdw-qi-check');
  var on = el.querySelectorAll('.mdw-qi-check:checked').length;
  span.textContent = '已启用 ' + on + ' / ' + checks.length + ' 个任务';
}

function bindTaskEvents(el) {
  function selectTask(id) {
    selectedTask = id;
    activeConfigTab = 'basic';
    el.querySelectorAll('.mdw-qi').forEach(function (x) { x.classList.toggle('selected', x.dataset.task === id); });
    var configSection = el.querySelector('.mdw-config');
    var existingGlobal = configSection.querySelector('.mdw-config-global');
    if (existingGlobal) existingGlobal.remove();
    if (selectedTask === 'startup') {
      var taskConfig = configSection.querySelector('#task-config');
      taskConfig.insertAdjacentHTML('beforebegin', renderGlobalConfig());
    }
    el.querySelector('#task-config').innerHTML = renderTaskConfig();
    bindConfigEvents(el);
    applyTaskConfig(el);
    bindAutoSave(el);
  }

  // Drag-and-drop reordering via custom mouse events (more reliable than HTML5 DnD)
  var taskList = el.querySelector('#task-list');
  if (!taskList) return;
  var dragSrc = null;
  var dragEl = null;
  var dragOffset = 0;
  var placeholder = null;

  taskList.addEventListener('mousedown', function (ev) {
    var handle = ev.target.closest('.mdw-qi-drag');
    if (!handle) return;
    ev.preventDefault();
    var item = handle.closest('.mdw-qi');
    if (!item) return;
    dragSrc = item;
    dragEl = item;
    dragOffset = ev.clientY - item.getBoundingClientRect().top;
    item.classList.add('dragging');

    placeholder = document.createElement('div');
    placeholder.className = 'mdw-qi mdw-qi-placeholder';
    placeholder.style.height = item.offsetHeight + 'px';
    placeholder.style.border = '2px dashed var(--mdw-accent)';
    placeholder.style.opacity = '0.3';
    placeholder.style.borderRadius = '6px';

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  });

  function onDragMove(ev) {
    if (!dragEl) return;
    ev.preventDefault();
    var rect = taskList.getBoundingClientRect();
    var y = ev.clientY - rect.top;
    var after = null;
    var items = taskList.querySelectorAll('.mdw-qi:not(.dragging)');
    items.forEach(function (it) {
      var r = it.getBoundingClientRect();
      var mid = r.top + r.height / 2;
      if (ev.clientY > mid) after = it;
    });
    if (after) {
      after.parentNode.insertBefore(placeholder, after.nextSibling);
    } else if (items[0]) {
      items[0].parentNode.insertBefore(placeholder, items[0]);
    }
  }

  function onDragEnd(ev) {
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    if (!dragEl) return;
    var taskId = dragEl.dataset.task;
    if (placeholder && placeholder.parentNode) {
      var items = Array.from(taskList.querySelectorAll('.mdw-qi:not(.dragging)'));
      var toIdx = 0;
      var foundPlaceholder = false;
      var allItems = Array.from(taskList.children);
      var pIdx = allItems.indexOf(placeholder);
      toIdx = pIdx;
      var fromIdx = TASKS.findIndex(function (t) { return t.id === taskId; });
      if (fromIdx >= 0 && toIdx >= 0) {
        var moved = TASKS.splice(fromIdx, 1)[0];
        if (toIdx > fromIdx) toIdx--;
        TASKS.splice(toIdx, 0, moved);
      }
    }
    dragEl.classList.remove('dragging');
    if (placeholder) { placeholder.remove(); placeholder = null; }
    dragEl = null;
    dragSrc = null;
    rerenderList();
  }

  // Click handler via event delegation
  taskList.addEventListener('click', function (ev) {
    var item = ev.target.closest('.mdw-qi');
    if (!item) return;
    if (ev.target.tagName === 'INPUT') return;
    if (ev.target.classList.contains('mdw-qi-del')) {
      ev.stopPropagation();
      var taskId = ev.target.dataset.task;
      var task = TASKS.find(function (t) { return t.id === taskId; });
      if (!task) return;
      openConfirmModal('删除任务', '确定删除任务「' + task.name + '」？', function () {
        var idx = TASKS.indexOf(task);
        TASKS.splice(idx, 1);
        if (selectedTask === taskId) selectedTask = TASKS[0] ? TASKS[0].id : '';
        rerenderList();
        selectTask(selectedTask);
      });
      return;
    }
    if (ev.target.classList.contains('mdw-qi-rename')) {
      ev.stopPropagation();
      var rId = ev.target.dataset.task;
      var rTask = TASKS.find(function (t) { return t.id === rId; });
      if (!rTask) return;
      openRenameModal(rTask.name, function (newName) {
        rTask.name = newName;
        rerenderList();
      });
      return;
    }
    if (ev.target.classList.contains('mdw-qi-drag')) return;
    selectTask(item.dataset.task);
  });

  function rerenderList() {
    var checks = {};
    taskList.querySelectorAll('.mdw-qi-check').forEach(function (c) { checks[c.dataset.task] = c.checked; });
    taskList.innerHTML = renderTaskList();
    taskList.querySelectorAll('.mdw-qi-check').forEach(function (c) { if (checks[c.dataset.task] !== undefined) c.checked = checks[c.dataset.task]; });
    taskList.querySelectorAll('.mdw-qi').forEach(function (x) { x.classList.toggle('selected', x.dataset.task === selectedTask); });
  }

  // Tab switching via event delegation
  var taskConfigEl = el.querySelector('#task-config');
  if (taskConfigEl) {
    taskConfigEl.addEventListener('click', function (ev) {
      var t = ev.target.closest('.mdw-tab');
      if (!t || t.classList.contains('disabled')) return;
      activeConfigTab = t.dataset.tab;
      taskConfigEl.innerHTML = renderTaskConfig();
      bindConfigEvents(el);
    applyTaskConfig(el);
    bindAutoSave(el);
    });
  }

  var addBtn = el.querySelector('#q-add');
  if (addBtn) addBtn.addEventListener('click', function () {
    openAddTaskModal(function (taskType) {
      var sameName = TASKS.filter(function (t) { return t.name.indexOf(taskType[1]) === 0; }).length;
      var taskName = sameName > 0 ? taskType[1] + ' ' + (sameName + 1) : taskType[1];
      var newId = taskType[0] + '_' + Date.now();
      var existing = TASKS.find(function (t) { return t.id === taskType[0]; });
      var tabs = existing ? existing.tabs : ['basic'];
      TASKS.push({ id: newId, name: taskName, tabs: tabs });
      rerenderList();
      selectTask(newId);
      updateQueueCount(el);
    });
  });

  var allBtn = el.querySelector('#q-all');
  if (allBtn) allBtn.addEventListener('click', function () {
    taskList.querySelectorAll('.mdw-qi-check').forEach(function (c) { c.checked = true; });
    updateQueueCount(el);
  });
  var clearBtn = el.querySelector('#q-clear');
  if (clearBtn) clearBtn.addEventListener('click', function () {
    taskList.querySelectorAll('.mdw-qi-check').forEach(function (c) { c.checked = false; });
    updateQueueCount(el);
  });
  var saveBtn = el.querySelector('#q-save');
  if (saveBtn) saveBtn.addEventListener('click', function () {
    try { localStorage.setItem('mdw-queue', JSON.stringify(TASKS.map(function (t) { return t.id + ':' + t.name; }))); } catch (e) { }
    saveBtn.textContent = '已保存';
    var b = saveBtn;
    setTimeout(function () { b.textContent = '保存配置'; }, 1200);
  });
  taskList.addEventListener('change', function (ev) {
    if (ev.target.classList.contains('mdw-qi-check')) updateQueueCount(el);
  });
  updateQueueCount(el);
  var startBtn = el.querySelector('#q-start');
  if (startBtn) startBtn.addEventListener('click', function () {
    var checked = Array.from(taskList.querySelectorAll('.mdw-qi-check:checked'))
      .map(function (c) { return baseTaskId(c.dataset.task); })
      .filter(function (v, i, a) { return a.indexOf(v) === i; });

    if (isRunning()) {
      POST('/api/runner/stop').then(function () {
        startBtn.textContent = '停止中…';
        setTimeout(refreshRunnerStatus, 800);
      }).catch(function (e) { openInfoModal('停止失败', e.message); });
      return;
    }

    if (!checked.length) { openInfoModal('无法开始', '请先勾选要执行的任务。'); return; }
    if (BACKEND.online === false) { openInfoModal('无法开始', '后端未连接：当前为离线预览模式。'); return; }
    if (!RT.address) { openInfoModal('无法开始', '尚未配置设备地址，请到「设置 → 连接设置」填写 ADB 地址。'); return; }

    saveTaskConfig();              // 先把当前配置写盘，runner 会读它
    startBtn.disabled = true;
    startBtn.textContent = '下发中…';
    POST('/api/tasks/execute', { tasks: checked }).then(function (r) {
      if (r && r.error) throw new Error(r.error);
      refreshRunnerStatus();
    }).catch(function (e) {
      openInfoModal('无法开始', e.message);
    }).then(function () {
      startBtn.disabled = false;
      refreshRunnerStatus();
    });
  });
  bindConfigEvents(el);
}

function bindConfigEvents(el) {
  // 账号切换 → 启用账号名输入（开始唤醒）
  var accSwitch = el.querySelector('#s-account-switch');
  if (accSwitch) {
    var accName = el.querySelector('#s-account-name');
    if (accName) accName.disabled = !accSwitch.checked;
    accSwitch.addEventListener('change', function () { if (accName) accName.disabled = !accSwitch.checked; });
  }

  // 手动输入关卡名 → 显示关卡名输入框
  var manualStage = el.querySelector('#f-manual-stage');
  if (manualStage) {
    var manualRow = el.querySelector('#f-manual-row');
    if (manualRow) manualRow.style.display = manualStage.checked ? 'flex' : 'none';
    manualStage.addEventListener('change', function () { if (manualRow) manualRow.style.display = manualStage.checked ? 'flex' : 'none'; });
  }
  // 使用备选关卡 → 显示备选关卡下拉
  var altStage = el.querySelector('#f-alt-stage');
  if (altStage) {
    var altRow = el.querySelector('#f-alt-row');
    if (altRow) altRow.style.display = altStage.checked ? 'flex' : 'none';
    altStage.addEventListener('change', function () { if (altRow) altRow.style.display = altStage.checked ? 'flex' : 'none'; });
  }

  // 基建：菲亚梅塔心情恢复 → 显示目标干员选择（官方 6 个目标，最多 3 个）
  var felyne = el.querySelector('#i-felyne');
  if (felyne) {
    var felyneRow = el.querySelector('#i-felyne-row');
    if (felyneRow) felyneRow.style.display = felyne.checked ? 'flex' : 'none';
    felyne.addEventListener('change', function () {
      if (felyneRow) felyneRow.style.display = felyne.checked ? 'flex' : 'none';
    });
  }

  var fWeekly = el.querySelector('#f-weekly-plan');
  if (fWeekly) {
    var fWeekBox = el.querySelector('#f-week-box');
    if (fWeekBox) fWeekBox.style.display = fWeekly.checked ? 'block' : 'none';
    fWeekly.addEventListener('change', function () {
      fWeekBox.style.display = fWeekly.checked ? 'block' : 'none';
    });
  }

  var iMode = el.querySelector('#i-mode');
  if (iMode) {
    var iCustomArea = el.querySelector('#i-custom-area');
    if (iCustomArea) iCustomArea.style.display = iMode.value === 'custom' ? 'block' : 'none';
    iMode.addEventListener('change', function () {
      iCustomArea.style.display = iMode.value === 'custom' ? 'block' : 'none';
    });
  }

  var facAll = el.querySelector('#i-fac-all');
  if (facAll) facAll.addEventListener('click', function () {
    el.querySelectorAll('[data-facility]').forEach(function (c) { c.checked = true; });
  });
  var facClear = el.querySelector('#i-fac-clear');
  if (facClear) facClear.addEventListener('click', function () {
    el.querySelectorAll('[data-facility]').forEach(function (c) { c.checked = false; });
  });

  // 更换主题：动态主题名列表
  bindSwitchThemeEvents(el);

  var rcTheme = el.querySelector('#rc-theme');
  if (rcTheme) {
    refreshReclDependent();
    rcTheme.addEventListener('change', function () { refreshReclDependent(); });
  }
  // 肉鸽：主题联动 难度/分队/职业组
  var rgTheme = el.querySelector('#rg-theme');
  if (rgTheme) rgTheme.addEventListener('change', function () { refreshRogueDependent(); });
}

/* 生息演算：按当前主题重建模式下拉与提示文案 */
function refreshReclDependent(keepMode) {
  var themeEl = document.getElementById('rc-theme');
  if (!themeEl) return;
  var theme = themeEl.value;
  var modes = MAA_DATA.reclamation.modes[theme] || [];
  var area = document.getElementById('rc-mode-area');
  var tip = document.getElementById('rc-tip');
  if (area && theme !== 'Fire') {
    area.innerHTML = '<div class="mdw-row-label">模式</div>' + selectHtml(modes, modes[0][0], 'rc-mode');
    var sel = document.getElementById('rc-mode');
    if (sel) {
      if (keepMode && modes.some(function (m) { return m[0] === keepMode; })) sel.value = keepMode;
      if (tip) tip.textContent = reclTipText(theme, sel.value);
      sel.addEventListener('change', function () { if (tip) tip.textContent = reclTipText(theme, sel.value); });
    }
  } else if (area) {
    area.innerHTML = '';
  }
  if (tip) tip.textContent = reclTipText(theme, keepMode || (modes[0] && modes[0][0]) || '');
}

/* 肉鸽：按当前主题重建 难度/分队/职业组/开局干员（保留仍然合法的旧值） */
function refreshRogueDependent(keep) {
  var themeEl = document.getElementById('rg-theme');
  if (!themeEl) return;
  var th = themeEl.value;
  var d = rogueDifficultyList(th);
  var diff = document.getElementById('rg-difficulty');
  if (diff) {
    var keepDiff = keep && keep.difficulty ? String(keep.difficulty) : diff.value;
    diff.innerHTML = d.map(function (c) { return '<option value="' + esc(c[0]) + '">' + esc(c[1]) + '</option>'; }).join('');
    diff.value = d.some(function (c) { return c[0] === keepDiff; }) ? keepDiff : '-1';
  }
  var squad = document.getElementById('rg-squad');
  if (squad) {
    var sq = rogueSquadList(th);
    var keepSquad = keep && keep.squad ? keep.squad : squad.value;
    squad.innerHTML = sq.map(function (x) { return '<option value="' + esc(x) + '">' + esc(x) + '</option>'; }).join('');
    squad.value = sq.indexOf(keepSquad) >= 0 ? keepSquad : MAA_DATA.roguelike.defaultSquad;
  }
  var cls = document.getElementById('rg-class');
  if (cls) {
    var rl = rogueRoleList(th);
    var keepRole = keep && keep.roles ? keep.roles : cls.value;
    cls.innerHTML = rl.map(function (x) { return '<option value="' + esc(x) + '">' + esc(x) + '</option>'; }).join('');
    cls.value = rl.indexOf(keepRole) >= 0 ? keepRole : MAA_DATA.roguelike.roles.defaultValue;
  }
  var core = document.getElementById('rg-operator');
  if (core) {
    var cc = rogueCoreCharList(th);
    var keepCore = keep && keep.core_char ? keep.core_char : core.value;
    core.innerHTML = '<option value="">不选择</option>' +
      cc.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
    core.value = cc.indexOf(keepCore) >= 0 ? keepCore : '';
  }
}

/* ===== Page: Schedule（GET/PUT /api/tasks/schedule） =====
 * 服务端只存 {id, time, enabled, tasks:[任务id]}；repeat 是纯前端字段，
 * 存在 localStorage（服务端调度器尚未实现，见文档）。 */
var SCHEDULES = [];
var SCHED_REPEAT = {};      // id -> repeat
var REPEATS = [['daily', '每天'], ['weekdays', '工作日'], ['weekends', '周末'], ['mon', '每周一'], ['tue', '每周二'], ['wed', '每周三'], ['thu', '每周四'], ['fri', '每周五'], ['sat', '每周六'], ['sun', '每周日']];
var schedSaveTimer = null;

function schedRepeatOf(id) {
  if (SCHED_REPEAT[id]) return SCHED_REPEAT[id];
  try {
    var all = JSON.parse(localStorage.getItem('mdw-sched-repeat') || '{}');
    return all[id] || 'daily';
  } catch (e) { return 'daily'; }
}
function setSchedRepeat(id, v) {
  SCHED_REPEAT[id] = v;
  try {
    var all = JSON.parse(localStorage.getItem('mdw-sched-repeat') || '{}');
    all[id] = v;
    localStorage.setItem('mdw-sched-repeat', JSON.stringify(all));
  } catch (e) { /* ignore */ }
}

function nextRunText(repeat, time) {
  if (repeat === 'daily') return '明天 ' + time;
  if (repeat === 'weekdays') return '下个工作日 ' + time;
  if (repeat === 'weekends') return '下个周末 ' + time;
  return '下周 ' + time;
}

function taskNamesOf(ids) {
  if (!ids || !ids.length) return '（未选择任务）';
  var map = {};
  (CATALOG ? CATALOG.tasks : []).forEach(function (t) { map[t.id] = t.name; });
  TASK_TYPES.forEach(function (t) { if (!map[t[0]]) map[t[0]] = t[1]; });
  return ids.map(function (i) { return map[i] || i; }).join(' + ');
}

function loadSchedule() {
  return GET('/api/tasks/schedule').then(function (r) {
    markOnline(true);
    SCHEDULES = (r.schedule || []).map(function (e) {
      return { id: String(e.id), time: e.time, enabled: e.enabled !== false, tasks: e.tasks || [] };
    });
    return SCHEDULES;
  }).catch(function (e) { markOnline(false, e); return SCHEDULES; });
}

function saveSchedule() {
  if (BACKEND.online === false) return;
  clearTimeout(schedSaveTimer);
  schedSaveTimer = setTimeout(function () {
    PUT('/api/tasks/schedule', {
      schedule: SCHEDULES.map(function (s) {
        return { id: s.id, time: s.time, enabled: s.enabled, tasks: s.tasks };
      }),
    }).catch(function (e) { markOnline(false, e); });
  }, 400);
}

function pageSchedule(el) {
  el.innerHTML =
    '<h2 class="mdw-h1">日程</h2>' +
    '<div class="mdw-settings-group" style="max-width:860px">' +
      '<div class="mdw-settings-group-head">定时任务</div>' +
      '<div id="sched-list">' + renderScheduleList() + '</div>' +
      '<div class="mdw-sched-actions">' +
        '<button type="button" class="app-btn" id="sched-add">+ 添加定时任务</button>' +
        '<button type="button" class="app-btn" id="sched-refresh">刷新</button>' +
        '<span class="mdw-muted">计划保存在服务端（schedule.json）。注意：服务端定时调度器尚未实现，目前只保存计划不触发执行。</span>' +
      '</div>' +
    '</div>';
  bindScheduleEvents(el);
  loadSchedule().then(function () {
    var list = el.querySelector('#sched-list');
    if (list) list.innerHTML = renderScheduleList();
    bindScheduleEvents(el);
  });
}

function renderScheduleList() {
  if (!SCHEDULES.length) return '<div class="mdw-muted" style="padding:10px 0">暂无定时任务。</div>';
  return SCHEDULES.map(function (s) {
    var rep = schedRepeatOf(s.id);
    return '<div class="mdw-sched-row" data-id="' + esc(s.id) + '">' +
      '<label class="app-switch"><input type="checkbox" class="app-checkbox sched-en" data-id="' + esc(s.id) + '"' + (s.enabled ? ' checked' : '') + '/><span class="app-switch-view"></span></label>' +
      '<input type="time" class="app-input-text mdw-sched-time sched-time" data-id="' + esc(s.id) + '" value="' + esc(s.time) + '"/>' +
      '<div class="app-select-menu mdw-sched-repeat"><select class="sched-repeat" data-id="' + esc(s.id) + '">' +
        REPEATS.map(function (r) { return '<option value="' + r[0] + '"' + (r[0] === rep ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') +
      '</select></div>' +
      '<span class="mdw-sched-tasks">' + esc(taskNamesOf(s.tasks)) + '</span>' +
      '<span class="mdw-muted mdw-sched-next">' + (s.enabled ? nextRunText(rep, s.time) : '已停用') + '</span>' +
      '<button type="button" class="app-btn mdw-sched-del" data-id="' + esc(s.id) + '">删除</button>' +
    '</div>';
  }).join('');
}

function bindScheduleEvents(el) {
  function rerender() {
    var list = el.querySelector('#sched-list');
    if (list) list.innerHTML = renderScheduleList();
    bindScheduleEvents(el);
  }
  function find(id) {
    return SCHEDULES.filter(function (x) { return String(x.id) === String(id); })[0];
  }
  el.querySelectorAll('.sched-en').forEach(function (c) {
    c.addEventListener('change', function () {
      var s = find(c.dataset.id);
      if (s) s.enabled = c.checked;
      saveSchedule();
      rerender();
    });
  });
  el.querySelectorAll('.sched-time').forEach(function (t) {
    t.addEventListener('change', function () {
      var s = find(t.dataset.id);
      if (s) s.time = t.value || '04:00';
      saveSchedule();
      rerender();
    });
  });
  el.querySelectorAll('.sched-repeat').forEach(function (t) {
    t.addEventListener('change', function () {
      setSchedRepeat(t.dataset.id, t.value);
      rerender();
    });
  });
  el.querySelectorAll('.mdw-sched-del').forEach(function (b) {
    b.addEventListener('click', function () {
      var s = find(b.dataset.id);
      if (!s) return;
      openConfirmModal('删除定时任务', '确定删除定时任务 ' + s.time + ' 吗？', function () {
        SCHEDULES = SCHEDULES.filter(function (x) { return x !== s; });
        saveSchedule();
        rerender();
      });
    });
  });
  var add = el.querySelector('#sched-add');
  if (add) add.addEventListener('click', function () {
    openScheduleAddModal(function (picked) {
      var entry = { id: 's' + Date.now(), enabled: true, time: '08:00', tasks: picked.map(function (t) { return t[0]; }) };
      SCHEDULES.push(entry);
      saveSchedule();
      rerender();
    });
  });
  var rf = el.querySelector('#sched-refresh');
  if (rf) rf.addEventListener('click', function () { loadSchedule().then(rerender); });
}

/* ===== 日志（GET /api/logs 拉取 + WS /api/ws 实时推送） ===== */
var LOG_FILTER = 'all';
var LOG_MAX = 2000;
var LOG_ENTRIES = [];      // {t, level, msg, src}

function logTimeOf(e) {
  var raw = e.t || e.time || e.timestamp;
  if (raw && typeof raw === 'string' && raw.indexOf('T') > 0) {
    var d = new Date(raw);
    if (!isNaN(d.getTime())) {
      function p(n) { return (n < 10 ? '0' : '') + n; }
      return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }
  }
  return raw || nowTime();
}

function logEntryOf(e) {
  return {
    t: logTimeOf(e),
    level: String(e.level || e.lvl || 'info').toLowerCase(),
    msg: e.msg || e.message || '',
    src: e.src || e.tag || e.scope || e.source || 'server',
  };
}

function pushLogEntry(e) {
  var entry = logEntryOf(e);
  LOG_ENTRIES.push(entry);
  if (LOG_ENTRIES.length > LOG_MAX) LOG_ENTRIES.splice(0, LOG_ENTRIES.length - LOG_MAX);
  appendLogRow(entry);
  appendTimelineRow(entry);
}

function logRowText(e) {
  return e.t + ' [' + e.level.toUpperCase() + '] ' + e.msg + (e.src ? '  (' + e.src + ')' : '');
}

function logMatches(e) { return LOG_FILTER === 'all' || e.level === LOG_FILTER; }

function appendLogRow(e) {
  var view = document.getElementById('log-view');
  if (!view || !logMatches(e)) return;
  var atBottom = view.scrollTop + view.clientHeight >= view.scrollHeight - 30;
  view.textContent += (view.textContent ? '\n' : '') + logRowText(e);
  if (atBottom) view.scrollTop = view.scrollHeight;
}

function appendTimelineRow(e) {
  var tl = document.getElementById('timeline');
  if (!tl) return;
  var lv = e.level === 'warning' ? 'warn' : e.level;
  tl.insertAdjacentHTML('afterbegin',
    '<div class="mdw-tl-item lv-' + esc(lv) + '">' +
      '<span class="mdw-tl-dot"></span>' +
      '<div class="mdw-tl-body">' +
        '<div class="mdw-tl-time">' + esc(e.t) + '</div>' +
        '<div class="mdw-tl-text">' + esc(e.msg) + '</div>' +
        '<div class="mdw-tl-src">' + esc(e.src) + '</div>' +
      '</div></div>');
}

function renderTimeline() {
  var list = LOG_ENTRIES.slice(-40).reverse();
  if (!list.length) return '<div class="mdw-muted" style="padding:10px">暂无日志，点「开始」后这里会实时滚动。</div>';
  return list.map(function (e) {
    var lv = e.level === 'warning' ? 'warn' : e.level;
    return '<div class="mdw-tl-item lv-' + esc(lv) + '"><span class="mdw-tl-dot"></span><div class="mdw-tl-body">' +
      '<div class="mdw-tl-time">' + esc(e.t) + '</div>' +
      '<div class="mdw-tl-text">' + esc(e.msg) + '</div>' +
      '<div class="mdw-tl-src">' + esc(e.src) + '</div></div></div>';
  }).join('');
}

function loadLogs() {
  return GET('/api/logs?limit=300').then(function (r) {
    markOnline(true);
    LOG_ENTRIES = (r.entries || []).map(logEntryOf);
    var view = document.getElementById('log-view');
    if (view) view.textContent = renderFullLogs();
    LOG_FILES = r.files || [];
    var tl = document.getElementById('timeline');
    if (tl) tl.innerHTML = renderTimeline();
    return LOG_ENTRIES;
  }).catch(function (e) { markOnline(false, e); return LOG_ENTRIES; });
}

var LOG_FILES = [];

function connectLogStream() {
  if (typeof WebSocket === 'undefined') return;
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var url = proto + '//' + location.host + '/api/ws';
  var ws;
  try { ws = new WebSocket(url); } catch (e) { return; }
  var retry = 0;
  ws.onopen = function () { markOnline(true); retry = 0; };
  ws.onmessage = function (ev) {
    var data;
    try { data = JSON.parse(ev.data); } catch (e) { return; }
    if (data && data.level && (data.msg || data.message)) pushLogEntry(data);
  };
  ws.onclose = function () {
    retry += 1;
    setTimeout(connectLogStream, Math.min(15000, 1500 * retry));
  };
  ws.onerror = function () { /* onclose 负责重连 */ };
}

function pageLogs(el) {
  el.innerHTML =
    '<h2 class="mdw-h1">日志</h2>' +
    '<div class="mdw-log-toolbar">' +
      '<div class="app-select-menu"><select id="log-level">' +
        [['all', '全部级别'], ['info', '信息'], ['warn', '警告'], ['error', '错误'], ['debug', '调试']].map(function (l) {
          return '<option value="' + l[0] + '"' + (l[0] === LOG_FILTER ? ' selected' : '') + '>' + l[1] + '</option>';
        }).join('') +
      '</select></div>' +
      '<button type="button" class="app-btn" id="log-refresh">刷新</button>' +
      '<button type="button" class="app-btn" id="log-copy">复制日志</button>' +
      '<a class="app-btn" id="log-download" href="/api/logs/download" download>下载日志</a>' +
      '<span class="mdw-muted" id="log-count"></span>' +
    '</div>' +
    '<pre class="mdw-logpage" id="log-view">' + renderFullLogs() + '</pre>';

  function updateCount() {
    var c = document.getElementById('log-count');
    if (c) c.textContent = '共 ' + LOG_ENTRIES.length + ' 条 · 实时推送中（/api/ws）';
  }
  updateCount();
  el.querySelector('#log-level').addEventListener('change', function () {
    LOG_FILTER = this.value;
    el.querySelector('#log-view').textContent = renderFullLogs();
  });
  el.querySelector('#log-refresh').addEventListener('click', function () { loadLogs().then(updateCount); });
  el.querySelector('#log-copy').addEventListener('click', function () {
    var text = renderFullLogs();
    if (navigator.clipboard) navigator.clipboard.writeText(text);
    this.textContent = '已复制';
    var b = this;
    setTimeout(function () { b.textContent = '复制日志'; }, 1200);
  });
  loadLogs().then(updateCount);
}

function renderFullLogs() {
  return LOG_ENTRIES.filter(logMatches).map(logRowText).join('\n');
}

/* ===== Page: Copilot（自动战斗）=====
 * 结构对齐 MaaWpfGui CopilotView：四个页签（主线/故事集/SideStory · 保全派驻 ·
 * 悖论模拟 · 其他活动）+ 作业路径/神秘代码 + 开始 + 各页签不同的开关 + 右侧
 * 小贴士/战斗日志 + 多作业模式下的作业列表。
 * 后端 Copilot API 尚未实现：开始后为本地模拟，界面有明确标注。 */
var copilotTab = 'main';

var COPILOT_TABS = [
  ['main', '主线/故事集/SideStory'],
  ['sa', '保全派驻'],
  ['pm', '悖论模拟'],
  ['other', '其他活动']
];

/* 每个页签的开关配置（对齐 CopilotView.xaml 的可见性） */
var COPILOT_TAB_CFG = {
  main:   { autoSquad: true, multi: true, loop: false },
  sa:     { autoSquad: false, multi: true, loop: true },
  pm:     { autoSquad: false, multi: true, loop: false },
  other:  { autoSquad: true, multi: true, loop: true, autoSquadDisabled: true }
};

/* 作业文件树（mock：正式版从服务端 resource/copilot 目录读取） */
var COPILOT_FILES = [
  { name: 'OF-1_credit_fight.json', stage: 'OF-1' },
  { name: '沃尔岗山丘_Spier_Foothills.json', stage: 'Spier_Foothills' },
  { name: '日达诺夫园区.json', stage: 'NV-1' },
  { name: '荒废灯塔_abandoned_lighthouse.json', stage: 'abandoned_lighthouse' },
  { name: '雷神工业测试平台_Raythean_Industries_Test_Platform.json', stage: 'Raythean_Industries_Test_Platform' },
  { name: 'ddd.json', stage: '1-7' }
];

var COPILOT_TIP = [
  '按界面开始后，若使用「多作业模式」，请从队列列表「等级/编号」页签点击右键，然后可以进行（包括批量）操作。',
  '5. 干员若被标记为「特别关注」，可能影响「自动编队」的识别与选择。建议使用「自动编队」时移除关注，或在报错后关闭「自动编队」，根据提示手动补充缺失的干员。',
  '6. ZOOT 作业站的神秘代码可通过输入框右侧的粘贴按钮粘贴，自动识别格式：\n· prts://s = 作业集\n· prts:// = 单个作业',
  '支持作业格式:',
  '· 添加/左键 单选环境位，右键 = 突袭难度。',
  '· 添加/左键 = 单选悖论模拟，右键 = 仅切换技能导航。',
  '· 请在对应界面启动，不支持跨章节导航。',
  '· 追加自定干员名称无效，且未来版本不支持自动导航。'
];

var COPILOT_WARN =
  '使用此平台时，自动战斗某些功能（如自动编队）可能无法正常运行，建议尝试重启或更换模拟器！' +
  '如使用 MuMu 模拟器，请在「设置 - 连接设置 - 连接配置」选择对应模拟器，并开启下方显示的截图增强。';

/* 战斗日志（本地模拟） */
var COPILOT_LOG = [];
var copilotSimTimer = null;

function copilotLog(level, msg) {
  COPILOT_LOG.push({ level: level, msg: msg });
  if (COPILOT_LOG.length > 200) COPILOT_LOG.splice(0, COPILOT_LOG.length - 200);
  var box = document.getElementById('cp-log');
  if (box) {
    box.insertAdjacentHTML('beforeend', '<div class="mdw-cp-line lv-' + level + '">' + esc(msg) + '</div>');
    box.scrollTop = box.scrollHeight;
  }
}

function pageCopilot(el) {
  var cfg = COPILOT_TAB_CFG[copilotTab];
  el.innerHTML =
    '<div class="mdw-cp">' +
      '<div class="mdw-cp-tabs" id="cp-tabs">' +
        COPILOT_TABS.map(function (t) {
          return '<div class="mdw-cp-tab' + (t[0] === copilotTab ? ' active' : '') + '" data-tab="' + t[0] + '">' + esc(t[1]) + '</div>';
        }).join('') +
      '</div>' +
      '<div class="mdw-cp-grid">' +
        '<div class="mdw-cp-left">' +
          '<div class="mdw-cp-path-row">' +
            '<div class="mdw-cp-combo" id="cp-combo">' +
              '<input type="text" class="app-input-text mdw-cp-input" id="cp-path" placeholder="作业路径/神秘代码" autocomplete="off"/>' +
              '<div class="mdw-cp-dropdown" id="cp-dropdown">' +
                '<div class="mdw-cp-file" data-name="OF-1_credit_fight.json">OF-1_credit_fight.json</div>' +
                '<div class="mdw-cp-folder" data-expand="0">▸ 常规关卡</div>' +
                '<div class="mdw-cp-file indent" data-name="沃尔岗山丘_Spier_Foothills.json">沃尔岗山丘_Spier_Foothills</div>' +
                '<div class="mdw-cp-file indent" data-name="日达诺夫园区.json">日达诺夫园区</div>' +
                '<div class="mdw-cp-file" data-name="荒废灯塔_abandoned_lighthouse.json">荒废灯塔_abandoned_lighthouse</div>' +
                '<div class="mdw-cp-file" data-name="雷神工业测试平台_Raythean_Industries_Test_Platform.json">雷神工业测试平台_Raythean_Industries_Test_Platform</div>' +
                '<div class="mdw-cp-file" data-name="ddd.json">ddd</div>' +
              '</div>' +
            '</div>' +
            '<button type="button" class="app-btn mdw-cp-icon" id="cp-browse" title="打开作业文件（.json）"><i class="icons10 icons10-folder"></i></button>' +
            '<button type="button" class="app-btn mdw-cp-icon" id="cp-paste" title="粘贴神秘代码（prts:// 或 prts://s）"><i class="icons10 icons10-copy"></i></button>' +
            '<input type="file" id="cp-file" accept=".json,application/json" style="display:none"/>' +
          '</div>' +
          '<button type="button" class="app-btn mdw-btn-primary mdw-cp-start" id="cp-start">开始</button>' +
          '<div class="mdw-cp-checks">' +
            (cfg.autoSquad
              ? '<label class="mdw-check' + (cfg.autoSquadDisabled ? ' disabled' : '') + '"><input type="checkbox" class="app-checkbox" id="cp-auto-formation"' + (cfg.autoSquadDisabled ? ' disabled' : '') + '/><span>自动编队</span></label>' + helpHtml('自动识别作业所需的干员并编队。干员被标记「特别关注」可能影响识别。')
              : '') +
            '<label class="mdw-check"><input type="checkbox" class="app-checkbox" id="cp-multi"/><span>多作业模式</span></label>' + helpHtml('仅支持同一章节/页面内导航；启用后选择单个作业会自动加入作业列表。') +
            (cfg.loop ? '<div class="mdw-cp-loop"><label class="mdw-check"><input type="checkbox" class="app-checkbox" id="cp-loop-en"/><span>循环次数</span></label>' + numHtml('cp-loop', 1, 1, 999) + '</div>' : '') +
          '</div>' +
          '<div class="mdw-cp-note">原型说明：后端 Copilot API 尚未接入，「开始」为本地模拟流程；作业文件仅本地解析，不会下发到 MaaCore。</div>' +
        '</div>' +
        '<div class="mdw-cp-right">' +
          '<div id="cp-right-main">' +
            '<div class="mdw-cp-tip">' +
              COPILOT_TIP.map(function (t) { return '<p>' + esc(t).replace(/\n/g, '<br/>') + '</p>'; }).join('') +
            '</div>' +
            '<div class="mdw-cp-log" id="cp-log"></div>' +
          '</div>' +
          '<div id="cp-right-multi" style="display:none">' +
            '<div class="mdw-cp-list-head">' + esc('作业列表') + '</div>' +
            '<div class="mdw-cp-list" id="cp-list"></div>' +
            '<div class="mdw-cp-list-tools">' +
              '<button type="button" class="app-btn mdw-cp-tool" id="cp-add-stage" title="添加作业到列表"><i class="icons10 icons10-plus"></i></button>' +
              '<input type="text" class="app-input-text mdw-cp-stage-input" id="cp-stage-name" placeholder="关卡名，例: 1-7"/>' +
              '<button type="button" class="app-btn mdw-cp-tool" id="cp-sort" title="按关卡名排序"><i class="icons10 icons10-sorting"></i></button>' +
              '<button type="button" class="app-btn mdw-cp-tool mdw-cp-danger" id="cp-clear" title="清空作业列表"><i class="icons10 icons10-trash"></i></button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="mdw-cp-links">' +
        '<a href="https://prts.maa.plus/" target="_blank" rel="noopener">自动战斗#作业分享</a>' +
        '<a href="https://map.ark-nights.com/" target="_blank" rel="noopener">自动战斗#地图坐标</a>' +
      '</div>' +
    '</div>';

  bindCopilotEvents(el);
  renderCopilotLog();
}

function renderCopilotLog() {
  var box = document.getElementById('cp-log');
  if (!box) return;
  box.innerHTML = COPILOT_LOG.map(function (e) {
    return '<div class="mdw-cp-line lv-' + e.level + '">' + esc(e.msg) + '</div>';
  }).join('');
  box.scrollTop = box.scrollHeight;
}

function copilotQueueRender() {
  var box = document.getElementById('cp-list');
  if (!box) return;
  if (!COPILOT_QUEUE.length) {
    box.innerHTML = '<div class="mdw-cp-list-empty">暂无作业。在左侧选择作业文件，或用下方按钮添加。</div>';
    return;
  }
  box.innerHTML = COPILOT_QUEUE.map(function (q, i) {
    return '<div class="mdw-cp-list-item">' +
      '<span class="mdw-cp-idx">' + (i + 1) + '</span>' +
      '<span class="mdw-cp-name">' + esc(q.name) + '</span>' +
      '<span class="mdw-cp-stage">' + esc(q.stage || '—') + '</span>' +
      '<button type="button" class="app-btn mdw-cp-del" data-i="' + i + '" title="删除"><i class="icons10 icons10-trash"></i></button>' +
    '</div>';
  }).join('');
  box.querySelectorAll('.mdw-cp-del').forEach(function (b) {
    b.addEventListener('click', function () {
      COPILOT_QUEUE.splice(+b.dataset.i, 1);
      copilotQueueRender();
    });
  });
}

var COPILOT_QUEUE = [];
var COPILOT_MULTI = false;

function copilotWarn() { copilotLog('warn', COPILOT_WARN); }

function copilotSimulate(path) {
  var name = path || 'OF-1_credit_fight.json';
  if (copilotSimTimer) { clearInterval(copilotSimTimer); copilotSimTimer = null; }
  COPILOT_LOG = [];
  copilotLog('info', '加载作业文件: ' + name);
  copilotWarn();
  var steps = [
    ['info', '开始编队 [先锋]'],
    ['info', '选择干员:先锋 => 德克萨斯'],
    ['info', '已开始行动'],
    ['info', '当前步骤:切换速度'],
    ['info', '当前步骤:部署 先锋'],
    ['info', '当前步骤:开启技能'],
    ['info', '当前步骤:部署 近卫'],
    ['info', '当前步骤:开启技能'],
    ['warn', COPILOT_WARN],
    ['info', '战斗结束 · 胜利'],
    ['info', (COPILOT_MULTI ? '作业队列完成（共 ' + COPILOT_QUEUE.length + ' 项）' : '任务完成')]
  ];
  var i = 0;
  copilotSimTimer = setInterval(function () {
    if (i >= steps.length) { clearInterval(copilotSimTimer); copilotSimTimer = null; return; }
    copilotLog(steps[i][0], steps[i][1]);
    i += 1;
  }, 700);
}

function bindCopilotEvents(el) {
  // 页签
  el.querySelectorAll('#cp-tabs .mdw-cp-tab').forEach(function (t) {
    t.addEventListener('click', function () {
      copilotTab = t.dataset.tab;
      pageCopilot(el);
    });
  });

  // 作业路径下拉（自定义，对齐 MAA 的文件树）
  var input = el.querySelector('#cp-path');
  var dd = el.querySelector('#cp-dropdown');
  if (input && dd) {
    input.addEventListener('focus', function () { dd.style.display = 'block'; });
    input.addEventListener('blur', function () { setTimeout(function () { dd.style.display = 'none'; }, 180); });
    dd.querySelectorAll('.mdw-cp-file').forEach(function (f) {
      f.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        input.value = f.dataset.name;
        dd.style.display = 'none';
        copilotLog('info', '已选择作业: ' + f.dataset.name);
      });
    });
    dd.querySelectorAll('.mdw-cp-folder').forEach(function (f) {
      f.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        var open = f.dataset.expand === '1';
        f.dataset.expand = open ? '0' : '1';
        f.textContent = (open ? '▸ ' : '▾ ') + f.textContent.replace(/^[▸▾]\s*/, '');
        dd.querySelectorAll('.mdw-cp-file.indent').forEach(function (c) {
          c.style.display = open ? 'none' : '';
        });
      });
    });
  }

  // 打开本地作业文件（真实读取 + JSON 解析）
  var browse = el.querySelector('#cp-browse');
  var fileInput = el.querySelector('#cp-file');
  if (browse && fileInput) {
    browse.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var doc = JSON.parse(String(reader.result));
          var stage = (doc && (doc.stage || (doc.doc && doc.doc.title))) || '';
          input.value = f.name;
          copilotLog('info', '已读取作业文件: ' + f.name + (stage ? '（关卡: ' + stage + '）' : '') + ' —— 本地解析，未下发 MaaCore');
          if (COPILOT_MULTI) {
            COPILOT_QUEUE.push({ name: f.name, stage: String(stage || '') });
            copilotQueueRender();
          }
        } catch (e) {
          copilotLog('error', '解析作业文件错误！');
        }
      };
      reader.readAsText(f, 'utf-8');
      fileInput.value = '';
    });
  }

  // 神秘代码粘贴
  var paste = el.querySelector('#cp-paste');
  if (paste) paste.addEventListener('click', function () {
    openModal({
      title: '粘贴神秘代码',
      body: '<textarea class="app-textarea" id="cp-code" rows="5" placeholder="prts://s = 作业集&#10;prts:// = 单个作业"></textarea>',
      buttons: [{ label: '取消' }, {
        label: '导入', primary: true,
        onClick: function () {
          var v = (document.getElementById('cp-code').value || '').trim();
          if (!v) return false;
          copilotLog('info', '已从神秘代码导入: ' + (v.slice(0, 60)) + (v.length > 60 ? '…' : '') + '（原型：未连接作业站）');
        }
      }]
    });
  });

  // 多作业模式 → 切换右侧面板
  var multi = el.querySelector('#cp-multi');
  if (multi) multi.addEventListener('change', function () {
    COPILOT_MULTI = multi.checked;
    var m = el.querySelector('#cp-right-multi');
    var n = el.querySelector('#cp-right-main');
    if (m) m.style.display = COPILOT_MULTI ? '' : 'none';
    if (n) n.style.display = COPILOT_MULTI ? 'none' : '';
    if (COPILOT_MULTI) copilotQueueRender();
  });

  // 作业列表工具
  var add = el.querySelector('#cp-add-stage');
  if (add) add.addEventListener('click', function () {
    var stage = (el.querySelector('#cp-stage-name').value || '').trim();
    var path = (el.querySelector('#cp-path').value || '').trim();
    if (!path) { copilotLog('warn', '未选择作业'); return; }
    COPILOT_QUEUE.push({ name: path, stage: stage });
    copilotQueueRender();
  });
  var sort = el.querySelector('#cp-sort');
  if (sort) sort.addEventListener('click', function () {
    COPILOT_QUEUE.sort(function (a, b) { return (a.stage || '').localeCompare(b.stage || ''); });
    copilotQueueRender();
  });
  var clear = el.querySelector('#cp-clear');
  if (clear) clear.addEventListener('click', function () {
    if (!COPILOT_QUEUE.length) return;
    openConfirmModal('清空作业列表', '确定清空作业列表中的全部作业吗？', function () {
      COPILOT_QUEUE = [];
      copilotQueueRender();
    });
  });

  // 开始
  var start = el.querySelector('#cp-start');
  if (start) start.addEventListener('click', function () {
    var path = (el.querySelector('#cp-path').value || '').trim();
    if (!path) { openInfoModal('自动战斗', '未选择作业'); return; }
    if (COPILOT_MULTI && !COPILOT_QUEUE.length) {
      copilotLog('warn', '正在使用「多作业模式」，但未添加任何作业');
      return;
    }
    copilotSimulate(path);
  });
}

/* ===== Page: Tools ===== */
var toolsTab = 'recruit';
var TOOLS_TABS = [
  ['recruit', '公招识别'], ['operator', '干员识别'], ['depot', '仓库识别'],
  ['gacha', '牛牛抽卡'], ['monitor', '牛牛监控'], ['cowtools', '牛杂'],
  ['resource', '资源更新']
];

/* 各工具的状态（原型 mock：正式版由 /api/tools/* 与 MaaCore 回调填充） */
var TOOL_STATE = {
  recruit: { running: false, last: '2026/9/15 20:13:50' },
  operator: { running: false, last: '2026/9/15 20:18:23', filter: 'all', keyword: '', ownedFilter: 'all' },
  depot: { running: false, last: '2026/9/15 20:19:30', cat: 'all', keyword: '' },
  resource: { last: '2026/9/15 20:20:00' }
};

function toolShell(title, meta, body, cfg, btnLabel) {
  return '<div class="mdw-tool">' +
      '<div class="mdw-tool-head">' +
        '<div class="mdw-tool-title">' + esc(title) + '</div>' +
        '<div class="mdw-tool-meta">' + meta + '</div>' +
      '</div>' +
      '<div class="mdw-tool-body">' + body + '</div>' +
      '<div class="mdw-tool-foot">' +
        '<div class="mdw-tool-cfg">' + cfg + '</div>' +
        '<button type="button" class="app-btn mdw-btn-primary mdw-tool-start" id="tools-start">' + esc(btnLabel || '开始识别') + '</button>' +
      '</div>' +
    '</div>';
}

function pageTools(el) {
  el.innerHTML =
    '<div class="mdw-tools-tabs" id="tools-tabs">' +
      TOOLS_TABS.map(function (t) {
        return '<div class="mdw-tools-tab' + (t[0] === toolsTab ? ' active' : '') + '" data-tab="' + t[0] + '">' + esc(t[1]) + '</div>';
      }).join('') +
    '</div>' +
    '<div class="mdw-tools-body" id="tools-body">' + renderToolsContent() + '</div>';

  el.querySelectorAll('#tools-tabs .mdw-tools-tab').forEach(function (t) {
    t.addEventListener('click', function () {
      toolsTab = t.dataset.tab;
      el.querySelectorAll('#tools-tabs .mdw-tools-tab').forEach(function (x) { x.classList.toggle('active', x === t); });
      el.querySelector('#tools-body').innerHTML = renderToolsContent();
      bindToolsEvents(el);
    });
  });

  bindToolsEvents(el);
}

function renderToolsContent() {
  if (toolsTab === 'recruit') return toolsRecruitContent();
  if (toolsTab === 'operator') return toolsOperatorContent();
  if (toolsTab === 'depot') return toolsDepotContent();
  if (toolsTab === 'gacha') return toolsGachaContent();
  if (toolsTab === 'monitor') return toolsMonitorContent();
  if (toolsTab === 'resource') return toolsResourceContent();
  return toolsCowtoolsContent();
}

/* --- 公招识别 --- */
var RECRUIT_RESULT = {
  tags: [['近卫干员', 3], ['狙击干员', 3], ['重装干员', 3], ['快速复活', 4], ['召唤', 4]],
  groups: [
    { star: 4, tag: '快速复活', ops: [['乌有', 3], ['卡夫卡', 3], ['红', 5], ['槐琥', 'MAX'], ['孑', 'MAX'], ['砾', 'MAX']] },
    { star: 4, tag: '召唤', ops: [['梅尔', 'MAX'], ['豆苗', 'MAX']] },
    { star: 3, tag: '狙击干员', ops: [['四月', ''], ['奥斯塔', ''], ['守林人', ''], ['安哲拉', ''], ['慑砂', ''], ['普罗旺斯', ''], ['灰喉', ''], ['熔泉', ''], ['白金', ''], ['蓝毒', ''], ['送葬人', ''], ['陨星', ''], ['安比尔', ''], ['杰西卡', ''], ['松果', ''], ['梅', ''], ['流星', ''], ['克洛丝', '']] },
    { star: 3, tag: '重装干员', ops: [['临光', ''], ['可颂', ''], ['吽', ''], ['火神', ''], ['石棉', ''], ['雷蛇', ''], ['古米', ''], ['泡泡', ''], ['蛇屠箱', ''], ['角峰', ''], ['斑点', ''], ['米格鲁', '']] },
    { star: 3, tag: '近卫干员', ops: [['因陀罗', ''], ['布洛卡', ''], ['幽灵鲨', ''], ['断崖', ''], ['星极', ''], ['燧石', ''], ['羽毛笔', ''], ['诗怀雅', ''], ['赤冬', ''], ['刻刀', ''], ['宴', ''], ['慕斯', '']] }
  ]
};

function toolsRecruitContent() {
  var st = TOOL_STATE.recruit;
  var maxStar = Math.max.apply(null, RECRUIT_RESULT.groups.map(function (g) { return g.star; }));
  var body =
    '<div class="mdw-result-tags">' +
      RECRUIT_RESULT.tags.map(function (t) {
        return '<span class="mdw-tag-pill s' + t[1] + '">' + esc(t[0]) + '</span>';
      }).join('') +
    '</div>' +
    RECRUIT_RESULT.groups.map(function (g) {
      return '<div class="mdw-result-group">' +
        '<div class="mdw-result-group-head">' +
          '<span class="mdw-star s' + g.star + '">' + '★'.repeat(g.star) + '</span>' +
          '<span class="mdw-muted">Tags: ' + esc(g.tag) + '</span>' +
          '<span class="mdw-muted">' + g.ops.length + ' 名干员</span>' +
        '</div>' +
        '<div class="mdw-result-ops">' + g.ops.map(function (op) {
          var isNew = op[1] === 'NEW';
          var pot = op[1] === 'NEW' ? '(!!! NEW !!!)' : (op[1] ? '(' + op[1] + ')' : '');
          return '<span class="mdw-result-op">' + esc(op[0]) +
            (pot ? '<span class="mdw-result-pot' + (isNew ? ' new' : '') + '">' + esc(pot) + '</span>' : '') + '</span>';
        }).join('') + '</div>' +
      '</div>';
    }).join('');
  var meta = '状态：<b>识别完成</b> · 最高 ' + maxStar + '★ · 共 ' +
    RECRUIT_RESULT.groups.reduce(function (a, g) { return a + g.ops.length; }, 0) + ' 名干员 · 上次同步 ' + esc(st.last);
  var cfg =
    '<label class="mdw-check"><input type="checkbox" class="app-checkbox" checked/><span>自动设置时间</span></label>' +
    '<label class="mdw-check"><input type="checkbox" class="app-checkbox" id="r-show-potential"/><span>显示干员潜能 (4/5/6 星 Tags)</span></label>' +
    '<div class="mdw-cfg-line"><span>自动选择 3★ Tags</span>' + selectHtml([['540', '9:00'], ['480', '8:00'], ['420', '7:00'], ['360', '6:00'], ['0', '不选择']], '540', 'r-time-3') + '</div>' +
    '<div class="mdw-cfg-line"><span>自动选择 4★ Tags</span>' + selectHtml([['540', '9:00'], ['480', '8:00'], ['420', '7:00'], ['0', '不选择']], '540', 'r-time-4') + '</div>' +
    '<div class="mdw-cfg-line"><span>自动选择 5★ Tags</span>' + selectHtml([['540', '9:00'], ['480', '8:00'], ['0', '不选择']], '540', 'r-time-5') + '</div>' +
    '<div class="mdw-cfg-line"><span>自动选择 6★ Tags</span>' + selectHtml([['540', '9:00'], ['0', '不选择']], '540', 'r-time-6') + '</div>';
  return toolShell('公招识别', meta, body, cfg, '开始识别');
}

/* --- 干员识别 --- */
var OPERATOR_DATA = {
  6: ['缪因', '维伊', '娜斯提', '妮芙', '乌尔比安', '玛露西尔', '魔王', '阿斯卡纶', '锏', '仇白', '令', '刺银柏', '焰狐龙梓兰', '凛御银灰', '斩业星熊', '拉普兰德', '麒麟R夜刀', '缄默德克萨斯', '维什戴尔', '圣聆初雪', '假日威龙陈', '新约能天使', '予愿安洁莉娜', '凯尔希', '银灰'],
  5: ['白铁', '缇缇', '号角', '隐德来希', '芙丽妮', '帕拉斯', '风丸', '斩业星熊', '石棉', '古米', '羽毛笔', '休谟斯', '山', '海沫', '怒潮凛冬', '百炼嘉维尔', '仇白', '煌', '艾丽妮'],
  4: ['稀音', '苏苏洛', '嘉维尔', '清流', '安赛尔', '讯使', '芬', '林', '铅踝', '白雪', '罗小黑', '跃跃', '伊桑', '芳汀', '梅', '流星', '克洛丝', '斑点'],
  3: ['空爆', '巡林者', '正义骑士号', '安德切尔', '史都华德', '炎熔', '芙蓉', '调香师', '阿消', '卡缇', '米格鲁', '克洛丝'],
  2: ['杜林', '夜烟', '远山', '惊蛰', '12F'],
  1: ['Castle-3', 'Lancet-2', 'THRM-EX', '正义骑士号']
};
var OPERATOR_OWNED = { '凯尔希': 1, '银灰': 1, '煌': 1, '艾丽妮': 1, '山': 1, '羽毛笔': 1, '苏苏洛': 1, '克洛丝': 1, '米格鲁': 1, '卡缇': 1 };

function toolsOperatorContent() {
  var st = TOOL_STATE.operator;
  var total = 0, owned = 0;
  Object.keys(OPERATOR_DATA).forEach(function (r) { total += OPERATOR_DATA[r].length; });
  Object.keys(OPERATOR_DATA).forEach(function (r) {
    OPERATOR_DATA[r].forEach(function (n) { if (OPERATOR_OWNED[n]) owned++; });
  });
  var kw = (st.keyword || '').trim();
  var body =
    '<div class="mdw-result-filter">' +
      textHtml('op-search', st.keyword, '搜索干员名…') +
      '<div class="mdw-star-filter">' +
        [['all', '全部'], ['6', '6★'], ['5', '5★'], ['4', '4★'], ['3', '3★'], ['2', '2★'], ['1', '1★']].map(function (f) {
          return '<span class="mdw-filter-chip' + (st.filter === f[0] ? ' active' : '') + '" data-star="' + f[0] + '">' + f[1] + '</span>';
        }).join('') +
      '</div>' +
      '<div class="mdw-star-filter">' +
        [['all', '全部'], ['owned', '已拥有'], ['missing', '未拥有']].map(function (f) {
          return '<span class="mdw-filter-chip' + (st.ownedFilter === f[0] ? ' active' : '') + '" data-owned="' + f[0] + '">' + f[1] + '</span>';
        }).join('') +
      '</div>' +
    '</div>' +
    '<div class="mdw-result-stats">' +
      '<span class="mdw-stat"><b>' + owned + '</b> 已拥有</span>' +
      '<span class="mdw-stat"><b>' + (total - owned) + '</b> 未拥有</span>' +
      '<span class="mdw-stat"><b>' + total + '</b> 总计</span>' +
    '</div>' +
    [6, 5, 4, 3, 2, 1].map(function (r) {
      if (st.filter !== 'all' && st.filter !== String(r)) return '';
      var list = OPERATOR_DATA[r].filter(function (n) {
        if (kw && n.indexOf(kw) < 0) return false;
        var isOwned = !!OPERATOR_OWNED[n];
        if (st.ownedFilter === 'owned' && !isOwned) return false;
        if (st.ownedFilter === 'missing' && isOwned) return false;
        return true;
      });
      if (!list.length) return '';
      return '<div class="mdw-result-group">' +
        '<div class="mdw-result-group-head"><span class="mdw-star s' + r + '">' + '★'.repeat(r) + '</span><span class="mdw-muted">' + list.length + ' 名</span></div>' +
        '<div class="mdw-result-ops">' + list.map(function (n) {
          return '<span class="mdw-op-card' + (OPERATOR_OWNED[n] ? '' : ' missing') + '">' + esc(n) + '</span>';
        }).join('') + '</div>' +
      '</div>';
    }).join('');
  var meta = '状态：<b>识别完成</b> · 特别关注会影响干员识别准确率，如有识别错误请自行判断 · 上次同步 ' + esc(st.last);
  var cfg = '<div class="mdw-cfg-line"><span>导出格式</span>' +
    selectHtml([['clipboard', '剪切板'], ['json', 'JSON'], ['markdown', 'Markdown'], ['csv', 'CSV']], 'clipboard', 'o-export') + '</div>' +
    '<button type="button" class="app-btn" id="o-export-btn">导出</button>' +
    '<div class="mdw-cfg-line"><span>同步触发</span>' + selectHtml([['auto', '自动（每日）'], ['manual', '手动']], 'auto', 'o-trigger') + '</div>';
  return toolShell('干员识别', meta, body, cfg, '开始识别');
}

/* --- 仓库识别 --- */
var DEPOT_DATA = [
  { cat: '常规', items: [['至纯源石', 16], ['合成玉', 460], ['龙门币', '1.8M'], ['赤金', '15k'], ['采购凭证', 2643]] },
  { cat: '作战记录', items: [['高级作战记录', 9], ['中级作战记录', 8223], ['初级作战记录', '16k'], ['基础作战记录', '58k']] },
  { cat: '技巧概要', items: [['技巧概要·卷3', 567], ['技巧概要·卷2', 2158], ['技巧概要·卷1', 5788]] },
  { cat: '模组与芯片', items: [['模组数据块', 418], ['数据增补仪', 368], ['数据增补条', 1353], ['芯片助剂', 12]] },
  { cat: '高级材料', items: [['重相位对映体', 13], ['双极纳米片', 47], ['D32钢', 49], ['电子单元', 41], ['聚酸酯块', 5], ['烧结核凝晶', 8]] },
  { cat: '家具与凭证', items: [['家具零件', '24k'], ['装修零件', 320], ['应急理智顶液', 3]] }
];

function toolsDepotContent() {
  var st = TOOL_STATE.depot;
  var kw = (st.keyword || '').trim();
  var body =
    '<div class="mdw-result-filter">' +
      textHtml('dp-search', st.keyword, '搜索材料…') +
      '<div class="mdw-star-filter">' +
        [['all', '全部']].concat(DEPOT_DATA.map(function (c) { return [c.cat, c.cat]; })).map(function (f) {
          return '<span class="mdw-filter-chip' + (st.cat === f[0] ? ' active' : '') + '" data-cat="' + esc(f[0]) + '">' + esc(f[1]) + '</span>';
        }).join('') +
      '</div>' +
    '</div>' +
    DEPOT_DATA.filter(function (c) { return st.cat === 'all' || st.cat === c.cat; }).map(function (c) {
      var items = c.items.filter(function (i) { return !kw || i[0].indexOf(kw) >= 0; });
      if (!items.length) return '';
      return '<div class="mdw-result-group">' +
        '<div class="mdw-result-group-head"><span class="mdw-muted">' + esc(c.cat) + '</span><span class="mdw-muted">' + items.length + ' 项</span></div>' +
        '<div class="mdw-depot-grid2">' + items.map(function (i) {
          return '<div class="mdw-depot-card2"><span class="mdw-depot-icon2 s-mat"></span>' +
            '<span class="mdw-depot-name2">' + esc(i[0]) + '</span>' +
            '<span class="mdw-depot-qty2">' + esc(String(i[1])) + '</span></div>';
        }).join('') + '</div>' +
      '</div>';
    }).join('');
  var meta = '状态：<b>识别完成</b> · 需在仓库界面停留以保证识别准确 · 上次同步 ' + esc(st.last);
  var cfg = '<div class="mdw-cfg-line"><span>导出至</span>' +
    selectHtml([['penguin', '企鹅物流刷图规划'], ['toolbox', '明日方舟工具箱'], ['markdown', 'Markdown'], ['csv', 'CSV']], 'penguin', 'd-export') + '</div>' +
    '<button type="button" class="app-btn" id="d-export-btn">导出</button>' +
    '<div class="mdw-cfg-line"><span>导出后</span>' + selectHtml([['none', '不处理'], ['copy', '复制到剪切板'], ['download', '下载文件']], 'copy', 'd-after') + '</div>';
  return toolShell('仓库识别', meta, body, cfg, '开始识别');
}

/* --- 牛牛抽卡 --- */
function toolsGachaContent() {
  return '<div class="mdw-tool">' +
      '<div class="mdw-tool-head"><div class="mdw-tool-title">牛牛抽卡</div>' +
      '<div class="mdw-tool-meta">仅供娱乐，与游戏内寻访无关</div></div>' +
      '<div class="mdw-tool-body">' +
        '<div class="mdw-gacha-warn" id="gacha-warn">' +
          '<div class="mdw-gacha-warn-text">请注意，这是 <span class="mdw-rainbow">真正的抽卡</span></div>' +
          '<button type="button" class="app-btn mdw-btn-primary" id="gacha-ok">知道了</button>' +
          '<label class="mdw-check"><input type="checkbox" class="app-checkbox" id="gacha-no-show"/><span>下次不再提示</span></label>' +
        '</div>' +
        '<div class="mdw-gacha-main" id="gacha-main" style="display:none">' +
          '<div class="mdw-gacha-lore">在罗德岛竟然有这么多志同道合的志士。是的，诗歌！战争！自由！能在历史的洪流中汇集众人的力量，为这片大地的改变而奋斗。真是令人振奋！这些悲壮又非凡的故事，是应当被传颂下去的。</div>' +
          '<div class="mdw-gacha-meta"><span class="mdw-muted">累计寻访 0 次 · 6★ 0 / 5★ 0 / 4★ 0</span><span class="mdw-gacha-fps">0.00 FPS</span></div>' +
          '<div class="mdw-gacha-actions">' +
            '<button type="button" class="app-btn mdw-gacha-btn" disabled>寻访一次</button>' +
            '<button type="button" class="app-btn mdw-gacha-btn" disabled>寻访十次</button>' +
            '<button type="button" class="app-btn mdw-gacha-peep" id="gacha-peep">Peep!</button>' +
          '</div>' +
          '<div class="mdw-muted">正式版连接设备后，此处会显示寻访动画与结果。</div>' +
        '</div>' +
      '</div>' +
    '</div>';
}

/* --- 牛牛监控 --- */
function toolsMonitorContent() {
  return '<div class="mdw-tool">' +
      '<div class="mdw-tool-head"><div class="mdw-tool-title">牛牛监控</div>' +
      '<div class="mdw-tool-meta">实时查看 MAA 眼中的设备画面</div></div>' +
      '<div class="mdw-tool-body">' +
        '<div class="mdw-monitor-prompt">看看牛牛眼中的世界?</div>' +
        '<div class="mdw-monitor-actions">' +
          '<button type="button" class="app-btn mdw-gacha-peep" id="monitor-peep">Peep!</button>' +
          '<div class="mdw-monitor-fps"><label>目标帧率</label>' + numHtml('m-fps', 1, 1, 60) + '</div>' +
        '</div>' +
        '<div class="mdw-monitor-grid">' +
          [['设备分辨率', '1920x1080', 60], ['截图间隔', '800 ms', 45], ['当前连接', '192.168.31.190:5555', 80], ['识别耗时', '32 ms', 20]].map(function (m) {
            return '<div class="mdw-monitor-card"><div class="mdw-monitor-label">' + esc(m[0]) + '</div>' +
              '<div class="mdw-monitor-value">' + esc(m[1]) + '</div>' +
              '<div class="mdw-monitor-bar"><div style="width:' + m[2] + '%"></div></div></div>';
          }).join('') +
        '</div>' +
      '</div>' +
    '</div>';
}

/* --- 生息演算/活动：牛杂 --- */
function toolsCowtoolsContent() {
  return '<div class="mdw-tool">' +
      '<div class="mdw-tool-head"><div class="mdw-tool-title">牛杂</div>' +
      '<div class="mdw-tool-meta">活动与常驻玩法快捷执行（正式版对接 MaaCore）</div></div>' +
      '<div class="mdw-tool-body mdw-cowtools-body">' +
        '<div class="mdw-cowtools-left">' +
          '<div class="mdw-cowtools-box">' +
            '<div class="mdw-cowtools-box-title">当期活动</div>' +
            '<div class="mdw-cowtools-item">黑流树海刷钱</div>' +
          '</div>' +
          '<div class="mdw-cowtools-box">' +
            '<div class="mdw-cowtools-box-title">常驻活动</div>' +
            '<div class="mdw-cowtools-item">活动商店</div>' +
            '<div class="mdw-cowtools-item">绿票商店</div>' +
            '<div class="mdw-cowtools-item">黄票商店</div>' +
            '<div class="mdw-cowtools-item">生息演算商店</div>' +
            '<div class="mdw-cowtools-item">隐秘战线</div>' +
          '</div>' +
        '</div>' +
        '<div class="mdw-cowtools-right">' +
          '<div class="mdw-cowtools-log" id="cow-log">' +
            '<div class="mdw-cowtools-log-line"><span class="mdw-log-time">20:13:36</span> 3★ Tags</div>' +
            '<div class="mdw-cowtools-log-line"><span class="mdw-log-time">20:13:40</span> 已确认招募 1</div>' +
            '<div class="mdw-cowtools-log-line"><span class="mdw-log-time">20:20:10</span> 当前设施: 宿舍 01</div>' +
            '<div class="mdw-cowtools-log-line"><span class="mdw-log-time">20:22:21</span> 当前设施: 发电站 02</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="mdw-tool-foot">' +
        '<div class="mdw-tool-cfg"><label class="mdw-check"><input type="checkbox" class="app-checkbox" checked/><span>执行后返回主界面</span></label></div>' +
        '<button type="button" class="app-btn mdw-btn-primary" id="cow-run">开始</button>' +
      '</div>' +
    '</div>';
}

/* --- 资源更新 --- */
function toolsResourceContent() {
  var rows = [
    ['客户端资源', '月行水上 #0914', '最新'],
    ['MAA 资源包', 'v6.17.5-r1', '最新'],
    ['作业站数据', '2026-09-15 08:00', '可更新'],
    ['干员数据 (PRTS)', '2026-09-14', '最新'],
    ['关卡数据 (企鹅物流)', '2026-09-13', '可更新']
  ];
  var body = '<table class="app-table-view mdw-res-table"><thead><tr><th>资源</th><th>当前版本</th><th>状态</th><th></th></tr></thead><tbody>' +
    rows.map(function (r) {
      return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td>' +
        '<td><span class="mdw-pill ' + (r[2] === '最新' ? 'ok' : '') + '">' + esc(r[2]) + '</span></td>' +
        '<td><button type="button" class="app-btn" style="font-size:12px;padding:2px 10px"' + (r[2] === '最新' ? ' disabled' : '') + '>更新</button></td></tr>';
    }).join('') + '</tbody></table>';
  var meta = '上次检查：' + esc(TOOL_STATE.resource.last) + ' · 更新会覆盖 resource 目录';
  var cfg = '<label class="mdw-check"><input type="checkbox" class="app-checkbox" checked/><span>自动检查资源更新</span></label>' +
    '<div class="mdw-cfg-line"><span>更新源</span>' + selectHtml([['github', 'GitHub'], ['mirror', '国内镜像'], ['custom', '自定义']], 'mirror', 'res-src') + '</div>';
  return toolShell('资源更新', meta, body, cfg, '检查更新');
}

function bindToolsEvents(el) {
  var startBtn = el.querySelector('#tools-start');
  if (startBtn) startBtn.addEventListener('click', function () {
    var label = startBtn.textContent;
    startBtn.textContent = '执行中…';
    startBtn.disabled = true;
    setTimeout(function () { startBtn.textContent = label; startBtn.disabled = false; }, 1500);
  });
  var gachaOk = el.querySelector('#gacha-ok');
  if (gachaOk) gachaOk.addEventListener('click', function () {
    el.querySelector('#gacha-warn').style.display = 'none';
    el.querySelector('#gacha-main').style.display = '';
  });
  ['#gacha-peep', '#monitor-peep'].forEach(function (sel) {
    var b = el.querySelector(sel);
    if (b) b.addEventListener('click', function () {
      b.textContent = 'Peeping...';
      setTimeout(function () { b.textContent = 'Peep!'; }, 1500);
    });
  });
  var cow = el.querySelector('#cow-run');
  if (cow) cow.addEventListener('click', function () {
    cow.textContent = cow.textContent === '开始' ? '停止' : '开始';
  });
  var exp = el.querySelector('#o-export-btn');
  if (exp) exp.addEventListener('click', function () { exp.textContent = '已导出'; var b = exp; setTimeout(function () { b.textContent = '导出'; }, 1200); });
  var dexp = el.querySelector('#d-export-btn');
  if (dexp) dexp.addEventListener('click', function () { dexp.textContent = '已导出'; var b = dexp; setTimeout(function () { b.textContent = '导出'; }, 1200); });

  // 干员识别：搜索 / 星级 / 拥有状态筛选
  var oSearch = el.querySelector('#op-search');
  if (oSearch) oSearch.addEventListener('input', function () {
    TOOL_STATE.operator.keyword = oSearch.value;
    var box = el.querySelector('.mdw-tool-body');
    var t = document.createRange().createContextualFragment('');
    void t;
    el.querySelector('#tools-body').innerHTML = renderToolsContent();
    bindToolsEvents(el);
    var again = el.querySelector('#op-search');
    if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
  });
  el.querySelectorAll('.mdw-star-filter .mdw-filter-chip').forEach(function (c) {
    c.addEventListener('click', function () {
      if (c.dataset.star) TOOL_STATE.operator.filter = c.dataset.star;
      if (c.dataset.owned) TOOL_STATE.operator.ownedFilter = c.dataset.owned;
      if (c.dataset.cat) TOOL_STATE.depot.cat = c.dataset.cat;
      el.querySelector('#tools-body').innerHTML = renderToolsContent();
      bindToolsEvents(el);
    });
  });
  var dSearch = el.querySelector('#dp-search');
  if (dSearch) dSearch.addEventListener('input', function () {
    TOOL_STATE.depot.keyword = dSearch.value;
    el.querySelector('#tools-body').innerHTML = renderToolsContent();
    bindToolsEvents(el);
    var again = el.querySelector('#dp-search');
    if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
  });
}

/* ===== Page: Settings ===== */
var settingsTab = 'connection';

function pageSettings(el) {
  var navItems = [
    ['connection', '连接设置'],
    ['startup', '启动设置'],
    ['game', '游戏设置'],
    ['ui', '界面设置'],
    ['function', '功能设置'],
    ['notify', '通知设置'],
    ['hotkey', '热键设置'],
    ['perf', '性能设置'],
    ['update', '更新设置'],
    ['about', '关于']
  ];

  el.innerHTML =
    '<h2 class="mdw-h1">设置</h2>' +
    '<div class="mdw-settings">' +
      '<div class="mdw-settings-nav">' +
        navItems.map(function (n) {
          return '<div class="mdw-settings-nav-item' + (settingsTab === n[0] ? ' active' : '') + '" data-tab="' + n[0] + '">' + n[1] + '</div>';
        }).join('') +
      '</div>' +
      '<div class="mdw-settings-body" id="settings-body">' + renderSettingsBody() + '</div>' +
    '</div>';

  el.querySelectorAll('.mdw-settings-nav-item').forEach(function (n) {
    n.addEventListener('click', function () {
      settingsTab = n.dataset.tab;
      el.querySelectorAll('.mdw-settings-nav-item').forEach(function (x) { x.classList.toggle('active', x === n); });
      el.querySelector('#settings-body').innerHTML = renderSettingsBody();
      bindSettingsEvents(el);
    });
  });

  bindSettingsEvents(el);
}

function currentThemePref() {
  var stored = null;
  try { stored = localStorage.getItem('mdw-theme'); } catch (e) { }
  if (stored === 'dark' || stored === 'light') return stored;
  return 'auto';
}

function applyTheme(mode) {
  var dark = mode === 'dark' ||
    (mode === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.body.setAttribute('data-theme', dark ? 'dark' : 'light');
  var sw = document.getElementById('theme-switch');
  if (sw) sw.checked = dark;
  try { localStorage.setItem('mdw-theme', mode); } catch (e) { }
}

function saveConnection() {
  if (BACKEND.online === false) return;
  var payload = {
    address: (document.getElementById('cs-address') || {}).value || '',
    adbPath: (document.getElementById('cs-adbPath') || {}).value || '',
    config: (document.getElementById('cs-config') || {}).value || 'General',
    touchMode: (document.getElementById('cs-touchMode') || {}).value || 'minitouch',
    clientType: (document.getElementById('cs-clientType') || {}).value || 'Official',
  };
  CONNECTION = Object.assign(CONNECTION, payload);
  if (payload.address) DEVICE.address = payload.address;
  PUT('/api/connection', payload).then(function () {
    markOnline(true);
    refreshRunnerStatus();
  }).catch(function (e) { markOnline(false, e); });
}

function bindSettingsEvents(el) {
  ['cs-address', 'cs-adbPath', 'cs-config', 'cs-touchMode', 'cs-clientType'].forEach(function (id) {
    var f = el.querySelector('#' + id);
    if (f) { f.addEventListener('change', saveConnection); }
  });
  var testBtn = el.querySelector('#cs-test');
  if (testBtn) testBtn.addEventListener('click', function () {
    var msg = el.querySelector('#cs-msg');
    saveConnection();
    testBtn.disabled = true;
    if (msg) msg.textContent = '测试中…';
    POST('/api/runner/test-connect').then(function (r) {
      if (msg) msg.textContent = (r && (r.detail || r.message)) || '连接成功';
      openInfoModal('连接测试', JSON.stringify(r || {}, null, 2));
    }).catch(function (e) {
      if (msg) msg.textContent = '失败：' + e.message;
    }).then(function () { testBtn.disabled = false; refreshRunnerStatus(); });
  });

  var themeSel = el.querySelector('#s-theme');
  if (themeSel) themeSel.addEventListener('change', function () { applyTheme(this.value); });
  var navCol = el.querySelector('#s-navcollapse');
  if (navCol) navCol.addEventListener('change', function () {
    var wrap = document.getElementById('NavBarMain');
    if (!wrap) return;
    wrap.classList.toggle('collapsed', navCol.checked);
  });
}

function renderSettingsBody() {
  if (settingsTab === 'connection') {
    return '<div class="mdw-settings-group">' +
      '<div class="mdw-settings-group-head">连接设置</div>' +
      settingsRow('连接地址', '设备/模拟器的 ADB 地址', '<input type="text" class="app-input-text" id="cs-address" value="' + esc(CONNECTION.address || '') + '" placeholder="192.168.31.190:5555"/>') +
      settingsRow('ADB 路径', '留空使用容器内 /usr/bin/adb', '<input type="text" class="app-input-text" id="cs-adbPath" value="' + esc(CONNECTION.adbPath || '') + '" placeholder="/usr/bin/adb"/>') +
      settingsRow('连接配置', 'MAA Core 内置识别与截图策略', selectHtml(CONN_CONFIGS, CONNECTION.config || 'General', 'cs-config')) +
      settingsRow('触控模式', '实例级参数 AsstSetInstanceOption(TouchMode)', selectHtml(TOUCH_MODES, CONNECTION.touchMode || 'minitouch', 'cs-touchMode')) +
      settingsRow('客户端类型', '与当前账号和资源包保持一致', selectHtml(CLIENTS, CONNECTION.clientType || 'Official', 'cs-clientType')) +
      '<div class="mdw-settings-row"><div><div class="mdw-settings-label">连接测试</div><div class="mdw-settings-desc">加载资源并尝试连接设备（AsstAsyncConnect）</div></div>' +
      '<div class="mdw-settings-ctl"><button type="button" class="app-btn mdw-btn-primary" id="cs-test">测试连接</button><span class="mdw-muted" id="cs-msg"></span></div></div>' +
    '</div>';
  }
  if (settingsTab === 'startup') {
    return '<div class="mdw-settings-group">' +
      '<div class="mdw-settings-group-head">启动设置</div>' +
      settingsRow('开机自启', '容器启动时自动加载资源', '<label class="app-switch"><input type="checkbox" class="app-checkbox" checked/><span class="app-switch-view"></span></label>') +
      settingsRow('启动后自动连接设备', '加载完成后立刻连接上次地址', '<label class="app-switch"><input type="checkbox" class="app-checkbox" checked/><span class="app-switch-view"></span></label>') +
      settingsRow('启动后自动执行任务队列', '进页面即 Link Start', '<label class="app-switch"><input type="checkbox" class="app-checkbox"/><span class="app-switch-view"></span></label>') +
      settingsRow('默认进入页面', '打开网页后的落地页', selectHtml([['home', '主页'], ['tasks', '一键长草'], ['copilot', '自动战斗'], ['tools', '小工具']], 'home')) +
    '</div>';
  }
  if (settingsTab === 'game') {
    return '<div class="mdw-settings-group">' +
      '<div class="mdw-settings-group-head">游戏设置</div>' +
      settingsRow('客户端类型', '与当前账号和资源包保持一致', selectHtml(CLIENTS, 'Official')) +
      settingsRow('默认关卡', '理智作战的兜底关卡', selectHtml(STAGES, '1-7')) +
      settingsRow('代理指挥倍率', '默认代理倍率', selectHtml([['0', 'AUTO'], ['3', '3'], ['2', '2'], ['1', '1'], ['-1', '不切换']], '0')) +
      settingsRow('自动关闭弹窗', '自动跳过公告/活动弹窗', '<label class="app-switch"><input type="checkbox" class="app-checkbox" checked/><span class="app-switch-view"></span></label>') +
      settingsRow('战斗中开启倍速', '二倍速执行', '<label class="app-switch"><input type="checkbox" class="app-checkbox" checked/><span class="app-switch-view"></span></label>') +
      settingsRow('作战失败后重试', '最大重试次数', numHtml('g-retry', 0, 0, 9)) +
    '</div>';
  }
  if (settingsTab === 'ui') {
    return '<div class="mdw-settings-group">' +
      '<div class="mdw-settings-group-head">界面设置</div>' +
      settingsRow('主题', '浅色 / 深色 / 跟随系统', selectHtml([['light', '浅色'], ['dark', '深色'], ['auto', '跟随系统']], currentThemePref(), 's-theme')) +
      settingsRow('语言', '界面显示语言', selectHtml([['zh-CN', '简体中文'], ['en-US', 'English'], ['ja-JP', '日本語'], ['ko-KR', '한국어']], 'zh-CN')) +
      settingsRow('导航栏收起', '桌面端默认收起为图标栏', '<label class="app-switch"><input type="checkbox" class="app-checkbox" id="s-navcollapse"' + (document.getElementById('NavBarMain').classList.contains('collapsed') ? ' checked' : '') + '/><span class="app-switch-view"></span></label>') +
    '</div>';
  }
  if (settingsTab === 'function') {
    return '<div class="mdw-settings-group">' +
      '<div class="mdw-settings-group-head">功能设置</div>' +
      settingsRow('完成后动作', '任务执行完毕后的系统动作', selectHtml(POST_ACTIONS, 'None')) +
      settingsRow('定时执行', '启用定时调度器', '<label class="app-switch"><input type="checkbox" class="app-checkbox"/><span class="app-switch-view"></span></label>') +
      settingsRow('外部通知', 'SMTP / Telegram / Discord 等', '<button type="button" class="app-btn">配置通知</button>') +
      settingsRow('任务超时提醒', '任务执行超时后发送通知', '<label class="app-switch"><input type="checkbox" class="app-checkbox"/><span class="app-switch-view"></span></label>') +
    '</div>';
  }
  if (settingsTab === 'notify') {
    return '<div class="mdw-settings-group">' +
      '<div class="mdw-settings-group-head">通知设置</div>' +
      settingsRow('启用外部通知', '任务完成/失败时推送', '<label class="app-switch"><input type="checkbox" class="app-checkbox"/><span class="app-switch-view"></span></label>') +
      settingsRow('通知渠道', '可多选（正式版）', selectHtml([['none', '未配置'], ['smtp', 'SMTP 邮件'], ['telegram', 'Telegram'], ['discord', 'Discord'], ['wecom', '企业微信']], 'none')) +
      settingsRow('Telegram Bot Token', '留空则不启用', textHtml('n-tg-token', '', '123456:ABC-DEF...')) +
      settingsRow('Telegram Chat ID', '留空则不启用', textHtml('n-tg-chat', '', '-1001234567890')) +
      settingsRow('任务超时提醒', '超过 N 分钟未完成任务则通知', numHtml('n-timeout', 60, 1, 1440)) +
      settingsRow('异常停止时通知', '崩溃/掉线时推送', '<label class="app-switch"><input type="checkbox" class="app-checkbox" checked/><span class="app-switch-view"></span></label>') +
    '</div>';
  }
  if (settingsTab === 'hotkey') {
    return '<div class="mdw-settings-group">' +
      '<div class="mdw-settings-group-head">热键设置</div>' +
      settingsRow('开始 / 停止', '全局快捷键', textHtml('hk-start', 'Ctrl + F9', '点击后按下组合键（原型静态）', true)) +
      settingsRow('截图测试', '全局快捷键', textHtml('hk-shot', 'Ctrl + F10', '', true)) +
      settingsRow('显示 / 隐藏窗口', '全局快捷键', textHtml('hk-toggle', 'Ctrl + F11', '', true)) +
      '<div class="mdw-settings-row"><div><div class="mdw-settings-label">说明</div><div class="mdw-settings-desc">浏览器端无法注册系统级全局热键，正式版改为页面内快捷键</div></div><div class="mdw-settings-ctl"><button type="button" class="app-btn" disabled>录制</button></div></div>' +
    '</div>';
  }
  if (settingsTab === 'perf') {
    return '<div class="mdw-settings-group">' +
      '<div class="mdw-settings-group-head">性能设置</div>' +
      settingsRow('截图间隔', '两次截图之间的间隔（毫秒）', numHtml('p-screenshot', 800, 100, 5000)) +
      settingsRow('CPU 占用上限', '0 表示不限制（百分比）', numHtml('p-cpu', 0, 0, 100)) +
      settingsRow('识别使用 GPU', '需容器内可用 CUDA/OpenCL', '<label class="app-switch"><input type="checkbox" class="app-checkbox"/><span class="app-switch-view"></span></label>') +
      settingsRow('降低截图分辨率', '低配 NAS 可开启', '<label class="app-switch"><input type="checkbox" class="app-checkbox"/><span class="app-switch-view"></span></label>') +
      settingsRow('后台运行时降频', '页面不可见时降低轮询频率', '<label class="app-switch"><input type="checkbox" class="app-checkbox" checked/><span class="app-switch-view"></span></label>') +
    '</div>';
  }
  if (settingsTab === 'update') {
    return '<div class="mdw-settings-group">' +
      '<div class="mdw-settings-group-head">更新设置</div>' +
      settingsRow('自动下载 Runtime', '数据卷中没有运行包时自动下载', '<label class="app-switch"><input type="checkbox" class="app-checkbox" checked/><span class="app-switch-view"></span></label>') +
      settingsRow('检查更新', '启动时检查 MAA 新版本', '<label class="app-switch"><input type="checkbox" class="app-checkbox" checked/><span class="app-switch-view"></span></label>') +
      settingsRow('当前版本', 'MAA Runtime 版本', '<span class="mdw-muted">v6.17.5</span>') +
      '<div class="mdw-settings-row"><div><div class="mdw-settings-label">手动更新</div><div class="mdw-settings-desc">从 MAA 官方 GitHub Release 下载</div></div><div class="mdw-settings-ctl"><button type="button" class="app-btn mdw-btn-primary">检查更新</button></div></div>' +
    '</div>';
  }
  if (settingsTab === 'about') {
    return '<div class="mdw-about">' +

      '<div class="mdw-about-hero">' +
        '<div class="mdw-about-logo">M</div>' +
        '<div class="mdw-about-hero-text">' +
          '<div class="mdw-about-title">MAA for NAS</div>' +
          '<div class="mdw-about-version">v0.5.0</div>' +
        '</div>' +
      '</div>' +

      '<div class="mdw-about-card">' +
        '<div class="mdw-about-card-title">项目信息</div>' +
        '<div class="mdw-about-row"><span class="mdw-about-key">MAA 版本</span><span class="mdw-about-val">v6.17.5</span></div>' +
        '<div class="mdw-about-row"><span class="mdw-about-key">前端组件</span><span class="mdw-about-val">windows-ui (MIT)</span></div>' +
        '<div class="mdw-about-row"><span class="mdw-about-key">上游项目</span><span class="mdw-about-val">MaaAssistantArknights (AGPL-3.0)</span></div>' +
        '<div class="mdw-about-row"><span class="mdw-about-key">开源许可</span><span class="mdw-about-val">本项目代码以 MIT 许可发布</span></div>' +
      '</div>' +

      '<div class="mdw-about-card">' +
        '<div class="mdw-about-card-title">相关链接</div>' +
        '<div class="mdw-about-row"><span class="mdw-about-key">MAA for NAS</span><a class="mdw-about-link" href="https://github.com/Kasbuky-sudo/maa-docker-web" target="_blank">github.com/Kasbuky-sudo/maa-docker-web</a></div>' +
        '<div class="mdw-about-row"><span class="mdw-about-key">windows-ui</span><a class="mdw-about-link" href="https://github.com/virtualvivek/windows-ui" target="_blank">github.com/virtualvivek/windows-ui</a></div>' +
        '<div class="mdw-about-row"><span class="mdw-about-key">MaaAssistantArknights</span><a class="mdw-about-link" href="https://github.com/MaaAssistantArknights/MaaAssistantArknights" target="_blank">github.com/MaaAssistantArknights/MaaAssistantArknights</a></div>' +
      '</div>' +

      '<div class="mdw-about-card">' +
        '<div class="mdw-about-card-title">AI 辅助声明</div>' +
        '<div class="mdw-about-ai-text">本项目前端原型与后端服务的开发过程中均使用了 AI 辅助工具生成部分代码，已使用的模型如下：</div>' +
        '<div class="mdw-about-ai-list">' +
          '<div class="mdw-about-ai-item"><span class="mdw-about-ai-model">GLM 5.3</span><span class="mdw-about-ai-vendor">智谱 AI</span></div>' +
          '<div class="mdw-about-ai-item"><span class="mdw-about-ai-model">GLM 5.3 Flash</span><span class="mdw-about-ai-vendor">智谱 AI</span></div>' +
          '<div class="mdw-about-ai-item"><span class="mdw-about-ai-model">GPT 5.5</span><span class="mdw-about-ai-vendor">OpenAI</span></div>' +
          '<div class="mdw-about-ai-item"><span class="mdw-about-ai-model">GPT 5.6 Luna</span><span class="mdw-about-ai-vendor">OpenAI</span></div>' +
          '<div class="mdw-about-ai-item"><span class="mdw-about-ai-model">DeepSeek V4.1 Flash</span><span class="mdw-about-ai-vendor">DeepSeek</span></div>' +
          '<div class="mdw-about-ai-item"><span class="mdw-about-ai-model">Hunyuan Hy4 Preview</span><span class="mdw-about-ai-vendor">腾讯</span></div>' +
          '<div class="mdw-about-ai-item"><span class="mdw-about-ai-model">Trae (内置模型)</span><span class="mdw-about-ai-vendor">字节跳动</span></div>' +
        '</div>' +
        '<div class="mdw-about-ai-note">AI 生成的代码已经过人工审查与测试，但可能仍存在潜在问题，使用前请知悉。</div>' +
      '</div>' +

    '</div>';
  }
  return '';
}

function settingsRow(label, desc, ctl) {
  return '<div class="mdw-settings-row"><div><div class="mdw-settings-label">' + esc(label) + '</div><div class="mdw-settings-desc">' + esc(desc) + '</div></div><div class="mdw-settings-ctl">' + ctl + '</div></div>';
}

/* ===== Router ===== */
var pages = {
  home: pageHome,
  tasks: pageTasks,
  copilot: pageCopilot,
  schedule: pageSchedule,
  tools: pageTools,
  logs: pageLogs,
  settings: pageSettings
};

function route() {
  var hash = location.hash || '#/home';
  var name = hash.replace('#/', '').split('?')[0] || 'home';
  document.querySelectorAll('#app-navbar-list a').forEach(function (a) {
    a.className = a.getAttribute('href') === '#/' + name ? 'active' : 'unactive';
  });
  // Tasks page: no scroll on container; each column scrolls independently
  $page.classList.toggle('mdw-no-scroll', name === 'tasks');
  var fn = pages[name] || pages.home;
  try {
    fn($page);
  } catch (e) {
    $page.innerHTML = '<h2 class="mdw-h1">出错</h2><p class="mdw-error">' + esc(e.message) + '</p>';
  }
}

/* ===== Init: navbar collapse memory ===== */
(function () {
  var wrap = document.getElementById('NavBarMain');
  if (!wrap) return;
  var stored = null;
  try { stored = localStorage.getItem('mdw-nav'); } catch (e) { }
  var desktop = window.innerWidth >= 760;
  if (stored === 'collapsed' || (stored === null && desktop)) wrap.classList.add('collapsed');
  new MutationObserver(function () {
    try { localStorage.setItem('mdw-nav', wrap.classList.contains('collapsed') ? 'collapsed' : 'open'); } catch (e) { }
  }).observe(wrap, { attributes: true, attributeFilter: ['class'] });
})();

/* ===== Theme switch ===== */
(function () {
  var sw = document.getElementById('theme-switch');
  applyTheme(currentThemePref());
  if (!sw) return;
  sw.addEventListener('change', function () {
    applyTheme(sw.checked ? 'dark' : 'light');
  });
  // 跟随系统：未手动选择过时监听系统变化
  if (window.matchMedia) {
    try {
      if (!localStorage.getItem('mdw-theme')) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
          applyTheme('auto');
        });
      }
    } catch (e) { }
  }
})();

/* ===== Connect button (titlebar) ===== */
bindConnectButton();

/* ===== 启动引导：先拉后端数据，再首渲染；之后轮询运行状态 ===== */
function boot() {
  return Promise.all([
    GET('/api/version').then(function (v) {
      markOnline(true);
      if (v && v.maaVersion) DEVICE.maaVersion = v.maaVersion;
      RT.maaVersion = (v && v.maaVersion) || RT.maaVersion;
      setServiceVersion(v);
      return v;
    }).catch(function (e) { markOnline(false, e); return null; }),
    GET('/api/tasks/catalog').then(function (c) { CATALOG = c; return c; }).catch(function () { return null; }),
    GET('/api/tasks/config').then(function (c) { TASK_CFG = (c && c.config) || {}; return TASK_CFG; }).catch(function () { return {}; }),
    refreshConnection(),
    loadLogs(),
  ]).then(function () {
    // 顶栏版本号 & 离线提示
    setServiceVersion(LAST_VERSION);
    connectLogStream();
    return refreshRunnerStatus();
  }).catch(function () { /* 离线也继续渲染 */ });
}

window.addEventListener('hashchange', route);

boot().then(function () {
  route();
  setInterval(function () {
    if (document.hidden) return;
    refreshRunnerStatus();
  }, 2500);
});
