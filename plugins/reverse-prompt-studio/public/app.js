import {
  collectFieldChanges,
  formatElapsedTime,
  isSectionLocked,
  normalizeSectionLocks,
  progressForCodexEvent,
  productStatusLabel,
  restoreLockedSections,
  setSectionLocked,
  updateEditorField,
  updateRecipeList,
} from "/editor-state.js";
import {
  UPDATE_DISMISS_KEY,
  shouldShowUpdate,
  updateCommandText,
} from "/update-state.js";
import {
  buildGateRail,
  canApproveCandidate,
  repairActionState,
} from "/finish-state.js";

const ANALYSIS_STEPS = ["本地图片", "Codex 接收", "视觉拆解", "生成字段"];

const state = {
  runId: null,
  recipe: null,
  compiledPrompt: "",
  busy: false,
  previewUrl: null,
  productPreviewUrl: null,
  hasProduct: false,
  productApplied: false,
  analysisStartedAt: null,
  analysisTimer: null,
  update: null,
};

const finish = {
  runId: null,
  sourceFile: null,
  sourcePreviewUrl: null,
  audit: null,
  selectedFinding: null,
  contract: null,
  candidateId: null,
  candidatePreviewUrl: null,
  comparison: null,
  progressTimer: null,
};

const finishProgressMessages = [
  "正在检查真实性与物理关系",
  "正在检查构图与光影意图",
  "正在核对品牌与投放目标",
  "正在清理材质、皮肤与边缘问题",
];

const finishEvidenceRoles = [
  ["product_truth", "产品真值"],
  ["subject_reference", "人物 / 主体真值"],
  ["style_reference", "风格参考"],
  ["composition_reference", "构图参考"],
  ["material_reference", "材质参考"],
  ["hard_structure_reference", "硬结构参考"],
];

const elements = {
  connectionStatus: document.querySelector("#connectionStatus"),
  updateBanner: document.querySelector("#updateBanner"),
  updateVersion: document.querySelector("#updateVersion"),
  updateReleaseLink: document.querySelector("#updateReleaseLink"),
  copyUpdateButton: document.querySelector("#copyUpdateButton"),
  dismissUpdateButton: document.querySelector("#dismissUpdateButton"),
  imageInput: document.querySelector("#imageInput"),
  dropZone: document.querySelector("#dropZone"),
  dropEmpty: document.querySelector("#dropEmpty"),
  sourcePreview: document.querySelector("#sourcePreview"),
  replaceHint: document.querySelector("#replaceHint"),
  productInputCard: document.querySelector("#productInputCard"),
  productInput: document.querySelector("#productInput"),
  productPlaceholder: document.querySelector("#productPlaceholder"),
  productPreview: document.querySelector("#productPreview"),
  productStatus: document.querySelector("#productStatus"),
  matchProductButton: document.querySelector("#matchProductButton"),
  analyzeButton: document.querySelector("#analyzeButton"),
  clearButton: document.querySelector("#clearButton"),
  analysisExperience: document.querySelector("#analysisExperience"),
  activityState: document.querySelector("#activityState"),
  analysisElapsed: document.querySelector("#analysisElapsed"),
  analysisDetail: document.querySelector("#analysisDetail"),
  activityList: document.querySelector("#activityList"),
  recipeEmpty: document.querySelector("#recipeEmpty"),
  recipeEditor: document.querySelector("#recipeEditor"),
  recipeTitle: document.querySelector("#recipeTitle"),
  sectionStack: document.querySelector("#sectionStack"),
  boundaryGrid: document.querySelector("#boundaryGrid"),
  exportDock: document.querySelector("#exportDock"),
  changeCount: document.querySelector("#changeCount"),
  reviseButton: document.querySelector("#reviseButton"),
  compiledPrompt: document.querySelector("#compiledPrompt"),
  copyJsonButton: document.querySelector("#copyJsonButton"),
  copyPromptButton: document.querySelector("#copyPromptButton"),
  toast: document.querySelector("#toast"),
};

const finishElements = {
  modeButtons: [...document.querySelectorAll("[data-mode]")],
  workspaces: [...document.querySelectorAll("[data-workspace]")],
  sourceInput: document.querySelector("#finish-source-input"),
  dropzone: document.querySelector("#finish-dropzone"),
  sourcePreview: document.querySelector("#finish-source-preview"),
  brief: document.querySelector("#finish-brief"),
  evidenceList: document.querySelector("#evidence-list"),
  addEvidence: document.querySelector("#add-evidence"),
  analyze: document.querySelector("#finish-analyze"),
  progress: document.querySelector("#finish-progress"),
  progressTitle: document.querySelector("#finish-progress-title"),
  results: document.querySelector("#finish-results"),
  gateRail: document.querySelector("#gate-rail"),
  findingList: document.querySelector("#finding-list"),
  repairBar: document.querySelector("#repair-bar"),
  repairTitle: document.querySelector("#repair-title"),
  repairSummary: document.querySelector("#repair-summary"),
  copyContract: document.querySelector("#copy-repair-contract"),
  candidatePanel: document.querySelector("#candidate-panel"),
  candidateInput: document.querySelector("#candidate-input"),
  candidateComparison: document.querySelector("#candidate-comparison"),
  candidateStatus: document.querySelector("#candidate-status"),
  approveCandidate: document.querySelector("#approve-candidate"),
};

elements.imageInput.addEventListener("change", () => {
  const [file] = elements.imageInput.files;
  if (file) acceptImage(file);
});

elements.productInput.addEventListener("change", () => {
  const [file] = elements.productInput.files;
  if (file) acceptProductImage(file);
});

