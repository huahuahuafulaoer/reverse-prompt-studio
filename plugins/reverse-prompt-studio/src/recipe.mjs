function clone(value) {
  return structuredClone(value);
}

const anchorNames = ["subject", "action", "interaction", "scene"];

const revisionDependencyRules = {
  M: { sections: ["C", "Q", "X"], anchors: [] },
  S: { sections: ["A", "C", "Q", "X"], anchors: ["subject", "interaction"] },
  A: { sections: ["S", "K", "R", "Q", "X"], anchors: ["action", "interaction"] },
  P: { sections: ["S", "A", "C", "Q", "X"], anchors: ["interaction"] },
  C: { sections: ["M", "S", "Q", "X"], anchors: [] },
  K: { sections: ["C", "P", "Q", "X"], anchors: [] },
  L: { sections: ["G", "R", "Q", "X"], anchors: [] },
  G: { sections: ["L", "R", "Q", "X"], anchors: [] },
  E: { sections: ["C", "K", "L", "G", "R", "Q", "X"], anchors: ["scene", "interaction"] },
  R: { sections: ["L", "G", "Q", "X"], anchors: [] },
  T: { sections: ["M", "C", "Q", "X"], anchors: [] },
  Q: { sections: ["X"], anchors: [] },
  X: { sections: ["Q"], anchors: [] },
};

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

export function normalizeSectionInstructions(recipe, sectionInstructions = []) {
  if (!Array.isArray(sectionInstructions)) {
    throw new Error("sectionInstructions 必须是数组");
  }
  const sections = new Map((recipe.sections ?? []).map((section) => [section.id, section]));
  const seen = new Set();
  return sectionInstructions.map((entry) => {
    const sectionId = String(entry?.sectionId ?? "").trim();
    const section = sections.get(sectionId);
    if (!section) throw new Error(`未知板块 ${sectionId || "（空）"}`);
    if (seen.has(sectionId)) throw new Error(`重复板块 ${sectionId}`);
    seen.add(sectionId);
    const instruction = typeof entry?.instruction === "string"
      ? entry.instruction.trim()
      : "";
    if (!instruction) throw new Error(`板块 ${sectionId} 的修改要求不能为空`);
    if ((section.fields ?? []).some((field) => field.locked)) {
      throw new Error(`锁定板块 ${sectionId} 不能提交修改要求`);
    }
    return { sectionId, instruction };
  });
}

export function collectAuthorizedSectionIds(recipe, sectionInstructions = []) {
  const instructionIds = new Set(sectionInstructions.map((entry) => entry.sectionId));
  return (recipe.sections ?? [])
    .filter((section) =>
      instructionIds.has(section.id)
      || (section.fields ?? []).some((field) => field.dirty && !field.locked))
    .map((section) => section.id);
}

export function createRevisionAuthorization(recipe, primarySectionIds = []) {
  const primary = new Set(primarySectionIds);
  const dependencies = new Set();
  const authorizedAnchors = new Set();
  const presentSectionIds = new Set((recipe.sections ?? []).map((section) => section.id));

  for (const sectionId of primary) {
    const rule = revisionDependencyRules[sectionId];
    for (const dependencyId of rule?.sections ?? []) {
      if (presentSectionIds.has(dependencyId) && !primary.has(dependencyId)) {
        dependencies.add(dependencyId);
      }
    }
    for (const anchorName of rule?.anchors ?? []) authorizedAnchors.add(anchorName);
  }

  const sectionOrder = (recipe.sections ?? []).map((section) => section.id);
  const primaryIds = sectionOrder.filter((sectionId) => primary.has(sectionId));
  const dependencySectionIds = sectionOrder.filter((sectionId) => dependencies.has(sectionId));
  const authorizedSectionIds = sectionOrder.filter(
    (sectionId) => primary.has(sectionId) || dependencies.has(sectionId),
  );
  const authorizedAnchorKeys = anchorNames.filter((name) => authorizedAnchors.has(name));
  return { primarySectionIds: primaryIds, dependencySectionIds, authorizedSectionIds, authorizedAnchorKeys };
}

