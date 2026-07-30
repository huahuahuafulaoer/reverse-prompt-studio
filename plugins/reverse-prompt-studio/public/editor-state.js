export function updateEditorField(recipe, fieldId, patch) {
  const next = structuredClone(recipe);
  next.sections = next.sections.map((section) => ({
    ...section,
    fields: section.fields.map((field) => {
      if (field.id !== fieldId) return field;
      const valueChanged = Object.hasOwn(patch, "value") && patch.value !== field.value;
      return { ...field, ...patch, dirty: field.dirty || valueChanged };
    }),
  }));
  return next;
}

export function isSectionLocked(section) {
  return Boolean(section.fields?.length) && section.fields.every((field) => field.locked);
}

export function setSectionLocked(recipe, sectionId, locked) {
  const next = structuredClone(recipe);
  next.sections = next.sections.map((section) =>
    section.id === sectionId
      ? {
          ...section,
          fields: section.fields.map((field) => ({ ...field, locked })),
        }
      : section,
  );
  return next;
}

export function normalizeSectionLocks(recipe) {
  const next = structuredClone(recipe);
  next.sections = (next.sections ?? []).map((section) => {
    const locked = isSectionLocked(section);
    return {
      ...section,
      fields: (section.fields ?? []).map((field) => ({ ...field, locked })),
    };
  });
  return next;
}

export function collectFieldChanges(recipe) {
  const changed = {};
  const locked = [];
  for (const section of recipe.sections ?? []) {
    for (const field of section.fields ?? []) {
      if (field.dirty) changed[field.id] = field.value;
      if (field.locked) locked.push(field.id);
    }
  }
  return { changed, locked, changedPaths: Object.keys(recipe.editorChanges ?? {}) };
}

export function updateRecipeList(recipe, fieldPath, value) {
  const allowedPaths = new Set([
    "referenceTransfer.preserve",
    "referenceTransfer.translate",
    "referenceTransfer.omit",
    "truthGaps",
    "negativeConstraints",
  ]);
  if (!allowedPaths.has(fieldPath)) throw new Error(`Unsupported recipe path: ${fieldPath}`);

  const next = structuredClone(recipe);
  const segments = fieldPath.split(".");
  let target = next;
  for (const segment of segments.slice(0, -1)) target = target[segment];
  target[segments.at(-1)] = value;
  next.editorChanges = { ...(next.editorChanges ?? {}), [fieldPath]: true };
  return next;
}

export function progressForCodexEvent(message) {
  return {
    "turn/started": {
      phase: 1,
      label: "Codex 已接收",
      detail: "图片和分析任务已送达",
    },
    "item/started": {
      phase: 2,
      label: "正在理解画面",
      detail: "拆解构图、光影、色彩与材质",
    },
    "item/completed": {
      phase: 2,
      label: "正在理解画面",
      detail: "视觉证据持续返回中",
    },
    "turn/completed": {
      phase: 3,
      label: "正在生成字段",
      detail: "把视觉关系转换为可编辑结构",
    },
  }[message.method] ?? null;
}

export function formatElapsedTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function productStatusLabel({
  hasRun = false,
  hasProduct = false,
  hasRecipe = false,
  productApplied = false,
}) {
  if (!hasRun) return "先添加参考图";
  if (!hasProduct) return "添加产品图后自动匹配特征";
  if (productApplied) return "已匹配到当前视觉配方";
  return hasRecipe ? "已识别 · 点击匹配到当前配方" : "已识别 · 分析时自动使用";
}

export function restoreLockedSections(nextRecipe, previousRecipe, lockedSectionIds = []) {
  const next = structuredClone(nextRecipe);
  if (!previousRecipe || !lockedSectionIds.length) return next;
  const lockedIds = new Set(lockedSectionIds);
  const previousSections = new Map(
    (previousRecipe.sections ?? []).map((section) => [section.id, section]),
  );

  next.sections = (next.sections ?? []).map((section) => {
    if (!lockedIds.has(section.id)) return section;
    const previous = previousSections.get(section.id);
    return previous ? cleanLockedSection(previous) : section;
  });

  for (const [index, section] of (previousRecipe.sections ?? []).entries()) {
    if (!lockedIds.has(section.id)) continue;
    if (next.sections.some((candidate) => candidate.id === section.id)) continue;
    next.sections.splice(Math.min(index, next.sections.length), 0, cleanLockedSection(section));
  }
  return next;
}

function cleanLockedSection(section) {
  const locked = structuredClone(section);
  locked.fields = (locked.fields ?? []).map((field) => ({
    ...field,
    locked: true,
    dirty: false,
  }));
  return locked;
}
