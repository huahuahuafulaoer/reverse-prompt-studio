import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("styles preserve the semantic hidden attribute for layout components", async () => {
  const css = await readFile(path.join(projectDirectory, "public/styles.css"), "utf8");
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
});

test("busy state is synchronized to controls rendered during analysis", async () => {
  const script = await readFile(path.join(projectDirectory, "public/app.js"), "utf8");
  assert.match(script, /function syncBusyControls\(busy\)/);
  assert.match(script, /control\.disabled = busy/);
});

test("analysis wait state has visible motion and elapsed-time hooks", async () => {
  const html = await readFile(path.join(projectDirectory, "public/index.html"), "utf8");
  const css = await readFile(path.join(projectDirectory, "public/styles.css"), "utf8");

  assert.match(html, /id="analysisExperience"/);
  assert.match(html, /id="analysisElapsed"/);
  assert.match(html, /id="analysisDetail"/);
  assert.match(css, /@keyframes\s+scan-orbit/);
  assert.match(css, /prefers-reduced-motion/);
});

test("section locks use icon-only controls instead of per-field buttons", async () => {
  const script = await readFile(path.join(projectDirectory, "public/app.js"), "utf8");
  const css = await readFile(path.join(projectDirectory, "public/styles.css"), "utf8");

  assert.match(script, /function createSectionLockButton\(section/);
  assert.match(script, /function createLockIcon\(locked\)/);
  assert.doesNotMatch(script, /lock\.textContent/);
  assert.match(css, /\.section-lock-button/);
});

test("recipe sections render natural-language revision controls with collapsed advanced fields", async () => {
  const script = await readFile(path.join(projectDirectory, "public/app.js"), "utf8");
  const css = await readFile(path.join(projectDirectory, "public/styles.css"), "utf8");
  const renderRecipe = script.slice(
    script.indexOf("function renderRecipe()"),
    script.indexOf("function renderBoundaries()"),
  );

  assert.match(renderRecipe, /createSectionInstructionControl\(section/);
  assert.match(renderRecipe, /document\.createElement\("details"\)/);
  assert.match(renderRecipe, /summary\.textContent = "查看详细参数"/);
  assert.match(renderRecipe, /textarea\.setAttribute\("aria-label", view\.ariaLabel\)/);
  assert.doesNotMatch(renderRecipe, /"section-code", section\.id/);
  assert.doesNotMatch(renderRecipe, /"field-id", field\.id/);
  assert.match(css, /\.section-instruction/);
  assert.match(css, /\.section-details/);
});

test("revision requests persist section instructions and clear them only after success", async () => {
  const script = await readFile(path.join(projectDirectory, "public/app.js"), "utf8");
  const reviseRecipe = script.slice(
    script.indexOf("async function reviseRecipe()"),
    script.indexOf("async function matchProduct()"),
  );
  const persistence = script.slice(
    script.indexOf("function persistLocalState()"),
    script.indexOf("function activeWorkspace()"),
  );

  assert.match(reviseRecipe, /sectionInstructions: plan\.sectionInstructions/);
  assert.match(reviseRecipe, /正在按要求修改/);
  assert.match(reviseRecipe, /clearSubmittedSectionInstructions/);
  assert.doesNotMatch(reviseRecipe.slice(reviseRecipe.indexOf("catch")), /sectionInstructions\s*=/);
  assert.match(persistence, /sectionInstructions: state\.sectionInstructions/);
  assert.match(persistence, /saved\.sectionInstructions/);
});

test("compact export dock does not render the prompt preview", async () => {
  const html = await readFile(path.join(projectDirectory, "public/index.html"), "utf8");
  const css = await readFile(path.join(projectDirectory, "public/styles.css"), "utf8");

  assert.doesNotMatch(html, /class="prompt-output"/);
  assert.match(html, /<textarea id="compiledPrompt" hidden/);
  assert.match(css, /\.export-dock\s*\{[^}]*width:\s*fit-content/s);
});

test("new releases appear in a compact dismissible update strip", async () => {
  const html = await readFile(path.join(projectDirectory, "public/index.html"), "utf8");
  const script = await readFile(path.join(projectDirectory, "public/app.js"), "utf8");
  const updateState = await readFile(
    path.join(projectDirectory, "public/update-state.js"),
    "utf8",
  );
  const css = await readFile(path.join(projectDirectory, "public/styles.css"), "utf8");

  assert.match(html, /id="updateBanner"/);
  assert.match(html, /id="copyUpdateButton"/);
  assert.match(html, /id="dismissUpdateButton"/);
  assert.match(script, /async function checkForUpdates\(\)/);
  assert.match(updateState, /reverse-prompt-studio-dismissed-update/);
  assert.match(css, /\.update-banner/);
});

test("the source pane has a compact product-truth input and explicit match action", async () => {
  const html = await readFile(path.join(projectDirectory, "public/index.html"), "utf8");
  const script = await readFile(path.join(projectDirectory, "public/app.js"), "utf8");
  const css = await readFile(path.join(projectDirectory, "public/styles.css"), "utf8");

  assert.match(html, /id="productInput"/);
  assert.match(html, /id="productPreview"/);
  assert.match(html, /id="matchProductButton"/);
  assert.match(html, />\s*匹配产品\s*</);
  assert.match(script, /async function acceptProductImage\(file\)/);
  assert.match(script, /async function matchProduct\(\)/);
  assert.match(script, /\/api\/product-match/);
  assert.match(css, /\.product-input-card/);
  assert.match(css, /grid-template-columns:\s*64px\s+minmax\(0, 1fr\)\s+auto/);
});

test("reverse prompt mode controls default to content fidelity and submit subject-swap truth", async () => {
  const html = await readFile(path.join(projectDirectory, "public/index.html"), "utf8");
  const script = await readFile(path.join(projectDirectory, "public/app.js"), "utf8");

  assert.match(html, /id="transferMode"/);
  assert.match(html, /value="content_fidelity"[^>]*selected/);
  assert.match(html, /value="style_composition"/);
  assert.match(html, /value="subject_swap"/);
  assert.match(html, /id="replacementSubjectField"[^>]*hidden/);
  assert.match(html, /id="replacementSubject"/);
  assert.match(script, /transferMode:\s*"content_fidelity"/);
  assert.match(script, /replacementSubject/);
  assert.match(script, /JSON\.stringify\(\{[\s\S]*runId: state\.runId,[\s\S]*transferMode: state\.transferMode,[\s\S]*replacementSubject: state\.replacementSubject/);
});

test("image replacement switches runs only after upload succeeds", async () => {
  const script = await readFile(path.join(projectDirectory, "public/app.js"), "utf8");
  const acceptSource = script.slice(
    script.indexOf("async function acceptImage(file)"),
    script.indexOf("async function acceptProductImage(file)"),
  );
  const uploadIndex = acceptSource.indexOf('fetchJson("/api/upload"');
  const resetIndex = acceptSource.indexOf("resetRecipeOutput()");

  assert.ok(uploadIndex >= 0);
  assert.ok(resetIndex > uploadIndex, "old run state must reset only after upload succeeds");
  assert.match(acceptSource, /previousSourceState/);
  assert.match(acceptSource, /restoreSourcePreview/);

  const acceptProduct = script.slice(
    script.indexOf("async function acceptProductImage(file)"),
    script.indexOf("async function analyzeImage()"),
  );
  assert.match(acceptProduct, /previousProductState/);
  assert.doesNotMatch(acceptProduct, /catch \(error\) \{\s*resetProductState\(\)/);
});

test("finish workbench asks only for the approved image and optional tone direction", async () => {
  const html = await readFile(path.join(projectDirectory, "public/index.html"), "utf8");
  const script = await readFile(path.join(projectDirectory, "public/app.js"), "utf8");
  assert.match(html, /data-mode="brand-grade"/);
  assert.match(html, /id="finish-dropzone"/);
  assert.match(html, /id="finish-direction"/);
  assert.match(html, /id="finish-analyze"/);
  assert.match(html, /id="finish-summary"/);
  assert.match(html, /id="finish-priorities"/);
  assert.match(html, /id="copy-finish-prompt"/);
  assert.doesNotMatch(html, /id="gate-rail"|id="finding-list"|id="candidate-panel"/);
  assert.doesNotMatch(html, /id="add-evidence"|name="channel"|name="audience"/);
  assert.match(script, /\/finish-plan/);
  assert.doesNotMatch(script, /async function selectFinding|async function uploadCandidate/);
});

test("finish workbench presents one full-frame finishing action without diagnostic jargon", async () => {
  const html = await readFile(path.join(projectDirectory, "public/index.html"), "utf8");
  const script = await readFile(path.join(projectDirectory, "public/app.js"), "utf8");
  const brandMarkup = html.slice(html.indexOf('<main class="finish-workspace"'), html.indexOf("</main>", html.indexOf('<main class="finish-workspace"')));

  assert.match(brandMarkup, /成稿精修/);
  assert.match(brandMarkup, /生成精修提示词/);
  assert.match(brandMarkup, />\s*复制精修提示词\s*</);
  assert.doesNotMatch(brandMarkup, /诊断|问题|修复图|批准|参考图|品牌气质|文案安全区|渠道|受众/);
  assert.doesNotMatch(script, /presentAudit|presentComparison|repairActionState|canApproveCandidate/);
  assert.doesNotMatch(`${html}\n${script}`, /Codex App Server/);
});