export function buildRevisionPrompt(recipe, sectionInstructions = []) {
  const normalizedInstructions = normalizeSectionInstructions(recipe, sectionInstructions);
  const changedFields = [];
  const lockedFieldIds = [];

  for (const section of recipe.sections) {
    for (const field of section.fields) {
      if (field.dirty && !field.locked) changedFields.push({ id: field.id, value: field.value });
      if (field.locked) lockedFieldIds.push(field.id);
    }
  }
  const primarySectionIds = collectAuthorizedSectionIds(recipe, normalizedInstructions);
  const authorization = createRevisionAuthorization(recipe, primarySectionIds);

  const currentRecipe = clone(recipe);
  delete currentRecipe.editorChanges;

  return [
    "使用 $reverse-engineering-image-prompts 更新这份视觉配方。",
    "按各板块职责把 section_instructions 中的自然语言要求转换为 primary_section_ids 内部字段，并同时应用 changed_fields。",
    "只允许修改 authorized_section_ids；dependency_section_ids 只做实现用户意图所必需的最小联动，未授权板块必须与 current_recipe 逐字段完全一致，字段 ID 保持稳定。",
    "同步 authorized_anchor_keys 对应的内容锚点，并同步相关保留、转译和排除约束，删除与用户新要求冲突的旧语义。不得修改未授权锚点；user_or_project_truth 永远不得被联动覆盖。",
    "严格保留 locked_field_ids。若必要联动涉及锁定字段，不得静默修改，保留原值并把冲突写入现有 truthGaps。",
    "返回完整且唯一的 reverse-image-prompt/editor-v1 结构化状态，不要附加 prose prompt。",
    JSON.stringify({
      section_instructions: normalizedInstructions,
      primary_section_ids: authorization.primarySectionIds,
      dependency_section_ids: authorization.dependencySectionIds,
      authorized_section_ids: authorization.authorizedSectionIds,
      authorized_anchor_keys: authorization.authorizedAnchorKeys,
      changed_fields: changedFields,
      changed_paths: Object.keys(recipe.editorChanges ?? {}),
      locked_field_ids: lockedFieldIds,
      current_recipe: currentRecipe,
    }),
  ].join("\n\n");
}

export function restoreRevisionRecipeSections(
  nextRecipe,
  currentRecipe,
  { authorizedSectionIds = [], authorizedAnchorKeys = [] } = {},
) {
  const next = clone(nextRecipe);
  if (!currentRecipe) return next;
  next.transferMode = currentRecipe.transferMode;
  const generatedAnchors = clone(next.contentAnchors ?? {});
  next.contentAnchors = clone(currentRecipe.contentAnchors);
  for (const anchorName of authorizedAnchorKeys) {
    if (!anchorNames.includes(anchorName) || !generatedAnchors[anchorName]) continue;
    if (currentRecipe.contentAnchors?.[anchorName]?.sourceRole === "user_or_project_truth") continue;
    next.contentAnchors[anchorName] = generatedAnchors[anchorName];
  }

  const authorized = new Set(authorizedSectionIds);
  const generatedSections = new Map(
    (next.sections ?? []).map((section) => [section.id, section]),
  );
  next.sections = (currentRecipe.sections ?? []).map((currentSection) => {
    const explicitlyLocked = (currentSection.fields ?? []).some((field) => field.locked);
    if (!authorized.has(currentSection.id) || explicitlyLocked) {
      return cleanPreservedSection(currentSection);
    }
    const generated = generatedSections.get(currentSection.id);
    return generated
      ? restoreRevisionFieldState(generated, currentSection)
      : cleanPreservedSection(currentSection);
  });
  return next;
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

function cleanPreservedSection(section) {
  const preserved = clone(section);
  preserved.fields = (preserved.fields ?? []).map((field) => ({
    ...field,
    dirty: false,
  }));
  return preserved;
}

function restoreRevisionFieldState(generatedSection, currentSection) {
  const generatedFields = new Map(
    (generatedSection.fields ?? []).map((field) => [field.id, field]),
  );
  const currentFieldIds = new Set((currentSection.fields ?? []).map((field) => field.id));
  const section = clone(generatedSection);
  section.fields = (currentSection.fields ?? []).map((currentField) => {
    const generated = generatedFields.get(currentField.id);
    if (!generated || currentField.locked) {
      return { ...clone(currentField), dirty: false };
    }
    return {
      ...generated,
      locked: Boolean(currentField.locked),
      dirty: false,
    };
  });
  for (const field of generatedSection.fields ?? []) {
    if (!currentFieldIds.has(field.id)) section.fields.push({ ...clone(field), dirty: false });
  }
  return section;
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
