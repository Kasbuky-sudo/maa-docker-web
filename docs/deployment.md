# 部署指南

## 前置条件

- 已安装 Docker 与 Docker Compose v2 的 x86_64 或 arm64 主机（NAS 均可）
- 主机能访问 GitHub Releases（用于首次下载 MAA 运行包）

## 步骤

```bash
mkdir maa-docker-web && cd maa-docker-web

# 从仓库下载两个文件（或 git clone 后使用 deploy/ 目录）
curl -O https://raw.githubusercontent.com/Kasbuky-sudo/maa-docker-web/main/deploy/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/Kasbuky-sudo/maa-docker-web/main/deploy/.env.example

# 按需修改 .env（端口、日志等级、时区）
docker compose up -d
docker compose logs -f maa-server   # 观察首次下载进度
```

访问 `http://<主机IP>:8080`。

## 数据目录

| 挂载 | 用途 |
|---|---|
| `./data/config` | 服务配置（config.json） |
| `./data/logs` | 每日日志文件 |
| `./data/resource` | 预留资源目录 |
| `./data/runtime` | MAA 官方运行包解压结果（约 600MB+） |

## 常见操作

```bash
# 手动触发运行包下载（或使用 Web UI 的 Runtime 页）
curl -X POST http://127.0.0.1:8080/api/runtime/fetch

# 查看运行包状态
curl http://127.0.0.1:8080/api/runtime/status

# 升级镜像
docker compose pull && docker compose up -d
```

## NAS 建议

- 建议把 `data/` 放在 SSD 卷；机械盘会明显拖慢运行包解压与日志写入
- arm64 NAS 内存偏小时，为 `maa-server` 加 `mem_limit`（如 `1g`）防 OOM 连累宿主
- 不要把 8080 端口暴露到公网；本服务当前无认证（M2 计划加入）
