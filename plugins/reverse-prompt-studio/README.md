# Reverse Prompt Studio Plugin

这是插件的自包含运行目录，包含本地网页、Node.js 服务、启动 Skill 和图片反推 Skill。

正常用户请通过仓库根目录的 Marketplace 安装，然后在新的 Codex 任务中说“启动图片提示词工作台”。开发时可在本目录运行：

```bash
npm start
npm test
npm run check
```

可选环境变量：

- `RPS_PORT`：首选本地端口，冲突时仍会自动回退。
- `RPS_DATA_ROOT`：图片、配方和修订记录目录。
- `RPS_WORKSPACE_ROOT`：Codex thread 的本地工作目录。
- `RPS_SKILL_PATH`：覆盖内置图片反推 Skill。
- `RPS_OPEN_BROWSER=0`：启动后不自动打开浏览器。
- `RPS_DEBUG=1`：输出 Codex App Server stderr。
