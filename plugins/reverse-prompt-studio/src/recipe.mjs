function clone(value) {
  return structuredClone(value);
}

export function normalizeRecipe(recipe) {
  const normalized = clone(recipe);
  normalized.sections = (normalized.sections ?? []).map((section) => ({
    ...section,
    fields: (section.fields ?? []).map((field) => ({
      control: "text",
      confidence: "unknown",
      locked: false,
      dirty: false,
      ...field,
    })),
  }));
  normalized.referenceTransfer ??= { preserve: [], translate: [], omit: [] };
  normalized.truthGaps ??= [];
  normalized.negativeConstraints ??= [];
  return normalized;
}

export function applyFieldEdits(recipe, edits) {
  const next = clone(recipe);
  next.sections = next.sections.map((section) => ({
    ...section,
    fields: section.fields.map((field) => {
      const edit = edits[field.id];
      if (!edit) return field;
      const valueChanged = Object.hasOwn(edit, "value") && edit.value !== field.value;
      return {
        ...field,
        ...edit,
        dirty: field.dirty || valueChanged,
      };
    }),
  }));
  return next;
}

export function buildRevisionPrompt(recipe) {
  const changedFields = [];
  const lockedFieldIds = [];

  for (const section of recipe.sections) {
    for (const field of section.fields) {
      if (field.dirty) changedFields.push({ id: field.id, value: field.value });
      if (field.locked) lockedFieldIds.push(field.id);
    }
  }

  const currentRecipe = clone(recipe);
  delete currentRecipe.editorChanges;

  return [
    "使用 $reverse-engineering-image-prompts 更新这份视觉配方。",
    "只应用 changed_fields；严格保留 locked_field_ids；其他字段默认保持不变。",
    "检查主体、动作、产品、构图、镜头、光影与材质之间的必要联动。",
    "返回完整且唯一的 reverse-image-prompt/editor-v1 结构化状态，不要附加 prose prompt。",
    JSON.stringify({
      changed_fields: changedFields,
      changed_paths: Object.keys(recipe.editorChanges ?? {}),
      locked_field_ids: lockedFieldIds,
      current_recipe: currentRecipe,
    }),
  ].join("\n\n");
}

export function compilePortablePrompt(recipe) {
  const lines = [recipe.title].filter(Boolean);
  for (const section of recipe.sections ?? []) {
    const values = section.fields
      .filter((field) => String(field.value ?? "").trim())
      .map((field) => `${field.label}：${field.value}`);
    if (values.length) lines.push(`${section.label}：${values.join("；")}`);
  }

  const transfer = recipe.referenceTransfer ?? {};
  if (transfer.preserve?.length) lines.push(`保留：${transfer.preserve.join("；")}`);
  if (transfer.translate?.length) lines.push(`转译：${transfer.translate.join("；")}`);
  if (transfer.omit?.length) lines.push(`不复制：${transfer.omit.join("；")}`);
  if (recipe.truthGaps?.length) lines.push(`待确认：${recipe.truthGaps.join("；")}`);
  if (recipe.negativeConstraints?.length) {
    lines.push(`避免：${recipe.negativeConstraints.join("；")}`);
  }
  return lines.join("\n");
}
