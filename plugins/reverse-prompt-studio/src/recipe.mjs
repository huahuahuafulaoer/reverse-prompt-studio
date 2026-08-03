function clone(value) {
  return structuredClone(value);
}

const anchorNames = ["subject", "action", "interaction", "scene"];

function emptyAnchor() {
  return { value: "", preserve: false, sourceRole: "not_applicable" };
}

export function normalizeRecipe(recipe) {
  const normalized = clone(recipe);
  normalized.transferMode ??= "style_composition";
  normalized.contentAnchors ??= {};
  normalized.contentAnchors = Object.fromEntries(
    anchorNames.map((name) => [name, { ...emptyAnchor(), ...normalized.contentAnchors[name] }]),
  );
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
  const preservedAnchors = Object.entries(recipe.contentAnchors ?? {})
    .filter(([, anchor]) => anchor?.preserve && String(anchor.value ?? "").trim());
  if (preservedAnchors.length) {
    const labels = { subject: "主体", action: "动作", interaction: "交互", scene: "场景" };
    lines.push(`内容锚点：${preservedAnchors.map(([name, anchor]) => `${labels[name]}：${anchor.value}`).join("；")}`);
    if (recipe.transferMode === "content_fidelity") {
      lines.push("语义保真：不得将上述内容锚点改写为同类场景但主动作不同的活动，也不得改写为姿态或器材相似但职业、任务或用途不同的内容。");
    }
  }
  for (const section of recipe.sections ?? []) {
    const values = section.fields
      .filter((field) => String(field.value ?? "").trim())
      .map((field) => `${field.label}：${field.value}`);
    if (values.length) lines.push(`${section.label}：${values.join("；")}`);
  }

  const transfer = recipe.referenceTransfer ?? {};
  if (transfer.preserve?.length) lines.push(`保留：${transfer.preserve.join("；")}`);
  if (transfer.translate?.length) lines.push(`转译：${transfer.translate.join("；")}`);
  const omit = filterAnchorConflicts(transfer.omit, preservedAnchors);
  if (omit.length) lines.push(`不复制：${omit.join("；")}`);
  if (recipe.truthGaps?.length) lines.push(`待确认：${recipe.truthGaps.join("；")}`);
  const negativeConstraints = filterAnchorConflicts(recipe.negativeConstraints, preservedAnchors);
  if (negativeConstraints.length) {
    lines.push(`避免：${negativeConstraints.join("；")}`);
  }
  return lines.join("\n");
}

export function restoreLockedRecipeSections(
  nextRecipe,
  currentRecipe,
  { authorizedSectionIds = [] } = {},
) {
  const next = clone(nextRecipe);
  if (!currentRecipe) return next;
  next.transferMode = currentRecipe.transferMode;
  next.contentAnchors = clone(currentRecipe.contentAnchors);
  const authorized = new Set(authorizedSectionIds);
  const lockedSections = new Map(
    (currentRecipe.sections ?? [])
      .filter(
        (section) =>
          !authorized.has(section.id) &&
          section.fields?.length &&
          section.fields.every((field) => field.locked),
      )
      .map((section) => [section.id, section]),
  );

  next.sections = (next.sections ?? []).map((section) => {
    const locked = lockedSections.get(section.id);
    return locked ? cleanLockedSection(locked) : section;
  });

  for (const [index, section] of (currentRecipe.sections ?? []).entries()) {
    if (!lockedSections.has(section.id)) continue;
    if (next.sections.some((candidate) => candidate.id === section.id)) continue;
    next.sections.splice(Math.min(index, next.sections.length), 0, cleanLockedSection(section));
  }
  return next;
}

export function validateTransferRecipe(
  recipe,
  { expectedMode = recipe.transferMode, replacementSubject = "" } = {},
) {
  if (recipe.transferMode !== expectedMode) {
    throw new Error(`Codex 返回的 transferMode 不一致：期望 ${expectedMode}`);
  }
  if (recipe.transferMode === "style_composition") return recipe;

  if (recipe.transferMode === "content_fidelity") {
    const missingSections = ["S", "A"].filter((id) => !hasNonemptySection(recipe, id));
    if (missingSections.length) {
      throw new Error("内容保真结果必须具有非空 S（主体）和 A（动作）板块");
    }
    for (const name of anchorNames) {
      const anchor = recipe.contentAnchors?.[name];
      if (!String(anchor?.value ?? "").trim() || anchor.preserve !== true || anchor.sourceRole !== "content_reference") {
        throw new Error(`内容保真结果缺少可保留的 ${name} content anchor`);
      }
    }
  }

  if (recipe.transferMode === "subject_swap") {
    const replacement = String(replacementSubject ?? "").trim();
    const subject = recipe.contentAnchors?.subject;
    if (!replacement || subject?.value !== replacement || subject?.preserve !== true || subject?.sourceRole !== "user_or_project_truth") {
      throw new Error("主体替换结果没有保留 replacementSubject 的 user_or_project_truth");
    }
  }
  return recipe;
}

export function validateProductRecipe(recipe, { previousRecipe } = {}) {
  const productSection = (recipe.sections ?? []).find((section) => section.id === "P");
  const productFields = productSection?.fields ?? [];
  if (!productFields.length || !productFields.some((field) => String(field.value ?? "").trim())) {
    throw new Error("Codex 没有返回产品字段，请重试产品分析");
  }

  if (previousRecipe) {
    const nextSections = new Map(
      (recipe.sections ?? []).map((section) => [section.id, section]),
    );
    for (const previousSection of previousRecipe.sections ?? []) {
      const nextSection = nextSections.get(previousSection.id);
      if (!nextSection) throw new Error(`Codex 返回缺少原有板块 ${previousSection.id}`);
      const nextFieldIds = new Set((nextSection.fields ?? []).map((field) => field.id));
      for (const field of previousSection.fields ?? []) {
        if (!nextFieldIds.has(field.id)) {
          throw new Error(`Codex 返回缺少原有字段 ${field.id}`);
        }
      }
    }
  }
  return recipe;
}

function cleanLockedSection(section) {
  const locked = clone(section);
  locked.fields = (locked.fields ?? []).map((field) => ({
    ...field,
    locked: true,
    dirty: false,
  }));
  return locked;
}

function hasNonemptySection(recipe, sectionId) {
  return (recipe.sections ?? [])
    .find((section) => section.id === sectionId)
    ?.fields?.some((field) => String(field.value ?? "").trim());
}

function filterAnchorConflicts(values = [], preservedAnchors = []) {
  const anchors = preservedAnchors.map(([, anchor]) => normalizeComparable(anchor.value));
  return values.filter((value) => {
    const candidate = normalizeComparable(value);
    return !anchors.some((anchor) => anchor && candidate && (candidate.includes(anchor) || anchor.includes(candidate)));
  });
}

function normalizeComparable(value) {
  return String(value ?? "").toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");
}
