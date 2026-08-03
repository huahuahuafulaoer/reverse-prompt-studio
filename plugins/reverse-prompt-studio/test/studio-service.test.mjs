import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
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
    assert.ok(analyzed.recipe.sections.some((section) => section.id === "L"));

    const compositionField = analyzed.recipe.sections
      .find((section) => section.id === "C").fields[0];
    compositionField.value = "68%";
    compositionField.dirty = true;
    const revised = await service.revise(run.id, analyzed.recipe);
    assert.equal(revised.recipe.title, "Fake revised result");
    assert.match(revised.compiledPrompt, /68%/);

    const instructed = await service.revise(run.id, revised.recipe, [
      { sectionId: "C", instruction: "主体占比改成 72%" },
    ]);
    assert.match(instructed.compiledPrompt, /72%/);
    assert.ok(events.some((event) => event.method === "turn/completed"));

    const persisted = await store.loadRun(run.id);
    assert.equal(persisted.revisions.length, 3);
  } finally {
    service.close();
    appServer.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("StudioService applies only authorized revision sections and rejects locked instructions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reverse-prompt-section-revision-"));
  const store = new RunStore(root);
  const thread = new EventEmitter();
  thread.id = "thr_section_revision";
  let receivedPrompt = "";
  thread.run = async (params) => {
    receivedPrompt = params.input[0].text;
    return {
      schema: "reverse-image-prompt/editor-v1",
      title: "模型修订结果",
      transferMode: "content_fidelity",
      contentAnchors: {
        subject: { value: "人物", preserve: true, sourceRole: "content_reference" },
        action: { value: "行走", preserve: true, sourceRole: "content_reference" },
        interaction: { value: "接触地面", preserve: true, sourceRole: "content_reference" },
        scene: { value: "街道", preserve: true, sourceRole: "content_reference" },
      },
      sections: [
        { id: "S", label: "主体", fields: [{ id: "S01", label: "主体", value: "模型擅改人物" }] },
        { id: "A", label: "动作", fields: [{ id: "A01", label: "动作", value: "模型擅改动作" }] },
        { id: "C", label: "构图", fields: [{ id: "C01", label: "位置", value: "模型擅改构图" }] },
        { id: "L", label: "光影", fields: [{ id: "L01", label: "光线", value: "柔和清晨光" }] },
      ],
      referenceTransfer: { preserve: [], translate: [], omit: [] },
      truthGaps: [],
      negativeConstraints: [],
    };
  };
  thread.close = () => {};
  const service = new StudioService({
    appServer: { resumeThread: async () => thread },
    store,
    workspaceRoot: "/tmp/project",
    skillPath: "/tmp/skill/SKILL.md",
  });
  const current = {
    schema: "reverse-image-prompt/editor-v1",
    title: "当前配方",
    transferMode: "content_fidelity",
    contentAnchors: {
      subject: { value: "人物", preserve: true, sourceRole: "content_reference" },
      action: { value: "行走", preserve: true, sourceRole: "content_reference" },
      interaction: { value: "接触地面", preserve: true, sourceRole: "content_reference" },
      scene: { value: "街道", preserve: true, sourceRole: "content_reference" },
    },
    sections: [
      { id: "S", label: "主体", fields: [{ id: "S01", label: "主体", value: "原人物", locked: false }] },
      { id: "A", label: "动作", fields: [{ id: "A01", label: "动作", value: "原动作", locked: false }] },
      { id: "C", label: "构图", fields: [{ id: "C01", label: "位置", value: "原构图", locked: false }] },
      { id: "L", label: "光影", fields: [{ id: "L01", label: "光线", value: "原光线", locked: false }] },
    ],
    referenceTransfer: { preserve: [], translate: [], omit: [] },
    truthGaps: [],
    negativeConstraints: [],
  };

  try {
    const run = await store.createRun({ bytes: Buffer.from("image"), contentType: "image/png" });
    await store.saveThreadId(run.id, thread.id);
    const revised = await service.revise(run.id, current, [
      { sectionId: "L", instruction: "改成柔和的清晨光" },
    ]);
    assert.match(receivedPrompt, /section_instructions/);
    assert.equal(revised.recipe.sections.find((section) => section.id === "L").fields[0].value, "柔和清晨光");
    assert.equal(revised.recipe.sections.find((section) => section.id === "C").fields[0].value, "原构图");
    assert.equal(revised.recipe.sections.find((section) => section.id === "S").fields[0].value, "原人物");

    const locked = structuredClone(current);
    locked.sections.find((section) => section.id === "L").fields[0].locked = true;
    await assert.rejects(
      () => service.revise(run.id, locked, [{ sectionId: "L", instruction: "仍然修改" }]),
      /锁定.*L/,
    );
  } finally {
    service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("StudioService rejects an incomplete content-fidelity result without persisting it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reverse-prompt-invalid-fidelity-"));
  const store = new RunStore(root);
  const thread = new EventEmitter();
  thread.id = "thr_invalid";
  thread.run = async () => ({
    schema: "reverse-image-prompt/editor-v1",
    title: "Incomplete",
    transferMode: "content_fidelity",
    contentAnchors: {
      subject: { value: "单人攀岩者", preserve: true, sourceRole: "content_reference" },
      action: { value: "攀爬岩壁", preserve: true, sourceRole: "content_reference" },
      interaction: { value: "身体接触岩壁", preserve: true, sourceRole: "content_reference" },
      scene: { value: "户外岩壁", preserve: true, sourceRole: "content_reference" },
    },
    sections: [{ id: "C", label: "构图", fields: [] }],
    referenceTransfer: { preserve: [], translate: [], omit: [] },
    truthGaps: [],
    negativeConstraints: [],
  });
  thread.close = () => {};
  const service = new StudioService({
    appServer: { startThread: async () => thread },
    store,
    workspaceRoot: "/tmp/project",
    skillPath: "/tmp/skill/SKILL.md",
  });

  try {
    const run = await store.createRun({ bytes: Buffer.from("image"), contentType: "image/png" });
    await assert.rejects(() => service.analyze(run.id), /S.*A|主体.*动作/);
    assert.doesNotMatch((await readdir(path.join(root, run.id))).join("\n"), /recipe\.json/);
  } finally {
    service.close();
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
    const lockedLight = analyzed.recipe.sections.find((section) => section.id === "L");
    lockedLight.fields[0].value = "必须保留的左上光";
    lockedLight.fields[0].locked = true;
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

test("StudioService creates one full-frame finish-only prompt from the approved master", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "finish-only-service-"));
  const { service, store, appServer } = await createBrandGradeHarness(root);

  try {
    const run = await store.createRun({
      bytes: Buffer.from("source"),
      contentType: "image/png",
      workflow: "brand_grade",
    });
    assert.equal(typeof service.createFinishOnlyPlan, "function");
    const result = await service.createFinishOnlyPlan({
      runId: run.id,
      direction: "更通透，但保持户外纪实质感",
    });

    assert.equal(result.schema, "finish-only-plan/v1");
    assert.equal(result.sourceVersionId, "source-v1");
    assert.match(result.platformPrompt, /已确认母版/);
    assert.match(result.platformPrompt, /更通透，但保持户外纪实质感/);
    const persisted = await store.loadLatestFinishOnlyPlan(run.id);
    assert.deepEqual(persisted, result);
    const persistedRun = await store.loadRun(run.id);
    assert.equal(persistedRun.latestAudit, undefined);
    assert.equal(persistedRun.latestContract, undefined);
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