for (const eventName of ["dragenter", "dragover"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("is-dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("is-dragging");
  });
}

elements.dropZone.addEventListener("drop", (event) => {
  const [file] = [...event.dataTransfer.files].filter((candidate) =>
    candidate.type.startsWith("image/"),
  );
  if (file) acceptImage(file);
});

window.addEventListener("paste", (event) => {
  const item = [...event.clipboardData.items].find((candidate) =>
    candidate.type.startsWith("image/"),
  );
  const file = item?.getAsFile();
  if (file) {
    event.preventDefault();
    if (activeWorkspace() === "brand-grade") uploadFinishSource(file);
    else acceptImage(file);
  }
});

elements.analyzeButton.addEventListener("click", analyzeImage);
elements.matchProductButton.addEventListener("click", matchProduct);
elements.reviseButton.addEventListener("click", reviseRecipe);
elements.clearButton.addEventListener("click", clearRun);
elements.copyPromptButton.addEventListener("click", () =>
  copyText(state.compiledPrompt, "提示词已复制"),
);
elements.copyJsonButton.addEventListener("click", () =>
  copyText(JSON.stringify(cleanRecipeForCopy(state.recipe), null, 2), "JSON 已复制"),
);
elements.copyUpdateButton.addEventListener("click", () =>
  copyText(updateCommandText(state.update), "升级命令已复制"),
);
elements.dismissUpdateButton.addEventListener("click", dismissUpdate);

const eventSource = new EventSource("/api/events");
eventSource.addEventListener("ready", () => setConnection(true));
eventSource.addEventListener("codex", (event) => {
  const message = JSON.parse(event.data);
  if (state.runId && message.runId !== state.runId) return;
  handleCodexEvent(message);
});
eventSource.onerror = () => setConnection(false);

restoreLocalState();
checkForUpdates();
initializeFinishWorkbench();

async function checkForUpdates() {
  try {
    const update = await fetchJson("/api/update");
    const dismissedVersion = localStorage.getItem(UPDATE_DISMISS_KEY);
    if (!shouldShowUpdate(update, dismissedVersion)) return;
    state.update = update;
    elements.updateVersion.textContent = `v${update.latestVersion}`;
    elements.updateReleaseLink.href = update.releaseUrl;
    elements.updateBanner.hidden = false;
  } catch {
    // Update availability must never block the local editing workflow.
  }
}

function dismissUpdate() {
  if (state.update?.latestVersion) {
    localStorage.setItem(UPDATE_DISMISS_KEY, state.update.latestVersion);
  }
  elements.updateBanner.hidden = true;
}

async function acceptImage(file) {
  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(file.type)) {
    return showToast("请选择 PNG、JPG 或 WEBP 图片");
  }
  if (file.size > 20 * 1024 * 1024) return showToast("图片不能超过 20MB");

  const previousSourceState = {
    previewUrl: state.previewUrl,
    src: elements.sourcePreview.getAttribute("src"),
    previewHidden: elements.sourcePreview.hidden,
    dropEmptyHidden: elements.dropEmpty.hidden,
    replaceHintHidden: elements.replaceHint.hidden,
  };
  const candidatePreviewUrl = URL.createObjectURL(file);
  elements.sourcePreview.src = candidatePreviewUrl;
  elements.sourcePreview.hidden = false;
  elements.dropEmpty.hidden = true;
  elements.replaceHint.hidden = false;
  setBusy(true, "正在保存图片");
  setAnalysisExperience({
    phase: 0,
    label: "正在保存图片",
    detail: "先保存在本地，尚未发送给 Codex",
    elapsed: "LOCAL",
    active: true,
  });

  try {
    const response = await fetchJson("/api/upload", {
      method: "POST",
      headers: { "content-type": file.type },
      body: file,
    });
    state.runId = response.runId;
    resetRecipeOutput();
    resetProductState();
    if (previousSourceState.previewUrl) URL.revokeObjectURL(previousSourceState.previewUrl);
    state.previewUrl = candidatePreviewUrl;
    elements.productInput.disabled = false;
    refreshProductStatus();
    elements.analyzeButton.disabled = false;
    elements.clearButton.disabled = false;
    setAnalysisExperience({
      phase: 0,
      label: "图片已就绪",
      detail: "已保存在本地；点击分析后才会发送给 Codex",
      elapsed: "READY",
      complete: true,
    });
    persistLocalState();
  } catch (error) {
    URL.revokeObjectURL(candidatePreviewUrl);
    restoreSourcePreview(previousSourceState);
    showToast(error.message);
    setAnalysisExperience({
      phase: 0,
      label: "图片保存失败",
      detail: error.message,
      elapsed: "ERROR",
      error: true,
    });
  } finally {
    setBusy(false);
  }
}

