import test from "node:test";
import assert from "node:assert/strict";

import {
  applyFieldEdits,
  buildRevisionPrompt,
  compilePortablePrompt,
  normalizeRecipe,
  restoreLockedRecipeSections,
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
