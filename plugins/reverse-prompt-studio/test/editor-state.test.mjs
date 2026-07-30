import test from "node:test";
import assert from "node:assert/strict";

import * as editorState from "../public/editor-state.js";
import {
  collectFieldChanges,
  updateEditorField,
  updateRecipeList,
} from "../public/editor-state.js";

const recipe = {
  sections: [
    {
      id: "L",
      label: "光影",
      fields: [
        { id: "L01", label: "主光方向", value: "左上", locked: false, dirty: false },
        { id: "L02", label: "光线质感", value: "柔和", locked: false, dirty: false },
      ],
    },
  ],
};

test("updateEditorField preserves the previous recipe and marks the edited field", () => {
  const next = updateEditorField(recipe, "L01", { value: "右上" });

  assert.equal(recipe.sections[0].fields[0].value, "左上");
  assert.equal(next.sections[0].fields[0].value, "右上");
  assert.equal(next.sections[0].fields[0].dirty, true);
});

test("a section lock applies to every field and is collected for revision", () => {
  assert.equal(typeof editorState.setSectionLocked, "function");
  const edited = updateEditorField(recipe, "L01", { value: "右上" });
  const next = editorState.setSectionLocked(edited, "L", true);

  assert.equal(recipe.sections[0].fields[0].locked, false);
  assert.equal(next.sections[0].fields.every((field) => field.locked), true);
  assert.deepEqual(collectFieldChanges(next), {
    changed: { L01: "右上" },
    locked: ["L01", "L02"],
    changedPaths: [],
  });
});

test("updateRecipeList tracks edits outside regular field groups", () => {
  const source = {
    ...recipe,
    referenceTransfer: { preserve: ["冷色光"], translate: [], omit: [] },
  };
  const next = updateRecipeList(source, "referenceTransfer.preserve", ["暖色光", "低对比"]);

  assert.deepEqual(source.referenceTransfer.preserve, ["冷色光"]);
  assert.deepEqual(next.referenceTransfer.preserve, ["暖色光", "低对比"]);
  assert.deepEqual(collectFieldChanges(next).changedPaths, ["referenceTransfer.preserve"]);
});

test("Codex events map to visible analysis phases", () => {
  assert.equal(typeof editorState.progressForCodexEvent, "function");
  assert.deepEqual(editorState.progressForCodexEvent({ method: "turn/started" }), {
    phase: 1,
    label: "Codex 已接收",
    detail: "图片和分析任务已送达",
  });
  assert.deepEqual(editorState.progressForCodexEvent({ method: "item/started" }), {
    phase: 2,
    label: "正在理解画面",
    detail: "拆解构图、光影、色彩与材质",
  });
  assert.deepEqual(editorState.progressForCodexEvent({ method: "turn/completed" }), {
    phase: 3,
    label: "正在生成字段",
    detail: "把视觉关系转换为可编辑结构",
  });
});

test("elapsed analysis time uses a compact clock", () => {
  assert.equal(typeof editorState.formatElapsedTime, "function");
  assert.equal(editorState.formatElapsedTime(0), "00:00");
  assert.equal(editorState.formatElapsedTime(65_000), "01:05");
});

test("productStatusLabel distinguishes pending and already-applied product truth", () => {
  assert.equal(typeof editorState.productStatusLabel, "function");
  assert.equal(
    editorState.productStatusLabel({ hasRun: false, hasProduct: false }),
    "先添加参考图",
  );
  assert.equal(
    editorState.productStatusLabel({ hasRun: true, hasProduct: true, hasRecipe: false }),
    "已识别 · 分析时自动使用",
  );
  assert.equal(
    editorState.productStatusLabel({ hasRun: true, hasProduct: true, hasRecipe: true }),
    "已识别 · 点击匹配到当前配方",
  );
  assert.equal(
    editorState.productStatusLabel({
      hasRun: true,
      hasProduct: true,
      hasRecipe: true,
      productApplied: true,
    }),
    "已匹配到当前视觉配方",
  );
});

test("restoreLockedSections rejects model changes to locally locked values", () => {
  assert.equal(typeof editorState.restoreLockedSections, "function");
  const previous = {
    sections: [
      {
        id: "L",
        label: "光影",
        fields: [
          { id: "L01", label: "主光方向", value: "左上", locked: true, dirty: true },
          { id: "L02", label: "光线质感", value: "柔和", locked: true, dirty: false },
        ],
      },
    ],
  };
  const modelResult = {
    sections: [
      {
        id: "L",
        label: "模型改写的光影",
        fields: [{ id: "L01", label: "主光方向", value: "右下", locked: false }],
      },
    ],
  };

  const restored = editorState.restoreLockedSections(modelResult, previous, ["L"]);

  assert.equal(restored.sections[0].label, "光影");
  assert.deepEqual(
    restored.sections[0].fields.map(({ id, value, locked, dirty }) => ({
      id,
      value,
      locked,
      dirty,
    })),
    [
      { id: "L01", value: "左上", locked: true, dirty: false },
      { id: "L02", value: "柔和", locked: true, dirty: false },
    ],
  );
});
