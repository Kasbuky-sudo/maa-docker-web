# 前端 ↔ 后端接入说明

> 状态（2026-09-16）：**主体已接入**。`apps/maa-web/public` 的新界面已经跑在真实 API 上：
> 运行状态轮询、连接配置读写、任务配置持久化、任务下发/停止、日志（HTTP + WebSocket）、
> 首页系统信息、日程读写都已打通。下面的「已接入 / 未接入」是当前真实状态，
> 未接入的部分需要**先补后端 API 或扩展服务端配置白名单**，不是前端能单方面完成的。

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

## 3. 接入状态

### 已接入（前端 ↔ 实测通过）

| 能力 | 前端 | 后端 |
|---|---|---|
| 运行状态 | `RT` + 2.5s 轮询 `refreshRunnerStatus()`，驱动顶栏芯片 / 状态栏 / 任务页状态行 / 首页 | `GET /api/runner/status` |
| 连接配置 | 设置 → 连接设置（地址/ADB 路径/连接配置/触控模式/客户端类型），改动即 PUT | `GET·PUT /api/connection` |
| 连接 / 断开 | 顶栏按钮 + 设置页「测试连接」 | `POST /api/runner/test-connect`、`POST /api/runner/stop` |
| 任务配置 | 控件 `id → OPT_IDS` 映射到 catalog 选项 id，防抖 600ms 保存；切任务/刷新自动回填；主题类字段先回填再重建联动下拉 | `GET·PUT /api/tasks/config` |
| 任务下发 | 队列「Link Start!」→ 按顺序提交勾选任务；运行中变「停止」 | `POST /api/tasks/execute`（内部 `runner.start()`） |
| 日志 | 日志页（级别过滤/复制/下载）+ 任务页运行实况时间线，实时追加 | `GET /api/logs`、`GET /api/logs/download`、`WS /api/ws` |
| 首页 | 系统信息（内存/核心/架构/主机名/运行时间）、MAA 版本、运行包状态、下一班日程 | `/api/system/info`、`/api/version`、`/api/runtime/status`、`/api/tasks/schedule` |
| 运行包 / 资源 | 首页「检查更新」「校验资源」 | `POST /api/runtime/fetch`、`POST /api/resources/verify` |
| 任务目录 | `添加任务` 弹窗用 catalog 的 id/name；配置校验按 catalog 白名单 | `GET /api/tasks/catalog` |

**离线预览**：任何 `fetch` 失败都会把页面切到「离线预览」模式（顶部黄条 + 状态栏提示），
此时只读不写（保存类操作直接短路），页面仍可渲染 —— 这是刻意行为，不要改成静默失败。

### 未接入（需要先动后端）

1. **小工具**（公招/干员/仓库识别、牛牛监控、牛杂）：后端没有对应 API，
   `TOOL_STATE` 仍是 mock。需要新增 `/api/tools/*` 并从 MaaCore 回调取结果；
   在那之前前端**必须保留「未实现」提示**，不许造假数据。
2. **自动战斗（Copilot）**：后端无 copilot API（MAA 的 Copilot 走作业站 + MaaCore Copilot 任务），整页未接。
3. **设置里的其余分组**（启动/游戏/界面/通知/热键/性能）：服务端 `config.json` 目前只有
   `serverName / logLevel / timezone / autoFetchRuntime` 四个白名单字段，需要先扩 `config.js` 的
   `DEFAULTS` 与 `validate()`，前端再接 `PUT /api/config`。
4. **日程调度器**：`/api/tasks/schedule` 只负责存取计划，服务端**没有 cron 触发逻辑**，
   所以日程页明确写了「只保存计划不触发执行」。repeat（每天/工作日…）目前存在浏览器
   localStorage，服务端 schema 还没有该字段。
5. **完成后动作 ExitMAA**：Web 版服务端常驻，无对应行为，runner 已在日志里如实说明并忽略。

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

- 本地：`PORT=3100 DATA_DIR=<临时目录> AUTO_FETCH_RUNTIME=false node apps/maa-server/src/index.js`，
  打开 `http://127.0.0.1:3100/`，7 个页面无 console 报错。
- 关掉服务端再打开页面：出现「离线预览」黄条，页面仍可用，写操作被拒绝并提示。
- 改任意任务选项 → `data/config/tasks.json` 里出现对应字段；刷新后控件回填一致；
  改 A 任务不会清掉 B 任务的配置；主题切换后难度/分队/角色等联动下拉能正确回填。
- 点「Link Start!」：无设备/无运行包时给出**服务端返回的真实原因**（例如「MAA 运行包未就绪」），
  不允许前端自己编提示。
- 日志页能看到服务端日志并实时追加；深色模式无硬编码色残留。
