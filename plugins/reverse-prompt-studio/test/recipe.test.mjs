import test from "node:test";
import assert from "node:assert/strict";

import {
  applyFieldEdits,
  buildRevisionPrompt,
  compilePortablePrompt,
  normalizeRecipe,
  restoreLockedRecipeSections,
  validateTransferRecipe,
  validateProductRecipe,
} from "../src/recipe.mjs";

const sampleRecipe = {
  schema: "reverse-image-prompt/editor-v1",
  title: "雨夜跑鞋广告",
  sections: [
    {
      id: "C",
      label: "构图",
      fields: [
        { id: "C02", label: "主体位置", value: "中央偏右", confidence: "high" },
        { id: "C03", label: "主体占比", value: "55%", confidence: "medium" },
      ],
    },
    {
      id: "L",
      label: "光影",
      fields: [
        { id: "L01", label: "主光方向", value: "左上方", confidence: "high" },
      ],
    },
  ],
  referenceTransfer: {
    preserve: ["低调光影"],
    translate: ["将原主体替换为待定产品"],
    omit: ["品牌标志"],
  },
  truthGaps: ["产品结构待确认"],
  negativeConstraints: ["不要生成水印"],
};

test("normalizeRecipe assigns editable defaults without changing stable field ids", () => {
  const result = normalizeRecipe(sampleRecipe);

  assert.equal(result.sections[0].fields[0].id, "C02");
  assert.equal(result.sections[0].fields[0].locked, false);
  assert.equal(result.sections[0].fields[0].control, "text");
  assert.equal(result.sections[1].fields[0].dirty, false);
  assert.equal(result.transferMode, "style_composition");
  assert.deepEqual(Object.keys(result.contentAnchors), [
    "subject",
    "action",
    "interaction",
    "scene",
  ]);
});

test("applyFieldEdits changes only requested fields and records dirty ids", () => {
  const normalized = normalizeRecipe(sampleRecipe);
  const result = applyFieldEdits(normalized, {
    C03: { value: "68%" },
    L01: { locked: true },
  });

  assert.equal(result.sections[0].fields[1].value, "68%");
  assert.equal(result.sections[0].fields[1].dirty, true);
  assert.equal(result.sections[1].fields[0].locked, true);
  assert.equal(result.sections[0].fields[0].value, "中央偏右");
});

test("buildRevisionPrompt includes changes and locks while preserving the full source of truth", () => {
  const recipe = applyFieldEdits(normalizeRecipe(sampleRecipe), {
    C03: { value: "68%" },
    L01: { locked: true },
  });
  recipe.editorChanges = { "referenceTransfer.preserve": true };
  const prompt = buildRevisionPrompt(recipe);

  assert.match(prompt, /C03/);
  assert.match(prompt, /68%/);
  assert.match(prompt, /L01/);
  assert.match(prompt, /locked_field_ids/);
  assert.match(prompt, /"changed_paths":\["referenceTransfer\.preserve"\]/);
  assert.match(prompt, /reverse-image-prompt\/editor-v1/);
});

test("compilePortablePrompt renders one copyable prompt from structured fields", () => {
  const prompt = compilePortablePrompt(normalizeRecipe(sampleRecipe));

  assert.match(prompt, /雨夜跑鞋广告/);
  assert.match(prompt, /构图：主体位置：中央偏右；主体占比：55%/);
  assert.match(prompt, /保留：低调光影/);
  assert.match(prompt, /避免：不要生成水印/);
  assert.doesNotMatch(prompt, /confidence/);
});

test("content-fidelity compilation keeps anchors positive and removes conflicting exclusions", () => {
  const recipe = normalizeRecipe({
    ...sampleRecipe,
    transferMode: "content_fidelity",
    contentAnchors: {
      subject: { value: "单人攀岩者", preserve: true, sourceRole: "content_reference" },
      action: { value: "在近垂直岩壁上攀爬", preserve: true, sourceRole: "content_reference" },
      interaction: { value: "身体接触岩壁并有绳索安全带类别线索", preserve: true, sourceRole: "content_reference" },
      scene: { value: "蓝天与橙色岩壁", preserve: true, sourceRole: "content_reference" },
    },
    referenceTransfer: {
      preserve: ["小尺度主体位置"],
      translate: [],
      omit: ["不要复制单人攀岩者", "品牌 logo 与原文字"],
    },
    negativeConstraints: [
      "不要在近垂直岩壁上攀爬",
      "不要变成登山徒步、高空作业或救援",
    ],
  });

  const prompt = compilePortablePrompt(recipe);
  assert.match(prompt, /内容锚点.*单人攀岩者.*在近垂直岩壁上攀爬/s);
  assert.match(prompt, /语义保真：不得将上述内容锚点改写为同类场景但主动作不同的活动，也不得改写为姿态或器材相似但职业、任务或用途不同的内容/);
  assert.doesNotMatch(prompt, /不要复制单人攀岩者/);
  assert.doesNotMatch(prompt, /不要在近垂直岩壁上攀爬/);
  assert.match(prompt, /品牌 logo 与原文字/);
  assert.match(prompt, /不要变成登山徒步、高空作业或救援/);
});

