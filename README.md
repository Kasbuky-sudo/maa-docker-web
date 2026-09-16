# MAA for NAS

**简体中文** | [English](README.en.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

> ## ⚠️ 项目状态：早期开发中，目前不可用
>
> **请勿用于生产或日常挂机。** 本项目仍在密集开发，界面与接口随时变动，且**尚未在真实设备上完成过一次端到端任务执行验证**。
> 现在的代码只适合开发、试验和折腾。详细进度见[路线图](#路线图)与 [GitHub Issues](https://github.com/Kasbuky-sudo/maa-docker-web/issues)。

将 [MAA（MaaAssistantArknights）](https://github.com/MaaAssistantArknights/MaaAssistantArknights)
官方 Linux 运行包封装为可在 **x86_64 / arm64** Docker 环境（NAS 友好）运行的 Web 管理服务。

本仓库**不分发** MAA 二进制与资源：运行时由服务端从 MAA 官方 GitHub Release 下载并做 SHA-256 校验后落盘到持久卷。

## 版本与更新

| 版本 | 来源 | 说明 |
|---|---|---|
| 服务端版本 | `apps/maa-server/package.json` | **唯一版本来源**：Web 界面顶栏 / 设置 / 关于页都通过 `GET /api/version` 读取，页面不再各自硬编码 |
| MAA 运行包版本 | 磁盘上的运行包（`data/runtime` 内的 marker） | 可独立升级：应用内「检查更新」先与官方最新 release 对比，**确认后才下载**，并用官方 `assets[].digest` 的 SHA-256 校验 |

升级运行包不需要重新构建镜像：服务端启动时读取 marker；运行包被替换后会自动作废 MaaCore 资源缓存并断开旧会话。

## 当前能做什么 / 不能做什么

✅ **已实现**

- 多架构镜像构建与容器化部署（`linux/amd64` + `linux/arm64`，CI 自动发布到 ghcr）
- MAA 官方运行包下载 / SHA-256 校验 / 解压 / 状态机 / **与官方 release 的版本对比与升级**
- Web 界面**已重写**为 windows-ui 官方组件体系（仅使用官方 dist，无自创组件），并已接入后端：
  主页、一键长草（12 个任务的队列与逐任务配置）、自动战斗、日程、小工具、日志、设置
- 前后端接入：运行状态轮询（2.5s）、任务配置持久化、队列下发与停止、日志（HTTP + WebSocket 实时流）、
  连接配置读写、系统信息、运行包与资源校验
- 连接测试：`AsstAsyncConnect` 探活，**已在真机（魅族 16X，无线 ADB）验证通过**；
  接口立即返回、结果经状态轮询回传（不再受反代超时影响），**成功后保持会话**，随后「开始任务」可直接复用
- MaaCore 消息 id 按运行包自带绑定逐一核对（InitFailed / ConnectionInfo / AllTasksCompleted 等），
  并把 MaaCore 的原话反馈到界面（不再只报「超时」）
- 移动端适配：≤760px 单列堆叠、抽屉式导航（官方 `collapsed-float`）、各页面无横向溢出

- 小工具识别类**真实实现**：公招识别（Recruit）/ 仓库识别（Depot）/ 干员识别（OperBox）直接调用 MaaCore，结果按官方回调结构（RecruitResult / DepotInfo / OperBoxInfo）渲染；无真实结果前界面明确标注「示例数据」
- 自动战斗**真实下发**：列出运行包自带的 76 个官方作业（按 SSS_/Paradox_ 前缀分类为保全派驻 / 主线 / 悖论模拟），按 Copilot / SSSCopilot / ParadoxCopilot 协议字段下发；识别与战斗共用连接会话
- **理智作战周计划**：每天可安排不同关卡，服务端按当天星期自动展开成多个 Fight 任务
- **服务端日程调度器**：daily / weekdays / weekends / 星期几，30 秒 tick，lastRun 防重，运行中自动跳过
- **设备实时画面**：ADB screencap 直出 PNG（已用真机验证 1920×1080），监控页按目标帧率刷新并显示实测 FPS

❌ **尚不可用 / 未接入**

- **任务下发端到端闭环尚未实测**：连接 ✓、会话保持 ✓、周计划展开 ✓，「开始任务」按钮现在就是真执行——就差一次真机全流程验证（连接手机后点一次即可）
- 作业站（MAA 作业分享）在线搜索未接入：目前只能用运行包自带作业和本地解析的作业文件
- 识别类工具的「导出到企鹅物流 / 工具箱」尚未实现（结果已在界面展示）
- 设置中除连接设置外的分组尚未持久化（服务端 `config.json` 白名单仅 4 个字段）
- **无任何鉴权**：只应在可信内网运行，切勿暴露到公网

## 功能对照（对照 MAA 桌面端；当前对照基线 v6.17.5，运行包版本可在应用内独立升级）

本表由 [`apps/maa-server/src/feature-parity.json`](apps/maa-server/src/feature-parity.json) 自动生成，与 Web 界面「功能对照」页同源；更新数据后运行 `python3 scripts/gen-readme-parity.py` 同步（CI 会检查是否漂移）。

<!-- parity:begin -->
统计：**已实现 45** · 部分实现 7 · 未实现 7 · 桌面专属 4（共 63 项）

### 执行管线（一切功能的地基）

| 功能 | 状态 | 说明 |
|---|---|---|
| MaaCore C 接口 FFI（AsstCaller.h 全套） | ✅ 已实现 | koffi 直绑 libMaaCore.so，容器内冒烟实测通过 |
| 资源加载 AsstLoadResource | ✅ 已实现 |  |
| 设备连接 AsstAsyncConnect（ADB） | ✅ 已实现 | 连接设置页填地址后可用；握手前先 adb connect 并确认设备在线，服务启动后后台预热会话（冷启动首次握手 MaaCore 自身要 ~60s，预热后稳定 1~2 秒） |
| 连接测试（AsstAsyncConnect 探活） | ✅ 已实现 | 顶部「连接」按钮 / 测试连接，返回耗时与分辨率体检；顶栏与其它位置共用同一套连接状态（已连接 / 连接测试通过 / 未连接 / 未配置），状态不再互相打架 |
| 任务下发 AsstAppendTask + 参数映射 | ✅ 已实现 | 任务目录 JSON → 集成协议参数 |
| 执行/停止（AsstStart/AsstStop） | ✅ 已实现 | 前端开始行动 + 停止按钮 |
| 原生回调日志（任务链/子任务事件） | ✅ 已实现 | 任务链/子任务事件写入日志页；运行实况按 MAA 桌面端同款中文输出实况：理智、刷关次数、关卡掉落、当前设施、总用时；连接心跳与 ProcessTask 细节降为调试级不刷屏 |
| 执行截图 / 实时画面 | ✅ 已实现 | GET /api/device/screenshot（ADB screencap 直出 PNG，真机 1920×1080 验证）；牛牛监控/抽卡页实时画面按目标帧率刷新并显示实测 FPS |
| 参数映射（协议 schema 驱动） | ✅ 已实现 | scripts/gen-task-catalog.py 解析 MAA 官方 integration.md 生成 spec，runner 按字段类型强转，杜绝手写映射漂移 |
| 实例选项（触控模式 / 客户端类型） | ✅ 已实现 | AsstSetInstanceOption(TouchMode=2, ClientType=6)，取值为 MaaCore AsstTypes.h 定义（minitouch/maatouch/adb/MaaFwAdb/MumuExtras） |

### 任务队列 · 12 种任务（桌面端任务列表）

| 功能 | 状态 | 说明 |
|---|---|---|
| 开始唤醒 StartUp | ✅ 已实现 | 客户端类型 / 启动客户端 / 账号切换 三个协议字段全部接入；未实机验证 |
| 理智作战 Fight | 🟡 部分实现 | 协议 16 字段全部接入（关卡/理智药与过期策略/碎石/次数/代理倍率/掉落上报/服务器/博朗台）；「周计划」已实现——服务端按当天星期自动展开成多个 Fight 任务；仍缺「材料目标库存」（非协议字段） |
| 基建换班 Infrast | ✅ 已实现 | 20 字段全接入：模式/设施/无人机/心情阈值/宿舍蹭信赖/菲亚梅塔/线索收取交流赠送/跨设施组合/训练室专精 |
| 领取奖励 Award | ✅ 已实现 | 日常周常/邮件/免费单抽/幸运墙/限时开采/月卡 |
| 信用收支 Mall | ✅ 已实现 | 10 字段全接入：访问好友/自动购物/优先与黑名单/只买打折/低于 300 停止/溢出策略/借助战/编队 |
| 自动公招 Recruit | ✅ 已实现 | 18 字段全接入：刷新/星级选择与确认/首选标签/多选策略/次数/招募时间/加急/保留词条/上报 |
| 自动肉鸽 Roguelike | ✅ 已实现 | 35 字段全接入：主题/难度/策略/分队/职业/开局干员/助战/投资/密文板/坍缩范式/月度小队/深入调查/刷钱种子/黑流树海 |
| 生息演算 Reclamation | ✅ 已实现 | 7 字段：主题/模式/支援道具/组装轮数/商店购买/荧光棒增加方式 |
| 仓库识别 Depot | ✅ 已实现 | 协议任务已接入（无参数）；用于掉落/库存统计 |
| 干员识别 OperBox | ✅ 已实现 | 协议任务已接入（无参数） |
| 更换主题 SwitchTheme | ✅ 已实现 | 主题名称字段接入 |
| 自定任务 Custom | ✅ 已实现 | task_names / params 接入，对应 interface.json 自定义任务 |

### 任务队列 · 全局功能

| 功能 | 状态 | 说明 |
|---|---|---|
| 任务多实例/复制/重命名/拖动排序 | ✅ 已实现 | 添加（12 类可多实例）/复制/重命名/删除/拖动排序全部实现；复制的任务配置独立保存 |
| 全选 | ✅ 已实现 | 队列工具条：全选/清空/保存配置 |
| 等待 & 停止 | ✅ 已实现 | 开始/停止按钮 + 运行状态 2.5s 轮询 + 运行实况时间线（WS 日志） |
| 完成后动作（退出游戏/模拟器/关机/休眠…） | ✅ 已实现 | MaaCore CloseDown 已接：睡眠/休眠/关机/退出游戏/退出模拟器；「退出 MAA」无对应行为（服务端常驻），已如实说明 |
| 任务超时提醒 | ✅ 已实现 | 队列工具条可设阈值（分钟，0=不提醒，存服务端 _meta）；运行超时后前端弹窗提醒一次并写入日志 |
| 今日关卡提示 | ✅ 已实现 | 理智作战页顶部按 PRTS 官方周开放表显示今日开放关卡 chips（LS/CE/AP/SK/CA/PR×4/剿灭）；周计划编辑器实时显示今天将执行的关卡 |
| 自动重载资源 | ✅ 已实现 | 运行包被替换后自动作废 MaaCore 资源缓存并断开旧会话（runtime.onRuntimeReplaced） |
| 定时执行（日程） | ✅ 已实现 | 日程 UI/存储 + 服务端调度器（30s tick）：daily/weekdays/weekends/星期几，lastRun 防重，执行中自动跳过；日程页与首页显示下次触发 |

### 自动战斗页（Copilot · 作业）

| 功能 | 状态 | 说明 |
|---|---|---|
| 作业路径/神秘代码识别 | 🟡 部分实现 | 作业列表来自运行包 resource/copilot（76 个官方作业，按 SSS_/Paradox_ 前缀分类为保全派驻/主线/悖论）；本地 .json 文件可解析（stage_name/doc.title）；神秘代码粘贴与作业站在线搜索未接 |
| 多作业模式/批量导入 | 🟡 部分实现 | 多作业模式 UI + 作业队列（添加/按关卡名排序/清空/单条删除）已实现；批量下发未接（当前下发首个作业） |
| 视频识别 | ❌ 未实现 |  |
| 自动编队/借助战/补充低信赖/模组 | 🟡 部分实现 | formation/loop_times/use_sanity_potion/ignore_requirements 等 Copilot 协议字段已随任务下发；真机效果待验证 |
| 作业分享/评价 | ❌ 未实现 |  |

### 小工具页（Toolbox）

| 功能 | 状态 | 说明 |
|---|---|---|
| 公招识别（Tag/时间） | ✅ 已实现 | POST /api/tools/run 真实调用 Recruit 任务；RecruitResult 按官方回调结构渲染（Tag/组合星级/干员按自身星级着色） |
| 仓库识别（导出 JSON） | 🟡 部分实现 | POST /api/tools/run 真实调用 Depot；DepotInfo 结果按 item_index.json 映射为物品名+数量渲染；导出未实现 |
| 干员识别 | ✅ 已实现 | POST /api/tools/run 真实调用 OperBox；OperBoxInfo 渲染（稀有度着色/精英/等级/潜能） |
| 牛牛抽卡/牛牛监控/牛杂 | 🟡 部分实现 | 牛牛监控/抽卡已接设备实时画面（ADB screencap，目标帧率 + 实测 FPS）；牛杂界面按官方资源表还原（活动列表/文案/日志），执行未接 |

### 设置（桌面端 15 组）

| 功能 | 状态 | 说明 |
|---|---|---|
| 常规设置（客户端类型） | ✅ 已实现 |  |
| 连接设置 | ✅ 已实现 | 地址/ADB 路径/连接配置/触控模式/客户端类型可读写；设备分辨率探测（wm size，16:9 与 720p 提示）已接入 |
| 启动设置 | ✅ 已实现 | 对应 Runtime 自动下载策略 |
| 定时设置（多套配置独立定时） | 🟡 部分实现 | 简化版日程页，无多配置绑定 |
| 外部通知（SMTP/TG/Discord/Server酱…） | ❌ 未实现 |  |
| 远程控制（任务端点） | ❌ 未实现 |  |
| 热键设置 | ⚪ 桌面专属 | 桌面端专属 |
| 性能设置 | ❌ 未实现 |  |
| 游戏设置 | ❌ 未实现 |  |
| GUI/背景设置 | ⚪ 桌面专属 | Web 有深浅主题（官方机制） |
| 版本更新设置 | ✅ 已实现 | 检查更新与官方 release 对比（5 分钟缓存）、确认后才下载、官方 assets[].digest SHA-256 校验；运行包升级无需重建镜像 |
| 配置管理（多套配置切换） | ❌ 未实现 |  |
| 成就系统 | ⚪ 桌面专属 | 桌面端专属 |
| 问题反馈 | ⚪ 桌面专属 | GitHub Issues 可用 |
| 关于 | ✅ 已实现 |  |

### 基础设施（Web 版自有）

| 功能 | 状态 | 说明 |
|---|---|---|
| MAA 官方运行包下载/SHA-256 校验 | ✅ 已实现 | x86_64 + arm64 双架构 |
| Docker 化部署（nginx + node） | ✅ 已实现 | CI 自动构建 ghcr 镜像，两台 NAS 在线更新 |
| 日志实时流（WebSocket） | ✅ 已实现 |  |
| windows-ui 组件体系（官方 dist vendored） | ✅ 已实现 | 主题/导航收起均走官方机制 |
| 功能对照页（本页） | ✅ 已实现 | 数据驱动，随开发更新 |
| 任务页界面（逐项对照 MaaWpfGui XAML） | ✅ 已实现 | 开始唤醒/理智作战的常规+高级设置按官方 XAML 重建：复选框+数值、复选框+下拉、? 帮助、底部页签、左栏 ＋/全选/清空/完成后/开始·停止、顶部一键长草·自动战斗页签；数据在 task-ui.json |
| 任务目录 / 参数 schema 由协议文档自动生成 | ✅ 已实现 | 18 种任务类型 / 168 个协议字段，改版只需重跑生成脚本 |
| 移动端适配（≤760px 单列 + 抽屉导航） | ✅ 已实现 | 单列堆叠、官方 collapsed-float 抽屉导航、各页面无横向溢出（393px 实测） |
| 前后端接入（状态轮询/配置持久化/实时画面） | ✅ 已实现 | 运行状态 2.5s 轮询、任务配置按任务深合并持久化（改动即存，离开页面用 keepalive 补写）、设备实时画面、检查更新与资源校验 |
<!-- parity:end -->

## 架构

```text
浏览器 ──▶ maa-web (nginx) ──▶ maa-server (Node.js)
                                  ├── Runtime 管理（下载/校验/解压）
                                  ├── REST + WebSocket（日志、任务、状态）
                                  └── runner ──koffi FFI──▶ libMaaCore.so ──ADB──▶ 设备
```

- `apps/maa-server`：API 服务；本地开发时也直接托管前端静态文件
- `apps/maa-web`：静态前端，组件全部基于 [windows-ui](https://github.com/virtualvivek/windows-ui)（MIT）
- `docker/`：`Dockerfile.server`（含 adb 与 libatomic1）、`Dockerfile.web`

## 快速开始（仅限开发试验）

```bash
git clone https://github.com/Kasbuky-sudo/maa-docker-web.git
cd maa-docker-web
# 使用 deploy/ 下的 docker-compose.yml 与 .env
docker compose up -d
```

访问 `http://<主机>:8080`。首次启动会下载约 220MB 的运行包；也可在 Runtime 页手动触发。

镜像（多架构，main 分支自动构建）：

```text
ghcr.io/kasbuky-sudo/maa-server
ghcr.io/kasbuky-sudo/maa-web
```

## 路线图

- [x] M1：Runtime 容器化 + 基础 API + 双架构镜像
- [x] M2：windows-ui 组件体系重建前端 + 任务目录驱动 UI
- [x] M3：MaaCore FFI 执行管线（koffi），容器内冒烟验证通过
- [ ] M4：设备连接设置补全 + **真机端到端任务验证**
- [ ] M5：任务补全（对齐桌面端 12 任务）+ 队列全局动作
- [ ] M6：定时调度器、外部通知、多设备、鉴权

## 文档

- [架构说明](docs/architecture.md) · [部署指南](docs/deployment.md) · [API 文档](docs/api.md) · [开发指南](docs/development.md) · [发布流程](docs/release.md)
- [第三方声明](NOTICE)

## 许可与声明

本项目代码以 [MIT](LICENSE) 许可发布。MAA 本体为 AGPL-3.0，本仓库不包含其任何二进制或资源文件；
运行时由用户侧从官方 Release 获取，其使用受 MAA 自身许可约束。详见 [NOTICE](NOTICE)。
本项目与 MaaAssistantArknights 官方无隶属关系。
