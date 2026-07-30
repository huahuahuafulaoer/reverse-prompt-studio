import path from "node:path";

export function resolveRuntimePaths({
  pluginRoot,
  platform = process.platform,
  homeDirectory,
  env = process.env,
}) {
  const dataRoot = path.resolve(
    env.RPS_DATA_ROOT || defaultDataRoot({ platform, homeDirectory, env }),
  );
  const port = Number(env.RPS_PORT || 4173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid RPS_PORT: ${env.RPS_PORT}`);
  }

  return {
    dataRoot,
    workspaceRoot: path.resolve(env.RPS_WORKSPACE_ROOT || dataRoot),
    skillPath: path.resolve(
      env.RPS_SKILL_PATH ||
        path.join(pluginRoot, "skills/reverse-engineering-image-prompts/SKILL.md"),
    ),
    port,
  };
}

export function browserLaunchCommand(platform, url) {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] };
  }
  return { command: "xdg-open", args: [url] };
}

export async function listenOnAvailablePort(
  server,
  { host = "127.0.0.1", preferredPort = 4173 } = {},
) {
  try {
    return await listen(server, host, preferredPort);
  } catch (error) {
    if (error.code !== "EADDRINUSE" || preferredPort === 0) throw error;
    return listen(server, host, 0);
  }
}

function defaultDataRoot({ platform, homeDirectory, env }) {
  if (platform === "darwin") {
    return path.join(homeDirectory, "Library/Application Support/Reverse Prompt Studio");
  }
  if (platform === "win32") {
    return path.join(
      env.APPDATA || path.join(homeDirectory, "AppData/Roaming"),
      "Reverse Prompt Studio",
    );
  }
  return path.join(
    env.XDG_DATA_HOME || path.join(homeDirectory, ".local/share"),
    "reverse-prompt-studio",
  );
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      resolve({ host, port: address.port });
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}
