import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

const schemaModule = await import("../src/brand-grade-schema.mjs");
const promptModule = await import("../src/brand-grade-prompts.mjs");

const fixture = {
  schema: "finish-only-plan/v1",
  assessment: "画面内容完整，主要需要恢复自然皮肤层次并收敛岩石的重复高频纹理。",
  priorities: [
    {
      area: "texture_realism",
      observation: "岩石表面存在均匀重复的高频纹理。",
      treatment: "保留岩层大形，仅清理重复纹理，让细节随距离和受光自然衰减。",
    },
    {
      area: "light_tone",
      observation: "人物与环境的局部对比略显割裂。",
      treatment: "统一暖光方向，保留暗部层次，避免全局 HDR 和过度锐化。",
    },
  ],
};

test("finish-only plan validates a compact production-finish assessment", () => {
  assert.equal(typeof schemaModule.validateFinishOnlyPlan, "function");
  assert.deepEqual(schemaModule.validateFinishOnlyPlan(fixture), fixture);
  assert.throws(
    () => schemaModule.validateFinishOnlyPlan({ ...fixture, priorities: [] }),
    /priorities/,
  );
  assert.throws(
    () => schemaModule.validateFinishOnlyPlan({
      ...fixture,
      priorities: [{ ...fixture.priorities[0], area: "composition" }],
    }),
    /area/,
  );
  assert.throws(
    () => schemaModule.validateFinishOnlyPlan({
      ...fixture,
      priorities: [{
        ...fixture.priorities[0],
        treatment: "调整构图并更换人物服装，让主体位置更居中。",
      }],
    }),
    /protected content/,
  );
  assert.throws(
    () => schemaModule.validateFinishOnlyPlan({
      ...fixture,
      priorities: [{
        ...fixture.priorities[0],
        treatment: "先做白膜重建，再重新渲染全部材质。",
      }],
    }),
    /generative reconstruction/,
  );
});

test("finish-only output schema is strict and excludes provider-authored image locks", () => {
  assert.equal(typeof schemaModule.finishOnlyPlanOutputSchema, "object");
  const schema = schemaModule.finishOnlyPlanOutputSchema;
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["schema", "assessment", "priorities"]);
  assert.equal(schema.properties.schema.const, "finish-only-plan/v1");
  assert.equal(schema.properties.priorities.items.additionalProperties, false);
  assert.equal(schema.properties.platformPrompt, undefined);
});

test("server compiles immutable content locks into every finish-only prompt", () => {
  assert.equal(typeof promptModule.compileFinishOnlyPrompt, "function");
  const prompt = promptModule.compileFinishOnlyPrompt({
    plan: fixture,
    direction: "光线更通透，肤色自然，保留户外纪实感。",
  });

  assert.match(prompt, /已确认母版/);
  assert.match(prompt, /只允许调整画质、真实质感与光影调性/);
  assert.match(prompt, /人物身份、面部、身体、姿态、产品、装备、文字、标志/);
  assert.match(prompt, /构图、裁切、镜头、场景结构与物体位置/);
  assert.match(prompt, /光线更通透，肤色自然，保留户外纪实感/);
  assert.match(prompt, /避免全局磨皮、全局锐化、HDR、均匀高频纹理/);
  assert.doesNotMatch(prompt, /重新渲染|重建|白膜|8K|masterpiece/i);
});

test("finish-only turn attaches one immutable source image and requests no image generation", () => {
  assert.equal(typeof promptModule.createFinishOnlyPlanTurnParams, "function");
  const params = promptModule.createFinishOnlyPlanTurnParams({
    threadId: "thread-1",
    sourcePath: "/tmp/source.png",
    direction: "自然、克制",
    skillPath: "/tmp/brand-grade/SKILL.md",
  });
  assert.deepEqual(
    params.input.filter((item) => item.type === "localImage").map((item) => item.path),
    ["/tmp/source.png"],
  );
  assert.match(params.input[0].text, /finish-only-plan\/v1/);
  assert.match(params.input[0].text, /approved and semantically complete master/);
  assert.match(params.input[0].text, /Do not create or edit an image/);
  assert.equal(params.outputSchema.properties.schema.const, "finish-only-plan/v1");
});

test("bundled finishing skill treats the image as an approved master by default", async () => {
  const skill = await readFile(
    path.join(testDirectory, "../skills/brand-grade-finishing/SKILL.md"),
    "utf8",
  );
  assert.match(skill, /approved, semantically complete master/i);
  assert.match(skill, /finish-only-plan\/v1/);
  assert.match(skill, /identity, face, body, pose, product, equipment, text, logo/i);
  assert.match(skill, /macro form.*meso.*micro detail/is);
  assert.match(skill, /Do not recommend global smoothing, global sharpening, HDR/is);
});
