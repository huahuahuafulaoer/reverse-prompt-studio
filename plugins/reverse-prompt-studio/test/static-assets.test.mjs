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

test("brand grade workbench exposes the required controls", async () => {
  const html = await readFile(path.join(projectDirectory, "public/index.html"), "utf8");
  assert.match(html, /data-mode="brand-grade"/);
  assert.match(html, /id="finish-dropzone"/);
  assert.match(html, /id="finish-analyze"/);
  assert.match(html, /id="gate-rail"/);
  assert.match(html, /id="copy-repair-contract"/);
  assert.match(html, /id="candidate-input"/);
  assert.match(html, /id="approve-candidate"/);
});

test("creating a repair contract leaves the candidate panel in its QC-ready state", async () => {
  const script = await readFile(path.join(projectDirectory, "public/app.js"), "utf8");
  const selectFinding = script.slice(
    script.indexOf("async function selectFinding(finding)"),
    script.indexOf("async function copyRepairContract()"),
  );
  assert.match(
    selectFinding,
    /candidateStatus\.textContent = "候选图会同时检查四层质量和锁定漂移。"/,
  );
});
