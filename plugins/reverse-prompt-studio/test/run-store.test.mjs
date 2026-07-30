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
