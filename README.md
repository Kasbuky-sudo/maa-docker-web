# MAA Docker Web

**简体中文** | [English](README.en.md) | [日本語](README.ja.md) | [한국어](README.ko.md)

> ## ⚠️ 项目状态：早期开发中，目前不可用
>
> **请勿用于生产或日常挂机。** 本项目仍在密集开发，界面与接口随时变动，且**尚未在真实设备上完成过一次端到端任务执行验证**。
> 现在的代码只适合开发、试验和折腾。详细进度见[路线图](#路线图)与 [GitHub Issues](https://github.com/Kasbuky-sudo/maa-docker-web/issues)。

将 [MAA（MaaAssistantArknights）](https://github.com/MaaAssistantArknights/MaaAssistantArknights)
官方 Linux 运行包封装为可在 **x86_64 / arm64** Docker 环境（NAS 友好）运行的 Web 管理服务。

本仓库**不分发** MAA 二进制与资源：运行时由服务端从 MAA 官方 GitHub Release 下载并做 SHA-256 校验后落盘到持久卷。

## 当前能做什么 / 不能做什么

✅ **已实现并验证**

- 多架构镜像构建与容器化部署（`linux/amd64` + `linux/arm64`，CI 自动发布到 ghcr）
- MAA 官方运行包下载 / SHA-256 校验 / 解压 / 状态机
- 实时日志（WebSocket + 环形缓冲 + 文件落盘）
- Web 界面（windows-ui 官方组件体系）：任务 / 日程 / 设置 / Runtime / 日志 / 功能对照 / 关于
- 任务目录（JSON 驱动 UI）：理智作战、基建换班、领取奖励、信用收支、自动公招、自动肉鸽、生息演算
- MaaCore C 接口 FFI 绑定（koffi 直绑 `libMaaCore.so`）：容器内验证通过 `AsstGetVersion` / `AsstSetUserDir` / `AsstLoadResource` / `AsstCreateEx` / 原生回调

❌ **尚不可用（重点）**

- **没有在真实设备上跑通过一次任务**：连接、下发、执行闭环具备代码路径，但未做端到端验证
- 连接设置只有一个 ADB 地址输入框：缺 ADB 路径、触控模式、MuMu/LD 截图增强、连接配置等
- 桌面端 12 个任务里 5 个未建：开始唤醒、自定任务、更换主题、仓库维护、用户数据同步
- 自动战斗（作业/视频识别）与小工具（公招识别、仓库识别等）整页缺失
- 定时执行仅保存日程，没有服务端调度器；队列全局动作（完成后动作、超时提醒等）缺失
- **无任何鉴权**：只应在可信内网运行，切勿暴露到公网

## 功能对照（对照 MAA v6.17.5 桌面端）

本表由 [`apps/maa-server/src/feature-parity.json`](apps/maa-server/src/feature-parity.json) 自动生成，与 Web 界面「功能对照」页同源；更新数据后运行 `python3 scripts/gen-readme-parity.py` 同步（CI 会检查是否漂移）。

<!-- parity:begin -->
统计：**已实现 15** · 部分实现 10 · 未实现 26 · 桌面专属 5（共 56 项）

### 执行管线（一切功能的地基）

| 功能 | 状态 | 说明 |
|---|---|---|
| MaaCore C 接口 FFI（AsstCaller.h 全套） | ✅ 已实现 | koffi 直绑 libMaaCore.so，容器内冒烟实测通过 |
| 资源加载 AsstLoadResource | ✅ 已实现 |  |
| 设备连接 AsstAsyncConnect（ADB） | ✅ 已实现 | 连接设置页填地址后可用 |
| 任务下发 AsstAppendTask + 参数映射 | ✅ 已实现 | 任务目录 JSON → 集成协议参数 |
| 执行/停止（AsstStart/AsstStop） | ✅ 已实现 | 前端开始行动 + 停止按钮 |
| 原生回调日志（任务链/子任务事件） | ✅ 已实现 | 回调写入日志页，WebSocket 实时推送 |
| 执行截图 / 实时画面 | ❌ 未实现 | AsstGetImage 已有接口，未接 UI |

### 任务队列 · 12 种任务（桌面端任务列表）

| 功能 | 状态 | 说明 |
|---|---|---|
| 开始唤醒（账号切换/启动客户端） | ❌ 未实现 | 任务未建 |
| 理智作战 | 🟡 部分实现 | 已有关卡/药剂/碎石/次数/连战/掉落/企鹅；缺周计划、指定材料·目标库存、博朗台、过期药策略、活动重置 |
| 基建换班 | 🟡 部分实现 | 已有模式/设施/无人机/阈值/补货；缺线索交流、训练室专精、菲亚梅塔、跨设施组合、自定义排班 |
| 领取奖励 | ✅ 已实现 | 日常/周常/邮件/免费单抽/幸运墙/开采/月卡 6 项全对齐 |
| 信用收支 | 🟡 部分实现 | 缺借助战 OF-1、只买打折、低于300停止、溢出策略等购物细节 |
| 自动公招 | 🟡 部分实现 | 已有多选等级/次数/加急；缺保留词条、无许可继续刷新等 |
| 自动肉鸽 | 🟡 部分实现 | 已有主题/策略/分队/职业/开局干员/投资；缺难度、密文板、坍缩范式、月度小队、助战等 |
| 生息演算 | 🟡 部分实现 | 仅模式；缺荧光棒、支援道具、组装轮数、商店购买 |
| 自定任务（interface.json 协议） | ❌ 未实现 |  |
| 更换主题（游戏内皮肤） | ❌ 未实现 |  |
| 仓库维护（刷钱计划） | ❌ 未实现 |  |
| 用户数据同步 | ❌ 未实现 |  |

### 任务队列 · 全局功能

| 功能 | 状态 | 说明 |
|---|---|---|
| 任务多实例/复制/重命名/拖动排序 | ❌ 未实现 |  |
| 全选 | ❌ 未实现 |  |
| 等待 & 停止 | ❌ 未实现 | 有立即停止 |
| 完成后动作（退出游戏/模拟器/关机/休眠…） | ❌ 未实现 |  |
| 任务超时提醒 | ❌ 未实现 |  |
| 今日关卡提示 | ❌ 未实现 |  |
| 自动重载资源 | ❌ 未实现 |  |
| 定时执行（日程） | 🟡 部分实现 | UI+存储已实现；服务端定时触发器未接 |

### 自动战斗页（Copilot · 作业）

| 功能 | 状态 | 说明 |
|---|---|---|
| 作业路径/神秘代码识别 | ❌ 未实现 |  |
| 多作业模式/批量导入 | ❌ 未实现 |  |
| 视频识别 | ❌ 未实现 |  |
| 自动编队/借助战/补充低信赖/模组 | ❌ 未实现 |  |
| 作业分享/评价 | ❌ 未实现 |  |

### 小工具页（Toolbox）

| 功能 | 状态 | 说明 |
|---|---|---|
| 公招识别（Tag/时间） | ❌ 未实现 |  |
| 仓库识别（导出 JSON） | ❌ 未实现 |  |
| 干员识别 | ❌ 未实现 |  |
| 牛牛抽卡/牛牛监控/牛杂 | ⚪ 桌面专属 | 桌面端娱乐功能 |

### 设置（桌面端 15 组）

| 功能 | 状态 | 说明 |
|---|---|---|
| 常规设置（客户端类型） | ✅ 已实现 |  |
| 连接设置 | 🟡 部分实现 | 已有地址/ADB 路径/连接配置/客户端类型；缺触控模式与 MuMu/LD 截图增强 |
| 启动设置 | ✅ 已实现 | 对应 Runtime 自动下载策略 |
| 定时设置（多套配置独立定时） | 🟡 部分实现 | 简化版日程页，无多配置绑定 |
| 外部通知（SMTP/TG/Discord/Server酱…） | ❌ 未实现 |  |
| 远程控制（任务端点） | ❌ 未实现 |  |
| 热键设置 | ⚪ 桌面专属 | 桌面端专属 |
| 性能设置 | ❌ 未实现 |  |
| 游戏设置 | ❌ 未实现 |  |
| GUI/背景设置 | ⚪ 桌面专属 | Web 有深浅主题（官方机制） |
| 版本更新设置 | 🟡 部分实现 | Runtime 页手动/自动下载运行包 |
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
