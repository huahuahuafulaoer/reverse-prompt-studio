import test from "node:test";
import assert from "node:assert/strict";

import {
  applyFieldEdits,
  buildRevisionPrompt,
  collectAuthorizedSectionIds,
  compilePortablePrompt,
  normalizeRecipe,
  normalizeSectionInstructions,
  restoreLockedRecipeSections,
  restoreRevisionRecipeSections,
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

test("section instructions are trimmed and reject malformed, duplicate, unknown, empty, or locked entries", () => {
  const recipe = normalizeRecipe(sampleRecipe);
  assert.deepEqual(
    normalizeSectionInstructions(recipe, [
      { sectionId: "L", instruction: "  改成清晨的柔光  " },
    ]),
    [{ sectionId: "L", instruction: "改成清晨的柔光" }],
  );
  assert.throws(() => normalizeSectionInstructions(recipe, {}), /必须是数组/);
  assert.throws(
    () => normalizeSectionInstructions(recipe, [
      { sectionId: "L", instruction: "柔光" },
      { sectionId: "L", instruction: "硬光" },
    ]),
    /重复.*L/,
  );
  assert.throws(
    () => normalizeSectionInstructions(recipe, [{ sectionId: "Z", instruction: "修改" }]),
    /未知.*Z/,
  );
  assert.throws(
    () => normalizeSectionInstructions(recipe, [{ sectionId: "L", instruction: "   " }]),
    /不能为空/,
  );

  const locked = applyFieldEdits(recipe, { L01: { locked: true } });
  assert.throws(
    () => normalizeSectionInstructions(locked, [{ sectionId: "L", instruction: "修改光线" }]),
    /锁定.*L/,
  );
});

test("revision prompt authorizes instruction and dirty-field sections with a stable contract", () => {
  const recipe = applyFieldEdits(normalizeRecipe(sampleRecipe), {
    C03: { value: "68%" },
  });
  const instructions = normalizeSectionInstructions(recipe, [
    { sectionId: "L", instruction: "光线更柔和" },
  ]);

  assert.deepEqual(collectAuthorizedSectionIds(recipe, instructions), ["C", "L"]);
  const prompt = buildRevisionPrompt(recipe, instructions);
  assert.match(prompt, /section_instructions/);
  assert.match(prompt, /"sectionId":"L","instruction":"光线更柔和"/);
  assert.match(prompt, /"authorized_section_ids":\["C","L"\]/);
  assert.match(prompt, /按各板块职责/);
  assert.match(prompt, /未授权板块.*逐字段完全一致/);
  assert.match(prompt, /必要联动.*truthGaps/);
  assert.match(prompt, /changed_fields/);
  assert.match(prompt, /locked_field_ids/);
  assert.match(prompt, /current_recipe/);
});

test("action instructions authorize only the linked state needed for semantic consistency", () => {
  const recipe = normalizeRecipe({
    ...sampleRecipe,
    transferMode: "content_fidelity",
    contentAnchors: {
      subject: { value: "远足者", preserve: true, sourceRole: "content_reference" },
      action: { value: "静止站立眺望", preserve: true, sourceRole: "content_reference" },
      interaction: { value: "双脚站定在岩脊", preserve: true, sourceRole: "content_reference" },
      scene: { value: "高山峡谷", preserve: true, sourceRole: "content_reference" },
    },
    sections: [
      { id: "S", label: "主体", fields: [{ id: "S01", label: "朝向", value: "面向山谷" }] },
      { id: "A", label: "动作", fields: [{ id: "A01", label: "核心动作", value: "静止站立眺望" }] },
      { id: "K", label: "镜头", fields: [{ id: "K01", label: "动态", value: "完全静止" }] },
      { id: "E", label: "环境", fields: [{ id: "E01", label: "场景", value: "高山峡谷" }] },
      { id: "R", label: "成像", fields: [{ id: "R01", label: "动作表现", value: "静态轮廓" }] },
      { id: "Q", label: "迁移边界", fields: [{ id: "Q01", label: "保留", value: "静止眺望" }] },
      { id: "X", label: "失败约束", fields: [{ id: "X01", label: "错误动作", value: "不得行走" }] },
    ],
  });

  const prompt = buildRevisionPrompt(recipe, [
    { sectionId: "A", instruction: "正在徒步登顶，稳定坚韧地持续上行" },
  ]);

  assert.match(prompt, /"primary_section_ids":\["A"\]/);
  assert.match(prompt, /"dependency_section_ids":\["S","K","R","Q","X"\]/);
  assert.match(prompt, /"authorized_section_ids":\["S","A","K","R","Q","X"\]/);
  assert.match(prompt, /"authorized_anchor_keys":\["action","interaction"\]/);
  assert.match(prompt, /同步.*内容锚点.*保留.*排除/);
});

test("action revision restoration keeps linked updates and removes the old action contradiction", () => {
  const current = normalizeRecipe({
    schema: "reverse-image-prompt/editor-v1",
    title: "高山远足者",
    transferMode: "content_fidelity",
    contentAnchors: {
      subject: { value: "一名远足者", preserve: true, sourceRole: "content_reference" },
      action: { value: "静止站立眺望", preserve: true, sourceRole: "content_reference" },
      interaction: { value: "双脚站定在岩脊", preserve: true, sourceRole: "content_reference" },
      scene: { value: "高山峡谷", preserve: true, sourceRole: "content_reference" },
    },
    sections: [
      { id: "S", label: "主体", fields: [{ id: "S01", label: "朝向", value: "面向山谷" }] },
      { id: "A", label: "动作", fields: [{ id: "A01", label: "核心动作", value: "静止站立眺望" }] },
      { id: "K", label: "镜头", fields: [{ id: "K01", label: "动态", value: "完全静止" }] },
      { id: "E", label: "环境", fields: [{ id: "E01", label: "场景", value: "高山峡谷" }] },
      { id: "R", label: "成像", fields: [{ id: "R01", label: "动作表现", value: "静态轮廓" }] },
      { id: "Q", label: "迁移边界", fields: [{ id: "Q01", label: "保留", value: "保持静止眺望" }] },
      { id: "X", label: "失败约束", fields: [{ id: "X01", label: "错误动作", value: "不得行走" }] },
    ],
    referenceTransfer: {
      preserve: ["主动作：静止站立眺望"],
      translate: ["维持静止关系"],
      omit: ["品牌标志"],
    },
    truthGaps: [],
    negativeConstraints: ["保持静止站立并眺望山谷"],
  });
  const generated = normalizeRecipe({
    ...current,
    contentAnchors: {
      subject: { value: "模型擅改主体", preserve: true, sourceRole: "content_reference" },
      action: { value: "沿岩脊稳定徒步上行", preserve: true, sourceRole: "content_reference" },
      interaction: { value: "前后脚交替踩踏岩面并持续推进", preserve: true, sourceRole: "content_reference" },
      scene: { value: "模型擅改场景", preserve: true, sourceRole: "content_reference" },
    },
    sections: current.sections.map((section) => {
      const values = {
        S: "背向镜头朝峰顶方向",
        A: "沿岩脊稳定徒步上行",
        K: "用步态和衣物变化表现运动",
        E: "模型擅改环境",
        R: "保持人物清晰并呈现自然步态",
        Q: "保留持续登顶动作",
        X: "避免静止摆拍或站立观景",
      };
      return {
        ...section,
        fields: section.fields.map((field) => ({ ...field, value: values[section.id] })),
      };
    }),
    referenceTransfer: {
      preserve: ["主动作：持续徒步登顶"],
      translate: ["维持稳定上行关系"],
      omit: ["品牌标志"],
    },
    negativeConstraints: ["避免静止摆拍或站立观景"],
  });

  const restored = restoreRevisionRecipeSections(generated, current, {
    authorizedSectionIds: ["S", "A", "K", "R", "Q", "X"],
    authorizedAnchorKeys: ["action", "interaction"],
  });
  const prompt = compilePortablePrompt(restored);

  assert.equal(restored.contentAnchors.subject.value, "一名远足者");
  assert.equal(restored.contentAnchors.scene.value, "高山峡谷");
  assert.equal(restored.contentAnchors.action.value, "沿岩脊稳定徒步上行");
  assert.equal(restored.sections.find((section) => section.id === "E").fields[0].value, "高山峡谷");
  assert.match(prompt, /沿岩脊稳定徒步上行/);
  assert.match(prompt, /持续徒步登顶/);
  assert.doesNotMatch(prompt, /静止站立眺望|保持静止关系|不得行走/);
});

test("revision restoration precisely preserves unauthorized sections without turning them into locks", () => {
  const current = normalizeRecipe({
    ...sampleRecipe,
    transferMode: "content_fidelity",
    contentAnchors: {
      subject: { value: "人物", preserve: true, sourceRole: "content_reference" },
      action: { value: "行走", preserve: true, sourceRole: "content_reference" },
      interaction: { value: "接触地面", preserve: true, sourceRole: "content_reference" },
      scene: { value: "街道", preserve: true, sourceRole: "content_reference" },
    },
  });
  const generated = normalizeRecipe({
    ...sampleRecipe,
    transferMode: "style_composition",
    contentAnchors: {},
    sections: [
      {
        id: "C",
        label: "被模型改写的构图",
        fields: [{ id: "C02", label: "主体位置", value: "模型擅改", locked: true }],
      },
      {
        id: "L",
        label: "光影",
        fields: [{ id: "L01", label: "主光方向", value: "柔和清晨光", locked: false }],
      },
    ],
  });

  const restored = restoreRevisionRecipeSections(generated, current, {
    authorizedSectionIds: ["L"],
  });
  assert.deepEqual(restored.sections.find((section) => section.id === "C"), current.sections[0]);
  assert.equal(restored.sections.find((section) => section.id === "C").fields[0].locked, false);
  assert.equal(restored.sections.find((section) => section.id === "L").fields[0].value, "柔和清晨光");
  assert.equal(restored.transferMode, "content_fidelity");
  assert.deepEqual(restored.contentAnchors, current.contentAnchors);
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
