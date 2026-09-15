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
  "maaVersion": "v6.17.5",
  "arch": "x64",                  // x64 | arm64
  "asset": "MAA-v6.17.5-linux-x86_64.tar.gz",
  "error": null,
  "fetchedAt": "2026-09-15T04:00:00.000Z",
  "busy": false,
  "runtimeDir": "/app/data/runtime"
}
```

### POST /api/runtime/fetch
开始下载/更新官方运行包（异步执行，409 表示已在进行中）。进度通过
`GET /api/runtime/status` 轮询或 WebSocket 日志观察。

## 资源

### GET /api/resources/info
运行包根目录、resource 目录位置、架构、获取时间。

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
