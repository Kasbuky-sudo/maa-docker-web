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

功能对照的完整清单在 Web 界面「功能对照」页，数据源为 [`apps/maa-server/src/feature-parity.json`](apps/maa-server/src/feature-parity.json)（对照 MAA v6.17.5 桌面端）。

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
