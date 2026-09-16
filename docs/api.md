# API 文档（v0.1.0）

Base URL：`/api`（由 maa-web 反代到 maa-server）。所有响应为 JSON。

## 系统

### GET /api/health
```json
{ "status": "healthy", "uptimeSeconds": 120 }
```

### GET /api/version
```json
{ "serviceVersion": "0.1.0", "maaVersion": "v6.17.5", "nodeVersion": "v22.x" }
```

### GET /api/system/info
主机名、架构、平台、内存、CPU 数、服务运行时长。

## 配置

### GET /api/config
```json
{ "serverName": "MAA for NAS", "logLevel": "info", "timezone": "Asia/Shanghai", "autoFetchRuntime": true }
```

### PUT /api/config
Body 为上述字段的子集（白名单校验，未知字段被忽略）。非法值返回 400。

### POST /api/config/validate
只校验不保存，返回 `{ "valid": bool, "errors": [] }`。

## Runtime

### GET /api/runtime/status
```json
{
  "status": "ready",              // uninitialized|downloading|verifying|extracting|ready|error
  "installed": "v6.18.0-beta.1",  // 磁盘上实际安装的运行包版本（应用内可升级）
  "latest": "v6.18.0-beta.1",     // 最近一次 check-update 得到的上游最新版本
  "latestPrerelease": true,       // 该最新版本是否为 beta/alpha/rc
  "maaVersion": "v6.18.0-beta.1", // 同 installed（兼容字段，勿写死引导版本）
  "pinned": "v6.17.5",            // 镜像内固定的引导版本，不随升级变化
  "arch": "x64",                  // x64 | arm64
  "asset": "MAA-v6.18.0-beta.1-linux-x86_64.tar.gz",
  "error": null,
  "fetchedAt": "2026-09-16T09:52:39.599Z",
  "busy": false,
  "runtimeDir": "/app/data/runtime"
}
```

> 注意：`installed` 与 `pinned` 是两个不同的概念。运行包能在应用内独立升级，
> 因此所有面向用户的“当前版本”都必须读 `installed`；`pinned` 只在「检查更新」
> 里作为对照参考。

### GET /api/runtime/check-update
与 GitHub 上游 release 对比，带 5 分钟缓存（成功结果）

参数：`?force=1` 跳过缓存强制重新检查；`?pre=1` 把 beta/alpha/rc 也纳入候选
（默认只看正式版，避免上游只发预发布时误报「已是最新」）。

```json
{
  "installed": "v6.18.0-beta.1",
  "pinned": "v6.17.5",
  "latest": "v6.18.0-beta.1",
  "latestPrerelease": true,
  "updateAvailable": false,
  "releaseName": "...",
  "publishedAt": "2026-09-14T11:19:04Z",
  "asset": { "name": "MAA-v6.18.0-beta.1-linux-x86_64.tar.gz", "size": 0, "digest": "sha256:...", "url": "..." }
}
```

### POST /api/runtime/fetch
开始下载/更新官方运行包（异步执行，409 表示已在进行中）。进度通过
`GET /api/runtime/status` 轮询或 WebSocket 日志观察。

## 资源

### GET /api/resources/info
运行包根目录、resource 目录位置、资源条目数、架构、获取时间。
`installed` / `maaVersion` 均为磁盘上实际安装的运行包版本（非引导版本 `pinned`）。

```json
{
  "present": true,
  "installed": "v6.18.0-beta.1",
  "maaVersion": "v6.18.0-beta.1",
  "pinned": "v6.17.5",
  "root": "/app/data/runtime",
  "resourceDir": "/app/data/runtime/resource",
  "entries": 20,
  "arch": "x64",
  "fetchedAt": "2026-09-16T09:52:39.599Z"
}
```

### POST /api/resources/verify
完整性检查：runtime root、resource 目录、MaaCore 库文件、资源条目数。

## 日志

### GET /api/logs?limit=200
```json
{ "entries": [ { "type": "log", "timestamp": "...", "level": "info", "source": "server", "message": "..." } ], "files": ["maa-server-20260915.log"], "logDir": "/app/data/logs" }
```

### GET /api/logs/download?file=maa-server-20260915.log
下载日志文件（文件名白名单校验）。

### WS /api/ws
连接后先收到 `{ "type": "hello", ... }` 与最近 100 条日志，之后实时推送日志条目。
