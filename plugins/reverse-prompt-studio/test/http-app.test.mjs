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

    const analyzed = await fetch(`${origin}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: upload.runId }),
    }).then((response) => response.json());
    assert.equal(analyzed.recipe.title, "Fake product-aware result");

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
      body: JSON.stringify({ runId: upload.runId, recipe: matched.recipe }),
    }).then((response) => response.json());
    assert.equal(revised.recipe.title, "Fake revised result");
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    service.close();
    appServer.close();
    await rm(root, { recursive: true, force: true });
  }
});
