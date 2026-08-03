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
      if (field.dirty && !field.locked) changed[field.id] = field.value;
      if (field.locked) locked.push(field.id);
    }
  }
  return { changed, locked, changedPaths: Object.keys(recipe.editorChanges ?? {}) };
}

export function updateSectionInstruction(sectionInstructions, sectionId, instruction) {
  return { ...(sectionInstructions ?? {}), [sectionId]: instruction };
}

export function setSectionRevisionLocked(
  recipe,
  sectionInstructions,
  sectionId,
  locked,
) {
  const nextRecipe = setSectionLocked(recipe, sectionId, locked);
  if (locked) {
    nextRecipe.sections = nextRecipe.sections.map((section) =>
      section.id === sectionId
        ? {
            ...section,
            fields: section.fields.map((field) => ({ ...field, dirty: false })),
          }
        : section);
  }
  const nextInstructions = { ...(sectionInstructions ?? {}) };
  if (locked) delete nextInstructions[sectionId];
  return { recipe: nextRecipe, sectionInstructions: nextInstructions };
}

export function buildRevisionPlan(recipe, sectionInstructions = {}) {
  const sectionPayload = [];
  const authorizedSectionIds = [];
  let changedFieldCount = 0;
  for (const section of recipe.sections ?? []) {
    const locked = isSectionLocked(section);
    const instruction = String(sectionInstructions[section.id] ?? "").trim();
    const dirtyFields = (section.fields ?? []).filter((field) => field.dirty && !field.locked);
    changedFieldCount += dirtyFields.length;
    if (instruction && !locked) {
      sectionPayload.push({ sectionId: section.id, instruction });
    }
    if (!locked && (instruction || dirtyFields.length)) authorizedSectionIds.push(section.id);
  }
  const changedPathCount = Object.keys(recipe.editorChanges ?? {}).length;
  return {
    sectionInstructions: sectionPayload,
    authorizedSectionIds,
    sectionCount: authorizedSectionIds.length,
    totalChanges: sectionPayload.length + changedFieldCount + changedPathCount,
  };
}

export function clearSubmittedSectionInstructions(sectionInstructions, submitted = []) {
  const next = { ...(sectionInstructions ?? {}) };
  for (const { sectionId } of submitted) delete next[sectionId];
  return next;
}

export function sectionInstructionView(section, instruction = "", updated = false) {
  const locked = isSectionLocked(section);
  return {
    label: "修改要求",
    ariaLabel: `${section.label}修改要求`,
    placeholder: instructionPlaceholder(section.id, section.label),
    status: locked
      ? "已锁定，不参与修改"
      : updated
        ? "已按要求更新"
        : String(instruction).trim()
          ? "已加入本次修改"
          : "",
    locked,
  };
}

function instructionPlaceholder(sectionId, label) {
  return {
    M: "例如：整体更像一张克制的品牌海报",
    S: "例如：人物更放松，服装换成浅色",
    A: "例如：动作更自然，手部不要僵硬",
    P: "例如：产品更突出，但不要放得太大",
    C: "例如：主体向右一些，左侧留出更多空间",
    K: "例如：视角再低一点，画面更有纵深",
    L: "例如：让光线更柔和，阴影不要太重",
    G: "例如：整体偏暖一些，降低蓝色饱和度",
    E: "例如：背景更简洁，减少远处杂物",
    R: "例如：材质更真实，减少塑料感",
    T: "例如：不要生成文字，保留左上空白",
    Q: "例如：保留主体特征，不要猜测品牌",
    X: "例如：避免多余人物和变形的手指",
  }[sectionId] ?? `例如：说明你希望${label}怎么调整`;
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
  if (!previousRecipe) return next;
  if (previousRecipe.transferMode) next.transferMode = previousRecipe.transferMode;
  if (previousRecipe.contentAnchors) {
    next.contentAnchors = structuredClone(previousRecipe.contentAnchors);
  }
  if (!lockedSectionIds.length) return next;
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
