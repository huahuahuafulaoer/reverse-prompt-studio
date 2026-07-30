import {
  collectFieldChanges,
  formatElapsedTime,
  isSectionLocked,
  normalizeSectionLocks,
  progressForCodexEvent,
  setSectionLocked,
  updateEditorField,
  updateRecipeList,
} from "/editor-state.js";
import {
  UPDATE_DISMISS_KEY,
  shouldShowUpdate,
  updateCommandText,
} from "/update-state.js";

const ANALYSIS_STEPS = ["本地图片", "Codex 接收", "视觉拆解", "生成字段"];

const state = {
  runId: null,
  recipe: null,
  compiledPrompt: "",
  busy: false,
  previewUrl: null,
  analysisStartedAt: null,
  analysisTimer: null,
  update: null,
};

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

elements.imageInput.addEventListener("change", () => {
  const [file] = elements.imageInput.files;
  if (file) acceptImage(file);
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
    acceptImage(file);
  }
});

elements.analyzeButton.addEventListener("click", analyzeImage);
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

  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = URL.createObjectURL(file);
  elements.sourcePreview.src = state.previewUrl;
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
    elements.analyzeButton.disabled = false;
    elements.clearButton.disabled = false;
    setAnalysisExperience({
      phase: 0,
      label: "图片已就绪",
      detail: "已保存在本地；点击分析后才会发送给 Codex",
      elapsed: "READY",
      complete: true,
    });
  } catch (error) {
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

function applyResult(result, lockedSectionIds = []) {
  let nextRecipe = normalizeSectionLocks(result.recipe);
  for (const sectionId of lockedSectionIds) {
    nextRecipe = setSectionLocked(nextRecipe, sectionId, true);
  }
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
  if (!state.recipe) return;
  localStorage.setItem(
    "reverse-prompt-studio-state",
    JSON.stringify({
      runId: state.runId,
      recipe: state.recipe,
      compiledPrompt: state.compiledPrompt,
    }),
  );
}

function restoreLocalState() {
  try {
    const saved = JSON.parse(localStorage.getItem("reverse-prompt-studio-state"));
    if (!saved?.recipe) return;
    state.runId = saved.runId;
    state.recipe = normalizeSectionLocks(saved.recipe);
    state.compiledPrompt = saved.compiledPrompt ?? "";
    elements.compiledPrompt.value = state.compiledPrompt;
    elements.sourcePreview.src = `/api/runs/${state.runId}/image`;
    elements.sourcePreview.hidden = false;
    elements.dropEmpty.hidden = true;
    elements.replaceHint.hidden = false;
    elements.analyzeButton.disabled = false;
    elements.clearButton.disabled = false;
    renderRecipe();
  } catch {
    localStorage.removeItem("reverse-prompt-studio-state");
  }
}
