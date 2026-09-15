'use strict';

/* ============================================================
 * MAA for NAS — Web Prototype
 * Pages: home / tasks / copilot / tools / settings
 * ============================================================ */

var $page = document.getElementById('page');

/* ===== Mock device / runtime state (接后端时替换为 /api/runner/status 轮询) ===== */
var DEVICE = { connected: false, address: '192.168.31.190:5555', maaVersion: 'v6.17.5' };
var RUNNING = false;
var runTimer = null;

function nowTime() {
  var d = new Date();
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function deviceStatusText() {
  return DEVICE.connected
    ? DEVICE.address + ' · MAA ' + DEVICE.maaVersion + ' · ' + (RUNNING ? '运行中' : '空闲 · 等待执行')
    : '设备未连接 · 请点击右上角「连接」';
}

function updateDeviceChip() {
  var chip = document.querySelector('.mdw-chip');
  var btn = document.getElementById('btn-connect');
  if (chip) {
    chip.classList.toggle('ok', DEVICE.connected);
    chip.innerHTML = '<span class="mdw-dot"></span>' + (DEVICE.connected ? '已连接 ' + DEVICE.address : '设备未连接');
  }
  if (btn) btn.textContent = DEVICE.connected ? '断开' : '连接';
}

function bindConnectButton() {
  var btn = document.getElementById('btn-connect');
  if (!btn) return;
  btn.addEventListener('click', function () {
    DEVICE.connected = !DEVICE.connected;
    updateDeviceChip();
    // 状态行即时联动（任务页）
    var line = document.querySelector('.mdw-config-status');
    if (line) line.textContent = deviceStatusText();
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

/* ===== Log Data (mock) ===== */
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
        '<div class="mdw-home-card-value">v6.17.5</div>' +
        '<button type="button" class="app-btn mdw-btn-primary mdw-home-card-btn">检查更新</button>' +
      '</div>' +
      '<div class="mdw-home-card">' +
        '<div class="mdw-home-card-label">资源版本</div>' +
        '<div class="mdw-home-card-value">月行水上 #0914</div>' +
        '<button type="button" class="app-btn mdw-btn-primary mdw-home-card-btn">检查更新</button>' +
      '</div>' +
      '<div class="mdw-home-card">' +
        '<div class="mdw-home-card-label">MAA For NAS</div>' +
        '<div class="mdw-home-card-value">0.5.0</div>' +
        '<button type="button" class="app-btn mdw-btn-primary mdw-home-card-btn">检查更新</button>' +
      '</div>' +
      '<div class="mdw-home-card mdw-home-nas">' +
        '<div class="mdw-home-card-label">NAS 运行情况</div>' +
        '<div class="mdw-nas-metrics">' +
          '<div class="mdw-nas-metric"><div class="mdw-nas-m-label">CPU 占用</div><div class="mdw-nas-m-value">23%</div><div class="mdw-nas-m-bar"><div style="width:23%"></div></div></div>' +
          '<div class="mdw-nas-metric"><div class="mdw-nas-m-label">内存占用</div><div class="mdw-nas-m-value">512 MB</div><div class="mdw-nas-m-bar"><div style="width:35%"></div></div></div>' +
          '<div class="mdw-nas-metric"><div class="mdw-nas-m-label">截图间隔</div><div class="mdw-nas-m-value">800 ms</div><div class="mdw-nas-m-bar"><div style="width:55%"></div></div></div>' +
          '<div class="mdw-nas-metric"><div class="mdw-nas-m-label">连接延迟</div><div class="mdw-nas-m-value">238 ms</div><div class="mdw-nas-m-bar"><div style="width:24%"></div></div></div>' +
          '<div class="mdw-nas-metric"><div class="mdw-nas-m-label">任务进度</div><div class="mdw-nas-m-value">3 / 5</div><div class="mdw-nas-m-bar"><div style="width:60%"></div></div></div>' +
          '<div class="mdw-nas-metric"><div class="mdw-nas-m-label">运行时间</div><div class="mdw-nas-m-value">01:23:45</div><div class="mdw-nas-m-bar"><div style="width:80%"></div></div></div>' +
        '</div>' +
      '</div>' +
      '<div class="mdw-home-card">' +
        '<div class="mdw-home-card-label">下次定时任务</div>' +
        '<div class="mdw-home-card-value mdw-home-accent">09:00</div>' +
        '<div class="mdw-home-card-sub">23 分钟后</div>' +
      '</div>' +
      '<div class="mdw-home-card">' +
        '<div class="mdw-home-card-label">当前任务</div>' +
        '<div class="mdw-home-card-value mdw-home-idle">' + (RUNNING ? '任务执行中…' : '牛牛还没开始任务哦') + '</div>' +
      '</div>' +
    '</div>';

  bindHomeActions(el);
}

function bindHomeActions(el) {
  function sync() {
    var st = el.querySelector('#home-state');
    var conn = el.querySelector('#home-connect');
    var run = el.querySelector('#home-run');
    if (st) st.textContent = (DEVICE.connected ? '已连接 ' + DEVICE.address : '未连接') + ' · ' + (RUNNING ? '运行中' : '空闲');
    if (conn) conn.textContent = DEVICE.connected ? '断开' : '连接设备';
    if (run) run.textContent = RUNNING ? '运行中…' : '开始一键长草';
  }
  var conn = el.querySelector('#home-connect');
  if (conn) conn.addEventListener('click', function () { DEVICE.connected = !DEVICE.connected; updateDeviceChip(); sync(); });
  var run = el.querySelector('#home-run');
  if (run) run.addEventListener('click', function () {
    if (!DEVICE.connected) { openInfoModal('无法开始', '请先连接设备'); return; }
    if (RUNNING) { openInfoModal('无法开始', '任务已在运行中'); return; }
    location.hash = '#/tasks';
  });
  var stop = el.querySelector('#home-stop');
  if (stop) stop.addEventListener('click', function () {
    if (!RUNNING) { openInfoModal('无法停止', '当前没有正在执行的任务'); return; }
    location.hash = '#/tasks';
  });
  sync();
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
    if (!RUNNING) {
      var checked = Array.from(taskList.querySelectorAll('.mdw-qi-check:checked')).map(function (c) { return c.dataset.task; });
      if (!checked.length) { openInfoModal('无法开始', '请先勾选要执行的任务'); return; }
      if (!DEVICE.connected) { openInfoModal('无法开始', '设备未连接：请先点击右上角「连接」'); return; }
      RUNNING = true;
      startBtn.textContent = '停止';
      startBtn.classList.add('mdw-btn-danger');
      var tl = el.querySelector('#timeline');
      if (tl) {
        var nameOf = function (id) { var t = TASKS.find(function (x) { return x.id === id; }); return t ? t.name : id; };
        var lines = [
          { t: nowTime(), msg: 'AsstAsyncConnect ' + DEVICE.address + ' 成功', src: 'runner', level: 'info' },
          { t: nowTime(), msg: 'AsstStart 已下发，任务队列开始执行', src: 'runner', level: 'info' }
        ].concat(checked.map(function (id) {
          return { t: nowTime(), msg: 'AsstAppendTask ' + nameOf(id), src: 'runner', level: 'info' };
        }));
        tl.insertAdjacentHTML('afterbegin', lines.reverse().map(function (e) {
          return '<div class="mdw-tl-item lv-' + e.level + '"><span class="mdw-tl-dot"></span><div class="mdw-tl-body">' +
            '<div class="mdw-tl-time">' + esc(e.t) + '</div><div class="mdw-tl-text">' + esc(e.msg) + '</div>' +
            '<div class="mdw-tl-src">' + esc(e.src) + '</div></div></div>';
        }).join(''));
      }
      runTimer = setInterval(function () {
        var t = el.querySelector('#timeline');
        if (t) t.insertAdjacentHTML('afterbegin',
          '<div class="mdw-tl-item lv-info"><span class="mdw-tl-dot"></span><div class="mdw-tl-body">' +
          '<div class="mdw-tl-time">' + nowTime() + '</div><div class="mdw-tl-text">任务执行中…（原型模拟心跳）</div>' +
          '<div class="mdw-tl-src">runner</div></div></div>');
      }, 5000);
      var line2 = document.querySelector('.mdw-config-status');
      if (line2) line2.textContent = deviceStatusText();
    } else {
      RUNNING = false;
      if (runTimer) { clearInterval(runTimer); runTimer = null; }
      startBtn.textContent = 'Link Start!';
      startBtn.classList.remove('mdw-btn-danger');
      var t2 = el.querySelector('#timeline');
      if (t2) t2.insertAdjacentHTML('afterbegin',
        '<div class="mdw-tl-item lv-warn"><span class="mdw-tl-dot"></span><div class="mdw-tl-body">' +
        '<div class="mdw-tl-time">' + nowTime() + '</div><div class="mdw-tl-text">AsstStop 已下发，队列停止</div>' +
        '<div class="mdw-tl-src">runner</div></div></div>');
      var line3 = document.querySelector('.mdw-config-status');
      if (line3) line3.textContent = deviceStatusText();
    }
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
    var rcModeArea = el.querySelector('#rc-mode-area');
    var rcTip = el.querySelector('#rc-tip');
    function updateRcMode() {
      var theme = rcTheme.value;
      var modes = MAA_DATA.reclamation.modes[theme] || [];
      if (theme === 'Fire') {
        if (rcModeArea) rcModeArea.innerHTML = '';
      } else if (rcModeArea) {
        rcModeArea.innerHTML = '<div class="mdw-row-label">模式</div>' + selectHtml(modes, modes[0][0], 'rc-mode');
      }
      var modeVal = modes[0] ? modes[0][0] : '';
      if (rcTip) rcTip.textContent = reclTipText(theme, modeVal);
      var modeSel = el.querySelector('#rc-mode');
      if (modeSel) modeSel.addEventListener('change', function () {
        if (rcTip) rcTip.textContent = reclTipText(theme, modeSel.value);
      });
    }
    updateRcMode();
    rcTheme.addEventListener('change', updateRcMode);
  }
  // 肉鸽：主题联动 难度/分队/职业组
  var rgTheme = el.querySelector('#rg-theme');
  if (rgTheme) {
    function updateRgTheme() {
      var th = rgTheme.value;
      var diff = el.querySelector('#rg-difficulty');
      var squad = el.querySelector('#rg-squad');
      var cls = el.querySelector('#rg-class');
      if (diff) {
        var d = rogueDifficultyList(th);
        diff.innerHTML = d.map(function (c) { return '<option value="' + esc(c[0]) + '">' + esc(c[1]) + '</option>'; }).join('');
        diff.value = '-1';
      }
      if (squad) {
        var sq = rogueSquadList(th);
        squad.innerHTML = sq.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
        squad.value = MAA_DATA.roguelike.defaultSquad;
      }
      if (cls) {
        var rl = rogueRoleList(th);
        cls.innerHTML = rl.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('');
        cls.value = MAA_DATA.roguelike.roles.defaultValue;
      }
      var core = el.querySelector('#rg-operator');
      if (core) {
        var cc = rogueCoreCharList(th);
        core.innerHTML = '<option value="">不选择</option>' +
          cc.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
        core.value = '';
      }
    }
    rgTheme.addEventListener('change', updateRgTheme);
  }
}

/* ===== Page: Schedule (定时执行) ===== */
var SCHEDULES = [
  { id: 1, enabled: true, time: '04:00', repeat: 'daily', tasks: '开始唤醒 + 理智作战 + 领取奖励' },
  { id: 2, enabled: false, time: '12:30', repeat: 'weekdays', tasks: '信用收支 + 自动公招' },
  { id: 3, enabled: true, time: '23:00', repeat: 'daily', tasks: '基建换班' }
];
var REPEATS = [['daily', '每天'], ['weekdays', '工作日'], ['weekends', '周末'], ['mon', '每周一'], ['tue', '每周二'], ['wed', '每周三'], ['thu', '每周四'], ['fri', '每周五'], ['sat', '每周六'], ['sun', '每周日']];

function nextRunText(repeat, time) {
  // 原型：只做文字示意，正式版由服务端调度器给出
  if (repeat === 'daily') return '明天 ' + time;
  if (repeat === 'weekdays') return '下个工作日 ' + time;
  if (repeat === 'weekends') return '下个周末 ' + time;
  return '下周 ' + time;
}

function pageSchedule(el) {
  el.innerHTML =
    '<h2 class="mdw-h1">日程</h2>' +
    '<div class="mdw-settings-group" style="max-width:760px">' +
      '<div class="mdw-settings-group-head">定时任务</div>' +
      '<div id="sched-list">' + renderScheduleList() + '</div>' +
      '<div class="mdw-sched-actions">' +
        '<button type="button" class="app-btn" id="sched-add">+ 添加定时任务</button>' +
        '<span class="mdw-muted">原型阶段：调度由服务端执行，此处仅管理计划。</span>' +
      '</div>' +
    '</div>';
  bindScheduleEvents(el);
}

function renderScheduleList() {
  if (!SCHEDULES.length) return '<div class="mdw-muted" style="padding:10px 0">暂无定时任务。</div>';
  return SCHEDULES.map(function (s) {
    return '<div class="mdw-sched-row" data-id="' + s.id + '">' +
      '<label class="app-switch"><input type="checkbox" class="app-checkbox sched-en" data-id="' + s.id + '"' + (s.enabled ? ' checked' : '') + '/><span class="app-switch-view"></span></label>' +
      '<input type="time" class="app-input-text mdw-sched-time sched-time" data-id="' + s.id + '" value="' + esc(s.time) + '"/>' +
      '<div class="app-select-menu mdw-sched-repeat"><select class="sched-repeat" data-id="' + s.id + '">' +
        REPEATS.map(function (r) { return '<option value="' + r[0] + '"' + (r[0] === s.repeat ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') +
      '</select></div>' +
      '<span class="mdw-sched-tasks">' + esc(s.tasks) + '</span>' +
      '<span class="mdw-muted mdw-sched-next">' + (s.enabled ? nextRunText(s.repeat, s.time) : '已停用') + '</span>' +
      '<button type="button" class="app-btn mdw-sched-del" data-id="' + s.id + '">删除</button>' +
    '</div>';
  }).join('');
}

function bindScheduleEvents(el) {
  function rerender() {
    var list = el.querySelector('#sched-list');
    if (list) list.innerHTML = renderScheduleList();
    bindScheduleEvents(el);
  }
  el.querySelectorAll('.sched-en').forEach(function (c) {
    c.addEventListener('change', function () {
      var s = SCHEDULES.find(function (x) { return x.id === +c.dataset.id; });
      if (s) s.enabled = c.checked;
      rerender();
    });
  });
  el.querySelectorAll('.sched-time').forEach(function (t) {
    t.addEventListener('change', function () {
      var s = SCHEDULES.find(function (x) { return x.id === +t.dataset.id; });
      if (s) s.time = t.value;
      rerender();
    });
  });
  el.querySelectorAll('.sched-repeat').forEach(function (t) {
    t.addEventListener('change', function () {
      var s = SCHEDULES.find(function (x) { return x.id === +t.dataset.id; });
      if (s) s.repeat = t.value;
      rerender();
    });
  });
  el.querySelectorAll('.mdw-sched-del').forEach(function (b) {
    b.addEventListener('click', function () {
      var s = SCHEDULES.find(function (x) { return x.id === +b.dataset.id; });
      if (!s) return;
      openConfirmModal('删除定时任务', '确定删除定时任务 ' + s.time + '（' + s.tasks + '）？', function () {
        SCHEDULES.splice(SCHEDULES.indexOf(s), 1);
        rerender();
      });
      return;
      SCHEDULES.splice(SCHEDULES.indexOf(s), 1);
      rerender();
    });
  });
  var add = el.querySelector('#sched-add');
  if (add) add.addEventListener('click', function () {
    openScheduleAddModal(function (picked) {
      SCHEDULES.push({ id: Date.now(), enabled: true, time: '08:00', repeat: 'daily', tasks: picked.map(function (t) { return t[1]; }).join(' + ') });
      rerender();
    });
  });
}

/* ===== Page: Logs ===== */
var LOG_FILTER = 'all';
var FULL_LOGS = LOGS.concat([
  { t: '14:33:02', msg: '基建换班 · 进入宿舍 01', src: 'MaaCore', level: 'info' },
  { t: '14:34:11', msg: '干员 心情低于阈值，触发换班', src: 'MaaCore', level: 'warn' },
  { t: '14:35:40', msg: 'AsstStop 已下发，队列停止', src: 'runner', level: 'info' },
  { t: '14:36:02', msg: 'ADB 连接超时 (5000ms)，重试 1/3', src: 'runner', level: 'error' },
  { t: '14:36:09', msg: 'ADB 连接成功', src: 'runner', level: 'info' },
  { t: '14:37:22', msg: '识别 理智 72/130', src: 'MaaCore', level: 'debug' },
  { t: '14:38:00', msg: '代理倍率 3 → 1（理智不足）', src: 'MaaCore', level: 'warn' }
]);

function pageLogs(el) {
  el.innerHTML =
    '<h2 class="mdw-h1">日志</h2>' +
    '<div class="mdw-log-toolbar">' +
      '<div class="app-select-menu"><select id="log-level">' +
        [['all', '全部级别'], ['info', '信息'], ['warn', '警告'], ['error', '错误'], ['debug', '调试']].map(function (l) {
          return '<option value="' + l[0] + '"' + (l[0] === LOG_FILTER ? ' selected' : '') + '>' + l[1] + '</option>';
        }).join('') +
      '</select></div>' +
      '<button type="button" class="app-btn" id="log-copy">复制日志</button>' +
      '<span class="mdw-muted">共 ' + FULL_LOGS.length + ' 条（原型静态数据，正式版由 /api/logs 提供）</span>' +
    '</div>' +
    '<pre class="mdw-logpage" id="log-view">' + renderFullLogs() + '</pre>';

  el.querySelector('#log-level').addEventListener('change', function () {
    LOG_FILTER = this.value;
    el.querySelector('#log-view').innerHTML = renderFullLogs();
  });
  el.querySelector('#log-copy').addEventListener('click', function () {
    this.textContent = '已复制';
    var b = this;
    setTimeout(function () { b.textContent = '复制日志'; }, 1200);
  });
}

function renderFullLogs() {
  return esc(FULL_LOGS.filter(function (e) {
    return LOG_FILTER === 'all' || e.level === LOG_FILTER;
  }).map(function (e) {
    return e.t + ' [' + e.level.toUpperCase() + '] ' + e.msg + '  (' + e.src + ')';
  }).join('\n'));
}

/* ===== Page: Copilot ===== */
function pageCopilot(el) {
  el.innerHTML =
    '<h2 class="mdw-h1">自动战斗</h2>' +
    '<div class="mdw-copilot-tabs">' +
      '<div class="mdw-copilot-tab active">主线 / 故事集 / SideStory</div>' +
      '<div class="mdw-copilot-tab">保全派驻</div>' +
      '<div class="mdw-copilot-tab">悖论模拟</div>' +
      '<div class="mdw-copilot-tab">其他活动</div>' +
    '</div>' +
    '<div class="mdw-copilot-body">' +
      '<div class="mdw-copilot-left">' +
        '<div class="mdw-row block"><div class="mdw-row-label">作业搜索</div>' + textHtml('cp-search', '', '按关卡名 / 作者搜索（正式版走 MAA 作业站）') + '</div>' +
        '<div class="mdw-row block"><div class="mdw-row-label">作业路径</div>' + selectHtml([['', '选择作业文件...'], ['copilot1', '作业 1'], ['copilot2', '作业 2']], '', 'cp-path') + '</div>' +
        blockHtml('循环次数', numHtml('cp-loop', 1, 1, 999), '重复执行作业的次数。') +
        blockHtml('编队预设', selectHtml([['1', '1 号编队'], ['2', '2 号编队'], ['3', '3 号编队'], ['4', '4 号编队']], '1', 'cp-squad')) +
        '<button type="button" class="app-btn mdw-btn-primary" style="height:40px;font-size:15px;width:100%;justify-content:center;border-radius:4px">开始</button>' +
        '<label class="mdw-check"><input type="checkbox" class="app-checkbox" id="cp-auto-formation"/><span>自动编队</span></label>' +
        '<label class="mdw-check"><input type="checkbox" class="app-checkbox" id="cp-assist"/><span>使用助战干员</span></label>' +
        '<label class="mdw-check"><input type="checkbox" class="app-checkbox" id="cp-multi-mode"/><span>多作业模式</span></label>' +
        '<a href="#" class="mdw-muted" style="font-size:13px">自动战斗作业分享</a>' +
      '</div>' +
      '<div class="mdw-copilot-right">' +
        '<div class="mdw-copilot-warn">请先选择作业文件并确认编队后再开始执行。作业文件中干员名需与游戏内一致。</div>' +
        '<div class="mdw-copilot-log-group">' +
          '<div class="head">编队确认</div>' +
          '<div class="mdw-copilot-log-item"><span class="mdw-copilot-log-time">14:32:01</span><span>识别作业干员列表...</span></div>' +
          '<div class="mdw-copilot-log-item"><span class="mdw-copilot-log-time">14:32:03</span><span>编队完成：银灰、艾雅法拉、闪灵</span></div>' +
          '<div class="mdw-copilot-log-cost">耗时 2.3s</div>' +
        '</div>' +
        '<div class="mdw-copilot-log-group">' +
          '<div class="head">战斗执行</div>' +
          '<div class="mdw-copilot-log-item"><span class="mdw-copilot-log-time">14:32:05</span><span>部署 银灰 @ (3,2)</span></div>' +
          '<div class="mdw-copilot-log-item"><span class="mdw-copilot-log-time">14:32:08</span><span>部署 艾雅法拉 @ (4,3)</span></div>' +
          '<div class="mdw-copilot-log-item"><span class="mdw-copilot-log-time">14:32:12</span><span>部署 闪灵 @ (5,2)</span></div>' +
          '<div class="mdw-copilot-log-item"><span class="mdw-copilot-log-time">14:32:20</span><span>技能释放：银灰 (3,2)</span></div>' +
          '<div class="mdw-copilot-log-item"><span class="mdw-copilot-log-time">14:32:35</span><span>战斗结束 · 胜利</span></div>' +
          '<div class="mdw-copilot-log-cost">耗时 30.2s</div>' +
        '</div>' +
        '<a href="#" class="mdw-muted" style="font-size:13px">自动战斗地图坐标</a>' +
      '</div>' +
    '</div>';

  el.querySelectorAll('.mdw-copilot-tab').forEach(function (t) {
    t.addEventListener('click', function () {
      el.querySelectorAll('.mdw-copilot-tab').forEach(function (x) { x.classList.toggle('active', x === t); });
    });
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

function bindSettingsEvents(el) {
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
      settingsRow('连接地址', '设备/模拟器的 ADB 端口', '<input type="text" class="app-input-text" value="192.168.31.190:5555" placeholder="192.168.31.190:5555"/>') +
      settingsRow('ADB 路径', '留空使用容器内 /usr/bin/adb', '<input type="text" class="app-input-text" value="" placeholder="/usr/bin/adb"/>') +
      settingsRow('连接配置', 'MAA Core 内置识别与截图策略', selectHtml(CONN_CONFIGS, 'General')) +
      settingsRow('触控模式', '实例级参数', selectHtml(TOUCH_MODES, 'minitouch')) +
      settingsRow('客户端类型', '与当前账号和资源包保持一致', selectHtml(CLIENTS, 'Official')) +
      '<div class="mdw-settings-row"><div><div class="mdw-settings-label">连接测试</div><div class="mdw-settings-desc">加载资源并尝试连接设备</div></div><div class="mdw-settings-ctl"><button type="button" class="app-btn">测试连接</button></div></div>' +
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

window.addEventListener('hashchange', route);
route();