async function acceptProductImage(file) {
  if (!state.runId) return showToast("请先添加参考图");
  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(file.type)) {
    return showToast("请选择 PNG、JPG 或 WEBP 图片");
  }
  if (file.size > 20 * 1024 * 1024) return showToast("图片不能超过 20MB");

  const previousProductState = {
    previewUrl: state.productPreviewUrl,
    src: elements.productPreview.getAttribute("src"),
    previewHidden: elements.productPreview.hidden,
    placeholderHidden: elements.productPlaceholder.hidden,
    hasProduct: state.hasProduct,
    productApplied: state.productApplied,
    hasProductClass: elements.productInputCard.classList.contains("has-product"),
  };
  const candidatePreviewUrl = URL.createObjectURL(file);
  elements.productPreview.src = candidatePreviewUrl;
  elements.productPreview.hidden = false;
  elements.productPlaceholder.hidden = true;
  elements.productStatus.textContent = "正在保存产品图";
  setBusy(true, "正在保存产品图");

  try {
    await fetchJson(`/api/runs/${state.runId}/product`, {
      method: "POST",
      headers: { "content-type": file.type },
      body: file,
    });
    if (previousProductState.previewUrl) {
      URL.revokeObjectURL(previousProductState.previewUrl);
    }
    state.productPreviewUrl = candidatePreviewUrl;
    state.hasProduct = true;
    state.productApplied = false;
    elements.productInputCard.classList.add("has-product");
    refreshProductStatus();
    setAnalysisExperience({
      phase: state.recipe ? 3 : 0,
      label: state.recipe ? "产品图已就绪" : "双图已就绪",
      detail: state.recipe
        ? "点击匹配产品，只更新产品与必要的物理关系"
        : "点击开始分析，Codex 会分别读取视觉参考与产品真值",
      elapsed: "READY",
      complete: true,
    });
    persistLocalState();
    showToast(state.recipe ? "产品图已就绪，点击匹配产品" : "产品图会随参考图一起分析");
  } catch (error) {
    URL.revokeObjectURL(candidatePreviewUrl);
    restoreProductPreview(previousProductState);
    showToast(error.message);
    setAnalysisExperience({
      phase: 0,
      label: "产品图保存失败",
      detail: error.message,
      elapsed: "ERROR",
      error: true,
    });
  } finally {
    setBusy(false);
  }
}

function restoreSourcePreview(previousSourceState) {
  state.previewUrl = previousSourceState.previewUrl;
  if (previousSourceState.src === null) elements.sourcePreview.removeAttribute("src");
  else elements.sourcePreview.setAttribute("src", previousSourceState.src);
  elements.sourcePreview.hidden = previousSourceState.previewHidden;
  elements.dropEmpty.hidden = previousSourceState.dropEmptyHidden;
  elements.replaceHint.hidden = previousSourceState.replaceHintHidden;
}

function restoreProductPreview(previousProductState) {
  state.productPreviewUrl = previousProductState.previewUrl;
  state.hasProduct = previousProductState.hasProduct;
  state.productApplied = previousProductState.productApplied;
  if (previousProductState.src === null) elements.productPreview.removeAttribute("src");
  else elements.productPreview.setAttribute("src", previousProductState.src);
  elements.productPreview.hidden = previousProductState.previewHidden;
  elements.productPlaceholder.hidden = previousProductState.placeholderHidden;
  elements.productInputCard.classList.toggle(
    "has-product",
    previousProductState.hasProductClass,
  );
  refreshProductStatus();
  syncProductControls();
}

async function analyzeImage() {
  if (!state.runId || state.busy) return;
  setBusy(true, "Codex 正在分析");
  startAnalysisExperience({
    label: "正在联系 Codex",
    detail: "等待 Codex 确认接收图片与分析任务",
  });
  try {
    const result = await fetchJson("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: state.runId }),
    });
    applyResult(result);
    if (state.hasProduct) state.productApplied = true;
    refreshProductStatus();
    persistLocalState();
    finishAnalysisExperience({
      label: "分析完成",
      detail: "视觉关系已经转换为可编辑字段",
    });
  } catch (error) {
    showToast(error.message);
    failAnalysisExperience(error.message);
  } finally {
    setBusy(false);
  }
}

async function reviseRecipe() {
  if (!state.runId || !state.recipe || state.busy) return;
  const changes = collectFieldChanges(state.recipe);
  const totalChanges = Object.keys(changes.changed).length + changes.changedPaths.length;
  if (!totalChanges) return showToast("还没有需要重新梳理的修改");

  setBusy(true, "Codex 正在重新梳理");
  const lockedSectionIds = state.recipe.sections
    .filter((section) => isSectionLocked(section))
    .map((section) => section.id);
  startAnalysisExperience({
    label: "正在提交修改",
    detail: "Codex 会在同一个任务里重新组织提示词",
  });
  try {
    const result = await fetchJson("/api/revise", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: state.runId, recipe: state.recipe }),
    });
    applyResult(result, lockedSectionIds);
    showToast("新的视觉配方已生成");
    finishAnalysisExperience({
      label: "修订完成",
      detail: "新的提示词结构已经就绪",
    });
  } catch (error) {
    showToast(error.message);
    failAnalysisExperience(error.message);
  } finally {
    setBusy(false);
  }
}

async function matchProduct() {
  if (!state.runId || !state.recipe || !state.hasProduct || state.busy) return;
  const lockedSectionIds = state.recipe.sections
    .filter((section) => section.id !== "P" && isSectionLocked(section))
    .map((section) => section.id);
  setBusy(true, "Codex 正在匹配产品");
  startAnalysisExperience({
    label: "正在读取产品特征",
    detail: "只替换产品真值，并检查必要的比例与接触关系",
  });
  try {
    const result = await fetchJson("/api/product-match", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: state.runId, recipe: state.recipe }),
    });
    applyResult(result, lockedSectionIds);
    state.productApplied = true;
    refreshProductStatus();
    persistLocalState();
    showToast("产品特征已匹配");
    finishAnalysisExperience({
      label: "产品匹配完成",
      detail: "产品字段与必要的物理关系已经更新",
    });
  } catch (error) {
    showToast(error.message);
    failAnalysisExperience(error.message);
  } finally {
    setBusy(false);
  }
}

function applyResult(result, lockedSectionIds = []) {
  let nextRecipe = normalizeSectionLocks(result.recipe);
  nextRecipe = restoreLockedSections(nextRecipe, state.recipe, lockedSectionIds);
  state.recipe = nextRecipe;
  state.compiledPrompt = result.compiledPrompt;
  elements.compiledPrompt.value = state.compiledPrompt;
  renderRecipe();
  persistLocalState();
}

