/* MAA Docker Web — SPA logic (hash router + REST + WebSocket) */
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

// ----------------------------------------------------------- pages
const pages = {
  async dashboard(el) {
    el.innerHTML = '<h2 class="mdw-title">总览</h2><p class="mdw-muted">加载中…</p>';
    const [health, version, system, runtime] = await Promise.all([
      api.get('/api/health'), api.get('/api/version'), api.get('/api/system/info'), api.get('/api/runtime/status'),
    ]);
    el.innerHTML = `
      <h2 class="mdw-title">总览</h2>
      <div class="mdw-cards">
        <div class="mdw-card"><h3>服务状态</h3><div class="mdw-value">${pill(health.status)}</div><p class="mdw-muted">运行 ${Math.floor(health.uptimeSeconds / 60)} 分钟</p></div>
        <div class="mdw-card"><h3>MAA 版本</h3><div class="mdw-value">${esc(version.maaVersion)}</div><p class="mdw-muted">服务 v${esc(version.serviceVersion)}</p></div>
        <div class="mdw-card"><h3>架构</h3><div class="mdw-value">${esc(system.architecture)}</div><p class="mdw-muted">${esc(system.platform)}</p></div>
        <div class="mdw-card"><h3>Runtime</h3><div class="mdw-value">${pill(runtime.status)}</div><p class="mdw-muted">${esc(runtime.asset)}</p></div>
        <div class="mdw-card"><h3>内存</h3><div class="mdw-value">${bytes(system.totalMemoryBytes - system.freeMemoryBytes)}</div><p class="mdw-muted">共 ${bytes(system.totalMemoryBytes)}</p></div>
        <div class="mdw-card"><h3>CPU</h3><div class="mdw-value">${system.cpus} 核</div><p class="mdw-muted">${esc(system.hostname)}</p></div>
      </div>
      <div class="mdw-actions">
        <button class="btn btn-primary" onclick="location.hash = '#/runtime'">打开 Runtime 管理</button>
      </div>`;
  },

  async runtime(el) {
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
          <button id="btn-fetch" class="btn btn-primary" ${rt.busy ? 'disabled' : ''}>下载 / 更新运行包</button>
          <button id="btn-verify" class="btn" ${rt.status !== 'ready' ? 'disabled' : ''}>校验完整性</button>
          <button id="btn-resinfo" class="btn" ${rt.status !== 'ready' ? 'disabled' : ''}>资源目录信息</button>
        </div>
        <div id="rt-result" style="margin-top:16px"></div>`;
      el.querySelector('#btn-fetch').onclick = async () => {
        try { await api.send('/api/runtime/fetch', 'POST'); poll(); }
        catch (e) { el.querySelector('#rt-result').innerHTML = `<p class="mdw-error">${esc(e.message)}</p>`; }
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
  },

  async config(el) {
    const cfg = await api.get('/api/config');
    el.innerHTML = `
      <h2 class="mdw-title">配置</h2>
      <div class="mdw-form">
        <label>服务名称</label>
        <input type="text" id="f-name" value="${esc(cfg.serverName)}"/>
        <label>日志等级</label>
        <select id="f-level">
          ${['debug', 'info', 'warn', 'error'].map((l) => `<option ${l === cfg.logLevel ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <label>时区</label>
        <input type="text" id="f-tz" value="${esc(cfg.timezone)}"/>
        <label><input type="checkbox" id="f-auto" ${cfg.autoFetchRuntime ? 'checked' : ''}/> 启动时自动下载 Runtime</label>
        <div class="mdw-actions">
          <button id="btn-save" class="btn btn-primary">保存</button>
          <span id="cfg-msg" class="mdw-muted"></span>
        </div>
        <p class="mdw-error" id="cfg-err"></p>
      </div>`;
    el.querySelector('#btn-save').onclick = async () => {
      const body = {
        serverName: el.querySelector('#f-name').value,
        logLevel: el.querySelector('#f-level').value,
        timezone: el.querySelector('#f-tz').value,
        autoFetchRuntime: el.querySelector('#f-auto').checked,
      };
      try {
        await api.send('/api/config', 'PUT', body);
        el.querySelector('#cfg-msg').textContent = '已保存 ✔';
        el.querySelector('#cfg-err').textContent = '';
      } catch (e) {
        el.querySelector('#cfg-err').textContent = e.message;
        el.querySelector('#cfg-msg').textContent = '';
      }
    };
  },

  async logs(el) {
    el.innerHTML = `
      <h2 class="mdw-title">日志</h2>
      <div class="mdw-toolbar">
        <select id="lv">
          <option value="">全部等级</option><option>debug</option><option>info</option><option>warn</option><option>error</option>
        </select>
        <input type="text" id="q" placeholder="搜索关键字"/>
        <label><input type="checkbox" id="follow" checked/> 自动滚动</label>
        <a id="dl" class="btn" href="/api/logs/download" target="_blank">下载日志</a>
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
  },

  async about(el) {
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
  },
};

// ----------------------------------------------------------- router
async function route() {
  if (pages._logsWs) { try { pages._logsWs.close(); } catch { /* ignore */ } pages._logsWs = null; }
  const hash = location.hash || '#/';
  const name = hash.replace('#/', '').split('?')[0] || 'dashboard';
  const links = document.querySelectorAll('#app-navbar-list a');
  links.forEach((a) => {
    a.className = a.getAttribute('href') === `#/${name === 'dashboard' ? '' : name}` || (name === 'dashboard' && a.getAttribute('href') === '#/') ? 'active' : 'unactive';
  });
  try {
    await (pages[name] || pages.dashboard)($page);
  } catch (e) {
    $page.innerHTML = `<h2 class="mdw-title">出错</h2><p class="mdw-error">${esc(e.message)}</p><button class="btn" onclick="route()">重试</button>`;
  }
}
window.route = route;
window.addEventListener('hashchange', route);
route();
