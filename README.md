# MAA Docker Web

将 [MAA（MaaAssistantArknights）](https://github.com/MaaAssistantArknights/MaaAssistantArknights)
官方 Linux 运行包封装为可在 **x86_64 / arm64** Docker 环境（NAS 友好）运行的 Web 管理服务。

- 服务端 `maa-server`：Node.js API 服务，负责下载、校验、管理官方 MAA 运行包，提供 REST + WebSocket 接口
- 前端 `maa-web`：基于 [windows-ui](https://github.com/virtualvivek/windows-ui)（MIT）的 Fluent 风格静态页面，由 Nginx 托管并反代 API
- 本仓库**不分发** MAA 二进制：运行时从 MAA 官方 GitHub Release 下载并做 SHA-256 校验，落盘到持久卷

## 快速开始

```bash
mkdir maa-docker-web && cd maa-docker-web
# 下载 docker-compose.yml 与 .env（见 deploy/ 目录），然后：
docker compose up -d
```

浏览器访问 `http://<主机>:8080`。首次启动时 `maa-server` 会自动从 MAA 官方 Release
下载运行包（约 220MB，视网络情况而定），也可在 Web UI 的 Runtime 页手动触发。

镜像（多架构 `linux/amd64` + `linux/arm64`，由 GitHub Actions 发布）：

```text
ghcr.io/kasbuky-sudo/maa-server
ghcr.io/kasbuky-sudo/maa-web
```

## 功能（v0.1.0）

- 服务健康、版本、系统信息 API
- MAA Runtime 下载 / SHA-256 校验 / 解压 / 状态机（uninitialized → downloading → verifying → extracting → ready / error）
- 资源目录检测与完整性校验
- 配置管理（持久化 JSON，白名单字段）
- 实时日志（WebSocket + 内存环形缓冲 + 文件落盘）
- Fluent Windows 风格 Web UI：总览 / Runtime / 配置 / 日志 / 关于

## 路线图

- [x] M1：Runtime 容器化 + 基础 API + Web UI + 双架构镜像
- [ ] M2：ADB 设备管理与设备状态机
- [ ] M3：任务队列与 MaaCore 任务执行
- [ ] M4：定时任务、通知、多设备

## 文档

- [架构说明](docs/architecture.md)
- [部署指南](docs/deployment.md)
- [API 文档](docs/api.md)
- [开发指南](docs/development.md)
- [发布流程](docs/release.md)
- [第三方声明](NOTICE)

## 许可

本项目代码以 [MIT](LICENSE) 许可发布。MAA 本体为 AGPL-3.0，本仓库不包含其任何二进制或资源文件；
运行时由用户侧从官方 Release 获取，其使用受 MAA 自身许可约束。详见 [NOTICE](NOTICE)。