function renderRecipe() {
  elements.recipeEmpty.hidden = true;
  elements.recipeEditor.hidden = false;
  elements.exportDock.hidden = false;
  elements.recipeTitle.textContent = state.recipe.title || "未命名视觉配方";
  elements.sectionStack.replaceChildren();

  for (const section of state.recipe.sections ?? []) {
    const container = document.createElement("section");
    container.className = "recipe-section";
    container.classList.toggle("is-locked", isSectionLocked(section));

    const heading = document.createElement("div");
    heading.className = "section-title-row";
    heading.append(
      createTextElement("span", "section-code", section.id),
      createHeadingCopy(section.label, `${section.fields.length} 个可编辑字段`),
      createSectionLockButton(section, container),
    );

    const fieldList = document.createElement("div");
    fieldList.className = "field-list";
    for (const field of section.fields) fieldList.append(createFieldRow(field));
    container.append(heading, fieldList);
    elements.sectionStack.append(container);
  }

  renderBoundaries();
  updateChangeCount();
  syncProductControls();
}

function createFieldRow(field) {
  const row = document.createElement("div");
  row.className = "field-row";
  row.classList.toggle("is-dirty", Boolean(field.dirty));

  const meta = document.createElement("div");
  meta.className = "field-meta";
  meta.append(
    createTextElement("span", "field-id", field.id),
    createTextElement("label", "field-label", field.label),
    createTextElement("span", "confidence-badge", confidenceLabel(field.confidence)),
  );

  const input = document.createElement(field.control === "textarea" ? "textarea" : "input");
  input.className = "field-control";
  input.value = field.value ?? "";
  input.disabled = state.busy;
  input.setAttribute("aria-label", `${field.id} ${field.label}`);
  input.addEventListener("input", () => {
    state.recipe = updateEditorField(state.recipe, field.id, { value: input.value });
    row.classList.add("is-dirty");
    updateChangeCount();
    persistLocalState();
  });

  row.append(meta, input);
  return row;
}

function createSectionLockButton(section, container) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "section-lock-button";
  updateSectionLockButton(button, section);
  button.addEventListener("click", () => {
    const nextLocked = button.getAttribute("aria-pressed") !== "true";
    state.recipe = setSectionLocked(state.recipe, section.id, nextLocked);
    const nextSection = state.recipe.sections.find((candidate) => candidate.id === section.id);
    updateSectionLockButton(button, nextSection);
    container.classList.toggle("is-locked", nextLocked);
    persistLocalState();
  });
  return button;
}

function updateSectionLockButton(button, section) {
  const locked = isSectionLocked(section);
  button.setAttribute("aria-pressed", String(locked));
  button.setAttribute("aria-label", `${locked ? "解锁" : "锁定"}${section.label}板块`);
  button.title = locked
    ? `已锁定${section.label}板块；重新生成时保持本组字段`
    : `锁定${section.label}板块`;
  button.replaceChildren(createLockIcon(locked));
}

function createLockIcon(locked) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    locked
      ? "M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10M6 10h12v10H6z"
      : "M16.5 10V7.5a4.5 4.5 0 0 0-8.6-1.9M6 10h12v10H6z",
  );
  svg.append(path);
  return svg;
}

function renderBoundaries() {
  elements.boundaryGrid.replaceChildren();
  const definitions = [
    ["referenceTransfer.preserve", "保留", state.recipe.referenceTransfer?.preserve],
    ["referenceTransfer.translate", "转译", state.recipe.referenceTransfer?.translate],
    ["referenceTransfer.omit", "不复制", state.recipe.referenceTransfer?.omit],
    ["truthGaps", "待补真值", state.recipe.truthGaps],
    ["negativeConstraints", "禁止项", state.recipe.negativeConstraints],
  ];

  for (const [path, label, value] of definitions) {
    const wrapper = document.createElement("div");
    wrapper.className = "boundary-field";
    const fieldLabel = document.createElement("label");
    fieldLabel.textContent = label;
    const textarea = document.createElement("textarea");
    textarea.className = "boundary-control";
    textarea.value = (value ?? []).join("\n");
    textarea.setAttribute("aria-label", label);
    textarea.addEventListener("input", () => {
      const list = textarea.value
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
      state.recipe = updateRecipeList(state.recipe, path, list);
      updateChangeCount();
      persistLocalState();
    });
    wrapper.append(fieldLabel, textarea);
    elements.boundaryGrid.append(wrapper);
  }
}

function createHeadingCopy(title, description) {
  const wrapper = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = title;
  const copy = document.createElement("p");
  copy.textContent = description;
  wrapper.append(heading, copy);
  return wrapper;
}

function createTextElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function updateChangeCount() {
  if (!state.recipe) return;
  const changes = collectFieldChanges(state.recipe);
  const count = Object.keys(changes.changed).length + changes.changedPaths.length;
  elements.changeCount.textContent = String(count);
  elements.reviseButton.disabled = state.busy || count === 0;
}

function handleCodexEvent(message) {
  const progress = progressForCodexEvent(message);
  if (progress) setAnalysisExperience({ ...progress, active: true });
  if (message.method === "error") failAnalysisExperience("Codex 返回错误，请重试");
}

function setActivity(items, currentIndex) {
  elements.activityList.replaceChildren();
  items.forEach((text, index) => {
    const item = document.createElement("li");
    item.textContent = text;
    item.classList.toggle("is-current", index === currentIndex);
    item.classList.toggle("is-done", index < currentIndex);
    elements.activityList.append(item);
  });
}

