# Reverse Prompt Studio

一个连接用户自己 Codex 的本地图片提示词工作台：放入参考图、生成结构化视觉配方、逐板块编辑和锁定，再让 Codex 整理成新的可复制提示词。

![Local-first](https://img.shields.io/badge/runtime-local--first-171717)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-3C873A)

## 安装到 Codex

准备条件：

- 已安装并登录 Codex CLI。
- 已安装 Node.js 18 或更高版本。

添加插件市场并安装：

```bash
codex plugin marketplace add huahuahuafulaoer/reverse-prompt-studio
codex plugin add reverse-prompt-studio@reverse-prompt-studio-marketplace
```

安装后新建一个 Codex 任务，然后说：

```text
启动图片提示词工作台
```

Codex 会在本机启动服务并打开浏览器。默认地址为 `http://127.0.0.1:4173`；端口被占用时会自动选择其他本地端口。

## 更新

当仓库发布新版本后，刷新插件市场并重新安装：

```bash
codex plugin marketplace upgrade reverse-prompt-studio-marketplace
codex plugin add reverse-prompt-studio@reverse-prompt-studio-marketplace
```

更新后请新建一个 Codex 任务，让新技能和代码生效。

## 隐私与运行方式

- 浏览器只连接 `127.0.0.1` 上的本地服务。
- 服务调用用户本机的 `codex app-server`，使用用户自己的 Codex 登录、权限与用量。
- 图片、配方和修订记录默认保存在用户自己的应用数据目录，不会写入插件安装目录。
- 图片分析仍会按照用户自己的 Codex 配置发送给模型处理；本插件不包含共享 API Key，也没有独立的第三方上传服务器。

## 本地开发

```bash
npm start
npm test
npm run check
```

应用源码和插件清单位于 [`plugins/reverse-prompt-studio`](plugins/reverse-prompt-studio)。仓库本身同时是一个 Codex Plugin Marketplace。

## 发布迭代

GitHub 不会自动同步尚未提交的本地修改。完成一次迭代后，需要运行测试、提交并推送到这个仓库；用户再执行上面的更新命令即可取得新版。插件版本记录在 `.codex-plugin/plugin.json`。

## License

[MIT](LICENSE)
