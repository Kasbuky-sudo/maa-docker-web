# 前端 ↔ 后端接入说明（给 ZCode / 执行 Agent）

> 状态：`apps/maa-web/public` 已经是新界面（v0.5.0），但**一行业务代码都没接后端**，
> 页面上的数据全是 `app.js` 里的 mock 常量。本文件就是接入任务书。

## 1. 仓库结构

```
apps/maa-server/           Node 22 + ws，零框架 HTTP 服务（默认 8080，生产由 nginx 反代）
  src/index.js             路由表 routes{} + 静态托管 + /api/ws 日志推送
  src/runner.js            MaaCore 执行管线（koffi FFI 绑 libMaaCore.so）
  src/runtime.js           官方 MAA 运行包下载/校验/解压
  src/config.js            config.json 读写（白名单字段）
  src/task-catalog.json    12 个任务的 UI 目录（由 MAA 协议文档生成，唯一数据源）
  src/task-ui.json         开始唤醒/理智作战的逐控件定义
  src/maa-task-spec.json   18 任务类型 / 168 协议字段（type/default/required/choices）
  src/feature-parity.json  功能对照（README 四语表格由它生成，CI 有 --check）
apps/maa-web/public/       新前端：index.html / app.js / style.css / maa-data.js / windows-ui/
tests/                     只有 server 侧 runtime/config 测试（node --test）
```

本地跑：`PORT=3100 DATA_DIR=<临时目录> node apps/maa-server/src/index.js`
（服务端会直接托管 `apps/maa-web/public`，API 与页面同源。生产走 nginx + GHCR 镜像。）

## 2. 现有 API（全部 JSON，无鉴权）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` `/api/version` `/api/system/info` | 健康检查、版本、系统信息 |
| GET/PUT | `/api/config`，POST `/api/config/validate` | 全局配置读写与校验 |
| GET | `/api/runtime/status`，POST `/api/runtime/fetch` | 运行包状态 / 下载 |
| GET | `/api/resources/info`，POST `/api/resources/verify` | 资源版本 / 校验 |
| GET | `/api/tasks/catalog` | 12 任务 UI 目录（**任务配置页应以此为准**） |
| GET | `/api/tasks/ui` | 开始唤醒 / 理智作战的控件定义 |
| GET/PUT | `/api/tasks/config` | 任务配置持久化（tasks.json） |
| GET/PUT | `/api/tasks/schedule` | 日程（schedule.json） |
| GET/PUT | `/api/connection` | 连接配置（clientType / address / adbPath / touchMode…） |
| GET | `/api/runner/status` | 运行状态快照：`{phase, connection, maa:{ok}, maaVersion}` |
| POST | `/api/runner/test-connect` `/api/runner/stop` | 连接测试 / 停止 |
| POST | `/api/tasks/execute` | 执行任务队列（**当前诚实返回 501，需要你在 runner 里落地**） |
| GET | `/api/logs` `/api/logs/download` | 日志查询 / 下载 |
| GET | `/api/features/parity` | 功能对照数据 |
| WS | `/api/ws` | 实时日志推送（首帧 hello，随后 logger 条目） |

## 3. 要做的接入（按优先级）

1. **设备/连接**：`DEVICE` mock → `GET/PUT /api/connection` + `GET /api/runner/status` 轮询（2~3 s）；
   「连接 / 截图测试」→ `POST /api/runner/test-connect`；右上角 chip 与任务页状态行由 `runner.status` 驱动。
2. **任务队列**：任务类型与表单字段改为 `GET /api/tasks/catalog` 驱动（不要手写映射）；
   配置变更防抖 600 ms → `PUT /api/tasks/config`；日程 → `GET/PUT /api/tasks/schedule`。
3. **开始/停止**：`POST /api/tasks/execute`（携带队列 + 各任务参数）+ `POST /api/runner/stop`；
   参数必须按 `maa-task-spec.json` 的字段类型强转后下发。
4. **日志**：日志页 + 运行实况时间线接 `WS /api/ws`（级别过滤、自动跟随、复制、清空）。
5. **首页/设置**：`GET /api/system/info`（CPU/内存）、`GET /api/version`、`GET /api/runtime/status`、
   `GET /api/resources/info`；设置页的更新/资源项接对应 API；设置项写入 `PUT /api/config`。
6. **小工具**：干员/仓库/公招识别的结果与「开始识别」先接 API 占位（后端暂无实现时前端要显式提示未实现，不要造假数据）。

## 4. 硬性约束（违反会被用户打回）

- **只用 windows-ui 官方组件**：`public/windows-ui/` 是官方 dist（master 分支 5 个文件）。
  样式只能写布局与间距，**颜色一律用官方 token**（`var(--color-*)`、`var(--dark, X) var(--light, Y)`），
  不许硬编码色值；主题由官方 JS 管（`data-theme` 挂 `<html>`，localStorage `WinAppLocalTheme`）。
  > 现状提示：`style.css` 现在有自建 `--mdw-*` 与约 70 处硬编码色，属于原型遗留债，
  > 接入过程中请**顺手把改动的块**迁移到官方 token，不要新增硬编码色。
- **弹窗不许用原生**：已有一套 `openModal/openInfoModal/openConfirmModal/openRenameModal/...`，继续用它。
- **协议驱动**：新增任务字段改 `docs/zh-cn/protocol/integration.md` 后跑
  `scripts/gen-task-catalog.py`；README 表格由 `scripts/gen-readme-parity.py` 生成（CI 有 `--check`）。
- **静态资源改了要 bump `index.html` 里的 `?v=`**，否则浏览器吃缓存。
- **不许擅自重启/重建容器**（NAS 上是生产容器）；部署走 `scripts/x86nas-deploy.py <ip> main`，
  且需要用户明确许可。
- 提交前：`node --check` 前端文件；`node --test`（在 `apps/maa-server` 目录）通过。

## 5. 验收标准

- 本地 `PORT=3100` 起服务，7 个页面（主页/一键长草/自动战斗/日程/小工具/日志/设置）全部有真实数据。
- 连接设备后，任务页状态行、右上角 chip、首页卡片三处状态一致；点开始能真的下发任务并看到日志滚动。
- 配置改动刷新页面后仍在（已持久化到服务端）。
- 深色模式无硬编码色残留（切主题后无“白底白字/黑底黑字”区域）。
- 无 console 报错，无原生 alert/confirm/prompt。