function setAnalysisExperience({
  phase,
  label,
  detail,
  elapsed,
  active = false,
  complete = false,
  error = false,
}) {
  elements.analysisExperience.hidden = false;
  elements.analysisExperience.classList.toggle("is-active", active);
  elements.analysisExperience.classList.toggle("is-complete", complete);
  elements.analysisExperience.classList.toggle("is-error", error);
  elements.activityState.textContent = label;
  elements.analysisDetail.textContent = detail;
  if (elapsed !== undefined) elements.analysisElapsed.textContent = elapsed;
  setActivity(ANALYSIS_STEPS, phase);
}

function startAnalysisExperience({ label, detail }) {
  stopAnalysisTimer();
  state.analysisStartedAt = Date.now();
  elements.dropZone.classList.add("is-analyzing");
  setAnalysisExperience({ phase: 1, label, detail, elapsed: "00:00", active: true });
  state.analysisTimer = window.setInterval(updateAnalysisElapsed, 1000);
}

function updateAnalysisElapsed() {
  if (!state.analysisStartedAt) return;
  elements.analysisElapsed.textContent = formatElapsedTime(Date.now() - state.analysisStartedAt);
}

function stopAnalysisTimer() {
  if (state.analysisTimer) window.clearInterval(state.analysisTimer);
  state.analysisTimer = null;
  updateAnalysisElapsed();
}

function finishAnalysisExperience({ label, detail }) {
  stopAnalysisTimer();
  elements.dropZone.classList.remove("is-analyzing");
  setAnalysisExperience({ phase: 3, label, detail, complete: true });
}

function failAnalysisExperience(detail) {
  stopAnalysisTimer();
  elements.dropZone.classList.remove("is-analyzing");
  setAnalysisExperience({ phase: 1, label: "没有完成", detail, elapsed: "ERROR", error: true });
}

function setBusy(busy, label) {
  state.busy = busy;
  elements.analyzeButton.disabled = busy || !state.runId;
  elements.clearButton.disabled = busy || !state.runId;
  if (label) elements.activityState.textContent = label;
  syncBusyControls(busy);
  syncProductControls();
  updateChangeCount();
}

function syncBusyControls(busy) {
  for (const control of document.querySelectorAll(".field-control, .boundary-control")) {
    control.disabled = busy;
  }

  for (const lock of document.querySelectorAll(".section-lock-button")) {
    lock.disabled = busy;
  }
}

function syncProductControls() {
  elements.productInput.disabled = state.busy || !state.runId;
  elements.productInputCard.classList.toggle("is-busy", state.busy);
  elements.matchProductButton.disabled =
    state.busy || !state.runId || !state.recipe || !state.hasProduct;
}

function refreshProductStatus() {
  elements.productStatus.textContent = productStatusLabel({
    hasRun: Boolean(state.runId),
    hasProduct: state.hasProduct,
    hasRecipe: Boolean(state.recipe),
    productApplied: state.productApplied,
  });
}

function setConnection(online) {
  elements.connectionStatus.classList.toggle("is-online", online);
  elements.connectionStatus.lastElementChild.textContent = online
    ? "Codex App Server 在线"
    : "Codex 连接中断";
}

function clearRun() {
  stopAnalysisTimer();
  state.runId = null;
  state.recipe = null;
  state.compiledPrompt = "";
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
  resetProductState();
  elements.imageInput.value = "";
  elements.sourcePreview.removeAttribute("src");
  elements.sourcePreview.hidden = true;
  elements.dropEmpty.hidden = false;
  elements.replaceHint.hidden = true;
  elements.recipeEmpty.hidden = false;
  elements.recipeEditor.hidden = true;
  elements.exportDock.hidden = true;
  elements.analysisExperience.hidden = true;
  elements.analysisExperience.className = "analysis-experience";
  elements.dropZone.classList.remove("is-analyzing");
  elements.analyzeButton.disabled = true;
  elements.clearButton.disabled = true;
  localStorage.removeItem("reverse-prompt-studio-state");
}

function resetProductState() {
  state.hasProduct = false;
  state.productApplied = false;
  if (state.productPreviewUrl) URL.revokeObjectURL(state.productPreviewUrl);
  state.productPreviewUrl = null;
  elements.productInput.value = "";
  elements.productPreview.removeAttribute("src");
  elements.productPreview.hidden = true;
  elements.productPlaceholder.hidden = false;
  elements.productInputCard.classList.remove("has-product");
  refreshProductStatus();
  syncProductControls();
}

