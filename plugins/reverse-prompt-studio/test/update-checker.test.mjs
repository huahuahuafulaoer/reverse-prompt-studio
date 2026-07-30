import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  UpdateChecker,
  isNewerVersion,
} from "../src/update-checker.mjs";

const latestRelease = {
  tag_name: "v0.2.0",
  name: "Reverse Prompt Studio v0.2.0",
  html_url: "https://github.com/huahuahuafulaoer/reverse-prompt-studio/releases/tag/v0.2.0",
  published_at: "2026-07-30T04:00:00Z",
};

test("isNewerVersion compares semantic versions and ignores v/build prefixes", () => {
  assert.equal(isNewerVersion("v0.2.0", "0.1.0"), true);
  assert.equal(isNewerVersion("0.2.0", "0.2.0+codex.local-1"), false);
  assert.equal(isNewerVersion("0.1.9", "0.2.0"), false);
  assert.equal(isNewerVersion("1.0.0", "0.9.9"), true);
});

test("UpdateChecker reports a newer GitHub release and caches it for one day", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reverse-prompt-update-"));
  let fetchCount = 0;
  const checker = new UpdateChecker({
    currentVersion: "0.1.0",
    cachePath: path.join(root, "update-check.json"),
    now: () => Date.parse("2026-07-30T08:00:00Z"),
    fetchImpl: async () => {
      fetchCount += 1;
      return { ok: true, json: async () => latestRelease };
    },
  });

  try {
    const first = await checker.check();
    const second = await checker.check();
    assert.equal(first.status, "available");
    assert.equal(first.currentVersion, "0.1.0");
    assert.equal(first.latestVersion, "0.2.0");
    assert.equal(first.releaseUrl, latestRelease.html_url);
    assert.deepEqual(first.updateCommands, [
      "codex plugin marketplace upgrade reverse-prompt-studio-marketplace",
      "codex plugin add reverse-prompt-studio@reverse-prompt-studio-marketplace",
    ]);
    assert.deepEqual(second, first);
    assert.equal(fetchCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("UpdateChecker stays silent when GitHub cannot be reached", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reverse-prompt-update-offline-"));
  let fetchCount = 0;
  const checker = new UpdateChecker({
    currentVersion: "0.2.0",
    cachePath: path.join(root, "update-check.json"),
    fetchImpl: async () => {
      fetchCount += 1;
      throw new Error("offline");
    },
  });

  try {
    const expected = {
      status: "unavailable",
      currentVersion: "0.2.0",
    };
    assert.deepEqual(await checker.check(), expected);
    assert.deepEqual(await checker.check(), expected);
    assert.equal(fetchCount, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
