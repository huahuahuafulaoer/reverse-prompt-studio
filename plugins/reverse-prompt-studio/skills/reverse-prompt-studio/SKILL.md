---
name: reverse-prompt-studio
description: Use when the user asks to start, open, launch, or use Reverse Prompt Studio, 图片提示词工作台, 图片反推工作台, or an interactive local editor for analyzing and revising an image prompt with their own Codex session.
---

# Reverse Prompt Studio Launcher

Launch the bundled local workspace and hand the browser UI back to the user.

## Start workflow

1. Resolve the plugin root as the directory two levels above this `SKILL.md`.
2. Check `node --version` and require Node.js 18 or newer. Since this skill is already running inside Codex, do not ask for an API key or a separate model credential.
3. From the plugin root, run `node scripts/start-studio.mjs` in a persistent terminal session. Do not run `npm install`; the app uses only Node.js built-ins.
4. Wait until stdout prints `Reverse Prompt Studio: http://127.0.0.1:<port>`. The app normally opens that URL automatically. If browser launch is unavailable, give the printed URL to the user.
5. Keep the terminal session alive while the user works. Stop it only when the user asks to close the studio or the current execution environment is ending.

## Runtime boundaries

- The service must listen only on `127.0.0.1`.
- It uses the user's local `codex app-server`; never request, copy, or embed another person's Codex credentials.
- User images and recipes live in the user's application-data directory, outside the installed plugin.
- If the preferred port is occupied, accept the automatically selected fallback port shown in stdout.
- On failure, report the concrete missing prerequisite or App Server error instead of claiming the page started.