function resetRecipeOutput() {
  state.recipe = null;
  state.compiledPrompt = "";
  elements.compiledPrompt.value = "";
  elements.recipeEmpty.hidden = false;
  elements.recipeEditor.hidden = true;
  elements.exportDock.hidden = true;
  localStorage.removeItem("reverse-prompt-studio-state");
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败：${response.status}`);
  return body;
}

async function copyText(text, successMessage) {
  if (!text) return showToast("当前没有可复制的内容");
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    showToast("复制失败，请手动选择内容");
  }
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 2600);
}

function confidenceLabel(value) {
  return {
    high: "高置信",
    medium: "中置信",
    low: "低置信",
    unknown: "待确认",
  }[value] ?? "待确认";
}

function cleanRecipeForCopy(recipe) {
  if (!recipe) return null;
  const copy = structuredClone(recipe);
  delete copy.editorChanges;
  for (const section of copy.sections ?? []) {
    for (const field of section.fields ?? []) {
      delete field.dirty;
    }
  }
  return copy;
}

function persistLocalState() {
  if (!state.runId) return;
  localStorage.setItem(
    "reverse-prompt-studio-state",
    JSON.stringify({
      runId: state.runId,
      recipe: state.recipe,
      compiledPrompt: state.compiledPrompt,
      hasProduct: state.hasProduct,
      productApplied: state.productApplied,
    }),
  );
}

function restoreLocalState() {
  try {
    const saved = JSON.parse(localStorage.getItem("reverse-prompt-studio-state"));
    if (!saved?.runId) return;
    state.runId = saved.runId;
    state.recipe = saved.recipe ? normalizeSectionLocks(saved.recipe) : null;
    state.compiledPrompt = saved.compiledPrompt ?? "";
    state.hasProduct = Boolean(saved.hasProduct);
    state.productApplied = Boolean(saved.productApplied);
    elements.compiledPrompt.value = state.compiledPrompt;
    elements.sourcePreview.src = `/api/runs/${state.runId}/image`;
    elements.sourcePreview.hidden = false;
    elements.dropEmpty.hidden = true;
    elements.replaceHint.hidden = false;
    elements.productInput.disabled = false;
    refreshProductStatus();
    if (state.hasProduct) {
      elements.productPreview.src = `/api/runs/${state.runId}/product`;
      elements.productPreview.hidden = false;
      elements.productPlaceholder.hidden = true;
      elements.productInputCard.classList.add("has-product");
      refreshProductStatus();
    }
    elements.analyzeButton.disabled = false;
    elements.clearButton.disabled = false;
    if (state.recipe) renderRecipe();
    syncProductControls();
  } catch {
    localStorage.removeItem("reverse-prompt-studio-state");
  }
}

function activeWorkspace() {
  return finishElements.modeButtons.find((button) => button.classList.contains("is-active"))
    ?.dataset.mode ?? "reverse-prompt";
}

function initializeFinishWorkbench() {
  for (const button of finishElements.modeButtons) {
    button.setAttribute("aria-pressed", String(button.classList.contains("is-active")));
    button.addEventListener("click", () => switchWorkspace(button.dataset.mode));
  }

  finishElements.sourceInput.addEventListener("change", () => {
    const [file] = finishElements.sourceInput.files;
    if (file) uploadFinishSource(file);
  });
  for (const eventName of ["dragenter", "dragover"]) {
    finishElements.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      finishElements.dropzone.classList.add("is-dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    finishElements.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      finishElements.dropzone.classList.remove("is-dragging");
    });
  }
  finishElements.dropzone.addEventListener("drop", (event) => {
    const [file] = [...event.dataTransfer.files].filter((candidate) =>
      candidate.type.startsWith("image/"));
    if (file) uploadFinishSource(file);
  });
  finishElements.addEvidence.addEventListener("click", addEvidenceRow);
  finishElements.analyze.addEventListener("click", analyzeFinish);
  finishElements.candidateInput.addEventListener("change", () => {
    const [file] = finishElements.candidateInput.files;
    if (file) uploadCandidate(file);
  });
  finishElements.approveCandidate.addEventListener("click", approveCandidate);
  finishElements.copyContract.addEventListener("click", copyRepairContract);
}

function switchWorkspace(mode) {
  for (const button of finishElements.modeButtons) {
    const active = button.dataset.mode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  for (const workspace of finishElements.workspaces) {
    workspace.hidden = workspace.dataset.workspace !== mode;
  }
  finishElements.repairBar.hidden = mode !== "brand-grade" || !finish.contract;
}

function validateFinishImage(file) {
  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(file.type)) {
    showToast("请选择 PNG、JPG 或 WEBP 图片");
    return false;
  }
  if (file.size > 20 * 1024 * 1024) {
    showToast("图片不能超过 20MB");
    return false;
  }
  return true;
}

async function uploadFinishSource(file) {
  if (!validateFinishImage(file)) return;
  setFinishBusy(true, "正在保存待精修成图");
  try {
    const run = await requestBytes("/api/brand-grade/runs", file, file.type);
    const previewUrl = URL.createObjectURL(file);
    if (finish.sourcePreviewUrl) URL.revokeObjectURL(finish.sourcePreviewUrl);
    finish.runId = run.id;
    finish.sourceFile = file;
    finish.sourcePreviewUrl = previewUrl;
    resetFinishOutput();
    finishElements.sourcePreview.src = previewUrl;
    finishElements.sourcePreview.hidden = false;
    finishElements.dropzone.classList.add("has-source");
    finishElements.brief.hidden = false;
    finishElements.analyze.disabled = false;
  } catch (error) {
    showToast(error.message);
  } finally {
    setFinishBusy(false);
    finishElements.sourceInput.value = "";
  }
}

function resetFinishOutput() {
  stopFinishProgress();
  finish.audit = null;
  finish.selectedFinding = null;
  finish.contract = null;
  finish.candidateId = null;
  finish.comparison = null;
  if (finish.candidatePreviewUrl) URL.revokeObjectURL(finish.candidatePreviewUrl);
  finish.candidatePreviewUrl = null;
  finishElements.evidenceList.replaceChildren();
  finishElements.results.hidden = true;
  finishElements.repairBar.hidden = true;
  finishElements.candidatePanel.hidden = true;
  finishElements.candidatePanel.dataset.state = "";
  finishElements.candidateComparison.replaceChildren();
  finishElements.approveCandidate.disabled = true;
  finishElements.approveCandidate.textContent = "批准为交付源图";
  finishElements.candidateStatus.textContent = "候选图会同时检查四层质量和锁定漂移。";
}

function addEvidenceRow() {
  const row = document.createElement("div");
  row.className = "evidence-row";

  const roleLabel = document.createElement("label");
  roleLabel.textContent = "证据角色";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "证据角色");
  for (const [value, label] of finishEvidenceRoles) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  roleLabel.append(select);

  const fileLabel = document.createElement("label");
  fileLabel.className = "evidence-file";
  const fileName = document.createElement("span");
  fileName.textContent = "选择图片";
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp";
  input.setAttribute("aria-label", "证据图片");
  input.addEventListener("change", () => {
    delete row.dataset.inputId;
    fileName.textContent = input.files[0]?.name ?? "选择图片";
  });
  fileLabel.append(fileName, input);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "evidence-remove";
  remove.setAttribute("aria-label", "移除这条证据");
  remove.textContent = "×";
  remove.addEventListener("click", () => row.remove());

  row.append(roleLabel, fileLabel, remove);
  finishElements.evidenceList.append(row);
}

function readFinishBrief() {
  return Object.fromEntries(
    [...finishElements.brief.querySelectorAll(".brief-grid input")]
      .map((input) => [input.name, input.value.trim()]),
  );
}

async function uploadEvidenceRows(runId) {
  const rows = [...finishElements.evidenceList.querySelectorAll(".evidence-row")];
  for (const row of rows) {
    if (row.dataset.inputId) continue;
    const file = row.querySelector('input[type="file"]').files[0];
    if (!file) continue;
    if (!validateFinishImage(file)) throw new Error("证据图片格式或大小不符合要求");
    const role = row.querySelector("select").value;
    const input = await requestBytes(
      `/api/brand-grade/runs/${runId}/inputs?role=${encodeURIComponent(role)}`,
      file,
      file.type,
    );
    row.dataset.inputId = input.id;
  }
}

async function analyzeFinish() {
  if (!finish.runId || finish.progressTimer) return;
  showFinishProgress();
  setFinishBusy(true);
  try {
    await uploadEvidenceRows(finish.runId);
    finish.audit = await requestJson(
      `/api/brand-grade/runs/${finish.runId}/audit`,
      "POST",
      readFinishBrief(),
    );
    renderGateRail(buildGateRail(finish.audit.gates, finish.audit.earliestFailureGate));
    renderFindings(finish.audit);
    finishElements.results.hidden = false;
  } catch (error) {
    showToast(error.message);
    finishElements.brief.hidden = false;
  } finally {
    stopFinishProgress();
    setFinishBusy(false);
  }
}

function showFinishProgress() {
  stopFinishProgress();
  finishElements.progress.hidden = false;
  finishElements.results.hidden = true;
  finishElements.repairBar.hidden = true;
  finishElements.candidatePanel.hidden = true;
  let index = 0;
  finishElements.progressTitle.textContent = finishProgressMessages[index];
  finish.progressTimer = window.setInterval(() => {
    index = (index + 1) % finishProgressMessages.length;
    finishElements.progressTitle.textContent = finishProgressMessages[index];
  }, 1800);
}

function stopFinishProgress() {
  if (finish.progressTimer) window.clearInterval(finish.progressTimer);
  finish.progressTimer = null;
  finishElements.progress.hidden = true;
}

function renderGateRail(rail) {
  finishElements.gateRail.replaceChildren();
  const icons = { PASS: "✓", HOLD: "!", FAIL: "×" };
  for (const gate of rail) {
    const item = document.createElement("li");
    item.className = "gate-rail__item";
    item.dataset.current = String(gate.isCurrent);
    item.dataset.tone = gate.tone;
    item.setAttribute("aria-current", gate.isCurrent ? "step" : "false");
    const top = document.createElement("div");
    top.className = "gate-rail__top";
    top.append(
      createTextElement("span", "gate-rail__id", gate.id),
      createTextElement("span", "gate-rail__status", `${icons[gate.status]} ${gate.status}`),
    );
    item.append(
      top,
      createTextElement("strong", "gate-rail__name", gate.name),
    );
    if (gate.isCurrent) {
      item.append(createTextElement("p", "gate-rail__summary", gate.summary));
    }
    finishElements.gateRail.append(item);
  }
}

function renderFindings(audit) {
  finishElements.findingList.replaceChildren();
  const activeGate = audit.gates.find((gate) => gate.id === audit.earliestFailureGate);
  if (!activeGate) {
    const pass = createTextElement("div", "finish-all-pass", "✓ 四层均已通过，无需生成修复指令");
    finishElements.findingList.append(pass);
    return;
  }

  for (const finding of activeGate.findings) {
    const action = repairActionState(finding);
    const card = document.createElement("article");
    card.className = "finding-card";
    const heading = document.createElement("div");
    heading.className = "finding-card__heading";
    heading.append(
      createTextElement("span", "finding-card__severity", finding.severity),
      createTextElement("strong", "", finding.title),
    );
    const evidence = createTextElement("p", "finding-card__evidence", finding.observedEvidence);
    const target = createTextElement("p", "finding-card__target", `目标：${finding.targetResult}`);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button--primary";
    button.textContent = action.label;
    button.disabled = !action.enabled;
    button.addEventListener("click", () => selectFinding(finding));
    card.append(heading, evidence, target, button);
    finishElements.findingList.append(card);
  }
}

async function selectFinding(finding) {
  const activeGate = finish.audit?.gates.find((gate) => gate.id === finish.audit.earliestFailureGate);
  if (!activeGate?.findings.some((item) => item.id === finding.id)) {
    return showToast("只能处理当前最早失败或待确认层");
  }
  const action = repairActionState(finding);
  finish.selectedFinding = finding;
  if (!action.enabled) return showToast(action.label);

  setFinishBusy(true, "正在生成单问题修复指令");
  try {
    finish.contract = await requestJson(
      `/api/brand-grade/runs/${finish.runId}/contracts`,
      "POST",
      { findingId: finding.id },
    );
    finishElements.repairTitle.textContent = finding.title;
    finishElements.repairSummary.textContent = `只修改 ${finish.contract.changePaths.join("、")} · 其余路径锁定`;
    finishElements.repairBar.hidden = false;
    finishElements.candidatePanel.hidden = false;
    finishElements.candidatePanel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showToast(error.message);
  } finally {
    setFinishBusy(false);
  }
}

async function copyRepairContract() {
  if (!finish.contract?.platformPrompt) return;
  const originalLabel = finishElements.copyContract.textContent;
  try {
    await navigator.clipboard.writeText(finish.contract.platformPrompt);
    finishElements.copyContract.textContent = "已复制";
    window.setTimeout(() => {
      finishElements.copyContract.textContent = originalLabel;
    }, 1500);
  } catch {
    showToast("复制失败，请检查浏览器剪贴板权限");
  }
}

async function uploadCandidate(file) {
  if (!finish.contract || !validateFinishImage(file)) return;
  setFinishBusy(true, "正在比较候选图");
  finishElements.candidateStatus.textContent = "正在检查四层质量和锁定漂移…";
  try {
    const candidate = await requestBytes(
      `/api/brand-grade/runs/${finish.runId}/candidates`,
      file,
      file.type,
    );
    finish.candidateId = candidate.id;
    finish.comparison = await requestJson(
      `/api/brand-grade/runs/${finish.runId}/candidates/${candidate.id}/compare`,
      "POST",
    );
    const previewUrl = URL.createObjectURL(file);
    if (finish.candidatePreviewUrl) URL.revokeObjectURL(finish.candidatePreviewUrl);
    finish.candidatePreviewUrl = previewUrl;
    renderComparison(finish.comparison, previewUrl);
    finishElements.approveCandidate.disabled = !canApproveCandidate(finish.comparison);
  } catch (error) {
    finishElements.candidateStatus.textContent = "候选图比较未完成。";
    showToast(error.message);
  } finally {
    setFinishBusy(false);
    finishElements.candidateInput.value = "";
  }
}

function renderComparison(comparison, candidatePreviewUrl) {
  finishElements.candidateComparison.replaceChildren();
  const images = document.createElement("div");
  images.className = "comparison-images";
  for (const [label, src] of [
    ["原始源图", finish.sourcePreviewUrl],
    ["修复候选", candidatePreviewUrl],
  ]) {
    const figure = document.createElement("figure");
    const image = document.createElement("img");
    image.src = src;
    image.alt = label;
    const caption = document.createElement("figcaption");
    caption.textContent = label;
    figure.append(image, caption);
    images.append(figure);
  }

  const qc = document.createElement("div");
  qc.className = "comparison-qc";
  const rail = document.createElement("ol");
  rail.className = "comparison-rail";
  for (const gate of buildGateRail(comparison.gates, comparison.earliestFailureGate)) {
    const item = document.createElement("li");
    item.dataset.tone = gate.tone;
    item.textContent = `${gate.status === "PASS" ? "✓" : gate.status === "HOLD" ? "!" : "×"} ${gate.id} · ${gate.status}`;
    rail.append(item);
  }
  const locks = document.createElement("ul");
  locks.className = "lock-drift-list";
  if (comparison.lockDrift.length === 0) {
    const item = document.createElement("li");
    item.textContent = "✓ 未发现锁定路径漂移";
    locks.append(item);
  } else {
    for (const drift of comparison.lockDrift) {
      const item = document.createElement("li");
      item.dataset.status = drift.status;
      item.textContent = `${drift.status === "PASS" ? "✓" : "×"} ${drift.path} · ${drift.observed}`;
      locks.append(item);
    }
  }
  qc.append(rail, locks);
  finishElements.candidateComparison.append(images, qc);

  const approvable = canApproveCandidate(comparison);
  finishElements.candidateStatus.textContent = approvable
    ? "✓ 四层 PASS，且锁定路径无漂移，可以批准。"
    : `${comparison.verdict} · 仍需处理最早未通过层或锁定漂移。`;
}

async function approveCandidate() {
  if (!finish.candidateId || !canApproveCandidate(finish.comparison)) return;
  setFinishBusy(true, "正在批准候选图");
  try {
    await requestJson(
      `/api/brand-grade/runs/${finish.runId}/candidates/${finish.candidateId}/approve`,
      "POST",
    );
    finishElements.candidatePanel.dataset.state = "approved";
    finishElements.approveCandidate.textContent = "已批准 · 可进入高清放大";
    finishElements.approveCandidate.disabled = true;
    finishElements.candidateStatus.textContent = "✓ 已批准源图。高清放大是独立的后续步骤。";
  } catch (error) {
    showToast(error.message);
  } finally {
    setFinishBusy(false);
  }
}

function setFinishBusy(busy, label) {
  finishElements.sourceInput.disabled = busy;
  finishElements.addEvidence.disabled = busy;
  finishElements.analyze.disabled = busy || !finish.runId;
  finishElements.candidateInput.disabled = busy;
  finishElements.copyContract.disabled = busy;
  if (label) finishElements.candidateStatus.textContent = label;
  for (const control of finishElements.evidenceList.querySelectorAll("input, select, button")) {
    control.disabled = busy;
  }
}

async function requestBytes(url, bytes, contentType) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": contentType },
    body: bytes,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败：${response.status}`);
  return body;
}

async function requestJson(url, method = "GET", body) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers["content-type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败：${response.status}`);
  return payload;
}
