# 架构

```text
浏览器
   │ HTTP / WebSocket
   ▼
maa-web (nginx:alpine)
   │  /            → 静态文件
   │  /api/*       → 反代
   │  /api/ws      → WebSocket 升级
   ▼
maa-server (node:22-slim)
   ├── REST API（健康/版本/系统/配置/Runtime/资源/日志）
   ├── WebSocket 日志推送
   ├── 配置持久化（data/config/config.json）
   ├── 日志（内存环形缓冲 + 每日文件）
   └── MAA Runtime 管理器
        └── 下载官方 Release tar.gz → SHA-256 校验 → tar 解压 → 持久卷
```

## 关键设计决策

1. **不在镜像或仓库中分发 MAA 二进制**。镜像保持精简，MAA 以官方发布物为准，
   下载后用固定 SHA-256 校验（记录在 `apps/maa-server/src/runtime.js`）。
2. **Runtime 状态机**：`uninitialized → downloading → verifying → extracting → ready | error`，
   通过 `GET /api/runtime/status` 可观测，下载过程幂等（busy 锁）。
3. **前后端分离（方案 A）**：web 只做静态托管与反代；server 端口不对外暴露，仅走 compose 内部网络。
4. **持久卷**：`data/config`、`data/logs`、`data/resource`、`data/runtime` 四个挂载点，
   容器重建不丢运行包与配置。
5. **许可证隔离**：自有代码 MIT；MAA（AGPL-3.0）以用户侧下载方式引入，见 NOTICE。

## 后续演进（M2+）

- `device/`：ADB 设备池与状态机（offline/online/busy/error）
- `task/`：任务队列、MaaCore C API 绑定（N-API 或独立进程 + IPC）
- MaaCore 进程隔离设计：识别/控制跑在独立 worker 进程，server 崩溃不影响任务状态恢复
