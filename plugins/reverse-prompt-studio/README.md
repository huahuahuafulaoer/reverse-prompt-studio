# Reverse Prompt Studio Plugin

这是插件的自包含运行目录，包含本地网页、Node.js 服务、启动 Skill 和图片反推 Skill。

正常用户请通过仓库根目录的 Marketplace 安装，然后在新的 Codex 任务中说“启动图片提示词工作台”。开发时可在本目录运行：

```bash
npm start
npm test
npm run check
```

工作台会缓存 GitHub Release 检查结果 24 小时。发现更高版本时，页面顶部显示一个可关闭的轻量提醒，并提供版本说明和可复制的升级命令；离线或检查失败不影响本地编辑与 Codex 分析。

可选环境变量：

- `RPS_PORT`：首选本地端口，冲突时仍会自动回退。
- `RPS_DATA_ROOT`：图片、配方和修订记录目录。
- `RPS_WORKSPACE_ROOT`：Codex thread 的本地工作目录。
- `RPS_SKILL_PATH`：覆盖内置图片反推 Skill。
- `RPS_OPEN_BROWSER=0`：启动后不自动打开浏览器。
- `RPS_DEBUG=1`：输出 Codex App Server stderr。
