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

async function createBrandGradeHarness(root) {
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
    brandGradeSkillPath: "/tmp/brand-grade/SKILL.md",
  });
  return { store, appServer, service };
}

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

test("StudioService analyzes with product truth and can match a new product on the same thread", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reverse-prompt-product-service-"));
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

  try {
    const run = await store.createRun({
      bytes: Buffer.from("reference"),
      contentType: "image/png",
    });
    await store.saveProductImage(run.id, {
      bytes: Buffer.from("product"),
      contentType: "image/png",
    });

    const analyzed = await service.analyze(run.id);
    assert.equal(analyzed.recipe.title, "Fake product-aware result");
    analyzed.recipe.sections.push({
      id: "L",
      label: "光影",
      fields: [
        {
          id: "L01",
          label: "主光方向",
          value: "必须保留的左上光",
          confidence: "high",
          control: "text",
          locked: true,
          dirty: false,
        },
      ],
    });
    const matched = await service.matchProduct(run.id, analyzed.recipe);
    assert.equal(matched.threadId, analyzed.threadId);
    assert.equal(matched.recipe.title, "Fake product-matched result");
    assert.equal(
      matched.recipe.sections.find((section) => section.id === "P").fields[0].value,
      "matched product",
    );
    assert.equal(
      matched.recipe.sections.find((section) => section.id === "L").fields[0].value,
      "必须保留的左上光",
    );
    assert.match(matched.compiledPrompt, /必须保留的左上光/);
    assert.doesNotMatch(matched.compiledPrompt, /模型擅自改成右下光/);

    const persisted = await store.loadRun(run.id);
    assert.deepEqual(
      persisted.revisions.map((revision) => revision.kind),
      ["analysis", "product-match"],
    );
    assert.equal(
      persisted.recipe.sections.find((section) => section.id === "L").fields[0].value,
      "必须保留的左上光",
    );
  } finally {
    service.close();
    appServer.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("StudioService audits, contracts, compares, and approves a brand-grade candidate", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "brand-grade-service-"));
  const { service, store, appServer } = await createBrandGradeHarness(root);

  try {
    const run = await store.createRun({
      bytes: Buffer.from("source"),
      contentType: "image/png",
      workflow: "brand_grade",
    });
    const audit = await service.auditBrandGrade({
      runId: run.id,
      brief: {
        channel: "PDP",
        audience: "消费者",
        firstRead: "产品",
        brandCharacter: "克制",
        copySafeArea: "右上",
      },
    });
    assert.equal(audit.earliestFailureGate, "G1");
    assert.equal(audit.visualState.G.texture, "材质高光不连续");
    assert.deepEqual(Object.keys(audit.visualState), [
      "M", "S", "A", "P", "C", "K", "L", "G", "E", "R", "T", "Q", "X",
    ]);
    const persistedAudit = await store.loadLatestAudit(run.id);
    assert.deepEqual(persistedAudit.visualState, audit.visualState);

    const contract = await service.createBrandGradeRepairContract({
      runId: run.id,
      findingId: "G1-F01",
    });
    assert.equal(contract.changePaths.length, 1);

    const candidate = await store.addCandidate(run.id, {
      bytes: Buffer.from("candidate"),
      contentType: "image/png",
    });
    const comparison = await service.compareBrandGradeCandidate({
      runId: run.id,
      candidateId: candidate.id,
    });
    assert.equal(comparison.verdict, "PASS");

    const approved = await service.approveBrandGradeCandidate({
      runId: run.id,
      candidateId: candidate.id,
    });
    assert.equal(approved.approvedCandidateId, candidate.id);
  } finally {
    service.close();
    appServer.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("StudioService blocks a contract for a later failed gate", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "brand-grade-gate-service-"));
  const { service, store, appServer } = await createBrandGradeHarness(root);

  try {
    const run = await store.createRun({
      bytes: Buffer.from("source"),
      contentType: "image/png",
      workflow: "brand_grade",
    });
    await service.auditBrandGrade({ runId: run.id, brief: {} });
    await assert.rejects(
      () => service.createBrandGradeRepairContract({
        runId: run.id,
        findingId: "G4-F01",
      }),
      /earliest failed gate/,
    );
  } finally {
    service.close();
    appServer.close();
    await rm(root, { recursive: true, force: true });
  }
});
