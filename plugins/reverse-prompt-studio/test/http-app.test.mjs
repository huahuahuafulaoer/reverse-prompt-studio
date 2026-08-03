import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CodexAppServer } from "../src/codex-client.mjs";
import { createStudioHttpServer } from "../src/http-app.mjs";
import { RunStore } from "../src/run-store.mjs";
import { StudioService } from "../src/studio-service.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

test("HTTP app uploads an image, analyzes it, and revises the same run", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reverse-prompt-http-"));
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
  let server;

  try {
    server = createStudioHttpServer({
      service,
      store,
      publicDirectory: path.join(testDirectory, "../public"),
      updateChecker: {
        check: async () => ({
          status: "available",
          currentVersion: "0.1.0",
          latestVersion: "0.2.0",
        }),
      },
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${origin}/api/health`).then((response) => response.json());
    assert.equal(health.status, "ready");
    const update = await fetch(`${origin}/api/update`).then((response) => response.json());
    assert.equal(update.status, "available");
    assert.equal(update.latestVersion, "0.2.0");

    const uploadResponse = await fetch(`${origin}/api/upload`, {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: Buffer.from("image"),
    });
    assert.equal(uploadResponse.status, 201);
    const upload = await uploadResponse.json();
    assert.ok(upload.runId);

    const productUploadResponse = await fetch(`${origin}/api/runs/${upload.runId}/product`, {
      method: "POST",
      headers: { "content-type": "image/webp" },
      body: Buffer.from("product"),
    });
    assert.equal(productUploadResponse.status, 201);
    const productUpload = await productUploadResponse.json();
    assert.equal(productUpload.productImageUrl, `/api/runs/${upload.runId}/product`);
    const productPreview = await fetch(`${origin}${productUpload.productImageUrl}`);
    assert.equal(productPreview.status, 200);
    assert.equal(productPreview.headers.get("content-type"), "image/webp");
    assert.equal(productPreview.headers.get("cache-control"), "no-store");

    const missingReplacementResponse = await fetch(`${origin}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: upload.runId, transferMode: "subject_swap" }),
    });
    assert.equal(missingReplacementResponse.status, 400);

    const analyzed = await fetch(`${origin}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: upload.runId, transferMode: "content_fidelity" }),
    }).then((response) => response.json());
    assert.equal(analyzed.recipe.title, "Fake product-aware result");
    assert.equal(analyzed.recipe.transferMode, "content_fidelity");

    const matched = await fetch(`${origin}/api/product-match`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: upload.runId, recipe: analyzed.recipe }),
    }).then((response) => response.json());
    assert.equal(matched.recipe.title, "Fake product-matched result");

    matched.recipe.sections[0].fields[0].value = "68%";
    matched.recipe.sections[0].fields[0].dirty = true;
    const revised = await fetch(`${origin}/api/revise`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: upload.runId,
        recipe: matched.recipe,
        sectionInstructions: [{ sectionId: "L", instruction: "光线更柔和" }],
      }),
    }).then((response) => response.json());
    assert.equal(revised.recipe.title, "Fake revised result");

    const malformedInstructions = await fetch(`${origin}/api/revise`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: upload.runId, recipe: matched.recipe, sectionInstructions: {} }),
    });
    assert.equal(malformedInstructions.status, 400);

    for (const sectionInstructions of [
      [{ sectionId: "Z", instruction: "修改未知板块" }],
      [
        { sectionId: "C", instruction: "居中" },
        { sectionId: "C", instruction: "靠右" },
      ],
      [{ sectionId: "C", instruction: "  " }],
    ]) {
      const invalid = await fetch(`${origin}/api/revise`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: upload.runId, recipe: matched.recipe, sectionInstructions }),
      });
      assert.equal(invalid.status, 400);
    }

    const lockedRecipe = structuredClone(matched.recipe);
    for (const field of lockedRecipe.sections.find((section) => section.id === "C").fields) {
      field.locked = true;
    }
    const lockedInstruction = await fetch(`${origin}/api/revise`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: upload.runId,
        recipe: lockedRecipe,
        sectionInstructions: [{ sectionId: "C", instruction: "改构图" }],
      }),
    });
    assert.equal(lockedInstruction.status, 400);

    const swapUpload = await fetch(`${origin}/api/upload`, {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: Buffer.from("swap-reference"),
    }).then((response) => response.json());
    const swapped = await fetch(`${origin}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: swapUpload.runId,
        transferMode: "subject_swap",
        replacementSubject: "红色机械鸟",
      }),
    }).then((response) => response.json());
    assert.equal(swapped.recipe.transferMode, "subject_swap");
    assert.deepEqual(swapped.recipe.contentAnchors.subject, {
      value: "红色机械鸟",
      preserve: true,
      sourceRole: "user_or_project_truth",
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    service.close();
    appServer.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("HTTP app supports the complete brand-grade lifecycle", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "brand-grade-http-"));
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
  let server;

  try {
    server = createStudioHttpServer({
      service,
      store,
      publicDirectory: path.join(testDirectory, "../public"),
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;

    const createdResponse = await fetch(`${origin}/api/brand-grade/runs`, {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: Buffer.from("source"),
    });
    assert.equal(createdResponse.status, 201);
    const run = await createdResponse.json();
    assert.equal(run.workflow, "brand_grade");

    const inputResponse = await fetch(
      `${origin}/api/brand-grade/runs/${run.id}/inputs?role=product_truth`,
      {
        method: "POST",
        headers: { "content-type": "image/jpeg" },
        body: Buffer.from("truth"),
      },
    );
    assert.equal(inputResponse.status, 201);

    const auditResponse = await fetch(`${origin}/api/brand-grade/runs/${run.id}/audit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: "PDP",
        audience: "消费者",
        firstRead: "产品",
        brandCharacter: "克制",
        copySafeArea: "右上",
      }),
    });
    assert.equal(auditResponse.status, 200);
    const audit = await auditResponse.json();
    assert.equal(audit.schema, "brand-grade-audit/v1");

    const laterContractResponse = await fetch(
      `${origin}/api/brand-grade/runs/${run.id}/contracts`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ findingId: "G4-F01" }),
      },
    );
    assert.equal(laterContractResponse.status, 400);

    const contractResponse = await fetch(`${origin}/api/brand-grade/runs/${run.id}/contracts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ findingId: "G1-F01" }),
    });
    assert.equal(contractResponse.status, 201);
    const contract = await contractResponse.json();
    assert.equal(contract.schema, "brand-grade-repair-contract/v1");

    const candidateResponse = await fetch(
      `${origin}/api/brand-grade/runs/${run.id}/candidates`,
      {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: Buffer.from("candidate"),
      },
    );
    assert.equal(candidateResponse.status, 201);
    const candidate = await candidateResponse.json();

    const comparisonResponse = await fetch(
      `${origin}/api/brand-grade/runs/${run.id}/candidates/${candidate.id}/compare`,
      { method: "POST" },
    );
    assert.equal(comparisonResponse.status, 200);
    assert.equal((await comparisonResponse.json()).verdict, "PASS");

    const approvalResponse = await fetch(
      `${origin}/api/brand-grade/runs/${run.id}/candidates/${candidate.id}/approve`,
      { method: "POST" },
    );
    assert.equal(approvalResponse.status, 200);
    assert.equal((await approvalResponse.json()).approvedCandidateId, candidate.id);

    const invalidRoleResponse = await fetch(
      `${origin}/api/brand-grade/runs/${run.id}/inputs?role=inspiration_only`,
      {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: Buffer.from("bad-role"),
      },
    );
    assert.equal(invalidRoleResponse.status, 400);

    const missingCandidateResponse = await fetch(
      `${origin}/api/brand-grade/runs/${run.id}/candidates/00000000-0000-0000-0000-000000000000/compare`,
      { method: "POST" },
    );
    assert.equal(missingCandidateResponse.status, 404);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    service.close();
    appServer.close();
    await rm(root, { recursive: true, force: true });
  }
});
