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
