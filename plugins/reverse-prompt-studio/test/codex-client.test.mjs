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
    resumed.close();
    thread.close();
  } finally {
    appServer.close();
  }
});
