import os from "node:os";
import { spawn } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CodexAppServer } from "./codex-client.mjs";
import { createStudioHttpServer } from "./http-app.mjs";
import { RunStore } from "./run-store.mjs";
import {
  browserLaunchCommand,
  listenOnAvailablePort,
  resolveRuntimePaths,
} from "./runtime-config.mjs";
import { StudioService } from "./studio-service.mjs";
import { UpdateChecker } from "./update-checker.mjs";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(sourceDirectory, "..");
const brandGradeSkillPath = fileURLToPath(
  new URL("../skills/brand-grade-finishing/SKILL.md", import.meta.url),
);
const { dataRoot, workspaceRoot, skillPath, port } = resolveRuntimePaths({
  pluginRoot: projectDirectory,
  platform: process.platform,
  homeDirectory: os.homedir(),
});
const host = "127.0.0.1";

await Promise.all([
  mkdir(dataRoot, { recursive: true }),
  mkdir(workspaceRoot, { recursive: true }),
]);
await access(skillPath);
await access(brandGradeSkillPath);
const packageMetadata = JSON.parse(
  await readFile(path.join(projectDirectory, "package.json"), "utf8"),
);

const appServer = await CodexAppServer.launch({ cwd: workspaceRoot });
const store = new RunStore(path.join(dataRoot, "runs"));
const service = new StudioService({
  appServer,
  store,
  workspaceRoot,
  skillPath,
  brandGradeSkillPath,
});
const updateChecker = new UpdateChecker({
  currentVersion: packageMetadata.version,
  cachePath: path.join(dataRoot, "update-check.json"),
});
const server = createStudioHttpServer({
  service,
  store,
  publicDirectory: path.join(projectDirectory, "public"),
  updateChecker,
});

appServer.on("stderr", (message) => {
  if (process.env.RPS_DEBUG) process.stderr.write(`[codex] ${message}`);
});

const address = await listenOnAvailablePort(server, { host, preferredPort: port });
const url = `http://${address.host}:${address.port}`;
process.stdout.write(`Reverse Prompt Studio: ${url}\n`);
process.stdout.write(`Local data: ${dataRoot}\n`);
process.stdout.write(`Workspace: ${workspaceRoot}\n`);
if (process.env.RPS_OPEN_BROWSER !== "0") {
  const launch = browserLaunchCommand(process.platform, url);
  const browser = spawn(launch.command, launch.args, {
    detached: true,
    stdio: "ignore",
  });
  browser.on("error", () => {});
  browser.unref();
}

function shutdown() {
  server.close(() => {
    service.close();
    appServer.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
