export const UPDATE_DISMISS_KEY = "reverse-prompt-studio-dismissed-update";

export function shouldShowUpdate(update, dismissedVersion) {
  return update?.status === "available" && update.latestVersion !== dismissedVersion;
}

export function updateCommandText(update) {
  return (update?.updateCommands ?? []).join("\n");
}
