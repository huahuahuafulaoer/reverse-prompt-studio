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
