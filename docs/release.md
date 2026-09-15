# 发布流程

## 版本规则

- 项目版本：`v0.1.0`（本仓库）
- 上游版本：`MAA v6.17.5`（固定在 `apps/maa-server/src/runtime.js`）
- 两者独立演进：升级 MAA 只改 runtime.js 的版本号与 SHA-256，不 bump 项目版本

## 发布步骤

1. 更新 `apps/maa-server/package.json` 的 `version`
2. 确认 CI 全绿（测试、compose 校验、双架构构建）
3. 打 tag 并推送：
   ```bash
   git tag v0.1.0 && git push origin main --tags
   ```
4. GitHub Actions（image.yml）自动构建并推送多架构镜像到 GHCR：
   - `ghcr.io/kasbuky-sudo/maa-server:v0.1.0` / `:latest`
   - `ghcr.io/kasbuky-sudo/maa-web:v0.1.0` / `:latest`
5. 创建 GitHub Release：changelog、镜像标签、上游 MAA 版本说明
6. 真机验收（x86NAS / armNAS 各一轮，验收表见 README 或 issue 模板）

## 升级 MAA 上游版本

1. 从官方 Release 拿到新版本两个架构 tar.gz 的 SHA-256
2. 更新 `runtime.js` 中 `MAA_VERSION` 与 `ASSETS`
3. `npm test`（测试会校验 checksum 长度与命名）
4. 在两台 NAS 上删除 `data/runtime` 重新拉取验证
