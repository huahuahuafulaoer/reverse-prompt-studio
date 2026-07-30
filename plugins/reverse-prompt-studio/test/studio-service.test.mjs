import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CodexAppServer } from "../src/codex-client.mjs";
import { RunStore } from "../src/run-store.mjs";
import { StudioService } from "../src/studio-service.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

test("StudioService analyzes and revises a run on the same Codex thread", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reverse-prompt-service-"));
  const store = new RunStore(root);
  const appServer = await CodexAppServer.launch({
    command: process.execPath,
    args: [path.join(testDirectory, "../fixtures/fake-app-server.mjs")],
  });
  const service = new StudioService({
    appServer,
    store,
    workspaceRoot: "/tmp/project",
    skillPath: "/tmp/skill/SKILL.md",
  });
  const events = [];
  service.on("event", (event) => events.push(event));

  try {
    const run = await store.createRun({
      bytes: Buffer.from("image"),
      contentType: "image/png",
    });
    const analyzed = await service.analyze(run.id);
    assert.equal(analyzed.recipe.title, "Fake result");
    assert.equal(analyzed.threadId, "thr_fake");

    analyzed.recipe.sections[0].fields[0].value = "68%";
    analyzed.recipe.sections[0].fields[0].dirty = true;
    const revised = await service.revise(run.id, analyzed.recipe);
    assert.equal(revised.recipe.title, "Fake revised result");
    assert.match(revised.compiledPrompt, /68%/);
    assert.ok(events.some((event) => event.method === "turn/completed"));

    const persisted = await store.loadRun(run.id);
    assert.equal(persisted.revisions.length, 2);
  } finally {
    service.close();
    appServer.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("StudioService resumes the persisted Codex thread after a service restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reverse-prompt-resume-"));
  const store = new RunStore(root);
  const launchFakeServer = () =>
    CodexAppServer.launch({
      command: process.execPath,
      args: [path.join(testDirectory, "../fixtures/fake-app-server.mjs")],
    });
  let firstAppServer;
  let secondAppServer;
  let firstService;
  let secondService;

  try {
    const run = await store.createRun({
      bytes: Buffer.from("image"),
      contentType: "image/png",
    });
    firstAppServer = await launchFakeServer();
    firstService = new StudioService({
      appServer: firstAppServer,
      store,
      workspaceRoot: "/tmp/project",
      skillPath: "/tmp/skill/SKILL.md",
    });
    const analyzed = await firstService.analyze(run.id);
    firstService.close();
    firstAppServer.close();
    firstService = undefined;
    firstAppServer = undefined;

    secondAppServer = await launchFakeServer();
    secondService = new StudioService({
      appServer: secondAppServer,
      store,
      workspaceRoot: "/tmp/project",
      skillPath: "/tmp/skill/SKILL.md",
    });
    analyzed.recipe.sections[0].fields[0].value = "72%";
    const revised = await secondService.revise(run.id, analyzed.recipe);

    assert.equal(revised.threadId, "thr_fake");
    assert.equal(revised.recipe.title, "Fake revised result");
  } finally {
    firstService?.close();
    firstAppServer?.close();
    secondService?.close();
    secondAppServer?.close();
    await rm(root, { recursive: true, force: true });
  }
});
