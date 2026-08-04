import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CodexAppServer,
  CodexThread,
  JsonRpcConnection,
  createAnalyzeTurnParams,
  createProductMatchTurnParams,
  editorRecipeSchema,
  parseStructuredMessage,
} from "../src/codex-client.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

test("parseStructuredMessage accepts plain and fenced JSON", () => {
  assert.deepEqual(parseStructuredMessage('{"ok":true}'), { ok: true });
  assert.deepEqual(
    parseStructuredMessage('```json\n{"ok":true}\n```'),
    { ok: true },
  );
});

test("JsonRpcConnection resolves responses and forwards notifications", async () => {
  const inbound = new PassThrough();
  const outbound = new PassThrough();
  const connection = new JsonRpcConnection({ input: inbound, output: outbound });
  let notification;
  connection.on("notification", (message) => {
    notification = message;
  });

  const requestPromise = connection.request("thread/start", { cwd: "/tmp/project" });
  const requestLine = await new Promise((resolve) => outbound.once("data", resolve));
  const request = JSON.parse(requestLine.toString());

  inbound.write(`${JSON.stringify({ id: request.id, result: { thread: { id: "thr_1" } } })}\n`);
  inbound.write(`${JSON.stringify({ method: "turn/started", params: { turn: { id: "turn_1" } } })}\n`);

  assert.deepEqual(await requestPromise, { thread: { id: "thr_1" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notification.method, "turn/started");
  connection.close();
});

test("createAnalyzeTurnParams attaches the local image and reverse prompt skill", () => {
  const params = createAnalyzeTurnParams({
    threadId: "thr_1",
    imagePath: "/tmp/source.png",
    skillPath: "/tmp/skill/SKILL.md",
  });

  assert.equal(params.threadId, "thr_1");
  assert.deepEqual(params.input[0].text_elements, []);
  assert.deepEqual(params.input[1], {
    type: "skill",
    name: "reverse-engineering-image-prompts",
    path: "/tmp/skill/SKILL.md",
  });
  assert.deepEqual(params.input[2], {
    type: "localImage",
    path: "/tmp/source.png",
    detail: "original",
  });
  assert.equal(params.outputSchema.properties.schema.const, "reverse-image-prompt/editor-v1");
  assert.equal(editorRecipeSchema.additionalProperties, false);
});

test("createAnalyzeTurnParams labels reference and product images with separate truth roles", () => {
  const params = createAnalyzeTurnParams({
    threadId: "thr_1",
    imagePath: "/tmp/reference.png",
    productImagePath: "/tmp/product.webp",
    skillPath: "/tmp/skill/SKILL.md",
  });

  assert.match(params.input[0].text, /content_reference/);
  assert.match(params.input[0].text, /near_recreation/);
  assert.match(params.input[0].text, /主体类别、人数、动作、交互关系、场景类别/);
  assert.match(params.input[0].text, /活动.*职业、任务或用途/s);
  assert.match(params.input[0].text, /至少一条 negativeConstraints/);
  assert.match(params.input[0].text, /同类场景但主动作不同/);
  assert.match(params.input[0].text, /姿态或器材相似但职业、任务或用途不同/);
  assert.doesNotMatch(params.input[0].text, /inspiration_only/);
  assert.deepEqual(params.input[2], {
    type: "localImage",
    path: "/tmp/reference.png",
    detail: "original",
  });
  assert.match(params.input[3].text, /产品图.*product_truth/s);
  assert.match(params.input[0].text, /初次分析.*locked=false/);
  assert.deepEqual(params.input[4], {
    type: "localImage",
    path: "/tmp/product.webp",
    detail: "original",
  });
});

test("createAnalyzeTurnParams keeps the legacy inspiration-only contract in style composition mode", () => {
  const params = createAnalyzeTurnParams({
    threadId: "thr_1",
    imagePath: "/tmp/reference.png",
    skillPath: "/tmp/skill/SKILL.md",
    transferMode: "style_composition",
  });

  assert.match(params.input[0].text, /inspiration_only/);
  assert.match(params.input[0].text, /构图、光影、色彩、环境和可迁移风格/);
  assert.match(params.input[0].text, /允许更换主体和叙事/);
  assert.doesNotMatch(params.input[0].text, /content_reference/);
});

test("createAnalyzeTurnParams requires and records subject-swap truth", () => {
  assert.throws(
    () => createAnalyzeTurnParams({
      threadId: "thr_1",
      imagePath: "/tmp/reference.png",
      skillPath: "/tmp/skill/SKILL.md",
      transferMode: "subject_swap",
    }),
    /replacementSubject|替换主体/,
  );

  const params = createAnalyzeTurnParams({
    threadId: "thr_1",
    imagePath: "/tmp/reference.png",
    skillPath: "/tmp/skill/SKILL.md",
    transferMode: "subject_swap",
    replacementSubject: "红色机械鸟",
  });
  assert.match(params.input[0].text, /subject_swap/);
  assert.match(params.input[0].text, /user_or_project_truth/);
  assert.match(params.input[0].text, /红色机械鸟/);
});

test("editorRecipeSchema follows the strict response-format object profile recursively", () => {
  function inspect(schema, location = "$") {
    if (schema.type === "object") {
      const keys = Object.keys(schema.properties ?? {}).sort();
      assert.ok(keys.length > 0, `${location} must have fixed properties`);
      assert.equal(schema.additionalProperties, false, `${location} must close additional properties`);
      assert.deepEqual([...(schema.required ?? [])].sort(), keys, `${location} required must match properties`);
      for (const [key, child] of Object.entries(schema.properties)) inspect(child, `${location}.${key}`);
    }
    if (schema.type === "array") inspect(schema.items, `${location}[]`);
  }

  inspect(editorRecipeSchema);
  assert.equal(editorRecipeSchema.properties.transferMode.type, "string");
  assert.deepEqual(
    editorRecipeSchema.properties.transferMode.enum,
    ["content_fidelity", "style_composition", "subject_swap"],
  );
});

test("createProductMatchTurnParams replaces product truth while preserving locks and stable ids", () => {
  const params = createProductMatchTurnParams({
    threadId: "thr_1",
    productImagePath: "/tmp/product.png",
    skillPath: "/tmp/skill/SKILL.md",
    currentRecipe: {
      schema: "reverse-image-prompt/editor-v1",
      title: "Demo",
      sections: [
        {
          id: "L",
          label: "光影",
          fields: [{ id: "L01", label: "主光", value: "左上", locked: true }],
        },
        {
          id: "P",
          label: "产品",
          fields: [{ id: "P01", label: "产品", value: "旧产品", locked: true }],
        },
      ],
      referenceTransfer: { preserve: [], translate: [], omit: [] },
      truthGaps: [],
      negativeConstraints: [],
    },
  });

  assert.match(params.input[0].text, /product_truth/);
  assert.match(params.input[0].text, /产品相关的 P 字段/);
  assert.match(params.input[0].text, /字段 ID.*保持稳定/);
  assert.match(params.input[0].text, /locked_field_ids/);
  assert.match(params.input[0].text, /"locked_field_ids":\["L01"\]/);
  assert.match(params.input[0].text, /明确授权.*产品板块的锁/);
  assert.match(params.input[0].text, /不得推断.*工程功能/);
  assert.deepEqual(params.input.at(-1), {
    type: "localImage",
    path: "/tmp/product.png",
    detail: "original",
  });
});

test("editorRecipeSchema declares a type for const and enum properties", () => {
  const fieldProperties =
    editorRecipeSchema.properties.sections.items.properties.fields.items.properties;
  assert.equal(editorRecipeSchema.properties.schema.type, "string");
  assert.equal(fieldProperties.confidence.type, "string");
  assert.equal(fieldProperties.control.type, "string");
});

test("CodexThread resolves the final structured agent message for a turn", async () => {
  const inbound = new PassThrough();
  const outbound = new PassThrough();
  const connection = new JsonRpcConnection({ input: inbound, output: outbound });
  const thread = new CodexThread({ connection, threadId: "thr_1" });

  const resultPromise = thread.run({
    input: [{ type: "text", text: "Analyze", text_elements: [] }],
    outputSchema: editorRecipeSchema,
  });
  const requestLine = await new Promise((resolve) => outbound.once("data", resolve));
  const request = JSON.parse(requestLine.toString());
  inbound.write(`${JSON.stringify({ id: request.id, result: { turn: { id: "turn_1" } } })}\n`);
  inbound.write(`${JSON.stringify({
    method: "item/completed",
    params: {
      threadId: "thr_1",
      turnId: "turn_1",
      item: { type: "agentMessage", id: "item_1", text: '{"schema":"reverse-image-prompt/editor-v1","title":"Demo","sections":[],"referenceTransfer":{"preserve":[],"translate":[],"omit":[]},"truthGaps":[],"negativeConstraints":[]}' },
    },
  })}\n`);
  inbound.write(`${JSON.stringify({ method: "turn/completed", params: { threadId: "thr_1", turn: { id: "turn_1", status: "completed" } } })}\n`);

  const result = await resultPromise;
  assert.equal(result.title, "Demo");
  thread.close();
  connection.close();
});

test("CodexAppServer initializes a process and starts a resumable thread", async () => {
  const appServer = await CodexAppServer.launch({
    command: process.execPath,
    args: [path.join(testDirectory, "../fixtures/fake-app-server.mjs")],
  });

  try {
    const thread = await appServer.startThread({ cwd: "/tmp/project" });
    assert.equal(thread.id, "thr_fake");
    const result = await thread.run({
      input: [{ type: "text", text: "Analyze", text_elements: [] }],
      outputSchema: editorRecipeSchema,
    });
    assert.equal(result.title, "Fake result");

    const resumed = await appServer.resumeThread("thr_previous");
    assert.equal(resumed.id, "thr_previous");
    await appServer.archiveThread("thr_previous");
    await appServer.unarchiveThread("thr_previous");
    resumed.close();
    thread.close();
  } finally {
    appServer.close();
  }
});