test("restoreLockedRecipeSections hard-preserves non-product locks before persistence", () => {
  const current = normalizeRecipe({
    ...sampleRecipe,
    sections: [
      {
        id: "L",
        label: "光影",
        fields: [
          { id: "L01", label: "主光方向", value: "左上方", confidence: "high", locked: true },
        ],
      },
      {
        id: "P",
        label: "产品",
        fields: [
          { id: "P01", label: "产品", value: "旧产品", confidence: "high", locked: true },
        ],
      },
    ],
  });
  const modelResult = normalizeRecipe({
    ...sampleRecipe,
    sections: [
      {
        id: "L",
        label: "被改写的光影",
        fields: [
          { id: "L01", label: "主光方向", value: "右下方", confidence: "low", locked: false },
        ],
      },
      {
        id: "P",
        label: "产品",
        fields: [
          { id: "P01", label: "产品", value: "新产品", confidence: "high", locked: false },
        ],
      },
    ],
  });

  const restored = restoreLockedRecipeSections(modelResult, current, {
    authorizedSectionIds: ["P"],
  });

  assert.equal(restored.sections.find((section) => section.id === "L").fields[0].value, "左上方");
  assert.equal(restored.sections.find((section) => section.id === "P").fields[0].value, "新产品");
});

test("revision and product matching preserve the structured transfer contract", () => {
  const current = normalizeRecipe({
    ...sampleRecipe,
    transferMode: "subject_swap",
    contentAnchors: {
      subject: { value: "红色机械鸟", preserve: true, sourceRole: "user_or_project_truth" },
      action: { value: "沿墙面上升", preserve: true, sourceRole: "content_reference" },
      interaction: { value: "翼端接触墙面", preserve: true, sourceRole: "content_reference" },
      scene: { value: "开阔天空", preserve: true, sourceRole: "content_reference" },
    },
  });
  const modelResult = normalizeRecipe({
    ...sampleRecipe,
    transferMode: "style_composition",
    contentAnchors: {
      subject: { value: "模型改写", preserve: false, sourceRole: "not_applicable" },
      action: { value: "", preserve: false, sourceRole: "not_applicable" },
      interaction: { value: "", preserve: false, sourceRole: "not_applicable" },
      scene: { value: "", preserve: false, sourceRole: "not_applicable" },
    },
  });

  const restored = restoreLockedRecipeSections(modelResult, current);
  assert.equal(restored.transferMode, "subject_swap");
  assert.deepEqual(restored.contentAnchors, current.contentAnchors);
});

test("content fidelity requires non-empty subject and action sections and anchors", () => {
  const base = normalizeRecipe({
    ...sampleRecipe,
    transferMode: "content_fidelity",
    contentAnchors: {
      subject: { value: "攀岩者", preserve: true, sourceRole: "content_reference" },
      action: { value: "攀爬岩壁", preserve: true, sourceRole: "content_reference" },
      interaction: { value: "身体与岩壁接触", preserve: true, sourceRole: "content_reference" },
      scene: { value: "户外岩壁", preserve: true, sourceRole: "content_reference" },
    },
  });
  assert.throws(() => validateTransferRecipe(base), /S.*A|主体.*动作/);

  base.sections.push(
    { id: "S", label: "主体", fields: [{ id: "S01", label: "主体", value: "攀岩者" }] },
    { id: "A", label: "动作", fields: [{ id: "A01", label: "动作", value: "攀爬岩壁" }] },
  );
  assert.equal(validateTransferRecipe(base), base);
});

test("validateProductRecipe requires product fields and stable existing ids", () => {
  const current = normalizeRecipe(sampleRecipe);
  assert.throws(
    () => validateProductRecipe(current),
    /没有返回产品字段/,
  );

  const withProduct = normalizeRecipe({
    ...sampleRecipe,
    sections: [
      ...sampleRecipe.sections,
      {
        id: "P",
        label: "产品",
        fields: [{ id: "P01", label: "产品", value: "新产品", confidence: "high" }],
      },
    ],
  });
  assert.equal(validateProductRecipe(withProduct), withProduct);

  const missingExistingField = structuredClone(withProduct);
  missingExistingField.sections.find((section) => section.id === "C").fields.shift();
  assert.throws(
    () => validateProductRecipe(missingExistingField, { previousRecipe: current }),
    /缺少原有字段 C02/,
  );
});
