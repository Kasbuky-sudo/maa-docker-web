# 开发指南

## 目录结构

```text
apps/maa-server   Node.js API 服务（依赖仅 ws，Node >= 20）
apps/maa-web      静态前端（windows-ui 已 vendor 进 public/windows-ui/）
docker/           两个镜像的 Dockerfile 与 nginx 配置
deploy/           compose 与 .env 模板
scripts/          辅助脚本
.github/          CI 与镜像发布工作流
```

## 本地开发

```bash
cd apps/maa-server
npm install
DATA_DIR=./.dev-data PORT=3000 npm start

# 前端：任意静态服务器指向 apps/maa-web/public，
# 开发时把 API 代理到 127.0.0.1:3000（或直接用 compose 起 maa-web）
```

## 测试

```bash
cd apps/maa-server && npm test
```

## 约定

- 服务端零框架：Node 内置 http + ws，不引入 Express 等重依赖
- 配置字段必须白名单（见 `src/config.js` 的 DEFAULTS）
- 日志统一走 `logger`（环形缓冲 + 文件 + WebSocket 广播）
- MAA 运行包版本与 SHA-256 固定在 `src/runtime.js`；升级时同步更新版本与校验值
- 提交前确认 `docker compose config -q` 与两个 Dockerfile 的多架构构建通过（CI 会做）
