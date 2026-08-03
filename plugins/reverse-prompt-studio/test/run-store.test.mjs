import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { RunStore, imageExtensionFor } from "../src/run-store.mjs";

test("imageExtensionFor accepts supported raster image types", () => {
  assert.equal(imageExtensionFor("image/png"), ".png");
  assert.equal(imageExtensionFor("image/jpeg"), ".jpg");
  assert.equal(imageExtensionFor("image/webp"), ".webp");
  assert.throws(() => imageExtensionFor("image/svg+xml"), /Unsupported image type/);
});

test("RunStore saves source images and recipe revisions inside a run directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reverse-prompt-store-"));
  const store = new RunStore(root);

  try {
    const run = await store.createRun({
      bytes: Buffer.from("fake-png"),
      contentType: "image/png",
    });
    assert.ok(run.id);
    assert.equal(path.dirname(run.imagePath), path.join(root, run.id));
    assert.equal((await readFile(run.imagePath)).toString(), "fake-png");

    const recipe = { schema: "reverse-image-prompt/editor-v1", title: "Demo" };
    await store.saveRecipe(run.id, recipe, "analysis");
    const loaded = await store.loadRun(run.id);
    assert.deepEqual(loaded.recipe, recipe);
    assert.equal(loaded.revisions.length, 1);
    assert.equal(loaded.revisions[0].kind, "analysis");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("RunStore saves a role-specific product image beside the reference image", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reverse-prompt-product-store-"));
  const store = new RunStore(root);

  try {
    const run = await store.createRun({
      bytes: Buffer.from("reference"),
      contentType: "image/png",
    });
    const product = await store.saveProductImage(run.id, {
      bytes: Buffer.from("product"),
      contentType: "image/webp",
    });

    assert.equal(path.basename(product.productImagePath), "product.webp");
    assert.equal((await readFile(await store.getProductImagePath(run.id))).toString(), "product");
    const loaded = JSON.parse(
      await readFile(path.join(root, run.id, "run.json"), "utf8"),
    );
    assert.equal(loaded.productImagePath, product.productImagePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("RunStore persists a complete brand-grade run lifecycle", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "brand-grade-store-"));
  const store = new RunStore(root);

  try {
    const created = await store.createRun({
      bytes: Buffer.from("source"),
      contentType: "image/png",
      workflow: "brand_grade",
    });
    const input = await store.addRoleImage(created.id, {
      bytes: Buffer.from("truth"),
      contentType: "image/jpeg",
      role: "product_truth",
    });
    assert.equal(input.role, "product_truth");
    assert.match(path.basename(input.filename), /^[0-9a-f-]{36}\.jpg$/i);

    await store.saveBrandGradeAudit(created.id, {
      schema: "brand-grade-audit/v1",
      sourceVersionId: "source-v1",
    });
    await store.saveRepairContract(created.id, {
      schema: "brand-grade-repair-contract/v1",
      findingId: "G1-F01",
    });
    const candidate = await store.addCandidate(created.id, {
      bytes: Buffer.from("candidate"),
      contentType: "image/png",
    });
    await store.saveComparison(created.id, candidate.id, {
      schema: "brand-grade-comparison/v1",
      candidateVersionId: candidate.id,
      verdict: "PASS",
      allowedUse: "approved_source",
      lockDrift: [],
    });
    await store.approveCandidate(created.id, candidate.id);

    const run = await store.loadRun(created.id);
    assert.equal(run.workflow, "brand_grade");
    assert.equal(run.inputs[0].role, "product_truth");
    assert.equal(run.approvedCandidateId, candidate.id);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("RunStore rejects unsupported brand-grade input roles", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "brand-grade-role-store-"));
  const store = new RunStore(root);

  try {
    const created = await store.createRun({
      bytes: Buffer.from("source"),
      contentType: "image/png",
      workflow: "brand_grade",
    });
    await assert.rejects(
      () => store.addRoleImage(created.id, {
        bytes: Buffer.from("x"),
        contentType: "image/png",
        role: "inspiration_only",
      }),
      /role/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("RunStore refuses approval when a locked path drifted", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "brand-grade-lock-store-"));
  const store = new RunStore(root);

  try {
    const created = await store.createRun({
      bytes: Buffer.from("source"),
      contentType: "image/png",
      workflow: "brand_grade",
    });
    const candidate = await store.addCandidate(created.id, {
      bytes: Buffer.from("candidate"),
      contentType: "image/png",
    });
    await store.saveComparison(created.id, candidate.id, {
      schema: "brand-grade-comparison/v1",
      candidateVersionId: candidate.id,
      verdict: "PASS",
      allowedUse: "approved_source",
      lockDrift: [{ path: "M.subject", expected: "原产品", observed: "已变化", status: "FAIL" }],
    });
    await assert.rejects(
      () => store.approveCandidate(created.id, candidate.id),
      /lock drift/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
