import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import path from "node:path";

import {
  browserLaunchCommand,
  listenOnAvailablePort,
  resolveAppServerCommand,
  resolveRuntimePaths,
} from "../src/runtime-config.mjs";

test("resolveAppServerCommand supports the fake-server acceptance override", () => {
  assert.deepEqual(resolveAppServerCommand({}), {});
  assert.deepEqual(
    resolveAppServerCommand({
      CODEX_APP_SERVER_COMMAND: '"/opt/Node Runtime/node" "fixtures/fake server.mjs" --quiet',
    }),
    {
      command: "/opt/Node Runtime/node",
      args: ["fixtures/fake server.mjs", "--quiet"],
    },
  );
});

test("resolveRuntimePaths keeps skill code inside the plugin and user data outside it", () => {
  const pluginRoot = "/opt/plugins/reverse-prompt-studio";
  const paths = resolveRuntimePaths({
    pluginRoot,
    platform: "darwin",
    homeDirectory: "/Users/demo",
    env: {},
  });

  assert.equal(
    paths.skillPath,
    path.join(pluginRoot, "skills/reverse-engineering-image-prompts/SKILL.md"),
  );
  assert.equal(
    paths.dataRoot,
    "/Users/demo/Library/Application Support/Reverse Prompt Studio",
  );
  assert.equal(paths.workspaceRoot, paths.dataRoot);
});

test("resolveRuntimePaths honors explicit portable runtime overrides", () => {
  const paths = resolveRuntimePaths({
    pluginRoot: "/plugin",
    platform: "linux",
    homeDirectory: "/home/demo",
    env: {
      RPS_DATA_ROOT: "/tmp/rps-data",
      RPS_WORKSPACE_ROOT: "/tmp/rps-workspace",
      RPS_SKILL_PATH: "/tmp/rps-skill/SKILL.md",
      RPS_PORT: "5123",
    },
  });

  assert.equal(paths.dataRoot, "/tmp/rps-data");
  assert.equal(paths.workspaceRoot, "/tmp/rps-workspace");
  assert.equal(paths.skillPath, "/tmp/rps-skill/SKILL.md");
  assert.equal(paths.port, 5123);
});

test("browserLaunchCommand supports macOS, Windows, and Linux", () => {
  const url = "http://127.0.0.1:4173";
  assert.deepEqual(browserLaunchCommand("darwin", url), {
    command: "open",
    args: [url],
  });
  assert.deepEqual(browserLaunchCommand("win32", url), {
    command: "cmd",
    args: ["/c", "start", "", url],
  });
  assert.deepEqual(browserLaunchCommand("linux", url), {
    command: "xdg-open",
    args: [url],
  });
});

test("listenOnAvailablePort falls back when the preferred port is occupied", async () => {
  const blocker = createServer();
  const app = createServer();
  await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const preferredPort = blocker.address().port;

  try {
    const address = await listenOnAvailablePort(app, {
      host: "127.0.0.1",
      preferredPort,
    });
    assert.notEqual(address.port, preferredPort);
    assert.equal(address.host, "127.0.0.1");
  } finally {
    await Promise.all(
      [app, blocker].map(
        (server) =>
          new Promise((resolve) => {
            if (!server.listening) return resolve();
            server.close(resolve);
          }),
      ),
    );
  }
});
