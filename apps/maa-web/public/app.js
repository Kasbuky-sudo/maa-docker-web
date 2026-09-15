/* MAA Docker Web — SPA (hash router + REST + WebSocket)
   UI rules: only windows-ui components (app-checkbox/app-switch/app-select-menu/
   app-input-text/app-accordion/app-alert-bar/app-table-view/app-btn). */
'use strict';

const $page = document.getElementById('page');
const api = {
  async get(p) { const r = await fetch(p); if (!r.ok) throw new Error((await r.json()).error || r.status); return r.json(); },
  async send(p, method, body) {
    const r = await fetch(p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    return j;
  },
};

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function pill(status) {
  const cls = status === 'ready' || status === 'healthy' ? 'ok' : status === 'error' ? 'bad' : '';
  return `<span class="mdw-pill ${cls}">${esc(status)}</span>`;
}
function bytes(n) {
  if (!n && n !== 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${u[i]}`;
}
function alertBar(kind, msg, id) {
  return `<div class="app-alert-bar ${kind}" ${id ? `id="${id}"` : ''}><span>${esc(msg)}</span></div>`;
}
// windows-ui accordion: header toggles aria-expanded + panel.show
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
function switchCtl(id, checked, on = '开启', off = '关闭') {
  return `<label class="app-switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}/><span class="app-switch-view"></span><span class="app-switch-label" data-on="${on}" data-off="${off}"></span></label>`;
}

// ----------------------------------------------------------- 任务页（MAA 主界面）
let CATALOG = null;
let TCONF = {};       // { taskId: { optId: value } }
let SELECTED = null;  // selected task id
let saveTimer = null;

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

function optionRow(task, opt) {
  const val = optsFor(task.id)[opt.id];
  const id = `opt-${task.id}-${opt.id}`;
  let ctl = '';
  if (opt.type === 'switch') {
    ctl = switchCtl(id, !!val);
  } else if (opt.type === 'select') {
    const choices = opt.choices || CATALOG[opt.choicesFrom] || [];
    ctl = `<div class="app-select-menu mdw-fill"><select id="${id}">${choices.map((c) =>
      `<option value="${esc(String(c.value))}" ${String(c.value) === String(val) ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>`;
  } else if (opt.type === 'counter') {
    ctl = `<div class="mdw-stepper"><button type="button" class="app-btn mdw-step" data-step="-1">−</button>
      <input type="number" class="app-input-text" id="${id}" value="${esc(String(val))}" min="${opt.min ?? 0}" max="${opt.max ?? 9999}"/>
      <button type="button" class="app-btn mdw-step" data-step="1">＋</button></div>`;
  } else if (opt.type === 'multi') {
    const arr = Array.isArray(val) ? val : [];
    ctl = `<div class="mdw-multi">${(opt.choices || []).map((c) =>
      `<label class="mdw-check"><input type="checkbox" class="app-checkbox mdw-multi-item" data-opt="${id}" data-val="${esc(String(c.value))}" ${arr.map(String).includes(String(c.value)) ? 'checked' : ''}/><span>${esc(c.label)}</span></label>`).join('')}</div>`;
  } else { // text
    ctl = `<input type="text" class="app-input-text mdw-fill" id="${id}" value="${esc(val ?? '')}" placeholder="${esc(opt.placeholder || '')}"/>`;
  }
  return `<div class="mdw-opt-row">
    <div class="mdw-opt-label">${esc(opt.label)}</div>
    <div class="mdw-opt-ctl">${ctl}</div>
    ${opt.help ? `<div class="mdw-opt-help">${esc(opt.help)}</div>` : ''}
  </div>`;
}

function readOptInto(task, opt, value) {
  TCONF[task.id] = TCONF[task.id] || {};
  TCONF[task.id][opt.id] = value;
}

function renderTaskDetail(el) {
  const detail = el.querySelector('#task-detail');
  const task = CATALOG.tasks.find((x) => x.id === SELECTED);
  if (!task) { detail.innerHTML = '<p class="mdw-muted">在左侧选择一个任务查看选项。</p>'; return; }
  detail.innerHTML = `
    <h3 class="mdw-task-name">${esc(task.name)}</h3>
    <p class="mdw-muted">${esc(task.description || '')}</p>
    <div class="mdw-opts">${(task.options || []).map((o) => optionRow(task, o)).join('')}</div>`;
  // bind controls -> state
  for (const opt of task.options || []) {
    const id = `opt-${task.id}-${opt.id}`;
    const node = detail.querySelector(`#${id}`);
    if (!node) continue;
    if (opt.type === 'switch') {
      node.addEventListener('change', () => { readOptInto(task, opt, node.checked); saveTasksConfig(); });
    } else if (opt.type === 'select') {
      node.addEventListener('change', () => {
        const raw = node.value;
        const match = (opt.choices || CATALOG[opt.choicesFrom] || []).find((c) => String(c.value) === raw);
        readOptInto(task, opt, match ? match.value : raw);
        saveTasksConfig();
      });
    } else if (opt.type === 'counter') {
      node.addEventListener('change', () => { readOptInto(task, opt, Number(node.value) || 0); saveTasksConfig(); });
      detail.querySelectorAll(`.mdw-step[data-for="${id}"]`).forEach((b) => {});
    } else if (opt.type === 'text') {
      node.addEventListener('input', () => { readOptInto(task, opt, node.value); saveTasksConfig(); });
    } else if (opt.type === 'multi') {
      detail.querySelectorAll(`.mdw-multi-item[data-opt="${id}"]`).forEach((cb) => {
        cb.addEventListener('change', () => {
          const cur = new Set((optsFor(task.id)[opt.id] || []).map(String));
          if (cb.checked) cur.add(cb.dataset.val); else cur.delete(cb.dataset.val);
          const match = (opt.choices || []).filter((c) => cur.has(String(c.value))).map((c) => c.value);
          readOptInto(task, opt, match);
          saveTasksConfig();
        });
      });
    }
  }
  // steppers
  detail.querySelectorAll('.mdw-step').forEach((b) => {
    b.addEventListener('click', () => {
      const input = b.parentElement.querySelector('input');
      const opt = (task.options || []).find((o) => `opt-${task.id}-${o.id}` === input.id);
      const step = Number(b.dataset.step);
      let v = (Number(input.value) || 0) + step;
      if (opt) { if (opt.min != null) v = Math.max(opt.min, v); if (opt.max != null) v = Math.min(opt.max, v); }
      input.value = v;
      readOptInto(task, opt, v);
      saveTasksConfig();
    });
  });
}

let runPoll = null;
function pollRunStatus(out) {
  clearInterval(runPoll);
  const tick = async () => {
    let st;
    try { st = await api.get('/api/runner/status'); } catch { clearInterval(runPoll); return; }
    if (st.phase === 'idle' || st.phase === 'done' || st.phase === 'error') {
      clearInterval(runPoll);
      const kind = st.phase === 'error' ? 'alert-bar-danger' : 'alert-bar-success';
      if (st.phase !== 'idle') out.innerHTML = alertBar(kind, `执行结束：${st.detail || st.phase}`);
      return;
    }
    out.innerHTML = `<div class="mdw-hstack">
      <div class="app-progress-container mdw-progress-fit"><div class="app-progress-bar"><span class="indeterminate"></span></div></div>
      <span class="mdw-muted">${esc(st.detail || st.phase)} · MAA ${esc(st.maaVersion || '')}</span>
      <button type="button" class="app-btn" id="btn-stoprun">停止</button></div>`;
    out.querySelector('#btn-stoprun').onclick = async () => {
      try { await api.send('/api/runner/stop', 'POST'); } catch { /* ignore */ }
    };
  };
  tick();
  runPoll = setInterval(tick, 2500);
}

async function pageTasks(el) {
  if (!CATALOG) {
    const [catalog, saved] = await Promise.all([api.get('/api/tasks/catalog'), api.get('/api/tasks/config')]);
    CATALOG = catalog;
    TCONF = saved.config || {};
  }
  el.innerHTML = `
    <h2 class="mdw-title">任务</h2>
    <div class="mdw-task-layout">
      <div class="mdw-task-list" id="task-list">
        <div class="mdw-task-list-head">任务列表</div>
        ${CATALOG.tasks.map((t) => `
          <label class="mdw-task-item" data-task="${t.id}">
            <input type="checkbox" class="app-checkbox mdw-task-check" data-task="${t.id}"/>
            <span class="mdw-task-name-sm">${esc(t.name)}</span>
          </label>`).join('')}
        <div class="mdw-savebar"><span id="save-ind" class="mdw-muted"></span></div>
      </div>
      <div class="mdw-task-detail" id="task-detail"></div>
    </div>
    <div class="mdw-action-bar">
      <button type="button" class="app-btn mdw-btn-primary" id="btn-run">开始行动</button>
      <span class="mdw-muted" id="run-count">已勾选 0 项任务</span>
      <div id="run-result"></div>
    </div>`;

  const updateCount = () => {
    const n = el.querySelectorAll('.mdw-task-check:checked').length;
    el.querySelector('#run-count').textContent = `已勾选 ${n} 项任务`;
  };
  el.querySelectorAll('.mdw-task-item').forEach((item) => {
    item.addEventListener('click', (ev) => {
      if (ev.target.classList.contains('mdw-task-check')) return; // checkbox handled separately
      SELECTED = item.dataset.task;
      el.querySelectorAll('.mdw-task-item').forEach((i) => i.classList.toggle('selected', i.dataset.task === SELECTED));
      renderTaskDetail(el);
    });
  });
  el.querySelectorAll('.mdw-task-check').forEach((cb) => {
    cb.addEventListener('click', (ev) => ev.stopPropagation());
    cb.addEventListener('change', updateCount);
  });
  el.querySelector('#btn-run').addEventListener('click', async () => {
    const ids = [...el.querySelectorAll('.mdw-task-check:checked')].map((c) => c.dataset.task);
    const out = el.querySelector('#run-result');
    if (!ids.length) { out.innerHTML = alertBar('alert-bar-secondary', '请先勾选要执行的任务'); return; }
    out.innerHTML = `<div class="app-progress-container mdw-progress-fit"><div class="app-progress-bar"><span class="indeterminate"></span></div></div>`;
    try {
      await api.send('/api/tasks/execute', 'POST', { tasks: ids });
      pollRunStatus(out);
    } catch (e) {
      out.innerHTML = alertBar('alert-bar-danger', e.message);
    }
  });

  SELECTED = CATALOG.tasks[0] && CATALOG.tasks[0].id;
  if (SELECTED) el.querySelector(`.mdw-task-item[data-task="${SELECTED}"]`)?.classList.add('selected');
  renderTaskDetail(el);
  updateCount();
}

// ----------------------------------------------------------- 日程页
async function pageSchedule(el) {
  if (!CATALOG) CATALOG = await api.get('/api/tasks/catalog');
  const { schedule } = await api.get('/api/tasks/schedule');
  let rows = schedule.slice();
  el.innerHTML = `
    <h2 class="mdw-title">日程 · 定时执行</h2>
    <p class="mdw-muted">到达设定时间后自动执行勾选的任务（由服务端调度）。</p>
    <div class="mdw-hstack">
      <input type="time" class="app-input-text" id="s-time" value="04:00"/>
      <div class="app-select-menu"><select id="s-task">${CATALOG.tasks.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></div>
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
    const exist = rows.find((r) => r.time === el.querySelector('#s-time').value);
    if (exist) { if (!exist.tasks.includes(t)) exist.tasks.push(t); }
    else rows.push({ time: el.querySelector('#s-time').value || '04:00', enabled: true, tasks: [t] });
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

// ----------------------------------------------------------- 设置页（MAA 分组手风琴）
async function pageSettings(el) {
  if (!CATALOG) CATALOG = await api.get('/api/tasks/catalog');
  const [cfg, conn] = await Promise.all([api.get('/api/config'), api.get('/api/connection')]);
  const client = conn.connection.clientType || CATALOG.clients[0].value;
  el.innerHTML = `
    <h2 class="mdw-title">设置</h2>
    ${accordion('常规设置', `
      <div class="mdw-opt-row"><div class="mdw-opt-label">客户端类型</div>
        <div class="mdw-opt-ctl"><div class="app-select-menu mdw-fill"><select id="st-client">
          ${CATALOG.clients.map((c) => `<option value="${c.value}" ${c.value === client ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
        </select></div></div></div>
      <div class="mdw-actions"><button type="button" class="app-btn mdw-btn-primary" id="st-save1">保存</button><span id="st-msg1" class="mdw-muted"></span></div>`, true)}
    ${accordion('连接设置', `
      <div class="mdw-opt-row"><div class="mdw-opt-label">连接地址</div>
        <div class="mdw-opt-ctl"><input type="text" class="app-input-text mdw-fill" id="st-addr" value="${esc(conn.connection.address || '')}" placeholder="ADB 地址，如 192.168.31.190:5555"/></div>
        <div class="mdw-opt-help">填红石/模拟器所在设备的 ADB 端口。MAA 执行管线（M2）将使用此地址连接设备。</div></div>
      <div class="mdw-actions"><button type="button" class="app-btn mdw-btn-primary" id="st-save2">保存</button><span id="st-msg2" class="mdw-muted"></span></div>`, true)}
    ${accordion('启动设置', `
      <div class="mdw-opt-row"><div class="mdw-opt-label">自动下载 Runtime</div>
        <div class="mdw-opt-ctl">${switchCtl('st-auto', !!cfg.autoFetchRuntime)}</div>
        <div class="mdw-opt-help">服务启动时若数据卷中没有 MAA 运行包，自动从官方 Release 下载。</div></div>
      <div class="mdw-actions"><button type="button" class="app-btn mdw-btn-primary" id="st-save3">保存</button><span id="st-msg3" class="mdw-muted"></span></div>`, false)}
    ${accordion('服务设置', `
      <div class="mdw-opt-row"><div class="mdw-opt-label">服务名称</div>
        <div class="mdw-opt-ctl"><input type="text" class="app-input-text mdw-fill" id="st-name" value="${esc(cfg.serverName)}"/></div></div>
      <div class="mdw-opt-row"><div class="mdw-opt-label">日志等级</div>
        <div class="mdw-opt-ctl"><div class="app-select-menu mdw-fill"><select id="st-level">
          ${['debug', 'info', 'warn', 'error'].map((l) => `<option ${l === cfg.logLevel ? 'selected' : ''}>${l}</option>`).join('')}
        </select></div></div></div>
      <div class="mdw-opt-row"><div class="mdw-opt-label">时区</div>
        <div class="mdw-opt-ctl"><input type="text" class="app-input-text mdw-fill" id="st-tz" value="${esc(cfg.timezone)}"/></div></div>
      <div class="mdw-actions"><button type="button" class="app-btn mdw-btn-primary" id="st-save4">保存</button><span id="st-msg4" class="mdw-muted"></span></div>`, false)}`;
  bindAccordions(el);
  el.querySelector('#st-save1').addEventListener('click', async () => {
    try {
      await api.send('/api/connection', 'PUT', Object.assign({}, conn.connection, { clientType: el.querySelector('#st-client').value }));
      el.querySelector('#st-msg1').textContent = '已保存 ✔';
    } catch (e) { el.querySelector('#st-msg1').textContent = e.message; }
  });
  el.querySelector('#st-save2').addEventListener('click', async () => {
    try {
      await api.send('/api/connection', 'PUT', Object.assign({}, conn.connection, { address: el.querySelector('#st-addr').value.trim() }));
      el.querySelector('#st-msg2').textContent = '已保存 ✔';
    } catch (e) { el.querySelector('#st-msg2').textContent = e.message; }
  });
  el.querySelector('#st-save3').addEventListener('click', async () => {
    try {
      await api.send('/api/config', 'PUT', { autoFetchRuntime: el.querySelector('#st-auto').checked });
      el.querySelector('#st-msg3').textContent = '已保存 ✔';
    } catch (e) { el.querySelector('#st-msg3').textContent = e.message; }
  });
  el.querySelector('#st-save4').addEventListener('click', async () => {
    try {
      await api.send('/api/config', 'PUT', { serverName: el.querySelector('#st-name').value, logLevel: el.querySelector('#st-level').value, timezone: el.querySelector('#st-tz').value });
      el.querySelector('#st-msg4').textContent = '已保存 ✔';
    } catch (e) { el.querySelector('#st-msg4').textContent = e.message; }
  });
}

// ----------------------------------------------------------- 功能对照页
async function pageFeatures(el) {
  const data = await api.get('/api/features/parity');
  const badge = { full: ['ok', '已实现'], partial: ['warn', '部分'], none: ['bad', '未实现'], na: ['', '不适用'] };
  const count = { full: 0, partial: 0, none: 0, na: 0 };
  for (const s of data.sections) for (const it of s.items) count[it.status]++;
  el.innerHTML = `
    <h2 class="mdw-title">功能对照 · MAA 桌面端 vs 本 Web</h2>
    <p class="mdw-muted">对照基准：${esc(data.upstream)}。数据由服务端 feature-parity.json 驱动，随开发更新。</p>
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
      <h2 class="mdw-title">MAA Runtime</h2>
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
    <h2 class="mdw-title">日志</h2>
    <div class="mdw-toolbar">
      <div class="app-select-menu"><select id="lv"><option value="">全部等级</option><option>debug</option><option>info</option><option>warn</option><option>error</option></select></div>
      <input type="text" class="app-input-text" id="q" placeholder="搜索关键字"/>
      <label class="mdw-check"><input type="checkbox" class="app-checkbox" id="follow" checked/><span>自动滚动</span></label>
      <a id="dl" class="app-btn" href="/api/logs/download" target="_blank">下载日志</a>
    </div>
    <div class="mdw-log" id="logbox"></div>`;
  const box = el.querySelector('#logbox');
  let entries = (await api.get('/api/logs')).entries;
  const renderLog = () => {
    const lv = el.querySelector('#lv').value;
    const q = el.querySelector('#q').value.toLowerCase();
    const html = entries
      .filter((e) => (!lv || e.level === lv) && (!q || e.message.toLowerCase().includes(q)))
      .map((e) => `<div class="lv-${e.level}">[${esc(e.timestamp)}] [${e.level.toUpperCase()}] [${esc(e.source)}] ${esc(e.message)}</div>`)
      .join('');
    const stick = el.querySelector('#follow').checked && box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    box.innerHTML = html || '<div class="mdw-muted">（暂无日志）</div>';
    if (stick) box.scrollTop = box.scrollHeight;
  };
  renderLog();
  el.querySelector('#lv').onchange = renderLog;
  el.querySelector('#q').oninput = renderLog;

  let ws = null;
  let retry = 0;
  const connect = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/api/ws`);
    ws.onmessage = (ev) => {
      try {
        const entry = JSON.parse(ev.data);
        if (entry.type === 'log') { entries.push(entry); if (entries.length > 2000) entries.shift(); renderLog(); }
      } catch { /* ignore */ }
    };
    ws.onclose = () => { retry = Math.min(retry + 1, 6); setTimeout(connect, 1000 * 2 ** retry); };
    ws.onopen = () => { retry = 0; };
  };
  connect();
  pages._logsWs = ws;
}

async function pageAbout(el) {
  const [version, system] = await Promise.all([api.get('/api/version'), api.get('/api/system/info')]);
  el.innerHTML = `
    <h2 class="mdw-title">关于</h2>
    <div class="mdw-list">
      <p><b>MAA Docker Web</b> v${esc(version.serviceVersion)} — 将 MAA 官方 Linux 运行包封装为可在 x86_64 / arm64 Docker 上运行的 Web 管理服务。</p>
      <p><b>MAA 版本</b>: ${esc(version.maaVersion)}</p>
      <p><b>上游项目</b>: <a href="https://github.com/MaaAssistantArknights/MaaAssistantArknights" target="_blank">MaaAssistantArknights</a>（AGPL-3.0，运行时从官方 Release 下载，本仓库不分发其二进制）</p>
      <p><b>前端组件</b>: <a href="https://github.com/virtualvivek/windows-ui" target="_blank">windows-ui</a> v4.0.2（MIT）</p>
      <p><b>本机架构</b>: ${esc(system.architecture)}</p>
      <p><b>许可</b>: 本项目代码以 MIT 许可发布，详见仓库 LICENSE 与 NOTICE。</p>
    </div>`;
}

// sidebar: follow the official windows-ui spec — the navbar toggler toggles
// .collapsed (icon rail) on desktop / .collapsed-float (overlay) on mobile.
// We only persist the official class across reloads.
(function () {
  const wrap = document.getElementById('NavBarMain');
  if (!wrap) return;
  try { if (localStorage.getItem('mdw-nav') === 'collapsed') wrap.classList.add('collapsed'); } catch { /* private mode */ }
  new MutationObserver(() => {
    try { localStorage.setItem('mdw-nav', wrap.classList.contains('collapsed') ? 'collapsed' : 'open'); } catch { /* ignore */ }
  }).observe(wrap, { attributes: true, attributeFilter: ['class'] });
})();

// ----------------------------------------------------------- router
const pages = {
  tasks: pageTasks, schedule: pageSchedule, settings: pageSettings, features: pageFeatures,
  runtime: pageRuntime, logs: pageLogs, about: pageAbout,
};

async function route() {
  if (pages._logsWs) { try { pages._logsWs.close(); } catch { /* ignore */ } pages._logsWs = null; }
  const hash = location.hash || '#/tasks';
  const name = hash.replace('#/', '').split('?')[0] || 'tasks';
  const links = document.querySelectorAll('#app-navbar-list a');
  links.forEach((a) => {
    a.className = a.getAttribute('href') === `#/${name}` ? 'active' : 'unactive';
  });
  try {
    await (pages[name] || pages.tasks)($page);
  } catch (e) {
    $page.innerHTML = `<h2 class="mdw-title">出错</h2><p class="mdw-error">${esc(e.message)}</p><button class="app-btn" onclick="route()">重试</button>`;
  }
}
window.route = route;
window.addEventListener('hashchange', route);
route();
